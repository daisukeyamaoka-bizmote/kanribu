/**
 * 請求書発行フロー (ステップ3 C-1)
 *
 * 承認済の請求行を freee 請求書 API で発行し、ステータスを 発行済 に進める。
 * - 安全策: dryRun フラグで freee 連携をスキップして payload だけログ出力できる
 * - 同時実行防止のため LockService で排他
 * - 既発行(発行済以降)はスキップ
 *
 * ステップ3 C-2 で PDF Drive 保存、C-3 でメール送付を追加する。
 */
const InvoiceIssue = {
  INVOICE_SHEET: '03_請求一覧',
  LINE_ITEM_SHEET: '03b_請求明細',
  CLIENT_MASTER_SHEET: '01_クライアントマスタ',

  /**
   * 承認済の請求行を一覧で取得 (発行対象のプレビュー用)
   * @return {Array<object>} 各行の発行プレビュー情報
   */
  getApprovedInvoices: function() {
    const allInvoices = SheetUtil.readAsObjects(this.INVOICE_SHEET, 1, 3);
    const approved = allInvoices.filter(r => String(r['ステータス'] || '').trim() === '承認済');

    if (approved.length === 0) return [];

    const clients = SheetUtil.readAsObjects(this.CLIENT_MASTER_SHEET, 1, 3);
    const clientMap = {};
    clients.forEach(c => clientMap[c['クライアントID']] = c);

    const allLineItems = SheetUtil.readAsObjects(this.LINE_ITEM_SHEET, 1, 3);

    return approved.map(r => {
      const yearMonth = normalizeYearMonth(r['対象月']);
      const client = clientMap[r['クライアントID']] || {};
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

      const issueDate = this._lastDayOfMonth(yearMonth);
      const dueDate = this._dueDateFromTerms(yearMonth, client['支払サイト']);

      return {
        invoiceId: r['請求ID'],
        rowNumber: r._rowNumber,
        yearMonth: yearMonth,
        clientId: r['クライアントID'],
        clientName: client['企業名'] || r['クライアントID'],
        partnerId: client['freee取引先ID'] ? Number(client['freee取引先ID']) : null,
        subject: this._buildSubject(client['件名テンプレ'] || '', yearMonth),
        subtotal: Number(r['税抜金額']) || 0,
        tax: Number(r['消費税']) || 0,
        total: Number(r['税込金額']) || 0,
        issueDate: Utilities.formatDate(issueDate, 'JST', 'yyyy-MM-dd'),
        dueDate: Utilities.formatDate(dueDate, 'JST', 'yyyy-MM-dd'),
        lineItems: lineItems,
        validation: this._validate(client, lineItems),
      };
    });
  },

  /**
   * 一括発行 (承認済を全件)
   * @param {boolean} dryRun - true なら freee API を呼ばずに payload をログ出力
   */
  issueAllApproved: function(dryRun) {
    const lock = LockService.getDocumentLock();
    if (!lock.tryLock(60000)) throw new Error('他の処理が実行中です。少し時間を置いて再度お試しください。');

    try {
      const approved = this.getApprovedInvoices();
      if (approved.length === 0) return { issued: [], failed: [], total: 0, dryRun: !!dryRun };

      const issued = [];
      const failed = [];
      approved.forEach(inv => {
        try {
          const result = this._issueOne(inv, !!dryRun);
          issued.push(result);
        } catch (e) {
          Logger.log(`発行失敗 ${inv.invoiceId}: ${e.message}`);
          failed.push({ invoiceId: inv.invoiceId, clientName: inv.clientName, error: e.message });
        }
        Utilities.sleep(300); // freee API rate limit
      });

      Notifier.slack(
        `請求書${dryRun ? '発行(ドライラン)' : '発行'} 完了: ` +
        `成功 ${issued.length}件, 失敗 ${failed.length}件 / 合計 ${approved.length}件`
      );

      return {
        issued: issued,
        failed: failed,
        total: approved.length,
        dryRun: !!dryRun,
      };
    } finally {
      lock.releaseLock();
    }
  },

  /**
   * 1件発行(内部)
   * @param {object} preview - getApprovedInvoices() の1要素
   * @param {boolean} dryRun
   * @private
   */
  _issueOne: function(preview, dryRun) {
    if (preview.validation.errors.length > 0) {
      throw new Error('検証エラー: ' + preview.validation.errors.join(', '));
    }

    // 最新ステータスを再取得 (発行直前の差し戻し検知)
    const allRows = SheetUtil.readAsObjects(this.INVOICE_SHEET, 1, 3);
    const row = allRows.find(r => r['請求ID'] === preview.invoiceId);
    if (!row) throw new Error(`請求が見つかりません: ${preview.invoiceId}`);
    const status = String(row['ステータス'] || '').trim();
    if (status !== '承認済') throw new Error(`ステータスが承認済ではありません (${status})`);

    const payload = this.buildInvoicePayload(preview);

    if (dryRun) {
      Logger.log(`[dryRun] ${preview.invoiceId} payload:\n${JSON.stringify(payload, null, 2)}`);
      return {
        invoiceId: preview.invoiceId,
        clientName: preview.clientName,
        dryRun: true,
        payload: payload,
      };
    }

    const response = FreeeClient.createInvoice(payload);
    if (!response) throw new Error('freee API レスポンスが空です');

    // 旧APIは {invoice: {id, deal_id, ...}} 、新APIは直接 {id, deal_id, ...} の可能性があるため両対応
    const inv = response.invoice || response;
    const freeeInvoiceId = inv.id;
    const freeeDealId = inv.deal_id || (response.deal && response.deal.id) || '';

    if (!freeeInvoiceId) {
      throw new Error('freee API レスポンスから請求書ID を取得できません: ' + JSON.stringify(response).substring(0, 500));
    }

    SheetUtil.updateRow(this.INVOICE_SHEET, row._rowNumber, {
      'ステータス': '発行済',
      'freee請求書ID': freeeInvoiceId,
      'freee deal_id': freeeDealId,
    });

    Logger.log(`発行成功 ${preview.invoiceId} → freee invoice ${freeeInvoiceId}, deal ${freeeDealId || '(none)'}`);

    return {
      invoiceId: preview.invoiceId,
      clientName: preview.clientName,
      freeeInvoiceId: freeeInvoiceId,
      freeeDealId: freeeDealId || null,
    };
  },

  /**
   * freee 請求書 API の payload を構築
   * @param {object} preview - getApprovedInvoices() の1要素
   * @return {object} freee API へのリクエスト本体
   */
  buildInvoicePayload: function(preview) {
    const companyId = Config.getNumber('FREEE_COMPANY_ID');
    const templateId = Config.getNumber('FREEE_INVOICE_TEMPLATE_ID');
    const accountItemSales = Config.getNumber('ACCOUNT_ITEM_SALES');
    const taxCode10 = Config.getNumber('TAX_CODE_10');
    // 任意指定可能な設定 (スクリプトプロパティで上書き可)
    // tax_entry_method: 'in' (内税) / 'out' (外税) — bizmote は税抜入力なので 'out'
    // tax_fraction:     'round' (四捨五入) / 'truncate' (切捨) / 'ceil' (切上)
    // withholding_tax_entry_method: 'in' / 'out' (源泉徴収の表示方式)
    //   bizmote は源泉徴収なし(B2B) のため、どちらでも金額は0になるが 'out' を既定に
    const taxEntryMethod = Config.getOrDefault('TAX_ENTRY_METHOD', 'out');
    const taxFraction = Config.getOrDefault('TAX_FRACTION', 'round');
    const withholdingTaxEntryMethod = Config.getOrDefault('WITHHOLDING_TAX_ENTRY_METHOD', 'out');
    const partnerTitle = Config.getOrDefault('PARTNER_TITLE', '御中');

    const lines = preview.lineItems.map((li, i) => {
      const subtotal = li.unitPrice * li.quantity;
      return {
        order: i + 1,
        // freee 新APIの type: 'item'(明細行) / 'text'(テキスト行)
        type: 'item',
        qty: li.quantity,
        unit_price: li.unitPrice,
        vat: Math.round(subtotal * (li.taxRate / 100)),
        description: li.itemName,
        account_item_id: accountItemSales,
        tax_code: taxCode10,
      };
    });

    return {
      company_id: companyId,
      issue_date: preview.issueDate,
      billing_date: preview.issueDate,
      due_date: preview.dueDate,
      partner_id: preview.partnerId,
      partner_title: partnerTitle,
      subject: preview.subject,
      template_id: templateId,
      tax_entry_method: taxEntryMethod,
      tax_fraction: taxFraction,
      withholding_tax_entry_method: withholdingTaxEntryMethod,
      deal_attributes: {
        create_deal: true,
        issue_date: preview.issueDate,
        due_date: preview.dueDate,
      },
      lines: lines,
    };
    // 注:
    // - memo は空だと freee が400を返す(less_than_min_length)。必要時に呼び出し側で payload.memo を追加
    // - tax_entry_method / tax_fraction / withholding_tax_entry_method / partner_title は
    //   スクリプトプロパティで上書き可。デフォルトは exclusive / round / off / 御中
  },

  /**
   * 件名テンプレートの {年} {月} を置換
   * @private
   */
  _buildSubject: function(template, yearMonth) {
    const parts = String(yearMonth).split('-');
    return String(template || '')
      .replace('{年}', parts[0] || '')
      .replace('{月}', parts[1] || '');
  },

  /**
   * 対象月の月末日(JST)
   * @private
   */
  _lastDayOfMonth: function(yearMonth) {
    const parts = String(yearMonth).split('-');
    const y = Number(parts[0]);
    const m = Number(parts[1]);
    return new Date(y, m, 0); // m月の0日目 = m月末
  },

  /**
   * 支払期日を支払サイト文字列から計算
   * - 「翌々月」を含む → 翌々月末
   * - それ以外 → 翌月末 (デフォルト)
   * @private
   */
  _dueDateFromTerms: function(yearMonth, terms) {
    const parts = String(yearMonth).split('-');
    const y = Number(parts[0]);
    const m = Number(parts[1]);
    const t = String(terms || '');
    const months = t.indexOf('翌々月') !== -1 ? 2 : 1;
    return new Date(y, m + months, 0); // (m + N)月の0日 = m+N-1月末
  },

  /**
   * 検証(発行前チェック)
   * @private
   */
  _validate: function(client, lineItems) {
    const errors = [];
    if (!client['freee取引先ID']) errors.push('freee取引先IDが未設定');
    if (lineItems.length === 0) errors.push('明細がありません');
    lineItems.forEach((li, i) => {
      if (!li.itemName) errors.push(`明細${i + 1}: 品目名が空`);
      if (li.unitPrice <= 0 && li.quantity > 0) errors.push(`明細${i + 1}: 単価が0`);
    });
    return { errors: errors, ok: errors.length === 0 };
  },
};

