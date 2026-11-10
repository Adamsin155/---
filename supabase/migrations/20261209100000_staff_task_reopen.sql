-- "הושלם" back to "בתהליך" (Irit, 10.11.2026; "מעקב לקוחות", the tab "משימות לעורכים ולגרפיקאי",
-- app/tracking-tasks.js; docs/ops.md, section 122). A task of "משימות לעובדים" marked done by mistake
-- could not be opened again: public.staff_task_done only closes. This adds the way back.
--
-- public.staff_task_reopen(id)   whoever gave the task while they may still give tasks
--                                (public.can_give_staff_tasks(), the same rule as staff_task_cancel
--                                and the giver's "בוצע"), or the owner. Only a task that is done
--                                (a cancelled one stays cancelled). The task is open again: status
--                                'open', done_at and done_by_email emptied. Rule `nag` rings open
--                                tasks, so the reminders to the assignee start again by themselves.
--
-- Only a new function: no table, policy or trigger is added or changed. Safe to run again.
-- NOT RUN: waits for the owner's "מאשר להריץ את ה-SQL". Until then the app says that a task of
-- "משימות לעובדים" cannot be opened again from there (a client card's task can, as before).

create or replace function public.staff_task_reopen(p_id uuid) returns public.staff_tasks
language plpgsql security definer set search_path = '' as $$
declare
  me text := public.reminder_person();
  t public.staff_tasks;
begin
  if me is null then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into t from public.staff_tasks where id = p_id for update;
  if not found or (t.created_by <> me and me <> 'owner') then raise exception 'task not found' using errcode = 'P0002'; end if;
  if not (me = 'owner' or (t.created_by = me and public.can_give_staff_tasks())) then raise exception 'not allowed' using errcode = '42501'; end if;
  if t.status <> 'done' then raise exception 'this task is not done' using errcode = '22023'; end if;
  update public.staff_tasks set status = 'open', done_at = null, done_by_email = null
  where id = p_id returning * into t;
  return t;
end $$;

revoke all on function public.staff_task_reopen(uuid) from public, anon, authenticated;
grant execute on function public.staff_task_reopen(uuid) to authenticated;
