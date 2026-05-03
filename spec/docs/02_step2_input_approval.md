# ステップ2: 入力フォーム + 承認画面

## 目的

オーナー(山岡/横山/須藤)が金額を入力し、経理(みく)が承認するまでのワークフローを構築する。シートを直接編集する代わりに、専用UI(HTMLサイドバー/モーダル)を介して安全に入力する。

## 完了条件

- メニュー「オーナー入力フォームを開く」でサイドバーが開き、自分が担当する案件の今月分が一覧表示される
- 各案件で「前月コピー」または「単価×数量入力」ができる
- 提出ボタンを押すと「03_請求一覧」シートにデータが書き込まれ、ステータスが `入力済` になる
- メニュー「承認画面を開く」でモーダルが開き、`入力済` のものが一覧表示される
- 前月比が ±20% を超える場合、赤色警告が表示される
- 承認/差戻ができる。承認すると `承認済` ステータスに変わる

## ステータス管理の状態遷移

```
未入力 → 入力済 → 承認済 → 発行済 → 送付済 → 入金済
                ↓
              差戻 → (オーナーが再入力) → 入力済
```

各月の請求行は、月初に自動で6行作られ、初期ステータスは `未入力`。

## 月初の請求行自動作成

毎月1日の朝9時にトリガー実行する関数を実装する。

```javascript
// ScheduledTasks.gs に追加
function createMonthlyInvoiceRows() {
  const today = new Date();
  const yearMonth = Utilities.formatDate(today, 'JST', 'yyyy-MM');

  const clients = SheetUtil.readAsObjects('01_クライアントマスタ', 1, 3)
    .filter(c => c['ステータス'] === '稼働中');

  const existingRows = SheetUtil.readAsObjects('03_請求一覧', 1, 3)
    .filter(r => r['対象月'] === yearMonth);

  const existingClientIds = new Set(existingRows.map(r => r['クライアントID']));

  let count = 0;
  clients.forEach((client, index) => {
    if (existingClientIds.has(client['クライアントID'])) return;

    const seq = String(existingRows.length + count + 1).padStart(3, '0');
    const invoiceId = `INV-${yearMonth.replace('-', '')}-${seq}`;

    SheetUtil.appendRow('03_請求一覧', {
      '請求ID': invoiceId,
      '対象月': yearMonth,
      'クライアントID': client['クライアントID'],
      'ステータス': '未入力',
    });
    count++;
  });

  Notifier.slack(`${yearMonth} の請求行を ${count} 件自動作成しました。各オーナーは入力をお願いします。`);
}
```

このトリガーをスクリプトプロパティで「毎月1日 9:00 JST」に設定する。

## 入力フォーム (オーナー向けサイドバー)

### UI 仕様

- 表示形式: HTML サイドバー (300px 幅)
- 表示内容:
  - 自分(現在のGoogleアカウント)が担当する案件のみフィルタ
  - `未入力` または `差戻` ステータスの行のみ表示
  - 各案件カード: クライアント名、対象月、件名、入力欄、提出ボタン
- 入力方式: 「前月コピー」ボタンと「単価×数量入力」モードの2種類
- 提出後: ステータスが `入力済` に変わり、画面から消える

### 実装の骨子

```javascript
// Main.gs
function openInputForm() {
  const html = HtmlService.createHtmlOutputFromFile('ui/InputForm')
    .setTitle('請求金額入力')
    .setWidth(360);
  SpreadsheetApp.getUi().showSidebar(html);
}

// InputFormApi.gs (HTML から呼ばれる関数)
function getMyPendingInvoices() {
  const userEmail = Session.getActiveUser().getEmail();
  const ownerName = mapEmailToOwnerName(userEmail);

  const rows = SheetUtil.readAsObjects('03_請求一覧', 1, 3)
    .filter(r => ['未入力', '差戻'].includes(r['ステータス']));

  const clients = SheetUtil.readAsObjects('01_クライアントマスタ', 1, 3);
  const clientMap = {};
  clients.forEach(c => clientMap[c['クライアントID']] = c);

  return rows
    .filter(r => clientMap[r['クライアントID']]?.['案件オーナー'] === ownerName)
    .map(r => ({
      invoiceId: r['請求ID'],
      yearMonth: r['対象月'],
      clientId: r['クライアントID'],
      clientName: clientMap[r['クライアントID']]?.['企業名'],
      subjectTemplate: clientMap[r['クライアントID']]?.['件名テンプレ'],
      lastMonthAmount: getLastMonthAmount(r['クライアントID'], r['対象月']),
      templates: getItemTemplates(r['クライアントID']),
      rowNumber: r._rowNumber,
    }));
}

function submitInvoiceInput(invoiceId, items) {
  // items: [{itemName, unitPrice, quantity, taxRate}, ...]
  const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const tax = Math.round(subtotal * 0.1);
  const total = subtotal + tax;

  const row = SheetUtil.readAsObjects('03_請求一覧', 1, 3)
    .find(r => r['請求ID'] === invoiceId);
  if (!row) throw new Error('請求が見つかりません');

  // 別シート「03b_請求明細」に明細を保存 (ステップ1のシート設計に追加が必要)
  saveLineItems(invoiceId, items);

  SheetUtil.updateRow('03_請求一覧', row._rowNumber, {
    '税抜金額': subtotal,
    '消費税': tax,
    '税込金額': total,
    'ステータス': '入力済',
    '入力者': Session.getActiveUser().getEmail(),
    '入力日時': new Date(),
  });

  return { success: true };
}
```

