-- Graphics tasks that close by themselves (the owner, 17.11.2026: "כן לכל השלוש"; docs/ops.md,
-- section 138; the rules are app/gfx-auto-logic.js, the work is the edge function gfx-auto).
-- A task given on the spot ("נודניק", public.staff_tasks) to a graphics person (Ilai, Nirel:
-- GRAPHICS_PEOPLE in app/protocol.js) about a client's graphics closes when the work shows: new
-- graphics in the client's Drive (public.drive_daily) or in its Gantt (public.client_gantt). A
-- fix task is checked by Claude against its notes (public.gfx_ai_checks).
--
--   staff_tasks: gfx_kind, gfx_count   the giver's optional choice (stage 2): להכין / לתקן / לתזמן
--                                      ('make' / 'fix' / 'schedule') and how many graphics. Carried
--                                      in the brief of public.staff_task_create_brief (no new
--                                      function for the app or the MCP gate to know).
--                gfx_base              graphics files in the client's Drive on the day the task was
--                                      given, at that moment (the trigger below): drive_daily counts
--                                      per day without the hour, so only what is above it that day
--                                      is new.
--                gfx_done              the progress the function last counted ("4 מתוך 10").
--                auto_note             the line of a task the system closed ("נסגר אוטומטית: …");
--                                      done_by_email is 'system:auto'.
--                auto_reopened_at, auto_reopen_base   "לפתוח מחדש" of a task the system closed:
--                                      from then on only something newer closes it again.
--   client_gantt.live_at               when a row became scheduled or posted (the trigger below):
--                                      a post that was scheduled before a task and published after
--                                      it is not new work.
--   public.staff_task_auto_close(id, note, done)   the function's (service role) only way to close.
--   public.staff_task_gfx_progress(id, done)       the progress, written by the function.
--   public.staff_task_reopen(id)       now also the assignee and the managers, for a task the
--                                      system closed (the rest as before: the giver or the owner).
--   public.gfx_ai_checks               every check Claude made of a fix task (as contract_ai_runs):
--                                      which files, what it said per note; each file once.
--   public.gfx_auto_tick()             pg_cron, hourly in the day: the function gfx-auto with the
--                                      cron secret from Vault (as public.drive_scan_tick).
--
-- Only adds: columns, a table, functions, two triggers and a cron job; three functions replaced
-- in place with the same signatures (staff_task_create_brief: its latest definition,
-- 20261214100000_amit.sql, with the gfx fields added; staff_task_reopen; nothing else changes in
-- them). No row is changed by this file. Safe to run again. Tested with every migration in a real
-- Postgres: tests/sql/gfx-auto.test.mjs.
-- Not run: waits for the owner's "מאשר להריץ את ה-SQL".

-- ── 1. The columns ────────────────────────
alter table public.staff_tasks
  add column if not exists gfx_kind text,
  add column if not exists gfx_count smallint,
  add column if not exists gfx_base integer,
  add column if not exists gfx_done integer,
  add column if not exists auto_note text,
  add column if not exists auto_reopened_at timestamptz,
  add column if not exists auto_reopen_base integer;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'staff_tasks_gfx_check') then
    alter table public.staff_tasks add constraint staff_tasks_gfx_check check (
      (gfx_kind is null or gfx_kind in ('make', 'fix', 'schedule'))
      and (gfx_count is null or gfx_count between 1 and 200)
      and (gfx_done is null or gfx_done >= 0)
      and (auto_note is null or length(auto_note) <= 300));
  end if;
end $$;

alter table public.client_gantt add column if not exists live_at timestamptz;

-- ── 2. Graphics files in a client's Drive on one Israel day (not the highlight covers) ──
create or replace function private.gfx_drive_day(p_client uuid, p_at timestamptz) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(d.files), 0)::integer from public.drive_daily d
  where d.client_id = p_client and d.kind = 'graphic' and d.folder !~ 'היילייט'
    and d.day = (p_at at time zone 'Asia/Jerusalem')::date;
