import { describe, expect, it } from "vitest";
import { SCRAPERS } from "israeli-bank-scrapers-core";
import { BANKS, CARDS } from "../src/lib/bank-sources.ts";
import { SOURCES, sourcesFrom } from "./run-sync.mjs";

const sorted = (list) => [...list].sort();

describe("the list of banks and cards", () => {
  it("is the same in the website's form and in the sync", () => {
    const form = [...BANKS, ...CARDS].map((s) => [s.company, sorted(s.fields.map((f) => f.key))]);
    const sync = SOURCES.map((s) => [s.company, sorted(s.fields)]);
    expect(form).toEqual(sync);
    expect(BANKS.map((s) => s.company)).toEqual(SOURCES.filter((s) => s.kind === "bank").map((s) => s.company));
  });

  it("asks for exactly the login fields the library expects", () => {
    for (const source of SOURCES) {
      expect(sorted(source.fields), source.company).toEqual(sorted(SCRAPERS[source.company].loginFields));
    }
  });

  it("labels every field in the form", () => {
    for (const source of [...BANKS, ...CARDS]) {
      for (const field of source.fields) expect(field.label, `${source.company}.${field.key}`).toBeTruthy();
    }
  });
});

describe("sourcesFrom", () => {
  const max = (id, username, label = "") => ({ id, company: "max", label, values: { username, password: `${username}-pass` } });

  it("reads two logins at the same company as two sources, named apart", () => {
    const sources = sourcesFrom([max("login-1", "a-user"), max("login-2", "b-user")], "test");
    expect(sources.map((s) => [s.id, s.company, s.kind, s.name, s.credentials.username])).toEqual([
      ["login-1", "max", "card", "max", "a-user"],
      ["login-2", "max", "card", "max #2", "b-user"],
    ]);
  });

  it("names a login by the user's label when there is one", () => {
    expect(sourcesFrom([max("login-1", "a-user", "של רחל")], "test")[0].name).toBe("max (של רחל)");
  });

  it("skips a login with nothing filled in, and refuses one filled in partly", () => {
    expect(sourcesFrom([{ id: "x", company: "max", label: "", values: {} }], "test")).toEqual([]);
    expect(() =>
      sourcesFrom([{ id: "x", company: "isracard", label: "", values: { id: "123456789", password: "p" } }], "test"),
    ).toThrow(/card6Digits/);
  });

  it("refuses a company it does not know", () => {
    expect(() => sourcesFrom([{ id: "x", company: "bank-of-nowhere", label: "", values: { a: "b" } }], "test")).toThrow(/not a company/);
  });
});
