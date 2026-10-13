import { afterEach, describe, expect, it, vi } from "vitest";
import { sameSecret } from "./supabase/admin";
import { linkCodeOf, readUpdate, webhookSecret } from "./telegram";

const code = "0123456789abcdef0123456789abcdef";

describe("readUpdate", () => {
  const update = (message: unknown) => ({ update_id: 1, message });

  it("reads a private text message", () => {
    expect(readUpdate(update({ text: "סופר 230", chat: { id: 77, type: "private" } }))).toEqual({ chatId: 77, text: "סופר 230" });
  });

  it("ignores groups, messages without text and anything malformed", () => {
    expect(readUpdate(update({ text: "סופר 230", chat: { id: -5, type: "group" } }))).toBeNull();
    expect(readUpdate(update({ photo: [], chat: { id: 77, type: "private" } }))).toBeNull();
    expect(readUpdate(update({ text: "x", chat: { id: "77", type: "private" } }))).toBeNull();
    expect(readUpdate({ edited_message: { text: "x", chat: { id: 77, type: "private" } } })).toBeNull();
    expect(readUpdate(null)).toBeNull();
    expect(readUpdate("text")).toBeNull();
  });
});

describe("linkCodeOf", () => {
  it("finds the code a link from the settings screen opens the bot with", () => {
    expect(linkCodeOf(`/start ${code}`)).toBe(code);
    expect(linkCodeOf(`/start@home_budget_bot ${code}`)).toBe(code);
  });

  it("is nothing for a bare start, another command or a malformed code", () => {
    expect(linkCodeOf("/start")).toBeNull();
    expect(linkCodeOf(`/stop ${code}`)).toBeNull();
    expect(linkCodeOf("/start 1234")).toBeNull();
    expect(linkCodeOf(`/start ${code}; drop`)).toBeNull();
    expect(linkCodeOf(`סופר 230 /start ${code}`)).toBeNull();
  });
});

describe("the webhook secret", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is made from SECRETS_KEY without giving it away", () => {
    vi.stubEnv("SECRETS_KEY", "k".repeat(40));
    const secret = webhookSecret()!;
    expect(secret).toMatch(/^[a-f0-9]{64}$/);
    expect(secret).not.toContain("kkkk");
    vi.stubEnv("SECRETS_KEY", "j".repeat(40));
    expect(webhookSecret()).not.toBe(secret);
  });

  it("does not exist without a real key", () => {
    vi.stubEnv("SECRETS_KEY", "short");
    expect(webhookSecret()).toBeNull();
  });

  it("is compared whole, and nothing matches a missing secret", () => {
    expect(sameSecret("abc", "abc")).toBe(true);
    expect(sameSecret("abc", "abd")).toBe(false);
    expect(sameSecret("abc", "abcd")).toBe(false);
    expect(sameSecret(null, "abc")).toBe(false);
    expect(sameSecret("", "")).toBe(false);
    expect(sameSecret("abc", null)).toBe(false);
  });
});
