import { describe, expect, it } from "vitest";
import { MAX_LOGINS, isSealed, mergeLogins, openLogins, parseSaved, stringifySaved } from "./logins.mjs";
import { generateKeyPair, open, seal } from "./seal.mjs";

const COMPANIES = ["discount", "max", "visaCal"];
const NOW = "2026-10-13T10:00:00.000Z";
// Shaped like seal()'s output; the server only checks the shape.
const sealed = (tag) => JSON.stringify({ v: 1, key: `k-${tag}`, iv: "iv", data: `d-${tag}` });
const login = (id, company, over = {}) => ({ id, company, label: "", sealed: sealed(id), savedAt: "2026-10-01T00:00:00.000Z", ...over });

describe("isSealed", () => {
  it("accepts sealed text and nothing else", () => {
    expect(isSealed(sealed("a"))).toBe(true);
    expect(isSealed('{"username":"me","password":"secret"}')).toBe(false);
    expect(isSealed("plain")).toBe(false);
    expect(isSealed(undefined)).toBe(false);
  });
});

describe("parseSaved", () => {
  it("reads the list, and tells the old single-text format apart", () => {
    const text = stringifySaved([login("login-1", "max")]);
    expect(parseSaved(text)).toEqual({ logins: [login("login-1", "max")], legacy: false });
    expect(parseSaved(sealed("old"))).toEqual({ logins: [], legacy: true });
    expect(parseSaved(null)).toEqual({ logins: [], legacy: false });
  });

  it("empties the column when the last login is removed", () => {
    expect(stringifySaved([])).toBeNull();
  });
});

describe("mergeLogins", () => {
  const current = [login("login-1", "discount"), login("login-2", "max", { label: "שלי" })];

  it("adds a login and leaves the saved ones untouched", () => {
    const merged = mergeLogins(current, [{ id: "login-3", company: "max", label: " של רחל ", sealed: sealed("new") }], COMPANIES, NOW);
    expect(merged.slice(0, 2)).toEqual(current);
    expect(merged[2]).toEqual({ id: "login-3", company: "max", label: "של רחל", sealed: sealed("new"), savedAt: NOW });
  });

  it("replaces the details of one login only", () => {
    const merged = mergeLogins(current, [{ id: "login-2", company: "max", label: "שלי", sealed: sealed("changed") }], COMPANIES, NOW);
    expect(merged[0]).toEqual(current[0]);
    expect(merged[1]).toMatchObject({ sealed: sealed("changed"), savedAt: NOW });
  });

  it("renames a saved login without touching its details", () => {
    const merged = mergeLogins(current, [{ id: "login-2", company: "max", label: "המשותף" }], COMPANIES, NOW);
    expect(merged[1]).toEqual({ ...current[1], label: "המשותף" });
  });

  it("does not change what was passed in", () => {
    const before = JSON.stringify(current);
    mergeLogins(current, [{ id: "login-2", company: "max", label: "x" }], COMPANIES, NOW);
    expect(JSON.stringify(current)).toBe(before);
  });

  it("refuses details that are not sealed, unknown companies and odd ids", () => {
    expect(() => mergeLogins([], [{ id: "login-9", company: "max", sealed: '{"password":"x"}' }], COMPANIES, NOW)).toThrow(/sealed/);
    expect(() => mergeLogins([], [{ id: "login-9", company: "bank-of-nowhere", sealed: sealed("a") }], COMPANIES, NOW)).toThrow(/company/);
    expect(() => mergeLogins([], [{ id: "../x", company: "max", sealed: sealed("a") }], COMPANIES, NOW)).toThrow(/id/);
    expect(() => mergeLogins([], [{ id: "login-9", company: "max" }], COMPANIES, NOW)).toThrow(/details/);
    expect(() => mergeLogins(current, [{ id: "login-1", company: "max", sealed: sealed("a") }], COMPANIES, NOW)).toThrow(/another company/);
  });

  it("stops at a sensible number of logins", () => {
    const many = Array.from({ length: MAX_LOGINS }, (_, i) => login(`login-${i + 10}`, "max"));
    expect(() => mergeLogins(many, [{ id: "one-more", company: "max", sealed: sealed("a") }], COMPANIES, NOW)).toThrow(/too many/);
  });
});

describe("openLogins", () => {
  it("opens each login with the home computer's key", async () => {
    const { publicKey, privateKey } = await generateKeyPair();
    const saved = mergeLogins(
      [],
      [
        { id: "login-1", company: "max", label: "שלי", sealed: await seal(publicKey, JSON.stringify({ username: "me", password: "first secret!" })) },
        { id: "login-2", company: "max", label: "של רחל", sealed: await seal(publicKey, JSON.stringify({ username: "her", password: "second secret!" })) },
      ],
      COMPANIES,
      NOW,
    );
    const text = stringifySaved(saved);
    // A phrase with a space and "!", which sealed text (base64) can never contain by chance.
    expect(text).not.toContain("first secret!");
    const opened = await openLogins(text, (sealedText) => open(privateKey, sealedText));
    expect(opened).toEqual([
      { id: "login-1", company: "max", label: "שלי", values: { username: "me", password: "first secret!" } },
      { id: "login-2", company: "max", label: "של רחל", values: { username: "her", password: "second secret!" } },
    ]);
  });

  it("still reads details saved in the old single-text format", async () => {
    const { publicKey, privateKey } = await generateKeyPair();
    const old = await seal(
      publicKey,
      JSON.stringify({ discount: { id: "1", password: "p", num: "n" }, max2: { username: "u", password: "q" } }),
    );
    const opened = await openLogins(old, (sealedText) => open(privateKey, sealedText));
    expect(opened.map((l) => [l.id, l.company])).toEqual([
      ["discount", "discount"],
      ["max2", "max"],
    ]);
  });
});
