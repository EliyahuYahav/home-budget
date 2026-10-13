// Where Telegram delivers what people write to the bot. Anyone can find and write to a bot,
// so a chat can do nothing until a signed-in member has linked it from the settings screen.
import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { handleChatMessage } from "@/lib/chat";
import { createAdminClient, memberContext, sameSecret } from "@/lib/supabase/admin";
import { isTelegramConfigured, linkCodeOf, readUpdate, sendTelegramMessage, webhookSecret } from "@/lib/telegram";

const NOT_LINKED =
  'הצ\'אט הזה עוד לא מחובר לתקציב. נכנסים לאפליקציה, פותחים את ההגדרות, ולוחצים שם על "חיבור לטלגרם".';

export async function POST(request: Request) {
  if (!isTelegramConfigured()) return new Response("not configured", { status: 503 });
  if (!sameSecret(request.headers.get("x-telegram-bot-api-secret-token"), webhookSecret())) {
    return new Response("forbidden", { status: 403 });
  }
  const admin = createAdminClient();
  if (!admin) return new Response("not configured", { status: 503 });

  const raw = await request.text();
  let update: unknown = null;
  try {
    update = raw.length <= 20_000 ? JSON.parse(raw) : null;
  } catch {
    // Not an update; answered below like anything else that is not a private message.
  }
  const message = readUpdate(update);
  // Telegram sends an update again until it is answered with success, so everything that
  // came with the right secret is answered that way, whatever became of it.
  if (!message) return new Response("ok");

  try {
    await sendTelegramMessage(message.chatId, await answer(admin, message.chatId, message.text));
  } catch (error) {
    console.error("telegram webhook failed", error);
    await sendTelegramMessage(message.chatId, "משהו השתבש אצלי. נסו שוב בעוד רגע.").catch(() => {});
  }
  return new Response("ok");
}

async function answer(admin: SupabaseClient, chatId: number, text: string): Promise<string> {
  const code = linkCodeOf(text);
  if (code) return link(admin, chatId, code);

  const { data: chat } = await admin.from("telegram_chats").select("user_id").eq("chat_id", chatId).maybeSingle();
  const ctx = chat ? await memberContext(admin, chat.user_id as string) : null;
  if (!ctx) return NOT_LINKED;

  const command = text.trim();
  if (command === "/stop") {
    await admin.from("telegram_chats").delete().eq("chat_id", chatId);
    return "הצ'אט נותק מהתקציב. אפשר לחבר אותו שוב מההגדרות.";
  }
  if (command.startsWith("/start")) {
    return 'הצ\'אט מחובר. אפשר לכתוב הוצאה, למשל "סופר 230", או לשאול על החודש.';
  }

  const { botMessage } = await handleChatMessage(ctx, text);
  revalidatePath("/", "layout");
  return botMessage.content;
}

/** Ties a chat to the member who made the code, once, while the code is fresh. */
async function link(admin: SupabaseClient, chatId: number, code: string): Promise<string> {
  const { data: row } = await admin
    .from("telegram_link_codes")
    .select("user_id, expires_at")
    .eq("code", code)
    .maybeSingle();
  // The code is spent, and so is every code that was left to run out.
  if (row) await admin.from("telegram_link_codes").delete().eq("code", code);
  await admin.from("telegram_link_codes").delete().lt("expires_at", new Date().toISOString());
  if (!row || Date.parse(row.expires_at as string) < Date.now()) {
    return "הקישור הזה כבר לא בתוקף. יוצרים חדש במסך ההגדרות של האפליקציה.";
  }
  const ctx = await memberContext(admin, row.user_id as string);
  if (!ctx) return NOT_LINKED;

  const { error } = await admin
    .from("telegram_chats")
    .upsert({ chat_id: chatId, household_id: ctx.household.id, user_id: ctx.userId, linked_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  return `שלום ${ctx.displayName}, הצ'אט מחובר ל"${ctx.household.name}". אפשר לכתוב כאן הוצאה, למשל "סופר 230", או לשאול על החודש. לניתוק: /stop`;
}
