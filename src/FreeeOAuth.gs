/**
 * freee OAuth 2.0 認証管理
 * OAuth2ライブラリを使ってアクセストークンの自動更新を実現
 *
 * 必要な事前作業:
 * 1. Apps Script の「ライブラリ」に OAuth2 を追加
 *    スクリプトID: 1B7FSrk5Zi6L1rSxxTDgDEUsPzlukDsi4KGuTMorsTQHhGBzBkMun4iDF
 *    識別子: OAuth2 (デフォルト)
 *    バージョン: 最新
 * 2. freee 開発者ポータルで以下のコールバックURLを設定
 *    https://script.google.com/macros/d/{スクリプトID}/usercallback
 */
const FreeeOAuth = {
  AUTH_URL: 'https://accounts.secure.freee.co.jp/public_api/authorize',
  TOKEN_URL: 'https://accounts.secure.freee.co.jp/public_api/token',
  CALLBACK_FUNCTION_NAME: 'freeeOAuthCallback',
  SERVICE_NAME: 'freee',

  /**
   * OAuth2サービスインスタンスを取得
   */
  getService: function() {
    return OAuth2.createService(this.SERVICE_NAME)
      .setAuthorizationBaseUrl(this.AUTH_URL)
      .setTokenUrl(this.TOKEN_URL)
      .setClientId(Config.get('FREEE_CLIENT_ID'))
      .setClientSecret(Config.get('FREEE_CLIENT_SECRET'))
      .setCallbackFunction(this.CALLBACK_FUNCTION_NAME)
      .setPropertyStore(PropertiesService.getScriptProperties())
      .setCache(CacheService.getScriptCache())
      .setLock(LockService.getScriptLock())
      .setParam('prompt', 'select_company');
  },

  /**
   * 認証済みかどうか
   */
  hasAccess: function() {
    return this.getService().hasAccess();
  },

  /**
   * アクセストークン取得 (期限切れ時は自動更新)
   */
  getAccessToken: function() {
    const service = this.getService();
    if (!service.hasAccess()) {
      throw new Error(
        'freee未認証です。スプレッドシートのメニュー\n' +
        '「請求管理 → 開発者メニュー → 2. freee認証開始」を実行してください。'
      );
    }
    return service.getAccessToken();
  },

  /**
   * 認可URLを取得
   */
  getAuthorizationUrl: function() {
    return this.getService().getAuthorizationUrl();
  },

  /**
   * 認可情報をリセット
   */
  reset: function() {
    this.getService().reset();
  },
};

/**
 * freee認可後の戻り口(freee開発者ポータルのコールバックURLから呼ばれる)
 *
 * 関数名は FreeeOAuth.CALLBACK_FUNCTION_NAME と一致させること。
 * グローバル関数として定義する必要があるため FreeeOAuth.* ではなくトップレベルに置く。
 */
function freeeOAuthCallback(request) {
  const service = FreeeOAuth.getService();
  const isAuthorized = service.handleCallback(request);

  if (isAuthorized) {
    return HtmlService.createHtmlOutput(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>freee認証成功</title>' +
      '<style>body{font-family:sans-serif;padding:24px;line-height:1.7;}h2{color:#1E3A5F;}</style>' +
      '</head><body>' +
      '<h2>freee 認証成功</h2>' +
      '<p>このタブは閉じてOKです。</p>' +
      '<p>スプレッドシートに戻り、メニュー「請求管理 → 開発者メニュー → 5. freee接続テスト」で動作確認してください。</p>' +
      '</body></html>'
    );
  }
  return HtmlService.createHtmlOutput(
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>freee認証失敗</title>' +
    '<style>body{font-family:sans-serif;padding:24px;line-height:1.7;}h2{color:#B00020;}</style>' +
    '</head><body>' +
    '<h2>freee 認証失敗</h2>' +
    '<p>このタブを閉じて再度認証を試してください。</p>' +
    '<p>解決しない場合: コールバックURLが freee 開発者ポータルに正しく設定されているか確認してください。</p>' +
    '<pre>https://script.google.com/macros/d/{スクリプトID}/usercallback</pre>' +
    '</body></html>'
  );
}

/**
 * メニューから呼ばれる: freee認証開始
 * 認可URLを表示してユーザにブラウザで開いてもらう
 */
function startFreeeOAuth() {
  const ui = SpreadsheetApp.getUi();
  try {
    const service = FreeeOAuth.getService();
    if (service.hasAccess()) {
      const result = ui.alert(
        'freee認証',
        '既にfreeeに認証済みです。再認証しますか?\n\n' +
        '「はい」を選ぶと現在の認証をリセットして再認証画面に進みます。',
        ui.ButtonSet.YES_NO
      );
      if (result !== ui.Button.YES) return;
      service.reset();
    }

    const authUrl = FreeeOAuth.getAuthorizationUrl();
    const html = HtmlService.createHtmlOutput(
      '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<style>body{font-family:sans-serif;padding:16px;line-height:1.7;font-size:13px;}' +
      'a.btn{display:inline-block;background:#1E3A5F;color:white;padding:10px 16px;' +
      'border-radius:4px;text-decoration:none;margin:8px 0;}' +
      '.note{color:#666;font-size:12px;}</style></head><body>' +
      '<p>下記ボタンをクリックして freee 認証を完了してください。</p>' +
      '<p><a class="btn" href="' + authUrl + '" target="_blank" rel="noopener">freee で認証する</a></p>' +
      '<p class="note">認証後、別タブに「freee 認証成功」と表示されます。' +
      'そのタブを閉じて、このダイアログも閉じてください。</p>' +
      '</body></html>'
    ).setWidth(420).setHeight(220);
    ui.showModalDialog(html, 'freee 認証');
  } catch (e) {
    ui.alert('認証開始エラー', e.message, ui.ButtonSet.OK);
  }
}

/**
 * メニューから呼ばれる: 認証状態を確認
 */
function checkFreeeOAuthStatus() {
  const ui = SpreadsheetApp.getUi();
  const service = FreeeOAuth.getService();
  if (service.hasAccess()) {
    ui.alert(
      'freee認証状態',
      '認証済みです。\n' +
      'アクセストークン取得OK(期限切れ時は自動更新されます)\n\n' +
      '接続テストは「5. freee接続テスト」を実行してください。',
      ui.ButtonSet.OK
    );
  } else {
    ui.alert(
      'freee認証状態',
      '未認証です。\n\n' +
      '「2. freee認証開始」を実行してください。',
      ui.ButtonSet.OK
    );
  }
}

/**
 * メニューから呼ばれる: 認証リセット
 */
function resetFreeeOAuth() {
  const ui = SpreadsheetApp.getUi();
  const result = ui.alert(
    'freee認証リセット',
    '保存されているアクセストークン・リフレッシュトークンを削除します。\n' +
    'この操作後、再度「freee認証開始」が必要になります。\n\n' +
    '本当にリセットしますか?',
    ui.ButtonSet.YES_NO
  );
  if (result !== ui.Button.YES) return;
  FreeeOAuth.reset();
  ui.alert(
    'リセット完了',
    '認証情報をリセットしました。「2. freee認証開始」を実行して再認証してください。',
    ui.ButtonSet.OK
  );
}
