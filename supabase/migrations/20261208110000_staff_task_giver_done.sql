-- "בוצע" by whoever gave the task (the owner, 9.11.2026; docs/ops.md). A task given on the spot
-- ("נודניק", app/staff-tasks-ui.js) rang its assignee until the ASSIGNEE marked it done; the one
-- who gave it could only cancel it. Now the giver (Irit gave Ilai a task, and the work is done)
-- marks it "בוצע" herself from her card ("משימות לעובדים"); cancelling stays as it was.
--
-- public.staff_task_done(id)   the assignee, as before, or whoever gave the task while they may
--                              still give tasks (public.can_give_staff_tasks(), the same rule as
--                              public.staff_task_cancel). Only while it is open. Who marked it
--                              is stamped (done_by_email), never taken from the caller.
--                              The assignee's unread reminders of the task are marked read
--                              (before: the caller's, which was always the assignee).
--                              The reminders stop as on the assignee's "בוצע": rule `nag` rings
--                              only open tasks (status = 'open').
--                              The giver is not told of her own "בוצע": the step of rule
--                              `nagDone` ("<assignee> סימן/ה ״בוצע״") is written to the log as
--                              already handled (status 'suppressed'), so the reminders function
--                              never sends it. No function is redeployed for this.
--
-- The same signature: the app, the WhatsApp reply (public.whatsapp_jako_reply, as the assignee)
-- and the MCP write tools call it as before. No table, policy or trigger is added or removed.
-- Safe to run again. Tested with every migration in a real Postgres:
-- tests/sql/staff-task-giver-done.test.mjs.

create or replace function public.staff_task_done(p_id uuid) returns public.staff_tasks
language plpgsql security definer set search_path = '' as $$
declare
  me text := public.reminder_person();
  t public.staff_tasks;
  v_giver boolean;
begin
  if me is null then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into t from public.staff_tasks where id = p_id for update;
  if not found or (t.assignee <> me and t.created_by <> me and me <> 'owner') then raise exception 'task not found' using errcode = 'P0002'; end if;
  v_giver := t.assignee <> me and t.created_by = me and public.can_give_staff_tasks();
  if t.assignee <> me and not v_giver then raise exception 'only the assignee or whoever gave it marks a task done' using errcode = '42501'; end if;
  if t.status <> 'open' then raise exception 'this task is not open' using errcode = '22023'; end if;
  update public.staff_tasks set status = 'done', done_at = now(), done_by_email = lower(coalesce(auth.jwt() ->> 'email', ''))
  where id = p_id returning * into t;
  update public.reminder_log set read_at = now()
  where person = t.assignee and rule = 'nag' and read_at is null and key like 'nag:-:' || p_id::text || ':%';
  if v_giver then
    insert into public.reminder_log (key, rule, person, level, channel, status, reason, title, due_at, sent_at, read_at)
    values ('nagDone:-:' || p_id::text || ':done@' || t.created_by, 'nagDone', t.created_by, 'quiet', 'app', 'suppressed',
      'marked done by whoever gave it', left('סימנת ״בוצע״ בעצמך: ' || t.body, 300), now(), null, now())
    on conflict (key) do nothing;
  end if;
  return t;
end $$;

revoke all on function public.staff_task_done(uuid) from public, anon, authenticated;
grant execute on function public.staff_task_done(uuid) to authenticated;
