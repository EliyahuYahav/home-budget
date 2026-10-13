import { describe, expect, it } from "vitest";
import { countedNextMonth, israelDate, planImport, toCandidates } from "./plan.mjs";

const txn = (over = {}) => ({
  identifier: 1001,
  date: "2026-10-04T21:00:00.000Z",
  chargedAmount: -230,
  description: "שופרסל דיל",
  status: "completed",
  ...over,
});

const source = (txns, over = {}) => ({
  company: "max",
  kind: "card",
  accounts: [{ accountNumber: "1234", txns }],
  ...over,
});

describe("israelDate", () => {
  it("reads the scraper's UTC instant as the day it is in Israel", () => {
    expect(israelDate("2026-10-04T21:00:00.000Z")).toBe("2026-10-05");
    expect(israelDate("2026-01-14T22:00:00.000Z")).toBe("2026-01-15");
  });
});

describe("countedNextMonth", () => {
  it("moves the last two days of a month to the 1st of the next", () => {
    expect(countedNextMonth("2026-10-31", 2)).toBe("2026-11-01");
    expect(countedNextMonth("2026-10-30", 2)).toBe("2026-11-01");
    expect(countedNextMonth("2026-10-29", 2)).toBeNull();
    expect(countedNextMonth("2026-11-01", 2)).toBeNull();
  });

  it("knows how long each month is, and crosses the year", () => {
    expect(countedNextMonth("2026-09-30", 2)).toBe("2026-10-01");
    expect(countedNextMonth("2026-02-27", 2)).toBe("2026-03-01");
    expect(countedNextMonth("2026-02-26", 2)).toBeNull();
    expect(countedNextMonth("2028-02-29", 2)).toBe("2028-03-01");
    expect(countedNextMonth("2026-12-31", 2)).toBe("2027-01-01");
  });

  it("is off with zero days", () => {
    expect(countedNextMonth("2026-10-31", 0)).toBeNull();
  });
});

