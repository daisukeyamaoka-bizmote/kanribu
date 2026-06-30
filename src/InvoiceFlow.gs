/**
 * 請求業務メインフロー
 *
 * このファイルでは以下を扱う:
 * - 月初の請求行自動作成 (createMonthlyInvoiceRows)
 * - 03b_請求明細シートの初期作成
 * - 月初トリガー登録/解除
 *
 * ステップ3で請求書発行・PDF・メール送付を別ファイルに追加予定。
 */
const InvoiceFlow = {
  TRIGGER_FUNCTION_NAME: 'createMonthlyInvoiceRowsTrigger',
  INVOICE_SHEET: '03_請求一覧',
  LINE_ITEM_SHEET: '03b_請求明細',
  CLIENT_MASTER_SHEET: '01_クライアントマスタ',

  /**
   * 月初の請求行を自動作成
   * @param {string} [yearMonth] - 対象月 (yyyy-MM形式)。未指定なら今日のJST月
   * @return {object} 結果サマリー
   */
  createMonthlyInvoiceRows: function(yearMonth) {
    if (!yearMonth) {
      const today = new Date();
      yearMonth = Utilities.formatDate(today, 'JST', 'yyyy-MM');
    }

    const clients = SheetUtil.readAsObjects(this.CLIENT_MASTER_SHEET, 1, 3)
      .filter(c => String(c['ステータス'] || '').trim() === '稼働中');

    const allRows = SheetUtil.readAsObjects(this.INVOICE_SHEET, 1, 3);
    const existingRows = allRows.filter(r => normalizeYearMonth(r['対象月']) === yearMonth);
    const existingClientIds = new Set(existingRows.map(r => r['クライアントID']));
    // シート全体の既存請求IDを集合化し、過去データと衝突するIDを発番しない
    // (対象月を手動で書き換えた等で同一IDが残っていても二重発番を防ぐ)
    const allInvoiceIds = new Set(allRows.map(r => String(r['請求ID'] || '').trim()));

    let nextSeq = existingRows.length;
    const yyyymm = yearMonth.replace('-', '');

    let added = 0;
    const skipped = [];
    clients.forEach(client => {
      if (existingClientIds.has(client['クライアントID'])) {
        skipped.push(client['企業名']);
        return;
      }
      // 既存IDと衝突しない連番になるまでインクリメント
      let invoiceId;
      do {
        nextSeq++;
        invoiceId = `INV-${yyyymm}-${String(nextSeq).padStart(3, '0')}`;
      } while (allInvoiceIds.has(invoiceId));
      allInvoiceIds.add(invoiceId);

      SheetUtil.appendRow(this.INVOICE_SHEET, {
        '請求ID': invoiceId,
        '対象月': yearMonth,
        'クライアントID': client['クライアントID'],
        'ステータス': '未入力',
      });
      added++;
    });

    return {
      yearMonth: yearMonth,
      added: added,
      skipped: skipped,
      totalActiveClients: clients.length,
    };
  },

  /**
   * 03_請求一覧 に「備考」列を末尾に追加(既に存在すればスキップ)
   * @return {boolean} 新規追加した場合true
   */
  ensureBikoColumn: function() {
    const sheet = SheetUtil.getSheet(this.INVOICE_SHEET);
    const lastCol = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    if (headers.indexOf('備考') !== -1) return false;

    const newCol = lastCol + 1;
    sheet.getRange(1, newCol).setValue('備考')
      .setFontWeight('bold').setBackground('#1E3A5F').setFontColor('white').setHorizontalAlignment('center');
    sheet.getRange(2, newCol).setValue('任意')
      .setFontStyle('italic').setFontColor('#666666').setFontSize(10);
    sheet.setColumnWidth(newCol, 220);
    return true;
  },

  /**
   * 03_請求一覧 と 03b_請求明細 のデータ行を全削除(ヘッダー2行は残す)
   * テストデータを汚した時の復旧用
   * @return {object} 削除した行数
   */
  resetInvoiceData: function() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const result = { invoices: 0, lineItems: 0 };

    const invSheet = ss.getSheetByName(this.INVOICE_SHEET);
    if (invSheet && invSheet.getLastRow() >= 3) {
      const num = invSheet.getLastRow() - 2;
      invSheet.deleteRows(3, num);
      result.invoices = num;
    }

    const lineSheet = ss.getSheetByName(this.LINE_ITEM_SHEET);
    if (lineSheet && lineSheet.getLastRow() >= 3) {
      const num = lineSheet.getLastRow() - 2;
      lineSheet.deleteRows(3, num);
      result.lineItems = num;
    }
    return result;
  },

  /**
   * 03b_請求明細シートを存在しなければ作成
   * @return {boolean} 新規作成した場合true、既存ならfalse
   */
  ensureInvoiceLineSheet: function() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss.getSheetByName(this.LINE_ITEM_SHEET)) return false;

    const sheet = ss.insertSheet(this.LINE_ITEM_SHEET);
    const headers = ['請求ID', '行No', '品目名', '単価(税抜)', '数量', '税率', '小計(税抜)'];
    const descriptions = [
      '03_請求一覧 への外部キー',
      '同一請求内の連番(1から)',
      '例: インサイドセールス構築支援 基本委託料',
      '円(税抜)',
      '個数・時間など',
      '10 / 8 / 0',
      '単価 × 数量',
    ];

    sheet.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#E8EAF6');
    sheet.getRange(2, 1, 1, descriptions.length).setValues([descriptions])
      .setFontStyle('italic').setFontColor('#666666').setFontSize(10);
    sheet.setFrozenRows(2);

    const widths = [180, 50, 280, 110, 60, 60, 110];
    widths.forEach((w, i) => sheet.setColumnWidth(i + 1, w));

    return true;
  },

  /**
   * 月初トリガーを登録 (毎月1日 9:00 JST)
   * 既存の同名トリガーは先に削除
   */
  installMonthlyTrigger: function() {
    const removed = this.removeMonthlyTrigger();
    ScriptApp.newTrigger(this.TRIGGER_FUNCTION_NAME)
      .timeBased()
      .onMonthDay(1)
      .atHour(9)
      .inTimezone('Asia/Tokyo')
      .create();
    return { removed: removed, installed: 1 };
  },

  /**
   * 月初トリガーを全て解除
   * @return {number} 解除した件数
   */
  removeMonthlyTrigger: function() {
    const triggers = ScriptApp.getProjectTriggers();
    let count = 0;
    triggers.forEach(trigger => {
      if (trigger.getHandlerFunction() === this.TRIGGER_FUNCTION_NAME) {
        ScriptApp.deleteTrigger(trigger);
        count++;
      }
    });
    return count;
  },
};

