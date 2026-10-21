-- Requests of the owner of 21.10.2026:
--
--   A. "שויך": a Facebook or Instagram page is often linked to Astrateg through Meta
--      Business, with no user name and no password. The vault records it, for these
--      two networks only, as a working access (like 'ok': no gap, no task).
--   B. The editor's reason (22א) is optional now. Nothing in the database asked for
--      it (only the screen did, app/qa.js), so B needs nothing here.
--   C. A second editor for a client (section C below).
--
-- How 'linked' is kept. client_access.status has a check that lists its values
-- ('ok', 'broken', 'missing', 'new'; 20261008100000_client_access_form.sql). This file
-- only adds: it never takes away a constraint, a column or a row, so that check stays
-- as it is. A linked page is therefore the status 'ok' with the new column `linked`
-- on, and a new check holds `linked` to Facebook and Instagram (and to 'ok'). The
-- office's functions answer it as the status 'linked' (access_status_overview,
-- access_status_for_work, access_work_statuses), so every screen reads one status;
-- access_save() takes 'linked' as a status; the client's form has a fourth choice,
-- 'linked', for these two networks. A page that reads the table itself reads the
-- column too (app/access-logic.js accessRow).
--
-- Safe to run again; additive only. Tested with every migration in a real Postgres:
-- tests/sql/access-and-editors.test.mjs.

-- ── A1. The column and its check ─────────────
alter table public.client_access add column if not exists linked boolean not null default false;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_access_linked_check'
                   and conrelid = 'public.client_access'::regclass) then
    alter table public.client_access add constraint client_access_linked_check
      check (not linked or (network in ('facebook', 'instagram') and status = 'ok'));
  end if;
end $$;

