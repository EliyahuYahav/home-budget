// The decisions of the bank sync, kept free of network and browser code so they can be tested:
// which scraped transactions become rows, and which rows they are.

/**
 * @typedef {{ company: string, kind: "bank" | "card", accounts: { accountNumber: string, txns: any[] }[] }} ScrapedSource
 * @typedef {{ externalId: string, company: string, amount: number, date: string, description: string }} Candidate
 * @typedef {{ id: string, external_id: string | null, type: string, amount: number, occurred_on: string }} ExistingRow
 */

// The card's monthly charge in the bank account is the sum of purchases that the card
// itself already reports one by one, so importing it would count them twice.
const CARD_CHARGE = /מקס|max\b|לאומי קארד|כאל|\bcal\b|ישראכרט|isracard|ויזה|visa|אמריקן אקספרס|amex|דיינרס|diners|מסטרקארד|mastercard/i;

const israelDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" });

/** The scrapers report midnight in Israel as a UTC instant; this is the calendar day it means. */
export function israelDate(iso) {
  return israelDay.format(new Date(iso));
}

const cents = (amount) => Math.round(amount * 100);

function dayDistance(a, b) {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
}

/**
 * Turns what the scrapers returned into expenses that could be imported.
 * Left out, and counted in `skipped`: charges still pending (they have no stable id and
 * their amount can change), money coming in (salaries are set up as fixed incomes), and
 * the card's monthly charge in the bank account.
 *
 * @param {ScrapedSource[]} sources
 * @returns {{ candidates: Candidate[], skipped: { pending: number, credits: number, cardCharges: number } }}
 */
export function toCandidates(sources) {
  const candidates = [];
  const skipped = { pending: 0, credits: 0, cardCharges: 0 };
  const seen = new Map();

  for (const { company, kind, accounts } of sources) {
    for (const { accountNumber, txns } of accounts) {
      for (const txn of txns) {
        if (txn.status !== "completed") {
          skipped.pending += 1;
          continue;
        }
        if (!(txn.chargedAmount < 0)) {
          skipped.credits += 1;
          continue;
        }
        const name = String(txn.description ?? "").trim();
        if (kind === "bank" && CARD_CHARGE.test(name)) {
          skipped.cardCharges += 1;
          continue;
        }

        const amount = cents(-txn.chargedAmount) / 100;
        const date = israelDate(txn.date);
        const part = txn.installments ? `:${txn.installments.number}` : "";
        let key;
        if (txn.identifier != null && txn.identifier !== "") {
          key = `${company}:${accountNumber}:${txn.identifier}${part}`;
        } else {
          // No id from the bank: the details stand in for one. Two identical purchases on the
          // same day get a running number so the second is not taken for a repeat of the first.
          const base = `${company}:${accountNumber}:${date}:${cents(amount)}:${name}${part}`;
          const count = (seen.get(base) ?? 0) + 1;
          seen.set(base, count);
          key = count === 1 ? base : `${base}#${count}`;
        }

        const installments = txn.installments
          ? ` (תשלום ${txn.installments.number} מתוך ${txn.installments.total})`
          : "";
        candidates.push({
          externalId: key,
          company,
          amount,
          date,
          description: `${name}${installments}`.slice(0, 200),
        });
      }
    }
  }
  return { candidates, skipped };
}

/** How far apart the bank's date and a hand-written entry's date may be and still be one purchase. */
export const MATCH_DAYS = 2;

/**
 * Splits candidates into rows to add, rows already in the app, and hand-written rows
 * (from the bot or the expenses screen) that are the same purchase and only need the
 * bank's id attached so the next run recognises them.
 *
 * @param {Candidate[]} candidates
 * @param {ExistingRow[]} existing
 * @returns {{ inserts: Candidate[], links: { id: string, candidate: Candidate }[], known: number }}
 */
export function planImport(candidates, existing) {
  const knownIds = new Set(existing.map((row) => row.external_id).filter(Boolean));
  const free = existing.filter((row) => !row.external_id && row.type === "expense");
  const taken = new Set();
  const inserts = [];
  const links = [];
  let known = 0;

  for (const candidate of candidates) {
    if (knownIds.has(candidate.externalId)) {
      known += 1;
      continue;
    }
    knownIds.add(candidate.externalId);

    let best = null;
    for (const row of free) {
      if (taken.has(row.id) || cents(row.amount) !== cents(candidate.amount)) continue;
      const distance = dayDistance(row.occurred_on, candidate.date);
      if (distance <= MATCH_DAYS && (best === null || distance < best.distance)) {
        best = { row, distance };
      }
    }
    if (best) {
      taken.add(best.row.id);
      links.push({ id: best.row.id, candidate });
    } else {
      inserts.push(candidate);
    }
  }
  return { inserts, links, known };
}
