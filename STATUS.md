# 現在の進捗状況

最終更新: 2026年5月3日

## ステップ1: 完了済み

以下が動作確認済み:

### 構築済みのもの

- **Googleスプレッドシート**: `bizmote_invoice_phase1_v2`
- **Apps Scriptプロジェクト**: 上記スプレッドシートに紐付き済み
- **実装済みファイル**:
  - `Main.gs` (メニュー登録、テスト関数)
  - `Config.gs` (設定値管理)
  - `FreeeClient.gs` (freee APIクライアント)
  - `SheetUtil.gs` (スプレッドシート操作ユーティリティ)
- **シート構造**:
  - README_使い方
  - 01_クライアントマスタ (6社のデータ入り)
  - 02_品目テンプレート (9行のテンプレ)
  - 03_請求一覧 (空、ヘッダーのみ)
  - 99_freee設定

### 動作確認済み

- スプレッドシートのメニュー「請求管理」表示
- 「1. 初期設定」実行 → 設定値保存成功
- 「3. freee接続テスト」実行 → bizmote株式会社の情報取得成功
- 「4. クライアントマスタ確認」実行 → 6社読み込み成功
- 「5. 過去請求一覧取得」実行 → 過去請求の取得成功

## 重要な課題

### 課題1: トークンの永続化(最優先で解決)

**現状**: freeeアクセストークンは認可コードフロー経由で取得済みだが、**6時間で期限切れ**になる。
**現状のスクリプトプロパティ**:
- `FREEE_ACCESS_TOKEN`: 設定済み(失効済みの可能性大)
- `FREEE_REFRESH_TOKEN`: 設定済み
- `FREEE_CLIENT_ID`: `719693591028212`
- `FREEE_CLIENT_SECRET`: `HiyIvSKAqpv8FW9RFjYxpPEN7rpht3HZWGxED79xx_puGtX8M1hNuc-fztHbgio8zw1dI6Ff5qd_hP_DXNl3kw`
- `FREEE_TOKEN_EXPIRES_AT`: 設定済み

**やってほしい対応**: OAuth2ライブラリを組み込んでトークン自動更新を実装する。

#### OAuth2ライブラリ追加手順

1. Apps Scriptエディタの「ライブラリ」→「+」追加
2. スクリプトID: `1B7FSrk5Zi6L1rSxxTDgDEUsPzlukDsi4KGuTMorsTQHhGBzBkMun4iDF`
3. バージョン: 最新を選択
4. 識別子: `OAuth2`(デフォルト)

#### コード実装ポイント

`FreeeClient.gs` の `request` 関数の中で、トークン取得部分をOAuthサービス経由に変更する。具体的には:

```javascript
const FreeeOAuth = {
  getService: function() {
    return OAuth2.createService('freee')
      .setAuthorizationBaseUrl('https://accounts.secure.freee.co.jp/public_api/authorize')
      .setTokenUrl('https://accounts.secure.freee.co.jp/public_api/token')
      .setClientId(Config.get('FREEE_CLIENT_ID'))
      .setClientSecret(Config.get('FREEE_CLIENT_SECRET'))
      .setCallbackFunction('freeeOAuthCallback')
      .setPropertyStore(PropertiesService.getScriptProperties())
      .setParam('prompt', 'select_company');
  },
};

function freeeOAuthCallback(request) {
  const service = FreeeOAuth.getService();
  const isAuthorized = service.handleCallback(request);
  if (isAuthorized) {
    return HtmlService.createHtmlOutput('<h2>認証成功</h2><p>このタブを閉じてください。</p>');
  } else {
    return HtmlService.createHtmlOutput('<h2>認証失敗</h2>');
  }
}
```

そして `FreeeClient.request` で:
```javascript
const service = FreeeOAuth.getService();
const token = service.hasAccess() ? service.getAccessToken() : Config.get('FREEE_ACCESS_TOKEN');
```

メニューに「freee認証開始」「認証リセット」を追加。

#### コールバックURL設定の必要性

freee開発者ポータル(https://app.secure.freee.co.jp/developers/applications)で、bizmoteのアプリ「bizmote 請求書管理システム」のコールバックURLを以下に変更する必要があります:

```
https://script.google.com/macros/d/【スクリプトID】/usercallback
```

**スクリプトIDは `1cKqVCGvI8_nj34YSemYkRLZpTMp9pNAUGkeJumA0bmCh5p5YbbHz4WkH` です。**

これをfreee開発者ポータルのコールバックURLとして以下を設定してもらう必要があります:

```
https://script.google.com/macros/d/1cKqVCGvI8_nj34YSemYkRLZpTMp9pNAUGkeJumA0bmCh5p5YbbHz4WkH/usercallback
```

### 課題2: ステップ2実装(本題)

OAuthフロー実装後、`spec/docs/02_step2_input_approval.md` の内容を実装してください。

## 主要な認証情報・ID

| 項目 | 値 |
|---|---|
| freee company_id | 10677473 |
| freee 請求書テンプレID | 1525088 |
| 売上勘定科目ID(売上高) | 719439131 |
| 売掛金勘定科目ID | 719438988 |
| 税率コード(10%課税売上) | 21 |
| Client ID | 719693591028212 |
| Client Secret | HiyIvSKAqpv8FW9RFjYxpPEN7rpht3HZWGxED79xx_puGtX8M1hNuc-fztHbgio8zw1dI6Ff5qd_hP_DXNl3kw |

## 6社のクライアントID

| クライアントID | 企業名 | freee取引先ID | オーナー |
|---|---|---|---|
| clt-asiot | アシオット株式会社 | 73961942 | 山岡 |
| clt-epicbase | エピックベース株式会社 | 92250792 | 須藤 |
| clt-zenkigen | 株式会社ZENKIGEN | 95579985 | 山岡 |
| clt-mocomoco | mocomoco株式会社 | 101392484 | 山岡 |
| clt-nishika | Nishika株式会社 | 83070224 | 山岡 |
| clt-mf | 株式会社マネーフォワード | 105591990 | 横山 |

## 山岡さんへの確認事項(実装中に必要に応じて)

1. **スクリプトID**: 必ず山岡さんに教えてもらう。OAuth設定で使用
2. **メール本文テンプレート**: 経理樋口みくさんに別途確認 OR 仮で実装
3. **Slack Webhook URL**: 通知用。後付けでも可
4. **Google Drive PDF保存先フォルダID**: ステップ3で必要。今は不要

## 進め方の推奨

1. **OAuthフロー実装** (20-30分)
   - ライブラリ追加
   - コード実装
   - コールバックURL設定
   - 認証実行 → 動作確認

2. **ステップ2の実装計画を山岡さんに報告**
   - 実装する関数の一覧
   - スプレッドシート構造の追加(03b_請求明細)
   - UIのモック説明
   - OK後に実装開始

3. **ステップ2 各機能の段階実装**
   - 月初の請求行自動作成
   - オーナー入力フォーム
   - 経理承認画面
   - 動作確認 → 次のステップへ

## 重要な注意事項

- スプレッドシート操作系の関数(SpreadsheetApp.getUi等)は、Apps Scriptエディタの直接実行ではなく**スプレッドシートのメニュー経由でのみ実行可能**
- テスト時はメニューから実行することを山岡さんに案内する
- 万一動作確認で詰まった時は、山岡さんに**スクリーンショットを送ってもらう**よう依頼する
