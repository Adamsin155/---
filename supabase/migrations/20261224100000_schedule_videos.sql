-- "לתזמן סרטונים" (the owner, 24.11.2026; docs/ops.md, section 152): Irit gives Ilai a scheduling
-- task for the graphics and another for the videos, each closing by itself when its own kind is
-- scheduled in the client's Gantt (app/gfx-auto-logic.js, supabase/functions/gfx-auto). One new kind:
--   staff_tasks.gfx_kind      'schedule_videos' next to 'make' / 'fix' / 'schedule' (= לתזמן גרפיקות)
--   staff_task_create_brief   20261216100000_gfx_auto.sql as it is, with the new kind accepted.
-- Nothing is taken out; runs again safely.

alter table public.staff_tasks drop constraint if exists staff_tasks_gfx_check;
alter table public.staff_tasks add constraint staff_tasks_gfx_check check (
  (gfx_kind is null or gfx_kind in ('make', 'fix', 'schedule', 'schedule_videos'))
  and (gfx_count is null or gfx_count between 1 and 200)
  and (gfx_done is null or gfx_done >= 0)
  and (auto_note is null or length(auto_note) <= 300));

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
  -- The graphics choice (17.11.2026): optional, for a graphics person on a client only; 'schedule_videos'
  -- (24.11.2026): the client's videos scheduled in the Gantt, counted as the graphics are.
  v_kind := nullif(btrim(coalesce(p_brief ->> 'gfx_kind', '')), '');
  if coalesce(p_brief ->> 'gfx_count', '') <> '' then
    if (p_brief ->> 'gfx_count') !~ '^[0-9]{1,3}$' then raise exception 'invalid graphics count' using errcode = '22023'; end if;
    v_count := (p_brief ->> 'gfx_count')::integer;
    if v_count < 1 or v_count > 200 then raise exception 'invalid graphics count' using errcode = '22023'; end if;
    v_kind := coalesce(v_kind, 'make');
  end if;
  if v_kind is not null then
    if v_kind not in ('make', 'fix', 'schedule', 'schedule_videos') then raise exception 'invalid graphics kind' using errcode = '22023'; end if;
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

notify pgrst, 'reload schema';
