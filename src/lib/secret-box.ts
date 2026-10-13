// Encrypts small secrets (a household's own Claude API key) before they are stored, with a
// key that exists only in the server's environment. Whoever reads the database sees only the
// sealed text. Server-only: never import this from a client component.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** The server's key, from SECRETS_KEY. Any long random string works; it is hashed to 32 bytes. */
function serverKey(): Buffer | null {
  const secret = process.env.SECRETS_KEY;
  if (!secret || secret.length < 32) return null;
  return createHash("sha256").update(secret).digest();
}

export function isSecretBoxConfigured(): boolean {
  return serverKey() !== null;
}

/** Returns "v1.<iv>.<tag>.<data>" in base64url. Throws when SECRETS_KEY is not set. */
export function sealSecret(text: string): string {
  const key = serverKey();
  if (!key) throw new Error("SECRETS_KEY is not set");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), data]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

/** null when the text was not sealed with this server's key, or was changed since. */
export function openSecret(sealed: string): string | null {
  const key = serverKey();
  const [version, iv, tag, data] = sealed.split(".");
  if (!key || version !== "v1" || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
