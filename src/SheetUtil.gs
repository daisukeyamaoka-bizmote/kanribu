/**
 * 「2026-05」形式の対象月文字列を返す。Date オブジェクトを Google Sheets が
 * 勝手に作ってしまうケースに備えて、Date と string の両方を許容する。
 */
function normalizeYearMonth(value) {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date) {
    return Utilities.formatDate(value, 'JST', 'yyyy-MM');
  }
  return String(value).trim();
}

/**
 * スプレッドシート操作ユーティリティ
 */
const SheetUtil = {
  getSheet: function(name) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(name);
    if (!sheet) {
      throw new Error(`シートが見つかりません: ${name}`);
    }
    return sheet;
  },

  /**
   * シートの内容をオブジェクト配列で取得
   * @param {string} sheetName - シート名
   * @param {number} headerRow - ヘッダー行番号 (デフォルト1)
   * @param {number} dataStartRow - データ開始行 (デフォルト3)
   * @return {Array<Object>} 行データの配列。各オブジェクトに _rowNumber を含む
   */
  readAsObjects: function(sheetName, headerRow, dataStartRow) {
    headerRow = headerRow || 1;
    dataStartRow = dataStartRow || 3;

    const sheet = this.getSheet(sheetName);
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();

    if (lastRow < dataStartRow) return [];

    const headers = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0];
    const rows = sheet.getRange(dataStartRow, 1, lastRow - dataStartRow + 1, lastCol).getValues();

    return rows
      .filter(row => row.some(cell => cell !== '' && cell !== null))
      .map((row, index) => {
        const obj = { _rowNumber: dataStartRow + index };
        headers.forEach((header, i) => {
          if (header) obj[header] = row[i];
        });
        return obj;
      });
  },

  /**
   * 特定行の特定列を更新
   */
  updateRow: function(sheetName, rowNumber, updates) {
    const sheet = this.getSheet(sheetName);
    const lastCol = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

    Object.keys(updates).forEach(key => {
      const colIndex = headers.indexOf(key);
      if (colIndex < 0) {
        Logger.log(`警告: 列 "${key}" が見つかりません (シート: ${sheetName})`);
        return;
      }
      sheet.getRange(rowNumber, colIndex + 1).setValue(updates[key]);
    });
  },

  /**
   * 行を末尾に追加。既存行の数式列は数式をコピーして相対参照を維持する。
   * 数式列を rowData で明示的に上書きしたい場合は、その列名を指定する。
   */
  appendRow: function(sheetName, rowData) {
    const sheet = this.getSheet(sheetName);
    const lastCol = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    const oldLastRow = sheet.getLastRow();
    const newRowIndex = oldLastRow + 1;

    // 直前のデータ行から数式列を検出
    const formulaColIndices = [];
    if (oldLastRow >= 3) {
      const formulas = sheet.getRange(oldLastRow, 1, 1, lastCol).getFormulas()[0];
      formulas.forEach((f, i) => {
        if (f) formulaColIndices.push(i);
      });
    }
    const isFormulaCol = (i) => formulaColIndices.indexOf(i) !== -1;

    // 値配列を構築。数式列はプレースホルダ '' (後で copyTo で埋める)
    const rowValues = headers.map((header, i) => {
      if (rowData[header] !== undefined) return rowData[header];
      if (isFormulaCol(i)) return '';
      return '';
    });

    sheet.appendRow(rowValues);

    // 数式列のうち、rowData で明示指定されていないものは前行から数式コピー
    formulaColIndices.forEach(i => {
      const header = headers[i];
      if (rowData[header] === undefined) {
        sheet.getRange(oldLastRow, i + 1).copyTo(sheet.getRange(newRowIndex, i + 1));
      }
    });
  },

  findRow: function(sheetName, columnName, value) {
    const rows = this.readAsObjects(sheetName);
    return rows.find(r => r[columnName] === value);
  },

  /**
   * シートが存在するか確認
   */
  exists: function(sheetName) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    return ss.getSheetByName(sheetName) !== null;
  },
};
