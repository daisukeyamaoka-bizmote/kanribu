/**
 * 請求書PDFビルダー
 *
 * freee API は PDF ダウンロードを提供していないため、GAS 側で
 * HTML テンプレートを描画して application/pdf に変換する。
 * Utilities.newBlob(html, 'text/html').getAs('application/pdf') が
 * Apps Script の標準 HTML→PDF 変換を呼び出す。
 */
const InvoicePdfBuilder = {
  /**
   * @param {object} d - 請求書データ
   *   - invoiceNumber: 請求書番号 (例: INV-202605-003)
   *   - partnerName: 取引先名
   *   - partnerAddress: 取引先住所 (空でもOK)
   *   - issueDate: 請求日 (yyyy/MM/dd)
   *   - dueDate: 支払期日 (yyyy年MM月dd日 形式)
   *   - subject: 件名
   *   - lineItems: [{itemName, unitPrice, quantity, taxRate, subtotal}, ...]
   *   - subtotal: 税抜合計
   *   - tax: 消費税
   *   - total: 税込合計
   *   - biko: 備考(空可)
   *   - companyName / companyZip / companyAddress / bankInfo
   *   - companyRegNo: インボイス制度 適格請求書発行事業者 登録番号 (T+13桁)
   * @return {Blob} application/pdf
   */
  build: function(d) {
    const html = this.buildHtml(d);
    const safeFileName = String(d.partnerName || '').replace(/[\\\/:*?"<>|]/g, '_').trim();
    const blob = Utilities.newBlob(html, 'text/html', `${safeFileName}_${d.issueDate}.html`)
      .getAs('application/pdf');
    return blob;
  },

  /**
   * @return {string} HTML(PDF変換前の生HTML)。プレビュー用
   */
  buildHtml: function(d) {
    const itemsHtml = (d.lineItems || []).map(li => `
      <tr>
        <td>${this._escape(li.itemName)}</td>
        <td class="num">¥${(Number(li.unitPrice) || 0).toLocaleString()}</td>
        <td class="num">${Number(li.quantity) || 0}</td>
        <td class="num">${Number(li.taxRate) || 10}%</td>
        <td class="num">¥${(Number(li.subtotal) || 0).toLocaleString()}</td>
      </tr>
    `).join('');

    // 適格請求書(インボイス) 要件: 税率ごとに区分した対価の合計額・消費税額・適用税率を表示
    const taxBreakdownMap = {};
    (d.lineItems || []).forEach(li => {
      const rate = Number(li.taxRate) || 10;
      const subtotal = Number(li.subtotal) || 0;
      const vat = Math.round(subtotal * (rate / 100));
      if (!taxBreakdownMap[rate]) taxBreakdownMap[rate] = { subtotal: 0, vat: 0 };
      taxBreakdownMap[rate].subtotal += subtotal;
      taxBreakdownMap[rate].vat += vat;
    });
    const taxBreakdownRows = Object.keys(taxBreakdownMap)
      .sort((a, b) => Number(b) - Number(a))
      .map(rate => `
        <tr><td class="label">${rate}%対象(税抜)</td><td class="value">¥${taxBreakdownMap[rate].subtotal.toLocaleString()}</td></tr>
        <tr><td class="label">${rate}%消費税</td><td class="value">¥${taxBreakdownMap[rate].vat.toLocaleString()}</td></tr>
      `).join('');

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>請求書 ${this._escape(d.invoiceNumber || '')}</title>
<style>
  @page { size: A4; margin: 18mm; }
  body { font-family: 'Hiragino Kaku Gothic Pro', 'Yu Gothic', 'Meiryo', sans-serif; color: #000; font-size: 11pt; line-height: 1.5; }
  .title { text-align: center; font-size: 22pt; letter-spacing: 8pt; padding: 6pt 0 18pt; border-bottom: 2px solid #000; }
  .header { display: table; width: 100%; margin-top: 16pt; }
  .header-cell { display: table-cell; vertical-align: top; }
  .partner { font-size: 14pt; font-weight: bold; }
  .partner-suffix { font-size: 12pt; padding-left: 4pt; }
  .partner-address { font-size: 10pt; color: #000; margin-top: 4pt; }
  .meta { font-size: 10pt; text-align: right; }
  .meta div { margin: 2pt 0; }
  .meta b { display: inline-block; min-width: 70pt; text-align: left; }
  .subject { margin-top: 18pt; font-size: 13pt; font-weight: bold; padding: 8pt 0; }
  .total-banner { margin-top: 14pt; padding: 12pt 0; text-align: right; color: #000; font-size: 16pt; font-weight: bold; border-top: 1px solid #000; border-bottom: 1px solid #000; }
  table.lines { width: 100%; border-collapse: collapse; margin-top: 18pt; font-size: 10pt; }
  table.lines th { background: #000; color: #fff; padding: 6pt 8pt; text-align: left; font-weight: 600; }
  table.lines th.num { text-align: right; }
  table.lines td { padding: 6pt 8pt; border-bottom: 1px solid #000; }
  table.lines td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .summary { margin-top: 8pt; width: 100%; }
  .summary table { margin-left: auto; border-collapse: collapse; }
  .summary td { padding: 4pt 12pt; }
  .summary .label { text-align: right; color: #000; }
  .summary .value { text-align: right; font-variant-numeric: tabular-nums; min-width: 100pt; }
  .summary .total-row td { border-top: 2px solid #000; font-weight: bold; font-size: 12pt; padding-top: 6pt; }
  .biko { margin-top: 22pt; padding: 10pt 14pt; background: #F5F5F5; white-space: pre-wrap; font-size: 10pt; }
  .footer { margin-top: 28pt; padding-top: 14pt; border-top: 1px solid #000; display: table; width: 100%; font-size: 10pt; }
  .footer-cell { display: table-cell; vertical-align: top; padding-right: 18pt; }
  .footer-cell:last-child { padding-right: 0; }
  .footer-label { font-size: 9pt; color: #000; margin-bottom: 4pt; }
  .footer-value { line-height: 1.6; }
  .footer-value b { font-size: 11pt; }
</style>
</head>
<body>
  <div class="title">請 求 書</div>

  <div class="header">
    <div class="header-cell" style="width: 60%;">
      <div><span class="partner">${this._escape(d.partnerName || '')}</span><span class="partner-suffix">御中</span></div>
      ${d.partnerAddress ? `<div class="partner-address">${this._escape(d.partnerAddress)}</div>` : ''}
    </div>
    <div class="header-cell meta" style="width: 40%;">
      <div><b>請求書番号</b> ${this._escape(d.invoiceNumber || '')}</div>
      <div><b>請求日</b> ${this._escape(d.issueDate || '')}</div>
      <div><b>支払期日</b> ${this._escape(d.dueDate || '')}</div>
    </div>
  </div>

  ${d.subject ? `<div class="subject">件名: ${this._escape(d.subject)}</div>` : ''}

  <div class="total-banner">ご請求金額: ¥${(Number(d.total) || 0).toLocaleString()}(税込)</div>

  <table class="lines">
    <thead>
      <tr>
        <th>品目</th>
        <th class="num">単価(税抜)</th>
        <th class="num">数量</th>
        <th class="num">税率</th>
        <th class="num">小計(税抜)</th>
      </tr>
    </thead>
    <tbody>
      ${itemsHtml}
    </tbody>
  </table>

  <div class="summary">
    <table>
      <tr><td class="label">小計(税抜)</td><td class="value">¥${(Number(d.subtotal) || 0).toLocaleString()}</td></tr>
      ${taxBreakdownRows}
      <tr class="total-row"><td class="label">税込合計</td><td class="value">¥${(Number(d.total) || 0).toLocaleString()}</td></tr>
    </table>
  </div>

  ${d.biko ? `<div class="biko"><b>備考</b><br>${this._escape(d.biko)}</div>` : ''}

  <div class="footer">
    <div class="footer-cell" style="width: 50%;">
      <div class="footer-label">発行元</div>
      <div class="footer-value">
        <b>${this._escape(d.companyName || '')}</b><br>
        ${this._escape(d.companyZip || '')}<br>
        ${this._escape(d.companyAddress || '')}
        ${d.companyRegNo ? `<br>登録番号: ${this._escape(d.companyRegNo)}` : ''}
      </div>
    </div>
    <div class="footer-cell" style="width: 50%;">
      <div class="footer-label">お振込先</div>
      <div class="footer-value">${this._escape(d.bankInfo || '')}</div>
    </div>
  </div>
</body>
</html>`;
  },

  _escape: function(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },
};
