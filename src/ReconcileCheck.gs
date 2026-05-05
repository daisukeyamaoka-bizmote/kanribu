/**
 * 入金消込チェック (ステップ4 D-1)
 *
 * 送付済 / 未消込警告 ステータスの請求書について freee の取引(deal)を
 * 照会し、入金状況に応じて以下のように更新する:
 *
 * - due_amount === 0 (消込完了) → ステータス「入金済」
 * - 未消込 + 期日超過           → ステータス「未消込警告」 + Slack通知
 * - 未消込 + 期日内             → そのまま(状態変えず)
 *
 * 月次トリガー(毎月15日 9:00 JST)で自動実行する想定。
 * メニューから手動実行も可能。
 */
const ReconcileCheck = {
  INVOICE_SHEET: '03_請求一覧',
  CLIENT_MASTER_SHEET: '01_クライアントマスタ',
  TRIGGER_FUNCTION_NAME: 'checkReconciliationTrigger',

  /**
   * 入金消込チェック本体
   * freee invoice の payment_status を見て判定する。
   * deal_id があれば併せて参照するが、必須ではない。
   */
  check: function() {
    const allInvoices = SheetUtil.readAsObjects(this.INVOICE_SHEET, 1, 3);
    const targets = allInvoices.filter(r => {
      const status = String(r['ステータス'] || '').trim();
      // freee請求書ID があれば対象にする(deal_id は必須でない)
      return (status === '送付済' || status === '未消込警告') && r['freee請求書ID'];
    });

    if (targets.length === 0) {
      return { checked: 0, settled: [], pastDue: [], inGrace: [], errors: [] };
    }

    const clientMap = {};
    SheetUtil.readAsObjects(this.CLIENT_MASTER_SHEET, 1, 3).forEach(c => {
      clientMap[c['クライアントID']] = c;
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0); // 日付比較を 00:00 基準に

    const settled = [];
    const pastDue = [];
    const inGrace = [];
    const errors = [];

    targets.forEach(r => {
      try {
        // freee invoice 取得 (deal でなく invoice を主とする)
        const inv = FreeeClient.getInvoice(r['freee請求書ID']);

        // 副作用: invoice.deal_id があってシート側が空ならバックフィル
        if (inv.deal_id && !r['freee deal_id']) {
          SheetUtil.updateRow(this.INVOICE_SHEET, r._rowNumber, {
            'freee deal_id': inv.deal_id,
          });
        }

        // 入金状況: payment_status を主、payment_status が不明なら deal を見る
        const paymentStatus = String(inv.payment_status || '').trim();
        const isSettled = paymentStatus === 'settled' || paymentStatus === 'paid';

        // 期日: invoice.payment_date を優先、なければ deal を試す、それもなければ推定
        let dueDate = null;
        if (inv.payment_date) {
          dueDate = new Date(inv.payment_date);
        } else if (inv.deal_id) {
          try {
            const deal = FreeeClient.getDeal(inv.deal_id);
            if (deal.due_date) dueDate = new Date(deal.due_date);
          } catch (_) { /* ignore */ }
        }
        if (!dueDate) dueDate = this._estimateDueDate(r);
        if (dueDate) dueDate.setHours(0, 0, 0, 0);

        const isPastDue = dueDate && today > dueDate;

        const client = clientMap[r['クライアントID']] || {};
        const clientName = client['企業名'] || r['クライアントID'];
        const total = Number(r['税込金額']) || 0;
        const dueDateStr = dueDate ? Utilities.formatDate(dueDate, 'JST', 'yyyy/MM/dd') : '不明';

        if (isSettled) {
          SheetUtil.updateRow(this.INVOICE_SHEET, r._rowNumber, {
            'ステータス': '入金済',
          });
          settled.push({
            invoiceId: r['請求ID'],
            clientName: clientName,
            total: total,
          });
        } else if (isPastDue) {
          // 既に未消込警告ならステータスは変えない(再通知のみ)
          if (String(r['ステータス'] || '').trim() !== '未消込警告') {
            SheetUtil.updateRow(this.INVOICE_SHEET, r._rowNumber, {
              'ステータス': '未消込警告',
            });
          }
          pastDue.push({
            invoiceId: r['請求ID'],
            clientName: clientName,
            total: total,
            dueDate: dueDateStr,
            dueAmount: total, // payment_status 不明時は全額残として扱う
            paymentStatus: paymentStatus,
          });
        } else {
          inGrace.push({
            invoiceId: r['請求ID'],
            clientName: clientName,
            dueDate: dueDateStr,
            paymentStatus: paymentStatus,
          });
        }

        Utilities.sleep(300); // freee API rate limit
      } catch (e) {
        Logger.log(`入金消込チェック失敗 ${r['請求ID']}: ${e.message}`);
        errors.push({ invoiceId: r['請求ID'], error: e.message });
      }
    });

    // Slack 通知
    if (pastDue.length > 0) {
      const lines = pastDue.map(p =>
        `- ${p.clientName} ${p.invoiceId} (期日:${p.dueDate}) 残額¥${p.dueAmount.toLocaleString()}`
      ).join('\n');
      Notifier.slack(
        `【未入金警告】期日超過の請求書が ${pastDue.length}件 あります:\n${lines}`
      );
    }
    if (settled.length > 0) {
      const lines = settled.map(s => `- ${s.clientName} ${s.invoiceId} 税込¥${s.total.toLocaleString()}`).join('\n');
      Notifier.slack(`入金消込完了: ${settled.length}件\n${lines}`);
    }

    return {
      checked: targets.length,
      settled: settled,
      pastDue: pastDue,
      inGrace: inGrace,
      errors: errors,
    };
  },

  /**
   * 月次トリガー登録 (毎月15日 9:00 JST)
   * 既存の同名トリガーは先に削除
   */
  installTrigger: function() {
    const removed = this.removeTrigger();
    ScriptApp.newTrigger(this.TRIGGER_FUNCTION_NAME)
      .timeBased()
      .onMonthDay(15)
      .atHour(9)
      .inTimezone('Asia/Tokyo')
      .create();
    return { removed: removed, installed: 1 };
  },

  removeTrigger: function() {
    const triggers = ScriptApp.getProjectTriggers();
    let count = 0;
    triggers.forEach(t => {
      if (t.getHandlerFunction() === this.TRIGGER_FUNCTION_NAME) {
        ScriptApp.deleteTrigger(t);
        count++;
      }
    });
    return count;
  },

  /**
   * 期日推定: deal に due_date が無い場合のフォールバック
   * 対象月 + 翌月末日
   * @private
   */
  _estimateDueDate: function(r) {
    const yearMonth = normalizeYearMonth(r['対象月']);
    const parts = String(yearMonth).split('-');
    const y = Number(parts[0]);
    const m = Number(parts[1]);
    if (!y || !m) return null;
    const date = new Date(y, m + 1, 0); // 翌月末日
    date.setHours(0, 0, 0, 0);
    return date;
  },
};

/**
 * トリガーから呼ばれるエントリーポイント
 */
function checkReconciliationTrigger() {
  try {
    const result = ReconcileCheck.check();
    Logger.log(
      `入金消込トリガー実行: ` +
      `対象${result.checked}件, 消込${result.settled.length}件, ` +
      `未消込警告${result.pastDue.length}件, ` +
      `期日内未消込${result.inGrace.length}件, ` +
      `エラー${result.errors.length}件`
    );
  } catch (e) {
    Logger.log(`入金消込トリガーエラー: ${e.message}`);
    Notifier.slack(`入金消込チェックでエラー: ${e.message}`);
    throw e;
  }
}

/**
 * メニューから呼ばれる: 手動で入金消込チェック実行
 */
function manualReconcileCheck() {
  const ui = SpreadsheetApp.getUi();
  try {
    const result = ReconcileCheck.check();

    if (result.checked === 0) {
      ui.alert(
        '入金消込チェック',
        '対象がありません(送付済 または 未消込警告 + freee deal_id あり の請求書が無い)',
        ui.ButtonSet.OK
      );
      return;
    }

    let msg = `対象: ${result.checked}件\n` +
              `入金済(消込確認): ${result.settled.length}件\n` +
              `未消込警告(期日超過): ${result.pastDue.length}件\n` +
              `期日内未消込: ${result.inGrace.length}件\n` +
              `エラー: ${result.errors.length}件`;

    if (result.settled.length > 0) {
      msg += '\n\n[入金済に更新]\n' + result.settled.map(s =>
        `- ${s.clientName} ${s.invoiceId} 税込¥${s.total.toLocaleString()}`
      ).join('\n');
    }
    if (result.pastDue.length > 0) {
      msg += '\n\n[未消込警告(期日超過)]\n' + result.pastDue.map(p =>
        `- ${p.clientName} ${p.invoiceId} 期日:${p.dueDate} 残¥${p.dueAmount.toLocaleString()}`
      ).join('\n');
    }
    if (result.inGrace.length > 0) {
      msg += '\n\n[期日内未消込]\n' + result.inGrace.map(g =>
        `- ${g.clientName} ${g.invoiceId} 期日:${g.dueDate}`
      ).join('\n');
    }
    if (result.errors.length > 0) {
      msg += '\n\n[エラー]\n' + result.errors.map(e => `- ${e.invoiceId}: ${e.error}`).join('\n');
    }

    ui.alert('入金消込チェック 完了', msg, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('入金消込チェック エラー', e.message, ui.ButtonSet.OK);
  }
}

/**
 * メニューから呼ばれる: 入金消込トリガーを登録(毎月15日 9:00)
 */
function installReconcileTriggerMenu() {
  const ui = SpreadsheetApp.getUi();
  try {
    const result = ReconcileCheck.installTrigger();
    ui.alert(
      '入金消込トリガー登録完了',
      `毎月15日 9:00(JST)に自動実行されます。\n\n` +
      `(既存トリガー ${result.removed} 件解除 → 新規 ${result.installed} 件登録)`,
      ui.ButtonSet.OK
    );
  } catch (e) {
    ui.alert('トリガー登録エラー', e.message, ui.ButtonSet.OK);
  }
}

/**
 * メニューから呼ばれる: 入金消込トリガーを解除
 */
function removeReconcileTriggerMenu() {
  const ui = SpreadsheetApp.getUi();
  const removed = ReconcileCheck.removeTrigger();
  ui.alert(
    '入金消込トリガー解除完了',
    `${removed} 件のトリガーを解除しました。`,
    ui.ButtonSet.OK
  );
}
