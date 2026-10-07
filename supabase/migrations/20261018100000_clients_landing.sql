-- "נחיתה": clients brought in from the old system are quiet until they are taken in
-- (the owner's decision of 7.10.2026). In the first day after 39 clients were imported
-- the reminders sent Lior 73 notices, Irit 41 and Ofir 33, almost all about work that
-- was done long ago and only never marked here. A client in landing is in the lists
-- and the cards as usual, and gets no reminder at all, until someone takes it in.
--
--   clients.landing       true: imported, not taken in yet. New clients are never in landing.
--   clients.landed_at/by  when it was taken in, and by whom.
--
-- The reminders function (supabase/functions/reminders/index.ts) leaves clients in
-- landing out of what it loads. This file only adds the columns; which clients are in
-- landing is set once, by hand, for the import of 6.10.2026 (docs/ops.md).
-- Safe to run again; nothing is removed.

alter table public.clients
  add column if not exists landing boolean not null default false,
  add column if not exists landed_at timestamptz,
  add column if not exists landed_by text;
-- Column grants (20260930210000_hardening.sql): a new column is readable only when granted.
grant select (landing, landed_at, landed_by) on public.clients to authenticated;
create index if not exists clients_landing_idx on public.clients (landing) where landing;
