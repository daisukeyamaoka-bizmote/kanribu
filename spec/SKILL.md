# bizmote 請求書管理システム フェーズ2 (GAS実装)

## 重要: 進捗状況

**ステップ1は完了済み**です。STATUS.md を必ず先に読んでから、このSKILL.mdを参照してください。
- 完了済み: ステップ1(基盤構築)
- 次に着手: OAuthフロー実装 → ステップ2(入力フォーム+承認画面)
- 別日: ステップ3, 4

## このドキュメントについて

これは bizmote株式会社の月次請求業務を自動化する Google Apps Script (GAS) アプリケーションの実装仕様書です。Claude Code が読んで、迷わず実装できるように構成されています。

## ゴール

経理担当者(樋口未来)が、月末締め・翌月3営業日以内に行っている請求書発行業務を自動化する。具体的には、**6社のクライアント** に対する月次請求書のPDF生成・メール送付・会計仕訳作成・入金消込までを Google スプレッドシート + GAS + freee API で完結させる。

## 前提条件

### 既に整っているもの

- Google スプレッドシート (フェーズ1で作成済): `bizmote_invoice_phase1_v2.xlsx` をスプレッドシートにインポート済の前提
- freee API アクセス権 (会計API + 請求書API)
- freee company_id: `10677473`
- freee 請求書テンプレートID: `1525088`
- freee 取引先6社の `partner_id` (シートに記載済)
- GMOあおぞら銀行のfreee連携 (入金データ自動取込済)

### Claude Code が用意するもの

- GAS プロジェクト一式 (`.gs` ファイル群 + `.html` ファイル群)
- `clasp` を使ってデプロイ可能な構成
- README (デプロイ手順)

## 対象クライアント (6社のみ)

| クライアントID | 企業名 | freee取引先ID | オーナー | 課金方式 |
|---|---|---|---|---|
| clt-asiot | アシオット株式会社 | 73961942 | 山岡 | 固定 50万円(税抜) |
| clt-epicbase | エピックベース株式会社 | 92250792 | 須藤 | 基本料 + 成果報酬 |
| clt-zenkigen | 株式会社ZENKIGEN | 95579985 | 山岡 | 固定 140万円(税抜) |
| clt-mocomoco | mocomoco株式会社 | 101392484 | 山岡 | 変動 |
| clt-nishika | Nishika株式会社 | 83070224 | 山岡 | 基本料 + 成果報酬 |
| clt-mf | 株式会社マネーフォワード | 105591990 | 横山 | 固定 80万円(税抜) |

## 重要な設計判断 (確定済)

| 項目 | 決定内容 |
|---|---|
| 売上勘定科目 | 売上高 (ID: 719439131) で全件統一 |
| 売掛金勘定科目 | 売掛金 (ID: 719438988) |
| 税率コード | 10%課税売上 (code: 21) |
| 入金消込 | freee自動マッチング機能を活用して全自動化 |
| 部門タグ | 付けない (`section_id` は null) |
| 請求書テンプレ | 1525088 を全件で利用 |
| 件名フォーマット | `{年}/{月} {サービス名}` (例: `2026/04 harutaka ABM支援`) |

## 実装ステップ (4段階リリース)

各ステップが完了したら、ユーザー(山岡)に動作確認してもらい、OKをもらってから次へ進むこと。

### ステップ1: 基盤構築 (2-3日)

- GAS プロジェクトのセットアップ (clasp 設定)
- freee API クライアント (`FreeeClient.gs`) 実装
- スプレッドシート読み書きユーティリティ (`SheetUtil.gs`) 実装
- 設定値の Properties Service への保存
- メニュー登録 (`onOpen` トリガーでカスタムメニュー表示)

詳細は `docs/01_step1_foundation.md` を参照。

### ステップ2: 入力フォーム + 承認画面 (3-4日)

- オーナー向け入力フォーム (HTML サイドバー)
- 経理向け承認画面 (HTML モーダル)
- 前月比チェック機能 (異常値の赤警告)
- ステータス管理 (`未入力` → `入力済` → `承認済` → `差戻`)

詳細は `docs/02_step2_input_approval.md` を参照。

### ステップ3: 一括発行 + メール送付 + PDF保存 (3-4日)

- freee 請求書 API で請求書 + 取引(deal) を同時作成
- 請求書 PDF をダウンロードして Google Drive に保存
- メール自動送付 (Gmail API、PDF添付、CC込み)
- 送付完了をシートに記録

詳細は `docs/03_step3_issue_send.md` を参照。

### ステップ4: 入金消込チェック + クライアント管理 (2-3日)

- 月初トリガーで未消込請求の自動チェック
- 未消込があれば Slack 通知
- クライアント管理メニュー (追加/停止/freee同期)

詳細は `docs/04_step4_reconciliation_management.md` を参照。

## ファイル構成 (Claude Codeへの推奨構成)

```
bizmote-invoice-system/
├── .clasp.json
├── .claspignore
├── appsscript.json
├── README.md
├── src/
│   ├── Main.gs                    # メニュー登録、エントリーポイント
│   ├── Config.gs                  # 設定値の管理 (Properties Service)
│   ├── FreeeClient.gs             # freee API ラッパー
│   ├── SheetUtil.gs               # スプレッドシート操作ユーティリティ
│   ├── InvoiceFlow.gs             # ステップ3 一括発行のメイン処理
│   ├── ReconcileCheck.gs          # ステップ4 入金消込チェック
│   ├── ClientManagement.gs        # ステップ4 クライアント管理
│   ├── Notifier.gs                # Slack/Email 通知
│   └── ui/
│       ├── InputForm.html         # オーナー入力フォーム
│       ├── ApprovalView.html      # 承認画面
│       └── ClientManager.html     # クライアント管理画面
└── docs/
    ├── 01_step1_foundation.md
    ├── 02_step2_input_approval.md
    ├── 03_step3_issue_send.md
    ├── 04_step4_reconciliation_management.md
    ├── api_reference_freee.md     # freee API のサンプルレスポンス
    ├── data_model.md              # シートのスキーマ定義
    └── operational_guide.md       # 運用手順
```

## 必須ルール

- **emoji は一切使わない** (ユーザー指定)
- **ハードコードを避ける**: クライアント情報・freee ID は全てスプレッドシートかPropertiesServiceから取得
- **エラーハンドリング**: freee API のエラーは必ず Slack 通知、ユーザーには分かりやすいメッセージ表示
- **べき等性**: 同じ月の請求書を二度発行しないようにロックを実装
- **テスト用の dryRun フラグ**: 全ての破壊的操作 (API POST、メール送信) は dryRun = true で動作確認できるようにする
- **ログ**: 全ての freee API 呼び出しは Logger.log + Drive 上のログシートに記録
- **権限**: Gmail送信は経理の樋口未来のアカウントから送る前提で `MailApp` を使う

## ユーザー(山岡)への質問が必要な事項

実装中に判断に迷ったら以下を確認すること:

1. メール本文のテンプレート (経理の樋口さんに確認するのが正確)
2. PDF保存先のGoogle DriveフォルダID (まだ未指定)
3. Slack通知用のIncoming Webhook URL
4. 振込手数料の負担 (当方負担 or 先方負担) - 各社契約による

## 参考ドキュメント

- `docs/api_reference_freee.md` — freee API のサンプルレスポンス (実データから抜粋)
- `docs/data_model.md` — スプレッドシートのシート構造
- `docs/operational_guide.md` — みくさん向けの運用手順 (Word化用)
