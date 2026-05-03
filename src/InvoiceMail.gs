/**
 * 請求書メール送付フロー (ステップ3 C-3) — freee送信API版
 *
 * - 対象: ステータス=発行済 + 送付完了日時 が空 + 送付方法=メール の請求書
 * - freee の POST /iv/sendings で freee から取引先にメール送信させる
 *   (PDFは freee が自動で添付。GAS側でPDFダウンロードや添付処理は不要)
 * - 送信成功後 ステータス→送付済 + 送付完了日時を記録
 * - dryRun フラグで実送信せず payload をログ出力のみに切替可能
 *
 * 差出人:
 *   freee 側に登録されている送信元メールアドレスから送信される。
 *   差出人を変更したい場合は freee 管理画面の「請求書テンプレート」または
 *   「メール設定」で調整。
 *
 * テンプレート:
 *   件名・本文はこのファイル内のテンプレートを使用。
 */
const InvoiceMail = {
  INVOICE_SHEET: '03_請求一覧',
  CLIENT_MASTER_SHEET: '01_クライアントマスタ',

  SUBJECT_TEMPLATE: '【{年}/{月}分 ご請求書】{件名}',

  BODY_TEMPLATE:
    '{To担当者名}\n' +
    '\n' +
    'いつも大変お世話になっております。\n' +
    'bizmote株式会社 {送信者表示名}です。\n' +
    '\n' +
    '{年}年{月}月分のご請求書をお送りいたします。\n' +
    'ご査収のほど、よろしくお願いいたします。\n' +
    '\n' +
    '【ご請求内容】\n' +
    '・件名: {件名}\n' +
    '・税込ご請求金額: ¥{税込金額}\n' +
    '・お支払期日: {期日}\n' +
    '\n' +
    '【お振込先】\n' +
    '{bank_info}\n' +
    '\n' +
    'ご不明点ございましたら、本メールにご返信ください。\n' +
    '今後ともよろしくお願いいたします。\n' +
    '\n' +
    '------------------------\n' +
    '{COMPANY_NAME}\n' +
    '{COMPANY_ZIP}\n' +
    '{COMPANY_ADDRESS}\n' +
    '------------------------\n',

  /**
   * 送付対象(発行済かつ未送付かつ送付方法=メール)の請求書一覧を返す
   * @return {Array<object>}
   */
  getPendingMails: function() {
    const allInvoices = SheetUtil.readAsObjects(this.INVOICE_SHEET, 1, 3);
    const targets = allInvoices.filter(r => {
      const status = String(r['ステータス'] || '').trim();
      const sentAt = r['送付完了日時'];
      return status === '発行済' && r['freee請求書ID'] && !sentAt;
    });
    if (targets.length === 0) return [];

    const clients = SheetUtil.readAsObjects(this.CLIENT_MASTER_SHEET, 1, 3);
    const clientMap = {};
    clients.forEach(c => clientMap[c['クライアントID']] = c);

    const senderEmail = Session.getActiveUser().getEmail();
    const senderName = UserMapping.getDisplayName(senderEmail) || senderEmail.split('@')[0];

    return targets.map(r => {
      const client = clientMap[r['クライアントID']] || {};
      const yearMonth = normalizeYearMonth(r['対象月']);
      const invoiceSubject = this._buildInvoiceSubject(client['件名テンプレ'] || '', yearMonth);
      const subject = this._render(this.SUBJECT_TEMPLATE, {
        '{年}': yearMonth.split('-')[0] || '',
        '{月}': yearMonth.split('-')[1] || '',
        '{件名}': invoiceSubject,
      });

      const total = Number(r['税込金額']) || 0;
      const dueDate = this._dueDateString(yearMonth, client['支払サイト']);

      const body = this._render(this.BODY_TEMPLATE, {
        '{To担当者名}': client['To担当者名'] || `${client['企業名'] || r['クライアントID']} ご担当者様`,
        '{送信者表示名}': senderName,
        '{年}': yearMonth.split('-')[0] || '',
        '{月}': yearMonth.split('-')[1] || '',
        '{件名}': invoiceSubject,
        '{税込金額}': total.toLocaleString(),
        '{期日}': dueDate,
        '{bank_info}': Config.getOrDefault('BANK_INFO', ''),
        '{COMPANY_NAME}': Config.getOrDefault('COMPANY_NAME', 'bizmote株式会社'),
        '{COMPANY_ZIP}': Config.getOrDefault('COMPANY_ZIP', ''),
        '{COMPANY_ADDRESS}': Config.getOrDefault('COMPANY_ADDRESS', ''),
      });

      const sendMethod = String(client['送付方法'] || '').trim();
      const toAddress = String(client['Toアドレス'] || '').trim();
      const ccAddress = String(client['CCアドレス'] || '').trim();
      const bccAddress = String(client['社内CC'] || '').trim();

      const skipReason =
        sendMethod !== 'メール' ? `送付方法=${sendMethod} はメール対象外` :
        !toAddress ? 'Toアドレスが未設定' :
        '';

      return {
        invoiceId: r['請求ID'],
        rowNumber: r._rowNumber,
        freeeInvoiceId: r['freee請求書ID'],
        yearMonth: yearMonth,
        clientId: r['クライアントID'],
        clientName: client['企業名'] || r['クライアントID'],
        toName: client['To担当者名'] || '',
        toAddress: toAddress,
        ccAddress: ccAddress,
        bccAddress: bccAddress,
        subject: subject,
        body: body,
        invoiceSubject: invoiceSubject,
        total: total,
        dueDate: dueDate,
        sendMethod: sendMethod,
        skipReason: skipReason,
        senderEmail: senderEmail,
        senderName: senderName,
      };
    });
  },

  /**
   * 1件のメールを freee API で送信 (内部)
   * @private
   */
  _sendOne: function(preview, dryRun) {
    if (preview.skipReason) {
      throw new Error(preview.skipReason);
    }

    // ステータス再チェック
    const allRows = SheetUtil.readAsObjects(this.INVOICE_SHEET, 1, 3);
    const row = allRows.find(r => r['請求ID'] === preview.invoiceId);
    if (!row) throw new Error(`請求が見つかりません: ${preview.invoiceId}`);
    const status = String(row['ステータス'] || '').trim();
    if (status !== '発行済') throw new Error(`ステータスが発行済ではありません (${status})`);
    if (row['送付完了日時']) throw new Error('既に送付済みです');

    const payload = this.buildSendingPayload(preview);

    if (dryRun) {
      Logger.log(`[dryRun] ${preview.invoiceId} payload:\n${JSON.stringify(payload, null, 2)}`);
      return {
        invoiceId: preview.invoiceId,
        clientName: preview.clientName,
        dryRun: true,
        to: preview.toAddress,
      };
    }

    const response = FreeeClient.sendInvoice(payload);
    Logger.log(`送付成功 ${preview.invoiceId}: ${JSON.stringify(response).substring(0, 300)}`);

    SheetUtil.updateRow(this.INVOICE_SHEET, row._rowNumber, {
      'ステータス': '送付済',
      '送付完了日時': new Date(),
    });

    return {
      invoiceId: preview.invoiceId,
      clientName: preview.clientName,
      to: preview.toAddress,
      cc: preview.ccAddress,
      bcc: preview.bccAddress,
    };
  },

  /**
   * freee /iv/sendings の payload を構築
   * @return {object}
   */
  buildSendingPayload: function(preview) {
    const companyId = Config.getNumber('FREEE_COMPANY_ID');
    const toEmails = [preview.toAddress];
    if (preview.ccAddress) toEmails.push(preview.ccAddress); // freee の API 仕様に応じて要修正
    return {
      company_id: companyId,
      sending_type: 'email',
      invoice_id: Number(preview.freeeInvoiceId),
      to_emails: [preview.toAddress],
      cc_emails: preview.ccAddress ? [preview.ccAddress] : [],
      bcc_emails: preview.bccAddress ? [preview.bccAddress] : [],
      subject: preview.subject,
      body: preview.body,
    };
  },

  /**
   * 一括送付
   */
  sendAllPending: function(dryRun) {
    const lock = LockService.getDocumentLock();
    if (!lock.tryLock(60000)) throw new Error('他の処理が実行中です');

    try {
      const targets = this.getPendingMails();
      if (targets.length === 0) {
        return { sent: [], skipped: [], failed: [], total: 0, dryRun: !!dryRun };
      }

      const sent = [];
      const skipped = [];
      const failed = [];

      targets.forEach(t => {
        if (t.skipReason) {
          skipped.push({ invoiceId: t.invoiceId, clientName: t.clientName, reason: t.skipReason });
          return;
        }
        try {
          const result = this._sendOne(t, !!dryRun);
          sent.push(result);
        } catch (e) {
          Logger.log(`送付失敗 ${t.invoiceId}: ${e.message}`);
          failed.push({ invoiceId: t.invoiceId, clientName: t.clientName, error: e.message });
        }
        Utilities.sleep(500);
      });

      Notifier.slack(
        `請求書メール${dryRun ? '送付(ドライラン)' : '送付'}: ` +
        `成功 ${sent.length}件, スキップ ${skipped.length}件, 失敗 ${failed.length}件 / 合計 ${targets.length}件`
      );

      return {
        sent: sent,
        skipped: skipped,
        failed: failed,
        total: targets.length,
        dryRun: !!dryRun,
      };
    } finally {
      lock.releaseLock();
    }
  },

  // --- ヘルパー ---

  _render: function(template, vars) {
    return Object.keys(vars).reduce((acc, key) => acc.split(key).join(vars[key]), template);
  },

  _buildInvoiceSubject: function(template, yearMonth) {
    const parts = String(yearMonth).split('-');
    return String(template || '')
      .replace('{年}', parts[0] || '')
      .replace('{月}', parts[1] || '');
  },

  _dueDateString: function(yearMonth, terms) {
    const parts = String(yearMonth).split('-');
    const y = Number(parts[0]);
    const m = Number(parts[1]);
    const t = String(terms || '');
    const months = t.indexOf('翌々月') !== -1 ? 2 : 1;
    const date = new Date(y, m + months, 0);
    return Utilities.formatDate(date, 'JST', 'yyyy年MM月dd日');
  },
};