$$;
revoke all on function private.gfx_drive_day(uuid, timestamptz) from public, anon, authenticated;

-- A task on a client: what is already in its Drive that day, when it is given.
create or replace function public.staff_tasks_gfx_base() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.gfx_base := case when new.client_id is null then null else private.gfx_drive_day(new.client_id, coalesce(new.created_at, now())) end;
  return new;
end $$;
revoke all on function public.staff_tasks_gfx_base() from public, anon, authenticated;
drop trigger if exists staff_tasks_gfx_base on public.staff_tasks;
create trigger staff_tasks_gfx_base before insert on public.staff_tasks
for each row execute function public.staff_tasks_gfx_base();

-- When a Gantt row became scheduled or posted. Named to run after client_gantt_rules and
-- client_gantt_stamp (a BEFORE trigger runs in name order), so it sees the state they left.
-- Nobody writes it by hand: an update keeps the stamp it had while the row stays scheduled/posted.
create or replace function public.client_gantt_live_at() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.state in ('scheduled', 'posted') then
    if tg_op = 'INSERT' or old.state not in ('scheduled', 'posted') then
      new.live_at := now();
    else
      new.live_at := old.live_at;
    end if;
  else
    new.live_at := null;
  end if;
  return new;
end $$;
revoke all on function public.client_gantt_live_at() from public, anon, authenticated;
drop trigger if exists client_gantt_zz_live_at on public.client_gantt;
create trigger client_gantt_zz_live_at before insert or update on public.client_gantt
for each row execute function public.client_gantt_live_at();

