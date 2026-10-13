-- Home Budget — database schema for Supabase (Postgres).
-- Run this whole file once in the Supabase dashboard: SQL Editor -> New query -> Run.
-- It is safe to re-run: every statement is idempotent.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  invite_code text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 8)),
  -- Closed once both partners are in: join_household refuses a third member.
  max_members int not null default 2,
  -- Whether the members are sent the report of each month that ends.
  monthly_report boolean not null default true,
  created_at  timestamptz not null default now()
);

-- One household per user (unique on user_id) keeps every query simple.
create table if not exists public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id      uuid not null unique references auth.users (id) on delete cascade,
  display_name text not null,
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

-- kind = 'saving' marks "pay yourself first" lines: their budget is set aside
-- at the start of the month, before anything is available to spend.
-- is_fixed marks bills (rent, internet...) whose unpaid part is reserved when
-- computing how much is safe to spend today.
-- kind = 'fund' is money put aside every month for a bill that comes once a year (car
-- insurance, holidays): monthly_budget goes into the fund each month from fund_start on,
-- and a charge filed under it is paid from what has gathered instead of from the month.
create table if not exists public.categories (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households (id) on delete cascade,
  name           text not null,
  kind           text not null default 'expense' check (kind in ('expense', 'saving', 'fund')),
  is_fixed       boolean not null default false,
  monthly_budget numeric(12, 2) not null default 0 check (monthly_budget >= 0),
  sort_order     int not null default 0,
  archived       boolean not null default false,
  -- For a fund: the first day of the month it began, and what was already in it then.
  -- A savings goal uses fund_opening too, for what was saved before the app knew of it.
  fund_start     date,
  fund_opening   numeric(12, 2) not null default 0 check (fund_opening >= 0),
  -- A savings line with a goal ("summer holiday, 8,000, by June"): how much, and the first
  -- day of the month it is wanted by. Both are optional.
  goal_amount    numeric(12, 2) check (goal_amount > 0),
  goal_due       date,
  unique (household_id, name)
);

-- For databases created before funds existed.
alter table public.categories add column if not exists fund_start date;
alter table public.categories
  add column if not exists fund_opening numeric(12, 2) not null default 0 check (fund_opening >= 0);
alter table public.categories
  add column if not exists goal_amount numeric(12, 2) check (goal_amount > 0);
alter table public.categories add column if not exists goal_due date;
alter table public.categories drop constraint if exists categories_kind_check;
alter table public.categories
  add constraint categories_kind_check check (kind in ('expense', 'saving', 'fund'));

-- Fixed monthly incomes (salaries). One-off incomes are transactions of type 'income'.
create table if not exists public.recurring_incomes (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name         text not null,
  amount       numeric(12, 2) not null check (amount > 0),
  created_at   timestamptz not null default now()
);

create table if not exists public.transactions (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id      uuid references auth.users (id) on delete set null default auth.uid(),
  type         text not null check (type in ('expense', 'income')),
  amount       numeric(12, 2) not null check (amount > 0),
  category_id  uuid references public.categories (id) on delete set null,
  description  text not null default '',
  occurred_on  date not null,
  source       text not null default 'manual' check (source in ('manual', 'chat', 'bank')),
  -- The bank's or card company's own id for the charge, set by sync/bank-sync.mjs.
  external_id  text,
  -- A purchase paid with cash that was already counted when it was withdrawn; the app
  -- takes its amount off the month's withdrawals instead of counting the money twice.
  paid_in_cash boolean not null default false,
  created_at   timestamptz not null default now()
);

-- For databases created before the bank sync existed.
alter table public.transactions add column if not exists external_id text;
alter table public.transactions add column if not exists paid_in_cash boolean not null default false;
alter table public.transactions drop constraint if exists transactions_source_check;
alter table public.transactions
  add constraint transactions_source_check check (source in ('manual', 'chat', 'bank'));

create index if not exists transactions_household_date_idx
  on public.transactions (household_id, occurred_on desc);

