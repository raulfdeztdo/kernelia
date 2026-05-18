import { createLogger } from "@/lib/logger";

const log = createLogger("broadcast_telegram");

/**
 * Minimal Telegram Bot client for the Kernelia broadcaster.
 *
 * One POST per message: `sendMessage` with MarkdownV2 parsing. We don't
 * use disable_web_page_preview because the link card preview is exactly
 * the point — it makes the channel feed look richer at zero cost.
 *
 * Setup:
 *   1. Talk to @BotFather → /newbot. Get the bot token.
 *   2. Create a channel "Kernelia". Add the bot as an admin with
 *      "Post Messages" permission.
 *   3. Set TELEGRAM_CHAT_ID to the channel username (`@kernelia`) or
 *      the numeric channel id (negative integer).
 *
 * Required env vars:
 *   - TELEGRAM_BOT_TOKEN: e.g. "1234567890:AAB..."
 *   - TELEGRAM_CHAT_ID: "@kernelia" or "-100xxxx"
 */

export interface TelegramPostResult {
  /** Stored as `external_id`. Stringified — Telegram message_id is a number. */
  messageId: string;
}

export interface TelegramPostParams {
  /** MarkdownV2-escaped text (see lib/broadcast/format.ts → formatTelegram). */
  text: string;
  fetchImpl?: typeof fetch;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; cannot post to Telegram`);
  return value;
}

export async function postTelegram(params: TelegramPostParams): Promise<TelegramPostResult> {
  const token = requiredEnv("TELEGRAM_BOT_TOKEN");
  const chatId = requiredEnv("TELEGRAM_CHAT_ID");
  const fetchImpl = params.fetchImpl ?? fetch;

  const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: params.text,
      parse_mode: "MarkdownV2",
      // Default: preview enabled. Telegram fetches the OG metadata of
      // the URL inside the message and renders a card — saves us from
      // attaching images explicitly.
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "<no body>");
    log.error("post_failed", { status: res.status, detail: detail.slice(0, 200) });
    throw new Error(`Telegram ${res.status}: ${detail.slice(0, 200)}`);
  }
  const json = (await res.json()) as { ok?: boolean; result?: { message_id?: number } };
  const messageId = json.result?.message_id;
  if (!json.ok || messageId === undefined) {
    throw new Error("Telegram response missing result.message_id");
  }
  log.info("post_ok", { messageId });
  return { messageId: String(messageId) };
}
