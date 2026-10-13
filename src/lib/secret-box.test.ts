import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isSecretBoxConfigured, openSecret, sealSecret } from "./secret-box";

const KEY = "a-long-random-server-secret-for-tests-0123456789";

describe("secret box", () => {
  beforeEach(() => {
    process.env.SECRETS_KEY = KEY;
  });
  afterEach(() => {
    delete process.env.SECRETS_KEY;
  });

  it("opens what it sealed, and the sealed text does not contain the secret", () => {
    const sealed = sealSecret("sk-ant-api03-example key!");
    // A piece with a space and "!", which sealed text (base64url) can never contain by chance.
    expect(sealed).not.toContain("example key!");
    expect(openSecret(sealed)).toBe("sk-ant-api03-example key!");
  });

  it("seals the same secret differently each time", () => {
    expect(sealSecret("same")).not.toBe(sealSecret("same"));
  });

  it("does not open with another server's key", () => {
    const sealed = sealSecret("secret");
    process.env.SECRETS_KEY = "a-different-server-secret-of-enough-length-9876543210";
    expect(openSecret(sealed)).toBeNull();
  });

  it("does not open text that was changed, or that it never sealed", () => {
    const sealed = sealSecret("secret");
    const parts = sealed.split(".");
    parts[3] = parts[3].startsWith("A") ? `B${parts[3].slice(1)}` : `A${parts[3].slice(1)}`;
    expect(openSecret(parts.join("."))).toBeNull();
    expect(openSecret("not sealed")).toBeNull();
  });

  it("is off without a server key, or with one too short to be a secret", () => {
    delete process.env.SECRETS_KEY;
    expect(isSecretBoxConfigured()).toBe(false);
    expect(() => sealSecret("x")).toThrow();
    process.env.SECRETS_KEY = "short";
    expect(isSecretBoxConfigured()).toBe(false);
  });
});
