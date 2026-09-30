-- Stage 3 (part 2): the characterization, the content and the days before a
-- shoot (docs/plan/system-plan.md, section 3: Ofir finishing a characterization,
-- Lior's 12א/12/13, Irit's shoot-day coordinator, blockers, day-before check and
-- client requests; section 4, stations 2–4; decisions 12, 14, 15).
--
--   - characterizations: the characterization as content, one row per client
--     (until now it was only a list of checks). Written by the office (the
--     characterizer is Ofir or Lior); read by whoever sees the client, so the
--     editor assigned to it has the business phone and the logo link.
--   - content_briefs: the answers of Lior's focus call (12א), one row per client
--     and shoot round. Read the same way: the editors, Ofir in quality control and
--     Nirel see them.
--   - client_tasks.source: 'request' (a client's request, Irit's section 17) and
--     'tell' (the task that tells Irit to update the client once a request task
--     is done; opened by the trigger below, so it happens whichever screen closes it).
--   - protocol_checks: "the client approved the scripts" (13) can never be marked
--     "not relevant" (it was already never a prerequisite when not relevant).
-- The event "the characterization ended" is a protocol mark (p04.ended), like the
-- other marks, so the reminder engine reads it with the checks.
-- Who and when always come from the session (auth.jwt()), never from the browser.
-- Tested in a real Postgres with every migration: tests/sql/intake.test.mjs.

-- ── The characterization as content ─────────
create table if not exists public.characterizations (
  client_id uuid primary key references public.clients (id) on delete cascade,
  fields jsonb not null default '{}'::jsonb
    check (jsonb_typeof(fields) = 'object' and length(fields::text) <= 20000),
  completed_at timestamptz,
  completed_by text,
  by_email text not null default '',
  at timestamptz not null default now()
);

-- Who saved last and when; when the form was first completed and by whom (a later
-- edit keeps the first completion; clearing it is allowed, e.g. a field emptied).
create or replace function public.characterizations_stamp() returns trigger
language plpgsql set search_path = '' as $$
declare me text := coalesce(nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''), 'system');
begin
  new.by_email := me;
  new.at := now();
  if new.completed_at is null then
    new.completed_by := null;
  elsif tg_op = 'INSERT' or old.completed_at is null then
    new.completed_at := now();
    new.completed_by := me;
  else
    new.completed_at := old.completed_at;
    new.completed_by := old.completed_by;
  end if;
  return new;
end $$;
revoke execute on function public.characterizations_stamp() from public, anon, authenticated;
drop trigger if exists characterizations_stamp on public.characterizations;
create trigger characterizations_stamp before insert or update on public.characterizations
for each row execute function public.characterizations_stamp();

-- ── The focus call's answers (12א) ─────────
create table if not exists public.content_briefs (
  client_id uuid not null references public.clients (id) on delete cascade,
  round integer not null default 1 check (round between 1 and 50),
  fields jsonb not null default '{}'::jsonb
    check (jsonb_typeof(fields) = 'object' and length(fields::text) <= 20000),
  by_email text not null default '',
  at timestamptz not null default now(),
  primary key (client_id, round)
);
drop trigger if exists content_briefs_stamp on public.content_briefs;
create trigger content_briefs_stamp before insert or update on public.content_briefs
for each row execute function public.protocol_stamp();

-- ── Who reads and writes them ───────────────
-- Read: whoever may see the client (the office, the assigned editor, Nirel on a
-- Natali client, Eli around a shoot day). Written: the office only. Never deleted
-- from the browser (the client's removal takes them with it).
alter table public.characterizations enable row level security;
alter table public.content_briefs enable row level security;

drop policy if exists "characterizations of visible clients" on public.characterizations;
create policy "characterizations of visible clients" on public.characterizations
  for select to authenticated using ((select public.is_office()) or client_id in (select private.my_clients()));
drop policy if exists "office adds characterizations" on public.characterizations;
create policy "office adds characterizations" on public.characterizations
  for insert to authenticated with check ((select public.is_office()));
drop policy if exists "office edits characterizations" on public.characterizations;
create policy "office edits characterizations" on public.characterizations
  for update to authenticated using ((select public.is_office())) with check ((select public.is_office()));

drop policy if exists "briefs of visible clients" on public.content_briefs;
create policy "briefs of visible clients" on public.content_briefs
  for select to authenticated using ((select public.is_office()) or client_id in (select private.my_clients()));
drop policy if exists "office adds briefs" on public.content_briefs;
create policy "office adds briefs" on public.content_briefs
  for insert to authenticated with check ((select public.is_office()));
drop policy if exists "office edits briefs" on public.content_briefs;
create policy "office edits briefs" on public.content_briefs
  for update to authenticated using ((select public.is_office())) with check ((select public.is_office()));

revoke all on public.characterizations, public.content_briefs from anon;
revoke delete, truncate on public.characterizations, public.content_briefs from authenticated;
grant select, insert, update on public.characterizations, public.content_briefs to authenticated;

-- ── Task sources: a client's request, and telling the client ──
-- The allowed sources are rebuilt from the constraint as it stands, plus these two,
-- so the values other migrations added (merged before this one) are kept.
do $$
declare
  def text;
  vals text[];
begin
  select pg_get_constraintdef(c.oid) into def
  from pg_constraint c where c.conname = 'client_tasks_source_check' and c.conrelid = 'public.client_tasks'::regclass;
  select coalesce(array_agg(m[1]), '{}') into vals from regexp_matches(coalesce(def, ''), '''([^'']+)''', 'g') as m;
  select array_agg(distinct v order by v) into vals from unnest(vals || array['p31', 'p33', 'escalation', 'status', 'request', 'tell']) as v;
  alter table public.client_tasks drop constraint if exists client_tasks_source_check;
  execute format('alter table public.client_tasks add constraint client_tasks_source_check check (source is null or source = any (array[%s]::text[]))',
    (select string_agg(quote_literal(v), ', ') from unnest(vals) as v));
end $$;

-- A client's request is done: Irit gets a task to update the client (with a ready
-- message in the app), due today in Israel. Once per request while her task is open
-- (only her own open task on that client counts: someone else's cannot stop it).
create or replace function public.client_requests_tell() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.source = 'request' and new.done_at is not null and old.done_at is null
     and not exists (select 1 from public.client_tasks t
                     where t.source = 'tell' and t.owner = 'irit' and t.client_id = new.client_id
                       and t.done_at is null and t.brief ->> 'of' = new.id::text) then
    insert into public.client_tasks (client_id, title, owner, due_on, source, brief)
    values (new.client_id, left('לעדכן את הלקוח: ' || new.title, 500), 'irit',
            (now() at time zone 'Asia/Jerusalem')::date, 'tell',
            jsonb_build_object('of', new.id, 'request', left(new.title, 500), 'owner', new.owner, 'done_by', new.done_by_email));
  end if;
  return new;
end $$;
revoke execute on function public.client_requests_tell() from public, anon, authenticated;
drop trigger if exists client_requests_tell on public.client_tasks;
create trigger client_requests_tell after update on public.client_tasks
for each row execute function public.client_requests_tell();

-- ── The client's approval of the scripts is always a real approval ──
-- (NOT VALID: rows from before are left as they are; every new write is checked.)
alter table public.protocol_checks drop constraint if exists protocol_checks_scripts_approval_real;
alter table public.protocol_checks add constraint protocol_checks_scripts_approval_real
  check (not (state = 'na' and item_key ~ '^(r[0-9]+\.)?p13\.approved$')) not valid;
