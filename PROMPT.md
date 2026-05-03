# Claude Code への初回プロンプト

このファイルの中身を、Claude Code に最初にそのまま貼り付けてください。

---

## ここから貼り付け

bizmote株式会社の請求書管理システム フェーズ2 ステップ2の実装をお願いします。

このフォルダには以下のファイルがあります:

- README.md (まず最初に読んでください)
- STATUS.md (現状把握、最重要)
- existing_code/ (現状のGASコード4ファイル)
- spec/ (仕様書一式)

【最初にやること】

1. README.md を最後まで読む
2. STATUS.md を読んで現状と課題を把握する
3. spec/SKILL.md でプロジェクト全体像を把握する
4. spec/docs/02_step2_input_approval.md で今回の実装内容を把握する
5. existing_code/ の4ファイルを読んで現状のコード構造を把握する
6. 私(山岡)に「ここまで読みました」と報告して、ステップ2の実装計画を提示する
7. 私が「OK」を返すまで実装を始めない

【守ってほしいルール】

- emoji絶対禁止
- 私は非エンジニアなので、コードを書く前に日本語で何をするか説明する
- 各機能完成ごとに動作確認を依頼する
- 判断に迷ったら選択肢を提示して質問する
- ハードコード禁止(設定値はPropertiesService経由)

【重要】OAuthフロー実装を最優先で

ステップ2に着手する前に、STATUS.md の「課題1」に書かれているOAuthフロー実装を先にやってください。これがないと開発のたびにトークン期限切れで詰まります。

OAuth実装が完了したら、私(山岡)に動作確認を依頼してください。動作確認でOKが出てから、ステップ2に着手してください。

【私のスクリプトID】

スクリプトID: `1cKqVCGvI8_nj34YSemYkRLZpTMp9pNAUGkeJumA0bmCh5p5YbbHz4WkH`

【コールバックURL(freee開発者ポータルに設定する値)】

`https://script.google.com/macros/d/1cKqVCGvI8_nj34YSemYkRLZpTMp9pNAUGkeJumA0bmCh5p5YbbHz4WkH/usercallback`

【freee開発者ポータルでの設定変更が必要】

OAuth実装の前に、私(山岡)がfreee開発者ポータルでアプリのコールバックURLを上記URLに変更する必要があります。Claude Code はこの変更手順を私に分かりやすく日本語で案内してください。

手順例:
1. https://app.secure.freee.co.jp/developers/applications にアクセス
2. アプリ「bizmote 請求書管理システム」を開く
3. 「基本情報」タブの「コールバックURL」欄を上記URLに変更
4. 「下書き保存」をクリック
5. 私が「設定完了」と報告したらOAuth実装に進む

## ここまで貼り付け
