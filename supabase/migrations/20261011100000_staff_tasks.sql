-- Tasks given on the spot (the owner's request of 6.10.2026; docs/ops.md, section 31).
-- Irit (and the owner) gives a task to anyone on the team. The reminder engine rings
-- the assignee at once and every 10 minutes, 09:00–20:00 on working days, until the
-- assignee marks it done (app/staff-tasks-logic.js; app/reminder-rules.js `nag`).
--   public.staff_tasks            one row per task: who gave it, to whom, what to do, an
--                                 optional client, and how it ended (done / cancelled).
--   public.can_give_staff_tasks() who gives them: the owner and Irit. ONE place: to let
--                                 Ofir or Lior give them too, add them to the list here
--                                 (and to GIVERS in app/staff-tasks-logic.js).
--   public.staff_task_create / staff_task_done / staff_task_cancel
--                                 the only ways to write. The browser cannot insert or
--                                 update the table: who gave a task and when it was done
--                                 are stamped here, never taken from the caller.
--   Reading (row level security): the assignee, whoever gave the task, and the owner.
-- The reminders' cron is not touched: it already runs every minute
-- (20260930110002_reminders_cron.sql), which is what a 10-minute repeat needs.
-- Every statement can run again safely. Nothing is dropped except this table's own
-- policy, which is recreated in the next statement. Tested with every migration in a
-- real Postgres: tests/sql/staff-tasks.test.mjs.

-- Who gives these tasks. The one list.
create or replace function public.can_give_staff_tasks() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.reminder_person() in ('owner', 'irit'), false);
$$;
revoke execute on function public.can_give_staff_tasks() from public, anon;
grant execute on function public.can_give_staff_tasks() to authenticated;

create table if not exists public.staff_tasks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by text not null check (created_by in ('owner', 'irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli', 'stav', 'amos')),
  created_by_email text not null check (created_by_email = lower(created_by_email)),
  -- Everyone on the team (TEAM_PEOPLE in app/protocol.js) and 'owner': the same names
  -- as public.reminder_log.person, where the reminders of the task are written.
  assignee text not null check (assignee in ('owner', 'irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli', 'stav', 'amos')),
  body text not null check (length(btrim(body)) between 1 and 500),
  client_id uuid references public.clients (id) on delete set null,
  -- The client's name as it was when the task was given: the assignee reads it also
  -- when the client itself is not theirs to open.
  client_name text check (client_name is null or length(client_name) <= 250),
  -- 'open' rings every 10 minutes; 'done' (the assignee) and 'cancelled' (the giver
  -- or the owner) stop the reminders.
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  done_at timestamptz,
  done_by_email text,
  cancelled_at timestamptz,
  cancelled_by_email text,
  check ((status = 'done') = (done_at is not null)),
  check ((status = 'cancelled') = (cancelled_at is not null))
);
create index if not exists staff_tasks_assignee_idx on public.staff_tasks (assignee) where status = 'open';
create index if not exists staff_tasks_created_idx on public.staff_tasks (created_by, created_at desc);

alter table public.staff_tasks enable row level security;
-- The assignee, whoever gave it, and the owner (who sees them all). Nobody else.
drop policy if exists "staff read their tasks" on public.staff_tasks;
create policy "staff read their tasks" on public.staff_tasks
  for select to authenticated
  using (public.reminder_person() is not null
         and (assignee = public.reminder_person() or created_by = public.reminder_person() or public.reminder_person() = 'owner'));
-- No direct writes from the browser: the three functions below.
revoke all on public.staff_tasks from public, anon, authenticated;
grant select on public.staff_tasks to authenticated;

