/**
 * Run this ONCE after deployment to register your public URL with Telegram.
 *
 * Usage:
 *   npx ts-node src/scripts/setWebhook.ts
 *
 * Requirements in .env:
 *   TELEGRAM_BOT_TOKEN   — from BotFather
 *   TELEGRAM_WEBHOOK_URL — your public server URL, e.g. https://myapp.fly.dev
 */

import dotenv from "dotenv";
dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_URL = process.env.TELEGRAM_WEBHOOK_URL;

if (!BOT_TOKEN || !WEBHOOK_URL) {
  console.error(
    "❌  Missing TELEGRAM_BOT_TOKEN or TELEGRAM_WEBHOOK_URL in .env"
  );
  process.exit(1);
}

const fullWebhookUrl = `${WEBHOOK_URL}/webhook/telegram`;

(async () => {
  // 1. Set the webhook
  const setRes = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: fullWebhookUrl,
        allowed_updates: ["channel_post", "edited_channel_post", "deleted_messages"],
        drop_pending_updates: true,
      }),
    }
  );

  const setData = (await setRes.json()) as { ok: boolean; description?: string };

  if (!setData.ok) {
    console.error("❌  Failed to set webhook:", setData.description);
    process.exit(1);
  }

  console.log("✅  Webhook registered:", fullWebhookUrl);

  // 2. Verify it
  const infoRes = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`
  );
  const infoData = (await infoRes.json()) as {
    ok: boolean;
    result: {
      url: string;
      has_custom_certificate: boolean;
      pending_update_count: number;
      last_error_message?: string;
    };
  };

  if (infoData.ok) {
    console.log("\n📋  Webhook info:");
    console.log("   URL            :", infoData.result.url);
    console.log("   Pending updates:", infoData.result.pending_update_count);
    if (infoData.result.last_error_message) {
      console.warn("   ⚠️  Last error  :", infoData.result.last_error_message);
    }
  }
})();
