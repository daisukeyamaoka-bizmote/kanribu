/**
 * bizmote 請求書管理システム
 * メインエントリーポイント
 *
 * フェーズ2 ステップ2用: OAuth恒久化 + 入力フォーム + 承認画面
 * (ステップ2本体の実装はOAuth動作確認後に追加予定)
 */

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('請求管理')
    .addSubMenu(
      ui.createMenu('請求業務')
        .addItem('オーナー入力フォームを開く', 'openInputForm')
        .addItem('承認画面を開く(経理)', 'openApprovalView')
        .addSeparator()
        .addItem('発行プレビュー(承認済の確認)', 'previewApprovedIssuance')
        .addItem('一括発行(本番・freee連携)', 'bulkIssueApproved')
        .addSeparator()
        .addItem('選択行のPDFをプレビュー', 'previewSelectedRowPdf')
        .addItem('一括メール送付(本番)', 'sendInvoiceMails')
        .addItem('選択行を送付済にする(手動マーク)', 'markSelectedRowAsSent')
        .addSeparator()
        .addItem('入金消込チェック(手動)', 'manualReconcileCheck')
        .addSeparator()
        .addItem('月初の請求行を作成(手動)', 'manualCreateMonthlyInvoiceRows')
        .addItem('請求データをリセット(復旧用)', 'resetAndRecreateMonthlyInvoiceRows')
        .addSeparator()
        .addItem('月初トリガーを登録(毎月1日9時)', 'installMonthlyInvoiceTrigger')
        .addItem('月初トリガーを解除', 'removeMonthlyInvoiceTrigger')
        .addItem('入金消込トリガーを登録(毎月15日9時)', 'installReconcileTriggerMenu')
        .addItem('入金消込トリガーを解除', 'removeReconcileTriggerMenu')
    )
    .addSubMenu(
      ui.createMenu('開発者メニュー')
        .addItem('1. 初期設定', 'setupInitialConfig')
        .addItem('2. freee認証開始', 'startFreeeOAuth')
        .addItem('3. freee認証状態確認', 'checkFreeeOAuthStatus')
        .addItem('4. freee認証リセット', 'resetFreeeOAuth')
        .addSeparator()
        .addItem('5. freee接続テスト', 'testFreeeConnection')
    )
    .addToUi();
}

/**
 * メニューから呼ばれる: 03_請求一覧 で選択中の行を「送付済」に手動マーク
 * (freee 管理画面で手動でメール送付した後に使う想定)
 */
function markSelectedRowAsSent() {
  const ui = SpreadsheetApp.getUi();
  try {
    const sheet = SpreadsheetApp.getActiveSheet();
    if (sheet.getName() !== '03_請求一覧') {
      ui.alert('実行先エラー', '03_請求一覧 シートを開いてから、対象の行を選択して実行してください。', ui.ButtonSet.OK);
      return;
    }
    const row = sheet.getActiveRange().getRow();
    if (row < 3) {
      ui.alert('行選択エラー', 'データ行(3行目以降)を選択してください。', ui.ButtonSet.OK);
      return;
    }
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const statusCol = headers.indexOf('ステータス');
    const sentAtCol = headers.indexOf('送付完了日時');
    const idCol = headers.indexOf('請求ID');
    if (statusCol < 0 || sentAtCol < 0) {
      ui.alert('列エラー', '「ステータス」または「送付完了日時」列が見つかりません。', ui.ButtonSet.OK);
      return;
    }

    const invoiceId = sheet.getRange(row, idCol + 1).getValue();
    const currentStatus = String(sheet.getRange(row, statusCol + 1).getValue() || '').trim();
    const currentSentAt = sheet.getRange(row, sentAtCol + 1).getValue();

    if (currentStatus !== '発行済') {
      const proceed = ui.alert(
        '確認',
        `現在のステータス: ${currentStatus}\n\n通常は「発行済」のみマークしますが、それでも「送付済」にしますか?`,
        ui.ButtonSet.YES_NO
      );
      if (proceed !== ui.Button.YES) return;
    }
    if (currentSentAt) {
      const proceed = ui.alert(
        '確認',
        `既に送付完了日時が記録されています: ${currentSentAt}\n\n上書きしますか?`,
        ui.ButtonSet.YES_NO
      );
      if (proceed !== ui.Button.YES) return;
    }

    sheet.getRange(row, statusCol + 1).setValue('送付済');
    sheet.getRange(row, sentAtCol + 1).setValue(new Date());

    ui.alert(
      '送付済マーク完了',
      `${invoiceId} を「送付済」にマークしました。`,
      ui.ButtonSet.OK
    );
  } catch (e) {
    ui.alert('エラー', e.message, ui.ButtonSet.OK);
  }
}

