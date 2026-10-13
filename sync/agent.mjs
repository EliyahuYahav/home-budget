// The home computer's side of the website's developer screen. Keeps running, and:
// - publishes this computer's public key, which the website uses to seal the bank login details;
// - tells the website it is alive;
// - runs each sync the website asks for and sends the output back as it goes;
// - once a first real sync has succeeded, runs one by itself when a day has passed.
//
//   node agent.mjs
//
// The private key stays in sync/agent-key.json. Whoever has that file and the database
// can read the saved bank details, so it must not be copied anywhere.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { credentialsFromEnv } from "./bank-sync.mjs";
import { SetupError, findChrome, here, loadEnvFiles, redact, runSync, secretsOf, signIn, sinceMonthsBack, sourcesFrom } from "./run-sync.mjs";
import { fingerprint, generateKeyPair, open } from "./seal.mjs";

const KEY_FILE = join(here, "agent-key.json");
const POLL_MS = 4_000;
const HEARTBEAT_MS = 15_000;
const FLUSH_MS = 1_000;
const AUTO_CHECK_MS = 10 * 60_000;
const DAY_MS = 86_400_000;
// A request made while this computer was off must not start by surprise when it comes back.
const REQUEST_EXPIRES_MS = 10 * 60_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stamp = () => new Date().toISOString();

async function loadOrCreateKey() {
  if (existsSync(KEY_FILE)) return JSON.parse(readFileSync(KEY_FILE, "utf8"));
  const pair = await generateKeyPair();
  writeFileSync(KEY_FILE, JSON.stringify(pair), { mode: 0o600 });
  console.log("Created this computer's key in sync/agent-key.json.");
  return pair;
}

function check(error, what) {
  if (!error) return;
  if (/bank_sync_/.test(error.message)) {
    throw new SetupError("The database is missing the sync tables. Run supabase/schema.sql again in the Supabase SQL Editor.");
  }
  throw new Error(`${what}: ${error.message}`);
}

async function main() {
  loadEnvFiles();
  const chrome = findChrome();
  const { supabase, householdId } = await signIn({ keepSession: true });
  const key = await loadOrCreateKey();

  const { error: publishError } = await supabase
    .from("bank_sync_settings")
    .upsert({ household_id: householdId, public_key: key.publicKey, agent_seen_at: stamp() });
  check(publishError, "Publishing the key failed");

  // A run left "running" belongs to an agent that was closed in the middle.
  const { error: staleError } = await supabase
    .from("bank_sync_runs")
    .update({ status: "failed", finished_at: stamp(), output: "The agent on the home computer was restarted during this run.\n" })
    .eq("household_id", householdId)
    .eq("status", "running");
  check(staleError, "Closing old runs failed");

  setInterval(() => {
    supabase
      .from("bank_sync_settings")
      .update({ agent_seen_at: stamp() })
      .eq("household_id", householdId)
      .then(({ error }) => error && console.error(`Heartbeat failed: ${error.message}`));
  }, HEARTBEAT_MS);

  async function sourcesToRead() {
    const { data, error } = await supabase
      .from("bank_sync_settings")
      .select("credentials")
      .eq("household_id", householdId)
      .maybeSingle();
    check(error, "Reading the saved details failed");
    if (!data?.credentials) return sourcesFrom(credentialsFromEnv(), "sync/.env");
    let text;
    try {
      text = await open(key.privateKey, data.credentials);
    } catch {
      throw new SetupError(
        "The saved bank details cannot be opened with this computer's key. Save them again in the developer screen.",
      );
    }
    return sourcesFrom(JSON.parse(text), "the developer screen");
  }

  async function execute(run) {
    let output = "";
    let sent = "";
    const log = (line) => {
      output += `${line}\n`;
      console.log(line);
    };
    const flush = async () => {
      if (output === sent) return;
      const snapshot = output;
      const { error } = await supabase.from("bank_sync_runs").update({ output: snapshot }).eq("id", run.id);
      if (!error) sent = snapshot;
    };

    console.log(`Run ${run.id} (${run.dry_run ? "dry run" : "sync"}, ${run.months_back ?? 1} month(s) back) started.`);
    await supabase.from("bank_sync_runs").update({ status: "running", started_at: stamp() }).eq("id", run.id);
    const timer = setInterval(() => void flush(), FLUSH_MS);
    let status = "done";
    let secrets = [];
    try {
      const sources = await sourcesToRead();
      secrets = secretsOf(sources);
      await runSync({
        supabase,
        householdId,
        sources,
        chrome,
        since: sinceMonthsBack(run.months_back),
        dryRun: run.dry_run,
        showBrowser: process.env.SHOW_BROWSER === "on",
        log,
      });
    } catch (error) {
      log(redact(`${error instanceof SetupError ? "Setup" : "Failed"}: ${error.message}`, secrets));
      status = "failed";
    }
    clearInterval(timer);
    const { error } = await supabase
      .from("bank_sync_runs")
      .update({ status, output, finished_at: stamp() })
      .eq("id", run.id);
    if (error) console.error(`Saving the result failed: ${error.message}`);
  }

  // Only after the user has seen one real sync work, and never more than once a day,
  // whatever the outcome: repeated failed logins can get a bank account locked.
  async function queueDailyRun() {
    const { data, error } = await supabase
      .from("bank_sync_runs")
      .select("status, created_at")
      .eq("household_id", householdId)
      .eq("dry_run", false)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error || !data?.length) return;
    const succeededOnce = data.some((run) => run.status === "done");
    const recent = Date.now() - Date.parse(data[0].created_at) < DAY_MS;
    if (!succeededOnce || recent) return;
    console.log("A day has passed since the last sync; starting one.");
    await supabase.from("bank_sync_runs").insert({ household_id: householdId, dry_run: false });
  }

  console.log("The agent is running. Leave this window open; the website can now start a sync.");
  console.log(`This computer's key code: ${await fingerprint(key.publicKey)}`);
  console.log("The developer screen shows the same code. Fill in bank details only when they match.");
  let lastAutoCheck = 0;
  for (;;) {
    try {
      if (process.env.AUTO_SYNC !== "off" && Date.now() - lastAutoCheck > AUTO_CHECK_MS) {
        lastAutoCheck = Date.now();
        await queueDailyRun();
      }
      const { data: run, error } = await supabase
        .from("bank_sync_runs")
        // Every column, so a database without the newest ones still answers.
        .select("*")
        .eq("household_id", householdId)
        .eq("status", "queued")
        .order("created_at")
        .limit(1)
        .maybeSingle();
      if (error) console.error(`Checking for requests failed: ${error.message}`);
      else if (run && Date.now() - Date.parse(run.created_at) > REQUEST_EXPIRES_MS) {
        await supabase
          .from("bank_sync_runs")
          .update({
            status: "failed",
            finished_at: stamp(),
            output: "Expired: the home computer was not running when this was requested.\n",
          })
          .eq("id", run.id);
      } else if (run) await execute(run);
    } catch (error) {
      console.error(`Unexpected error: ${error.message}`);
    }
    await sleep(POLL_MS);
  }
}

main().catch((error) => {
  console.error(error instanceof SetupError ? `Setup: ${error.message}` : `Agent stopped: ${error.message}`);
  process.exitCode = 1;
});
