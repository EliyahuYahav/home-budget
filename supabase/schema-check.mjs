// Runs schema.sql on an in-memory Postgres set up like Supabase (auth.uid(), the anon and
// authenticated roles with Supabase's default table privileges), then attacks it: as a
// visitor who is not signed in, as a member of another household, and as a member trying
// to loosen their own household's guards. Run with `npm run test:db` after changing the schema.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const schema = readFileSync(join(import.meta.dirname, "schema.sql"), "utf8");
const db = new PGlite();

await db.exec(`
  create schema auth;
  create table auth.users (id uuid primary key);
  create role anon nologin;
  create role authenticated nologin;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
`);

await db.exec(schema);
await db.exec(schema); // must be safe to run again
console.log("schema ran twice without error");

const users = { A: "aaaaaaaa-0000-4000-8000-000000000001", B: "bbbbbbbb-0000-4000-8000-000000000002", C: "cccccccc-0000-4000-8000-000000000003", D: "dddddddd-0000-4000-8000-000000000004" };
for (const id of Object.values(users)) await db.query("insert into auth.users (id) values ($1)", [id]);

async function as(who, sql, params = []) {
  await db.exec("reset role");
  if (who === "anon") {
    await db.exec("set request.jwt.claim.sub = ''; set role anon");
  } else {
    await db.exec(`set request.jwt.claim.sub = '${users[who]}'; set role authenticated`);
  }
  try {
    const result = await db.query(sql, params);
    return { ok: true, rows: result.rows, affected: result.affectedRows ?? result.rows.length };
  } catch (error) {
    return { ok: false, error: error.message };
  } finally {
    await db.exec("reset role");
  }
}

let passed = 0;
let failed = 0;
function expect(name, condition, detail = "") {
  if (condition) passed += 1;
  else failed += 1;
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${condition ? "" : `  -> ${detail}`}`);
}
const blocked = (r) => !r.ok || r.affected === 0;
const show = (r) => JSON.stringify(r).slice(0, 160);

const hidA = (await as("A", "select public.create_household('A home', 'A') as id")).rows[0].id;
const hidB = (await as("B", "select public.create_household('B home', 'B') as id")).rows[0].id;
const codeA = (await as("A", "select invite_code from public.households")).rows[0].invite_code;
await as("B", "insert into public.transactions (household_id, type, amount, occurred_on, description) values ($1, 'expense', 50, '2026-10-01', 'secret of B')", [hidB]);
await as("B", "insert into public.bank_sync_settings (household_id, credentials) values ($1, 'sealed-B')", [hidB]);
await as("B", "insert into public.bank_sync_runs (household_id) values ($1)", [hidB]);

let r;
// --- a visitor who is not signed in
for (const table of ["households", "household_members", "categories", "recurring_incomes", "transactions", "chat_messages", "bank_sync_settings", "bank_sync_runs"]) {
  r = await as("anon", `select * from public.${table}`);
  expect(`signed-out visitor cannot read ${table}`, !r.ok, show(r));
}
r = await as("anon", "select public.create_household('x', 'x')");
expect("signed-out visitor cannot create a household", !r.ok, show(r));
r = await as("anon", "select public.join_household($1, 'x')", [codeA]);
expect("signed-out visitor cannot join with a valid code", !r.ok, show(r));

// --- a signed-in user from another household (A attacking B)
for (const table of ["transactions", "categories", "chat_messages", "bank_sync_settings", "bank_sync_runs", "recurring_incomes"]) {
  r = await as("A", `select * from public.${table} where household_id = $1`, [hidB]);
  expect(`other household cannot read B's ${table}`, r.ok && r.rows.length === 0, show(r));
}
r = await as("A", "select * from public.households where id = $1", [hidB]);
expect("other household cannot see B's invite code", r.ok && r.rows.length === 0, show(r));
r = await as("A", "select * from public.household_members where household_id = $1", [hidB]);
expect("other household cannot list B's members", r.ok && r.rows.length === 0, show(r));
r = await as("A", "insert into public.transactions (household_id, type, amount, occurred_on) values ($1, 'expense', 1, '2026-10-01')", [hidB]);
expect("other household cannot add a transaction to B", !r.ok, show(r));
r = await as("A", "update public.transactions set amount = 999 where household_id = $1", [hidB]);
expect("other household cannot change B's transactions", blocked(r), show(r));
r = await as("A", "delete from public.transactions where household_id = $1", [hidB]);
expect("other household cannot delete B's transactions", blocked(r), show(r));
r = await as("A", "update public.bank_sync_settings set public_key = '{}'::jsonb, credentials = null where household_id = $1", [hidB]);
expect("other household cannot replace B's key or wipe its bank details", blocked(r), show(r));
r = await as("A", "insert into public.bank_sync_runs (household_id, dry_run) values ($1, false)", [hidB]);
expect("other household cannot start a sync for B", !r.ok, show(r));
r = await as("A", "update public.household_members set household_id = $1 where user_id = $2", [hidB, users.A]);
expect("a user cannot move their membership into B", !r.ok, show(r));
r = await as("A", "insert into public.household_members (household_id, user_id, display_name) values ($1, $2, 'x')", [hidB, users.A]);
expect("a user cannot insert themselves into B", !r.ok, show(r));
r = await as("A", "update public.transactions set household_id = $1 where household_id = $2", [hidA, hidB]);
expect("a user cannot pull B's rows into their own household", blocked(r), show(r));

