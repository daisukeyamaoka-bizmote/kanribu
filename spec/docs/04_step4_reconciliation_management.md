# ステップ4: 入金消込チェック + クライアント管理

## 目的

- **入金消込チェック**: freeeの自動マッチング機能を活用しつつ、未消込の売掛金を月初に自動チェックして通知する
- **クライアント管理**: 新規追加・停止・freee同期をボタン一つで実行できるUIを提供

## 完了条件

### 入金消込チェック

- 毎月月初(5日)の朝9時にトリガー実行で `runReconcileCheck()` が動く
- 前月までに発行した請求のうち、`payment_status: unsettled` のものをfreee API経由で取得
- 未消込があればSlackに通知 + シートのステータスを `未消込警告` に更新
- 全件消込済の場合は「全件消込済」とSlack通知

### クライアント管理

- メニュー「クライアント管理」でモーダルが開く
- 「追加」タブ: freee取引先一覧から選択 + 必要情報入力 で新規クライアント追加
- 「停止」タブ: 稼働中クライアント一覧から選択 + 停止理由入力 で停止
- 「freee同期」タブ: 全クライアントのfreee情報(住所など)を最新化

## 入金消込の仕組み (背景知識)

freeeの自動マッチング機能は以下の条件で売掛金と入金を自動紐付けする:

1. 銀行口座連携で入金データがfreeeに取り込まれる (GMOあおぞら設定済)
2. 入金データの「振込人名」と「金額」「日付」が、未消込の売掛金(deal)とマッチング
3. 一致したらfreeeが自動で「+ 売掛金消込」ボタンを表示 (この時点ではまだ手動)
4. ユーザー(みく)がfreee画面でボタンを押すと消込が完了

**完全自動化するには**、freeeの「自動登録ルール」を設定する必要がある。これはfreee画面で以下を設定:

- 取引先名: アシオット株式会社
- 入金額: 550000円
- マッチした場合 → 自動で「売掛金消込」を実行

ただし、**金額が変動するクライアント (mocomoco, Nishika, エピックベース)** は自動登録ルールが組めない。そのため、以下のハイブリッド構成にする:

- 固定額3社 (アシオット・ZENKIGEN・マネーフォワード): freee自動登録ルール設定 → 完全自動消込
- 変動額3社: 月初にGASがチェック → 未消込ならSlack通知 → みくが手動で消込

## 実装

### ReconcileCheck.gs

```javascript
const ReconcileCheck = {
  /**
   * 月初の未消込チェック
   * 毎月5日 9:00 JST にトリガー実行
   */
  runMonthlyCheck: function() {
    const today = new Date();
    const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const yearMonth = Utilities.formatDate(lastMonth, 'JST', 'yyyy-MM');

    // 前月の請求行を取得
    const rows = SheetUtil.readAsObjects('03_請求一覧', 1, 3)
      .filter(r => r['対象月'] === yearMonth && r['ステータス'] === '送付済');

    if (rows.length === 0) {
      Notifier.slack(`${yearMonth} 分の送付済請求がないため、消込チェックをスキップしました。`);
      return;
    }

    const unsettled = [];
    const settled = [];

    rows.forEach(row => {
      const dealId = row['freee deal_id'];
      if (!dealId) {
        Logger.log(`deal_id が空: ${row['請求ID']}`);
        return;
      }

      try {
        const deal = FreeeClient.request('accounting', 'GET',
          `/api/1/deals/${dealId}?company_id=${Config.get('FREEE_COMPANY_ID')}`).deal;

        if (deal.status === 'settled') {
          settled.push(row);
          // ステータス更新
          if (row['ステータス'] !== '入金済') {
            SheetUtil.updateRow('03_請求一覧', row._rowNumber, {
              'ステータス': '入金済',
            });
          }
        } else {
          unsettled.push({
            ...row,
            dueAmount: deal.due_amount,
            dueDate: deal.due_date,
          });
          SheetUtil.updateRow('03_請求一覧', row._rowNumber, {
            'ステータス': '未消込警告',
          });
        }
      } catch (e) {
        Logger.log(`deal取得エラー ${dealId}: ${e.message}`);
      }
    });

    this.notifyResults(yearMonth, settled, unsettled);
  },

  notifyResults: function(yearMonth, settled, unsettled) {
    if (unsettled.length === 0) {
      Notifier.slack(
        `${yearMonth} 分の入金消込チェック完了\n` +
        `全 ${settled.length} 件すべて消込済です。`
      );
      return;
    }

    const lines = [
      `${yearMonth} 分の未消込警告 (${unsettled.length}件)`,
      `期日を過ぎている可能性があります。freee画面で確認してください。`,
      '',
    ];

    unsettled.forEach(u => {
      lines.push(`- ${u['企業名']} ¥${u.dueAmount.toLocaleString()} 期日:${u.dueDate}`);
    });

    lines.push('');
    lines.push(`消込済: ${settled.length}件 / 未消込: ${unsettled.length}件`);

    Notifier.slack(lines.join('\n'));
  },

  /**
   * 手動実行用: メニューから呼ばれる
   */
  runManualCheck: function() {
    this.runMonthlyCheck();
    SpreadsheetApp.getUi().alert('消込チェック完了。Slackチャンネルを確認してください。');
  },
};

function runReconcileCheck() {
  ReconcileCheck.runManualCheck();
}
```

