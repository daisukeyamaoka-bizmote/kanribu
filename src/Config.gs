/**
 * 設定値の管理
 * 全ての設定値はPropertiesService(スクリプトプロパティ)に保存
 */
const Config = {
  /**
   * 初期化: 既知の設定値をスクリプトプロパティに保存
   * 既存値は上書きしない(initIfMissing方式)
   */
  initialize: function() {
    const props = PropertiesService.getScriptProperties();
    const defaults = {
      // freee関連
      'FREEE_COMPANY_ID': '10677473',
      'FREEE_INVOICE_TEMPLATE_ID': '1525088',
      'ACCOUNT_ITEM_SALES': '719439131',
      'ACCOUNT_ITEM_RECEIVABLE': '719438988',
      'TAX_CODE_10': '129',
      // freee OAuthクレデンシャル
      'FREEE_CLIENT_ID': '719693591028212',
      'FREEE_CLIENT_SECRET': 'HiyIvSKAqpv8FW9RFjYxpPEN7rpht3HZWGxED79xx_puGtX8M1hNuc-fztHbgio8zw1dI6Ff5qd_hP_DXNl3kw',
      // 会社情報
      'COMPANY_NAME': 'bizmote株式会社',
      'COMPANY_ZIP': '160-0022',
      'COMPANY_ADDRESS': '東京都新宿区新宿2丁目8番15号 パークフロント新宿 202号室',
      // インボイス制度の適格請求書発行事業者 登録番号(T + 13桁)
      'COMPANY_INVOICE_REGISTRATION_NUMBER': 'T9011001154271',
      'BANK_INFO': 'GMOあおぞらネット銀行 法人営業部 普通 1663349',
      // PDF保存先 Drive フォルダ (請求書_請求分)
      'PDF_DRIVE_FOLDER_ID': '1zCfE9PI4CD5l_yGZ9NYZF87oV_Bp5o_A',
      // メール送付 推奨アカウント (これ以外で実行すると確認ダイアログ)
      'PREFERRED_SENDER_EMAIL': 'miku.higuchi@bizmote.jp',
      // メール送付時に必ず CC に入れるアドレス (取引先CCと別建て)
      'FORCED_CC_EMAIL': 'daisuke.yamaoka@bizmote.jp',
      // Slack Incoming Webhook URL は機密情報のためコードに含めない。
      // メニュー「開発者メニュー → 5. Slack Webhook URLを設定」 から登録する。
      // 送付完了通知でメンションする Slack ユーザID (例: 'U01234567')
      // メニュー「開発者メニュー → Slack メンションユーザIDを設定」から登録する
      'SLACK_MENTION_USER_ID': '',
    };

    Object.keys(defaults).forEach(key => {
      const existing = props.getProperty(key);
      if (existing === null || existing === '') {
        props.setProperty(key, defaults[key]);
      }
    });
    Logger.log('Config初期化完了');
  },

  /**
   * 値を取得 (見つからなければエラー)
   */
  get: function(key) {
    const value = PropertiesService.getScriptProperties().getProperty(key);
    if (value === null || value === '') {
      throw new Error(`設定値が見つかりません: ${key}`);
    }
    return value;
  },

  /**
   * 数値として取得
   */
  getNumber: function(key) {
    return Number(this.get(key));
  },

  /**
   * 値を取得 (見つからなければデフォルト値を返す)
   */
  getOrDefault: function(key, defaultValue) {
    const value = PropertiesService.getScriptProperties().getProperty(key);
    return (value === null || value === '') ? defaultValue : value;
  },

  /**
   * 値を保存
   */
  set: function(key, value) {
    PropertiesService.getScriptProperties().setProperty(key, String(value));
  },
};
