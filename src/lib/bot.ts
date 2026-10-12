import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { isValidDate } from "./dates";
import { isClaudeConfigured } from "./env";
import { parseMessageFallback } from "./parse-fallback";
import type { ParsedEntry } from "./types";

const MODEL = "claude-haiku-5-5";

export interface BotInterpretation {
  entries: ParsedEntry[];
  /** Free-text answer for questions; empty when the message only logged entries. */
  reply: string;
  usedClaude: boolean;
}

const SYSTEM_PROMPT = `You are the bookkeeping assistant inside a household budget app used by a couple in Israel. They send you short, informal Hebrew messages from their phones, usually right after paying for something, and the app turns what you extract into rows in their shared expense list. Accuracy matters more than cleverness: a wrong amount or category quietly distorts their monthly budget.

What to extract into "entries":
- Every expense or income the message reports. One message can contain several ("פיצה 60, קפה 14"). Log it even when the month figures already show the same amount in that category: people fill the tank or shop for the same sum more than once, and those figures are only there for answering questions.
- "type" is "income" only when the message says money came in to them: a salary, a bonus, a refund, something they sold, or a gift they were given ("קיבלתי מתנה 500"). Everything else is an "expense", including a gift they bought or gave: "מתנה ליום הולדת 150" is money they spent on a present. Moving money into savings or investments is an "expense" in the matching savings category.
- "amount" is in shekels, always positive.
- "category" is the number of the category, from the numbered list sent with each message, that someone keeping this household's books would file the purchase under. Most everyday spending has an obvious home: a meal or coffee out goes under eating out, groceries under the supermarket, shoes or clothes under clothing, a present bought for someone under gifts, fuel under fuel. The list was written by the couple and has gaps, so use null when no category covers that kind of spending at all, rather than stretching an unrelated one: with no grooming category a haircut gets null, not bank fees, and the app files it as uncategorized for them to sort out. Income always gets null.
- "description" is a few Hebrew words saying what it was (the shop or item), without the amount or the date.
- "cash" is true when they say they paid for a purchase in cash ("קניתי במזומן ירקות 80", "שילמתי מזומן"). The app counts cash as spent when it is withdrawn, and uses this to take the purchase off that withdrawal instead of counting the money twice. A withdrawal itself ("משכתי 300 מכספומט") is not a cash purchase: it is an expense with "cash" false, filed under the cash category when the list has one. Income is always false.
- "date" is YYYY-MM-DD. Use today's date unless the message says otherwise ("אתמול", "שלשום", "ביום ראשון", a specific date). A weekday name means the most recent such day.

What to put in "reply":
- When you extracted at least one entry, leave it as an empty string. The app writes its own confirmation with the updated totals.
- When the message is a question about their money ("כמה נשאר לנו החודש?", "כמה הוצאנו על סופר?"), answer it in one or two short Hebrew sentences using only the month figures given to you. If the figures do not contain the answer, say so plainly instead of estimating.
- When a message mentions money but the amount is missing or unclear, ask for it in one short Hebrew sentence and extract nothing.
- For anything else, reply with one short Hebrew sentence explaining that they can write an expense such as "סופר 230" or ask about the month.

Write replies in plain, warm Hebrew, addressing them in the plural, with amounts written like ₪230.`;

// Categories are chosen by their number in a list sent with the message, not by
// name: asked for the Hebrew name, Claude returned near misses ("חשמל" for
// "חשמל ומים") that failed validation, and constraining the output to the exact
// names made it pick unrelated ones.
const schema = z.object({
  entries: z.array(
    z.object({
      type: z.enum(["expense", "income"]),
      amount: z.number(),
      category: z.number().nullable(),
      description: z.string(),
      date: z.string(),
      cash: z.boolean(),
    }),
  ),
  reply: z.string(),
});

function fallback(text: string, categoryNames: string[], today: string): BotInterpretation {
  const entries = parseMessageFallback(text, categoryNames, today);
  return {
    entries,
    reply:
      entries.length > 0
        ? ""
        : 'לא זיהיתי סכום בהודעה. אפשר לכתוב למשל "סופר 230" או "דלק 180 אתמול".',
    usedClaude: false,
  };
}

/**
 * Turns a chat message into entries to save and/or a reply.
 * monthContext is a plain-text snapshot of the month, used to answer questions.
 */
export async function interpretMessage(input: {
  text: string;
  categoryNames: string[];
  today: string;
  monthContext: string;
  /** False once the household has used up the day's Claude calls; the built-in parser takes over. */
  allowClaude?: boolean;
}): Promise<BotInterpretation> {
  const { text, categoryNames, today, monthContext, allowClaude = true } = input;
  if (!allowClaude || !isClaudeConfigured()) return fallback(text, categoryNames, today);

  const categoryList =
    categoryNames.map((name, i) => `${i + 1}. ${name}`).join("\n") || "(none defined)";

  try {
    const client = new Anthropic();
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Today's date: ${today}\n\nCategories:\n${categoryList}\n\nThis month so far:\n${monthContext}\n\nMessage from the user:\n${text}`,
        },
      ],
      output_config: { format: zodOutputFormat(schema) },
    });

    const parsed = response.parsed_output;
    if (!parsed) return fallback(text, categoryNames, today);

    const entries: ParsedEntry[] = parsed.entries
      .filter((e) => Number.isFinite(e.amount) && e.amount > 0)
      .map((e) => ({
        type: e.type,
        amount: Math.round(e.amount * 100) / 100,
        // A number outside the list counts as no category.
        category: e.type === "income" ? null : (categoryNames[(e.category ?? 0) - 1] ?? null),
        description: e.description.trim().slice(0, 200),
        date: isValidDate(e.date) ? e.date : today,
        cash: e.type === "expense" && e.cash,
      }));

    return { entries, reply: parsed.reply.trim(), usedClaude: true };
  } catch (error) {
    // The expense still gets logged through the built-in parser.
    if (error instanceof Anthropic.AuthenticationError) {
      console.error("Claude API key was rejected; using the built-in parser.");
    } else if (error instanceof Anthropic.RateLimitError) {
      console.error("Claude API rate limit reached; using the built-in parser.");
    } else if (error instanceof Anthropic.APIError) {
      console.error(`Claude API error ${error.status}; using the built-in parser.`);
    } else {
      console.error("Claude request failed; using the built-in parser.", error);
    }
    return fallback(text, categoryNames, today);
  }
}
