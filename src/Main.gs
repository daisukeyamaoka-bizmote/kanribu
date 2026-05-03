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
        .addItem('承認画面を開く(経理)', 'openApprovalView')
        .addSeparator()
        .addItem('月初の請求行を作成(手動)', 'manualCreateMonthlyInvoiceRows')
        .addItem('請求データをリセット(復旧用)', 'resetAndRecreateMonthlyInvoiceRows')
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
        .addSeparator()
        .addItem('8. 入力待ち請求を確認(デバッグ)', 'debugMyPendingInvoices')
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

/**
 * メニューから呼ばれる: 経理向け承認画面(モーダルダイアログ)を開く
 */
function openApprovalView() {
  const html = HtmlService.createHtmlOutputFromFile('ApprovalView')
    .setWidth(720)
    .setHeight(560);
  SpreadsheetApp.getUi().showModalDialog(html, '請求承認');
}

/**
 * メニューから呼ばれる: 入力フォームのデータ取得をデバッグ用に直接実行して結果を表示
 */
function debugMyPendingInvoices() {
  const ui = SpreadsheetApp.getUi();
  try {
    const email = Session.getActiveUser().getEmail();
    const owner = UserMapping.getDisplayName(email);
    const allInvoices = SheetUtil.readAsObjects('03_請求一覧', 1, 3);
    const pending = allInvoices.filter(r => {
      const status = String(r['ステータス'] || '').trim();
      return status === '未入力' || status === '差戻';
    });
    const mine = InputFormApi.getMyPendingInvoices();

    let msg = `現在のユーザ\n  メール: "${email}"\n  表示名: "${owner || '(マッピング未登録)'}"\n\n` +
              `03_請求一覧 全体: ${allInvoices.length}行\n` +
              `うち未入力/差戻: ${pending.length}行\n` +
              `うち自分担当(${owner || '不明'}): ${mine.length}行\n\n`;

    if (pending.length > 0) {
      msg += '未入力/差戻の内訳:\n';
      pending.slice(0, 10).forEach(p => {
        msg += `  - ${p['請求ID']} | ${p['対象月']} | ${p['クライアントID']} | ${p['ステータス']}\n`;
      });
    }

    Logger.log(msg);
    ui.alert('入力待ち請求デバッグ', msg, ui.ButtonSet.OK);
  } catch (e) {
    Logger.log(`debugエラー: ${e.message}\n${e.stack}`);
    ui.alert('デバッグエラー', e.message, ui.ButtonSet.OK);
  }
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
