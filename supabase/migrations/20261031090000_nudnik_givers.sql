-- "שליחת נודניק" for Ofir and Lior too (the owner, 21.10.2026). Until now only the owner
-- and Irit gave these tasks (20261011100000_staff_tasks.sql). The list lives in this one
-- function, read by staff_task_create and staff_task_cancel; the app's list is
-- GIVERS in app/staff-tasks-logic.js. Safe to run again. Tested in
-- tests/sql/nudnik-givers.test.mjs.
create or replace function public.can_give_staff_tasks() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.reminder_person() in ('owner', 'irit', 'lior', 'ofir'), false);
$$;
revoke execute on function public.can_give_staff_tasks() from public, anon;
grant execute on function public.can_give_staff_tasks() to authenticated;
