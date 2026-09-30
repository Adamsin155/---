-- Stage 3, part 2: the production pages (docs/plan/system-plan.md §3: the editors,
-- Nirel, Eli and Lior's shoot-day mode). Everything they mark is a protocol check
-- (the keys are listed in app/production.js); this migration adds only what a
-- check cannot hold: how a brief task ended, and the route of work that goes to the
-- client after Ofir checks it (decision 19). No new table: the result is a column of
-- client_tasks, so the rows keep that table's row level security (who sees the
-- client: public.can_see_client / private.my_clients(), and the office).
-- Every statement here can run again safely.

-- ── How a brief task ended ───────────────────
-- Nirel (or anyone finishing a task with a brief) fills in what was done, what is
-- left and the Drive link: { done, left, drive, client, at }. The requester hears
-- (the reminder rule `briefDone`), and a follow-up task opens when something is left.
alter table public.client_tasks add column if not exists result jsonb;
alter table public.client_tasks drop constraint if exists client_tasks_result_check;
alter table public.client_tasks add constraint client_tasks_result_check
  check (result is null or (jsonb_typeof(result) = 'object' and octet_length(result::text) <= 4000));

-- ── Work that goes to the client: Ofir checks, then Irit sends ──
-- The check task Nirel's page opens for Ofir carries brief.route = 'irit'. Only the
-- office closes such a task (so the check cannot be skipped), and only its owner, or
-- the office, writes a task's result. Signed-in users only: the database's own jobs
-- and the SQL editor are not limited here.
create or replace function public.client_tasks_route_guard() returns trigger
language plpgsql set search_path = '' as $$
declare me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if me = '' or public.is_office() then
    return new;
  end if;
  if new.result is distinct from old.result and new.owner is distinct from public.my_person() then
    raise exception 'not allowed: only the task''s owner records how it ended';
  end if;
  -- The route as it was or as it is written now: taking it out while closing does not skip the check.
  if coalesce(old.brief ->> 'route', new.brief ->> 'route', '') <> '' and old.done_at is null and new.done_at is not null then
    raise exception 'not allowed: the office checks this work before it goes to the client';
  end if;
  return new;
end $$;
revoke execute on function public.client_tasks_route_guard() from public, anon, authenticated;
drop trigger if exists client_tasks_route_guard on public.client_tasks;
create trigger client_tasks_route_guard before update on public.client_tasks
for each row execute function public.client_tasks_route_guard();

-- When Ofir closes the check, Irit gets "לשלוח ללקוח" (once; undoing the check within
-- the undo window takes Irit's task back while she has not done it).
create or replace function public.client_tasks_route() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(new.brief ->> 'route', '') <> 'irit' then
    return new;
  end if;
  if old.done_at is null and new.done_at is not null then
    if not exists (select 1 from public.client_tasks t where t.brief ->> 'from_task' = new.id::text and t.done_at is null) then
      insert into public.client_tasks (client_id, title, owner, due_on, brief)
      values (
        new.client_id,
        left('לשלוח ללקוח אחרי בדיקת אופיר: ' || regexp_replace(new.title, '^לבדוק לפני שליחה ללקוח: ', ''), 500),
        'irit',
        (now() at time zone 'Asia/Jerusalem')::date,
        jsonb_strip_nulls(jsonb_build_object(
          'problem', 'אופיר בדק ואישר. לשלוח ללקוח.',
          'materials', new.brief ->> 'materials',
          'from_task', new.id::text)));
    end if;
  elsif old.done_at is not null and new.done_at is null then
    delete from public.client_tasks t where t.brief ->> 'from_task' = new.id::text and t.done_at is null;
  end if;
  return new;
end $$;
revoke execute on function public.client_tasks_route() from public, anon, authenticated;
drop trigger if exists client_tasks_route on public.client_tasks;
create trigger client_tasks_route after update of done_at on public.client_tasks
for each row execute function public.client_tasks_route();
