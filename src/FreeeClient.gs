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

  /**
   * 取引(deal)を作成する (会計API)
   * 請求書APIには取引登録機能が無いため、売掛金/売上の仕訳はこちらで登録する。
   * @param {object} payload - deal 作成パラメータ (company_id を含むこと)
   * @return {object} 作成された deal
   */
  createDeal: function(payload) {
    const data = this.request('accounting', 'POST', '/api/1/deals', payload);
    return data.deal;
  },

  /**
   * 請求書をfreeeから取引先にメール送信させる (freee内部の送付機能を使う)
   * @param {object} payload - sendings API の本体
   * @return {object} レスポンス
   */
  sendInvoice: function(payload) {
    return this.request('invoice', 'POST', '/sendings', payload);
  },

  /**
   * 請求書PDFをダウンロード(バイナリ)
   * 複数のエンドポイント候補を順番に試す(freee の API 仕様が不安定なため)
   * @param {number|string} freeeInvoiceId
   * @return {Blob} PDFバイナリ
   */
  downloadInvoicePdf: function(freeeInvoiceId) {
    const companyId = Config.get('FREEE_COMPANY_ID');
    const token = FreeeOAuth.getAccessToken();

    const candidates = [
      this.ENDPOINTS.INVOICE + `/invoices/${freeeInvoiceId}/pdf?company_id=${companyId}`,
      this.ENDPOINTS.INVOICE + `/invoices/${freeeInvoiceId}/preview_pdf?company_id=${companyId}`,
      this.ENDPOINTS.ACCOUNTING + `/api/1/invoices/${freeeInvoiceId}/download_pdf?company_id=${companyId}`,
      this.ENDPOINTS.INVOICE + `/invoices/${freeeInvoiceId}/download?company_id=${companyId}`,
    ];

    const errors = [];
    for (let i = 0; i < candidates.length; i++) {
      const url = candidates[i];
      const response = UrlFetchApp.fetch(url, {
        method: 'get',
        headers: { 'Authorization': 'Bearer ' + token },
        muteHttpExceptions: true,
      });
      const code = response.getResponseCode();
      const contentType = response.getHeaders()['Content-Type'] || '';

      if (code < 400 && contentType.indexOf('application/pdf') !== -1) {
        Logger.log(`PDFダウンロード成功 (${i + 1}番目の候補): ${url}`);
        Utilities.sleep(200);
        return response.getBlob().setContentType('application/pdf');
      }
      errors.push(`[${i + 1}] ${url} → HTTP ${code} (${contentType}): ${response.getContentText().substring(0, 200)}`);
    }

    throw new Error('freee PDFダウンロード失敗: 全候補で失敗\n' + errors.join('\n'));
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
