-- Stage 3, part 2: the office's flows (docs/plan/system-plan.md, section 3: Ofir,
-- Lior and Ilai; decisions 7–24). Most events are protocol marks (app/office-marks.js:
-- a return for fixes and its fixes, the reason an editor was chosen, moved editing
-- deadlines, a broken login closed), which need nothing new here except room for a
-- return's list of issues. New here:
--   office_passes    Ofir's pass over the clients (process 33): who was gone over,
--                    and a snapshot for "what changed since the last pass". Office only.
--   task_decisions   Lior's fixed path for an exception reported to him: reason,
--                    decision, the linked next-action task. Read with the client.
--   change_requests  "בקשת שינוי" (Ofir's protocol, stage 13): the problem, why it
--                    hurts, the proposal; Lior's decision. Office only.
--   office_reviews   kind 'campaigns': Lior's weekly campaign check (decision 21).
-- Every table: row level security with public.is_office() / public.can_see_client(),
-- who and when stamped from the session (auth.jwt()), nothing deleted from the browser.
-- Safe to run again. Tested in a real Postgres: tests/sql/office-flows.test.mjs.

-- ── A return's issues fit in its check ───────
-- Up to 30 issues of 200 characters (app/office-marks.js ISSUE_MAX, ISSUE_TEXT_MAX).
alter table public.protocol_checks drop constraint if exists protocol_checks_note_check;
alter table public.protocol_checks add constraint protocol_checks_note_check
  check (note is null or length(note) <= 8000);

-- ── The weekly campaign check ────────────────
alter table public.office_reviews drop constraint if exists office_reviews_kind_check;
alter table public.office_reviews add constraint office_reviews_kind_check
  check (kind in ('p32', 'p33', 'campaigns'));

-- ── Ofir's pass over the clients (33) ────────
create table if not exists public.office_passes (
  day date primary key,
  -- clientId -> { how: 'seen' | 'task' | 'rest', at, task }
  seen jsonb not null default '{}'::jsonb check (jsonb_typeof(seen) = 'object'),
  -- clientId -> { c: colour, r: [reason codes], s: station }, when the pass was completed
  snapshot jsonb check (snapshot is null or jsonb_typeof(snapshot) = 'object'),
  completed_at timestamptz,
  by_email text not null default '',
  at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz
);

create or replace function public.office_passes_stamp() returns trigger
language plpgsql set search_path = '' as $$
declare me text := coalesce(nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''), 'system');
begin
  if tg_op = 'INSERT' then
    new.by_email := me;
    new.at := now();
    new.updated_by := null;
    new.updated_at := null;
    new.completed_at := case when new.completed_at is null then null else now() end;
  else
    new.by_email := old.by_email;
    new.at := old.at;
    new.updated_by := me;
    new.updated_at := now();
    -- Completed once: the first completion's time stays.
    new.completed_at := case when old.completed_at is not null then old.completed_at
                             when new.completed_at is null then null else now() end;
  end if;
  return new;
end $$;
revoke execute on function public.office_passes_stamp() from public, anon, authenticated;
drop trigger if exists office_passes_stamp on public.office_passes;
create trigger office_passes_stamp before insert or update on public.office_passes
for each row execute function public.office_passes_stamp();

alter table public.office_passes enable row level security;
drop policy if exists "office manages passes" on public.office_passes;
create policy "office manages passes" on public.office_passes
  for all to authenticated
  using ((select public.is_office())) with check ((select public.is_office()));
revoke all on public.office_passes from anon;
revoke delete, truncate on public.office_passes from authenticated;

-- ── Lior's decisions on exceptions ───────────
create table if not exists public.task_decisions (
  task_id uuid primary key references public.client_tasks (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  reason text check (reason is null or length(reason) <= 1000),
  decision text check (decision is null or length(decision) <= 1000),
  next_task_id uuid references public.client_tasks (id) on delete set null,
  by_email text not null default '',
  at timestamptz not null default now()
);
create index if not exists task_decisions_client_idx on public.task_decisions (client_id);

-- Who wrote it last and when (the same stamp as the protocol checks).
drop trigger if exists task_decisions_stamp on public.task_decisions;
create trigger task_decisions_stamp before insert or update on public.task_decisions
for each row execute function public.protocol_stamp();

-- The decision belongs to its exception's client, and so does the linked task
-- (security definer: it reads the tasks whatever the writer may see; the policies
-- below still decide who writes).
create or replace function public.task_decisions_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.client_tasks t where t.id = new.task_id and t.client_id = new.client_id) then
    raise exception 'not allowed: the decision and the exception belong to different clients';
  end if;
  if new.next_task_id is not null and not exists (
    select 1 from public.client_tasks t where t.id = new.next_task_id and t.client_id = new.client_id) then
    raise exception 'not allowed: the next action belongs to another client';
  end if;
  return new;
