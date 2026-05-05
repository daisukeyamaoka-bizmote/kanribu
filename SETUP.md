# bizmote 請求書管理システム 初期セットアップマニュアル

このマニュアルは、システムを **最初に1回だけ** 行う設定手順を説明します。月次運用の手順は `OPERATIONS.md` を参照してください。

---

## 前提

- 山岡さんの Google アカウントで Apps Script プロジェクトが作成されている
- スクリプトID: `1cKqVCGvI8_nj34YSemYkRLZpTMp9pNAUGkeJumA0bmCh5p5YbbHz4WkH`
- スプレッドシート: `bizmote_invoice_phase1_v2`(`bizmote_請求管理シート` にリネーム可)
- freee アカウント(bizmote株式会社)に管理者権限あり
- Slack ワークスペース(bizmote)に Webhook を発行できる権限あり

---

## ステップ1: コードを Apps Script に反映

### 方法A: clasp を使う(推奨・自動化向き)

1. Node.js がインストールされていることを確認
2. clasp をインストール
   ```
   npm install -g @google/clasp
   ```
3. Google アカウントでログイン
   ```
   clasp login
   ```
4. Apps Script API を有効化
   - https://script.google.com/home/usersettings
   - 「Google Apps Script API」を **オン** に切り替え
5. リポジトリをクローンしてプッシュ
   ```
   git clone https://github.com/daisukeyamaoka-bizmote/kanribu.git
   cd kanribu
   git checkout claude/invoice-management-phase-2-NCO6B
   clasp push -f
   ```
6. 出力に `Pushed N files` と出れば反映完了

### 方法B: Apps Script エディタで手動コピペ

1. https://script.google.com/d/1cKqVCGvI8_nj34YSemYkRLZpTMp9pNAUGkeJumA0bmCh5p5YbbHz4WkH/edit を開く
2. GitHub の `src/` 配下の各ファイルの中身を、エディタにコピペで反映
3. 全部保存

---

## ステップ2: OAuth2 ライブラリを追加

clasp push なら `appsscript.json` で自動反映されます。手動コピペの場合のみ:

1. Apps Script エディタの左サイドバー「ライブラリ」項目の **「+」** をクリック
2. スクリプトID: `1B7FSrk5Zi6L1rSxxTDgDEUsPzlukDsi4KGuTMorsTQHhGBzBkMun4iDF`
3. バージョン: 最新を選択
4. 識別子: `OAuth2`(変更しない)
5. 「追加」

---

## ステップ3: freee 開発者ポータルでコールバックURL設定

1. https://app.secure.freee.co.jp/developers/applications にアクセス
2. アプリ「bizmote 請求書管理システム」を開く(Client ID `719693591028212`)
3. 「アプリ設定」→「コールバックURL」欄に下記を完全コピペ:
   ```
   https://script.google.com/macros/d/1cKqVCGvI8_nj34YSemYkRLZpTMp9pNAUGkeJumA0bmCh5p5YbbHz4WkH/usercallback
   ```
4. 「更新」または「保存」

---

## ステップ4: 初期設定メニュー実行

1. スプレッドシートを開く
2. ブラウザで F5 で再読み込み(メニューを反映)
3. メニュー「請求管理 → 開発者 → **1. 初期設定**」を実行
4. 権限承認ダイアログが出たら「許可」(初回のみ・bizmote ドメイン推奨)
5. 「初期設定完了」アラートで以下を確認:
   - スクリプトプロパティ保存
   - `03b_請求明細` シート作成
   - `99b_ユーザマッピング` シート作成
   - `備考` 列追加

---

## ステップ5: freee 認証

1. メニュー「開発者 → **2. freee認証開始**」
2. 表示されるリンクをクリック → freee で「許可する」
3. 「freee 認証成功」のページが出たらタブを閉じる
4. メニュー「開発者 → **3. freee認証状態確認**」で「認証済みです」と出るか確認
5. メニュー「開発者 → **6. freee接続テスト**」で「会社名: bizmote株式会社」と出ればOK

---

## ステップ6: Slack Webhook URL を設定

### 6-1. Webhook URL を取得

1. Slack で「Incoming Webhook」アプリを検索
2. 通知先チャンネルを選択(例: `#bizmote_請求管理`)
3. 「ワークスペースに追加」
4. 表示される Webhook URL をコピー

### 6-2. システムに登録

1. メニュー「開発者 → **5. Slack Webhook URLを設定**」
2. プロンプトに URL を貼り付け → OK
3. 「保存完了」アラート
4. メニュー「開発者 → **7. Slack通知テスト**」で実際に Slack にテストメッセージが届くか確認

---

## ステップ7: 月初トリガーを登録

毎月1日に自動で6社分の請求行を作成するトリガーを登録します。

1. メニュー「管理 → **月初トリガーを登録(毎月1日9時)**」
2. 「月初トリガー登録完了」アラート

これで毎月1日 9:00 JST に `03_請求一覧` に当月分の6行が自動追加されます。

---

## ステップ8: 入金消込トリガーを登録

毎月15日に未入金請求をチェックするトリガーを登録します。

1. メニュー「管理 → **入金消込トリガーを登録(毎月15日9時)**」
2. 「入金消込トリガー登録完了」アラート

これで毎月15日 9:00 JST に freee の入金状況を自動チェック → 未入金なら Slack 通知 → 入金確認できれば `入金済` ステータスに更新されます。

---

## ステップ9: 99b_ユーザマッピング を確認

`99b_ユーザマッピング` シートを開いて、以下3行があることを確認(ステップ4 で自動投入済):

| メール | 表示名 | 役割 |
|---|---|---|
| daisuke.yamaoka@bizmote.jp | 山岡 | オーナー |
| hayato.suto@bizmote.jp | 須藤 | オーナー |
| miku.higuchi@bizmote.jp | 樋口 | 経理 |

新しいオーナー / 経理が増えたらここに行を追加してください。

---

## ステップ10: 動作確認

簡単な疎通確認:

1. メニュー「管理 → **月初の請求行を作成(手動)**」を実行
2. `03_請求一覧` に当月分の6行が追加される
3. `01_クライアントマスタ` で各クライアントの `Toアドレス` `件名テンプレ` `案件オーナー` 等が埋まっていることを確認
4. メニュー「オーナー → **入力フォームを開く**」で自分担当の案件が表示されればOK

---

## トラブルシューティング

### メニュー「請求管理」が表示されない

- ブラウザを F5 で再読み込み
- それでもダメなら Apps Script コードに構文エラーがある可能性 → エディタで実行履歴を確認

### freee 認証で「Redirect URI mismatch」

- ステップ3 のコールバック URL 設定を確認(完全一致が必要)

### Gmail 送信権限エラー

- 初回は権限承認ダイアログが出るので「許可」する
- スコープ: `https://www.googleapis.com/auth/script.send_mail`

### freee API でエラー

- メニュー「開発者 → 3. freee認証状態確認」で認証状態を確認
- 「未認証」なら 2. freee認証開始 を再実行

---

## 完了

セットアップは以上で終わりです。月次運用は `OPERATIONS.md` を参照してください。
