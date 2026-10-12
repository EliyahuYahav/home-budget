// Files imported charges under the household's budget categories, using Claude.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const MODEL = "claude-haiku-5-5";
const CATEGORIZE_BATCH = 40;

const categorySchema = z.object({
  items: z.array(z.object({ line: z.number(), category: z.number().nullable() })),
});

const CATEGORY_PROMPT = `You file bank and credit card charges for a household in Israel into the categories of their budget app. Each charge is a line with the merchant name exactly as the bank printed it (often abbreviated, in Hebrew or English) and the amount in shekels.

For every line, return the number of the category that someone keeping this household's books would file it under. A supermarket chain goes under groceries, a restaurant or cafe under eating out, a fuel station under fuel, a pharmacy chain under the pharmacy category, and so on. The list was written by the couple and has gaps: when no category covers that kind of spending, or the merchant name does not tell you what was bought, return null rather than stretching an unrelated category. The app shows those as uncategorized for them to sort out, which is better than a wrong guess quietly distorting their budget.

Return one item per line, using the line numbers given.`;

/** Returns one category id (or null) per candidate. Never throws: on any failure the rows stay uncategorized. */
export async function categorize(candidates, categories, log = console.error) {
  const result = candidates.map(() => null);
  if (!process.env.ANTHROPIC_API_KEY || categories.length === 0 || candidates.length === 0) return result;

  const client = new Anthropic();
  const categoryList = categories.map((c, i) => `${i + 1}. ${c.name}`).join("\n");
  try {
    for (let start = 0; start < candidates.length; start += CATEGORIZE_BATCH) {
      const batch = candidates.slice(start, start + CATEGORIZE_BATCH);
      const lines = batch.map((c, i) => `${i + 1}. ${c.description} | ${c.amount}`).join("\n");
      const response = await client.messages.parse({
        model: MODEL,
        max_tokens: 8192,
        system: CATEGORY_PROMPT,
        messages: [{ role: "user", content: `Categories:\n${categoryList}\n\nCharges:\n${lines}` }],
        output_config: { format: zodOutputFormat(categorySchema) },
      });
      for (const item of response.parsed_output?.items ?? []) {
        const candidate = batch[item.line - 1];
        const category = categories[(item.category ?? 0) - 1];
        if (candidate && category) result[start + item.line - 1] = category.id;
      }
    }
  } catch (error) {
    const reason = error instanceof Anthropic.APIError ? `API error ${error.status}` : "request failed";
    log(`Claude could not categorize (${reason}); the new rows are left without a category.`);
  }
  return result;
}
