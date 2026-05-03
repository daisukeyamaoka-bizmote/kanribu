/**
 * bizmote 請求書管理システム
 * メインエントリーポイント
 *
 * フェーズ2 ステップ2用: OAuth恒久化 + 入力フォーム + 承認画面
 * (ステップ2本体の実装はOAuth動作確認後に追加予定)
 */

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('請求管理')
    .addSubMenu(
      ui.createMenu('請求業務')
        .addItem('オーナー入力フォームを開く', 'openInputForm')
        .addSeparator()
        .addItem('月初の請求行を作成(手動)', 'manualCreateMonthlyInvoiceRows')
        .addSeparator()
        .addItem('月初トリガーを登録(毎月1日9時)', 'installMonthlyInvoiceTrigger')
        .addItem('月初トリガーを解除', 'removeMonthlyInvoiceTrigger')
    )
    .addSubMenu(
      ui.createMenu('開発者メニュー')
        .addItem('1. 初期設定', 'setupInitialConfig')
        .addItem('2. freee認証開始', 'startFreeeOAuth')
        .addItem('3. freee認証状態確認', 'checkFreeeOAuthStatus')
        .addItem('4. freee認証リセット', 'resetFreeeOAuth')
        .addSeparator()
        .addItem('5. freee接続テスト', 'testFreeeConnection')
        .addItem('6. クライアントマスタ確認', 'testReadClientMaster')
        .addItem('7. 過去請求一覧取得', 'testListInvoices')
    )
    .addToUi();
}

function setupInitialConfig() {
  Config.initialize();
  const lineSheetCreated = InvoiceFlow.ensureInvoiceLineSheet();
  const mappingCreated = UserMapping.ensureSheet();

  let msg = 'スクリプトプロパティに設定値を保存しました。\n';
  msg += lineSheetCreated
    ? '03b_請求明細 シートを新規作成しました。\n'
    : '03b_請求明細 シートは既に存在します。\n';
  msg += mappingCreated
    ? '99b_ユーザマッピング シートを新規作成しました。\n'
    : '99b_ユーザマッピング シートは既に存在します。\n';
  msg += '\n未認証の場合は「2. freee認証開始」を実行してください。';

  SpreadsheetApp.getUi().alert(
    '初期設定完了',
    msg,
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

/**
 * メニューから呼ばれる: オーナー入力フォーム(サイドバー)を開く
 */
function openInputForm() {
  const html = HtmlService.createHtmlOutputFromFile('InputForm')
    .setTitle('請求金額入力');
  SpreadsheetApp.getUi().showSidebar(html);
}

function testFreeeConnection() {
  try {
    const company = FreeeClient.getCompany();
    const startMonth = company.start_month
      || company.default_start_month
      || (company.fiscal_years && company.fiscal_years[0] && company.fiscal_years[0].start_date && Number(company.fiscal_years[0].start_date.substring(5, 7)))
      || '不明';
    SpreadsheetApp.getUi().alert(
      'freee接続成功',
      `会社名: ${company.name}\n` +
      `事業所ID: ${company.id}\n` +
      `期首月: ${startMonth}月`,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (e) {
    SpreadsheetApp.getUi().alert(
      'freee接続エラー',
      'エラー内容:\n' + e.message,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  }
}

function testReadClientMaster() {
  try {
    const clients = SheetUtil.readAsObjects('01_クライアントマスタ', 1, 3);
    Logger.log(`クライアント数: ${clients.length}`);
    clients.forEach(c => {
      Logger.log(`${c['企業名']} (${c['クライアントID']}) - オーナー: ${c['案件オーナー']}`);
    });
    SpreadsheetApp.getUi().alert(
      'クライアントマスタ確認完了',
      `${clients.length}社のクライアント情報を読み込みました。\n詳細は実行ログで確認してください。`,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (e) {
    SpreadsheetApp.getUi().alert('エラー', e.message, SpreadsheetApp.getUi().ButtonSet.OK);
  }
}

function testListInvoices() {
  const today = new Date();
  const threeMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 3, 1);
  const dateStart = Utilities.formatDate(threeMonthsAgo, 'JST', 'yyyy-MM-dd');
  const dateEnd = Utilities.formatDate(today, 'JST', 'yyyy-MM-dd');

  try {
    const invoices = FreeeClient.listInvoices({ dateStart, dateEnd, limit: 100 });
    Logger.log(`過去3ヶ月の請求書: ${invoices.length}件`);
    invoices.slice(0, 20).forEach(inv => {
      Logger.log(`${inv.invoice_number} | ${inv.partner_name} | ¥${inv.total_amount.toLocaleString()}`);
    });
    SpreadsheetApp.getUi().alert(
      '請求一覧取得完了',
      `${invoices.length}件取得しました。`,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (e) {
    SpreadsheetApp.getUi().alert('エラー', e.message, SpreadsheetApp.getUi().ButtonSet.OK);
  }
}
