-- "תשלומי לקוחות" (the owner's request of 11.11.2026; docs/ops.md, section 130).
-- How each client pays, as the old CRM kept it on every deal: the deal amount, the monthly
-- retainer, the payment method (פיימנט / שיקים / העברה בנקאית / כרטיס אשראי), the number of
-- cheques and the first cheque's date. One row per deal: a client that renewed has several,
-- and the screen (payments.html) shows the latest on the list and the older ones under it.
--   private.can_read_client_payments()  the owners (Idan and Adam: public.staff.person is
--                                       null, private.is_owner()) and Ofir. ONE place.
--   private.can_write_client_payments() the owners only.
--   public.client_payments               one row per deal. Reading: the owners and Ofir.
--                                       Writing (insert, update): the owners only.
-- Nobody deletes a row from the browser (no delete grant, no policy): a wrong row is corrected.
-- Who wrote a row and when are the table's (defaults and a trigger), never the caller's; the
-- source is 'manual' for every row written from the browser, and 'old_crm' only for the
-- import that runs as the database owner (supabase/pending/client_payments_import.sql).
-- Ofir's read here is this table only: nothing of the payouts system (public.payout_*,
-- private.is_payout_owner()) is touched or widened.
-- Only adds. Every statement can run again safely; nothing is dropped except this table's own
-- policies and trigger, each recreated in the next statement. Tested in
-- tests/sql/client-payments.test.mjs.

create or replace function private.can_read_client_payments() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.is_owner() or public.my_person() = 'ofir', false);
$$;
revoke all on function private.can_read_client_payments() from public, anon;
grant execute on function private.can_read_client_payments() to authenticated;
-- Who writes: the owners only (private.is_owner() itself is not callable from a policy).
create or replace function private.can_write_client_payments() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.is_owner(), false);
$$;
revoke all on function private.can_write_client_payments() from public, anon;
grant execute on function private.can_write_client_payments() to authenticated;

create table if not exists public.client_payments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  -- Shekels. Empty is "לא הוזן".
  amount numeric(12, 2) check (amount between 0 and 10000000),
  retainer numeric(12, 2) check (retainer between 0 and 10000000),
  -- payment = פיימנט (the payment processor), checks = שיקים, transfer = העברה בנקאית, card = כרטיס אשראי.
  method text check (method in ('payment', 'checks', 'transfer', 'card')),
  checks_count smallint check (checks_count between 1 and 60),
  first_check_date date,
  deal_date date,
  package text check (length(package) <= 200),
  note text check (length(note) <= 500),
  source text not null default 'manual' check (source in ('old_crm', 'manual')),
  -- The deal's id in the old CRM, for an import that can run twice (null for a manual row).
  old_crm_deal_id text unique,
  by_email text default lower(auth.jwt() ->> 'email'),
  at timestamptz not null default now(),
  -- The cheques' details belong to a cheques deal only.
  constraint client_payments_checks_only check (method = 'checks' or (checks_count is null and first_check_date is null))
);
create index if not exists client_payments_client_idx on public.client_payments (client_id, deal_date desc nulls last, at desc);

-- Who wrote the row and when: stamped on every insert and update from the browser. A row
-- written from the browser is 'manual'; an update keeps the row's source and old CRM id.
create or replace function private.client_payments_stamp() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  who text := lower(nullif(auth.jwt() ->> 'email', ''));
begin
  if who is not null then
    new.by_email := who;
    new.at := now();
    if tg_op = 'INSERT' then
      new.source := 'manual';
      new.old_crm_deal_id := null;
    end if;
  end if;
  if tg_op = 'UPDATE' then
    new.source := old.source;
    new.old_crm_deal_id := old.old_crm_deal_id;
    new.client_id := old.client_id;
  end if;
  return new;
end $$;
revoke all on function private.client_payments_stamp() from public, anon, authenticated;
drop trigger if exists client_payments_stamp on public.client_payments;
create trigger client_payments_stamp before insert or update on public.client_payments
  for each row execute function private.client_payments_stamp();

alter table public.client_payments enable row level security;
drop policy if exists "client payments: owners and ofir read" on public.client_payments;
create policy "client payments: owners and ofir read" on public.client_payments
  for select to authenticated
  using (private.can_read_client_payments());
drop policy if exists "client payments: owners add" on public.client_payments;
create policy "client payments: owners add" on public.client_payments
  for insert to authenticated
  with check (private.can_write_client_payments());
drop policy if exists "client payments: owners correct" on public.client_payments;
create policy "client payments: owners correct" on public.client_payments
  for update to authenticated
  using (private.can_write_client_payments())
  with check (private.can_write_client_payments());

-- The browser writes the deal's details only; no delete.
revoke all on public.client_payments from public, anon, authenticated;
grant select on public.client_payments to authenticated;
grant insert (client_id, amount, retainer, method, checks_count, first_check_date, deal_date, package, note) on public.client_payments to authenticated;
grant update (amount, retainer, method, checks_count, first_check_date, deal_date, package, note) on public.client_payments to authenticated;
