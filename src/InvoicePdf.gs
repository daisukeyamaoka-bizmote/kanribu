/**
 * 請求書PDFをfreeeからダウンロードしてGoogle Driveに保存
 * (ステップ3 C-2)
 *
 * - 対象は ステータス=発行済 かつ PDF Driveリンク 未設定の請求書
 * - 保存先フォルダは Config.PDF_DRIVE_FOLDER_ID
 * - 同一ファイル名の既存ファイルがあれば上書き(古いPDFはゴミ箱へ)
 * - PDF保存後、シートの PDF Driveリンク 列にDrive URLを書き込み
 */
const InvoicePdf = {
  INVOICE_SHEET: '03_請求一覧',
  CLIENT_MASTER_SHEET: '01_クライアントマスタ',

  /**
   * 発行済かつPDF未保存の請求書PDFを一括ダウンロード→Drive保存
   */
  saveAllPendingPdfs: function() {
    const allRows = SheetUtil.readAsObjects(this.INVOICE_SHEET, 1, 3);
    const targets = allRows.filter(r => {
      const status = String(r['ステータス'] || '').trim();
      const hasFreeeId = !!r['freee請求書ID'];
      const hasPdfLink = !!String(r['PDF Driveリンク'] || '').trim();
      return status === '発行済' && hasFreeeId && !hasPdfLink;
    });

    if (targets.length === 0) {
      return { saved: [], failed: [], total: 0 };
    }

    const folder = this._getFolder();
    const clients = SheetUtil.readAsObjects(this.CLIENT_MASTER_SHEET, 1, 3);
    const clientMap = {};
    clients.forEach(c => clientMap[c['クライアントID']] = c);

    const saved = [];
    const failed = [];

    targets.forEach(r => {
      try {
        const result = this._saveOnePdf(r, clientMap, folder);
        saved.push(result);
      } catch (e) {
        Logger.log(`PDF保存失敗 ${r['請求ID']}: ${e.message}`);
        failed.push({
          invoiceId: r['請求ID'],
          freeeInvoiceId: r['freee請求書ID'],
          error: e.message,
        });
      }
      Utilities.sleep(300);
    });

    Notifier.slack(
      `請求書PDF保存: 成功 ${saved.length}件, 失敗 ${failed.length}件 / 合計 ${targets.length}件`
    );

    return { saved: saved, failed: failed, total: targets.length, folderName: folder.getName() };
  },

  /**
   * 1件のPDFを保存
   * @private
   */
  _saveOnePdf: function(row, clientMap, folder) {
    const freeeInvoiceId = row['freee請求書ID'];
    const client = clientMap[row['クライアントID']] || {};
    const yearMonth = normalizeYearMonth(row['対象月']);
    const clientName = client['企業名'] || row['クライアントID'];

    const blob = FreeeClient.downloadInvoicePdf(freeeInvoiceId);
    const fileName = this._buildFileName(clientName, yearMonth, freeeInvoiceId);
    blob.setName(fileName);

    // 同名の既存ファイルがあればゴミ箱へ
    this._trashExisting(folder, fileName);

    const file = folder.createFile(blob);
    const url = file.getUrl();

    SheetUtil.updateRow(this.INVOICE_SHEET, row._rowNumber, {
      'PDF Driveリンク': url,
    });

    Logger.log(`PDF保存成功 ${row['請求ID']} → ${fileName}`);

    return {
      invoiceId: row['請求ID'],
      clientName: clientName,
      fileName: fileName,
      url: url,
    };
  },

  /**
   * 設定値からPDF保存先フォルダを取得
   * @private
   */
  _getFolder: function() {
    const folderId = Config.get('PDF_DRIVE_FOLDER_ID');
    try {
      return DriveApp.getFolderById(folderId);
    } catch (e) {
      throw new Error(
        `PDF保存先フォルダが見つかりません (ID: ${folderId})。\n` +
        `フォルダIDを確認するか、スクリプトプロパティ PDF_DRIVE_FOLDER_ID を更新してください。`
      );
    }
  },

  /**
   * ファイル名を構築 (Driveで使えない文字を除去)
   * @private
   */
  _buildFileName: function(clientName, yearMonth, freeeInvoiceId) {
    const cleanName = String(clientName).replace(/[\\\/:*?"<>|]/g, '_').trim();
    return `${cleanName}_${yearMonth}_${freeeInvoiceId}.pdf`;
  },

  /**
   * 同名ファイルが既存ならゴミ箱へ移動
   * @private
   */
  _trashExisting: function(folder, fileName) {
    const files = folder.getFilesByName(fileName);
    while (files.hasNext()) {
      const f = files.next();
      f.setTrashed(true);
    }
  },
};

/**
 * メニューから呼ばれる: 発行済の請求書PDFをDriveに保存
 */
function saveInvoicePdfs() {
  const ui = SpreadsheetApp.getUi();
  try {
    const result = InvoicePdf.saveAllPendingPdfs();

    if (result.total === 0) {
      ui.alert(
        'PDF保存',
        'PDF保存対象がありません。\n' +
        '(ステータスが「発行済」かつ「PDF Driveリンク」が空の請求書がない)',
        ui.ButtonSet.OK
      );
      return;
    }

    let msg = `保存先フォルダ: ${result.folderName}\n\n` +
              `対象: ${result.total}件\n` +
              `成功: ${result.saved.length}件\n` +
              `失敗: ${result.failed.length}件`;

    if (result.saved.length > 0) {
      msg += '\n\n保存成功:\n' + result.saved.map(s => `- ${s.clientName}: ${s.fileName}`).join('\n');
    }
    if (result.failed.length > 0) {
      msg += '\n\n失敗内訳:\n' + result.failed.map(f => `- ${f.invoiceId} (freee${f.freeeInvoiceId}): ${f.error}`).join('\n');
    }

    const title = result.failed.length === 0 ? 'PDF保存 完了' : (result.saved.length === 0 ? 'PDF保存 失敗' : 'PDF保存 一部成功');
    ui.alert(title, msg, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('PDF保存 エラー', e.message, ui.ButtonSet.OK);
  }
}
