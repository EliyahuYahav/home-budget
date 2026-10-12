// Seals text so that only the home computer can read it. The website seals the bank login
// details in the browser with the home computer's public key; what is stored in the database
// is unreadable without the private key, which never leaves sync/agent-key.json.
//
// Runs in the browser and in Node alike: both provide `crypto.subtle`, `btoa` and `atob`.

const RSA = { name: "RSA-OAEP", hash: "SHA-256" };

const toBase64 = (buffer) => {
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const fromBase64 = (text) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

/** @returns {Promise<{ publicKey: JsonWebKey, privateKey: JsonWebKey }>} */
export async function generateKeyPair() {
  const pair = await crypto.subtle.generateKey(
    { ...RSA, modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ["encrypt", "decrypt"],
  );
  return {
    publicKey: await crypto.subtle.exportKey("jwk", pair.publicKey),
    privateKey: await crypto.subtle.exportKey("jwk", pair.privateKey),
  };
}

/**
 * A short code that identifies a public key. The agent prints it and the website shows it,
 * so the user can see that the key the browser seals with is the home computer's own.
 *
 * @param {JsonWebKey} publicKey
 * @returns {Promise<string>} e.g. "3f2a-9c41-07be-d5a0"
 */
export async function fingerprint(publicKey) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${publicKey.n}.${publicKey.e}`));
  const hex = Array.from(new Uint8Array(digest).slice(0, 8), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return hex.match(/.{4}/g).join("-");
}

/**
 * RSA alone only fits a couple of hundred bytes, so the text is encrypted with a fresh
 * AES key and that key is what the public key encrypts.
 *
 * @param {JsonWebKey} publicKey
 * @param {string} text
 * @returns {Promise<string>}
 */
export async function seal(publicKey, text) {
  const rsa = await crypto.subtle.importKey("jwk", publicKey, RSA, false, ["encrypt"]);
  const aes = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, new TextEncoder().encode(text));
  const key = await crypto.subtle.encrypt(RSA, rsa, await crypto.subtle.exportKey("raw", aes));
  return JSON.stringify({ v: 1, key: toBase64(key), iv: toBase64(iv), data: toBase64(data) });
}

/**
 * @param {JsonWebKey} privateKey
 * @param {string} sealed
 * @returns {Promise<string>}
 */
export async function open(privateKey, sealed) {
  const { v, key, iv, data } = JSON.parse(sealed);
  if (v !== 1) throw new Error("Unknown sealed format.");
  const rsa = await crypto.subtle.importKey("jwk", privateKey, RSA, false, ["decrypt"]);
  const rawKey = await crypto.subtle.decrypt(RSA, rsa, fromBase64(key));
  const aes = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["decrypt"]);
  const text = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(iv) }, aes, fromBase64(data));
  return new TextDecoder().decode(text);
}
