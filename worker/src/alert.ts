import type { Env } from "./env";

/**
 * Post a short message to the Discord/Slack-compatible webhook (`content` for
 * Discord, `text` for Slack). Never throws: an alert failure must not fail the
 * rollup.
 */
export const sendAlert = async (env: Env, message: string): Promise<void> => {
  if (!env.ALERT_WEBHOOK) {
    return;
  }
  try {
    await fetch(env.ALERT_WEBHOOK, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: message, text: message }),
    });
  } catch {
    // Ignored on purpose.
  }
};
