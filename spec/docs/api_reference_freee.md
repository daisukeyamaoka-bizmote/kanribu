# freee API リファレンス

このドキュメントは、bizmote の freee 環境から実際に取得したサンプルレスポンスを元に作成しています。Claude Code が実装中に「APIの形式が分からない」となるのを防ぐため、生のレスポンスを掲載します。

## 認証

OAuth 2.0。詳細は `docs/operational_guide.md` の「freee OAuth 設定」を参照。

エンドポイント:
- 認可URL: `https://accounts.secure.freee.co.jp/public_api/authorize`
- トークンエンドポイント: `https://accounts.secure.freee.co.jp/public_api/token`

リクエスト時はヘッダーに `Authorization: Bearer {access_token}` を付ける。

## ベースURL

| API | ベースURL |
|---|---|
| 会計API | `https://api.freee.co.jp` |
| 請求書API | `https://api.freee.co.jp/iv` |

## 主要エンドポイント

### 会社情報取得 (会計API)

```
GET /api/1/companies/{id}
```

bizmote の company_id は `10677473`。

### 取引先一覧取得 (会計API)

```
GET /api/1/partners?company_id=10677473&limit=3000
```

#### サンプルレスポンス (1件抜粋)

```json
{
  "partners": [
    {
      "id": 73961942,
      "code": "",
      "company_id": 10677473,
      "name": "アシオット株式会社",
      "shortcut1": null,
      "shortcut2": null,
      "long_name": "アシオット株式会社",
      "name_kana": "",
      "default_title": "御中",
      "phone": "",
      "contact_name": "",
      "email": "",
      "payer_walletable_id": null,
      "transfer_fee_handling_side": "payer",
      "address_attributes": {
        "zipcode": "194-0022",
        "prefecture_code": 12,
        "street_name1": "町田市森野1丁目36-2",
        "street_name2": "セレステ町田 3F"
      },
      ...
    }
  ]
}
```

`prefecture_code` は数値で、東京は 12。`prefecture_name` は `address_attributes` 内ではなく直接フィールドにある場合もあるため、両方確認すること。

### 取引先個別取得

```
GET /api/1/partners/{id}?company_id=10677473
```

レスポンスは `{partner: {...}}` の形式。

### 取引(deal)一覧取得

```
GET /api/1/deals?company_id=10677473&type=income&status=unsettled&limit=100
```

#### サンプルレスポンス (実データ抜粋)

```json
{
  "deals": [
    {
      "id": 3474138015,
      "company_id": 10677473,
      "issue_date": "2026-03-31",
      "due_date": "2026-04-30",
      "amount": 990000,
      "due_amount": 990000,
      "type": "income",
      "partner_id": 101392484,
      "ref_number": "INV-0000000612",
      "status": "unsettled",
      "deal_origin_name": "freee請求書",
      "details": [
        {
          "id": 9429754016,
          "account_item_id": 719439131,
          "tax_code": 129,
          "amount": 990000,
          "vat": 90000,
          "description": "営業支援",
          "entry_side": "credit"
        }
      ],
      "receipts": []
    }
  ]
}
```

**重要フィールド:**
- `status`: `unsettled` (未消込) / `settled` (消込済) / `partly_settled` (一部消込)
- `due_amount`: 残額。0 になったら消込済
- `details[].account_item_id`: 売上勘定科目ID
- `tax_code`: 内部税率コード (129は10%課税の内税表示)

### 個別取引取得

```
GET /api/1/deals/{id}?company_id=10677473
```

特定の請求の入金状況を確認するときに使用 (ステップ4の消込チェックで使用)。

### 勘定科目一覧

```
GET /api/1/account_items?company_id=10677473
```

bizmote環境の主要勘定科目:

| 勘定科目名 | id | 用途 |
|---|---|---|
| 売上高 | 719439131 | 通常の売上計上 (今回採用) |
| 役務収益 | 719439135 | サービス売上の別科目 (今回不採用) |
| 売掛金 | 719438988 | 請求発行時の借方科目 |
| 仮受消費税 | 719439109 | 消費税科目 |

