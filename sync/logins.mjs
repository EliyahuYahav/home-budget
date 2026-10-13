// How the bank and card logins are kept in the database (bank_sync_settings.credentials).
//
// Each login is sealed on its own, so saving one leaves the others as they are, and a
// household can have several logins at the same company (two Max accounts, two banks):
//
//   { "v": 2, "logins": [{ "id", "company", "label", "sealed", "savedAt" }] }
//
// `company` and `label` are readable, so the website can list what is saved; the login details
// themselves are inside `sealed`, which only the home computer opens (seal.mjs).
//
// Used by the website's server (to merge changes) and by the agent (to read them).

export const MAX_LOGINS = 20;
const MAX_LABEL = 40;

/** True for text produced by seal(): the website's server checks this without being able to open it. */
export function isSealed(text) {
  if (typeof text !== "string" || text.length > 20_000) return false;
  try {
    const { v, key, iv, data } = JSON.parse(text);
    return v === 1 && [key, iv, data].every((part) => typeof part === "string" && part !== "");
  } catch {
    return false;
  }
}

/**
 * @param {string | null | undefined} text
 * @returns {{ logins: { id: string, company: string, label: string, sealed: string, savedAt: string }[], legacy: boolean }}
 *   `legacy` is true for details saved before logins were kept one by one: a single sealed
 *   text holding every company, which only the agent can take apart.
 */
export function parseSaved(text) {
  if (!text) return { logins: [], legacy: false };
  try {
    const parsed = JSON.parse(text);
    if (parsed.v === 2 && Array.isArray(parsed.logins)) return { logins: parsed.logins, legacy: false };
  } catch {
    // Not JSON at all: treated like the old format, which the agent reports if it cannot open it.
  }
  return { logins: [], legacy: true };
}

/** Returns null when nothing is left, so the column goes back to empty. */
export function stringifySaved(logins) {
  return logins.length === 0 ? null : JSON.stringify({ v: 2, logins });
}

/**
 * Applies changes from the website's form to what is saved.
 * A change with `sealed` adds the login or replaces its details; without it, only the label
 * of a login that is already saved changes. Throws on anything malformed.
 *
 * @param {{ id: string, company: string, label: string, sealed: string, savedAt: string }[]} current
 * @param {{ id: string, company: string, label?: string, sealed?: string }[]} changes
 * @param {string[]} companies The companies the sync knows.
 * @param {string} now ISO time, recorded on logins whose details were saved.
 */
export function mergeLogins(current, changes, companies, now) {
  const logins = current.map((login) => ({ ...login }));
  for (const change of changes) {
    if (typeof change.id !== "string" || !/^[A-Za-z0-9_-]{6,64}$/.test(change.id)) throw new Error("bad login id");
    if (!companies.includes(change.company)) throw new Error("unknown company");
    const label = String(change.label ?? "").trim().slice(0, MAX_LABEL);
    const existing = logins.find((login) => login.id === change.id);

    if (change.sealed === undefined) {
      if (!existing) throw new Error("a new login needs its details");
      existing.label = label;
      continue;
    }
    if (!isSealed(change.sealed)) throw new Error("the login details did not arrive sealed");
    if (existing) {
      if (existing.company !== change.company) throw new Error("a login cannot move to another company");
      Object.assign(existing, { label, sealed: change.sealed, savedAt: now });
    } else {
      logins.push({ id: change.id, company: change.company, label, sealed: change.sealed, savedAt: now });
    }
  }
  if (logins.length > MAX_LOGINS) throw new Error("too many logins");
  return logins;
}

/**
 * Opens every saved login. For the agent.
 *
 * @param {string | null} text The column's content.
 * @param {(sealed: string) => Promise<string>} open Opens one sealed text with the home computer's key.
 * @returns {Promise<{ id: string, company: string, label: string, values: Record<string, string> }[]>}
 */
export async function openLogins(text, open) {
  const { logins, legacy } = parseSaved(text);
  if (!legacy) {
    return Promise.all(
      logins.map(async (login) => ({
        id: login.id,
        company: login.company,
        label: login.label ?? "",
        values: JSON.parse(await open(login.sealed)),
      })),
    );
  }
  // The old format: one sealed object, { company: { field: value } }, where a second Max
  // login was stored under "max2".
  const byCompany = JSON.parse(await open(text));
  return Object.entries(byCompany).map(([id, values]) => ({
    id,
    company: id === "max2" ? "max" : id,
    label: "",
    values,
  }));
}
