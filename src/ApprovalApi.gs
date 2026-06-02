/**
 * 経理向け承認画面 (ApprovalView.html) の連携API
 *
 * - 入力済 → 承認済 / 差戻 のステータス遷移を扱う
 * - 前月比チェックも含む
 * - HTML から google.script.run で呼ばれるグローバル関数は本ファイル末尾でエクスポート
 */
const ApprovalApi = {
  INVOICE_SHEET: '03_請求一覧',
  LINE_ITEM_SHEET: '03b_請求明細',
  CLIENT_MASTER_SHEET: '01_クライアントマスタ',

  /**
   * 承認画面にアクセスできる役割か検証
   * 経理 / オーナー どちらも閲覧+承認可能。未登録ユーザはエラー
   */
  checkAccess: function() {
    const userEmail = Session.getActiveUser().getEmail();
    const role = UserMapping.getRole(userEmail);
    if (!role) {
      throw new Error(
        `ユーザ "${userEmail}" がマッピングに登録されていません。\n` +
        `99b_ユーザマッピング シートに行を追加してください。`
      );
    }
    return { userEmail: userEmail, role: role };
  },

  /**
   * 承認待ち(ステータス=入力済)の請求一覧を取得
   * 各行に前月比チェック結果と明細を含めて返す
   */
  getInvoicesForApproval: function() {
    this.checkAccess();

    // 必要なシートを一度だけ読み込む
    const clients = SheetUtil.readAsObjects(this.CLIENT_MASTER_SHEET, 1, 3);
    const clientMap = {};
    clients.forEach(c => clientMap[c['クライアントID']] = c);

    const allInvoices = SheetUtil.readAsObjects(this.INVOICE_SHEET, 1, 3);
    const allLineItems = SheetUtil.readAsObjects(this.LINE_ITEM_SHEET, 1, 3);

    // 前月実績マップ (クライアントID + yearMonth → 税込金額) を一度構築
    const amountByClientYm = {};
    allInvoices.forEach(r => {
      amountByClientYm[r['クライアントID'] + '|' + normalizeYearMonth(r['対象月'])] = Number(r['税込金額']) || 0;
    });

    // 明細を請求ID別にグループ化
    const lineItemsByInvoice = {};
    allLineItems.forEach(li => {
      const id = li['請求ID'];
      if (!lineItemsByInvoice[id]) lineItemsByInvoice[id] = [];
      lineItemsByInvoice[id].push(li);
    });

    const pending = allInvoices.filter(r => String(r['ステータス'] || '').trim() === '入力済');

    return pending.map(r => {
      const yearMonth = normalizeYearMonth(r['対象月']);
      const client = clientMap[r['クライアントID']] || {};
      const totalAmount = Number(r['税込金額']) || 0;
      const lastYearMonth = this._getLastYearMonth(yearMonth);
      const lastAmount = amountByClientYm[r['クライアントID'] + '|' + lastYearMonth] || 0;
      const variation = this._buildVariation(totalAmount, lastAmount);

      const lineItems = (lineItemsByInvoice[r['請求ID']] || [])
        .slice()
        .sort((a, b) => (Number(a['行No']) || 0) - (Number(b['行No']) || 0))
        .map(li => ({
          rowNo: Number(li['行No']) || 0,
          itemName: li['品目名'] || '',
          unitPrice: Number(li['単価(税抜)']) || 0,
          quantity: Number(li['数量']) || 0,
          taxRate: Number(li['税率']) || 10,
          subtotal: Number(li['小計(税抜)']) || 0,
        }));

      return {
        invoiceId: r['請求ID'],
        yearMonth: yearMonth,
        clientId: r['クライアントID'],
        clientName: client['企業名'] || r['クライアントID'],
        owner: String(client['案件オーナー'] || '').trim(),
        subjectTemplate: client['件名テンプレ'] || '',
        subtotal: Number(r['税抜金額']) || 0,
        tax: Number(r['消費税']) || 0,
        total: totalAmount,
        inputBy: r['入力者'] || '',
        inputAt: this._formatDateTime(r['入力日時']),
        variation: variation,
        lineItems: lineItems,
        biko: String(r['備考'] || '').trim(),
      };
    });
  },

  /**
   * 単件承認: 入力済 → 承認済
   */
  approveInvoice: function(invoiceId) {
    this.checkAccess();
    if (!invoiceId) throw new Error('請求IDが指定されていません');

    const lock = LockService.getDocumentLock();
    if (!lock.tryLock(10000)) throw new Error('他の処理が実行中です。少し時間を置いて再度お試しください。');

    try {
      const allRows = SheetUtil.readAsObjects(this.INVOICE_SHEET, 1, 3);
      const row = allRows.find(r => r['請求ID'] === invoiceId);
      if (!row) throw new Error(`請求が見つかりません: ${invoiceId}`);
      const status = String(row['ステータス'] || '').trim();
      if (status !== '入力済') throw new Error(`既に処理済みです (現在のステータス: ${status})`);

      SheetUtil.updateRow(this.INVOICE_SHEET, row._rowNumber, {
        'ステータス': '承認済',
        '承認者': Session.getActiveUser().getEmail(),
        '承認日時': new Date(),
      });

      return { success: true, invoiceId: invoiceId };
    } finally {
      lock.releaseLock();
    }
  },

  /**
   * 差戻: 入力済 → 差戻 + メモ列に理由追記
   */
  rejectInvoice: function(invoiceId, reason) {
    this.checkAccess();
    if (!invoiceId) throw new Error('請求IDが指定されていません');
    const trimmedReason = String(reason || '').trim();
    if (!trimmedReason) throw new Error('差戻理由を入力してください');

    const lock = LockService.getDocumentLock();
    if (!lock.tryLock(10000)) throw new Error('他の処理が実行中です。少し時間を置いて再度お試しください。');

    try {
      const allRows = SheetUtil.readAsObjects(this.INVOICE_SHEET, 1, 3);
      const row = allRows.find(r => r['請求ID'] === invoiceId);
      if (!row) throw new Error(`請求が見つかりません: ${invoiceId}`);
      const status = String(row['ステータス'] || '').trim();
      if (status !== '入力済') throw new Error(`既に処理済みです (現在のステータス: ${status})`);

      const timestamp = Utilities.formatDate(new Date(), 'JST', 'yyyy/MM/dd HH:mm');
      const existingMemo = String(row['メモ'] || '').trim();
      const newMemo = `[差戻 ${timestamp}] ${trimmedReason}` +
                      (existingMemo ? `\n${existingMemo}` : '');

      SheetUtil.updateRow(this.INVOICE_SHEET, row._rowNumber, {
        'ステータス': '差戻',
        'メモ': newMemo,
      });

      return { success: true, invoiceId: invoiceId };
    } finally {
      lock.releaseLock();
    }
  },

  /**
   * 一括承認: 引数の請求ID配列を順に承認
   * 失敗したものは結果に含めて返す。
   * Lockは一度だけ取得して全件処理し、ロック競合を回避。
   */
  bulkApproveAll: function(invoiceIds) {
    this.checkAccess();
    if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
      throw new Error('請求ID一覧が空または不正です');
    }

    const lock = LockService.getDocumentLock();
    if (!lock.tryLock(30000)) throw new Error('他の処理が実行中です。少し時間を置いて再度お試しください。');

    const results = [];
    try {
      const allRows = SheetUtil.readAsObjects(this.INVOICE_SHEET, 1, 3);
      const userEmail = Session.getActiveUser().getEmail();
      const now = new Date();

      invoiceIds.forEach(id => {
        try {
          const row = allRows.find(r => r['請求ID'] === id);
          if (!row) throw new Error('請求が見つかりません');
          const status = String(row['ステータス'] || '').trim();
          if (status !== '入力済') throw new Error(`既に処理済みです (現在のステータス: ${status})`);

          SheetUtil.updateRow(this.INVOICE_SHEET, row._rowNumber, {
            'ステータス': '承認済',
            '承認者': userEmail,
            '承認日時': now,
          });

          results.push({ invoiceId: id, success: true });
        } catch (e) {
          Logger.log(`一括承認 失敗 ${id}: ${e.message}`);
          results.push({ invoiceId: id, success: false, error: e.message });
        }
      });
      Logger.log(`一括承認 完了: ${results.filter(r => r.success).length}/${results.length}`);
      return results;
    } finally {
      lock.releaseLock();
    }
  },

  /**
   * 前月比オブジェクトを生成 (前月実績ありなしを引数で受ける版)
   * @private
   */
  _buildVariation: function(currentTotal, lastAmount) {
    if (!lastAmount) {
      return { hasReference: false, lastAmount: 0, variation: 0, variationPct: 0, warning: false };
    }
    const variation = (currentTotal - lastAmount) / lastAmount;
    return {
      hasReference: true,
      lastAmount: lastAmount,
      variation: variation,
      variationPct: Math.round(variation * 100),
      warning: Math.abs(variation) > 0.2,
    };
  },

  /**
   * 前月比チェック (旧API互換、ループ内呼び出し版)
   * 新規コードでは _buildVariation を使うこと
   * @private
   */
  _checkVariation: function(clientId, currentTotal, currentYearMonth, allInvoices) {
    const lastYearMonth = this._getLastYearMonth(currentYearMonth);
    const lastInvoice = allInvoices.find(r =>
      r['クライアントID'] === clientId &&
      normalizeYearMonth(r['対象月']) === lastYearMonth
    );
    if (!lastInvoice) {
      return { hasReference: false, lastAmount: 0, variation: 0, variationPct: 0, warning: false };
    }

    const lastAmount = Number(lastInvoice['税込金額']) || 0;
    if (lastAmount === 0) {
      return { hasReference: false, lastAmount: 0, variation: 0, variationPct: 0, warning: false };
    }

    const variation = (currentTotal - lastAmount) / lastAmount;
    return {
      hasReference: true,
      lastAmount: lastAmount,
      variation: variation,
      variationPct: Math.round(variation * 100),
      warning: Math.abs(variation) > 0.2,
    };
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
   * Date を 'yyyy/MM/dd HH:mm' 形式に整形 (空ならそのまま)
   * @private
   */
  _formatDateTime: function(value) {
    if (!value) return '';
    if (value instanceof Date) return Utilities.formatDate(value, 'JST', 'yyyy/MM/dd HH:mm');
    return String(value);
  },
};

// HTML から google.script.run で呼ばれるグローバル関数
function getInvoicesForApproval() {
  return ApprovalApi.getInvoicesForApproval();
}
function approveInvoice(invoiceId) {
  return ApprovalApi.approveInvoice(invoiceId);
}
function rejectInvoice(invoiceId, reason) {
  return ApprovalApi.rejectInvoice(invoiceId, reason);
}
function bulkApproveAll(invoiceIds) {
  return ApprovalApi.bulkApproveAll(invoiceIds);
}
