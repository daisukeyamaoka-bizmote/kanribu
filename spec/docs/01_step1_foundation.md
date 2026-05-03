# ステップ1: 基盤構築

## 目的

GAS プロジェクトの土台を作る。freee API への疎通確認とスプレッドシート操作の共通関数を実装する。このステップが完成すれば、ステップ2以降の実装で API 呼び出しやシート操作の細かい記述に悩まされない。

## 完了条件 (このステップが終わったと言える状態)

- スプレッドシートを開くとカスタムメニュー「請求管理」が表示される
- メニューから「freee接続テスト」を実行すると、自社情報がポップアップで表示される
- メニューから「6社の請求一覧を読込」を実行すると、freeeから過去3ヶ月の請求実績がログに出る
- 設定値 (company_id, template_id, 勘定科目IDなど) は全て PropertiesService から取得される

## 実装するファイル

### Config.gs

設定値の一元管理。ハードコードを禁止する代わりに、PropertiesService に保存して Config.get() で読み出す。

```javascript
const Config = {
  get: function(key) {
    const value = PropertiesService.getScriptProperties().getProperty(key);
    if (value === null) {
      throw new Error(`設定値が見つかりません: ${key}`);
    }
    return value;
  },

  getNumber: function(key) {
    return Number(this.get(key));
  },

  getJson: function(key) {
    return JSON.parse(this.get(key));
  },

  // 初期セットアップ (メニューから実行)
  initialize: function() {
    const props = PropertiesService.getScriptProperties();
    props.setProperties({
      'FREEE_COMPANY_ID': '10677473',
      'FREEE_INVOICE_TEMPLATE_ID': '1525088',
      'ACCOUNT_ITEM_SALES': '719439131',
      'ACCOUNT_ITEM_RECEIVABLE': '719438988',
      'TAX_CODE_10': '21',
      'COMPANY_NAME': 'bizmote株式会社',
      'COMPANY_ZIP': '160-0023',
      'COMPANY_ADDRESS': '東京都新宿区西新宿4-8-11 SHINJUKU NEW VILLA 203',
      'BANK_INFO': 'GMOあおぞらネット銀行 法人営業部 普通 1663349',
      // 以下は山岡が後で設定
      'PDF_DRIVE_FOLDER_ID': '',
      'SLACK_WEBHOOK_URL': '',
      'FREEE_ACCESS_TOKEN': '',
      'FREEE_REFRESH_TOKEN': '',
    });
  }
};
```

### FreeeClient.gs

freee API のラッパー。OAuth トークンの自動リフレッシュを含む。

#### 認証

freee API は OAuth 2.0。アクセストークンの有効期限は6時間。期限切れ時に自動で refresh_token を使ってリフレッシュする実装が必要。