/**
 * トリガーから呼ばれるエントリーポイント (引数なし関数として必要)
 */
function createMonthlyInvoiceRowsTrigger() {
  try {
    const result = InvoiceFlow.createMonthlyInvoiceRows();
    Logger.log(`月初トリガー実行: 追加${result.added}件, スキップ${result.skipped.length}件`);
  } catch (e) {
    Logger.log(`月初トリガーエラー: ${e.message}`);
    throw e;
  }
}

/**
 * メニューから呼ばれる: 手動で月初の請求行を作成
 */
function manualCreateMonthlyInvoiceRows() {
  const ui = SpreadsheetApp.getUi();
  try {
    const result = InvoiceFlow.createMonthlyInvoiceRows();
    let msg = `対象月: ${result.yearMonth}\n` +
              `追加: ${result.added}件\n` +
              `スキップ(既存): ${result.skipped.length}件`;
    if (result.skipped.length > 0) {
      msg += `\n  - ${result.skipped.join('\n  - ')}`;
    }
    msg += `\n\n稼働中クライアント数: ${result.totalActiveClients}社`;
    ui.alert('月初の請求行作成 完了', msg, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('月初の請求行作成 エラー', e.message, ui.ButtonSet.OK);
  }
}

/**
 * メニューから呼ばれる: 月初トリガーを登録
 */
function installMonthlyInvoiceTrigger() {
  const ui = SpreadsheetApp.getUi();
  try {
    const result = InvoiceFlow.installMonthlyTrigger();
    ui.alert(
      '月初トリガー登録完了',
      `毎月1日 9:00(JST)に自動実行されます。\n\n` +
      `(既存トリガーを ${result.removed} 件解除し、新規に ${result.installed} 件登録)`,
      ui.ButtonSet.OK
    );
  } catch (e) {
    ui.alert('トリガー登録エラー', e.message, ui.ButtonSet.OK);
  }
}

/**
 * メニューから呼ばれる: 月初トリガーを解除
 */
function removeMonthlyInvoiceTrigger() {
  const ui = SpreadsheetApp.getUi();
  const removed = InvoiceFlow.removeMonthlyTrigger();
  ui.alert(
    'トリガー解除完了',
    `${removed} 件のトリガーを解除しました。`,
    ui.ButtonSet.OK
  );
}

/**
 * メニューから呼ばれる: 03_請求一覧 と 03b_請求明細 のデータをクリアして
 * 当月分の請求行を再作成する(復旧用)
 */
function resetAndRecreateMonthlyInvoiceRows() {
  const ui = SpreadsheetApp.getUi();
  const confirm = ui.alert(
    '請求データをリセット',
    '03_請求一覧 と 03b_請求明細 の全データ行を削除し、当月の請求行6件を再作成します。\n\n' +
    'この操作は元に戻せません。本当に実行しますか?',
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;

  try {
    const reset = InvoiceFlow.resetInvoiceData();
    const result = InvoiceFlow.createMonthlyInvoiceRows();
    ui.alert(
      'リセット&再作成 完了',
      `削除: 03_請求一覧 ${reset.invoices}行, 03b_請求明細 ${reset.lineItems}行\n` +
      `作成: ${result.added}件 (対象月: ${result.yearMonth})`,
      ui.ButtonSet.OK
    );
  } catch (e) {
    ui.alert('エラー', e.message, ui.ButtonSet.OK);
  }
}