end $$;
revoke execute on function public.task_decisions_check() from public, anon, authenticated;
drop trigger if exists task_decisions_check on public.task_decisions;
create trigger task_decisions_check before insert or update on public.task_decisions
for each row execute function public.task_decisions_check();

alter table public.task_decisions enable row level security;
-- Read with the client (whoever reported the exception sees what was decided); written by the office.
drop policy if exists "decisions of own clients" on public.task_decisions;
create policy "decisions of own clients" on public.task_decisions
  for select to authenticated
  using ((select public.is_office()) or public.can_see_client(client_id));
drop policy if exists "office decides" on public.task_decisions;
create policy "office decides" on public.task_decisions
  for insert to authenticated
  with check ((select public.is_office()));
drop policy if exists "office updates decisions" on public.task_decisions;
create policy "office updates decisions" on public.task_decisions
  for update to authenticated
  using ((select public.is_office())) with check ((select public.is_office()));
revoke all on public.task_decisions from anon;
revoke delete, truncate on public.task_decisions from authenticated;

-- ── Change requests (Ofir → Lior) ────────────
create table if not exists public.change_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients (id) on delete set null,
  problem text not null check (length(btrim(problem)) between 1 and 1000),
  why text not null check (length(btrim(why)) between 1 and 1000),
  proposal text not null check (length(btrim(proposal)) between 1 and 1000),
  created_by_email text not null default '',
  created_at timestamptz not null default now(),
  decision text check (decision is null or length(decision) <= 1000),
  decided_by_email text,
  decided_at timestamptz
);
create index if not exists change_requests_open_idx on public.change_requests (created_at desc) where decided_at is null;

create or replace function public.change_requests_stamp() returns trigger
language plpgsql set search_path = '' as $$
declare me text := coalesce(nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''), 'system');
begin
  if tg_op = 'INSERT' then
    new.created_by_email := me;
    new.created_at := now();
    new.decided_by_email := case when nullif(btrim(new.decision), '') is null then null else me end;
    new.decided_at := case when nullif(btrim(new.decision), '') is null then null else now() end;
  else
    new.created_by_email := old.created_by_email;
    new.created_at := old.created_at;
    -- The request itself stays as written; the decision is stamped when it changes.
    new.problem := old.problem;
    new.why := old.why;
    new.proposal := old.proposal;
    new.client_id := old.client_id;
    if new.decision is distinct from old.decision then
      new.decided_by_email := case when nullif(btrim(new.decision), '') is null then null else me end;
      new.decided_at := case when nullif(btrim(new.decision), '') is null then null else now() end;
    else
      new.decided_by_email := old.decided_by_email;
      new.decided_at := old.decided_at;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.change_requests_stamp() from public, anon, authenticated;
drop trigger if exists change_requests_stamp on public.change_requests;
create trigger change_requests_stamp before insert or update on public.change_requests
for each row execute function public.change_requests_stamp();

alter table public.change_requests enable row level security;
drop policy if exists "office manages change requests" on public.change_requests;
create policy "office manages change requests" on public.change_requests
  for all to authenticated
  using ((select public.is_office()))
  with check ((select public.is_office()) and (client_id is null or public.can_see_client(client_id)));
revoke all on public.change_requests from anon;
revoke delete, truncate on public.change_requests from authenticated;

-- ── Ofir's meetings, for the one waiting for his check ──
-- "אופיר באפיון, בקרה עד HH:MM" (decision 11): the editor does not see Ofir's other
-- clients, so the times alone (never a client) come from here, by the same rule as
-- app/office-marks.js ofirMeetings: from the meeting until he marked it done
-- (MEETING_DONE_KEYS: "האפיון הסתיים", p04.ended, or the form saved, p04.saved; the
-- earlier), at most four hours; not marked, two hours.
create or replace function public.ofir_meetings(p_since timestamptz)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.char_at,
         case when d.at is null then c.char_at + interval '2 hours'
              else least(d.at, c.char_at + interval '4 hours') end
  from public.clients c
  left join lateral (select min(s.at) as at from public.protocol_checks s
                     where s.client_id = c.id and s.item_key in ('p04.ended', 'p04.saved') and s.state = 'done' and s.at > c.char_at) d on true
  where public.is_staff() and c.char_at is not null and coalesce(c.characterizer, 'ofir') = 'ofir'
    and c.status in ('active', 'ending')
    and c.char_at >= p_since - interval '1 day' and c.char_at <= now() + interval '1 day'
  order by 1;
$$;
revoke execute on function public.ofir_meetings(timestamptz) from public, anon;
grant execute on function public.ofir_meetings(timestamptz) to authenticated;
