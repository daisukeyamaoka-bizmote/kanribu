/**
 * 通知ユーティリティ
 *
 * Slack Incoming Webhook に POST する。Webhook URL が未設定なら Logger.log にフォールバック。
 */
const Notifier = {
  slack: function(message) {
    const url = Config.getOrDefault('SLACK_WEBHOOK_URL', '');
    if (!url) {
      Logger.log(`[Slack stub] ${message}`);
      return;
    }

    try {
      const response = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ text: String(message) }),
        muteHttpExceptions: true,
      });
      const code = response.getResponseCode();
      if (code >= 400) {
        Logger.log(`Slack送信失敗 HTTP ${code}: ${response.getContentText().substring(0, 200)}\n元メッセージ: ${message}`);
      } else {
        Logger.log(`[Slack sent] ${String(message).substring(0, 100)}`);
      }
    } catch (e) {
      Logger.log(`Slack送信例外: ${e.message}\n元メッセージ: ${message}`);
    }
  },
};
