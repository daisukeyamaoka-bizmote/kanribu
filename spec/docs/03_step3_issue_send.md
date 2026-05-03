# ステップ3: 一括発行 + メール送付 + PDF保存

## 目的

承認済の請求行に対して、freee請求書APIで請求書PDFを発行し、Driveに保存し、メールで自動送付する。同時に会計仕訳(売掛金/売上高)も自動で作成される。

## 完了条件

- メニュー「一括発行・送付」を実行すると、`承認済` 全件が処理される
- freee側に請求書が作成される (確認: freee画面で「請求書」一覧に表示)
- freee側に取引(deal)が作成される (確認: 「取引」一覧で売掛金/売上高の仕訳が表示)
- 請求書PDFがGoogle Driveの月次フォルダに保存される
- 各クライアントにメール自動送信される (PDF添付、CC込み)
- シートのステータスが `送付済` に更新され、freee請求書ID・送付日時・PDFリンクが記録される

## 重要: freee請求書APIの仕様

### POST /invoices のリクエスト形式

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

**重要なポイント:**

- `deal_attributes.create_deal: true` を指定すると、請求書発行と同時に取引(deal)が作成され、売掛金/売上高の仕訳が自動で立つ
- `unit_price` は税抜金額
- `vat` は消費税額 (税抜 × 0.1 を四捨五入)
- `account_item_id` は売上勘定科目ID (今回は全件 719439131 = 売上高)
- `tax_code: 21` は10%課税売上
- `partner_id` は freee の取引先ID (シートから取得)

### レスポンス

```json
{
  "invoice": {
    "id": 12345,
    "invoice_number": "INV-0000000700",
    "deal_id": 9876543,
    "total_amount": 550000,
    ...
  }
}
```

返ってきた `id` (請求書ID) と `deal_id` (取引ID) をシートに保存する。

### PDF ダウンロード

freee請求書APIには直接PDFを取得するエンドポイントがない。代わりに、freee画面の以下のURLから取得できる:

```
https://app.secure.freee.co.jp/iv/invoices/{invoice_id}/preview.pdf
```

ただしこのURLはCookieセッションが必要なので、API経由では取得できない。**代替策として、freee請求書のpublic URLを取得して、そのURLをメール本文に貼る方式**を採用する。

