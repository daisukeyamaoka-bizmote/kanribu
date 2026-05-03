/**
 * freee API クライアント
 * 会計API + 請求書API のラッパー
 *
 * 認証はFreeeOAuth経由(OAuth2ライブラリでアクセストークン自動更新)
 */
const FreeeClient = {
  ENDPOINTS: {
    ACCOUNTING: 'https://api.freee.co.jp',
    INVOICE: 'https://api.freee.co.jp/iv',
  },

  /**
   * 共通リクエスト処理
   */
  request: function(service, method, path, payload) {
    const baseUrl = service === 'invoice' ? this.ENDPOINTS.INVOICE : this.ENDPOINTS.ACCOUNTING;
    const url = baseUrl + path;
    const token = FreeeOAuth.getAccessToken();

    const options = {
      method: method.toLowerCase(),
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        'X-Api-Version': '2020-06-15',
      },
      muteHttpExceptions: true,
    };

    if (payload && (method === 'POST' || method === 'PUT')) {
      options.payload = JSON.stringify(payload);
    }

    const response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();
    const body = response.getContentText();

    if (code >= 400) {
      Logger.log(`freee APIエラー [${method} ${path}] HTTP ${code}: ${body}`);
      throw new Error(`freee API ${code}: ${body}`);
    }

    Utilities.sleep(200);
    return JSON.parse(body);
  },

  getCompany: function() {
    const companyId = Config.get('FREEE_COMPANY_ID');
    const data = this.request('accounting', 'GET', `/api/1/companies/${companyId}?details=true`);
    return data.company;
  },

  listPartners: function() {
    const companyId = Config.get('FREEE_COMPANY_ID');
    const data = this.request('accounting', 'GET', `/api/1/partners?company_id=${companyId}&limit=3000`);
    return data.partners || [];
  },

  getPartner: function(partnerId) {
    const companyId = Config.get('FREEE_COMPANY_ID');
    const data = this.request('accounting', 'GET', `/api/1/partners/${partnerId}?company_id=${companyId}`);
    return data.partner;
  },

  listInvoices: function(opts) {
    opts = opts || {};
    const companyId = Config.get('FREEE_COMPANY_ID');
    const params = [`company_id=${companyId}`, `limit=${opts.limit || 100}`];
    if (opts.partnerId) params.push(`partner_id=${opts.partnerId}`);
    if (opts.dateStart) params.push(`billing_date_start=${opts.dateStart}`);
    if (opts.dateEnd) params.push(`billing_date_end=${opts.dateEnd}`);

    const data = this.request('invoice', 'GET', '/invoices?' + params.join('&'));
    return data.invoices || [];
  },

  getInvoice: function(invoiceId) {
    const companyId = Config.get('FREEE_COMPANY_ID');
    const data = this.request('invoice', 'GET', `/invoices/${invoiceId}?company_id=${companyId}`);
    return data.invoice;
  },

  createInvoice: function(payload) {
    const companyId = Config.get('FREEE_COMPANY_ID');
    const data = this.request('invoice', 'POST', `/invoices?company_id=${companyId}`, payload);
    return data.invoice;
  },

  listDeals: function(opts) {
    opts = opts || {};
    const companyId = Config.get('FREEE_COMPANY_ID');
    const params = [`company_id=${companyId}`, 'type=income', `limit=${opts.limit || 100}`];
    if (opts.status) params.push(`status=${opts.status}`);
    if (opts.partnerId) params.push(`partner_id=${opts.partnerId}`);

    const data = this.request('accounting', 'GET', '/api/1/deals?' + params.join('&'));
    return data.deals || [];
  },

  getDeal: function(dealId) {
    const companyId = Config.get('FREEE_COMPANY_ID');
    const data = this.request('accounting', 'GET', `/api/1/deals/${dealId}?company_id=${companyId}`);
    return data.deal;
  },
};