describe("toCandidates", () => {
  it("turns a completed charge into a positive expense with a stable id", () => {
    const { candidates } = toCandidates([source([txn()])]);
    expect(candidates).toEqual([
      {
        externalId: "max:1234:1001",
        company: "max",
        account: "1234",
        type: "expense",
        amount: 230,
        date: "2026-10-05",
        description: "שופרסל דיל",
      },
    ]);
  });

  it("counts, for each account, what became of its lines", () => {
    const bank = {
      company: "discount",
      kind: "bank",
      accounts: [
        {
          accountNumber: "111",
          txns: [
            txn({ identifier: 1, chargedAmount: -2000, description: "העברה" }),
            txn({ identifier: 2, description: "מקס איט פיננסים" }),
            txn({ identifier: 3, chargedAmount: 9000, description: "משכורת" }),
          ],
        },
        {
          accountNumber: "222",
          txns: [txn({ identifier: 4, chargedAmount: 2000 }), txn({ identifier: 5 }), txn({ identifier: 6, status: "pending" })],
        },
      ],
    };
    const { accounts } = toCandidates([bank], { cards: ["max"] });
    expect(accounts).toEqual([
      { company: "discount", account: "111", lines: 3, expenses: 0, income: 1, pending: 0, cardCharges: 1, ownTransfers: 1 },
      { company: "discount", account: "222", lines: 3, expenses: 1, income: 0, pending: 1, cardCharges: 0, ownTransfers: 1 },
    ]);
  });

  it("leaves out pending charges, and money coming in when income is switched off", () => {
    const { candidates, skipped } = toCandidates(
      [source([txn({ status: "pending" }), txn({ identifier: 2, chargedAmount: 55 }), txn({ identifier: 3 })])],
      { importIncome: false },
    );
    expect(candidates.map((c) => c.externalId)).toEqual(["max:1234:3"]);
    expect(skipped).toEqual({ pending: 1, credits: 1, cardCharges: [], ownTransfers: [] });
  });

  it("reads money coming in as income", () => {
    const bank = source(
      [txn({ identifier: 11, chargedAmount: 9500.5, description: "משכורת" }), txn({ identifier: 12 })],
      { company: "discount", kind: "bank" },
    );
    const { candidates, skipped } = toCandidates([bank]);
    expect(candidates.map((c) => [c.type, c.amount, c.description])).toEqual([
      ["income", 9500.5, "משכורת"],
      ["expense", 230, "שופרסל דיל"],
    ]);
    expect(skipped.credits).toBe(0);
  });

  it("counts a chosen payer's salary at the end of a month for the next month, and nobody else's", () => {
    const bank = source(
      [
        // 2026-10-30T22:00Z is midnight on the 31st in Israel (winter time).
        txn({ identifier: 21, date: "2026-10-30T22:00:00.000Z", chargedAmount: 9500, description: "משרד הביטחון משכורת" }),
        txn({ identifier: 22, date: "2026-10-30T22:00:00.000Z", chargedAmount: 400, description: "העברה מדני" }),
        txn({ identifier: 23, date: "2026-10-30T22:00:00.000Z", chargedAmount: -80, description: "משרד הביטחון" }),
        txn({ identifier: 24, date: "2026-10-19T21:00:00.000Z", chargedAmount: 9500, description: "משרד הביטחון משכורת" }),
      ],
      { company: "discount", kind: "bank" },
    );
    const { candidates } = toCandidates([bank], { nextMonthPayers: ["משרד הביטחון"] });
    expect(candidates.map((c) => [c.type, c.date, c.bankDate, c.description, c.externalId])).toEqual([
      ["income", "2026-11-01", "2026-10-31", "משרד הביטחון משכורת (נכנס ב־31.10)", "discount:1234:21"],
      // Another income on the very same day stays where it is.
      ["income", "2026-10-31", undefined, "העברה מדני", "discount:1234:22"],
      // So does a payment to the same name, and the same salary in the middle of a month.
      ["expense", "2026-10-31", undefined, "משרד הביטחון", "discount:1234:23"],
      ["income", "2026-10-20", undefined, "משרד הביטחון משכורת", "discount:1234:24"],
    ]);
  });

  it("moves no income when the household chose no payer", () => {
    const bank = source(
      [txn({ identifier: 21, date: "2026-10-30T22:00:00.000Z", chargedAmount: 9500, description: "משכורת" })],
      { company: "discount", kind: "bank" },
    );
    expect(toCandidates([bank]).candidates[0]).toMatchObject({ date: "2026-10-31", description: "משכורת" });
  });

  it("leaves a refund on a card on the day it happened", () => {
    const card = source([txn({ identifier: 31, date: "2026-10-30T22:00:00.000Z", chargedAmount: 50 })]);
    expect(toCandidates([card], { nextMonthPayers: ["שופרסל"] }).candidates[0].date).toBe("2026-10-31");
  });

  it("leaves out both sides of a transfer between the household's own accounts", () => {
    const bank = {
      company: "discount",
      kind: "bank",
      accounts: [
        { accountNumber: "111", txns: [txn({ identifier: 1, chargedAmount: -2000, description: "העברה" }), txn({ identifier: 2 })] },
        { accountNumber: "222", txns: [txn({ identifier: 3, chargedAmount: 2000, description: "העברה" }), txn({ identifier: 4, chargedAmount: 2000, description: "משכורת" })] },
      ],
    };
    const { candidates, skipped } = toCandidates([bank]);
    expect(candidates.map((c) => [c.type, c.description])).toEqual([
      ["expense", "שופרסל דיל"],
      ["income", "משכורת"],
    ]);
    expect(skipped.ownTransfers).toEqual(["2026-10-05 2000.00 111 -> 222"]);
  });

  it("does not take money out and in within one account for a transfer", () => {
    const bank = source(
      [txn({ identifier: 1, chargedAmount: -500 }), txn({ identifier: 2, chargedAmount: 500 })],
      { company: "discount", kind: "bank" },
    );
    const { candidates, skipped } = toCandidates([bank]);
    expect(candidates).toHaveLength(2);
    expect(skipped.ownTransfers).toEqual([]);
  });

  it("leaves out the card's monthly charge in the bank account, but not on the card itself", () => {
    const bank = source(
      [txn({ identifier: 7, description: "מקס איט פיננסים", chargedAmount: -4120.5 }), txn({ identifier: 8, description: "ועד בית" })],
      { company: "discount", kind: "bank" },
    );
    const card = source([txn({ identifier: 9, description: "MAX STOCK" })]);
    const { candidates, skipped } = toCandidates([bank, card]);
    expect(candidates.map((c) => c.description)).toEqual(["ועד בית", "MAX STOCK"]);
    expect(skipped.cardCharges).toEqual(["2026-10-05 4120.50 מקס איט פיננסים"]);
  });

  it("still leaves the card's charge out on a run where the card itself could not be read", () => {
    const bank = source([txn({ description: "מקס איט פיננסים" })], { company: "discount", kind: "bank" });
    const { candidates, skipped } = toCandidates([bank], { cards: ["max"] });
    expect(candidates).toHaveLength(0);
    expect(skipped.cardCharges).toHaveLength(1);
  });

  it("imports the charge of a card that is not read, as one line", () => {
    const bank = source(
      [txn({ identifier: 5, description: "כ.א.ל חיוב", chargedAmount: -900 }), txn({ identifier: 6, description: "ישראכרט" })],
      { company: "discount", kind: "bank" },
    );
    const { candidates, skipped } = toCandidates([bank], { cards: ["max"] });
    expect(candidates.map((c) => c.description)).toEqual(["כ.א.ל חיוב", "ישראכרט"]);
    expect(skipped.cardCharges).toEqual([]);
  });

  it("leaves out a bank charge that names a card being read by its last digits", () => {
    const bank = source(
      [
        txn({ identifier: 5, description: "חיוב לכרטיס ויזה 0541", chargedAmount: -15.85 }),
        txn({ identifier: 6, description: "חיוב לכרטיס ויזה 9999", chargedAmount: -40 }),
        txn({ identifier: 7, description: "תשלום 0541 לוועד הבית", chargedAmount: -35 }),
      ],
      { company: "discount", kind: "bank" },
    );
    const card = { company: "max", kind: "card", accounts: [{ accountNumber: "0541", txns: [] }] };
    const { candidates, skipped } = toCandidates([bank, card]);
    // The other card is not read, and digits alone are not enough without a word for "card".
    expect(candidates.map((c) => c.description)).toEqual(["חיוב לכרטיס ויזה 9999", "תשלום 0541 לוועד הבית"]);
    expect(skipped.cardCharges).toEqual(["2026-10-05 15.85 חיוב לכרטיס ויזה 0541"]);
  });

  it("reports a card charge as replaced only when that card answered in this run", () => {
    const bank = source(
      [txn({ identifier: 5, description: "מקס איט פיננסים", chargedAmount: -341.8 }), txn({ identifier: 6, description: "חיוב לכרטיס ויזה 0541", chargedAmount: -15.85 })],
      { company: "discount", kind: "bank" },
    );
    const card = { company: "max", kind: "card", accounts: [{ accountNumber: "0541", txns: [] }] };
    expect(toCandidates([bank, card]).replacedByCard.map((c) => c.externalId)).toEqual(["discount:1234:5", "discount:1234:6"]);
    // Max is set up but did not answer: its charge is still left out, and nothing is replaced.
    const alone = toCandidates([bank], { cards: ["max"] });
    expect(alone.skipped.cardCharges).toHaveLength(1);
    expect(alone.replacedByCard).toEqual([]);
  });

  it("recognises a card's name printed with dots", () => {
    const bank = source([txn({ description: "כ.א.ל חיוב" })], { company: "discount", kind: "bank" });
    const { candidates } = toCandidates([bank], { cards: ["visaCal"] });
    expect(candidates).toHaveLength(0);
  });

  it("gives each installment its own id and says which one it is", () => {
    const { candidates } = toCandidates([
      source([txn({ installments: { number: 2, total: 6 }, chargedAmount: -99.9 })]),
    ]);
    expect(candidates[0].externalId).toBe("max:1234:1001:2");
    expect(candidates[0].description).toBe("שופרסל דיל (תשלום 2 מתוך 6)");
    expect(candidates[0].amount).toBe(99.9);
  });

  it("tells apart two identical purchases that have no id from the bank", () => {
    const { candidates } = toCandidates([
      source([txn({ identifier: undefined }), txn({ identifier: undefined })]),
    ]);
    expect(candidates.map((c) => c.externalId)).toEqual([
      "max:1234:2026-10-05:23000:שופרסל דיל",
      "max:1234:2026-10-05:23000:שופרסל דיל#2",
    ]);
  });
});

