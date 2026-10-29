// The bot: one message in, rows saved and an answer out. Server-only.
import { interpretMessage } from "./bot";
import { formatILS, isCashCategory, summarizeMonth } from "./budget";
import { resolveClaudeKey } from "./claude-key";
import { getMonthData, type AppContext } from "./data";
import { monthOf, shortDate, todayISO } from "./dates";
import { describeLastRun, parseSyncCommand, planSyncRequest, type SyncCommand, type SyncSnapshot } from "./sync-command";
import type { ChatMessage, ParsedEntry } from "./types";

function describeEntry(entry: ParsedEntry, today: string): string {
  const when = entry.date === today ? "היום" : shortDate(entry.date);
  const what = entry.type === "income" ? "הכנסה" : (entry.category ?? "ללא קטגוריה");
  const detail = entry.description ? ` · ${entry.description}` : "";
  return `${formatILS(entry.amount)} · ${what}${detail} · ${when}${entry.cash ? " · במזומן" : ""}`;
}

/**
 * Reads one message from a member, saves what it asks to record, and answers. Every row is
 * written with the member's id spelled out, so it does not depend on the database filling it
 * in from whoever is signed in.
 */
export async function handleChatMessage(
  ctx: AppContext,
  message: string,
): Promise<{ userMessage: ChatMessage; botMessage: ChatMessage; entryIds: string[] }> {
  const content = message.trim().slice(0, 500);
  if (!content) throw new Error("empty message");

  // A sync command is answered here, before the month is read or Claude is asked: it costs
  // nothing and does not depend on how the model reads the message.
  const command = parseSyncCommand(content);
  if (command) {
    const reply = await answerSyncCommand(ctx, command);
    return { ...(await saveExchange(ctx, content, reply)), entryIds: [] };
  }

  const today = todayISO();
  const month = monthOf(today);
  const before = await getMonthData(ctx, month);
  const active = before.categories.filter((c) => !c.archived);
  const summaryBefore = summarizeMonth({ month, today, ...before });

  const monthContext = [
    `Income: ${summaryBefore.income}${summaryBefore.incomeIsEstimated ? " (estimated from the planned budget; no income was entered)" : ""}`,
    `Savings target: ${summaryBefore.savingsTarget}, saved so far: ${summaryBefore.saved}`,
    `Put into funds for yearly expenses this month: ${summaryBefore.fundsReserved}`,
    `Spent so far: ${summaryBefore.spent}`,
    `Remaining after savings and funds: ${summaryBefore.remaining}`,
    `Free for day-to-day spending after unpaid fixed bills: ${summaryBefore.flexibleRemaining}`,
    `Days left in the month including today: ${summaryBefore.daysLeft}`,
    `Safe to spend today: ${summaryBefore.safeToSpendToday}`,
    "Per category (spent / monthly budget):",
    ...summaryBefore.categories
      .filter((c) => !c.fund)
      .map((c) => `- ${c.category.name}: ${c.spent} / ${c.category.monthly_budget}`),
    ...(summaryBefore.categories.some((c) => c.goal)
      ? [
          "Savings goals (saved so far / goal; wanted by; needed every month to arrive on time):",
          ...summaryBefore.categories
            .filter((c) => c.goal)
            .map(
              (c) =>
                `- ${c.category.name}: ${c.goal!.saved} / ${c.goal!.target}; ${c.goal!.due ?? "no date"}; ${c.goal!.neededPerMonth ?? "-"}`,
            ),
        ]
      : []),
    ...(summaryBefore.categories.some((c) => c.fund)
      ? [
          "Funds for yearly expenses (in the fund now; put in every month; charged this month). A charge filed under a fund is paid from the fund and does not reduce what is free this month:",
          ...summaryBefore.categories
            .filter((c) => c.fund)
            .map((c) => `- ${c.category.name}: ${c.fund!.balance}; ${c.fund!.contribution}; ${c.spent}`),
        ]
      : []),
  ].join("\n");

  const claudeKey = await resolveClaudeKey(ctx);

  const interpretation = await interpretMessage({
    text: content,
    categoryNames: active.map((c) => c.name),
    today,
    monthContext,
    apiKey: claudeKey.apiKey,
  });

  const idByName = new Map(active.map((c) => [c.name, c.id]));
  let reply = interpretation.reply;
  let entryIds: string[] = [];

  if (interpretation.entries.length > 0) {
    const { data: saved, error } = await ctx.supabase.from("transactions").insert(
      interpretation.entries.map((entry) => ({
        household_id: ctx.household.id,
        user_id: ctx.userId,
        type: entry.type,
        amount: entry.amount,
        category_id: entry.category ? (idByName.get(entry.category) ?? null) : null,
        description: entry.description,
        occurred_on: entry.date,
        source: "chat",
        ...(entry.cash ? { paid_in_cash: true } : {}),
      })),
    ).select("id");
    if (error) throw new Error(error.message);
    entryIds = (saved ?? []).map((row) => row.id as string);

    // Confirmation is built from the saved data, not from the model's wording.
    const after = await getMonthData(ctx, month);
    const summary = summarizeMonth({ month, today, ...after });
    const lines = [
      interpretation.entries.length === 1 ? "נרשם:" : `נרשמו ${interpretation.entries.length} שורות:`,
      ...interpretation.entries.map((entry) => describeEntry(entry, today)),
    ];

    const touched = new Set(interpretation.entries.map((e) => e.category).filter(Boolean));
    for (const status of summary.categories) {
      if (!touched.has(status.category.name)) continue;
      if (status.fund) {
        lines.push(
          status.fund.shortfall > 0
            ? `${status.category.name}: הקרן התרוקנה, ו־${formatILS(status.fund.shortfall)} ירדו מהחודש`
            : `${status.category.name}: שולם מהקרן, נשארו בה ${formatILS(status.fund.balance)}`,
        );
        continue;
      }
      if (status.goal) {
        lines.push(
          status.goal.left > 0
            ? `${status.category.name}: ${formatILS(status.goal.saved)} מתוך ${formatILS(status.goal.target)}, נשארו ${formatILS(status.goal.left)} ליעד`
            : `${status.category.name}: היעד של ${formatILS(status.goal.target)} הושג`,
        );
        continue;
      }
      if (status.category.monthly_budget === 0) continue;
      const percent = Math.round((status.ratio ?? 0) * 100);
      const flag = status.status === "over" ? " — חריגה מהתקציב" : status.status === "warning" ? " — מתקרבים לתקרה" : "";
      lines.push(
        `${status.category.name}: ${formatILS(status.spent)} מתוך ${formatILS(status.category.monthly_budget)} (${percent}%)${flag}`,
      );
    }
    if (interpretation.entries.some((e) => e.type === "expense" && e.category === null)) {
      lines.push("לא מצאתי קטגוריה מתאימה לחלק מהשורות. אפשר לבחור אחת במסך ההוצאות.");
    }
    if (interpretation.entries.some((e) => e.cash)) {
      lines.push(
        active.some(isCashCategory)
          ? "מה ששולם במזומן יורד ממשיכות המזומן של החודש, כדי שלא ייספר פעמיים."
          : 'כדי שקניות במזומן ירדו מהמשיכות, צריך קטגוריה בשם "מזומן" במסך התקציב.',
      );
    }
    if (interpretation.entries.some((e) => monthOf(e.date) === month)) {
      lines.push(`מותר להוציא היום: ${formatILS(summary.safeToSpendToday)}`);
    }
    reply = lines.join("\n");
  }

  if (!reply) reply = 'אפשר לכתוב לי הוצאה, למשל "סופר 230", או לשאול על החודש.';

  return { ...(await saveExchange(ctx, content, reply)), entryIds };
}