-- A charge is imported once, however many times the sync reads it.
create unique index if not exists transactions_external_id_idx
  on public.transactions (household_id, external_id)
  where external_id is not null;

create table if not exists public.chat_messages (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id      uuid references auth.users (id) on delete set null default auth.uid(),
  role         text not null check (role in ('user', 'bot')),
  content      text not null,
  created_at   timestamptz not null default now()
);

create index if not exists chat_messages_household_idx
  on public.chat_messages (household_id, created_at desc);

-- Bank sync, driven from the app's developer screen and carried out by sync/agent.mjs on
-- the home computer. `credentials` is the bank login details sealed in the browser with
-- `public_key`; only the home computer holds the private key that opens them.
create table if not exists public.bank_sync_settings (
  household_id           uuid primary key references public.households (id) on delete cascade,
  public_key             jsonb,
  credentials            text,
  credentials_updated_at timestamptz,
  agent_seen_at          timestamptz
);

-- One requested sync: the app inserts it as 'queued', the agent runs it and fills in the rest.
create table if not exists public.bank_sync_runs (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  requested_by uuid references auth.users (id) on delete set null default auth.uid(),
  dry_run      boolean not null default true,
  -- How far back to read. The daily sync reads one month; a first import can ask for more.
  months_back  int not null default 1 check (months_back between 1 and 12),
  status       text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  output       text not null default '',
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz
);

-- A household's own Claude API key, for the bot. Sealed by the server with a key that is
-- only in its environment (src/lib/secret-box.ts), so the stored text is useless on its own.
create table if not exists public.household_secrets (
  household_id    uuid primary key references public.households (id) on delete cascade,
  claude_key      text,
  claude_key_hint text,
  updated_at      timestamptz not null default now()
);

-- Payers whose income, when it reaches the bank in the last days of a month, is the money
-- for the month that follows (a salary paid on the 31st in some months and the 1st in others).
-- `payer` is a piece of the bank's description; the sync records such an income on the 1st.
create table if not exists public.next_month_incomes (
  household_id uuid not null references public.households (id) on delete cascade,
  payer        text not null check (length(trim(payer)) between 2 and 100),
  created_at   timestamptz not null default now(),
  primary key (household_id, payer)
);

-- Which month's report each household was already sent, so none is sent twice. Written and
-- read only by the server's scheduled job; members have no access to it at all.
create table if not exists public.report_log (
  household_id uuid not null references public.households (id) on delete cascade,
  period       text not null,
  sent_at      timestamptz not null default now(),
  primary key (household_id, period)
);

-- A Telegram chat that a member linked to the household's bot. Rows are written only by the
-- server, when the chat presents a code that member made; members may see and remove them.
create table if not exists public.telegram_chats (
  chat_id      bigint primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  linked_at    timestamptz not null default now()
);

-- A one-time code a signed-in member makes to link their Telegram chat. It is sent to the
-- bot by the link the settings screen shows, and is good for a quarter of an hour.
create table if not exists public.telegram_link_codes (
  code         text primary key check (length(code) >= 32),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  expires_at   timestamptz not null default now() + interval '15 minutes'
);

create index if not exists bank_sync_runs_household_idx
  on public.bank_sync_runs (household_id, created_at desc);

alter table public.bank_sync_runs
  add column if not exists months_back int not null default 1 check (months_back between 1 and 12);

-- For databases created before the member limit existed.
alter table public.households add column if not exists max_members int not null default 2;
alter table public.households add column if not exists monthly_report boolean not null default true;

-- ---------------------------------------------------------------------------
-- Row level security: a user sees and changes only their own household's rows.
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER so the policies on household_members don't recurse into themselves.
create or replace function public.is_household_member(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.household_members
    where household_id = hid and user_id = auth.uid()
  );
$$;

