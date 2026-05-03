# デプロイ手順 / freee OAuth設定手順

このドキュメントは bizmote 請求書管理システム (GAS) を Apps Script プロジェクトに反映する手順をまとめたものです。

## 前提

- 山岡さんの Google アカウントで Apps Script プロジェクトが既に作成済み
- スクリプトID: `1cKqVCGvI8_nj34YSemYkRLZpTMp9pNAUGkeJumA0bmCh5p5YbbHz4WkH`
- スプレッドシート `bizmote_invoice_phase1_v2` に紐付き済み
- freee 開発者ポータルに Client ID `719693591028212` のアプリが登録済み

## 1. コードの反映方法

以下のいずれかでGASプロジェクトに反映できます。慣れていなければ「方法B(コピペ)」が最も簡単です。

### 方法A: clasp でデプロイ(推奨・自動化向き)

1. ローカルマシンに Node.js をインストール
2. clasp をインストール
   ```bash
   npm install -g @google/clasp
   ```
3. Google アカウントでログイン
   ```bash
   clasp login
   ```
4. Apps Script API を有効化
   - https://script.google.com/home/usersettings にアクセス
   - 「Google Apps Script API」を「オン」に切り替え
5. このリポジトリのルートで以下を実行
   ```bash
   clasp push
   ```
6. 既存ファイルを上書きしますか?と聞かれたら `y` で承諾

`appsscript.json` に OAuth2 ライブラリの依存が宣言されているため、`clasp push` 後は自動でライブラリが追加されます。

### 方法B: Apps Scriptエディタに手動コピペ

1. ブラウザで以下のURLを開く
   ```
   https://script.google.com/d/1cKqVCGvI8_nj34YSemYkRLZpTMp9pNAUGkeJumA0bmCh5p5YbbHz4WkH/edit
   ```
2. 既存の `Main.gs`, `Config.gs`, `FreeeClient.gs`, `SheetUtil.gs` の中身を、`src/` 配下の同名ファイルの内容で全て置き換える
3. 新規ファイル `FreeeOAuth.gs` を作成し、`src/FreeeOAuth.gs` の内容を貼り付け
4. プロジェクト保存(Ctrl+S または Cmd+S)
5. **OAuth2 ライブラリを手動で追加**(下記「2. OAuth2ライブラリの追加」を参照)

## 2. OAuth2ライブラリの追加

`clasp push` を使った場合は自動で追加されますが、念のため Apps Script エディタで確認してください。

### 手順

1. Apps Script エディタの左サイドバーで「ライブラリ」項目の **「+」** をクリック
2. 「スクリプトID」欄に以下を貼り付け
   ```
   1B7FSrk5Zi6L1rSxxTDgDEUsPzlukDsi4KGuTMorsTQHhGBzBkMun4iDF
   ```
3. 「検索」ボタンをクリック
4. バージョン: 一番大きい数字(最新)を選択
5. 識別子: `OAuth2`(変更しない)
6. 「追加」をクリック

サイドバーに `OAuth2` が表示されれば完了。

## 3. freee 開発者ポータルでコールバックURL設定

### 手順

1. https://app.secure.freee.co.jp/developers/applications にアクセス
2. アプリ「bizmote 請求書管理システム」を開く(Client ID: `719693591028212`)
3. 「アプリ設定」または「基本情報」タブを開く
4. 「コールバックURL」または「Redirect URI」欄に以下を**完全コピペ**で設定
   ```
   https://script.google.com/macros/d/1cKqVCGvI8_nj34YSemYkRLZpTMp9pNAUGkeJumA0bmCh5p5YbbHz4WkH/usercallback
   ```
5. 「更新」または「保存」をクリック
6. 既存の `urn:ietf:wg:oauth:2.0:oob` は不要なので削除可能

## 4. OAuth認証の実行

スプレッドシート上で操作します(Apps Script エディタ直接実行ではないので注意)。

### 手順

1. 対象スプレッドシートを開く
2. メニュー「請求管理 → 開発者メニュー → 1. 初期設定」を実行
   - 設定値の保存を確認するアラートが出る
3. メニュー「請求管理 → 開発者メニュー → 2. freee認証開始」を実行
   - モーダルが開く
4. 「freee で認証する」リンクをクリック
   - 別タブが開き、freee 認可画面が表示される
5. 「許可する」をクリック
6. 「freee 認証成功」のページが表示されたら、そのタブを閉じる
7. スプレッドシートに戻り、メニュー「3. freee認証状態確認」を実行
   - 「認証済みです」と表示されればOK
8. 念のため「5. freee接続テスト」を実行
   - 会社名「bizmote株式会社」が表示されればOK

これで freee アクセストークンが永続化され、6時間ごとの再認証は不要になります(リフレッシュトークンで自動更新)。

## 5. トラブルシューティング

### 「freee未認証です」と出る

- 「2. freee認証開始」未実行 → 実行してください
- 認証直後でも出る場合: コールバックURLが freee 側に正しく設定されているか確認

### 認可画面で「Redirect URI mismatch」エラー

- freee 開発者ポータルのコールバックURL設定値を再確認
- スクリプトIDと一致しているか確認:
  - 正解: `https://script.google.com/macros/d/1cKqVCGvI8_nj34YSemYkRLZpTMp9pNAUGkeJumA0bmCh5p5YbbHz4WkH/usercallback`

### 「OAuth2 is not defined」エラー

- OAuth2 ライブラリが追加されていない → 上記「2. OAuth2ライブラリの追加」を実施
- 識別子が `OAuth2` 以外になっている → デフォルトの `OAuth2` に直す

### 認証はできたが接続テストが失敗する

- スクリプトプロパティを確認(Apps Script エディタ → プロジェクト設定 → スクリプトプロパティ)
  - `FREEE_COMPANY_ID` `FREEE_CLIENT_ID` `FREEE_CLIENT_SECRET` が設定されているか
- 設定が無ければ「1. 初期設定」を再実行