### HTML テンプレート (ui/InputForm.html)

```html
<!DOCTYPE html>
<html>
<head>
<base target="_top">
<style>
  body { font-family: 'Helvetica Neue', sans-serif; padding: 12px; font-size: 13px; }
  .card { border: 1px solid #ddd; border-radius: 6px; padding: 12px; margin-bottom: 12px; background: white; }
  .client-name { font-weight: 600; font-size: 14px; }
  .subject { color: #666; font-size: 12px; margin-bottom: 8px; }
  .item-row { display: flex; gap: 4px; margin-bottom: 4px; }
  .item-row input { font-size: 12px; padding: 4px; }
  .item-name { flex: 2; }
  .item-price { flex: 1; text-align: right; }
  .item-qty { flex: 0 0 60px; text-align: right; }
  .total { text-align: right; font-weight: 600; margin-top: 8px; }
  button { background: #1E3A5F; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; }
  button.copy { background: #888; }
  .empty { color: #888; text-align: center; padding: 24px; }
</style>
</head>
<body>
  <div id="loading">読み込み中...</div>
  <div id="content"></div>

<script>
google.script.run
  .withSuccessHandler(render)
  .withFailureHandler(err => document.getElementById('loading').textContent = 'エラー: ' + err.message)
  .getMyPendingInvoices();

function render(invoices) {
  document.getElementById('loading').style.display = 'none';
  const content = document.getElementById('content');

  if (invoices.length === 0) {
    content.innerHTML = '<div class="empty">入力待ちの請求はありません</div>';
    return;
  }

  invoices.forEach(inv => {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.invoiceId = inv.invoiceId;
    card.innerHTML = renderCard(inv);
    content.appendChild(card);

    card.querySelector('.copy-last').addEventListener('click', () => copyLastMonth(card, inv));
    card.querySelector('.submit').addEventListener('click', () => submit(card, inv));
    updateTotal(card);
    card.querySelectorAll('.item-price, .item-qty').forEach(input => {
      input.addEventListener('input', () => updateTotal(card));
    });
  });
}

function renderCard(inv) {
  const items = inv.templates.map(t => `
    <div class="item-row">
      <input type="text" class="item-name" value="${t.itemName}" />
      <input type="number" class="item-price" value="${t.unitPrice}" />
      <input type="number" class="item-qty" value="${t.quantity}" />
    </div>
  `).join('');

  return `
    <div class="client-name">${inv.clientName}</div>
    <div class="subject">${inv.yearMonth} | ${inv.subjectTemplate}</div>
    <div class="items">${items}</div>
    <div class="total">小計: <span class="subtotal-display">¥0</span></div>
    <div style="display: flex; gap: 8px; margin-top: 8px;">
      <button class="copy copy-last">前月コピー (¥${(inv.lastMonthAmount||0).toLocaleString()})</button>
      <button class="submit">提出</button>
    </div>
  `;
}

function updateTotal(card) {
  let subtotal = 0;
  card.querySelectorAll('.item-row').forEach(row => {
    const price = Number(row.querySelector('.item-price').value || 0);
    const qty = Number(row.querySelector('.item-qty').value || 0);
    subtotal += price * qty;
  });
  card.querySelector('.subtotal-display').textContent = '¥' + subtotal.toLocaleString();
}

function copyLastMonth(card, inv) {
  // 前月の明細を取得して入力欄を埋める
  google.script.run.withSuccessHandler(items => {
    const rows = card.querySelectorAll('.item-row');
    items.forEach((item, i) => {
      if (rows[i]) {
        rows[i].querySelector('.item-name').value = item.itemName;
        rows[i].querySelector('.item-price').value = item.unitPrice;
        rows[i].querySelector('.item-qty').value = item.quantity;
      }
    });
    updateTotal(card);
  }).getLastMonthLineItems(inv.clientId, inv.yearMonth);
}

function submit(card, inv) {
  const items = [];
  card.querySelectorAll('.item-row').forEach(row => {
    items.push({
      itemName: row.querySelector('.item-name').value,
      unitPrice: Number(row.querySelector('.item-price').value || 0),
      quantity: Number(row.querySelector('.item-qty').value || 0),
      taxRate: 10,
    });
  });

  card.querySelector('.submit').disabled = true;
  card.querySelector('.submit').textContent = '送信中...';

  google.script.run
    .withSuccessHandler(() => card.remove())
    .withFailureHandler(err => alert('提出失敗: ' + err.message))
    .submitInvoiceInput(inv.invoiceId, items);
}
</script>
</body>
</html>
```