describe("planImport", () => {
  const candidate = (over = {}) => ({
    externalId: "max:1234:1001",
    company: "max",
    account: "1234",
    type: "expense",
    amount: 230,
    date: "2026-10-05",
    description: "שופרסל דיל",
    ...over,
  });
  const row = (over = {}) => ({
    id: "row-1",
    external_id: null,
    type: "expense",
    amount: 230,
    occurred_on: "2026-10-05",
    ...over,
  });

  it("adds a transaction the app has not seen", () => {
    const plan = planImport([candidate()], []);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.links).toHaveLength(0);
    expect(plan.known).toHaveLength(0);
  });

  it("does nothing for a transaction imported on an earlier run", () => {
    const plan = planImport([candidate()], [row({ external_id: "max:1234:1001" })]);
    expect(plan).toEqual({ inserts: [], links: [], known: [candidate()], repeated: [], moves: [], removals: [] });
  });

  it("attaches the bank id to the same purchase written by hand a day earlier", () => {
    const plan = planImport([candidate()], [row({ occurred_on: "2026-10-04" })]);
    expect(plan.inserts).toHaveLength(0);
    expect(plan.links).toEqual([{ id: "row-1", candidate: candidate() }]);
  });

  it("does not match a different amount, a far date, or an income", () => {
    const plan = planImport(
      [candidate()],
      [row({ id: "a", amount: 231 }), row({ id: "b", occurred_on: "2026-10-01" }), row({ id: "c", type: "income" })],
    );
    expect(plan.inserts).toHaveLength(1);
    expect(plan.links).toHaveLength(0);
  });

  it("moves an income imported earlier on the bank's date, but not one the user re-dated", () => {
    const salary = candidate({ externalId: "discount:1:21", type: "income", amount: 9500, date: "2026-11-01", bankDate: "2026-10-31" });
    const stored = row({ id: "salary", external_id: "discount:1:21", type: "income", amount: 9500, occurred_on: "2026-10-31" });
    expect(planImport([salary], [stored]).moves).toEqual([{ id: "salary", candidate: salary }]);
    expect(planImport([salary], [{ ...stored, occurred_on: "2026-11-01" }]).moves).toEqual([]);
    expect(planImport([salary], [{ ...stored, occurred_on: "2026-10-15" }]).moves).toEqual([]);
  });

  it("takes out a card charge imported as one expense once the card itself is read", () => {
    const stored = row({ id: "lump", external_id: "discount:1:77", amount: 900, occurred_on: "2026-10-11" });
    const replacedByCard = [{ externalId: "discount:1:77", date: "2026-10-11", line: "2026-10-11 900.00 כאל" }];
    expect(planImport([], [stored], { replacedByCard, cardCoveredFrom: "2026-06-01" }).removals).toEqual([
      { id: "lump", line: "2026-10-11 900.00 כאל" },
    ]);
    // Too close to the start of what was read: the purchases behind it were not all read.
    expect(planImport([], [stored], { replacedByCard, cardCoveredFrom: "2026-11-01" }).removals).toEqual([]);
    // Never imported, so there is nothing to take out.
    expect(planImport([], [], { replacedByCard, cardCoveredFrom: "2026-06-01" }).removals).toEqual([]);
  });

  it("matches income only to income written by hand", () => {
    const income = candidate({ type: "income", amount: 1500 });
    expect(planImport([income], [row({ amount: 1500 })]).links).toHaveLength(0);
    expect(planImport([income], [row({ amount: 1500, type: "income" })]).links).toHaveLength(1);
  });

  it("uses a hand-written row for one purchase only", () => {
    const plan = planImport([candidate(), candidate({ externalId: "max:1234:1002" })], [row()]);
    expect(plan.links).toHaveLength(1);
    expect(plan.inserts.map((c) => c.externalId)).toEqual(["max:1234:1002"]);
  });

  it("picks the hand-written row closest in date", () => {
    const plan = planImport(
      [candidate()],
      [row({ id: "far", occurred_on: "2026-10-03" }), row({ id: "near", occurred_on: "2026-10-05" })],
    );
    expect(plan.links[0].id).toBe("near");
  });

  it("imports a transaction once when its id comes twice in one read, and reports the second", () => {
    const second = candidate({ amount: 75, description: "קפה" });
    const plan = planImport([candidate(), second], []);
    expect(plan.inserts).toEqual([candidate()]);
    expect(plan.known).toHaveLength(0);
    expect(plan.repeated).toEqual([second]);
  });
});
