# Claude Code への作業依頼

## 最初に読んでください

このパッケージは、bizmote株式会社の請求書管理システムをGoogle Apps Script (GAS) で実装するための、**ステップ2〜4の引き継ぎ資料**です。ステップ1は山岡さん本人が手作業で完了しています。

## あなた(Claude Code)へのお願い

### 守ってほしいルール

1. **emoji禁止** (山岡さん強い意向)
2. **段階リリース厳守** - ステップ2が完了するまでステップ3に進まない
3. **動作確認待ち** - 各ステップ完了後、山岡さんが動作確認するまで次に進まない
4. **非エンジニア対応** - 山岡さんは非エンジニア。コードを書く前に「これから何をするか」を日本語で説明する
5. **質問は具体的に** - 判断に迷ったら、選択肢を提示して山岡さんに選んでもらう
6. **ハードコード禁止** - 設定値は全て PropertiesService または シート設定経由

### 最初にやること(順番厳守)

1. このREADME.mdを最後まで読む
2. STATUS.md を読む(現状把握)
3. spec/SKILL.md を読む(プロジェクト概要)
4. spec/docs/02_step2_input_approval.md を読む(今回の実装内容)
5. spec/docs/data_model.md を読む(シート構造)
6. spec/docs/api_reference_freee.md を読む(freee API)
7. existing_code/ にある現状のGASコード4ファイルを読む
8. 山岡さんに「ここまで読みました。ステップ2の実装計画はこうです」とサマリー報告する
9. 山岡さんが「OK」を出したら実装開始

## このパッケージの構成

```
handoff/
├── README.md            (このファイル)
├── STATUS.md            (現在の進捗状況・重要)
├── PROMPT.md            (山岡さんがClaude Codeに最初に貼り付けるプロンプト)
├── existing_code/       (現状のGASコード4ファイル)
│   ├── Main.gs
│   ├── Config.gs
│   ├── FreeeClient.gs
│   └── SheetUtil.gs
└── spec/                (前回作成した仕様書一式)
    ├── SKILL.md
    └── docs/
        ├── 01_step1_foundation.md  (完了済・参考用)
        ├── 02_step2_input_approval.md  (次に実装)
        ├── 03_step3_issue_send.md
        ├── 04_step4_reconciliation_management.md
        ├── api_reference_freee.md
        ├── data_model.md
        └── operational_guide.md
```

## 今回お願いしたい作業範囲

### スコープ

**ステップ2(必須)**: spec/docs/02_step2_input_approval.md の全内容
- 月初の請求行自動作成 (createMonthlyInvoiceRows)
- オーナー入力フォーム (HTMLサイドバー)
- 経理向け承認画面 (HTMLモーダル)
- 03b_請求明細シートの追加
- ステータス管理

### 追加の優先タスク

実装の前に、**OAuthフロー実装**(20分)を最優先で実装してください。理由は STATUS.md の「重要な課題」セクションを参照。

### スコープ外(今日はやらない)

- ステップ3(請求書発行・メール送付) - 別日
- ステップ4(入金消込・クライアント管理) - 別日

## 山岡さんへの連絡方法

判断に迷ったとき、または動作確認をお願いしたいときは、ターミナル/Claude Code画面に**わかりやすく日本語で**報告してください。質問は1つずつ、選択肢付きで。

例:
```
ステップ2の実装計画について確認させてください。

メール本文テンプレートはどうしますか?
A. spec/docs/03_step3_issue_send.md にあるサンプルをそのまま使う
B. 樋口みくさん(経理)に別途確認してから実装
C. 仮の本文で先に実装し、後で差し替える

どれが良いでしょうか?
```

このスタイルでお願いします。
