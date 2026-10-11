import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { isValidDate } from "./dates";
import { isClaudeConfigured } from "./env";
import { parseMessageFallback } from "./parse-fallback";
import type { ParsedEntry } from "./types";

const MODEL = "claude-haiku-4-5";

export interface BotInterpretation {
  entries: ParsedEntry[];
  /** Free-text answer for questions; empty when the message only logged entries. */
  reply: string;
  usedClaude: boolean;
}

const SYSTEM_PROMPT = `You are the bookkeeping assistant inside a household budget app used by a couple in Israel. They send you short, informal Hebrew messages from their phones, usually right after paying for something, and the app turns what you extract into rows in their shared expense list. Accuracy matters more than cleverness: a wrong amount or category quietly distorts their monthly budget.

What to extract into "entries":
- Every expense or income the message reports. One message can contain several ("פיצה 60, קפה 14").
- "type" is "income" for money they received (salary, bonus, refund, gift, sold something) and "expense" for everything else. Moving money into savings or investments is an "expense" in the matching savings category.
- "amount" is in shekels, always positive.
- "category" must be the best fit from the allowed list. Use null for income, and for an expense only when nothing in the list reasonably fits; do not force a poor match.
- "description" is a few Hebrew words saying what it was (the shop or item), without the amount or the date.
- "date" is YYYY-MM-DD. Use today's date unless the message says otherwise ("אתמול", "שלשום", "ביום ראשון", a specific date). A weekday name means the most recent such day.

What to put in "reply":
- When you extracted at least one entry, leave it as an empty string. The app writes its own confirmation with the updated totals.
- When the message is a question about their money ("כמה נשאר לנו החודש?", "כמה הוצאנו על סופר?"), answer it in one or two short Hebrew sentences using only the month figures given to you. If the figures do not contain the answer, say so plainly instead of estimating.
- When a message mentions money but the amount is missing or unclear, ask for it in one short Hebrew sentence and extract nothing.
- For anything else, reply with one short Hebrew sentence explaining that they can write an expense such as "סופר 230" or ask about the month.

Write replies in plain, warm Hebrew, addressing them in the plural, with amounts written like ₪230.`;

function buildSchema(categoryNames: string[]) {
  const category =
    categoryNames.length > 0
      ? z.enum(categoryNames as [string, ...string[]]).nullable()
      : z.null();
  return z.object({
    entries: z.array(
      z.object({
        type: z.enum(["expense", "income"]),
        amount: z.number(),
        category,
        description: z.string(),
        date: z.string(),
      }),
    ),
    reply: z.string(),
  });
}

/**
 * zodOutputFormat rewrites the schema for the API and, in the SDK version in use,
 * moves `enum` into the field description, so the category list is only a hint
 * and Claude can answer with a name that is not in it. Send Zod's own JSON
 * schema instead, which keeps the enum, and keep the helper's parsing.
 */
function outputFormat(schema: ReturnType<typeof buildSchema>) {
  const jsonSchema: Record<string, unknown> = { ...z.toJSONSchema(schema) };
  delete jsonSchema.$schema;
  return { ...zodOutputFormat(schema), schema: jsonSchema };
}

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
}): Promise<BotInterpretation> {
  const { text, categoryNames, today, monthContext } = input;
  if (!isClaudeConfigured()) return fallback(text, categoryNames, today);

  try {
    const client = new Anthropic();
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Today's date: ${today}\n\nThis month so far:\n${monthContext}\n\nMessage from the user:\n${text}`,
        },
      ],
      output_config: { format: outputFormat(buildSchema(categoryNames)) },
    });

    const parsed = response.parsed_output;
    if (!parsed) return fallback(text, categoryNames, today);

    const entries: ParsedEntry[] = parsed.entries
      .filter((e) => Number.isFinite(e.amount) && e.amount > 0)
      .map((e) => ({
        type: e.type,
        amount: Math.round(e.amount * 100) / 100,
        category: e.type === "income" ? null : e.category,
        description: e.description.trim().slice(0, 200),
        date: isValidDate(e.date) ? e.date : today,
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