-- Gives a task. The assignee must be someone who can sign in (a row on the staff
-- list), or nobody would ever see it. Returns the new task's id.
create or replace function public.staff_task_create(p_assignee text, p_body text, p_client uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me text := public.reminder_person();
  mail text := lower(coalesce(auth.jwt() ->> 'email', ''));
  txt text := btrim(coalesce(p_body, ''));
  cname text;
  rid uuid;
begin
  if me is null or not public.can_give_staff_tasks() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_assignee is null or p_assignee not in ('owner', 'irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli', 'stav', 'amos') then
    raise exception 'unknown assignee' using errcode = '22023';
  end if;
  if not exists (select 1 from public.staff s where coalesce(s.person, 'owner') = p_assignee) then
    raise exception 'the assignee has no login' using errcode = '22023';
  end if;
  if length(txt) < 1 or length(txt) > 500 then raise exception 'the task text is required (up to 500 characters)' using errcode = '22023'; end if;
  if p_client is not null then
    select left(case
             when coalesce(btrim(c.business), '') = '' or btrim(c.business) = btrim(c.name) then btrim(c.name)
             when btrim(c.name) = '' then btrim(c.business)
             else btrim(c.business) || ' · ' || btrim(c.name) end, 250)
      into cname from public.clients c where c.id = p_client;
    if not found then raise exception 'client not found' using errcode = 'P0002'; end if;
  end if;
  insert into public.staff_tasks (created_by, created_by_email, assignee, body, client_id, client_name)
  values (me, mail, p_assignee, txt, p_client, cname)
  returning id into rid;
  return rid;
end $$;

-- "בוצע": only the assignee, only while the task is open. The reminders of the task
-- still unread in their list are marked read with it.
create or replace function public.staff_task_done(p_id uuid) returns public.staff_tasks
language plpgsql security definer set search_path = '' as $$
declare
  me text := public.reminder_person();
  t public.staff_tasks;
begin
  if me is null then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into t from public.staff_tasks where id = p_id for update;
  if not found or (t.assignee <> me and t.created_by <> me and me <> 'owner') then raise exception 'task not found' using errcode = 'P0002'; end if;
  if t.assignee <> me then raise exception 'only the assignee marks a task done' using errcode = '42501'; end if;
  if t.status <> 'open' then raise exception 'this task is not open' using errcode = '22023'; end if;
  update public.staff_tasks set status = 'done', done_at = now(), done_by_email = lower(coalesce(auth.jwt() ->> 'email', ''))
  where id = p_id returning * into t;
  update public.reminder_log set read_at = now()
  where person = me and rule = 'nag' and read_at is null and key like 'nag:-:' || p_id::text || ':%';
  return t;
end $$;

-- Cancelling: whoever gave the task (while they may still give tasks) or the owner,
-- only while it is open. It stops the reminders and is kept as cancelled, not done.
create or replace function public.staff_task_cancel(p_id uuid) returns public.staff_tasks
language plpgsql security definer set search_path = '' as $$
declare
  me text := public.reminder_person();
  t public.staff_tasks;
begin
  if me is null then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into t from public.staff_tasks where id = p_id for update;
  if not found or (t.assignee <> me and t.created_by <> me and me <> 'owner') then raise exception 'task not found' using errcode = 'P0002'; end if;
  if not (me = 'owner' or (t.created_by = me and public.can_give_staff_tasks())) then raise exception 'not allowed' using errcode = '42501'; end if;
  if t.status <> 'open' then raise exception 'this task is not open' using errcode = '22023'; end if;
  update public.staff_tasks set status = 'cancelled', cancelled_at = now(), cancelled_by_email = lower(coalesce(auth.jwt() ->> 'email', ''))
  where id = p_id returning * into t;
  update public.reminder_log set read_at = now()
  where person = t.assignee and rule = 'nag' and read_at is null and key like 'nag:-:' || p_id::text || ':%';
  return t;
end $$;

revoke all on function public.staff_task_create(text, text, uuid) from public, anon, authenticated;
revoke all on function public.staff_task_done(uuid) from public, anon, authenticated;
revoke all on function public.staff_task_cancel(uuid) from public, anon, authenticated;
grant execute on function public.staff_task_create(text, text, uuid) to authenticated;
grant execute on function public.staff_task_done(uuid) to authenticated;
grant execute on function public.staff_task_cancel(uuid) to authenticated;