### 税率コード

```
GET /api/1/taxes/codes
```

主要なtax_code:

| code | 名称 | 用途 |
|---|---|---|
| 21 | 課税売上10% | 通常の売上 (今回採用) |
| 23 | 課税売上8%軽減 | 軽減税率 |
| 129 | 課税売上10% (内税表示) | レスポンス上の表示用 |

請求書作成時は `21` を使う。レスポンスで `129` が返ってくることがあるが、これは内税表示用のコードで意味は同じ。

## 請求書API

### 請求書テンプレート一覧

```
GET /invoices/templates?company_id=10677473
```

#### bizmote の現状

```json
{
  "templates": [
    { "id": 1525088, "name": "請求書テンプレ" }
  ]
}
```

template_id は `1525088` を使う。

### 請求書作成

```
POST /invoices?company_id=10677473
```

#### リクエストボディ (実装で使う完全な形)

```json
{
  "company_id": 10677473,
  "issue_date": "2026-04-30",
  "due_date": "2026-05-31",
  "partner_id": 73961942,
  "subject": "2026/04 インサイドセールス構築支援",
  "memo": "",
  "template_id": 1525088,
  "deal_attributes": {
    "create_deal": true,
    "issue_date": "2026-04-30",
    "due_date": "2026-05-31"
  },
  "invoice_contents": [
    {
      "order": 1,
      "type": "normal",
      "qty": 1,
      "unit_price": 500000,
      "vat": 50000,
      "description": "インサイドセールス構築支援 基本委託料",
      "account_item_id": 719439131,
      "tax_code": 21,
      "unit": "月"
    }
  ]
}
```

#### 重要なポイント

- `unit_price` は税抜
- `vat` は消費税額 (税抜 × 0.1 を四捨五入)
- 複数明細は `invoice_contents` 配列に追加 (各 `order` を1から連番)
- `deal_attributes.create_deal: true` で取引と仕訳を同時作成

### 請求書一覧取得

```
GET /invoices?company_id=10677473&billing_date_start=2026-04-01&billing_date_end=2026-04-30&limit=100
```

#### サンプルレスポンス (実データ抜粋)

```json
{
  "invoices": [
    {
      "id": 248193,
      "company_id": 10677473,
      "invoice_number": "INV-0000000001",
      "subject": "IVS京都 Next Pass 代金",
      "template_id": 689215,
      "billing_date": "2023-06-21",
      "issue_date": null,
      "payment_date": "2023-06-30",
      "payment_type": "transfer",
      "memo": "",
      "sending_status": "unsent",
      "payment_status": "unsettled",
      "cancel_status": "uncanceled",
      "deal_status": "unregistered",
      "deal_id": null,
      "total_amount": 53000,
      "amount_including_tax": 53000,
      "amount_excluding_tax": 48182,
      "amount_tax": 4818,
      "partner_id": 63387627,
      "partner_name": "ADS Capital Partners"
    }
  ]
}
```

### 請求書個別取得

```
GET /invoices/{id}?company_id=10677473
```

詳細な明細(`invoice_contents`)も含まれる。ステップ2の「前月コピー」機能で使う。

## エラーレスポンス

```json
{
  "status_code": 400,
  "errors": [
    {
      "type": "validation",
      "messages": ["請求金額が不正です"]
    }
  ]
}
```

エラー時はHTTPステータス >= 400 で返る。Claude Code は `errors[].messages` をユーザーに表示すること。

## レート制限

- 会計API: 1秒あたり 5リクエスト
- 請求書API: 1秒あたり 5リクエスト

一括発行で6社をループする際、各リクエスト間に最低200msのスリープを入れること:

```javascript
Utilities.sleep(300);
```

## 既知の制約

- 請求書のPDFは API 経由で直接ダウンロードできない (代替: public URL を使用、または将来的にHTML→PDF変換実装)
- 請求書作成後に `invoice_contents` を変更するには、既存を削除して再作成
- 取引先の住所更新は API では `address_attributes` 全体を送る必要がある (部分更新不可)
