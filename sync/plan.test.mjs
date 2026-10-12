import { describe, expect, it } from "vitest";
import { israelDate, planImport, toCandidates } from "./plan.mjs";

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

describe("toCandidates", () => {
  it("turns a completed charge into a positive expense with a stable id", () => {
    const { candidates } = toCandidates([source([txn()])]);
    expect(candidates).toEqual([
      {
        externalId: "max:1234:1001",
        company: "max",
        type: "expense",
        amount: 230,
        date: "2026-10-05",
        description: "שופרסל דיל",
      },
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
    expect(plan.known).toBe(0);
  });

  it("does nothing for a transaction imported on an earlier run", () => {
    const plan = planImport([candidate()], [row({ external_id: "max:1234:1001" })]);
    expect(plan).toEqual({ inserts: [], links: [], known: 1 });
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

  it("imports a transaction once even when the scraper lists it twice", () => {
    const plan = planImport([candidate(), candidate()], []);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.known).toBe(1);
  });
});