-- ── A2. Saving a login (the card, Ofir's form) ──
-- As in 20260930130000_assignment_rls.sql, with 'linked' as one more status: kept as
-- 'ok' with linked on, refused for any other network. A row saved with another status
-- is no longer linked. A status left out keeps the row's own (linked included).
create or replace function public.access_save(
  p_client uuid, p_id uuid, p_network text, p_label text, p_username text, p_password text, p_status text, p_note text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  rid uuid := p_id;
  sid uuid;
  v_status text := p_status;
begin
  if not public.can_use_client_vault(p_client) then raise exception 'not allowed'; end if;
  if v_status is null and rid is not null then
    select case when x.linked then 'linked' else x.status end into v_status
    from public.client_access x where x.id = rid and x.client_id = p_client;
  end if;
  v_status := coalesce(v_status, 'ok');
  if v_status = 'linked' and p_network not in ('facebook', 'instagram') then
    raise exception 'linked is for facebook or instagram only';
  end if;
  if rid is null then
    insert into public.client_access (client_id, network, label, username, status, linked, note, updated_by)
    values (p_client, p_network, nullif(btrim(p_label), ''), nullif(btrim(p_username), ''),
            case when v_status = 'linked' then 'ok' else v_status end, v_status = 'linked', nullif(btrim(p_note), ''), me)
    returning id into rid;
  else
    update public.client_access
    set network = p_network, label = nullif(btrim(p_label), ''), username = nullif(btrim(p_username), ''),
        status = case when v_status = 'linked' then 'ok' else v_status end, linked = v_status = 'linked',
        note = nullif(btrim(p_note), ''), updated_by = me, updated_at = now()
    where id = rid and client_id = p_client
    returning secret_id into sid;
    if not found then raise exception 'access not found'; end if;
  end if;
  if coalesce(p_password, '') <> '' then
    select secret_id into sid from public.client_access where id = rid;
    if sid is null then
      sid := vault.create_secret(p_password, 'client_access:' || rid::text, 'client social access');
      update public.client_access set secret_id = sid where id = rid;
    else
      perform vault.update_secret(sid, p_password);
    end if;
  end if;
  insert into public.client_access_log (access_id, client_id, network, action, by_email)
  values (rid, p_client, p_network, case when p_id is null then 'create' else 'update' end, me);
  return rid;
end $$;

-- ── A3. The statuses the office reads: 'linked' as a status of its own ──
create or replace function public.access_status_overview()
returns table (client_id uuid, network text, status text, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.client_id, a.network, case when a.linked then 'linked' else a.status end, a.updated_at
  from public.client_access a
  join public.clients c on c.id = a.client_id and c.archived_at is null
  where (select public.is_manager())
  order by a.client_id;
$$;

create or replace function public.access_status_for_work(p_clients uuid[] default null)
returns table (client_id uuid, network text, label text, status text, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.client_id, a.network, a.label, case when a.linked then 'linked' else a.status end, a.updated_at
  from public.client_access a
  join public.clients c on c.id = a.client_id and c.archived_at is null
  where (select public.is_office())
    and (p_clients is null or a.client_id = any (p_clients))
  order by a.client_id, a.created_at;
$$;

create or replace function public.access_work_statuses(p_clients uuid[] default null)
returns table (client_id uuid, network text, label text, status text, updated_at timestamptz, by_client boolean)
language sql stable security definer set search_path = '' as $$
  select a.client_id, a.network, a.label, case when a.linked then 'linked' else a.status end, a.updated_at,
    a.updated_by is not distinct from 'client-form'
  from public.client_access a
  join public.clients c on c.id = a.client_id and c.archived_at is null
  where (select public.is_office())
    and (p_clients is null or a.client_id = any (p_clients))
  order by a.client_id, a.created_at;
$$;

-- ── A4. The client's form: a fourth choice for Facebook and Instagram ──
-- As in 20261014100000_security_hardening.sql, with 'linked': no user name, no password.
create or replace function private.access_form_problem(p jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare
  e jsonb;
  k text;
  n integer;
  v_net text;
  v_label text;
  v_choice text;
  v_user text;
  v_pass text;
  v_key text;
  v_main boolean;
  seen text[] := '{}';
begin
  if p is null or jsonb_typeof(p) <> 'object' then return 'payload'; end if;
  if octet_length(p::text) > 40000 then return 'too large'; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('entries', 'notes') then return 'unknown field'; end if;
  end loop;
  if jsonb_typeof(p -> 'entries') is distinct from 'array' then return 'entries'; end if;
  n := jsonb_array_length(p -> 'entries');
  if n < 3 or n > 12 then return 'entries count'; end if;
  if p ? 'notes' and jsonb_typeof(p -> 'notes') not in ('string', 'null') then return 'notes'; end if;
  if char_length(coalesce(p ->> 'notes', '')) > 300 then return 'notes too long'; end if;
  for e in select value from jsonb_array_elements(p -> 'entries') loop
    if jsonb_typeof(e) <> 'object' then return 'entry'; end if;
    for k in select jsonb_object_keys(e) loop
      if k not in ('network', 'label', 'choice', 'username', 'password') then return 'unknown field'; end if;
      if jsonb_typeof(e -> k) not in ('string', 'null') then return 'entry type'; end if;
    end loop;
    v_net := e ->> 'network';
    v_label := btrim(coalesce(e ->> 'label', ''));
    v_choice := e ->> 'choice';
    v_user := btrim(coalesce(e ->> 'username', ''));
    v_pass := coalesce(e ->> 'password', '');
    v_main := v_net in ('instagram', 'facebook', 'tiktok');
    if v_net is null or (not v_main and v_net not in ('youtube', 'google', 'meta', 'other')) then return 'network'; end if;
    if v_net = 'other' then
      if v_label = '' or char_length(v_label) > 40 or v_label ~ '[\x01-\x1f\x7f]' then return 'label'; end if;
    elsif v_label <> '' then return 'label';
    end if;
    if v_choice is null or v_choice not in ('have', 'none', 'reset', 'linked') or (not v_main and v_choice <> 'have')
       or (v_choice = 'linked' and v_net not in ('facebook', 'instagram')) then return 'choice'; end if;
    if char_length(v_user) > 200 or v_user ~ '[\x01-\x1f\x7f]' then return 'username'; end if;
    if v_choice = 'have' then
      if v_user = '' then return 'username'; end if;
      if btrim(v_pass) = '' or char_length(v_pass) > 200 or v_pass ~ '[\x01-\x1f\x7f]' then return 'password'; end if;
    else
      if v_pass <> '' then return 'password'; end if;
      if v_choice in ('none', 'linked') and v_user <> '' then return 'username'; end if;
    end if;
    v_key := v_net || ':' || lower(v_label);
    if v_key = any (seen) then return 'duplicate'; end if;
    seen := seen || v_key;
  end loop;
  if not (array['instagram:', 'facebook:', 'tiktok:'] <@ seen) then return 'required'; end if;
  return null;
end $$;
revoke execute on function private.access_form_problem(jsonb) from public, anon, authenticated;

-- The submission, as in 20261014100000_security_hardening.sql, with 'linked': the row
-- is 'ok' with linked on, no password is asked for, and nothing is opened for Ilai.
create or replace function public.access_form_submit(p_token text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
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

  -- "אין כיום, צריך לפתוח": Ilai opens the pages (the task the card's vault opens).
  if array_length(v_open, 1) > 0 then
    insert into public.client_tasks (client_id, title, owner, urgent)
    values (c.id, left('לפתוח ללקוח ' || array_to_string(v_open, ', ') || ' ולהכניס את הגישה לכספת (הלקוח סימן בטופס: אין כיום)', 500), 'ilai', true);
  end if;

  return jsonb_build_object('state', 'done');
end $$;
revoke all on function public.access_form_submit(text, jsonb) from public;
grant execute on function public.access_form_submit(text, jsonb) to anon, authenticated;
