import { describe, expect, it } from "vitest";
import { fingerprint, generateKeyPair, open, seal } from "./seal.mjs";

describe("seal", () => {
  it("is opened by the private key, Hebrew and long text included", async () => {
    const { publicKey, privateKey } = await generateKeyPair();
    const text = JSON.stringify({ max: { username: "ישראל", password: "p@ss ".repeat(200) } });
    const sealed = await seal(publicKey, text);
    expect(sealed).not.toContain("ישראל");
    expect(sealed).not.toContain("p@ss");
    expect(await open(privateKey, sealed)).toBe(text);
  });

  it("gives a different result each time for the same text", async () => {
    const { publicKey } = await generateKeyPair();
    expect(await seal(publicKey, "same")).not.toBe(await seal(publicKey, "same"));
  });

  it("is not opened by another computer's key", async () => {
    const mine = await generateKeyPair();
    const other = await generateKeyPair();
    const sealed = await seal(mine.publicKey, "secret");
    await expect(open(other.privateKey, sealed)).rejects.toThrow();
  });

  it("gives each key its own short code, the same every time", async () => {
    const mine = await generateKeyPair();
    const other = await generateKeyPair();
    const code = await fingerprint(mine.publicKey);
    expect(code).toMatch(/^[0-9a-f]{4}(-[0-9a-f]{4}){3}$/);
    expect(await fingerprint(mine.publicKey)).toBe(code);
    expect(await fingerprint(other.publicKey)).not.toBe(code);
  });

  it("refuses text that was changed after sealing", async () => {
    const { publicKey, privateKey } = await generateKeyPair();
    const sealed = JSON.parse(await seal(publicKey, "secret"));
    sealed.data = sealed.data.slice(0, -4) + (sealed.data.endsWith("AAAA") ? "BBBB" : "AAAA");
    await expect(open(privateKey, JSON.stringify(sealed))).rejects.toThrow();
  });
});