```javascript
// Invoice の public URL は固定パターンで生成可能
function getInvoicePublicUrl(invoiceId) {
  return `https://app.secure.freee.co.jp/iv/invoices/${invoiceId}`;
}
```

または、PDF生成自体をGAS側で行う方式も検討する (請求書テンプレートをHTMLで持って、GASでPDF化)。

**実装方針(推奨)**: 最初はfreeeのpublic URLをメール本文に記載する方式で実装し、後でPDF添付方式に拡張する。

## 実装

### InvoiceFlow.gs

```javascript
const InvoiceFlow = {
  /**
   * 一括発行・送付のメイン処理
   * @param {boolean} dryRun - true なら freee API を呼ばずにログ出力のみ
   */
  runIssueAndSend: function(dryRun) {
    dryRun = dryRun || false;

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) {
      throw new Error('既に他のユーザーが実行中です。少し待ってから再実行してください。');
    }

    try {
      const targets = this.getApprovedInvoices();
      if (targets.length === 0) {
        SpreadsheetApp.getUi().alert('承認済の請求はありません');
        return;
      }

      const ui = SpreadsheetApp.getUi();
      const result = ui.alert(
        '一括発行確認',
        `承認済の ${targets.length} 件の請求書を発行・送付します。よろしいですか?\n\n` +
        targets.map(t => `- ${t.clientName} ${t.yearMonth} ¥${t.totalAmount.toLocaleString()}`).join('\n'),
        ui.ButtonSet.YES_NO
      );
      if (result !== ui.Button.YES) return;

      const results = { success: [], failed: [] };

      targets.forEach(target => {
        try {
          this.processOne(target, dryRun);
          results.success.push(target);
        } catch (e) {
          results.failed.push({ target, error: e.message });
          Logger.log(`発行失敗 ${target.invoiceId}: ${e.message}`);
        }
      });

      this.notifyResults(results);

    } finally {
      lock.releaseLock();
    }
  },

  getApprovedInvoices: function() {
    const rows = SheetUtil.readAsObjects('03_請求一覧', 1, 3)
      .filter(r => r['ステータス'] === '承認済');

    const clients = SheetUtil.readAsObjects('01_クライアントマスタ', 1, 3);
    const clientMap = {};
    clients.forEach(c => clientMap[c['クライアントID']] = c);

    return rows.map(r => {
      const client = clientMap[r['クライアントID']];
      const items = this.getLineItems(r['請求ID']);

      return {
        invoiceId: r['請求ID'],
        rowNumber: r._rowNumber,
        yearMonth: r['対象月'],
        clientId: r['クライアントID'],
        clientName: client['企業名'],
        partnerId: client['freee取引先ID'],
        toEmail: client['Toアドレス'],
        ccEmail: client['CCアドレス'],
        internalCc: client['社内CC'],
        toName: client['To担当者名'],
        subject: this.buildSubject(client['件名テンプレ'], r['対象月']),
        sendingMethod: client['送付方法'],
        items: items,
        totalAmount: r['税込金額'],
      };
    });
  },

  buildSubject: function(template, yearMonth) {
    const [year, month] = yearMonth.split('-');
    return template
      .replace('{年}', year)
      .replace('{月}', month);
  },

  getLineItems: function(invoiceId) {
    return SheetUtil.readAsObjects('03b_請求明細', 1, 3)
      .filter(r => r['請求ID'] === invoiceId);
  },

  processOne: function(target, dryRun) {
    Logger.log(`処理開始: ${target.invoiceId} ${target.clientName}`);

    if (dryRun) {
      Logger.log('DRY RUN: ' + JSON.stringify(this.buildInvoicePayload(target), null, 2));
      return;
    }

    // 1. freee 請求書 + 取引 作成
    const payload = this.buildInvoicePayload(target);
    const invoice = FreeeClient.createInvoice(payload);
    Logger.log(`freee請求書作成完了: ${invoice.id} (deal_id: ${invoice.deal_id})`);

    // 2. シート更新 (発行情報)
    const publicUrl = `https://app.secure.freee.co.jp/iv/invoices/${invoice.id}`;
    SheetUtil.updateRow('03_請求一覧', target.rowNumber, {
      'ステータス': '発行済',
      'freee請求書ID': invoice.id,
      'freee deal_id': invoice.deal_id,
      'PDF Driveリンク': publicUrl,
    });

    // 3. メール送付 (送付方法が「メール」の場合のみ)
    if (target.sendingMethod === 'メール') {
      this.sendEmail(target, invoice);
      SheetUtil.updateRow('03_請求一覧', target.rowNumber, {
        'ステータス': '送付済',
        '送付完了日時': new Date(),
      });
    } else {
      // メール以外 (Slack/BillOne/LayerX) は通知のみ
      Notifier.slack(
        `手動送付対象: ${target.clientName} ${target.yearMonth}\n` +
        `送付方法: ${target.sendingMethod}\n` +
        `freee請求書: ${publicUrl}\n` +
        `担当者(${target.clientName}のオーナー)が手動で送付してください。`
      );
    }
  },

  buildInvoicePayload: function(target) {
    const issueDate = this.getIssueDate(target.yearMonth);
    const dueDate = this.getDueDate(target.yearMonth);

    const invoiceContents = target.items.map((item, i) => {
      const subtotal = item['単価(税抜)'] * item['数量'];
      const vat = Math.round(subtotal * 0.1);
      return {
        order: i + 1,
        type: 'normal',
        qty: item['数量'],
        unit_price: item['単価(税抜)'],
        vat: vat,
        description: item['品目名'],
        account_item_id: Number(Config.get('ACCOUNT_ITEM_SALES')),
        tax_code: Number(Config.get('TAX_CODE_10')),
        unit: item['単位'] || '',
      };
    });

    return {
      company_id: Number(Config.get('FREEE_COMPANY_ID')),
      issue_date: issueDate,
      due_date: dueDate,
      partner_id: target.partnerId,
      subject: target.subject,
      memo: '',
      template_id: Number(Config.get('FREEE_INVOICE_TEMPLATE_ID')),
      deal_attributes: {
        create_deal: true,
        issue_date: issueDate,
        due_date: dueDate,
      },
      invoice_contents: invoiceContents,
    };
  },

  getIssueDate: function(yearMonth) {
    // 対象月の月末日付
    const [year, month] = yearMonth.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    return `${yearMonth}-${String(lastDay).padStart(2, '0')}`;
  },

  getDueDate: function(yearMonth) {
    // 翌月末
    const [year, month] = yearMonth.split('-').map(Number);
    const dueMonth = month === 12 ? 1 : month + 1;
    const dueYear = month === 12 ? year + 1 : year;
    const lastDay = new Date(dueYear, dueMonth, 0).getDate();
    return `${dueYear}-${String(dueMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  },

  sendEmail: function(target, invoice) {
    const publicUrl = `https://app.secure.freee.co.jp/iv/invoices/${invoice.id}`;

    const subject = `【請求書送付】${Config.get('COMPANY_NAME')}_${target.yearMonth}分`;

    const body = `${target.clientName}\n${target.toName}\n\n`
      + `平素より大変お世話になっております。\n`
      + `bizmote株式会社の樋口でございます。\n\n`
      + `${target.yearMonth.replace('-', '年')}月分の請求書を発行いたしましたので、ご確認のほどお願い申し上げます。\n\n`
      + `■請求金額: ¥${target.totalAmount.toLocaleString()} (税込)\n`
      + `■お支払期限: ${this.getDueDate(target.yearMonth).replace(/-/g, '/')}\n`
      + `■請求書URL: ${publicUrl}\n\n`
      + `お手数をおかけしますが、ご確認のほどよろしくお願い申し上げます。\n\n`
      + `--\n`
      + `bizmote株式会社\n`
      + `〒${Config.get('COMPANY_ZIP')}\n`
      + `${Config.get('COMPANY_ADDRESS')}\n`;

    const options = {
      name: 'bizmote株式会社 経理部',
    };

    if (target.ccEmail) {
      options.cc = target.ccEmail;
    }
    if (target.internalCc) {
      options.bcc = target.internalCc; // 社内CCはBCCで
    }

    MailApp.sendEmail(target.toEmail, subject, body, options);
    Logger.log(`メール送信完了: ${target.toEmail} (CC: ${target.ccEmail || 'なし'})`);
  },

  notifyResults: function(results) {
    const ui = SpreadsheetApp.getUi();
    const messages = [];
    messages.push(`成功: ${results.success.length} 件`);
    messages.push(`失敗: ${results.failed.length} 件`);

    if (results.failed.length > 0) {
      messages.push('\n失敗詳細:');
      results.failed.forEach(f => {
        messages.push(`- ${f.target.clientName}: ${f.error}`);
      });
    }

    ui.alert('一括発行完了', messages.join('\n'), ui.ButtonSet.OK);

    Notifier.slack(
      `請求書一括発行完了\n成功: ${results.success.length}件 / 失敗: ${results.failed.length}件\n` +
      results.success.map(s => `  ${s.clientName} ¥${s.totalAmount.toLocaleString()}`).join('\n')
    );
  },
};