/** Reads the sync state, queues a request when it should, and returns the bot's answer. */
async function answerSyncCommand(ctx: AppContext, command: SyncCommand): Promise<string> {
  const [settings, runs] = await Promise.all([
    ctx.supabase
      .from("bank_sync_settings")
      .select("credentials, agent_seen_at")
      .eq("household_id", ctx.household.id)
      .maybeSingle(),
    ctx.supabase
      .from("bank_sync_runs")
      .select("status, dry_run, output, created_at, finished_at")
      .eq("household_id", ctx.household.id)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);
  if (settings.error || runs.error) return "לא הצלחתי לקרוא את מצב הסנכרון. אפשר לנסות שוב או לבדוק במסך המפתחים.";

  const snapshot: SyncSnapshot = {
    agentSeenAt: settings.data?.agent_seen_at ?? null,
    hasLogins: Boolean(settings.data?.credentials),
    lastRun: (runs.data?.[0] as SyncSnapshot["lastRun"]) ?? null,
  };
  const now = Date.now();
  if (command.kind === "status") return describeLastRun(snapshot, now);

  const plan = planSyncRequest(snapshot, command.monthsBack, now);
  if (!plan.queue) return plan.reply;
  const { error } = await ctx.supabase.from("bank_sync_runs").insert({
    household_id: ctx.household.id,
    requested_by: ctx.userId,
    dry_run: false,
    ...(command.monthsBack > 1 ? { months_back: command.monthsBack } : {}),
  });
  return error ? "הבקשה לסנכרון לא נשמרה. אפשר לנסות שוב או לבקש ממסך המפתחים." : plan.reply;
}

async function saveExchange(
  ctx: AppContext,
  content: string,
  reply: string,
): Promise<{ userMessage: ChatMessage; botMessage: ChatMessage }> {
  // Explicit timestamps: rows inserted together would otherwise share one
  // created_at and could come back in either order.
  const now = Date.now();
  const { data, error } = await ctx.supabase
    .from("chat_messages")
    .insert([
      { household_id: ctx.household.id, user_id: ctx.userId, role: "user", content, created_at: new Date(now).toISOString() },
      { household_id: ctx.household.id, user_id: ctx.userId, role: "bot", content: reply, created_at: new Date(now + 1).toISOString() },
    ])
    .select("id, user_id, role, content, created_at");
  if (error || !data) throw new Error(error?.message ?? "failed to save messages");

  const userMessage = data.find((m) => m.role === "user") as ChatMessage;
  const botMessage = data.find((m) => m.role === "bot") as ChatMessage;
  return { userMessage, botMessage };
}