function setupInitialConfig() {
  Config.initialize();
  const lineSheetCreated = InvoiceFlow.ensureInvoiceLineSheet();
  const mappingCreated = UserMapping.ensureSheet();
  const bikoCreated = InvoiceFlow.ensureBikoColumn();

  let msg = 'スクリプトプロパティに設定値を保存しました。\n';
  msg += lineSheetCreated
    ? '03b_請求明細 シートを新規作成しました。\n'
    : '03b_請求明細 シートは既に存在します。\n';
  msg += mappingCreated
    ? '99b_ユーザマッピング シートを新規作成しました。\n'
    : '99b_ユーザマッピング シートは既に存在します。\n';
  msg += bikoCreated
    ? '03_請求一覧 に「備考」列を追加しました。\n'
    : '03_請求一覧 の「備考」列は既に存在します。\n';
  msg += '\n未認証の場合は「2. freee認証開始」を実行してください。';

  SpreadsheetApp.getUi().alert(
    '初期設定完了',
    msg,
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

/**
 * メニューから呼ばれる: オーナー入力フォーム(サイドバー)を開く
 */
function openInputForm() {
  const html = HtmlService.createHtmlOutputFromFile('InputForm')
    .setTitle('請求金額入力');
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * メニューから呼ばれる: 経理向け承認画面(モーダルダイアログ)を開く
 */
function openApprovalView() {
  const html = HtmlService.createHtmlOutputFromFile('ApprovalView')
    .setWidth(720)
    .setHeight(560);
  SpreadsheetApp.getUi().showModalDialog(html, '請求承認');
}

/**
 * メニューから呼ばれる: 入力フォームのデータ取得をデバッグ用に直接実行して結果を表示
 */
function debugMyPendingInvoices() {
  const ui = SpreadsheetApp.getUi();
  try {
    const email = Session.getActiveUser().getEmail();
    const owner = UserMapping.getDisplayName(email);
    const allInvoices = SheetUtil.readAsObjects('03_請求一覧', 1, 3);
    const pending = allInvoices.filter(r => {
      const status = String(r['ステータス'] || '').trim();
      return status === '未入力' || status === '差戻';
    });
    const mine = InputFormApi.getMyPendingInvoices();

    let msg = `現在のユーザ\n  メール: "${email}"\n  表示名: "${owner || '(マッピング未登録)'}"\n\n` +
              `03_請求一覧 全体: ${allInvoices.length}行\n` +
              `うち未入力/差戻: ${pending.length}行\n` +
              `うち自分担当(${owner || '不明'}): ${mine.length}行\n\n`;

    if (pending.length > 0) {
      msg += '未入力/差戻の内訳:\n';
      pending.slice(0, 10).forEach(p => {
        msg += `  - ${p['請求ID']} | ${p['対象月']} | ${p['クライアントID']} | ${p['ステータス']}\n`;
      });
    }

    Logger.log(msg);
    ui.alert('入力待ち請求デバッグ', msg, ui.ButtonSet.OK);
  } catch (e) {
    Logger.log(`debugエラー: ${e.message}\n${e.stack}`);
    ui.alert('デバッグエラー', e.message, ui.ButtonSet.OK);
  }
}

function testFreeeConnection() {
  try {
    const company = FreeeClient.getCompany();
    const startMonth = company.start_month
      || company.default_start_month
      || (company.fiscal_years && company.fiscal_years[0] && company.fiscal_years[0].start_date && Number(company.fiscal_years[0].start_date.substring(5, 7)))
      || '不明';
    SpreadsheetApp.getUi().alert(
      'freee接続成功',
      `会社名: ${company.name}\n` +
      `事業所ID: ${company.id}\n` +
      `期首月: ${startMonth}月`,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (e) {
    SpreadsheetApp.getUi().alert(
      'freee接続エラー',
      'エラー内容:\n' + e.message,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  }
}

function testReadClientMaster() {
  try {
    const clients = SheetUtil.readAsObjects('01_クライアントマスタ', 1, 3);
    Logger.log(`クライアント数: ${clients.length}`);
    clients.forEach(c => {
      Logger.log(`${c['企業名']} (${c['クライアントID']}) - オーナー: ${c['案件オーナー']}`);
    });
    SpreadsheetApp.getUi().alert(
      'クライアントマスタ確認完了',
      `${clients.length}社のクライアント情報を読み込みました。\n詳細は実行ログで確認してください。`,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (e) {
    SpreadsheetApp.getUi().alert('エラー', e.message, SpreadsheetApp.getUi().ButtonSet.OK);
  }
}

/**
 * freee 税率コード一覧を取得して表示 (発行時の tax_code 確認用)
 */
function fetchFreeeTaxCodes() {
  const ui = SpreadsheetApp.getUi();
  try {
    const data = FreeeClient.request('accounting', 'GET', '/api/1/taxes/codes');
    const codes = data.taxes || data.tax_codes || data || [];
    Logger.log('税率コード生レスポンス:\n' + JSON.stringify(data, null, 2));

    let msg = '取得した税率コード (上位30件):\n\n';
    const list = Array.isArray(codes) ? codes : [];
    list.slice(0, 30).forEach(c => {
      msg += `code: ${c.code} | ${c.name_ja || c.name || ''} | rate: ${c.rate || c.display_category || ''}\n`;
    });
    msg += '\n10%課税売上のcodeを見つけて、スクリプトプロパティ TAX_CODE_10 に設定してください。';
    msg += '\n詳細は実行ログを確認。';
    ui.alert('freee 税率コード', msg, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('エラー', e.message, ui.ButtonSet.OK);
  }
}

/**
 * 既知のスクリプトプロパティを既定値で強制上書き
 * Config.initialize() は既存値を保護する設計なので、
 * 既存の誤った値(例: TAX_CODE_10=21) を直すための手段
 */
function normalizeKnownConfig() {
  const ui = SpreadsheetApp.getUi();
  const fixes = {
    'TAX_CODE_10': '129',
  };

  let summary = '以下のスクリプトプロパティを上書きします:\n\n';
  Object.keys(fixes).forEach(k => {
    const cur = PropertiesService.getScriptProperties().getProperty(k);
    summary += `${k}: 現在 "${cur}" → 新 "${fixes[k]}"\n`;
  });
  summary += '\n実行しますか?';

  const result = ui.alert('設定値の正規化', summary, ui.ButtonSet.YES_NO);
  if (result !== ui.Button.YES) return;

  Object.keys(fixes).forEach(k => Config.set(k, fixes[k]));
  ui.alert('完了', '正規化しました。再度「一括発行」をお試しください。', ui.ButtonSet.OK);
}

/**
 * メール送付対象を診断: 03_請求一覧の各行が getPendingMails のフィルタを
 * 通るかどうかを行ごとに表示
 */
function debugPendingMails() {
  const ui = SpreadsheetApp.getUi();
  try {
    const allRows = SheetUtil.readAsObjects('03_請求一覧', 1, 3);
    const clients = SheetUtil.readAsObjects('01_クライアントマスタ', 1, 3);
    const clientMap = {};
    clients.forEach(c => clientMap[c['クライアントID']] = c);

    let msg = `03_請求一覧 全${allRows.length}行 のメール送付フィルタ判定:\n\n`;

    allRows.forEach(r => {
      const status = String(r['ステータス'] || '').trim();
      const freeeId = r['freee請求書ID'];
      const sentAt = r['送付完了日時'];
      const client = clientMap[r['クライアントID']] || {};
      const sendMethod = String(client['送付方法'] || '').trim();
      const toAddress = String(client['Toアドレス'] || '').trim();

      const checks = [];
      if (status !== '発行済') checks.push(`ステータス="${status}" (要発行済)`);
      if (!freeeId) checks.push('freee請求書ID 空');
      if (sentAt) checks.push(`送付完了日時="${sentAt}" (要空)`);
      if (sendMethod !== 'メール') checks.push(`送付方法="${sendMethod}" (要メール)`);
      if (!toAddress) checks.push('Toアドレス 空');

      const verdict = checks.length === 0 ? '送付対象 OK' : 'スキップ: ' + checks.join(' / ');
      msg += `${r['請求ID']} | ${r['クライアントID']} : ${verdict}\n`;
    });

    Logger.log(msg);
    ui.alert('メール送付対象 デバッグ', msg, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('エラー', e.message, ui.ButtonSet.OK);
  }
}

/**
 * 03_請求一覧 シートで現在選択している行の freee請求書ID を使って詳細取得
 */
function fetchFreeeInvoiceDetailFromRow() {
  const ui = SpreadsheetApp.getUi();
  try {
    const sheet = SpreadsheetApp.getActiveSheet();
    if (sheet.getName() !== '03_請求一覧') {
      ui.alert('実行先エラー', '03_請求一覧 シートを開いてから、対象の行をクリックして実行してください。', ui.ButtonSet.OK);
      return;
    }
    const row = sheet.getActiveRange().getRow();
    if (row < 3) {
      ui.alert('行選択エラー', 'データ行(3行目以降)を選択してください。', ui.ButtonSet.OK);
      return;
    }
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const idCol = headers.indexOf('freee請求書ID');
    if (idCol < 0) {
      ui.alert('列エラー', 'freee請求書ID 列が見つかりません。', ui.ButtonSet.OK);
      return;
    }
    const id = sheet.getRange(row, idCol + 1).getValue();
    if (!id) {
      ui.alert('ID未設定', '選択行に freee請求書ID がありません(まだ発行されていない?)。', ui.ButtonSet.OK);
      return;
    }
    _showFreeeInvoiceDetail(String(id), ui);
  } catch (e) {
    ui.alert('エラー', e.message, ui.ButtonSet.OK);
  }
}

function _showFreeeInvoiceDetail(id, ui) {
  const companyId = Config.get('FREEE_COMPANY_ID');
  const data = FreeeClient.request('invoice', 'GET', `/invoices/${id}?company_id=${companyId}`);
  const inv = data.invoice || data;

  const candidateKeys = ['memo', 'notes', 'description', 'remarks', 'caption', 'comment', 'note', 'description_at_bottom', 'bottom_text'];
  let summary = `freee請求書 ID: ${id}\n\n`;
  summary += '備考っぽいフィールドの値:\n';
  candidateKeys.forEach(k => {
    const v = inv[k];
    if (v !== undefined) {
      summary += `  ${k}: "${String(v).substring(0, 200)}"\n`;
    }
  });

  // 主要日付フィールドも併せて確認
  summary += '\n日付フィールド:\n';
  ['issue_date', 'billing_date', 'due_date', 'payment_date'].forEach(k => {
    if (inv[k] !== undefined) summary += `  ${k}: ${inv[k]}\n`;
  });

  summary += '\n全フィールド一覧(キーのみ):\n';
  summary += Object.keys(inv).join(', ');

  Logger.log('freee invoice raw response:\n' + JSON.stringify(data, null, 2));
  ui.alert('freee請求書詳細', summary, ui.ButtonSet.OK);
}

/**
 * freee 請求書詳細を取得して全フィールドを実行ログに出力
 * 「備考」がどのフィールドに対応するかを確認するための診断用
 */
function fetchFreeeInvoiceDetail() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(
    'freee請求書詳細取得',
    'freee請求書ID(数値、例: 57817407)を入力してください\n' +
    '※INV-xxxxx のような表示用番号ではなく、03_請求一覧の「freee請求書ID」列の数値です',
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return;
  const id = String(response.getResponseText()).trim();
  if (!id) return;

  try {
    _showFreeeInvoiceDetail(id, ui);
  } catch (e) {
    ui.alert('エラー', e.message, ui.ButtonSet.OK);
  }
}

/**
 * freee 勘定科目一覧を取得して表示 (発行時の account_item_id 確認用)
 */
function fetchFreeeAccountItems() {
  const ui = SpreadsheetApp.getUi();
  try {
    const companyId = Config.get('FREEE_COMPANY_ID');
    const data = FreeeClient.request('accounting', 'GET', `/api/1/account_items?company_id=${companyId}`);
    const items = data.account_items || [];
    Logger.log('勘定科目 件数: ' + items.length);

    // 売上関連のみ抽出
    const sales = items.filter(a => /売上|役務収益|売掛/.test(a.name || ''));
    let msg = `勘定科目 全 ${items.length}件 (売上系を抽出):\n\n`;
    sales.forEach(a => {
      msg += `id: ${a.id} | ${a.name}\n`;
    });
    msg += '\n詳細は実行ログを確認。';
    ui.alert('freee 勘定科目', msg, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('エラー', e.message, ui.ButtonSet.OK);
  }
}

function testListInvoices() {
  const today = new Date();
  const threeMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 3, 1);
  const dateStart = Utilities.formatDate(threeMonthsAgo, 'JST', 'yyyy-MM-dd');
  const dateEnd = Utilities.formatDate(today, 'JST', 'yyyy-MM-dd');

  try {
    const invoices = FreeeClient.listInvoices({ dateStart, dateEnd, limit: 100 });
    Logger.log(`過去3ヶ月の請求書: ${invoices.length}件`);
    invoices.slice(0, 20).forEach(inv => {
      Logger.log(`${inv.invoice_number} | ${inv.partner_name} | ¥${inv.total_amount.toLocaleString()}`);
    });
    SpreadsheetApp.getUi().alert(
      '請求一覧取得完了',
      `${invoices.length}件取得しました。`,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (e) {
    SpreadsheetApp.getUi().alert('エラー', e.message, SpreadsheetApp.getUi().ButtonSet.OK);
  }
}