## 承認画面 (経理向けモーダル)

### UI 仕様

- 表示形式: HTML モーダルダイアログ (700px 幅、500px 高さ)
- 表示内容:
  - `入力済` ステータスの請求行を一覧表示
  - 各行: クライアント名、対象月、税込金額、前月比 (±20%超は赤)、入力者、入力日時
  - 行クリックで明細詳細を展開
  - 「承認」「差戻」ボタン
- 一括承認ボタン: 全件まとめて承認

### 前月比チェック

```javascript
function checkPriceVariation(clientId, currentAmount, yearMonth) {
  // 前月の同クライアントの請求金額を取得
  const lastMonth = getLastMonthYearMonth(yearMonth);
  const lastInvoice = SheetUtil.readAsObjects('03_請求一覧', 1, 3)
    .find(r => r['クライアントID'] === clientId && r['対象月'] === lastMonth);

  if (!lastInvoice || !lastInvoice['税込金額']) {
    return { variation: null, warning: false };
  }

  const variation = (currentAmount - lastInvoice['税込金額']) / lastInvoice['税込金額'];
  return {
    variation: variation,
    variationPct: Math.round(variation * 100),
    warning: Math.abs(variation) > 0.2,
    lastAmount: lastInvoice['税込金額'],
  };
}
```

### 承認処理

```javascript
function approveInvoice(invoiceId) {
  const row = SheetUtil.readAsObjects('03_請求一覧', 1, 3)
    .find(r => r['請求ID'] === invoiceId);
  if (!row) throw new Error('請求が見つかりません');
  if (row['ステータス'] !== '入力済') throw new Error(`既に処理されています: ${row['ステータス']}`);

  SheetUtil.updateRow('03_請求一覧', row._rowNumber, {
    'ステータス': '承認済',
    '承認者': Session.getActiveUser().getEmail(),
    '承認日時': new Date(),
  });

  Notifier.slack(`請求承認: ${row['企業名']} ${row['対象月']} ¥${row['税込金額']?.toLocaleString()}`);
}

function rejectInvoice(invoiceId, reason) {
  const row = SheetUtil.readAsObjects('03_請求一覧', 1, 3)
    .find(r => r['請求ID'] === invoiceId);

  SheetUtil.updateRow('03_請求一覧', row._rowNumber, {
    'ステータス': '差戻',
    'メモ': `[差戻 ${new Date().toISOString()}] ${reason}`,
  });

  Notifier.slack(`請求差戻: ${row['企業名']} ${row['対象月']} 理由: ${reason}`);
}
```

## このステップで追加が必要なシート

### 03b_請求明細

請求行の明細(品目レベル)を保持する別シート。

| 列名 | 説明 |
|---|---|
| 請求ID | 03_請求一覧 と紐付くキー |
| 行No | 同一請求内の連番 |
| 品目名 | 例: 「インサイドセールス構築支援」 |
| 単価(税抜) | 数値 |
| 数量 | 数値 |
| 税率 | 10/8/0 |
| 小計(税抜) | 単価 × 数量 |

このシートを作成する関数も `Main.gs` の「初期設定」に含める。

## 動作確認手順

1. 月初の請求行作成: `createMonthlyInvoiceRows()` を手動実行 → 6行が `03_請求一覧` に追加されること
2. オーナー入力: 山岡のアカウントでフォームを開く → 担当4社のみ表示されること
3. 前月コピー: 「前月コピー」ボタンで明細が自動入力されること (前月実績がある場合)
4. 提出: ステータスが `入力済` になること
5. 承認画面: みくのアカウントで承認画面を開く → `入力済` の6件が表示されること
6. 前月比チェック: 単価を意図的に2倍にして提出 → 承認画面で赤色警告が表示されること
7. 承認: ステータスが `承認済` に変わること

ここまで動けばステップ2完了。
