import { describe, expect, it } from "vitest";
import { parseMessageFallback } from "./parse-fallback";

const NAMES = [
  "סופר / קניות מזון",
  "דלק",
  "אוכל בחוץ",
  "פארם",
  "בילויים",
  "חשמל ומים",
  "חסכונות",
];
const TODAY = "2026-10-11";
const parse = (text: string) => parseMessageFallback(text, NAMES, TODAY);

describe("parseMessageFallback", () => {
  it("parses a simple expense", () => {
    expect(parse("סופר 230")).toEqual([
      { type: "expense", amount: 230, category: "סופר / קניות מזון", description: "סופר", date: TODAY, cash: false },
    ]);
  });

  it("accepts the amount first, a currency word and decimals", () => {
    const [entry] = parse('45.90 ש"ח פיצה');
    expect(entry.amount).toBe(45.9);
    expect(entry.category).toBe("אוכל בחוץ");
    expect(entry.description).toBe("פיצה");
  });

  it("understands yesterday and the day before", () => {
    expect(parse("דלק 180 אתמול")[0]).toMatchObject({ category: "דלק", date: "2026-10-10" });
    expect(parse("דלק 180 שלשום")[0].date).toBe("2026-10-09");
  });

  it("splits several entries and keeps thousands separators intact", () => {
    const entries = parse("פיצה 60, קפה 14\nחשמל 1,250");
    expect(entries.map((e) => e.amount)).toEqual([60, 14, 1250]);
    expect(entries[2].category).toBe("חשמל ומים");
  });

  it("prefers the longest keyword", () => {
    expect(parse("סופר פארם 89")[0].category).toBe("פארם");
  });

  it("matches whole words only", () => {
    // "בר" (bar) must not match inside "חבר".
    expect(parse("החזרתי לחבר 50")[0].category).toBeNull();
    expect(parse("בבר 120")[0].category).toBe("בילויים");
  });

  it("recognizes income", () => {
    expect(parse("קיבלתי בונוס 1500")[0]).toMatchObject({
      type: "income",
      amount: 1500,
      category: null,
    });
  });

  it("maps a transfer to savings", () => {
    expect(parse("העברתי לחיסכון 1200")[0]).toMatchObject({ type: "expense", category: "חסכונות" });
  });

  it("ignores keywords for categories the household removed", () => {
    expect(parseMessageFallback("דלק 100", ["פארם"], TODAY)[0].category).toBeNull();
  });

  it("returns nothing when there is no amount", () => {
    expect(parse("כמה נשאר לנו החודש?")).toEqual([]);
  });

  it("marks a purchase paid in cash, but not a withdrawal or an income", () => {
    expect(parse("ירקות במזומן 80")[0]).toMatchObject({ amount: 80, cash: true });
    expect(parse("משכתי מזומן 300")[0]).toMatchObject({ amount: 300, cash: false });
    expect(parse("קיבלתי מזומן 200")[0]).toMatchObject({ type: "income", cash: false });
    expect(parse("סופר 230")[0]).toMatchObject({ cash: false });
  });
});