```javascript
const FreeeClient = {
  ENDPOINTS: {
    ACCOUNTING: 'https://api.freee.co.jp',
    INVOICE: 'https://api.freee.co.jp/iv',
  },

  getAccessToken: function() {
    const expiresAt = Number(PropertiesService.getScriptProperties().getProperty('FREEE_TOKEN_EXPIRES_AT') || 0);
    if (Date.now() < expiresAt - 60000) {
      return Config.get('FREEE_ACCESS_TOKEN');
    }
    // リフレッシュ
    return this.refreshAccessToken();
  },

  refreshAccessToken: function() {
    const refreshToken = Config.get('FREEE_REFRESH_TOKEN');
    const clientId = Config.get('FREEE_CLIENT_ID');
    const clientSecret = Config.get('FREEE_CLIENT_SECRET');

    const response = UrlFetchApp.fetch('https://accounts.secure.freee.co.jp/public_api/token', {
      method: 'post',
      payload: {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      },
      muteHttpExceptions: true,
    });

    if (response.getResponseCode() !== 200) {
      throw new Error('freeeトークンリフレッシュ失敗: ' + response.getContentText());
    }

    const data = JSON.parse(response.getContentText());
    const props = PropertiesService.getScriptProperties();
    props.setProperty('FREEE_ACCESS_TOKEN', data.access_token);
    props.setProperty('FREEE_REFRESH_TOKEN', data.refresh_token);
    props.setProperty('FREEE_TOKEN_EXPIRES_AT', String(Date.now() + data.expires_in * 1000));
    return data.access_token;
  },

  request: function(service, method, path, payload) {
    const baseUrl = service === 'invoice' ? this.ENDPOINTS.INVOICE : this.ENDPOINTS.ACCOUNTING;
    const url = baseUrl + path;

    const options = {
      method: method.toLowerCase(),
      headers: {
        'Authorization': 'Bearer ' + this.getAccessToken(),
        'Content-Type': 'application/json',
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
      Logger.log(`freee API エラー [${method} ${path}] ${code}: ${body}`);
      throw new Error(`freee API ${code}: ${body}`);
    }

    return JSON.parse(body);
  },

  // === 高レベル API ===

  getCompany: function() {
    const data = this.request('accounting', 'GET', '/api/1/companies/' + Config.get('FREEE_COMPANY_ID'));
    return data.company;
  },

  listPartners: function() {
    const params = `?company_id=${Config.get('FREEE_COMPANY_ID')}&limit=3000`;
    return this.request('accounting', 'GET', '/api/1/partners' + params).partners;
  },

  getPartner: function(partnerId) {
    const params = `?company_id=${Config.get('FREEE_COMPANY_ID')}`;
    return this.request('accounting', 'GET', `/api/1/partners/${partnerId}${params}`).partner;
  },

  listInvoices: function(opts) {
    opts = opts || {};
    const params = [
      `company_id=${Config.get('FREEE_COMPANY_ID')}`,
      `limit=${opts.limit || 100}`,
    ];
    if (opts.partnerId) params.push(`partner_id=${opts.partnerId}`);
    if (opts.dateStart) params.push(`billing_date_start=${opts.dateStart}`);
    if (opts.dateEnd) params.push(`billing_date_end=${opts.dateEnd}`);
    return this.request('invoice', 'GET', '/invoices?' + params.join('&')).invoices;
  },

  createInvoice: function(payload) {
    // payload は createInvoicePayload() で構築 (ステップ3で実装)
    return this.request('invoice', 'POST', `/invoices?company_id=${Config.get('FREEE_COMPANY_ID')}`, payload).invoice;
  },

  listDeals: function(opts) {
    opts = opts || {};
    const params = [
      `company_id=${Config.get('FREEE_COMPANY_ID')}`,
      `type=income`,
      `limit=${opts.limit || 100}`,
    ];
    if (opts.status) params.push(`status=${opts.status}`);
    if (opts.partnerId) params.push(`partner_id=${opts.partnerId}`);
    return this.request('accounting', 'GET', '/api/1/deals?' + params.join('&')).deals;
  },
};
```

### SheetUtil.gs

スプレッドシート操作の共通関数。

```javascript
const SheetUtil = {
  SS: SpreadsheetApp.getActiveSpreadsheet(),

  getSheet: function(name) {
    const sheet = this.SS.getSheetByName(name);
    if (!sheet) throw new Error(`シートが見つかりません: ${name}`);
    return sheet;
  },

  // ヘッダー行(2行目までスキップ、3行目以降がデータ)を読んでオブジェクト配列で返す
  readAsObjects: function(sheetName, headerRow, dataStartRow) {
    headerRow = headerRow || 1;
    dataStartRow = dataStartRow || 3;

    const sheet = this.getSheet(sheetName);
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();

    if (lastRow < dataStartRow) return [];

    const headers = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0];
    const rows = sheet.getRange(dataStartRow, 1, lastRow - dataStartRow + 1, lastCol).getValues();

    return rows
      .filter(row => row.some(cell => cell !== ''))
      .map((row, index) => {
        const obj = { _rowNumber: dataStartRow + index };
        headers.forEach((header, i) => {
          obj[header] = row[i];
        });
        return obj;
      });
  },

  // 特定行の特定列を更新
  updateRow: function(sheetName, rowNumber, updates) {
    const sheet = this.getSheet(sheetName);
    const lastCol = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

    Object.keys(updates).forEach(key => {
      const colIndex = headers.indexOf(key);
      if (colIndex < 0) {
        Logger.log(`警告: 列 "${key}" が見つかりません`);
        return;
      }
      sheet.getRange(rowNumber, colIndex + 1).setValue(updates[key]);
    });
  },

  // 行を末尾に追加
  appendRow: function(sheetName, rowData) {
    const sheet = this.getSheet(sheetName);
    const lastCol = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

    const row = headers.map(header => rowData[header] !== undefined ? rowData[header] : '');
    sheet.appendRow(row);
  },
};
```