alter table public.households        enable row level security;
alter table public.household_members enable row level security;
alter table public.categories        enable row level security;
alter table public.recurring_incomes enable row level security;
alter table public.transactions      enable row level security;
alter table public.chat_messages     enable row level security;
alter table public.bank_sync_settings enable row level security;
alter table public.bank_sync_runs     enable row level security;
alter table public.household_secrets  enable row level security;
alter table public.next_month_incomes enable row level security;
alter table public.report_log          enable row level security;
alter table public.telegram_chats      enable row level security;
alter table public.telegram_link_codes enable row level security;

-- Nothing here is for visitors who are not signed in. Row level security already returns
-- them nothing; taking the table privileges away as well means a policy mistake alone
-- cannot expose a table.
revoke all on public.households, public.household_members, public.categories,
  public.recurring_incomes, public.transactions, public.chat_messages,
  public.bank_sync_settings, public.bank_sync_runs, public.household_secrets,
  public.next_month_incomes, public.report_log, public.telegram_chats, public.telegram_link_codes
  from anon;

-- The report log is the server's alone. A member cannot link a chat by writing the row
-- themselves, and can do nothing with a code but make one: the server reads it and removes it.
revoke all on public.report_log from authenticated;
revoke insert, update on public.telegram_chats from authenticated;
revoke select, update, delete on public.telegram_link_codes from authenticated;

-- A policy decides which rows may be updated, not which columns. Without these, a member
-- could move their own membership row to another household's id, or replace the invite
-- code and member limit. Members may only rename themselves and their household, and turn
-- its monthly report on or off.
revoke insert, update, delete on public.household_members from authenticated;
grant update (display_name) on public.household_members to authenticated;
revoke insert, update, delete on public.households from authenticated;
grant update (name, monthly_report) on public.households to authenticated;

drop policy if exists households_select on public.households;
create policy households_select on public.households
  for select to authenticated using (public.is_household_member(id));

drop policy if exists households_update on public.households;
create policy households_update on public.households
  for update to authenticated
  using (public.is_household_member(id)) with check (public.is_household_member(id));

drop policy if exists members_select on public.household_members;
create policy members_select on public.household_members
  for select to authenticated using (public.is_household_member(household_id));

drop policy if exists members_update_self on public.household_members;
create policy members_update_self on public.household_members
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists categories_all on public.categories;
create policy categories_all on public.categories
  for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

drop policy if exists recurring_incomes_all on public.recurring_incomes;
create policy recurring_incomes_all on public.recurring_incomes
  for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

drop policy if exists transactions_all on public.transactions;
create policy transactions_all on public.transactions
  for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

drop policy if exists chat_messages_all on public.chat_messages;
create policy chat_messages_all on public.chat_messages
  for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

drop policy if exists bank_sync_settings_all on public.bank_sync_settings;
create policy bank_sync_settings_all on public.bank_sync_settings
  for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

drop policy if exists next_month_incomes_all on public.next_month_incomes;
create policy next_month_incomes_all on public.next_month_incomes
  for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

drop policy if exists telegram_chats_select on public.telegram_chats;
create policy telegram_chats_select on public.telegram_chats
  for select to authenticated using (public.is_household_member(household_id));

drop policy if exists telegram_chats_delete on public.telegram_chats;
create policy telegram_chats_delete on public.telegram_chats
  for delete to authenticated using (public.is_household_member(household_id));

drop policy if exists telegram_link_codes_insert on public.telegram_link_codes;
create policy telegram_link_codes_insert on public.telegram_link_codes
  for insert to authenticated
  with check (public.is_household_member(household_id) and user_id = auth.uid());

drop policy if exists telegram_link_codes_delete on public.telegram_link_codes;

drop policy if exists household_secrets_all on public.household_secrets;
create policy household_secrets_all on public.household_secrets
  for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

drop policy if exists bank_sync_runs_all on public.bank_sync_runs;
create policy bank_sync_runs_all on public.bank_sync_runs
  for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

