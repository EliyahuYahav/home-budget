// One sync run: read the bank and the card, work out what is new, and write it to the app.
// Used by the command line (bank-sync.mjs) and by the agent that the website talks to (agent.mjs).

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { createScraper } from "israeli-bank-scrapers-core";
import { categorize } from "./categorize.mjs";
import { MATCH_DAYS, israelDate, planImport, toCandidates } from "./plan.mjs";

const DEFAULT_DAYS_BACK = 30;

export const here = dirname(fileURLToPath(import.meta.url));

/** A problem the user fixes in the settings, as opposed to a run that went wrong. */
export class SetupError extends Error {}

// The login fields of each supported company. The website's form (src/lib/bank-sources.ts)
// lists the same companies and fields.
export const SOURCES = [
  { company: "discount", kind: "bank", fields: ["id", "password", "num"] },
  { company: "mizrahi", kind: "bank", fields: ["username", "password"] },
  { company: "max", kind: "card", fields: ["username", "password"] },
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

/**
 * Checks login details given as { company: { field: value } } and returns the sources to read.
 * A company with every field empty is simply not used.
 */
export function sourcesFrom(credentials, where) {
  const sources = [];
  for (const source of SOURCES) {
    const given = credentials[source.company] ?? {};
    const filled = source.fields.filter((field) => given[field]);
    if (filled.length === 0) continue;
    if (filled.length < source.fields.length) {
      const missing = source.fields.filter((field) => !given[field]).join(", ");
      throw new SetupError(`${source.company} is only partly filled in ${where}: ${missing} is missing.`);
    }
    sources.push({
      ...source,
      credentials: Object.fromEntries(source.fields.map((field) => [field, String(given[field])])),
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
    try {
      const result = await scrape(source, since, chrome, showBrowser);
      const count = result.accounts.reduce((sum, account) => sum + account.txns.length, 0);
      log(`- ${source.company}: ${count} transactions in ${result.accounts.length} account(s)`);
      scraped.push(result);
    } catch (error) {
      log(`- ${source.company}: failed (${error.message})`);
      failures.push(source.company);
    }
  }

  const { candidates, skipped } = toCandidates(scraped);

  // Hand-written rows can sit a couple of days before the bank's date.
  const from = israelDate(new Date(Date.parse(since) - (MATCH_DAYS + 1) * 86_400_000).toISOString());
  const { data: existing, error: existingError } = await supabase
    .from("transactions")
    .select("id, external_id, type, amount, occurred_on")
    .eq("household_id", householdId)
    .gte("occurred_on", from);
  if (existingError) {
    if (/external_id/.test(existingError.message)) {
      throw new SetupError(
        "The database is missing the bank columns. Run supabase/schema.sql again in the Supabase SQL Editor.",
      );
    }
    throw new Error(existingError.message);
  }

  const plan = planImport(
    candidates,
    existing.map((row) => ({ ...row, amount: Number(row.amount) })),
  );

  const { data: categories, error: categoriesError } = await supabase
    .from("categories")
    .select("id, name")
    .eq("household_id", householdId)
    .eq("archived", false)
    .eq("kind", "expense")
    .order("sort_order");
  if (categoriesError) throw new Error(categoriesError.message);
  const categoryIds = await categorize(plan.inserts, categories, log);
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  for (const [i, candidate] of plan.inserts.entries()) {
    const name = categoryName.get(categoryIds[i]) ?? "(no category)";
    log(`  + ${candidate.date}  ${candidate.amount.toFixed(2).padStart(9)}  ${candidate.description}  ->  ${name}`);
  }
  for (const { candidate } of plan.links) {
    log(`  = ${candidate.date}  ${candidate.amount.toFixed(2).padStart(9)}  ${candidate.description}  (already written by hand)`);
  }

  if (!dryRun) {
    if (plan.inserts.length > 0) {
      const { error } = await supabase.from("transactions").insert(
        plan.inserts.map((candidate, i) => ({
          household_id: householdId,
          type: "expense",
          amount: candidate.amount,
          category_id: categoryIds[i],
          description: candidate.description,
          occurred_on: candidate.date,
          source: "bank",
          external_id: candidate.externalId,
        })),
      );
      if (error) throw new Error(`Saving the new rows failed: ${error.message}`);
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

  const verb = dryRun ? "would be added" : "added";
  log(
    `${plan.inserts.length} ${verb}, ${plan.links.length} matched to hand-written rows, ${plan.known} already imported. ` +
      `Left out: ${skipped.pending} pending, ${skipped.credits} incoming, ${skipped.cardCharges} card charges in the bank account.`,
  );
  if (failures.length > 0) throw new Error(`Could not read: ${failures.join(", ")}.`);
}

/** The same protection for an error thrown out of runSync before it is logged by the caller. */
export function secretsOf(sources) {
  return sources.flatMap((source) => Object.values(source.credentials)).filter((value) => value.length >= 4);
}
