// Talking to Telegram's bot API. The bot token is part of every address, so no error from
// here carries the address it was calling. Server-only.
import { createHmac } from "node:crypto";

const token = () => process.env.TELEGRAM_BOT_TOKEN ?? "";

/** The bot token is set, and so is the key the webhook's secret is made from. */
export function isTelegramConfigured(): boolean {
  return token() !== "" && (process.env.SECRETS_KEY ?? "").length >= 32;
}

/**
 * What Telegram must send with every update for it to be believed. Made from SECRETS_KEY, so
 * there is no separate secret to keep, and it cannot be turned back into that key.
 */
export function webhookSecret(): string | null {
  const key = process.env.SECRETS_KEY;
  if (!key || key.length < 32) return null;
  return createHmac("sha256", key).update("telegram-webhook").digest("hex");
}

async function call<T>(method: string, body: Record<string, unknown>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error(`Telegram did not answer (${method})`);
  }
  const answer = (await response.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
  if (!answer?.ok) throw new Error(`Telegram refused ${method}: ${answer?.description ?? response.status}`);
  return answer.result as T;
}

/** Telegram cuts a message at 4096 characters. */
export async function sendTelegramMessage(chatId: number, text: string): Promise<void> {
  await call("sendMessage", { chat_id: chatId, text: text.slice(0, 4000), link_preview_options: { is_disabled: true } });
}

export async function botUsername(): Promise<string> {
  return (await call<{ username: string }>("getMe", {})).username;
}

/** Tells Telegram where to deliver messages, and the secret to deliver them with. */
export async function registerWebhook(url: string): Promise<void> {
  await call("setWebhook", {
    url,
    secret_token: webhookSecret(),
    allowed_updates: ["message"],
    drop_pending_updates: true,
  });
}

export interface IncomingMessage {
  chatId: number;
  text: string;
}

/** The text of a private message, or null for anything else (groups, photos, edits). */
export function readUpdate(update: unknown): IncomingMessage | null {
  const message = (update as { message?: { text?: unknown; chat?: { id?: unknown; type?: unknown } } } | null)?.message;
  if (!message || typeof message.text !== "string" || message.chat?.type !== "private") return null;
  const chatId = message.chat.id;
  if (typeof chatId !== "number" || !Number.isSafeInteger(chatId)) return null;
  return { chatId, text: message.text };
}

/** The code in "/start <code>", the message a link from the settings screen opens the bot with. */
export function linkCodeOf(text: string): string | null {
  const match = /^\/start(?:@\w+)?\s+([a-f0-9]{32})\s*$/.exec(text.trim());
  return match ? match[1] : null;
}
