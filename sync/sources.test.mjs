import { describe, expect, it } from "vitest";
import { SCRAPERS } from "israeli-bank-scrapers-core";
import { BANKS, CARDS } from "../src/lib/bank-sources.ts";
import { SOURCES, sourcesFrom } from "./run-sync.mjs";

const sorted = (list) => [...list].sort();

describe("the list of banks and cards", () => {
  it("is the same in the website's form and in the sync", () => {
    const form = [...BANKS, ...CARDS].map((s) => [s.company, sorted(s.fields.map((f) => f.key))]);
    const sync = SOURCES.map((s) => [s.id, sorted(s.fields)]);
    expect(sorted(form.map(String))).toEqual(sorted(sync.map(String)));
    expect(BANKS.map((s) => s.company)).toEqual(SOURCES.filter((s) => s.kind === "bank").map((s) => s.id));
  });

  it("asks for exactly the login fields the library expects", () => {
    for (const source of SOURCES) {
      expect(sorted(source.fields), source.id).toEqual(sorted(SCRAPERS[source.company].loginFields));
    }
  });

  it("labels every field in the form", () => {
    for (const source of [...BANKS, ...CARDS]) {
      for (const field of source.fields) expect(field.label, `${source.company}.${field.key}`).toBeTruthy();
    }
  });

  it("reads two logins at the same company as two sources", () => {
    const sources = sourcesFrom(
      { max: { username: "a-user", password: "a-pass" }, max2: { username: "b-user", password: "b-pass" } },
      "test",
    );
    expect(sources.map((s) => [s.id, s.company, s.credentials.username])).toEqual([
      ["max", "max", "a-user"],
      ["max2", "max", "b-user"],
    ]);
  });

  it("refuses a login that is only partly filled in", () => {
    expect(() => sourcesFrom({ isracard: { id: "123456789", password: "x" } }, "test")).toThrow(/card6Digits/);
  });
});