### ClientManagement.gs

```javascript
const ClientManagement = {
  /**
   * 新規クライアント追加
   * @param {Object} input - { freeePartnerId, owner, sendingMethod, toEmail, ccEmail, fixedAmount, subjectTemplate }
   */
  addClient: function(input) {
    // 1. freeeから取引先情報を取得
    const partner = FreeeClient.getPartner(input.freeePartnerId);

    // 2. クライアントID自動生成
    const clientId = this.generateClientId(partner.name);

    // 3. シートに追加
    SheetUtil.appendRow('01_クライアントマスタ', {
      'クライアントID': clientId,
      '企業名': partner.name,
      'freee取引先ID': partner.id,
      'freee登録名': partner.name,
      'ステータス': '稼働中',
      '事業分野': '営業支援', // デフォルト
      '案件オーナー': input.owner,
      '送付方法': input.sendingMethod,
      'To担当者名': input.toName || '',
      'Toアドレス': input.toEmail,
      'CC担当者名': input.ccName || '',
      'CCアドレス': input.ccEmail || '',
      '社内CC': input.internalCc || '',
      '住所(郵便番号)': partner.zipcode || '',
      '住所': this.formatAddress(partner),
      '支払サイト': '月末締翌月末払',
      '件名テンプレ': input.subjectTemplate || '{年}/{月} 営業支援',
      '備考': '',
    });

    // 4. 品目テンプレートに固定額の品目を追加 (簡易入力対応)
    if (input.fixedAmount) {
      SheetUtil.appendRow('02_品目テンプレート', {
        'クライアントID': clientId,
        '行No': 1,
        '品目名': '営業支援',
        '単価(税抜)': input.fixedAmount,
        '数量': 1,
        '税率': 10,
        '単位': '月',
        '固定/変動': '固定',
        '勘定科目': '売上高',
        '備考': '',
      });
    }

    Notifier.slack(`新規クライアント追加: ${partner.name} (オーナー: ${input.owner})`);

    return { clientId, clientName: partner.name };
  },

  /**
   * クライアント停止
   */
  stopClient: function(clientId, reason) {
    const rows = SheetUtil.readAsObjects('01_クライアントマスタ', 1, 3);
    const target = rows.find(r => r['クライアントID'] === clientId);
    if (!target) throw new Error('クライアントが見つかりません');

    SheetUtil.updateRow('01_クライアントマスタ', target._rowNumber, {
      'ステータス': '停止',
      '備考': `[停止 ${new Date().toISOString().split('T')[0]}] ${reason} (元: ${target['備考']})`,
    });

    Notifier.slack(`クライアント停止: ${target['企業名']} (理由: ${reason})`);
  },

  /**
   * クライアント再開
   */
  resumeClient: function(clientId) {
    const rows = SheetUtil.readAsObjects('01_クライアントマスタ', 1, 3);
    const target = rows.find(r => r['クライアントID'] === clientId);
    if (!target) throw new Error('クライアントが見つかりません');

    SheetUtil.updateRow('01_クライアントマスタ', target._rowNumber, {
      'ステータス': '稼働中',
    });

    Notifier.slack(`クライアント再開: ${target['企業名']}`);
  },

  /**
   * freee同期: 全クライアントの住所などを最新化
   */
  syncFromFreee: function() {
    const rows = SheetUtil.readAsObjects('01_クライアントマスタ', 1, 3);
    let updateCount = 0;

    rows.forEach(row => {
      if (!row['freee取引先ID']) return;

      try {
        const partner = FreeeClient.getPartner(row['freee取引先ID']);
        const updates = {};

        if (partner.name !== row['freee登録名']) updates['freee登録名'] = partner.name;
        if (partner.zipcode && partner.zipcode !== row['住所(郵便番号)']) {
          updates['住所(郵便番号)'] = partner.zipcode;
        }
        const newAddress = this.formatAddress(partner);
        if (newAddress && newAddress !== row['住所']) updates['住所'] = newAddress;

        if (Object.keys(updates).length > 0) {
          SheetUtil.updateRow('01_クライアントマスタ', row._rowNumber, updates);
          updateCount++;
          Logger.log(`更新: ${row['企業名']} - ${JSON.stringify(updates)}`);
        }
      } catch (e) {
        Logger.log(`同期エラー ${row['企業名']}: ${e.message}`);
      }
    });

    SpreadsheetApp.getUi().alert(`freee同期完了。${updateCount}件のクライアント情報を更新しました。`);
  },

  /**
   * freee取引先一覧を取得 (UI のドロップダウン用)
   * 既にシートに登録済のものは除外
   */
  listAvailableFreeePartners: function() {
    const partners = FreeeClient.listPartners();
    const existingIds = new Set(
      SheetUtil.readAsObjects('01_クライアントマスタ', 1, 3)
        .map(r => Number(r['freee取引先ID']))
    );

    return partners
      .filter(p => !existingIds.has(p.id))
      .map(p => ({
        id: p.id,
        name: p.name,
        code: p.code || '',
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  },

  generateClientId: function(name) {
    // 例: 「アシオット株式会社」 → 「clt-asiot-2026」
    const slug = name
      .replace(/株式会社|有限会社|合同会社/g, '')
      .replace(/[^a-zA-Z0-9ぁ-んァ-ヶ一-龯]/g, '')
      .substring(0, 8)
      .toLowerCase();
    const year = new Date().getFullYear();
    return `clt-${slug}-${year}`;
  },

  formatAddress: function(partner) {
    const parts = [
      partner.prefecture_name,
      partner.address1,
      partner.address2,
    ].filter(Boolean);
    return parts.join(' ');
  },
};

function openClientManager() {
  const html = HtmlService.createHtmlOutputFromFile('ui/ClientManager')
    .setWidth(700)
    .setHeight(500);
  SpreadsheetApp.getUi().showModalDialog(html, 'クライアント管理');
}

function syncFreeePartners() {
  ClientManagement.syncFromFreee();
}
```

