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
   * 行を末尾に追加
   */
  appendRow: function(sheetName, rowData) {
    const sheet = this.getSheet(sheetName);
    const lastCol = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

    const row = headers.map(header => {
      return rowData[header] !== undefined ? rowData[header] : '';
    });
    sheet.appendRow(row);
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
