// Recognising the same payee in two rows, so a category chosen once is used again.
// Shared by the website (filing the other rows of a payee) and the sync (filing new ones).

/**
 * What stays the same between two charges from one payee: the description without the notes
 * the sync adds ("(תשלום 2 מתוך 6)", "(נכנס ב־31.10)"), in lower case, with single spaces.
 * Empty for a row with no description, which matches nothing.
 */
export function payeeKey(description) {
  return String(description ?? "")
    .replace(/\(תשלום \d+ מתוך \d+\)/g, "")
    .replace(/\(נכנס ב־[\d.]+\)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * The category each payee was last filed under.
 *
 * @param {{ description: string, category_id: string | null }[]} rows Categorized rows, the most recent first.
 * @returns {Map<string, string>} payee key -> category id
 */
export function learnCategories(rows) {
  const learned = new Map();
  for (const row of rows) {
    const key = payeeKey(row.description);
    if (key && row.category_id && !learned.has(key)) learned.set(key, row.category_id);
  }
  return learned;
}

/**
 * A bank line that takes cash out of an ATM ("מש' מכספומט דיסקונט 10/09"). Only these belong in
 * the cash category: a card's monthly charge or a transfer is not cash, whatever it was filed as.
 */
export function isCashWithdrawal(description) {
  return /כספומט|משיכת מזומן|משיכה במזומן|\bATM\b/i.test(String(description ?? ""));
}