-- ---------------------------------------------------------------------------
-- Creating / joining a household. These run as SECURITY DEFINER because a new
-- user is not yet a member of anything, so RLS would block the inserts.
-- ---------------------------------------------------------------------------

create or replace function public.create_household(p_name text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  hid uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if exists (select 1 from public.household_members where user_id = auth.uid()) then
    raise exception 'already in a household';
  end if;

  insert into public.households (name) values (trim(p_name)) returning id into hid;
  insert into public.household_members (household_id, user_id, display_name)
    values (hid, auth.uid(), trim(p_display_name));

  -- Starting budget: the household's existing monthly expense table (12,000 total).
  insert into public.categories (household_id, name, kind, is_fixed, monthly_budget, sort_order) values
    (hid, 'חסכונות',               'saving',  false, 1200, 1),
    (hid, 'השקעות',                'saving',  false,  800, 2),
    (hid, 'שכירות',                'expense', true,  2700, 10),
    (hid, 'ועד בית',               'expense', true,    35, 11),
    (hid, 'חשמל ומים',             'expense', true,   500, 12),
    (hid, 'גז',                    'expense', false,    0, 13),
    (hid, 'אינטרנט',               'expense', true,   120, 14),
    (hid, 'סלולר',                 'expense', true,    65, 15),
    (hid, 'תחב"צ',                 'expense', false,  250, 16),
    (hid, 'דלק',                   'expense', false,  100, 17),
    (hid, 'פארם',                  'expense', false,  250, 18),
    (hid, 'סופר / קניות מזון',     'expense', false, 1800, 19),
    (hid, 'תרופות',                'expense', false,  100, 20),
    (hid, 'טיפולים',               'expense', false,  150, 21),
    (hid, 'טיפולי שיניים',         'expense', false,  120, 22),
    (hid, 'אופטיקה',               'expense', false,   50, 23),
    (hid, 'אוכל בחוץ',             'expense', false,  500, 24),
    (hid, 'מנוי לחדר כושר וכדומה', 'expense', true,   180, 25),
    (hid, 'חופשות בארץ/בחו"ל',     'expense', false,  400, 26),
    (hid, 'מתנות לאירועים',        'expense', false,  150, 27),
    (hid, 'בילויים',               'expense', false,  300, 28),
    (hid, 'תרומות/מעשר',           'expense', false, 1200, 29),
    (hid, 'ביגוד ונעליים',         'expense', false,  400, 30),
    (hid, 'פלאפונים ניידים',       'expense', false,  100, 31),
    (hid, 'שירותי ענן',            'expense', true,    50, 32),
    (hid, 'החזר חובות',            'expense', true,     0, 33),
    (hid, 'עמלות',                 'expense', false,   20, 34),
    (hid, 'ריביות',                'expense', false,    0, 35),
    (hid, 'הוצאות בלתי צפויות',    'expense', false,  460, 36);

  return hid;
end;
$$;

create or replace function public.join_household(p_code text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  hid uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if exists (select 1 from public.household_members where user_id = auth.uid()) then
    raise exception 'already in a household';
  end if;

  select id into hid from public.households where invite_code = upper(trim(p_code));
  if hid is null then
    raise exception 'invalid invite code';
  end if;
  -- The same answer as for a wrong code, so a guess learns nothing from a full household.
  if (select count(*) from public.household_members where household_id = hid)
     >= (select max_members from public.households where id = hid) then
    raise exception 'invalid invite code';
  end if;

  insert into public.household_members (household_id, user_id, display_name)
    values (hid, auth.uid(), trim(p_display_name));
  return hid;
end;
$$;

revoke all on function public.create_household(text, text) from public, anon;
revoke all on function public.join_household(text, text)   from public, anon;
revoke all on function public.is_household_member(uuid)    from public, anon;
grant execute on function public.create_household(text, text) to authenticated;
grant execute on function public.join_household(text, text)   to authenticated;
grant execute on function public.is_household_member(uuid)    to authenticated;