/**
 * メニューから呼ばれる: 送付プレビュー
 */
function previewInvoiceMails() {
  const ui = SpreadsheetApp.getUi();
  try {
    const targets = InvoiceMail.getPendingMails();
    if (targets.length === 0) {
      ui.alert('メール送付プレビュー', '送付対象がありません。', ui.ButtonSet.OK);
      return;
    }

    const senderEmail = Session.getActiveUser().getEmail();
    const senderName = UserMapping.getDisplayName(senderEmail) || senderEmail;

    const lines = targets.map((t, i) => {
      const skip = t.skipReason ? ` [スキップ: ${t.skipReason}]` : '';
      return `${i + 1}. ${t.clientName} ${t.yearMonth}\n` +
             `   宛先: ${t.toAddress || '(未設定)'} ${t.ccAddress ? '/ Cc:' + t.ccAddress : ''}${skip}\n` +
             `   件名: ${t.subject}\n` +
             `   税込: ¥${t.total.toLocaleString()} 期日: ${t.dueDate}`;
    }).join('\n\n');

    const msg = `スプレッドシート操作者: ${senderEmail} (表示名: ${senderName})\n` +
                `差出人: freee に登録された送信元メールアドレス\n` +
                `対象: ${targets.length}件\n\n` + lines;
    Logger.log(msg);
    ui.alert('メール送付プレビュー', msg, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('プレビュー エラー', e.message, ui.ButtonSet.OK);
  }
}

/**
 * メニューから呼ばれる: ドライラン (実送信なし)
 */
function dryRunSendInvoiceMails() {
  const ui = SpreadsheetApp.getUi();
  try {
    const result = InvoiceMail.sendAllPending(true);
    let msg = `ドライラン完了\n\n` +
              `対象: ${result.total}件\n` +
              `payload構築 成功: ${result.sent.length}件\n` +
              `スキップ: ${result.skipped.length}件\n` +
              `失敗: ${result.failed.length}件\n\n` +
              `freee API は呼んでいません。\n` +
              `各payloadは Apps Script の実行ログを確認してください。`;
    if (result.failed.length > 0) {
      msg += '\n\n失敗:\n' + result.failed.map(f => `- ${f.clientName}: ${f.error}`).join('\n');
    }
    ui.alert('ドライラン結果', msg, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('ドライラン エラー', e.message, ui.ButtonSet.OK);
  }
}

/**
 * メニューから呼ばれる: 本番メール送付 (freee API 経由)
 */
function sendInvoiceMails() {
  const ui = SpreadsheetApp.getUi();
  let targets;
  try {
    targets = InvoiceMail.getPendingMails();
  } catch (e) {
    ui.alert('送付エラー', e.message, ui.ButtonSet.OK);
    return;
  }

  const sendable = targets.filter(t => !t.skipReason);
  if (sendable.length === 0) {
    ui.alert('一括メール送付', '送付対象がありません。', ui.ButtonSet.OK);
    return;
  }

  let confirmMsg = `freee 経由で取引先にメール送付します。\n\n` +
                   `送付対象: ${sendable.length}件\n` +
                   sendable.map(t => `- ${t.clientName} → ${t.toAddress}`).join('\n') +
                   '\n\nこの操作は freee 経由で実メールが送信されます。\n本当に実行しますか?';

  const confirm = ui.alert('一括メール送付 確認', confirmMsg, ui.ButtonSet.YES_NO);
  if (confirm !== ui.Button.YES) return;

  try {
    const result = InvoiceMail.sendAllPending(false);
    const allOk = result.failed.length === 0 && result.sent.length > 0;
    const allFailed = result.sent.length === 0 && result.failed.length > 0;
    const title = allOk ? '一括メール送付 完了' : (allFailed ? '一括メール送付 失敗' : '一括メール送付 一部成功');

    let msg = `対象: ${result.total}件\n` +
              `送信成功: ${result.sent.length}件\n` +
              `スキップ: ${result.skipped.length}件\n` +
              `送信失敗: ${result.failed.length}件`;
    if (result.sent.length > 0) {
      msg += '\n\n送信成功:\n' + result.sent.map(s => `- ${s.clientName} → ${s.to}`).join('\n');
    }
    if (result.skipped.length > 0) {
      msg += '\n\nスキップ:\n' + result.skipped.map(s => `- ${s.clientName}: ${s.reason}`).join('\n');
    }
    if (result.failed.length > 0) {
      msg += '\n\n失敗:\n' + result.failed.map(f => `- ${f.clientName}: ${f.error}`).join('\n');
    }
    ui.alert(title, msg, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('一括メール送付 エラー', e.message, ui.ButtonSet.OK);
  }
}