### ClientManager.html (UI)

3タブ構成 (追加 / 停止 / 同期)。実装の骨子のみ記載:

```html
<!DOCTYPE html>
<html>
<head>
<base target="_top">
<style>
  body { font-family: 'Helvetica Neue', sans-serif; padding: 16px; font-size: 13px; }
  .tabs { display: flex; border-bottom: 2px solid #1E3A5F; margin-bottom: 16px; }
  .tab { padding: 8px 16px; cursor: pointer; }
  .tab.active { background: #1E3A5F; color: white; }
  .form-group { margin-bottom: 12px; }
  .form-group label { display: block; font-size: 11px; color: #666; margin-bottom: 4px; }
  .form-group input, .form-group select { width: 100%; padding: 6px; font-size: 13px; }
  button { background: #1E3A5F; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; }
</style>
</head>
<body>
  <div class="tabs">
    <div class="tab active" data-tab="add">追加</div>
    <div class="tab" data-tab="stop">停止/再開</div>
    <div class="tab" data-tab="sync">freee同期</div>
  </div>

  <div id="tab-add" class="tab-content">
    <div class="form-group">
      <label>freee取引先 (リアルタイム取得)</label>
      <select id="freee-partner-select"><option>読み込み中...</option></select>
    </div>
    <div class="form-group">
      <label>案件オーナー</label>
      <select id="owner-select">
        <option>山岡</option><option>横山</option><option>須藤</option>
      </select>
    </div>
    <div class="form-group">
      <label>送付方法</label>
      <select id="method-select">
        <option>メール</option><option>Slack</option><option>BillOne</option><option>LayerX</option>
      </select>
    </div>
    <div class="form-group">
      <label>送付先メール (To)</label>
      <input type="email" id="to-email"/>
    </div>
    <div class="form-group">
      <label>CC (任意)</label>
      <input type="email" id="cc-email"/>
    </div>
    <div class="form-group">
      <label>件名テンプレート (例: 2026/04 営業支援)</label>
      <input type="text" id="subject-template" value="{年}/{月} 営業支援"/>
    </div>
    <div class="form-group">
      <label>月額固定金額 (税抜) - 簡易入力</label>
      <input type="number" id="fixed-amount" placeholder="500000"/>
      <small>変動制の場合は空欄。登録後に品目テンプレートで詳細設定してください。</small>
    </div>
    <button id="btn-add">クライアントを追加</button>
  </div>

  <!-- tab-stop, tab-sync は省略 -->

<script>
// 起動時に freee取引先一覧を読み込み
google.script.run.withSuccessHandler(populatePartnerSelect)
  .listAvailableFreeePartners();

function populatePartnerSelect(partners) {
  const sel = document.getElementById('freee-partner-select');
  sel.innerHTML = '<option value="">選択してください</option>';
  partners.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
}

document.getElementById('btn-add').addEventListener('click', () => {
  const input = {
    freeePartnerId: Number(document.getElementById('freee-partner-select').value),
    owner: document.getElementById('owner-select').value,
    sendingMethod: document.getElementById('method-select').value,
    toEmail: document.getElementById('to-email').value,
    ccEmail: document.getElementById('cc-email').value,
    subjectTemplate: document.getElementById('subject-template').value,
    fixedAmount: Number(document.getElementById('fixed-amount').value || 0) || null,
  };

  if (!input.freeePartnerId || !input.toEmail) {
    alert('freee取引先と送付先メールは必須です');
    return;
  }

  google.script.run
    .withSuccessHandler(result => {
      alert(`追加完了: ${result.clientName}`);
      google.script.host.close();
    })
    .withFailureHandler(err => alert('エラー: ' + err.message))
    .addClient(input);
});

document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => switchTab(t.dataset.tab));
});

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-content').forEach(c => c.style.display = c.id === 'tab-' + name ? 'block' : 'none');
}
</script>
</body>
</html>
```