/**
 * メニューから呼ばれる: 承認済の請求書 発行プレビュー (freee API は呼ばない)
 */
function previewApprovedIssuance() {
  const ui = SpreadsheetApp.getUi();
  try {
    const previews = InvoiceIssue.getApprovedInvoices();
    if (previews.length === 0) {
      ui.alert('発行プレビュー', '承認済の請求はありません。', ui.ButtonSet.OK);
      return;
    }

    let total = 0;
    const lines = [];
    let hasError = false;
    previews.forEach((p, i) => {
      total += p.total;
      const errMark = p.validation.errors.length > 0 ? ' [エラー: ' + p.validation.errors.join(', ') + ']' : '';
      if (p.validation.errors.length > 0) hasError = true;
      lines.push(
        `${i + 1}. ${p.clientName}\n` +
        `   ${p.yearMonth} | ${p.subject}\n` +
        `   税込¥${p.total.toLocaleString()} (発行${p.issueDate} / 期日${p.dueDate})${errMark}`
      );
    });

    const msg = `発行対象: ${previews.length}件 (合計税込 ¥${total.toLocaleString()})\n\n` +
                lines.join('\n\n') +
                (hasError ? '\n\n※ エラーがある行は本番発行時にスキップされます' : '');

    Logger.log(msg);
    ui.alert('発行プレビュー', msg, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('発行プレビュー エラー', e.message, ui.ButtonSet.OK);
  }
}

/**
 * メニューから呼ばれる: ドライラン (freee に何も送らず、payload を実行ログに出力)
 */
function dryRunIssueApproved() {
  const ui = SpreadsheetApp.getUi();
  try {
    const result = InvoiceIssue.issueAllApproved(true);
    const msg = `ドライラン完了\n\n` +
                `対象: ${result.total}件\n` +
                `payload構築 成功: ${result.issued.length}件\n` +
                `失敗: ${result.failed.length}件\n\n` +
                `freee API は呼んでいません。\n` +
                `各payloadは Apps Script の実行ログ([表示]→[ログ]) で確認してください。`;
    if (result.failed.length > 0) {
      const failMsg = '\n\n失敗内訳:\n' + result.failed.map(f => `- ${f.clientName} (${f.invoiceId}): ${f.error}`).join('\n');
      ui.alert('ドライラン結果', msg + failMsg, ui.ButtonSet.OK);
    } else {
      ui.alert('ドライラン結果', msg, ui.ButtonSet.OK);
    }
  } catch (e) {
    ui.alert('ドライランエラー', e.message, ui.ButtonSet.OK);
  }
}

/**
 * メニューから呼ばれる: 本番発行 (freee API を実際に呼び出す)
 */
function bulkIssueApproved() {
  const ui = SpreadsheetApp.getUi();

  let previews;
  try {
    previews = InvoiceIssue.getApprovedInvoices();
  } catch (e) {
    ui.alert('発行エラー', e.message, ui.ButtonSet.OK);
    return;
  }

  if (previews.length === 0) {
    ui.alert('一括発行', '承認済の請求はありません。', ui.ButtonSet.OK);
    return;
  }

  const total = previews.reduce((s, p) => s + p.total, 0);
  const errors = previews.filter(p => p.validation.errors.length > 0);

  let confirmMsg = `freee に ${previews.length}件 の請求書を発行します。\n` +
                   `合計税込 ¥${total.toLocaleString()}\n\n`;
  if (errors.length > 0) {
    confirmMsg += `※ ${errors.length}件 にエラーがあります(スキップされます)\n\n`;
  }
  confirmMsg += `この操作は freee 側に実データを作ります。\n本当に実行しますか?`;

  const confirm = ui.alert('一括発行 確認', confirmMsg, ui.ButtonSet.YES_NO);
  if (confirm !== ui.Button.YES) return;

  try {
    const result = InvoiceIssue.issueAllApproved(false);
    const allFailed = result.issued.length === 0 && result.failed.length > 0;
    const allOk = result.failed.length === 0 && result.issued.length > 0;
    const title = allFailed ? '一括発行 失敗' : (allOk ? '一括発行 完了' : '一括発行 一部成功');

    let msg = `対象: ${result.total}件\n` +
              `成功: ${result.issued.length}件\n` +
              `失敗: ${result.failed.length}件`;
    if (result.issued.length > 0) {
      msg += '\n\n発行成功:\n' + result.issued.map(i => `- ${i.clientName}: freee請求書ID ${i.freeeInvoiceId}`).join('\n');
    }
    if (result.failed.length > 0) {
      msg += '\n\n失敗内訳:\n' + result.failed.map(f => `- ${f.clientName} (${f.invoiceId}): ${f.error}`).join('\n');
    }
    ui.alert(title, msg, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('一括発行 エラー', e.message, ui.ButtonSet.OK);
  }
}
