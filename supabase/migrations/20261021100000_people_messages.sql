-- What one person tells another reaches the phone (the owner's rule of 7.10.2026,
-- repeated on 8.10.2026; docs/ops.md, section 45). Almost all of it needs nothing
-- here: the reminders function reads the tables that already exist
-- (client_questions, change_requests, task_decisions, the protocol's marks) and
-- writes public.reminder_log, as it does for every other rule.
--
-- One thing was missing: a field agent's deal that the office marks "בוטל" has no
-- moment of its own (the status moves, and only who moved it is stamped), so the
-- reminders could not tell "cancelled just now" from "cancelled last month", and the
-- seller saw it only in his list. This file adds that moment:
--   deal_requests.cancelled_at   when the deal became 'cancelled'; empty again when it
--                                is opened again. Stamped by the database, whatever the
--                                browser sends (as every other stamp of the table).
-- Additive only: one column, one trigger function, one trigger. No row is changed and
-- nothing is removed. Deals that were cancelled before this file keep an empty moment,
-- so nobody is told now of an old cancellation.
-- Safe to run again. Tested in a real Postgres: tests/sql/people-messages.test.mjs.

alter table public.deal_requests add column if not exists cancelled_at timestamptz;

create or replace function public.deal_requests_cancelled_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.cancelled_at := null;
  elsif new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    new.cancelled_at := now();
  elsif new.status is distinct from 'cancelled' then
    new.cancelled_at := null;
  else
    new.cancelled_at := old.cancelled_at;
  end if;
  return new;
end $$;
-- Trigger functions are not an API: only the trigger calls them.
revoke execute on function public.deal_requests_cancelled_stamp() from public, anon, authenticated;

-- Named to run after deal_requests_stamp (triggers of one kind run in the order of
-- their names), which may still set the status of the row.
create or replace trigger deal_requests_zz_cancelled before insert or update on public.deal_requests
for each row execute function public.deal_requests_cancelled_stamp();

-- The reminders function looks for the deals cancelled lately every minute.
create index if not exists deal_requests_cancelled_idx on public.deal_requests (cancelled_at) where cancelled_at is not null;