-- ── 3. Giving a task: the gfx choice, carried in the brief ──
-- staff_task_create_brief(text,text,uuid,jsonb): 20261214100000_amit.sql, with p_brief's
-- gfx_kind ('make' / 'fix' / 'schedule') and gfx_count (1–200) kept in their own columns. Only for
-- a graphics person (Ilai, Nirel) and a task on a client; a fix task has no number.
create or replace function public.staff_task_create_brief(p_assignee text, p_body text, p_client uuid DEFAULT NULL::uuid, p_brief jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  me text := public.reminder_person();
  mail text := lower(coalesce(auth.jwt() ->> 'email', ''));
  txt text := btrim(coalesce(p_body, ''));
  cname text;
  rid uuid;
  v_brief jsonb;
  k text;
  v_kind text;
  v_count integer;
begin
  if me is null or not public.can_give_staff_tasks() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_assignee is null or p_assignee not in ('owner', 'irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli', 'amit', 'stav', 'amos') then
    raise exception 'unknown assignee' using errcode = '22023';
  end if;
  if not exists (select 1 from public.staff s where coalesce(s.person, 'owner') = p_assignee) then
    raise exception 'the assignee has no login' using errcode = '22023';
  end if;
  if length(txt) < 1 or length(txt) > 500 then raise exception 'the task text is required (up to 500 characters)' using errcode = '22023'; end if;
  if p_brief is not null and jsonb_typeof(p_brief) <> 'object' then raise exception 'invalid brief' using errcode = '22023'; end if;
  -- Only the brief's own fields are kept, trimmed; an empty one is left out.
  select jsonb_object_agg(f.key, left(btrim(p_brief ->> f.key), 500)) into v_brief
  from unnest(array['problem', 'disliked', 'change', 'keep', 'result', 'materials']) as f (key)
  where btrim(coalesce(p_brief ->> f.key, '')) <> '';
  if p_assignee = 'nirel' then
    foreach k in array array['problem', 'change', 'keep', 'result'] loop
      if coalesce(v_brief ->> k, '') = '' then raise exception 'a task for Nirel needs the full brief' using errcode = '22023'; end if;
    end loop;
  end if;
  -- The graphics choice (17.11.2026): optional, for a graphics person on a client only.
  v_kind := nullif(btrim(coalesce(p_brief ->> 'gfx_kind', '')), '');
  if coalesce(p_brief ->> 'gfx_count', '') <> '' then
    if (p_brief ->> 'gfx_count') !~ '^[0-9]{1,3}$' then raise exception 'invalid graphics count' using errcode = '22023'; end if;
    v_count := (p_brief ->> 'gfx_count')::integer;
    if v_count < 1 or v_count > 200 then raise exception 'invalid graphics count' using errcode = '22023'; end if;
    v_kind := coalesce(v_kind, 'make');
  end if;
  if v_kind is not null then
    if v_kind not in ('make', 'fix', 'schedule') then raise exception 'invalid graphics kind' using errcode = '22023'; end if;
    if p_assignee not in ('ilai', 'nirel') or p_client is null then
      raise exception 'a graphics kind needs a graphics person and a client' using errcode = '22023';
    end if;
    if v_kind = 'fix' then v_count := null; end if;
  end if;
  if p_client is not null then
    select left(case
             when coalesce(btrim(c.business), '') = '' or btrim(c.business) = btrim(c.name) then btrim(c.name)
             when btrim(c.name) = '' then btrim(c.business)
             else btrim(c.business) || ' · ' || btrim(c.name) end, 250)
      into cname from public.clients c where c.id = p_client;
    if not found then raise exception 'client not found' using errcode = 'P0002'; end if;
  end if;
  insert into public.staff_tasks (created_by, created_by_email, assignee, body, client_id, client_name, brief, gfx_kind, gfx_count)
  values (me, mail, p_assignee, txt, p_client, cname, v_brief, v_kind, v_count)
  returning id into rid;
  return rid;
end $$;
revoke all on function public.staff_task_create_brief(text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.staff_task_create_brief(text, text, uuid, jsonb) to authenticated;

-- ── 4. The system closes a task (the function gfx-auto, with the service role) ──
-- Only an open task. Its reminders stop (rule `nag` rings open tasks), the unread ones are read,
-- and the giver's "<assignee> סימן/ה ״בוצע״" (rule `nagDone`) is written as handled: the rule
-- `gfxAuto` tells both of them what the system saw instead. → true when it closed it.
create or replace function public.staff_task_auto_close(p_id uuid, p_note text, p_done integer default null) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  t public.staff_tasks;
begin
  if coalesce(btrim(p_note), '') = '' then raise exception 'the note is required' using errcode = '22023'; end if;
  update public.staff_tasks
     set status = 'done', done_at = now(), done_by_email = 'system:auto', auto_note = left(btrim(p_note), 300),
         gfx_done = coalesce(p_done, gfx_done)
   where id = p_id and status = 'open'
  returning * into t;
  if not found then return false; end if;
  update public.reminder_log set read_at = now()
  where person = t.assignee and rule = 'nag' and read_at is null and key like 'nag:-:' || p_id::text || ':%';
  if t.created_by <> t.assignee then
    insert into public.reminder_log (key, rule, person, level, channel, status, reason, title, due_at, sent_at, read_at)
    values ('nagDone:-:' || p_id::text || ':done@' || t.created_by, 'nagDone', t.created_by, 'quiet', 'app', 'suppressed',
      'closed by the system (gfxAuto tells)', left('נסגר אוטומטית: ' || t.body, 300), now(), null, now())
    on conflict (key) do nothing;
  end if;
  return true;
end $$;
revoke all on function public.staff_task_auto_close(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.staff_task_auto_close(uuid, text, integer) to service_role;

create or replace function public.staff_task_gfx_progress(p_id uuid, p_done integer) returns void
language sql security definer set search_path = '' as $$
  update public.staff_tasks set gfx_done = greatest(coalesce(p_done, 0), 0)
  where id = p_id and status = 'open' and gfx_done is distinct from greatest(coalesce(p_done, 0), 0);
$$;
revoke all on function public.staff_task_gfx_progress(uuid, integer) from public, anon, authenticated;
grant execute on function public.staff_task_gfx_progress(uuid, integer) to service_role;

-- ── 5. "לפתוח מחדש" ───────────────────────
-- 20261209100000_staff_task_reopen.sql, and: a task the system closed (done_by_email
-- 'system:auto') is reopened also by its assignee and by the managers (public.is_manager(): the
-- owners, Irit, Ofir, Lior). Reopening it stamps the moment and the Drive's count that day, so
-- the system closes it again only on something newer (app/gfx-auto-logic.js judge).
create or replace function public.staff_task_reopen(p_id uuid) returns public.staff_tasks
language plpgsql security definer set search_path = '' as $$
declare
  me text := public.reminder_person();
  t public.staff_tasks;
  v_auto boolean;
begin
  if me is null then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into t from public.staff_tasks where id = p_id for update;
  v_auto := found and t.status = 'done' and t.done_by_email = 'system:auto';
  if not found or (t.created_by <> me and me <> 'owner' and not (v_auto and (t.assignee = me or public.is_manager()))) then
    raise exception 'task not found' using errcode = 'P0002';
  end if;
  if not (me = 'owner' or (t.created_by = me and public.can_give_staff_tasks()) or (v_auto and (t.assignee = me or public.is_manager()))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if t.status <> 'done' then raise exception 'this task is not done' using errcode = '22023'; end if;
  if v_auto then
    update public.staff_tasks set status = 'open', done_at = null, done_by_email = null, auto_note = null,
      auto_reopened_at = now(),
      auto_reopen_base = case when client_id is null then null else private.gfx_drive_day(client_id, now()) end
    where id = p_id returning * into t;
  else
    update public.staff_tasks set status = 'open', done_at = null, done_by_email = null
    where id = p_id returning * into t;
  end if;
  return t;
end $$;
revoke all on function public.staff_task_reopen(uuid) from public, anon, authenticated;
grant execute on function public.staff_task_reopen(uuid) to authenticated;

-- ── 6. Claude's checks of a fix task (stage 3) ──
create table if not exists public.gfx_ai_checks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.staff_tasks (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- the Drive file ids sent (each file is checked once), and how many
  files text[] not null default '{}' check (cardinality(files) <= 50),
  -- 'done' (every note fixed: the task closed), 'missing' (a note is not fixed: the assignee is
  -- told), 'unclear' (nothing missing, but not all could be told: left open, nobody told),
  -- 'error' (the call failed; the files are checked again on a later run)
  status text not null check (status in ('done', 'missing', 'unclear', 'error')),
  -- [{ note, verdict: 'done' | 'not_done' | 'cant_tell', why }] or { error }
  result jsonb,
  model text check (model is null or length(model) <= 80)
);
create index if not exists gfx_ai_checks_task_idx on public.gfx_ai_checks (task_id, created_at desc);
create index if not exists gfx_ai_checks_created_idx on public.gfx_ai_checks (created_at);
alter table public.gfx_ai_checks enable row level security;
revoke all on table public.gfx_ai_checks from public, anon, authenticated;
grant select on table public.gfx_ai_checks to authenticated;
grant select, insert on table public.gfx_ai_checks to service_role;
drop policy if exists "managers read gfx checks" on public.gfx_ai_checks;
create policy "managers read gfx checks" on public.gfx_ai_checks
  for select to authenticated using ((select public.is_manager()));

-- ── 7. The hourly run ─────────────────────
create or replace function public.gfx_auto_tick() returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  secret text;
  request bigint;
begin
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'reminders_cron_secret' limit 1;
  if coalesce(secret, '') = '' then
    raise notice 'gfx_auto_tick: no reminders_cron_secret in Vault, nothing called';
    return null;
  end if;
  select net.http_post(
    url := 'https://czncjzziqrqtezpwxxpz.supabase.co/functions/v1/gfx-auto',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 58000
  ) into request;
  return request;
end $$;
revoke execute on function public.gfx_auto_tick() from public, anon, authenticated, service_role;

-- Every hour at :25, 05:25–18:25 UTC (07:25–20:25 in Israel in winter), after the Drive scan and
-- the Metricool sync of that hour. cron.schedule replaces a job of the same name.
select cron.schedule('gfx-auto', '25 5-18 * * *', 'select public.gfx_auto_tick()');
