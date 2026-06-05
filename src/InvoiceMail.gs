/**
 * 請求書メール送付フロー (ステップ3 C-3) — 自前PDF + Gmail版
 *
 * - 対象: ステータス=発行済 + 送付完了日時 が空 + 送付方法=メール の請求書
 * - PDFは GAS 側で HTML テンプレートから自動生成(InvoicePdfBuilder)
 *   freee API は PDF ダウンロードを公式に提供していないため、自前で組み立てる
 * - 送信は Gmail (GmailApp.sendEmail) で from オプション指定 — 誰が実行しても
 *   PREFERRED_SENDER_EMAIL (樋口 miku.higuchi@bizmote.jp) から送信される
 * - 送信成功後 ステータス→送付済 + 送付完了日時を記録
 * - dryRun フラグで実送信せず本文をログ出力のみに切替可能
 *
 * 差出人:
 *   PREFERRED_SENDER_EMAIL (Config) を from に指定して送信。
 *   実行者の Gmail に送信元エイリアスとして登録されている必要がある
 *   (Gmail 設定 → アカウントとインポート → 「他のメールアドレスを追加」)。
 */
const InvoiceMail = {
  INVOICE_SHEET: '03_請求一覧',
  CLIENT_MASTER_SHEET: '01_クライアントマスタ',
  LINE_ITEM_SHEET: '03b_請求明細',

  SUBJECT_TEMPLATE: '【{年}/{月}分 ご請求書】{件名}',

  BODY_TEMPLATE:
    '{To担当者名}\n' +
    '\n' +
    'いつも大変お世話になっております。\n' +
    'bizmote株式会社 {送信者表示名}です。\n' +
    '\n' +
    '{年}年{月}月分のご請求書を添付にてお送りいたします。\n' +
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

    const allLineItems = SheetUtil.readAsObjects(this.LINE_ITEM_SHEET, 1, 3);

    const executor = Session.getActiveUser().getEmail();
    const senderEmail = Config.getOrDefault('PREFERRED_SENDER_EMAIL', '') || executor;
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

      const subtotal = Number(r['税抜金額']) || 0;
      const tax = Number(r['消費税']) || 0;
      const total = Number(r['税込金額']) || 0;
      const dueDate = this._dueDateString(yearMonth, client['支払サイト']);
      const issueDate = Utilities.formatDate(new Date(), 'JST', 'yyyy年MM月dd日');

      const lineItems = allLineItems
        .filter(li => li['請求ID'] === r['請求ID'])
        .sort((a, b) => (Number(a['行No']) || 0) - (Number(b['行No']) || 0))
        .map(li => ({
          itemName: li['品目名'] || '',
          unitPrice: Number(li['単価(税抜)']) || 0,
          quantity: Number(li['数量']) || 0,
          taxRate: Number(li['税率']) || 10,
          subtotal: Number(li['小計(税抜)']) || 0,
        }));

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

      const partnerAddress = [client['住所(郵便番号)'], client['住所']]
        .filter(s => s)
        .map(s => String(s).trim())
        .join(' ');

      return {
        invoiceId: r['請求ID'],
        rowNumber: r._rowNumber,
        freeeInvoiceId: r['freee請求書ID'],
        yearMonth: yearMonth,
        clientId: r['クライアントID'],
        clientName: client['企業名'] || r['クライアントID'],
        partnerAddress: partnerAddress,
        toName: client['To担当者名'] || '',
        toAddress: toAddress,
        ccAddress: ccAddress,
        bccAddress: bccAddress,
        subject: subject,
        body: body,
        invoiceSubject: invoiceSubject,
        lineItems: lineItems,
        subtotal: subtotal,
        tax: tax,
        total: total,
        biko: String(r['備考'] || '').trim(),
        issueDate: issueDate,
        dueDate: dueDate,
        sendMethod: sendMethod,
        skipReason: skipReason,
        senderEmail: senderEmail,
        senderName: senderName,
      };
    });
  },

  /**
   * 1件のメールを送付 (内部)
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

    if (dryRun) {
      Logger.log(
        `[dryRun] ${preview.invoiceId}\n` +
        `To: ${preview.toAddress}\nCc: ${preview.ccAddress}\nBcc: ${preview.bccAddress}\n` +
        `Subject: ${preview.subject}\n\n${preview.body}`
      );
      return {
        invoiceId: preview.invoiceId,
        clientName: preview.clientName,
        dryRun: true,
        to: preview.toAddress,
      };
    }

    // PDF 生成
    const pdfBlob = InvoicePdfBuilder.build({
      invoiceNumber: preview.invoiceId,
      partnerName: preview.clientName,
      partnerAddress: preview.partnerAddress,
      issueDate: preview.issueDate,
      dueDate: preview.dueDate,
      subject: preview.invoiceSubject,
      lineItems: preview.lineItems,
      subtotal: preview.subtotal,
      tax: preview.tax,
      total: preview.total,
      biko: preview.biko,
      companyName: Config.getOrDefault('COMPANY_NAME', 'bizmote株式会社'),
      companyZip: Config.getOrDefault('COMPANY_ZIP', ''),
      companyAddress: Config.getOrDefault('COMPANY_ADDRESS', ''),
      companyRegNo: Config.getOrDefault('COMPANY_INVOICE_REGISTRATION_NUMBER', 'T9011001154271'),
      bankInfo: Config.getOrDefault('BANK_INFO', ''),
    });
    const fileName = this._buildFileName(preview.clientName, preview.yearMonth, preview.invoiceId);
    pdfBlob.setName(fileName);

    // CC に取引先CC + 強制CC(山岡)を併記。重複と To と同一アドレスは除外
    const forcedCc = Config.getOrDefault('FORCED_CC_EMAIL', '').trim();
    const ccList = [];
    if (preview.ccAddress) ccList.push(preview.ccAddress);
    if (forcedCc && forcedCc !== preview.toAddress) ccList.push(forcedCc);
    const cc = ccList
      .map(s => String(s).trim())
      .filter(s => s)
      .filter((v, i, a) => a.indexOf(v) === i)
      .join(',');

    // 「誰が実行しても miku.higuchi(樋口)から送信」させるため GmailApp.sendEmail の
     // from オプションを使う。実行者の Gmail で送信元エイリアスとして登録済みである必要がある。
    const forcedSender = Config.getOrDefault('PREFERRED_SENDER_EMAIL', '') ||
                         Session.getActiveUser().getEmail();
    const options = {
      attachments: [pdfBlob],
      from: forcedSender,
      name: preview.senderName + ' (bizmote株式会社)',
    };
    if (cc) options.cc = cc;
    if (preview.bccAddress) options.bcc = preview.bccAddress;

    try {
      GmailApp.sendEmail(preview.toAddress, preview.subject, preview.body, options);
    } catch (e) {
      // 送信元エイリアスが実行者の Gmail に登録されていないと freee 認証とは別のエラーが出る
      const msg = String(e.message || '');
      if (/from|alias|sender|delegated/i.test(msg)) {
        const exec = Session.getActiveUser().getEmail();
        throw new Error(
          `${forcedSender} を実行者(${exec})の Gmail で「送信元アドレス(別アドレスでメールを送信)」として登録してください。\n` +
          `Gmail → 設定 → アカウントとインポート → 「他のメールアドレスを追加」で ${forcedSender} を追加し、確認メールを承認すると有効になります。\n\n` +
          `元エラー: ${msg}`
        );
      }
      throw e;
    }

    SheetUtil.updateRow(this.INVOICE_SHEET, row._rowNumber, {
      'ステータス': '送付済',
      '送付完了日時': new Date(),
    });

    Logger.log(`メール送付成功 ${preview.invoiceId} → ${preview.toAddress}`);

    return {
      invoiceId: preview.invoiceId,
      clientName: preview.clientName,
      yearMonth: preview.yearMonth,
      total: preview.total,
      to: preview.toAddress,
      cc: preview.ccAddress,
      bcc: preview.bccAddress,
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

      // メール送付完了通知 (実送信のみ・送付できた請求書一覧を投稿)。
      // ドライラン / 送付ゼロ件 / 失敗のみ の場合は通知しない。
      if (!dryRun && sent.length > 0) {
        const mentionId = Config.getOrDefault('SLACK_MENTION_USER_ID', '').trim();
        const mention = mentionId ? `<@${mentionId}> ` : '';
        const list = sent.map(s =>
          `- ${s.clientName} ${s.yearMonth} 税込¥${Number(s.total || 0).toLocaleString()} → ${s.to}`
        ).join('\n');
        Notifier.slack(`${mention}請求書メール送付完了 (${sent.length}件)\n${list}`);
      }

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

  /**
   * 選択行の請求書プレビュー用 HTML を返す(PDFと同じ見た目)
   */
  buildPreviewHtmlForSelectedRow: function() {
    const sheet = SpreadsheetApp.getActiveSheet();
    if (sheet.getName() !== this.INVOICE_SHEET) {
      throw new Error('03_請求一覧 シートを開いてから対象行を選択してください');
    }
    const row = sheet.getActiveRange().getRow();
    if (row < 3) throw new Error('データ行(3行目以降)を選択してください');

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const idCol = headers.indexOf('請求ID');
    const invoiceId = sheet.getRange(row, idCol + 1).getValue();
    if (!invoiceId) throw new Error('請求IDが空です');

    const allRows = SheetUtil.readAsObjects(this.INVOICE_SHEET, 1, 3);
    const r = allRows.find(x => x['請求ID'] === invoiceId);
    if (!r) throw new Error(`請求が見つかりません: ${invoiceId}`);

    const clients = SheetUtil.readAsObjects(this.CLIENT_MASTER_SHEET, 1, 3);
    const client = clients.find(c => c['クライアントID'] === r['クライアントID']) || {};
    const allLineItems = SheetUtil.readAsObjects(this.LINE_ITEM_SHEET, 1, 3);
    const lineItems = allLineItems
      .filter(li => li['請求ID'] === r['請求ID'])
      .sort((a, b) => (Number(a['行No']) || 0) - (Number(b['行No']) || 0))
      .map(li => ({
        itemName: li['品目名'] || '',
        unitPrice: Number(li['単価(税抜)']) || 0,
        quantity: Number(li['数量']) || 0,
        taxRate: Number(li['税率']) || 10,
        subtotal: Number(li['小計(税抜)']) || 0,
      }));

    const yearMonth = normalizeYearMonth(r['対象月']);
    const partnerAddress = [client['住所(郵便番号)'], client['住所']]
      .filter(s => s).map(s => String(s).trim()).join(' ');

    return InvoicePdfBuilder.buildHtml({
      invoiceNumber: invoiceId,
      partnerName: client['企業名'] || r['クライアントID'],
      partnerAddress: partnerAddress,
      issueDate: Utilities.formatDate(new Date(), 'JST', 'yyyy年MM月dd日'),
      dueDate: this._dueDateString(yearMonth, client['支払サイト']),
      subject: this._buildInvoiceSubject(client['件名テンプレ'] || '', yearMonth),
      lineItems: lineItems,
      subtotal: Number(r['税抜金額']) || 0,
      tax: Number(r['消費税']) || 0,
      total: Number(r['税込金額']) || 0,
      biko: String(r['備考'] || '').trim(),
      companyName: Config.getOrDefault('COMPANY_NAME', 'bizmote株式会社'),
      companyZip: Config.getOrDefault('COMPANY_ZIP', ''),
      companyAddress: Config.getOrDefault('COMPANY_ADDRESS', ''),
      companyRegNo: Config.getOrDefault('COMPANY_INVOICE_REGISTRATION_NUMBER', 'T9011001154271'),
      bankInfo: Config.getOrDefault('BANK_INFO', ''),
    });
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

  _buildFileName: function(clientName, yearMonth, invoiceId) {
    const cleanName = String(clientName).replace(/[\\\/:*?"<>|]/g, '_').trim();
    return `${cleanName}_${yearMonth}_請求書_${invoiceId}.pdf`;
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

    const executor = Session.getActiveUser().getEmail();
    const senderEmail = Config.getOrDefault('PREFERRED_SENDER_EMAIL', '') || executor;
    const senderName = UserMapping.getDisplayName(senderEmail) || senderEmail;

    const lines = targets.map((t, i) => {
      const skip = t.skipReason ? ` [スキップ: ${t.skipReason}]` : '';
      return `${i + 1}. ${t.clientName} ${t.yearMonth}\n` +
             `   宛先: ${t.toAddress || '(未設定)'} ${t.ccAddress ? '/ Cc:' + t.ccAddress : ''}${skip}\n` +
             `   件名: ${t.subject}\n` +
             `   税込: ¥${t.total.toLocaleString()} 期日: ${t.dueDate}`;
    }).join('\n\n');

    const msg = `差出人: ${senderEmail} (表示名: ${senderName} / 実行者: ${executor})\n` +
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
              `成功(構築): ${result.sent.length}件\n` +
              `スキップ: ${result.skipped.length}件\n` +
              `失敗: ${result.failed.length}件\n\n` +
              `実送信は行っていません。\n` +
              `各メール本文は Apps Script の実行ログをご確認ください。`;
    if (result.failed.length > 0) {
      msg += '\n\n失敗:\n' + result.failed.map(f => `- ${f.clientName}: ${f.error}`).join('\n');
    }
    ui.alert('ドライラン結果', msg, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('ドライラン エラー', e.message, ui.ButtonSet.OK);
  }
}

/**
 * メニューから呼ばれる: 本番メール送付
 */
function sendInvoiceMails() {
  const ui = SpreadsheetApp.getUi();

  // 誰が実行しても PREFERRED_SENDER_EMAIL (樋口) から送信される
  const executor = Session.getActiveUser().getEmail();
  const forcedSender = Config.getOrDefault('PREFERRED_SENDER_EMAIL', '') || executor;

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

  const dailyQuota = MailApp.getRemainingDailyQuota();
  const forcedCc = Config.getOrDefault('FORCED_CC_EMAIL', '');

  let confirmMsg = `差出人: ${forcedSender} (実行者: ${executor})\n` +
                   `送信可能件数(本日残): ${dailyQuota}\n` +
                   (forcedCc ? `常時CC: ${forcedCc}\n` : '') +
                   `\n送付対象: ${sendable.length}件\n` +
                   sendable.map(t => `- ${t.clientName} → ${t.toAddress}`).join('\n');
  if (sendable.length > dailyQuota) {
    confirmMsg += `\n\n警告: 送信枠 (${dailyQuota}通) を超えています!`;
  }
  confirmMsg += '\n\n実際にメールを送信します。よろしいですか?';

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

/**
 * メニューから呼ばれる: 選択行の請求書を HTML プレビュー(モーダル)
 * メール送付前に「実際にどう見えるか」を目視確認するための機能
 */
function previewSelectedRowPdf() {
  const ui = SpreadsheetApp.getUi();
  try {
    const html = InvoiceMail.buildPreviewHtmlForSelectedRow();
    const output = HtmlService.createHtmlOutput(html).setWidth(900).setHeight(700);
    ui.showModalDialog(output, '請求書プレビュー(送付されるPDFのレイアウト)');
  } catch (e) {
    ui.alert('PDFプレビュー エラー', e.message, ui.ButtonSet.OK);
  }
}
