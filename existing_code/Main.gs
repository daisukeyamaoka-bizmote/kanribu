/**
 * bizmote 請求書管理システム
 * メインエントリーポイント
 *
 * 注意: このファイルは山岡さんが手作業で実装した現状版です
 * Claude Code はこれを基準にOAuthフローを追加で実装してください
 */

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('請求管理')
    .addSubMenu(
      ui.createMenu('開発者メニュー')
        .addItem('1. 初期設定', 'setupInitialConfig')
        .addItem('2. freeeトークン取得(認可コードから)', 'exchangeAuthCodeForToken')
        .addItem('3. freee接続テスト', 'testFreeeConnection')
        .addItem('4. クライアントマスタ確認', 'testReadClientMaster')
        .addItem('5. 過去請求一覧取得', 'testListInvoices')
    )
    .addToUi();
}

function setupInitialConfig() {
  Config.initialize();
  SpreadsheetApp.getUi().alert(
    '初期設定完了',
    'スクリプトプロパティに設定値を保存しました。\n\n' +
    '次は「2. freeeトークン設定」を実行してください。',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function setFreeeTokenManually() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(
    'freeeアクセストークン設定',
    'freee開発者ポータルで取得したアクセストークンを貼り付けてください:',
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return;

  const token = response.getResponseText().trim();
  if (!token) {
    ui.alert('トークンが空です');
    return;
  }

  PropertiesService.getScriptProperties().setProperty('FREEE_ACCESS_TOKEN', token);
  ui.alert('トークンを保存しました。\n次は「3. freee接続テスト」を実行してください。');
}

function testFreeeConnection() {
  try {
    const company = FreeeClient.getCompany();
    SpreadsheetApp.getUi().alert(
      'freee接続成功',
      `会社名: ${company.name}\n` +
      `事業所ID: ${company.id}\n` +
      `期首月: ${company.start_month}月`,
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

/**
 * freeeの認可コードをアクセストークンに変換して保存
 * 注意: この関数はOAuth実装後は不要になる(認可コードは6時間で期限切れのため恒久解決にならない)
 */
function exchangeAuthCodeForToken() {
  const clientId = '719693591028212';
  const clientSecret = 'HiyIvSKAqpv8FW9RFjYxpPEN7rpht3HZWGxED79xx_puGtX8M1hNuc-fztHbgio8zw1dI6Ff5qd_hP_DXNl3kw';
  const authCode = 'L5PmgdgeL50sIAefDnjAM7v3fc19K7uWH-rls95Kp0Y';
  const redirectUri = 'urn:ietf:wg:oauth:2.0:oob';

  const url = 'https://accounts.secure.freee.co.jp/public_api/token';
  const payload = {
    'grant_type': 'authorization_code',
    'client_id': clientId,
    'client_secret': clientSecret,
    'code': authCode,
    'redirect_uri': redirectUri,
  };

  const options = {
    method: 'post',
    payload: payload,
    muteHttpExceptions: true,
  };

  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();
  const body = response.getContentText();

  Logger.log(`HTTP ${code}`);
  Logger.log(body);

  if (code !== 200) {
    SpreadsheetApp.getUi().alert(
      'トークン取得失敗',
      `HTTP ${code}\n${body}\n\n認可コードが期限切れの可能性があります。\n再度認可URLにアクセスして新しいコードを取得してください。`,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
    return;
  }

  const data = JSON.parse(body);
  const props = PropertiesService.getScriptProperties();
  props.setProperty('FREEE_ACCESS_TOKEN', data.access_token);
  props.setProperty('FREEE_REFRESH_TOKEN', data.refresh_token);
  props.setProperty('FREEE_TOKEN_EXPIRES_AT', String(Date.now() + data.expires_in * 1000));
  props.setProperty('FREEE_CLIENT_ID', clientId);
  props.setProperty('FREEE_CLIENT_SECRET', clientSecret);

  SpreadsheetApp.getUi().alert(
    'トークン取得成功',
    `アクセストークンを取得しました。\n` +
    `有効期限: ${Math.round(data.expires_in / 3600)}時間\n` +
    `リフレッシュトークンも保存済み。\n\n` +
    `次は「請求管理」→「開発者メニュー」→「3. freee接続テスト」を実行してください。`,
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}
