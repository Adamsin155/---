-- Stage 5: the whole package year (docs/plan/system-plan.md, stage 5; section 4,
-- stations 7–8; decisions 31 and 33).
--  1. Protocol versions per client: clients.protocol_version is the protocol version
--     the client started under. The database stamps it at insert (the browser never
--     chooses it) and keeps it on update; items added in a later version never make
--     an older client late (app/protocol-versions.js).
--  2. public.client_month_marks: the monthly cycle's marks (a draft, decision 31),
--     one row per client, month of the package and item (app/year-logic.js).
-- Safe to run again.

-- ── 1. Protocol versions ─────────────────────
-- The current protocol version: PROTOCOL_VERSION in app/protocol.js. Raise it, and
-- the column's default below, together with it (tests/sql/year.test.mjs checks all three).
create or replace function private.protocol_version_current() returns integer
language sql immutable set search_path = '' as $$ select 5 $$;
revoke all on function private.protocol_version_current() from public, anon, authenticated;

-- The column existed since 20260929120000 with a default of 1 that nothing set:
-- every row reads 1. The clients that exist now started under versions 1 to 4, by
-- when they were created against when each version reached the main branch
-- (v2 13:27, v3 14:04, v4 16:00 UTC on 29.9). Version 5 is the first one these
-- stamps follow, so no existing client is read as 5. Every client added after this
-- migration is stamped (5 or more), so running it again changes nothing.
alter table public.clients drop constraint if exists clients_protocol_version_check;
update public.clients set protocol_version = case
    when created_at < '2026-09-29 13:27:55+00' then 1
    when created_at < '2026-09-29 14:04:17+00' then 2
    when created_at < '2026-09-29 16:00:54+00' then 3
    else 4 end
  where protocol_version = 1;
alter table public.clients alter column protocol_version set default 5;
alter table public.clients add constraint clients_protocol_version_check check (protocol_version between 1 and 1000);

-- A signed-in session (the browser, or the signing page opening a client) never
-- chooses the version: a new client starts under the current one, and the version
-- stays what it was. Only the SQL editor or the service role (no session) may set it.
create or replace function public.clients_protocol_version() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  session boolean := coalesce(auth.jwt() ->> 'role', '') in ('authenticated', 'anon');
begin
  if tg_op = 'INSERT' then
    if session or new.protocol_version is null then
      new.protocol_version := private.protocol_version_current();
    end if;
  elsif session then
    new.protocol_version := old.protocol_version;
  end if;
  return new;
end $$;
revoke execute on function public.clients_protocol_version() from public, anon, authenticated;

drop trigger if exists clients_protocol_version on public.clients;
create trigger clients_protocol_version before insert or update on public.clients
for each row execute function public.clients_protocol_version();

-- ── 2. The monthly cycle's marks ─────────────
-- One row per client, month of the package (2 = the second month) and item: 'plan',
-- 'posted', 'report', 'photo', 'photoshot', or a spread item with its number
-- ('ch14.1', 'collab.2', 'story.1', 'round.1'); app/year-logic.js MARK_ITEM.
-- Who and when come from the session (public.protocol_stamp). Unmarking deletes it.
create table if not exists public.client_month_marks (
  client_id uuid not null references public.clients (id) on delete cascade,
  month smallint not null check (month between 1 and 120),
  item text not null check (length(item) <= 24 and item ~ '^[a-z][a-z0-9]*(\.[0-9]{1,2})?$'),
  state text not null check (state in ('done', 'na')),
  note text check (note is null or length(note) <= 500),
  by_email text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  at timestamptz not null default now(),
  primary key (client_id, month, item)
);
create index if not exists client_month_marks_at_idx on public.client_month_marks (at desc);

drop trigger if exists client_month_marks_stamp on public.client_month_marks;
create trigger client_month_marks_stamp before insert or update on public.client_month_marks
for each row execute function public.protocol_stamp();

-- The cycle's items all belong to the office (Irit, Lior, Ofir, Ilai) and the owner.
alter table public.client_month_marks enable row level security;
drop policy if exists "office manages month marks" on public.client_month_marks;
create policy "office manages month marks" on public.client_month_marks
  for all to authenticated
  using ((select public.is_office())) with check ((select public.is_office()));
revoke all on public.client_month_marks from anon;
revoke truncate on public.client_month_marks from authenticated;