// --- a member tampering with their own household's guards
r = await as("A", "update public.households set invite_code = 'AAAAAAAA' where id = $1", [hidA]);
expect("a member cannot replace the invite code", !r.ok, show(r));
r = await as("A", "update public.households set max_members = 99 where id = $1", [hidA]);
expect("a member cannot raise the member limit", !r.ok, show(r));
r = await as("A", "delete from public.households where id = $1", [hidA]);
expect("a member cannot delete the household", blocked(r), show(r));
r = await as("A", "update public.households set name = 'New name' where id = $1", [hidA]);
expect("a member can still rename the household", r.ok && r.affected === 1, show(r));
r = await as("A", "update public.household_members set display_name = 'Renamed' where user_id = $1", [users.A]);
expect("a member can still rename themselves", r.ok && r.affected === 1, show(r));

// --- joining
r = await as("C", "select public.join_household('ZZZZZZZZ', 'C')");
expect("a wrong invite code is refused", !r.ok && /invalid invite code/.test(r.error), show(r));
r = await as("C", "select public.join_household($1, 'C')", [codeA]);
expect("the partner joins with the code", r.ok, show(r));
r = await as("D", "select public.join_household($1, 'D')", [codeA]);
expect("a third person is refused even with the right code", !r.ok && /invalid invite code/.test(r.error), show(r));
r = await as("C", "select * from public.transactions where household_id = $1", [hidB]);
expect("the partner still cannot read household B", r.ok && r.rows.length === 0, show(r));

// --- the app's own operations still work
r = await as("A", "insert into public.transactions (household_id, type, amount, occurred_on, source, external_id) values ($1, 'expense', 12.5, '2026-10-02', 'bank', 'max:1:77')", [hidA]);
expect("a bank row can be saved", r.ok, show(r));
r = await as("A", "insert into public.transactions (household_id, type, amount, occurred_on, source, external_id) values ($1, 'expense', 12.5, '2026-10-02', 'bank', 'max:1:77')", [hidA]);
expect("the same bank charge cannot be saved twice", !r.ok, show(r));
r = await as("A", "insert into public.transactions (household_id, type, amount, occurred_on, paid_in_cash) values ($1, 'expense', 40, '2026-10-03', true) returning paid_in_cash", [hidA]);
expect("a purchase can be marked as paid in cash", r.ok && r.rows[0].paid_in_cash === true, show(r));
r = await as("A", "insert into public.transactions (household_id, type, amount, occurred_on, source, external_id) values ($1, 'income', 9000, '2026-10-01', 'bank', 'discount:1:5')", [hidA]);
expect("an income from the bank can be saved", r.ok, show(r));
r = await as("C", "select * from public.transactions where household_id = $1", [hidA]);
expect("the partner sees the shared rows", r.ok && r.rows.length === 3, show(r));
r = await as("A", "insert into public.bank_sync_settings (household_id, public_key, agent_seen_at) values ($1, '{\"n\":\"x\"}'::jsonb, now()) on conflict (household_id) do update set public_key = excluded.public_key, agent_seen_at = excluded.agent_seen_at", [hidA]);
expect("the agent can publish its key", r.ok, show(r));
r = await as("A", "update public.bank_sync_settings set credentials = 'sealed' where household_id = $1", [hidA]);
expect("the website can save sealed bank details", r.ok && r.affected === 1, show(r));
r = await as("A", "insert into public.bank_sync_runs (household_id, dry_run) values ($1, true) returning status", [hidA]);
expect("the website can request a sync", r.ok && r.rows[0].status === "queued", show(r));
r = await as("A", "insert into public.bank_sync_runs (household_id, dry_run, months_back) values ($1, true, 6) returning months_back", [hidA]);
expect("a sync can be asked to read half a year back", r.ok && r.rows[0].months_back === 6, show(r));
r = await as("A", "insert into public.bank_sync_runs (household_id, months_back) values ($1, 60)", [hidA]);
expect("a sync cannot be asked for more than a year", !r.ok, show(r));

