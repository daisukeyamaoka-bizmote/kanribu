/**
 * 通知ユーティリティ(現在はスタブ)
 *
 * ステップ4で Slack Incoming Webhook 連携を実装予定。
 * それまでは Logger.log にフォールバック。
 */
const Notifier = {
  slack: function(message) {
    Logger.log(`[Slack stub] ${message}`);
  },
};