function runIssueAndSend() {
  InvoiceFlow.runIssueAndSend(false);
}

function runIssueAndSendDryRun() {
  InvoiceFlow.runIssueAndSend(true);
}
```

## メール本文テンプレート

メール本文は以下の構造を推奨。`docs/operational_guide.md` で経理樋口さんに最終確認をしてもらう。

```
{宛先会社名}
{宛先担当者名}様

平素より大変お世話になっております。
bizmote株式会社の樋口でございます。

{年月}分の請求書を発行いたしましたので、ご確認のほどお願い申し上げます。

■請求金額: ¥{税込金額} (税込)
■お支払期限: {翌月末}
■請求書URL: {freee public URL}

お手数をおかけしますが、ご確認のほどよろしくお願い申し上げます。

--
bizmote株式会社
〒160-0023
東京都新宿区西新宿4-8-11 SHINJUKU NEW VILLA 203
```

## 動作確認手順

### dryRun テスト

1. ステップ2で承認済にした請求行が1件以上ある状態を作る
2. `runIssueAndSendDryRun()` を実行
3. ログにペイロード内容が出ることを確認 (実際のAPIは呼ばれない)
4. ペイロードの内容(税抜金額・消費税・取引先IDなど)が正しいか目視確認

### 本番テスト (アシオット1社のみで先行)

1. アシオットのみを承認済にする (他5社は未承認のまま)
2. `runIssueAndSend()` を実行
3. freee画面で請求書が作成されていることを確認
4. freee画面で「取引」が作成され、売掛金/売上高 の仕訳が立っていることを確認
5. アシオットの送付先メールにテストメールが届くことを確認 (※テスト時はTo/CCを自分のアドレスに一時変更)
6. シートのステータスが `送付済` に変わっていることを確認
7. freee請求書ID、deal_id、PDFリンクがシートに記録されていることを確認

ここまで動けばステップ3完了。残り5社も同様に処理されるはずなので、本番運用に移行できる。

## 既知の課題と将来対応

- **PDF添付**: 現状はpublic URLをメール本文に貼る方式。将来的にfreeeから直接PDFを取得して添付する方式に拡張可能
- **メールテンプレートのカスタマイズ**: クライアント別にカスタムテンプレートを使えるよう、シート側で個別の本文テンプレを指定できる仕組みを将来追加
- **送付済の取消**: 一度送付した後の取消は freee 画面から手動で行う必要がある (請求書APIには取消機能がないため)
