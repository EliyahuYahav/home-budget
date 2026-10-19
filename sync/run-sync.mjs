// One sync run: read the bank and the card, work out what is new, and write it to the app.
// Used by the command line (bank-sync.mjs) and by the agent that the website talks to (agent.mjs).

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { createScraper } from "israeli-bank-scrapers-core";
import { categorize } from "./categorize.mjs";
import { isCashWithdrawal, learnCategories, payeeKey } from "./payee.mjs";
import { MATCH_DAYS, israelDate, planImport, toCandidates } from "./plan.mjs";

const DEFAULT_DAYS_BACK = 30;

export const here = dirname(fileURLToPath(import.meta.url));

/** A problem the user fixes in the settings, as opposed to a run that went wrong. */
export class SetupError extends Error {}

// The companies the sync can sign in to, with the login fields each asks for. A household can
// have several logins at one company (each partner's own Max account, two banks); those are
// separate entries in what is saved, not here. The website's form (src/lib/bank-sources.ts)
// lists the same companies and fields.
// Only Discount and Max have been run against a real account; the rest are listed with the
// login fields the library documents. One Zero is left out: it signs in with a one-time code.
const bank = (company, fields) => ({ company, kind: "bank", fields });
const card = (company, fields) => ({ company, kind: "card", fields });
export const SOURCES = [
  bank("discount", ["id", "password", "num"]),
  bank("hapoalim", ["userCode", "password"]),
  bank("leumi", ["username", "password"]),
  bank("mizrahi", ["username", "password"]),
  bank("beinleumi", ["username", "password"]),
  bank("mercantile", ["id", "password", "num"]),
  bank("otsarHahayal", ["username", "password"]),
  bank("massad", ["username", "password"]),
  bank("yahav", ["username", "nationalID", "password"]),
  bank("pagi", ["username", "password"]),
  card("max", ["username", "password"]),
  card("visaCal", ["username", "password"]),
  card("isracard", ["id", "card6Digits", "password"]),
  card("amex", ["id", "card6Digits", "password"]),
  card("beyahadBishvilha", ["id", "password"]),
  card("behatsdaa", ["id", "password"]),
];

const CHROME_PATHS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
];

