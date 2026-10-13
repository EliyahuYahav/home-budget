import { describe, expect, it } from "vitest";
import { learnCategories, payeeKey } from "./payee.mjs";

describe("payeeKey", () => {
  it("is the same for a payee across installments, spacing and letter case", () => {
    expect(payeeKey("שופרסל דיל")).toBe("שופרסל דיל");
    expect(payeeKey("שופרסל  דיל (תשלום 2 מתוך 6)")).toBe("שופרסל דיל");
    expect(payeeKey("GOOGLE *One")).toBe(payeeKey("google *one"));
    expect(payeeKey("משרד הביטחון (נכנס ב־31.10)")).toBe("משרד הביטחון");
  });

  it("tells different payees apart", () => {
    expect(payeeKey("שופרסל דיל")).not.toBe(payeeKey("שופרסל אקספרס"));
  });

  it("is empty for a row with no description", () => {
    expect(payeeKey("")).toBe("");
    expect(payeeKey(null)).toBe("");
    expect(payeeKey("   ")).toBe("");
  });
});

describe("learnCategories", () => {
  it("takes the most recent category of each payee", () => {
    const learned = learnCategories([
      { description: "שופרסל דיל", category_id: "groceries" },
      { description: "פז", category_id: "fuel" },
      { description: "שופרסל דיל (תשלום 1 מתוך 3)", category_id: "old-choice" },
    ]);
    expect(Object.fromEntries(learned)).toEqual({ "שופרסל דיל": "groceries", "פז": "fuel" });
  });

  it("learns nothing from rows without a category or a description", () => {
    const learned = learnCategories([
      { description: "שופרסל דיל", category_id: null },
      { description: "", category_id: "x" },
    ]);
    expect(learned.size).toBe(0);
  });
});
