// Runs one sync from the command line, with the login details in sync/.env.
//
//   node bank-sync.mjs              import what is new
//   node bank-sync.mjs --dry-run    show what would be imported, write nothing
//   node bank-sync.mjs --since=2026-10-01
//   node bank-sync.mjs --show-browser   watch the browser, e.g. when the bank asks for a code
//
// To run syncs from the website instead, see agent.mjs.

import { SOURCES, SetupError, defaultSince, findChrome, loadEnvFiles, runSync, signIn, sourcesFrom } from "./run-sync.mjs";

/** Login details from variables such as DISCOUNT_ID and MAX_PASSWORD. */
export function credentialsFromEnv() {
  return Object.fromEntries(
    SOURCES.map(({ company, fields }) => [
      company,
      Object.fromEntries(fields.map((field) => [field, process.env[`${company}_${field}`.toUpperCase()] ?? ""])),
    ]),
  );
}

async function main() {
  const args = process.argv.slice(2);
  const since = args.find((arg) => arg.startsWith("--since="))?.slice("--since=".length);
  if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new SetupError("--since takes a date like 2026-10-01.");

  loadEnvFiles();
  const sources = sourcesFrom(credentialsFromEnv(), "sync/.env");
  if (sources.length === 0) {
    throw new SetupError("No bank or card is filled in. Add the login details to sync/.env.");
  }
  const chrome = findChrome();
  const { supabase, householdId } = await signIn();
  await runSync({
    supabase,
    householdId,
    sources,
    chrome,
    since: since ?? defaultSince(),
    dryRun: args.includes("--dry-run"),
    showBrowser: args.includes("--show-browser"),
    log: (line) => console.log(line),
  });
}

// Only when started directly, so agent.mjs can import credentialsFromEnv.
if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof SetupError ? `Setup: ${error.message}` : `Sync failed: ${error.message}`);
    process.exitCode = 1;
  });
}