### Main.gs

メニュー登録とエントリーポイント。

```javascript
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('請求管理')
    .addItem('オーナー入力フォームを開く', 'openInputForm')
    .addItem('承認画面を開く (経理用)', 'openApprovalView')
    .addSeparator()
    .addItem('一括発行・送付', 'runIssueAndSend')
    .addSeparator()
    .addItem('クライアント管理', 'openClientManager')
    .addItem('freee取引先と同期', 'syncFreeePartners')
    .addItem('未消込チェック', 'runReconcileCheck')
    .addSeparator()
    .addSubMenu(
      SpreadsheetApp.getUi().createMenu('開発者メニュー')
        .addItem('初期設定', 'setupInitialConfig')
        .addItem('freee接続テスト', 'testFreeeConnection')
        .addItem('6社の請求一覧を読込', 'testListInvoices')
    )
    .addToUi();
}

function setupInitialConfig() {
  Config.initialize();
  SpreadsheetApp.getUi().alert('初期設定完了。スクリプトプロパティに値が保存されました。次にOAuth認証を行ってください。');
}

function testFreeeConnection() {
  try {
    const company = FreeeClient.getCompany();
    SpreadsheetApp.getUi().alert(
      'freee接続OK\n\n' +
      `会社名: ${company.name}\n` +
      `事業所ID: ${company.id}\n` +
      `期首: ${company.start_month}月`
    );
  } catch (e) {
    SpreadsheetApp.getUi().alert('freee接続エラー\n\n' + e.message);
  }
}

function testListInvoices() {
  const today = new Date();
  const threeMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 3, 1);
  const dateStart = Utilities.formatDate(threeMonthsAgo, 'JST', 'yyyy-MM-dd');
  const dateEnd = Utilities.formatDate(today, 'JST', 'yyyy-MM-dd');

  const invoices = FreeeClient.listInvoices({ dateStart, dateEnd, limit: 100 });
  Logger.log(`取得件数: ${invoices.length}`);
  invoices.slice(0, 10).forEach(inv => {
    Logger.log(`${inv.invoice_number} | ${inv.partner_name} | ¥${inv.total_amount} | ${inv.payment_status}`);
  });
  SpreadsheetApp.getUi().alert(`過去3ヶ月の請求書を ${invoices.length} 件取得しました。詳細はログを確認してください。`);
}
```

## OAuth 認証セットアップ手順 (Claude Code が README に書く)

GAS から freee に接続するには、freee 開発者ポータルでアプリ登録が必要。以下を README に記載:

1. https://app.secure.freee.co.jp/developers/applications で「新規アプリケーション作成」
2. アプリ種別: 「プライベートアプリ」
3. コールバックURL: `https://script.google.com/macros/d/{SCRIPT_ID}/usercallback`
4. アクセス可能な事業所: bizmote株式会社 のみ
5. スコープ: `read`, `write`
6. 発行された Client ID, Client Secret を Properties Service に登録
7. 認可URLにアクセスして認可コードを取得 → アクセストークン・リフレッシュトークンに変換 → Properties Service に登録

詳細は `docs/operational_guide.md` の「freee OAuth 設定」セクション参照。

## 動作確認手順

1. `setupInitialConfig` を実行 → 「初期設定完了」のアラートが出ること
2. freee OAuth 認証を完了 (上記手順)
3. `testFreeeConnection` を実行 → bizmote株式会社の情報が表示されること
4. `testListInvoices` を実行 → 過去3ヶ月の請求書件数が表示されること

ここまで動けばステップ1完了。山岡に動作確認を依頼してください。
