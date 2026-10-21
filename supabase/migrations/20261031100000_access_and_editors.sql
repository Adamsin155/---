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

-- ══ C. A second editor for a client (the owner's request of 21.10.2026) ══
-- Sometimes two editors edit one client together. `clients.editor` stays the main editor
-- (Ofir's assignment, 22א, as before); `clients.editor2` is an optional second one, and a
-- shoot round may carry its own pair in `rounds` ({ n, editor, editor2, … }). The second
-- editor sees the client and its card like the main one, gets the same editor notices
-- (app/reminder-rules.js reads both), and may mark the editing steps ('@editor' in the
-- writers' table now means either of them). Everything else is as it was with one.
-- The functions below are those of 20261014100000_security_hardening.sql,
-- 20260930210000_hardening.sql and 20261027100000_landing_links.sql, each with editor2
-- beside editor and nothing else changed.

-- ── C1. The column ───────────────────────────
-- An editor of the team, as `editor` is (20260929180000_protocol_batch3.sql). Being the
-- same as the main one, or set with none, is harmless: the app reads the pair without
-- repeats and offers the second only beside a main one.
alter table public.clients add column if not exists editor2 text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clients_editor2_check'
                   and conrelid = 'public.clients'::regclass) then
    alter table public.clients add constraint clients_editor2_check
      check (editor2 is null or editor2 in ('nadia', 'yariv', 'anna', 'nirel'));
  end if;
end $$;
-- Read like `editor` (the table's columns are granted one by one since 20260930210000_hardening.sql).
grant select (editor2) on public.clients to authenticated;

-- ── C2. Who sees the client: the second editor too ──
create or replace function private.my_assigned_clients() returns setof uuid
language sql stable security definer set search_path = '' as $$
  with me as (select public.my_person() as p)
  select c.id from public.clients c, me
  where me.p is not null and (
    c.editor = me.p or c.editor2 = me.p
    or exists (select 1 from jsonb_array_elements(c.rounds) r where r ->> 'editor' = me.p or r ->> 'editor2' = me.p))
  union
  select t.client_id from public.client_tasks t, me
  where t.owner = me.p and private.task_gives_access(t.created_by_email)
    and (t.done_at is null or t.done_at > now() - interval '30 days');
$$;

create or replace function private.is_assigned(p_client uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  with me as (select public.my_person() as p)
  select me.p is not null and (
    exists (select 1 from public.clients c where c.id = p_client
      and (c.editor = me.p or c.editor2 = me.p
        or exists (select 1 from jsonb_array_elements(c.rounds) r where r ->> 'editor' = me.p or r ->> 'editor2' = me.p)))
    or exists (select 1 from public.client_tasks t where t.client_id = p_client and t.owner = me.p
      and private.task_gives_access(t.created_by_email)
      and (t.done_at is null or t.done_at > now() - interval '30 days')))
  from me;
$$;

-- ── C3. Who marks the editing steps: either editor of that shoot ──
create or replace function private.protocol_write_ok(p_client uuid, p_key text, p_note text)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  me text;
  m text[];
  w private.protocol_writers;
  v_rule text;
  v_editor text;
  v_editor2 text;
begin
  if not public.is_staff() then return false; end if;
  me := public.my_person();
  -- The owner (a staff login without a person), Irit, Lior and Ofir: everything.
  if me is null then return public.is_office(); end if;
  if me = any (coalesce((select w0.persons from private.protocol_writers w0 where w0.key = '@office'), '{}')) then return true; end if;
  -- Imported history is written when the office opens a client.
  if p_note = 'ייבוא' then return false; end if;
  m := regexp_match(coalesce(p_key, ''), '^(?:r([0-9]+)\.)?((p[0-9]+[ab]?)\.(.+))$');
  if m is null then return false; end if;
  -- "לדחות…" on a reminder: on any client one sees, as before.
  if m[4] = 'snooze' then return true; end if;
  select * into w from private.protocol_writers x where x.key = m[2];
  if not found then
    v_rule := case
      when m[4] = 'claim' then m[3] || '.@claim'
      when m[4] in ('wait', 'waited') then m[3] || '.@wait'
      when m[4] = 'pause' then m[3] || '.@pause'
      when m[4] ~ '^handoff\.[a-z0-9]+$' then m[3] || '.@part'
      when m[4] ~ '^fixed\.[0-9]+(\.[0-9]+)?$' then m[3] || '.@qafixed' end;
    select * into w from private.protocol_writers x where x.key = v_rule;
  end if;
  if w.key is null or (m[1] is not null and not w.round) then return false; end if;
  if me = any (w.persons) then return true; end if;
  if not (w.persons && array['@editor', '@editor-free']) then return false; end if;
  -- The editor of that shoot: the client's, or the round's (no fallback, as in the app);
  -- and the second editor beside it (editor2).
  select case when m[1] is null then c.editor
              else (select r ->> 'editor' from jsonb_array_elements(c.rounds) r where r ->> 'n' = m[1] limit 1) end,
         case when m[1] is null then c.editor2
              else (select r ->> 'editor2' from jsonb_array_elements(c.rounds) r where r ->> 'n' = m[1] limit 1) end
    into v_editor, v_editor2
  from public.clients c where c.id = p_client;
  return ('@editor' = any (w.persons) and v_editor is not null and (v_editor = me or v_editor2 is not distinct from me))
    or ('@editor-free' = any (w.persons) and v_editor is null
        and me = any (coalesce((select w1.persons from private.protocol_writers w1 where w1.key = '@editors'), '{}')));
end $$;

create or replace function private.protocol_write_as(p_person text, p_client uuid, p_key text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  m text[];
  w private.protocol_writers;
  v_rule text;
  v_editor text;
  v_editor2 text;
begin
  if p_person is null then return false; end if;
  if p_person = any (coalesce((select w0.persons from private.protocol_writers w0 where w0.key = '@office'), '{}')) then return true; end if;
  m := regexp_match(coalesce(p_key, ''), '^(?:r([0-9]+)\.)?((p[0-9]+[ab]?)\.(.+))$');
  if m is null then return false; end if;
  select * into w from private.protocol_writers x where x.key = m[2];
  if not found then
    v_rule := case
      when m[4] = 'claim' then m[3] || '.@claim'
      when m[4] in ('wait', 'waited') then m[3] || '.@wait'
      when m[4] = 'pause' then m[3] || '.@pause'
      when m[4] ~ '^handoff\.[a-z0-9]+$' then m[3] || '.@part'
      when m[4] ~ '^fixed\.[0-9]+(\.[0-9]+)?$' then m[3] || '.@qafixed' end;
    select * into w from private.protocol_writers x where x.key = v_rule;
  end if;
  if w.key is null or (m[1] is not null and not w.round) then return false; end if;
  if p_person = any (w.persons) then return true; end if;
  if not (w.persons && array['@editor', '@editor-free']) then return false; end if;
  select case when m[1] is null then c.editor
              else (select r ->> 'editor' from jsonb_array_elements(c.rounds) r where r ->> 'n' = m[1] limit 1) end,
         case when m[1] is null then c.editor2
              else (select r ->> 'editor2' from jsonb_array_elements(c.rounds) r where r ->> 'n' = m[1] limit 1) end
    into v_editor, v_editor2
  from public.clients c where c.id = p_client;
  return ('@editor' = any (w.persons) and v_editor is not null and (v_editor = p_person or v_editor2 is not distinct from p_person))
    or ('@editor-free' = any (w.persons) and v_editor is null
        and p_person = any (coalesce((select w1.persons from private.protocol_writers w1 where w1.key = '@editors'), '{}')));
end $$;

-- ── C4. The landing's personal link: the clients the second editor edits too ──
create or replace function private.landing_link_clients(p_person text) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.clients c
  where c.landing and c.status in ('active', 'ending')
    and (p_person in ('irit', 'lior', 'ofir', 'ilai', 'eli')
      or c.editor = p_person or c.editor2 = p_person
      or exists (select 1 from jsonb_array_elements(coalesce(c.rounds, '[]'::jsonb)) r where r ->> 'editor' = p_person or r ->> 'editor2' = p_person)
      or (p_person = 'nirel' and c.shoot_type = 'natali'));
$$;

create or replace function public.landing_link_read(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_person text := private.landing_link_who(p_token);
begin
  if v_person is null then raise exception 'link not valid' using errcode = '42501'; end if;
  update private.landing_links set last_used_at = now(), uses = uses + 1
  where token_hash = private.landing_link_hash(p_token);
  return jsonb_build_object(
    'person', v_person,
    'expires_at', (select l.expires_at from private.landing_links l where l.token_hash = private.landing_link_hash(p_token)),
    'clients', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'business', c.business, 'package_name', c.package_name, 'shoot_type', c.shoot_type,
        'characterizer', c.characterizer, 'has_logo', c.has_logo, 'editor_name', c.editor_name, 'deal_at', c.deal_at,
        'char_at', c.char_at, 'shoot_at', c.shoot_at, 'contract_end', c.contract_end, 'status', c.status,
        'created_at', c.created_at, 'deliverables', c.deliverables, 'rounds', c.rounds, 'editor', c.editor, 'editor2', c.editor2,
        'protocol_version', c.protocol_version, 'landing', c.landing, 'landed_at', c.landed_at, 'landing_slot', c.landing_slot))
      from public.clients c where c.id in (select private.landing_link_clients(v_person))), '[]'::jsonb),
    'checks', coalesce((select jsonb_agg(jsonb_build_object('client_id', k.client_id, 'item_key', k.item_key, 'state', k.state, 'note', k.note, 'at', k.at))
      from public.protocol_checks k where k.client_id in (select private.landing_link_clients(v_person))), '[]'::jsonb),
    'marks', coalesce((select jsonb_agg(jsonb_build_object('client_id', m.client_id, 'item_key', m.item_key, 'choice', m.choice, 'person', m.person, 'at', m.at))
      from public.client_landing_marks m where m.client_id in (select private.landing_link_clients(v_person))), '[]'::jsonb),
    'done', coalesce((select jsonb_agg(jsonb_build_object('client_id', d.client_id, 'person', d.person, 'done', d.done, 'at', d.at))
      from public.client_landing_done d where d.client_id in (select private.landing_link_clients(v_person))), '[]'::jsonb));
end $$;
