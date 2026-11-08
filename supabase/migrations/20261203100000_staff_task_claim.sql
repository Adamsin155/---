-- "אני על זה" on a task given on the spot (the owner, 8.11.2026; docs/ops.md, section 110).
-- A task Irit (or anyone who gives tasks) gives rings its assignee every 30 minutes until "בוצע".
-- Work of several days ("לערוך עוד 43 סרטונים") rang all day for days. Now the assignee can say
-- "אני על זה": from then on it rings every two hours (app/staff-tasks-logic.js claimSlot), until
-- "בוצע". Whoever gave it sees "בטיפול אצל …" with the moment.
--
-- public.staff_tasks.claimed_at   when the assignee pressed "אני על זה" (null: not yet).
-- public.staff_task_claim(id)     only the assignee, only while the task is open; pressing again
--                                 keeps the first moment. The reminders of the task still unread
--                                 are marked read with it, as "בוצע" does.
--
-- Only adds. Safe to run again.

alter table public.staff_tasks add column if not exists claimed_at timestamptz;
alter table public.staff_tasks drop constraint if exists staff_tasks_claim_open;
alter table public.staff_tasks add constraint staff_tasks_claim_open check (claimed_at is null or claimed_at >= created_at);

create or replace function public.staff_task_claim(p_id uuid) returns public.staff_tasks
language plpgsql security definer set search_path = '' as $$
declare
  me text := public.reminder_person();
  t public.staff_tasks;
begin
  if me is null then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into t from public.staff_tasks where id = p_id for update;
  if not found or (t.assignee <> me and t.created_by <> me and me <> 'owner') then raise exception 'task not found' using errcode = 'P0002'; end if;
  if t.assignee <> me then raise exception 'only the assignee takes a task' using errcode = '42501'; end if;
  if t.status <> 'open' then raise exception 'this task is not open' using errcode = '22023'; end if;
  update public.staff_tasks set claimed_at = coalesce(claimed_at, now()) where id = p_id returning * into t;
  update public.reminder_log set read_at = now()
  where person = me and rule = 'nag' and read_at is null and key like 'nag:-:' || p_id::text || ':%';
  return t;
end $$;
revoke all on function public.staff_task_claim(uuid) from public, anon, authenticated;
grant execute on function public.staff_task_claim(uuid) to authenticated;
