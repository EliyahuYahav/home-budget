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
        amount: 230,
        date: "2026-10-05",
        description: "שופרסל דיל",
      },
    ]);
  });

  it("leaves out pending charges and money coming in", () => {
    const { candidates, skipped } = toCandidates([
      source([txn({ status: "pending" }), txn({ identifier: 2, chargedAmount: 55 }), txn({ identifier: 3 })]),
    ]);
    expect(candidates.map((c) => c.externalId)).toEqual(["max:1234:3"]);
    expect(skipped).toEqual({ pending: 1, credits: 1, cardCharges: 0 });
  });

  it("leaves out the card's monthly charge in the bank account, but not on the card itself", () => {
    const bank = source(
      [txn({ identifier: 7, description: "מקס איט פיננסים", chargedAmount: -4120.5 }), txn({ identifier: 8, description: "ועד בית" })],
      { company: "discount", kind: "bank" },
    );
    const card = source([txn({ identifier: 9, description: "MAX STOCK" })]);
    const { candidates, skipped } = toCandidates([bank, card]);
    expect(candidates.map((c) => c.description)).toEqual(["ועד בית", "MAX STOCK"]);
    expect(skipped.cardCharges).toBe(1);
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
