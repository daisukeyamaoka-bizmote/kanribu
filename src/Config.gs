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
      'TAX_CODE_10': '21',
      // freee OAuthクレデンシャル
      'FREEE_CLIENT_ID': '719693591028212',
      'FREEE_CLIENT_SECRET': 'HiyIvSKAqpv8FW9RFjYxpPEN7rpht3HZWGxED79xx_puGtX8M1hNuc-fztHbgio8zw1dI6Ff5qd_hP_DXNl3kw',
      // 会社情報
      'COMPANY_NAME': 'bizmote株式会社',
      'COMPANY_ZIP': '160-0023',
      'COMPANY_ADDRESS': '東京都新宿区西新宿4-8-11 SHINJUKU NEW VILLA 203',
      'BANK_INFO': 'GMOあおぞらネット銀行 法人営業部 普通 1663349',
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
