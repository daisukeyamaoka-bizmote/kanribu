/**
 * オーナー入力フォーム (InputForm.html) の連携API
 *
 * HTML の google.script.run から呼ばれるグローバル関数群を
 * このファイル下部にエクスポートする (関数名がそのままRPC名になる)。
 */
const InputFormApi = {
  INVOICE_SHEET: '03_請求一覧',
  LINE_ITEM_SHEET: '03b_請求明細',
  CLIENT_MASTER_SHEET: '01_クライアントマスタ',
  ITEM_TEMPLATE_SHEET: '02_品目テンプレート',

  /**
   * 現在のユーザの入力待ち請求を取得
   * - 「未入力」「差戻」ステータスのみ
   * - 案件オーナーが現在のユーザの表示名と一致するもののみ
   */
  getMyPendingInvoices: function() {
    const userEmail = Session.getActiveUser().getEmail();
    const ownerName = UserMapping.getDisplayName(userEmail);
    if (!ownerName) {
      throw new Error(
        `ユーザ "${userEmail}" がマッピングに登録されていません。\n` +
        `99b_ユーザマッピング シートに行を追加してください。\n` +
        `(空欄の場合: GASで Session.getActiveUser().getEmail() が空文字を返しています。Apps Script の権限を再承認してください。)`
      );
    }

    // 必要なシートを一度だけ読み込む(N+1 回避)
    const allInvoices = SheetUtil.readAsObjects(this.INVOICE_SHEET, 1, 3);
    const allTemplates = SheetUtil.readAsObjects(this.ITEM_TEMPLATE_SHEET, 1, 3);
    const clientMap = this._loadClientMap();

    // 前月実績マップを構築 (クライアントID + yearMonth → 税込金額)
    const lastAmountMap = {};
    allInvoices.forEach(r => {
      const ym = normalizeYearMonth(r['対象月']);
      lastAmountMap[r['クライアントID'] + '|' + ym] = Number(r['税込金額']) || 0;
    });

    // 品目テンプレートをクライアント別にグループ化
    const templateMap = {};
    allTemplates.forEach(t => {
      const id = t['クライアントID'];
      if (!templateMap[id]) templateMap[id] = [];
      templateMap[id].push(t);
    });

    const pending = allInvoices.filter(r => {
      const status = String(r['ステータス'] || '').trim();
      return status === '未入力' || status === '差戻';
    });

    const result = pending
      .filter(r => {
        const client = clientMap[r['クライアントID']];
        if (!client) return false;
        const owner = String(client['案件オーナー'] || '').trim();
        return owner === ownerName;
      })
      .map(r => {
        const client = clientMap[r['クライアントID']];
        const yearMonth = normalizeYearMonth(r['対象月']);
        const lastYearMonth = this._getLastYearMonth(yearMonth);
        const lastKey = r['クライアントID'] + '|' + lastYearMonth;
        const templates = (templateMap[r['クライアントID']] || [])
          .slice()
          .sort((a, b) => (Number(a['行No']) || 0) - (Number(b['行No']) || 0))
          .map(t => ({
            itemName: t['品目名'] || '',
            unitPrice: Number(t['単価(税抜)']) || 0,
            quantity: Number(t['数量']) || 1,
            taxRate: Number(t['税率']) || 10,
            unit: t['単位'] || '',
            kind: t['固定/変動'] || '',
          }));

        return {
          invoiceId: r['請求ID'],
          yearMonth: yearMonth,
          clientId: r['クライアントID'],
          clientName: client['企業名'],
          subjectTemplate: client['件名テンプレ'] || '',
          lastMonthAmount: lastAmountMap[lastKey] || 0,
          templates: templates,
          biko: r['備考'] || '',
          status: String(r['ステータス'] || '').trim(),
          memo: r['メモ'] || '',
        };
      });

    Logger.log(`getMyPendingInvoices: email=${userEmail}, owner=${ownerName}, ` +
               `pending(全体)=${pending.length}, mine=${result.length}`);
    return result;
  },

  /**
   * 入力された明細+備考を保存し、請求一覧のステータスを「入力済」に更新
   * @param {string} invoiceId 例: INV-202605-001
   * @param {Array<{itemName, unitPrice, quantity, taxRate}>} items
   * @param {string} [biko] - 備考(任意。freee請求書の備考欄に転記される)
   * @param {string} [yearMonth] - 対象月 (yyyy-MM)。指定すると 請求ID+対象月 で照合し、
   *   同一請求IDが対象月違いで複数ある場合の誤マッチを防ぐ
   */
  submitInvoiceInput: function(invoiceId, items, biko, yearMonth) {
    if (!invoiceId) throw new Error('請求IDが指定されていません');
    if (!Array.isArray(items) || items.length === 0) throw new Error('明細が空です');

    // 入力検証
    const cleaned = items
      .map(item => ({
        itemName: String(item.itemName || '').trim(),
        unitPrice: Number(item.unitPrice) || 0,
        quantity: Number(item.quantity) || 0,
        taxRate: Number(item.taxRate) || 10,
      }))
      .filter(item => item.itemName !== '' || item.unitPrice !== 0 || item.quantity !== 0);

    if (cleaned.length === 0) throw new Error('有効な明細がありません');

    // ロック取得 (同時提出防止)
    const lock = LockService.getDocumentLock();
    if (!lock.tryLock(10000)) throw new Error('他の処理が実行中です。少し時間を置いて再度お試しください。');

    try {
      const allRows = SheetUtil.readAsObjects(this.INVOICE_SHEET, 1, 3);
      const normalizedYm = yearMonth ? normalizeYearMonth(yearMonth) : null;
      const row = allRows.find(r =>
        r['請求ID'] === invoiceId &&
        (normalizedYm === null || normalizeYearMonth(r['対象月']) === normalizedYm)
      );
      if (!row) throw new Error(`請求が見つかりません: ${invoiceId}${normalizedYm ? ' (対象月: ' + normalizedYm + ')' : ''}`);
      if (['未入力', '差戻'].indexOf(row['ステータス']) === -1) {
        throw new Error(`既に処理済みです (現在のステータス: ${row['ステータス']})`);
      }

      const subtotal = cleaned.reduce((s, item) => s + item.unitPrice * item.quantity, 0);
      const tax = Math.round(subtotal * 0.1);
      const total = subtotal + tax;

      // 既存明細を削除 (差戻からの再入力に対応)
      this._deleteLineItems(invoiceId);

      // 新しい明細を追加
      cleaned.forEach((item, index) => {
        SheetUtil.appendRow(this.LINE_ITEM_SHEET, {
          '請求ID': invoiceId,
          '行No': index + 1,
          '品目名': item.itemName,
          '単価(税抜)': item.unitPrice,
          '数量': item.quantity,
          '税率': item.taxRate,
          '小計(税抜)': item.unitPrice * item.quantity,
        });
      });

      // 請求一覧のステータスを更新
      SheetUtil.updateRow(this.INVOICE_SHEET, row._rowNumber, {
        '税抜金額': subtotal,
        '消費税': tax,
        '税込金額': total,
        'ステータス': '入力済',
        '入力者': Session.getActiveUser().getEmail(),
        '入力日時': new Date(),
        '備考': String(biko || '').trim(),
      });

      return { success: true, invoiceId: invoiceId, subtotal: subtotal, tax: tax, total: total };
    } finally {
      lock.releaseLock();
    }
  },

  /**
   * 前月の同クライアントの明細を取得 (前月コピー機能用)
   */
  /**
   * 前月の備考を取得 (前月コピー機能用)
   */
  getLastMonthBiko: function(clientId, currentYearMonth) {
    const lastYearMonth = this._getLastYearMonth(normalizeYearMonth(currentYearMonth));
    const lastInvoice = SheetUtil.readAsObjects(this.INVOICE_SHEET, 1, 3)
      .find(r => r['クライアントID'] === clientId && normalizeYearMonth(r['対象月']) === lastYearMonth);
    if (!lastInvoice) return '';
    return String(lastInvoice['備考'] || '').trim();
  },

  getLastMonthLineItems: function(clientId, currentYearMonth) {
    const lastYearMonth = this._getLastYearMonth(normalizeYearMonth(currentYearMonth));
    const lastInvoice = SheetUtil.readAsObjects(this.INVOICE_SHEET, 1, 3)
      .find(r => r['クライアントID'] === clientId && normalizeYearMonth(r['対象月']) === lastYearMonth);
    if (!lastInvoice) return [];

    return SheetUtil.readAsObjects(this.LINE_ITEM_SHEET, 1, 3)
      .filter(r => r['請求ID'] === lastInvoice['請求ID'])
      .sort((a, b) => (Number(a['行No']) || 0) - (Number(b['行No']) || 0))
      .map(r => ({
        itemName: r['品目名'] || '',
        unitPrice: Number(r['単価(税抜)']) || 0,
        quantity: Number(r['数量']) || 0,
        taxRate: Number(r['税率']) || 10,
      }));
  },

  /**
   * クライアントID → クライアント情報のマップを構築
   * @private
   */
  _loadClientMap: function() {
    const clients = SheetUtil.readAsObjects(this.CLIENT_MASTER_SHEET, 1, 3);
    const map = {};
    clients.forEach(c => map[c['クライアントID']] = c);
    return map;
  },

  /**
   * クライアントの品目テンプレートを取得 (行No順)
   * @private
   */
  _getItemTemplates: function(clientId) {
    return SheetUtil.readAsObjects(this.ITEM_TEMPLATE_SHEET, 1, 3)
      .filter(r => r['クライアントID'] === clientId)
      .sort((a, b) => (Number(a['行No']) || 0) - (Number(b['行No']) || 0))
      .map(r => ({
        itemName: r['品目名'] || '',
        unitPrice: Number(r['単価(税抜)']) || 0,
        quantity: Number(r['数量']) || 1,
        taxRate: Number(r['税率']) || 10,
        unit: r['単位'] || '',
        kind: r['固定/変動'] || '',
      }));
  },

  /**
   * 前月の税込金額を取得 (なければ0)
   * @private
   */
  _getLastMonthAmount: function(clientId, currentYearMonth) {
    const lastYearMonth = this._getLastYearMonth(normalizeYearMonth(currentYearMonth));
    const lastInvoice = SheetUtil.readAsObjects(this.INVOICE_SHEET, 1, 3)
      .find(r => r['クライアントID'] === clientId && normalizeYearMonth(r['対象月']) === lastYearMonth);
    if (!lastInvoice) return 0;
    return Number(lastInvoice['税込金額']) || 0;
  },

  /**
   * yyyy-MM 形式の前月を返す
   * @private
   */
  _getLastYearMonth: function(yearMonth) {
    const parts = String(yearMonth).split('-');
    const y = Number(parts[0]);
    const m = Number(parts[1]);
    if (m === 1) return `${y - 1}-12`;
    return `${y}-${String(m - 1).padStart(2, '0')}`;
  },

  /**
   * 指定の請求IDに紐づく 03b_請求明細 の行を全削除
   * @private
   */
  _deleteLineItems: function(invoiceId) {
    const sheet = SheetUtil.getSheet(this.LINE_ITEM_SHEET);
    const rows = SheetUtil.readAsObjects(this.LINE_ITEM_SHEET, 1, 3);
    const targetRows = rows.filter(r => r['請求ID'] === invoiceId);
    targetRows.sort((a, b) => b._rowNumber - a._rowNumber).forEach(r => {
      sheet.deleteRow(r._rowNumber);
    });
  },
};

// HTML から呼ばれるグローバル関数 (google.script.run RPC)
function getMyPendingInvoices() {
  return InputFormApi.getMyPendingInvoices();
}
function submitInvoiceInput(invoiceId, items, biko, yearMonth) {
  return InputFormApi.submitInvoiceInput(invoiceId, items, biko, yearMonth);
}
function getLastMonthLineItems(clientId, currentYearMonth) {
  return InputFormApi.getLastMonthLineItems(clientId, currentYearMonth);
}
function getLastMonthBiko(clientId, currentYearMonth) {
  return InputFormApi.getLastMonthBiko(clientId, currentYearMonth);
}