/** Reads the app's .env.local and sync/.env into process.env. */
export function loadEnvFiles() {
  for (const file of [join(here, "..", ".env.local"), join(here, ".env")]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

function need(name) {
  const value = process.env[name];
  if (!value) throw new SetupError(`${name} is not set. See sync/.env.example.`);
  return value;
}

export function findChrome() {
  const chrome = process.env.CHROME_PATH || CHROME_PATHS.find((path) => existsSync(path));
  if (!chrome) throw new SetupError("Chrome was not found. Set CHROME_PATH in sync/.env.");
  return chrome;
}

export function defaultSince() {
  return israelDate(new Date(Date.now() - DEFAULT_DAYS_BACK * 86_400_000).toISOString());
}

/** The date `months` calendar months before today; one month is the usual 30 days. */
export function sinceMonthsBack(months) {
  if (!(months > 1)) return defaultSince();
  const date = new Date();
  date.setMonth(date.getMonth() - Math.min(months, 12));
  return israelDate(date.toISOString());
}

const TIMEOUT_ATTEMPTS = 3;
const PAGE = 1000;
const WRITE_BATCH = 200;

/**
 * Checks opened logins ({ id, company, label, values }) and returns the sources to read.
 * A login with every field empty is simply not used. Each source gets a `name` for the
 * output: the company, with the user's label or a running number when there are several.
 */
export function sourcesFrom(logins, where) {
  const sources = [];
  const perCompany = new Map();
  for (const login of logins) {
    const known = SOURCES.find((source) => source.company === login.company);
    if (!known) throw new SetupError(`${login.company} in ${where} is not a company the sync knows.`);
    const given = login.values ?? {};
    const filled = known.fields.filter((field) => given[field]);
    if (filled.length === 0) continue;

    const count = (perCompany.get(known.company) ?? 0) + 1;
    perCompany.set(known.company, count);
    const name = login.label ? `${known.company} (${login.label})` : count > 1 ? `${known.company} #${count}` : known.company;
    if (filled.length < known.fields.length) {
      const missing = known.fields.filter((field) => !given[field]).join(", ");
      throw new SetupError(`${name} is only partly filled in ${where}: ${missing} is missing.`);
    }
    sources.push({
      ...known,
      id: login.id,
      name,
      credentials: Object.fromEntries(known.fields.map((field) => [field, String(given[field])])),
    });
  }
  return sources;
}

/** Signs in to the app as the household member named in sync/.env. */
export async function signIn({ keepSession = false } = {}) {
  const supabase = createClient(need("NEXT_PUBLIC_SUPABASE_URL"), need("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: keepSession },
  });
  const { data: auth, error: authError } = await supabase.auth.signInWithPassword({
    email: need("APP_EMAIL"),
    password: need("APP_PASSWORD"),
  });
  if (authError) throw new SetupError(`Could not sign in to the app with APP_EMAIL: ${authError.message}`);

  const { data: member, error: memberError } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (memberError) throw new Error(memberError.message);
  if (!member) throw new SetupError("This app user does not belong to a household yet.");
  return { supabase, householdId: member.household_id };
}

/** Replaces every occurrence of the given values with stars. */
export function redact(line, secrets) {
  let clean = String(line);
  for (const secret of secrets) clean = clean.split(secret).join("***");
  return clean;
}

async function scrape(source, since, chrome, showBrowser) {
  const scraper = createScraper({
    companyId: source.company,
    startDate: new Date(`${since}T00:00:00+02:00`),
    combineInstallments: false,
    showBrowser,
    executablePath: chrome,
  });
  const result = await scraper.scrape(source.credentials);
  if (!result.success) {
    throw new Error(`${result.errorType ?? "error"}${result.errorMessage ? `: ${result.errorMessage}` : ""}`);
  }
  return { company: source.company, kind: source.kind, accounts: result.accounts ?? [] };
}

/**
 * @param {{ supabase: any, householdId: string, sources: any[], chrome: string, since: string,
 *           dryRun: boolean, showBrowser?: boolean, log: (line: string) => void }} run
 * Throws when a bank could not be read or a write failed; everything it did is in the log.
 */
export async function runSync({ supabase, householdId, sources, chrome, since, dryRun, showBrowser = false, log: write }) {
  if (sources.length === 0) throw new SetupError("No bank or card is filled in.");
  // The output is stored in the database and shown on the website, so a login detail must
  // never reach it, even if a bank echoes one back in an error message.
  const secrets = sources.flatMap((source) => Object.values(source.credentials)).filter((value) => value.length >= 4);
  const log = (line) => write(redact(line, secrets));
  log(`Reading transactions since ${since}${dryRun ? " (dry run, nothing is written)" : ""}.`);

  const scraped = [];
  const failures = [];
  for (const source of sources) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const result = await scrape(source, since, chrome, showBrowser);
        const count = result.accounts.reduce((sum, account) => sum + account.txns.length, 0);
        log(`- ${source.name}: ${count} transactions in ${result.accounts.length} account(s)`);
        scraped.push(result);
        break;
      } catch (error) {
        // The library gives a site a fixed 20 seconds to answer after signing in, which a slow
        // connection can miss. Only a timeout is tried again: a refused password never is,
        // because repeated wrong passwords can lock the account.
        if (/^TIMEOUT/.test(error.message) && attempt < TIMEOUT_ATTEMPTS) {
          log(`- ${source.name}: the site was slow to answer, trying again (${attempt + 1} of ${TIMEOUT_ATTEMPTS})`);
          continue;
        }
        log(`- ${source.name}: failed (${error.message})`);
        failures.push(source.name);
        break;
      }
    }
  }

  // The payers whose end-of-month income the household counts for the next month (set in the
  // app's settings). A database without the table yet simply has none.
  const { data: payerRows } = await supabase.from("next_month_incomes").select("payer").eq("household_id", householdId);
  const nextMonthPayers = (payerRows ?? []).map((row) => row.payer);
  if (nextMonthPayers.length > 0) {
    log(`Income from these payers, paid in the last days of a month, counts for the next month: ${nextMonthPayers.join("; ")}.`);
  }

  const { candidates, accounts, skipped, replacedByCard } = toCandidates(scraped, {
    cards: sources.filter((source) => source.kind === "card").map((source) => source.company),
    importIncome: process.env.IMPORT_INCOME !== "off",
    nextMonthPayers,
  });

  // Hand-written rows can sit a couple of days before the bank's date.
  const from = israelDate(new Date(Date.parse(since) - (MATCH_DAYS + 1) * 86_400_000).toISOString());
  // The API returns at most a thousand rows at a time, and half a year can hold more.
  const existing = [];
  for (let page = 0; ; page += 1) {
    const { data, error: existingError } = await supabase
      .from("transactions")
      .select("id, external_id, type, amount, occurred_on")
      .eq("household_id", householdId)
      .gte("occurred_on", from)
      .order("id")
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (existingError) {
      if (/external_id/.test(existingError.message)) {
        throw new SetupError(
          "The database is missing the bank columns. Run supabase/schema.sql again in the Supabase SQL Editor.",
        );
      }
      throw new Error(existingError.message);
    }
    existing.push(...data);
    if (data.length < PAGE) break;
  }

  // A card's charge pays for roughly the month before it, so only charges dated a month and a
  // half into the period read are sure to have all their purchases read too.
  const cardCoveredFrom = israelDate(new Date(Date.parse(since) + 45 * 86_400_000).toISOString());
  const plan = planImport(
    candidates,
    existing.map((row) => ({ ...row, amount: Number(row.amount) })),
    { replacedByCard, cardCoveredFrom },
  );

  const { data: categories, error: categoriesError } = await supabase
    .from("categories")
    .select("id, name")
    .eq("household_id", householdId)
    .eq("archived", false)
    .in("kind", ["expense", "fund"])
    .order("sort_order");
  if (categoriesError) throw new Error(categoriesError.message);
  // Per account, what was read and what became of it: the first place to look when an
  // account seems to be missing.
  const tally = (list, account) => list.filter((c) => c.company === account.company && c.account === account.account).length;
  for (const account of accounts) {
    log(
      `  account ...${String(account.account).slice(-4)} (${account.company}): ${account.lines} lines = ` +
        `${account.expenses} expenses, ${account.income} incoming, ${account.pending} pending, ` +
        `${account.ownTransfers} transfers between your accounts, ${account.cardCharges} card charges. ` +
        `New: ${tally(plan.inserts, account)}, already in the app: ${tally(plan.known, account) + tally(plan.links.map((l) => l.candidate), account)}.`,
    );
  }
  for (const candidate of plan.repeated) {
    log(
      `  ! ${candidate.date}  ${candidate.amount.toFixed(2).padStart(9)}  ${candidate.description}  ` +
        `(account ...${String(candidate.account).slice(-4)}: the bank gave this line the same id as another one, so it was NOT added)`,
    );
  }

  // Only expenses are filed under a category. An ATM withdrawal goes to the cash category, and
  // nothing else ever does: that category is the wallet, not a kind of spending. A payee the
  // household has filed before goes where they put it last time; Claude is asked only about
  // the rest, and is not offered the cash category at all.
  const expenses = plan.inserts.filter((candidate) => candidate.type === "expense");
  const { data: filed, error: filedError } = await supabase
    .from("transactions")
    .select("description, category_id")
    .eq("household_id", householdId)
    .eq("type", "expense")
    .not("category_id", "is", null)
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(PAGE);
  if (filedError) throw new Error(filedError.message);
  const learned = learnCategories(filed);
  const cashCategory = categories.find((c) => c.name.includes("מזומן"));
  const filable = categories.filter((c) => c !== cashCategory);
  const usable = new Set(filable.map((c) => c.id));
  const categoryOf = new Map();
  const unknown = [];
  let withdrawals = 0;
  for (const candidate of expenses) {
    if (isCashWithdrawal(candidate.description)) {
      categoryOf.set(candidate, cashCategory?.id ?? null);
      withdrawals += 1;
      continue;
    }
    const before = learned.get(payeeKey(candidate.description));
    if (before && usable.has(before)) categoryOf.set(candidate, before);
    else unknown.push(candidate);
  }
  const fromBefore = categoryOf.size - withdrawals;
  const guessed = await categorize(unknown, filable, log);
  unknown.forEach((candidate, i) => categoryOf.set(candidate, guessed[i]));
  const categoryIds = plan.inserts.map((candidate) => categoryOf.get(candidate) ?? null);
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  if (expenses.length > 0) {
    log(
      `Categories: ${withdrawals} cash withdrawal(s), ${fromBefore} as you filed the same payee before, ${unknown.length} asked of Claude.`,
    );
  }

  for (const [i, candidate] of plan.inserts.entries()) {
    const name = candidate.type === "income" ? "income" : (categoryName.get(categoryIds[i]) ?? "(no category)");
    const sign = candidate.type === "income" ? "+" : "-";
    log(`  ${sign} ${candidate.date}  ${candidate.amount.toFixed(2).padStart(9)}  ${candidate.description}  ->  ${name}`);
  }
  for (const { candidate } of plan.moves) {
    log(
      `  > ${candidate.bankDate} -> ${candidate.date}  ${candidate.amount.toFixed(2).padStart(9)}  ${candidate.description}  ` +
        `(income at the very end of a month is counted for the next one)`,
    );
  }
  for (const { line } of plan.removals) {
    log(`  x ${line}  (was imported as one expense; the card is read now, so it is ${dryRun ? "to be " : ""}removed)`);
  }
  for (const { candidate } of plan.links) {
    log(`  = ${candidate.date}  ${candidate.amount.toFixed(2).padStart(9)}  ${candidate.description}  (already written by hand)`);
  }

  if (!dryRun) {
    const rows = plan.inserts.map((candidate, i) => ({
      household_id: householdId,
      type: candidate.type,
      amount: candidate.amount,
      category_id: categoryIds[i],
      description: candidate.description,
      occurred_on: candidate.date,
      source: "bank",
      external_id: candidate.externalId,
    }));
    for (let start = 0; start < rows.length; start += WRITE_BATCH) {
      const { error } = await supabase.from("transactions").insert(rows.slice(start, start + WRITE_BATCH));
      // Rows saved before a failure stay; the next run recognises them and adds only the rest.
      if (error) throw new Error(`Saving the new rows failed after ${start} of ${rows.length}: ${error.message}`);
    }
    if (plan.removals.length > 0) {
      const { error } = await supabase
        .from("transactions")
        .delete()
        .in("id", plan.removals.map((removal) => removal.id))
        .eq("household_id", householdId)
        .eq("source", "bank");
      if (error) throw new Error(`Removing replaced card charges failed: ${error.message}`);
    }
    for (const { id, candidate } of plan.moves) {
      const { error } = await supabase
        .from("transactions")
        .update({ occurred_on: candidate.date })
        .eq("id", id)
        .eq("household_id", householdId);
      if (error) throw new Error(`Moving an income to the next month failed: ${error.message}`);
    }
    for (const { id, candidate } of plan.links) {
      const { error } = await supabase
        .from("transactions")
        .update({ external_id: candidate.externalId })
        .eq("id", id)
        .eq("household_id", householdId);
      if (error) throw new Error(`Marking a hand-written row failed: ${error.message}`);
    }
  }

  for (const line of skipped.cardCharges) {
    log(`  x ${line}  (the card's monthly charge; its purchases are read from the card)`);
  }
  for (const line of skipped.ownTransfers) {
    log(`  x ${line}  (a transfer between your own accounts)`);
  }

  const verb = dryRun ? "would be added" : "added";
  log(
    `${plan.inserts.length} ${verb}, ${plan.links.length} matched to hand-written rows, ${plan.known.length} already imported, ` +
      `${plan.moves.length} income(s) ${dryRun ? "would be " : ""}moved to the next month, ` +
      `${plan.removals.length} card charge(s) ${dryRun ? "would be " : ""}replaced by the card's own purchases. ` +
      `Left out: ${skipped.pending} pending, ${skipped.credits} incoming, ${skipped.cardCharges.length} card charges in the bank account, ` +
      `${skipped.ownTransfers.length} transfers between your own accounts.`,
  );
  if (plan.repeated.length > 0) {
    log(`${plan.repeated.length} line(s) were left out because the bank's ids repeat. They are marked with "!" above.`);
  }
  if (failures.length > 0) throw new Error(`Could not read: ${failures.join(", ")}.`);
}

/** The same protection for an error thrown out of runSync before it is logged by the caller. */
export function secretsOf(sources) {
  return sources.flatMap((source) => Object.values(source.credentials)).filter((value) => value.length >= 4);
}