## トリガー設定

### 月初の請求行作成 (ステップ2参照)

```
関数: createMonthlyInvoiceRows
タイミング: 毎月1日 9:00 JST
```

### 月初の消込チェック

```
関数: ReconcileCheck.runMonthlyCheck
タイミング: 毎月5日 9:00 JST
```

これらは GAS 画面の「トリガー」から手動設定するか、初期セットアップ関数で自動設定する。

```javascript
function setupTriggers() {
  // 既存トリガー削除
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));

  // 月初1日 9:00
  ScriptApp.newTrigger('createMonthlyInvoiceRows')
    .timeBased()
    .onMonthDay(1)
    .atHour(9)
    .inTimezone('Asia/Tokyo')
    .create();

  // 月初5日 9:00
  ScriptApp.newTrigger('runMonthlyReconcileCheck')
    .timeBased()
    .onMonthDay(5)
    .atHour(9)
    .inTimezone('Asia/Tokyo')
    .create();

  SpreadsheetApp.getUi().alert('トリガー設定完了');
}

function runMonthlyReconcileCheck() {
  ReconcileCheck.runMonthlyCheck();
}
```

## 動作確認手順

### 入金消込チェック

1. ステップ3で送付済になっている請求行が1件以上ある状態を作る (なければ自分で1件作成)
2. freee画面で対応する取引(deal)を「消込済」に手動変更 (テスト用)
3. `runReconcileCheck()` を実行
4. 消込済の行が `入金済` ステータスに変わることを確認
5. 別の請求はわざと未消込のままにして、Slackに警告通知が届くことを確認

### クライアント追加

1. freeeで適当な新規取引先を1件作成 (テスト用、後で削除)
2. クライアント管理画面の「追加」タブを開く
3. ドロップダウンに新規取引先が表示されることを確認
4. 必要項目を入力して「クライアントを追加」
5. シートに行が追加されていることを確認
6. freee取引先IDが正しく転記されていることを確認

### クライアント停止

1. テスト用クライアントを停止
2. 翌月の `createMonthlyInvoiceRows()` を手動実行
3. 停止クライアントの請求行が作られないことを確認

### freee同期

1. freee画面で1社の住所を変更
2. `syncFreeePartners()` を実行
3. シート側の住所も最新化されていることを確認

ここまで動けばステップ4完了 = フェーズ2全体完成。
