import { describe, expect, it } from "vitest";
import { accountOf } from "./bank-sources";

describe("accountOf", () => {
  it("names the bank and the end of the account number", () => {
    expect(accountOf("discount:0123456789:42")).toEqual({ key: "discount:0123456789", label: "דיסקונט 6789" });
    expect(accountOf("max:0541:2026-10-05:23000:שופרסל")).toEqual({ key: "max:0541", label: "מקס 0541" });
  });

  it("tells two accounts at the same bank apart", () => {
    expect(accountOf("discount:1110856:1")?.key).not.toBe(accountOf("discount:2228649:1")?.key);
  });

  it("has nothing to say about a row written by hand", () => {
    expect(accountOf(null)).toBeNull();
    expect(accountOf(undefined)).toBeNull();
    expect(accountOf("")).toBeNull();
  });

  it("falls back to the company's own name when it is not in the list", () => {
    expect(accountOf("somebank:5555:1")?.label).toBe("somebank 5555");
  });
});
