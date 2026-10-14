import { describe, expect, it } from "vitest";
import { sameSecret } from "./admin";

describe("sameSecret", () => {
  it("is compared whole, and nothing matches a missing secret", () => {
    expect(sameSecret("abc", "abc")).toBe(true);
    expect(sameSecret("abc", "abd")).toBe(false);
    expect(sameSecret("abc", "abcd")).toBe(false);
    expect(sameSecret(null, "abc")).toBe(false);
    expect(sameSecret("", "")).toBe(false);
    expect(sameSecret("abc", null)).toBe(false);
  });
});
