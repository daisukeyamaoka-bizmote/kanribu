/**
 * ユーザマッピング(メールアドレス→表示名)
 *
 * Googleアカウントのメールから 山岡/須藤/樋口 等の表示名を解決する。
 * シート 99b_ユーザマッピング を真とする(ハードコード回避)。
 */
const UserMapping = {
  SHEET_NAME: '99b_ユーザマッピング',

  /**
   * シートを存在しなければ作成し、初期データを投入
   * @return {boolean} 新規作成した場合true
   */
  ensureSheet: function() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss.getSheetByName(this.SHEET_NAME)) return false;

    const sheet = ss.insertSheet(this.SHEET_NAME);
    const headers = ['メール', '表示名', '役割'];
    const descriptions = [
      'Googleアカウントのメールアドレス(完全一致)',
      '請求一覧などに表示する短い名前(山岡/須藤など)',
      'オーナー / 経理',
    ];
    const initialData = [
      ['daisuke.yamaoka@bizmote.jp', '山岡', 'オーナー'],
      ['hayato.suto@bizmote.jp', '須藤', 'オーナー'],
      ['miku.higuchi@bizmote.jp', '樋口', '経理'],
    ];

    sheet.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#E8EAF6');
    sheet.getRange(2, 1, 1, descriptions.length).setValues([descriptions])
      .setFontStyle('italic').setFontColor('#666666').setFontSize(10);
    sheet.getRange(3, 1, initialData.length, 3).setValues(initialData);
    sheet.setFrozenRows(2);
    sheet.setColumnWidth(1, 240);
    sheet.setColumnWidth(2, 120);
    sheet.setColumnWidth(3, 100);
    return true;
  },

  /**
   * メールから表示名を取得 (見つからなければ null)
   */
  getDisplayName: function(email) {
    if (!email) return null;
    const rows = SheetUtil.readAsObjects(this.SHEET_NAME, 1, 3);
    const match = rows.find(r => String(r['メール']).trim().toLowerCase() === String(email).trim().toLowerCase());
    return match ? match['表示名'] : null;
  },

  /**
   * メールから役割(オーナー/経理)を取得
   */
  getRole: function(email) {
    if (!email) return null;
    const rows = SheetUtil.readAsObjects(this.SHEET_NAME, 1, 3);
    const match = rows.find(r => String(r['メール']).trim().toLowerCase() === String(email).trim().toLowerCase());
    return match ? match['役割'] : null;
  },

  /**
   * 現在のアクティブユーザの表示名
   */
  getCurrentUserDisplayName: function() {
    return this.getDisplayName(Session.getActiveUser().getEmail());
  },
};