// --- a household's own Claude key
r = await as("B", "insert into public.household_secrets (household_id, claude_key, claude_key_hint) values ($1, 'v1.sealed', 'abcd')", [hidB]);
expect("a household can save its sealed Claude key", r.ok, show(r));
r = await as("A", "select * from public.household_secrets where household_id = $1", [hidB]);
expect("other household cannot read B's sealed key", r.ok && r.rows.length === 0, show(r));
r = await as("A", "update public.household_secrets set claude_key = 'v1.other' where household_id = $1", [hidB]);
expect("other household cannot replace B's key", blocked(r), show(r));
r = await as("A", "insert into public.household_secrets (household_id, claude_key) values ($1, 'v1.x') on conflict (household_id) do update set claude_key = excluded.claude_key", [hidB]);
expect("other household cannot plant a key for B", !r.ok, show(r));
r = await as("anon", "select * from public.household_secrets");
expect("signed-out visitor cannot read household_secrets", !r.ok, show(r));

// --- payers counted for the next month
r = await as("B", "insert into public.next_month_incomes (household_id, payer) values ($1, 'משרד הביטחון')", [hidB]);
expect("a household can mark a payer as next month's income", r.ok, show(r));
r = await as("A", "select * from public.next_month_incomes where household_id = $1", [hidB]);
expect("other household cannot read B's payers", r.ok && r.rows.length === 0, show(r));
r = await as("A", "insert into public.next_month_incomes (household_id, payer) values ($1, 'x payer')", [hidB]);
expect("other household cannot add a payer for B", !r.ok, show(r));
r = await as("A", "delete from public.next_month_incomes where household_id = $1", [hidB]);
expect("other household cannot remove B's payers", blocked(r), show(r));
r = await as("B", "insert into public.next_month_incomes (household_id, payer) values ($1, ' ')", [hidB]);
expect("an empty payer is refused", !r.ok, show(r));

// --- funds for yearly expenses
r = await as("B", "insert into public.categories (household_id, name, kind, monthly_budget, fund_start, fund_opening) values ($1, 'ביטוח רכב', 'fund', 250, '2026-10-01', 500)", [hidB]);
expect("a household can open a fund", r.ok, show(r));
r = await as("B", "insert into public.categories (household_id, name, kind) values ($1, 'other kind', 'loan')", [hidB]);
expect("an unknown kind of category is refused", !r.ok, show(r));
r = await as("B", "update public.categories set fund_opening = -1 where household_id = $1 and name = 'ביטוח רכב'", [hidB]);
expect("a fund cannot open below zero", !r.ok, show(r));

// --- the monthly report switch
r = await as("B", "update public.households set monthly_report = false where id = $1", [hidB]);
expect("a household can turn its monthly report off", r.ok && r.affected === 1, show(r));
r = await as("A", "update public.households set monthly_report = false where id = $1", [hidB]);
expect("other household cannot turn B's report off", blocked(r), show(r));

// --- savings goals
r = await as("B", "update public.categories set goal_amount = 8000, goal_due = '2027-06-01' where household_id = $1 and name = 'חסכונות'", [hidB]);
expect("a household can give a savings line a goal", r.ok && r.affected === 1, show(r));
r = await as("B", "update public.categories set goal_amount = 0 where household_id = $1 and name = 'חסכונות'", [hidB]);
expect("a goal of nothing is refused", !r.ok, show(r));
r = await as("A", "update public.categories set goal_amount = 1 where household_id = $1 and name = 'חסכונות'", [hidB]);
expect("other household cannot change B's goal", blocked(r), show(r));

// --- reset: a household can clear its own rows, and only its own
r = await as("A", "delete from public.transactions where household_id = $1", [hidA]);
expect("a household can delete all of its own transactions", r.ok && r.affected === 3, show(r));
await db.exec("reset role");
r = await db.query("select count(*)::int as n from public.transactions where household_id = $1", [hidB]);
expect("resetting one household leaves the other's rows", r.rows[0].n === 1, JSON.stringify(r.rows));
r = await db.query("select count(*)::int as n from public.categories where household_id = $1", [hidA]);
expect("a reset keeps the household's categories", r.rows[0].n === 29, JSON.stringify(r.rows));

r = await as("A", "select count(*)::int as n from public.categories where household_id = $1", [hidA]);
expect("a new household starts with its categories", r.ok && r.rows[0].n === 29, show(r));

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
