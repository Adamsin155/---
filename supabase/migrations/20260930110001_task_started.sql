-- Urgent tasks: "התחלתי" (decision 9). The task's owner presses it within 30
-- office minutes, or the task comes back to Lior (the reminder engine,
-- app/reminder-rules.js 'urgent'). When and by whom are stamped here, never taken
-- from the browser; the first start is kept, and clearing it is allowed (undo).
alter table public.client_tasks
  add column if not exists started_at timestamptz,
  add column if not exists started_by_email text;

create function public.client_tasks_started() returns trigger
language plpgsql set search_path = '' as $$
declare me text := coalesce(nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''), 'system');
begin
  if tg_op = 'INSERT' then
    new.started_at := null;
    new.started_by_email := null;
  elsif new.started_at is null then
    new.started_by_email := null;
  elsif old.started_at is null then
    new.started_at := now();
    new.started_by_email := me;
  else
    new.started_at := old.started_at;
    new.started_by_email := old.started_by_email;
  end if;
  return new;
end $$;

create trigger client_tasks_started before insert or update on public.client_tasks
for each row execute function public.client_tasks_started();
-- Trigger functions are not an API: only the trigger calls them.
revoke execute on function public.client_tasks_started() from public, anon, authenticated;
