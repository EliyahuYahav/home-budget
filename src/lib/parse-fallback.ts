// Rule-based parser for chat messages. Used when no Claude API key is configured
// or the API call fails, so logging an expense never depends on an external service.
import { shiftDate } from "./dates";
import type { ParsedEntry } from "./types";

const INCOME_WORDS = ["קיבלתי", "קיבלנו", "הכנסה", "משכורת", "בונוס", "החזר מס", "זיכוי", "נכנס לי", "נכנסו"];

// Keyword -> category name, as seeded in supabase/schema.sql. A keyword only
// counts if the household still has a category with that exact name.
const KEYWORDS: Record<string, string[]> = {
  "סופר / קניות מזון": ["סופר", "שופרסל", "רמי לוי", "מכולת", "ירקות", "ירקן", "קניות", "אושר עד", "ויקטורי", "יוחננוף", "מעדניה", "קצביה"],
  "דלק": ["דלק", "תדלוק", "סונול", "דור אלון"],
  "אוכל בחוץ": ["מסעדה", "פיצה", "קפה", "המבורגר", "וולט", "שווארמה", "פלאפל", "סושי", "אוכל בחוץ", "משלוח"],
  'תחב"צ': ["אוטובוס", "רכבת", "רב קו", "מונית", "תחבורה"],
  "פארם": ["סופר פארם", "פארם", "טיפוח"],
  "תרופות": ["תרופות", "תרופה", "בית מרקחת"],
  "טיפולי שיניים": ["שיניים", "שיננית"],
  "טיפולים": ["טיפול", "פיזיותרפיה", "פסיכולוג", "רופא"],
  "אופטיקה": ["משקפיים", "עדשות", "אופטיקה"],
  "בילויים": ["סרט", "קולנוע", "בילוי", "הופעה", "באולינג", "בר"],
  "ביגוד ונעליים": ["בגדים", "ביגוד", "נעליים", "חולצה", "מכנסיים"],
  "מתנות לאירועים": ["מתנה", "חתונה", "בר מצווה", "ברית", "אירוע"],
  'חופשות בארץ/בחו"ל': ["חופשה", "מלון", "טיסה", "צימר"],
  "תרומות/מעשר": ["תרומה", "מעשר", "צדקה"],
  "שכירות": ["שכירות", "שכר דירה"],
  "ועד בית": ["ועד בית"],
  "חשמל ומים": ["חשמל", "מים"],
  "גז": ["גז"],
  "אינטרנט": ["אינטרנט"],
  "סלולר": ["סלולר", "חבילת גלישה"],
  "מנוי לחדר כושר וכדומה": ["חדר כושר", "מנוי"],
  "שירותי ענן": ["ענן", "icloud", "google one", "נטפליקס", "ספוטיפיי"],
  "עמלות": ["עמלה", "עמלות"],
  "ריביות": ["ריבית"],
  "חסכונות": ["חיסכון", "חסכון", "חסכונות"],
  "השקעות": ["השקעה", "השקעות", "מניות"],
};

const AMOUNT = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/;

function matchCategory(text: string, categoryNames: string[]): string | null {
  const lower = text.toLowerCase();
  // A category mentioned by its own name wins over keyword guesses.
  const direct = categoryNames
    .filter((name) => lower.includes(name.toLowerCase()))
    .sort((a, b) => b.length - a.length)[0];
  if (direct) return direct;

  // Whole words only (with an optional one-letter Hebrew prefix such as ב/ל/ה),
  // so "בר" does not match inside "חבר".
  const padded = ` ${lower.replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  let best: { name: string; length: number } | null = null;
  for (const [name, words] of Object.entries(KEYWORDS)) {
    if (!categoryNames.includes(name)) continue;
    for (const word of words) {
      const found = new RegExp(` [בלהומש]?${word} `).test(padded);
      // Longest keyword wins, so "סופר פארם" beats "סופר".
      if (found && (!best || word.length > best.length)) {
        best = { name, length: word.length };
      }
    }
  }
  return best?.name ?? null;
}

function parseDate(text: string, today: string): { date: string; rest: string } {
  if (text.includes("שלשום")) return { date: shiftDate(today, -2), rest: text.replace("שלשום", " ") };
  if (text.includes("אתמול")) return { date: shiftDate(today, -1), rest: text.replace("אתמול", " ") };
  return { date: today, rest: text.replace("היום", " ") };
}

function parsePart(part: string, categoryNames: string[], today: string): ParsedEntry | null {
  const { date, rest } = parseDate(part, today);
  const match = rest.match(AMOUNT);
  if (!match) return null;
  const amount = Number(`${match[1].replace(/,/g, "")}.${match[2] ?? "0"}`);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const isIncome = INCOME_WORDS.some((word) => rest.includes(word));
  const description = rest
    .replace(match[0], " ")
    .replace(/₪|ש"ח|שקלים|שקל|שח/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^(על|ב|ל|של)\s+/, "")
    .trim();

  return {
    type: isIncome ? "income" : "expense",
    amount,
    category: isIncome ? null : matchCategory(rest, categoryNames),
    description,
    date,
    // A withdrawal is cash being taken out, not something bought with it.
    cash: !isIncome && /מזומן/.test(rest) && !/משכתי|משיכה|כספומט/.test(rest),
  };
}

/** Parses messages like "סופר 230", "דלק 180 אתמול" or "פיצה 60, קפה 14". */
export function parseMessageFallback(
  text: string,
  categoryNames: string[],
  today: string,
): ParsedEntry[] {
  return text
    .split(/[\n;]|,(?!\d{3})/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => parsePart(part, categoryNames, today))
    .filter((entry): entry is ParsedEntry => entry !== null);
}
