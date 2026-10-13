// The decisions of the bank sync, kept free of network and browser code so they can be tested:
// which scraped transactions become rows, and which rows they are.

/**
 * @typedef {{ company: string, kind: "bank" | "card", accounts: { accountNumber: string, txns: any[] }[] }} ScrapedSource
 * @typedef {{ externalId: string, company: string, account: string, type: "expense" | "income", amount: number, date: string, description: string }} Candidate
 * @typedef {{ company: string, account: string, lines: number, expenses: number, income: number, pending: number, cardCharges: number, ownTransfers: number }} AccountCount
 * @typedef {{ id: string, external_id: string | null, type: string, amount: number, occurred_on: string }} ExistingRow
 */

// The card's monthly charge in the bank account is the sum of purchases that the card
// itself already reports one by one, so importing it would count them twice. That is only
// true for a card the sync reads: the charge of any other card is the one record of that
// spending, and is imported as a single line. Matched after dropping dots and quotes,
// because banks print names like "כ.א.ל".
const CARD_CHARGE = {
  max: /מקס|max|לאומי קארד/i,
  visaCal: /כאל|cal\b|ויזה כאל/i,
  isracard: /ישראכרט|isracard/i,
  amex: /אמריקן אקספרס|amex|american express/i,
};

const plainName = (name) => name.replace(/[.'"׳״]/g, "");

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
 * A transfer between two of the household's own accounts shows up as money out of one and
 * the same amount into the other. It is neither spending nor income, so both lines are left out.
 * Returns the transactions to leave out and a line describing each pair.
 */
function ownTransfers(sources) {
  const lines = [];
  for (const { kind, accounts } of sources) {
    if (kind !== "bank") continue;
    for (const { accountNumber, txns } of accounts) {
      for (const txn of txns) {
        if (txn.status === "completed" && txn.chargedAmount) lines.push({ txn, accountNumber });
      }
    }
  }
  const out = lines.filter((line) => line.txn.chargedAmount < 0);
  const incoming = lines.filter((line) => line.txn.chargedAmount > 0);
  const paired = new Set();
  const described = [];
  for (const debit of out) {
    const match = incoming.find(
      (credit) =>
        !paired.has(credit.txn) &&
        credit.accountNumber !== debit.accountNumber &&
        cents(credit.txn.chargedAmount) === cents(-debit.txn.chargedAmount) &&
        dayDistance(credit.txn.date, debit.txn.date) <= 1,
    );
    if (!match) continue;
    paired.add(debit.txn).add(match.txn);
    described.push(
      `${israelDate(debit.txn.date)} ${(-debit.txn.chargedAmount).toFixed(2)} ${debit.accountNumber} -> ${match.accountNumber}`,
    );
  }
  return { paired, described };
}

/**
 * Turns what the scrapers returned into rows that could be imported: money out as expenses,
 * money in as income.
 * Left out, and reported in `skipped`: charges still pending (they have no stable id and
 * their amount can change), the monthly charge in the bank account of a card that is read
 * itself, transfers between the household's own accounts, and, when `importIncome` is off,
 * money coming in.
 *
 * @param {ScrapedSource[]} sources
 * @param {{ cards?: string[], importIncome?: boolean }} [options] `cards` are the card
 *   companies set up for reading, whether or not this run reached them.
 * @returns {{ candidates: Candidate[], accounts: AccountCount[], skipped: { pending: number, credits: number, cardCharges: string[], ownTransfers: string[] } }}
 *   `accounts` says, for each account read, how many lines there were and what became of them.
 */
export function toCandidates(sources, options = {}) {
  const cards = options.cards ?? sources.filter((s) => s.kind === "card").map((s) => s.company);
  const importIncome = options.importIncome ?? true;
  const candidates = [];
  const counts = [];
  const transfers = ownTransfers(sources);
  const skipped = { pending: 0, credits: 0, cardCharges: [], ownTransfers: transfers.described };
  const seen = new Map();
  const cardCharge = cards.map((company) => CARD_CHARGE[company]).filter(Boolean);
  // Banks also name a card by its last digits ("חיוב לכרטיס ויזה 0541") without naming the
  // company, so the digits of every card read in this run are recognised too.
  const cardDigits = sources
    .filter((source) => source.kind === "card")
    .flatMap((source) => source.accounts.map((account) => String(account.accountNumber).slice(-4)))
    .filter((digits) => /^\d{4}$/.test(digits));
  const namesCard = (name) =>
    /כרטיס|ויזה|visa|מסטרקארד|mastercard/i.test(name) && cardDigits.some((digits) => name.includes(digits));

  for (const { company, kind, accounts } of sources) {
    for (const { accountNumber, txns } of accounts) {
      const count = { company, account: accountNumber, lines: txns.length, expenses: 0, income: 0, pending: 0, cardCharges: 0, ownTransfers: 0 };
      counts.push(count);
      for (const txn of txns) {
        if (txn.status !== "completed") {
          skipped.pending += 1;
          count.pending += 1;
          continue;
        }
        if (transfers.paired.has(txn)) {
          count.ownTransfers += 1;
          continue;
        }
        if (!txn.chargedAmount) continue;
        const type = txn.chargedAmount < 0 ? "expense" : "income";
        if (type === "income" && !importIncome) {
          skipped.credits += 1;
          continue;
        }
        const name = String(txn.description ?? "").trim();
        if (
          type === "expense" &&
          kind === "bank" &&
          (cardCharge.some((pattern) => pattern.test(plainName(name))) || namesCard(name))
        ) {
          skipped.cardCharges.push(`${israelDate(txn.date)} ${(-txn.chargedAmount).toFixed(2)} ${name}`);
          count.cardCharges += 1;
          continue;
        }
        if (type === "income") count.income += 1;
        else count.expenses += 1;

        const amount = cents(Math.abs(txn.chargedAmount)) / 100;
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
          account: accountNumber,
          type,
          amount,
          date,
          description: `${name}${installments}`.slice(0, 200),
        });
      }
    }
  }
  return { candidates, accounts: counts, skipped };
}

/** How far apart the bank's date and a hand-written entry's date may be and still be one purchase. */
export const MATCH_DAYS = 2;

/**
 * Splits candidates into rows to add, rows already in the app, and hand-written rows
 * (from the bot or the expenses screen) that are the same purchase or income and only
 * need the bank's id attached so the next run recognises them.
 *
 * @param {Candidate[]} candidates
 * @param {ExistingRow[]} existing
 * @returns {{ inserts: Candidate[], links: { id: string, candidate: Candidate }[], known: Candidate[], repeated: Candidate[] }}
 *   `known` are already in the app. `repeated` carry the same id as an earlier line of this
 *   very read: either the bank listed one line twice, or its ids are not unique and a real
 *   transaction is being dropped, which is worth seeing rather than hiding.
 */
export function planImport(candidates, existing) {
  const knownIds = new Set(existing.map((row) => row.external_id).filter(Boolean));
  const seenNow = new Set();
  const free = existing.filter((row) => !row.external_id);
  const taken = new Set();
  const inserts = [];
  const links = [];
  const known = [];
  const repeated = [];

  for (const candidate of candidates) {
    if (seenNow.has(candidate.externalId)) {
      repeated.push(candidate);
      continue;
    }
    seenNow.add(candidate.externalId);
    if (knownIds.has(candidate.externalId)) {
      known.push(candidate);
      continue;
    }

    let best = null;
    for (const row of free) {
      if (taken.has(row.id) || row.type !== candidate.type || cents(row.amount) !== cents(candidate.amount)) continue;
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
  return { inserts, links, known, repeated };
}
