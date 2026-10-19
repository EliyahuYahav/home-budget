// Files imported charges under the household's budget categories, using Claude.

import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-haiku-5-5";
const CATEGORIZE_BATCH = 40;

// Written out as plain JSON Schema rather than with zod: this folder's own dependencies bring
// an older zod than the one the Claude SDK's helper needs, and the two do not mix.
const categoryFormat = {
  type: "json_schema",
  schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            line: { type: "integer" },
            category: { anyOf: [{ type: "integer" }, { type: "null" }] },
          },
          required: ["line", "category"],
          additionalProperties: false,
        },
      },
    },
    required: ["items"],
    additionalProperties: false,
  },
};

const CATEGORY_PROMPT = `You file bank and credit card charges for a household in Israel into the categories of their budget app. Each charge is a line with the merchant name exactly as the bank printed it (often abbreviated, in Hebrew or English) and the amount in shekels.

For every line, return the number of the category that someone keeping this household's books would file it under. A supermarket chain goes under groceries, a restaurant or cafe under eating out, a fuel station under fuel, a pharmacy chain under the pharmacy category, and so on. The list was written by the couple and has gaps: when no category covers that kind of spending, or the merchant name does not tell you what was bought, return null rather than stretching an unrelated category. The app shows those as uncategorized for them to sort out, which is better than a wrong guess quietly distorting their budget.

Lines from the bank account itself read differently from card purchases. A standing order names who was paid ("... חיוב"): file it by what that payee is, for example a charity under donations or an insurer under the matching bill. Interest and bank fees go under the interest and fees categories. A transfer to a person, tax withheld at source, a cash withdrawal, and the monthly charge of a credit card company (\"כ.א.ל חיוב\", \"ישראכרט\", \"חיוב לכרטיס ויזה 1234\") say nothing about what the money was spent on, so they get null.

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
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 8192,
        system: CATEGORY_PROMPT,
        messages: [{ role: "user", content: `Categories:\n${categoryList}\n\nCharges:\n${lines}` }],
        output_config: { format: categoryFormat },
      });
      const text = response.content.find((block) => block.type === "text")?.text ?? "{}";
      for (const item of JSON.parse(text).items ?? []) {
        const candidate = batch[item.line - 1];
        const category = categories[(item.category ?? 0) - 1];
        if (candidate && category) result[start + item.line - 1] = category.id;
      }
    }
  } catch (error) {
    const reason = error instanceof Anthropic.APIError ? `API error ${error.status ?? error.name}` : `${error?.name}: ${String(error?.message).slice(0, 200)}`;
    log(`Claude could not categorize (${reason}); the new rows are left without a category.`);
  }
  return result;
}
