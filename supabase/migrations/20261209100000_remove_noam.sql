-- Noam left the company (the owner, 10.11.2026). Ofir took over all her work (docs/ops.md, section 124).
-- Already done in the database before this file: her four active clients were moved to Ofir
-- (clients.characterizer) and her row in public.staff was removed, so she cannot sign in.
-- This file takes 'noam' out of the rights and the defaults of the database functions, as
-- app/protocol.js does now (CHARACTERIZERS, DEFAULT_CHARACTERIZER = 'ofir', PAGES_INSTEAD).
-- Each function is its live definition (pg_get_functiondef, 10.11.2026) with only that change.
-- The check constraints that list 'noam' stay as they are: old rows (tasks, reminders, notes,
-- an old client's characterizer) still name her, and they are history.
-- ofir_meetings: an old client still set to 'noam' (or to nobody) is Ofir's meeting now.
-- private.protocol_writers is regenerated (scripts/protocol-writers.mjs): Noam is no writer,
-- and the pages and Highlights (6, 8, 8ב) are Ofir's alone, the office's (no row needed).
-- Not run: waits for the owner's "מאשר להריץ את ה-SQL".

-- access_form_submit(text,jsonb)
create or replace function public.access_form_submit(p_token text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  l public.client_access_links;
  c public.clients;
  a public.client_access;
  e jsonb;
  v_reason text;
  v_now timestamptz := now();
  v_net text;
  v_label text;
  v_row_label text;
  v_choice text;
  v_user text;
  v_pass text;
  v_status text;
  v_note text;
  v_rid uuid;
  v_sid uuid;
  v_new boolean;
  v_beside boolean;
  v_linked boolean;
  v_all text[] := '{}';
  v_open text[] := '{}';
  v_summary jsonb := '[]'::jsonb;
begin
  if public.is_staff() then
    raise exception 'staff cannot send the form for the client' using errcode = '42501';
  end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return jsonb_build_object('state', 'invalid');
  end if;
  select * into l from public.client_access_links s where s.token_hash = private.status_token_hash(p_token) for update;
  v_reason := private.access_link_reason(l);
  if v_reason is not null then
    return jsonb_build_object('state', v_reason);
  end if;

  if private.access_form_problem(p_payload) is not null then
    update public.client_access_links set attempts = attempts + 1, last_attempt_at = v_now where id = l.id;
    return jsonb_build_object('state', case when l.attempts + 1 >= 5 then 'locked' else 'refused' end, 'left', greatest(0, 4 - l.attempts));
  end if;

  select * into c from public.clients where id = l.client_id for update;

  for e in select value from jsonb_array_elements(p_payload -> 'entries') loop
    v_net := e ->> 'network';
    v_label := nullif(btrim(coalesce(e ->> 'label', '')), '');
    v_choice := e ->> 'choice';
    v_user := nullif(btrim(coalesce(e ->> 'username', '')), '');
    v_pass := coalesce(e ->> 'password', '');
    -- 'linked' is kept as status 'ok' with linked on (the column's status check stays as it was).
    v_status := case v_choice when 'have' then 'new' when 'none' then 'missing' when 'linked' then 'ok' else 'broken' end;
    v_linked := v_choice = 'linked';
    v_note := case v_choice
      when 'have' then 'מהלקוח, בטופס פרטי הכניסה. עוד לא נבדק.'
      when 'none' then 'מהלקוח, בטופס פרטי הכניסה: אין כיום, צריך לפתוח.'
      when 'linked' then 'מהלקוח, בטופס פרטי הכניסה: העמוד שויך לאסטרטג דרך מנהל העסקים.'
      else 'מהלקוח, בטופס פרטי הכניסה: יש, וצריך לחדש סיסמה.' end;
    v_row_label := v_label;

    -- The row of this network, when the vault has one (the oldest; 'other' by its name).
    select * into a from public.client_access x
    where x.client_id = c.id and x.network = v_net
      and (v_net <> 'other' or lower(btrim(coalesce(x.label, ''))) = lower(v_label))
    order by x.created_at, x.id limit 1;
    v_new := a.id is null;
    -- A login the office saved or checked stays as it is.
    v_beside := not v_new and a.secret_id is not null
      and (a.status = 'ok' or a.updated_by is distinct from 'client-form');
    if v_beside then
      -- The client's own row beside it, from an earlier form (never one the office confirmed).
      select * into a from public.client_access x
      where x.client_id = c.id and x.network = v_net and x.id <> a.id
        and x.updated_by = 'client-form' and (x.status <> 'ok' or x.linked)
        and (v_net <> 'other' or lower(btrim(coalesce(x.label, ''))) = lower(v_label))
      order by x.created_at, x.id limit 1;
      v_new := a.id is null;
      v_note := v_note || ' הפרטים שכבר היו בכספת נשארו בשורה נפרדת: לבדוק איזו נכונה.';
      if v_net <> 'other' then
        v_row_label := 'מהלקוח, ' || to_char(v_now at time zone 'Asia/Jerusalem', 'FMDD.FMMM.YYYY');
      end if;
    end if;
    if v_new then
      insert into public.client_access (client_id, network, label, username, status, linked, note, updated_by, updated_at)
      values (c.id, v_net, v_row_label, v_user, v_status, v_linked, v_note, 'client-form', v_now)
      returning id into v_rid;
    else
      v_rid := a.id;
      update public.client_access
      set username = case when v_choice = 'have' or (v_choice = 'reset' and v_user is not null) then v_user else username end,
          label = case when v_beside then v_row_label else label end,
          status = v_status, linked = v_linked, note = v_note, updated_by = 'client-form', updated_at = v_now
      where id = v_rid;
    end if;
    if v_choice = 'have' then
      -- The password. A row reached here is new, or the client's own unchecked one
      -- (or an office row with no password): nothing the office saved is replaced.
      if not v_new and a.secret_id is not null then
        perform vault.update_secret(a.secret_id, v_pass);
      else
        v_sid := vault.create_secret(v_pass, 'client_access:' || v_rid::text, 'client social access');
        update public.client_access set secret_id = v_sid where id = v_rid;
      end if;
    end if;
    insert into public.client_access_log (access_id, client_id, network, action, by_email)
    values (v_rid, c.id, v_net, case when v_new then 'create' else 'update' end, 'client-form');

    v_all := v_all || private.access_network_name(v_net, v_label);
    if v_choice = 'none' and (v_new or a.status is distinct from 'missing') then
      v_open := v_open || private.access_network_name(v_net, v_label);
    end if;
    -- 'beside': kept next to a login of the office (the card says so).
    v_summary := v_summary || (jsonb_build_object('network', v_net, 'label', v_label, 'choice', v_choice)
      || case when v_beside then jsonb_build_object('beside', true) else '{}'::jsonb end);
  end loop;

  -- The link is closed: one use. Its token leaves Vault (client_access_links_forget).
  -- The note goes where only the vault's users read it.
  update public.client_access_links
  set submitted_at = v_now, summary = v_summary, client_note = null,
      client_note_private = nullif(btrim(coalesce(p_payload ->> 'notes', '')), '')
  where id = l.id;

  -- Process 5, as the end of the characterization marks it (endedChecks in
  -- app/characterization.js). A mark already done keeps its time and its words.
  insert into public.protocol_checks (client_id, item_key, state, note)
  values (c.id, 'p05.access', 'done', left('מהלקוח, בטופס פרטי הכניסה: ' || array_to_string(v_all, ', '), 2000))
  on conflict (client_id, item_key) do update set state = 'done', note = excluded.note
    where public.protocol_checks.state <> 'done';
  insert into public.protocol_checks (client_id, item_key, state, note)
  values (c.id, 'p05.vault', 'done', 'נכנס לכספת מטופס פרטי הכניסה של הלקוח')
  on conflict (client_id, item_key) do update set state = 'done', note = excluded.note
    where public.protocol_checks.state <> 'done';

  -- "אין כיום, צריך לפתוח": whoever sets the client's pages up opens them (the task the card's
  -- vault opens; Ilai's until 28.10.2026): Ofir (app/protocol.js pagesOwnerOf). Noam shared it
  -- from 1.11 until she left the company on 10.11.2026.
  if array_length(v_open, 1) > 0 then
    insert into public.client_tasks (client_id, title, owner, urgent)
    values (c.id, left('לפתוח ללקוח ' || array_to_string(v_open, ', ') || ' ולהכניס את הגישה לכספת (הלקוח סימן בטופס: אין כיום)', 500),
      'ofir', true);
  end if;

  return jsonb_build_object('state', 'done');
end $$;
revoke all on function public.access_form_submit(text, jsonb) from public;
grant execute on function public.access_form_submit(text, jsonb) to anon, authenticated;

-- can_connect_metricool()
create or replace function public.can_connect_metricool()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
  select public.is_staff() and exists (
    select 1 from public.staff s
    where s.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (s.person is null or s.person in ('ilai', 'ofir', 'irit', 'lior')));
$$;
revoke execute on function public.can_connect_metricool() from public, anon;
grant execute on function public.can_connect_metricool() to authenticated;

-- can_edit_gantt()
create or replace function public.can_edit_gantt()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
  select public.is_staff() and exists (
    select 1 from public.staff s
    where s.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (s.person is null or s.person in ('ilai', 'irit', 'ofir', 'lior')));
$$;
revoke execute on function public.can_edit_gantt() from public, anon;
grant execute on function public.can_edit_gantt() to authenticated;

-- can_manage_access_links()
create or replace function public.can_manage_access_links()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
  select public.is_staff() and exists (
    select 1 from public.staff s
    where s.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (s.person is null or s.person in ('irit', 'lior', 'ofir'))
  );
$$;
revoke execute on function public.can_manage_access_links() from public, anon;
grant execute on function public.can_manage_access_links() to authenticated;

-- is_office()
create or replace function public.is_office()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
  select public.is_staff() and exists (
    select 1 from public.staff s
    where s.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (s.person is null or s.person in ('irit', 'lior', 'ofir', 'ilai', 'shiel'))
  );
$$;
revoke execute on function public.is_office() from public, anon;
grant execute on function public.is_office() to authenticated;

-- ofir_meetings(timestamp with time zone)
create or replace function public.ofir_meetings(p_since timestamp with time zone)
 RETURNS TABLE(starts_at timestamp with time zone, ends_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
  select c.char_at,
         case when d.at is null then c.char_at + interval '2 hours'
              else least(d.at, c.char_at + interval '4 hours') end
  from public.clients c
  left join lateral (select min(s.at) as at from public.protocol_checks s
                     where s.client_id = c.id and s.item_key in ('p04.ended', 'p04.saved') and s.state = 'done' and s.at > c.char_at) d on true
  where public.is_staff() and c.char_at is not null and coalesce(c.characterizer, 'ofir') in ('ofir', 'noam')
    and c.status in ('active', 'ending')
    and c.char_at >= greatest(p_since, now() - interval '7 days') - interval '1 day' and c.char_at <= now() + interval '1 day'
  order by 1;
$$;
revoke execute on function public.ofir_meetings(timestamptz) from public, anon;
grant execute on function public.ofir_meetings(timestamptz) to authenticated;

-- private.task_gives_access(text)
create or replace function private.task_gives_access(p_created_by text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
  select not exists (
    select 1 from public.staff s
    where s.email = lower(coalesce(p_created_by, ''))
      and s.person is not null and s.person not in ('irit', 'lior', 'ofir', 'ilai', 'shiel'));
$$;
revoke execute on function private.task_gives_access(text) from public, anon, authenticated;

-- staff_task_create_brief(text,text,uuid,jsonb)
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
begin
  if me is null or not public.can_give_staff_tasks() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_assignee is null or p_assignee not in ('owner', 'irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli', 'stav', 'amos') then
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
  if p_client is not null then
    select left(case
             when coalesce(btrim(c.business), '') = '' or btrim(c.business) = btrim(c.name) then btrim(c.name)
             when btrim(c.name) = '' then btrim(c.business)
             else btrim(c.business) || ' · ' || btrim(c.name) end, 250)
      into cname from public.clients c where c.id = p_client;
    if not found then raise exception 'client not found' using errcode = 'P0002'; end if;
  end if;
  insert into public.staff_tasks (created_by, created_by_email, assignee, body, client_id, client_name, brief)
  values (me, mail, p_assignee, txt, p_client, cname, v_brief)
  returning id into rid;
  return rid;
end $$;
revoke all on function public.staff_task_create_brief(text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.staff_task_create_brief(text, text, uuid, jsonb) to authenticated;

-- protocol-writers:begin (generated by scripts/protocol-writers.mjs from app/protocol.js; do not edit by hand)
insert into private.protocol_writers (key, proc, round, persons) values
  ('@office', null, false, array['irit', 'lior', 'ofir']::text[]),
  ('@editors', null, false, array['anna', 'nadia', 'nirel', 'yariv']::text[]),
  ('p04.address', 'p04', false, array['lior', 'ofir', 'shiel']::text[]),
  ('p04.phone', 'p04', false, array['lior', 'ofir', 'shiel']::text[]),
  ('p04.services', 'p04', false, array['lior', 'ofir', 'shiel']::text[]),
  ('p04.audiences', 'p04', false, array['lior', 'ofir', 'shiel']::text[]),
  ('p04.advantages', 'p04', false, array['lior', 'ofir', 'shiel']::text[]),
  ('p04.goals', 'p04', false, array['lior', 'ofir', 'shiel']::text[]),
  ('p04.offers', 'p04', false, array['lior', 'ofir', 'shiel']::text[]),
  ('p04.content', 'p04', false, array['lior', 'ofir', 'shiel']::text[]),
  ('p04.graphics', 'p04', false, array['lior', 'ofir', 'shiel']::text[]),
  ('p04.campaigns', 'p04', false, array['lior', 'ofir', 'shiel']::text[]),
  ('p04.special', 'p04', false, array['lior', 'ofir', 'shiel']::text[]),
  ('p04.saved', 'p04', false, array['lior', 'ofir', 'shiel']::text[]),
  ('p04.@part', 'p04', false, array['lior', 'ofir', 'shiel']::text[]),
  ('p05.access', 'p05', false, array['irit', 'lior', 'ofir', 'shiel']::text[]),
  ('p05.allnets', 'p05', false, array['irit', 'lior', 'ofir', 'shiel']::text[]),
  ('p05.logo', 'p05', false, array['irit', 'lior', 'ofir', 'shiel']::text[]),
  ('p05.colors', 'p05', false, array['irit', 'lior', 'ofir', 'shiel']::text[]),
  ('p05.photos', 'p05', false, array['irit', 'lior', 'ofir', 'shiel']::text[]),
  ('p05.videos', 'p05', false, array['irit', 'lior', 'ofir', 'shiel']::text[]),
  ('p05.menu', 'p05', false, array['irit', 'lior', 'ofir', 'shiel']::text[]),
  ('p05.newlogo', 'p05', false, array['ilai']::text[]),
  ('p05.@wait', 'p05', false, array['ilai', 'irit', 'lior', 'ofir', 'shiel']::text[]),
  ('p05.@part', 'p05', false, array['ilai', 'irit', 'lior', 'ofir', 'shiel']::text[]),
  ('p07.made', 'p07', false, array['ilai']::text[]),
  ('p07.@wait', 'p07', false, array['ilai', 'irit', 'ofir']::text[]),
  ('p07.@part', 'p07', false, array['ilai', 'irit', 'ofir']::text[]),
  ('p07b.posted', 'p07b', false, array['ilai']::text[]),
  ('p07b.@part', 'p07b', false, array['ilai']::text[]),
  ('p09.file', 'p09', false, array['ilai']::text[]),
  ('p09.@part', 'p09', false, array['ilai']::text[]),
  ('p17b.drive', 'p17b', true, array['eli']::text[]),
  ('p17b.gear', 'p17b', true, array['eli']::text[]),
  ('p17b.broll', 'p17b', true, array['eli']::text[]),
  ('p17b.@part', 'p17b', true, array['eli']::text[]),
  ('p18b.order', 'p18b', true, array['eli']::text[]),
  ('p18b.quality', 'p18b', true, array['eli']::text[]),
  ('p18b.numbered', 'p18b', true, array['eli']::text[]),
  ('p18b.@part', 'p18b', true, array['eli']::text[]),
  ('p19b.folders', 'p19b', true, array['eli']::text[]),
  ('p19b.checked', 'p19b', true, array['eli']::text[]),
  ('p19b.handed', 'p19b', true, array['eli']::text[]),
  ('p19b.@part', 'p19b', true, array['eli']::text[]),
  ('p22.received', 'p22', true, array['@editor']::text[]),
  ('p22.check.footage', 'p22', true, array['@editor']::text[]),
  ('p22.check.scripts', 'p22', true, array['@editor']::text[]),
  ('p22.check.logo', 'p22', true, array['@editor']::text[]),
  ('p22.check.phone', 'p22', true, array['@editor']::text[]),
  ('p22.edited', 'p22', true, array['@editor']::text[]),
  ('p22.self.spelling', 'p22', true, array['@editor']::text[]),
  ('p22.self.broll', 'p22', true, array['@editor']::text[]),
  ('p22.self.closing', 'p22', true, array['@editor']::text[]),
  ('p22.self.complete', 'p22', true, array['@editor']::text[]),
  ('p22.self.sound', 'p22', true, array['@editor']::text[]),
  ('p22.self.exposure', 'p22', true, array['@editor']::text[]),
  ('p22.self.stable', 'p22', true, array['@editor']::text[]),
  ('p22.self.angles', 'p22', true, array['@editor']::text[]),
  ('p22.self.export', 'p22', true, array['@editor']::text[]),
  ('p22.@wait', 'p22', true, array['@editor']::text[]),
  ('p22.@pause', 'p22', true, array['@editor', '@editor-free']::text[]),
  ('p22.@part', 'p22', true, array['@editor']::text[]),
  ('p23.made', 'p23', false, array['ilai']::text[]),
  ('p23.@wait', 'p23', false, array['ilai', 'irit', 'ofir']::text[]),
  ('p23.@part', 'p23', false, array['ilai', 'irit', 'ofir']::text[]),
  ('p23b.posted', 'p23b', false, array['ilai']::text[]),
  ('p23b.@part', 'p23b', false, array['ilai']::text[]),
  ('p24.folder', 'p24', true, array['@editor']::text[]),
  ('p24.drive', 'p24', true, array['@editor']::text[]),
  ('p24.d' || 'ropbox', 'p24', true, array['@editor']::text[]),
  ('p24.notify', 'p24', true, array['@editor']::text[]),
  ('p24.@wait', 'p24', true, array['@editor']::text[]),
  ('p24.@part', 'p24', true, array['@editor']::text[]),
  ('p27.fixes', 'p27', true, array['@editor']::text[]),
  ('p27.final', 'p27', true, array['@editor']::text[]),
  ('p27.toilai', 'p27', true, array['ilai']::text[]),
  ('p27.@wait', 'p27', true, array['@editor', 'ilai', 'irit']::text[]),
  ('p27.@pause', 'p27', true, array['@editor', '@editor-free']::text[]),
  ('p27.@part', 'p27', true, array['@editor', 'ilai', 'irit']::text[]),
  ('p28.auto', 'p28', true, array['ilai']::text[]),
  ('p28.@part', 'p28', true, array['ilai']::text[]),
  ('p29b.c.vsched', 'p29b', true, array['ilai']::text[]),
  ('p29b.c.gsched', 'p29b', true, array['ilai']::text[]),
  ('p29b.c.ganttok', 'p29b', true, array['ilai']::text[]),
  ('p29b.c.updated', 'p29b', true, array['ilai']::text[]),
  ('p29b.done', 'p29b', true, array['ilai']::text[]),
  ('p29b.@part', 'p29b', true, array['ilai']::text[]),
  ('p17b.brollq', 'p17b', true, array['eli']::text[]),
  ('p22.missing', 'p22', true, array['@editor']::text[]),
  ('p27.fixed', 'p27', true, array['@editor']::text[]),
  ('p16.photographer', 'p16', true, array['eli']::text[]),
  ('p16.read', 'p16', true, array['eli']::text[]),
  ('p18b.files', 'p18b', true, array['eli']::text[]),
  ('p19b.notes', 'p19b', true, array['eli']::text[]),
  ('p25.@qafixed', 'p25', true, array['@editor']::text[]),
  ('p23.@qafixed', 'p23', false, array['ilai']::text[]),
  ('p07.@qafixed', 'p07', false, array['ilai']::text[])
on conflict (key) do update set proc = excluded.proc, round = excluded.round, persons = excluded.persons;
update private.protocol_writers set persons = '{}'::text[] where key <> all (array['@office', '@editors', 'p04.address', 'p04.phone', 'p04.services', 'p04.audiences', 'p04.advantages', 'p04.goals', 'p04.offers', 'p04.content', 'p04.graphics', 'p04.campaigns', 'p04.special', 'p04.saved', 'p04.@part', 'p05.access', 'p05.allnets', 'p05.logo', 'p05.colors', 'p05.photos', 'p05.videos', 'p05.menu', 'p05.newlogo', 'p05.@wait', 'p05.@part', 'p07.made', 'p07.@wait', 'p07.@part', 'p07b.posted', 'p07b.@part', 'p09.file', 'p09.@part', 'p17b.drive', 'p17b.gear', 'p17b.broll', 'p17b.@part', 'p18b.order', 'p18b.quality', 'p18b.numbered', 'p18b.@part', 'p19b.folders', 'p19b.checked', 'p19b.handed', 'p19b.@part', 'p22.received', 'p22.check.footage', 'p22.check.scripts', 'p22.check.logo', 'p22.check.phone', 'p22.edited', 'p22.self.spelling', 'p22.self.broll', 'p22.self.closing', 'p22.self.complete', 'p22.self.sound', 'p22.self.exposure', 'p22.self.stable', 'p22.self.angles', 'p22.self.export', 'p22.@wait', 'p22.@pause', 'p22.@part', 'p23.made', 'p23.@wait', 'p23.@part', 'p23b.posted', 'p23b.@part', 'p24.folder', 'p24.drive', 'p24.d' || 'ropbox', 'p24.notify', 'p24.@wait', 'p24.@part', 'p27.fixes', 'p27.final', 'p27.toilai', 'p27.@wait', 'p27.@pause', 'p27.@part', 'p28.auto', 'p28.@part', 'p29b.c.vsched', 'p29b.c.gsched', 'p29b.c.ganttok', 'p29b.c.updated', 'p29b.done', 'p29b.@part', 'p17b.brollq', 'p22.missing', 'p27.fixed', 'p16.photographer', 'p16.read', 'p18b.files', 'p19b.notes', 'p25.@qafixed', 'p23.@qafixed', 'p07.@qafixed']::text[]);
-- protocol-writers:end
