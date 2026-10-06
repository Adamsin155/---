-- Security hardening after the audit of 6.10.2026 (docs/ops.md, section 36).
--
-- Every statement can run again safely, nothing here moves or removes a row of the
-- office's data, and the file holds no statement that removes an object or a row
-- (the production tool refuses those): functions are replaced in place, grants are
-- narrowed, triggers are added, a policy is created only where it is missing.
-- Tested in tests/sql/security-hardening.test.mjs.
--
--   1. Quotes: cancelling one is for the office (creating: the create-quote function).
--   2. Tasks: outside the office a task is changed only by its owner or by whoever
--      opened it, and only "done" / "started" / how it ended; a task opened by someone
--      outside the office gives nobody a client or its vault.
--   3. The client's logins form never replaces a login the office saved or checked;
--      the client's free-text note is read only by whoever has the vault.
--   4. clients.metricool_blog_id, metricool_brand and quote_id change only inside the
--      functions that own them; clients.links keeps https:// addresses only.
--   5. Archive: the missing "hidden" policy, and the three link pages that looked at
--      the status only (scripts, the Gantt, the gallery).
--   6. The staff list: the vault flag is no longer readable through the API.
--   7. The files bucket: a list of content types.
--   8. Functions that the signed-out role could call for no reason.
--   9. A notification's address is a page of the site.

-- ── 1. Quotes ────────────────────────────────
-- Before: any staff login (an editor, Eli, a sales agent). The sales agents send a
-- deal request (deal.html) and never touch a quote; the builder and "הצעות שנשלחו"
-- are the office's (public.is_office(): the owner, Irit, Lior, Ofir and Ilai).
create or replace function public.cancel_quote(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_office() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.quotes set status = 'cancelled' where id = p_id and status = 'sent';
  if not found then
    raise exception 'only unsigned quotes can be cancelled' using errcode = '22023';
  end if;
end $$;

-- ── 2. Tasks ─────────────────────────────────
-- Does a task count toward seeing its client (and toward the client's vault)? Not
-- when a staff login outside the office opened it. Before, an editor could keep a
-- client for good by opening a task for themselves, and make someone else "assigned"
-- (and so eligible for the client's vault) by opening a task in their name. Tasks the
-- office opened, and the ones the system opens (the status page, the logins form,
-- WhatsApp: created_by_email is '' there), count as before.
-- The office here is the same list as public.is_office().
create or replace function private.task_gives_access(p_created_by text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from public.staff s
    where s.email = lower(coalesce(p_created_by, ''))
      and s.person is not null and s.person not in ('irit', 'lior', 'ofir', 'ilai'));
$$;
revoke execute on function private.task_gives_access(text) from public, anon, authenticated;

-- The four forms of the one rule (20260930130000_assignment_rls.sql and
-- 20261003140000_manager_features.sql), each with the condition above on its tasks.
create or replace function private.my_assigned_clients() returns setof uuid
language sql stable security definer set search_path = '' as $$
  with me as (select public.my_person() as p)
  select c.id from public.clients c, me
  where me.p is not null and (
    c.editor = me.p
    or exists (select 1 from jsonb_array_elements(c.rounds) r where r ->> 'editor' = me.p))
  union
  select t.client_id from public.client_tasks t, me
  where t.owner = me.p and private.task_gives_access(t.created_by_email)
    and (t.done_at is null or t.done_at > now() - interval '30 days');
$$;

create or replace function private.my_clients() returns setof uuid
language sql stable security definer set search_path = '' as $$
  with me as (select public.my_person() as p)
  select a.id from private.my_assigned_clients() as a(id)
  union
  select c.id from public.clients c, me
  where me.p = 'nirel' and c.shoot_type = 'natali'
  union
  select c.id from public.clients c, me
  where me.p = 'eli' and private.shoot_in_window(c.shoot_at, c.rounds);
$$;

create or replace function private.is_assigned(p_client uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  with me as (select public.my_person() as p)
  select me.p is not null and (
    exists (select 1 from public.clients c where c.id = p_client
      and (c.editor = me.p or exists (select 1 from jsonb_array_elements(c.rounds) r where r ->> 'editor' = me.p)))
    or exists (select 1 from public.client_tasks t where t.client_id = p_client and t.owner = me.p
      and private.task_gives_access(t.created_by_email)
      and (t.done_at is null or t.done_at > now() - interval '30 days')))
  from me;
$$;

create or replace function public.can_see_client(p_client uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  with me as (select public.my_person() as p)
  select not private.is_archived(p_client) and (public.is_office() or (me.p is not null and (
    private.is_assigned(p_client)
    or exists (select 1 from public.clients c where c.id = p_client and (
      (me.p = 'nirel' and c.shoot_type = 'natali')
      or (me.p = 'eli' and private.shoot_in_window(c.shoot_at, c.rounds)))))))
  from me;
$$;

-- Changing a task from outside the office. client_tasks_guard (20260930130000) refuses
-- only moving it (another owner or client) and reopening an old one: anyone who saw
-- the client could close, reopen or rewrite a colleague's task. A second trigger, which
-- fires after it and after client_tasks_route_guard (their answers stay as they were)
-- and before the triggers that stamp who and when. For a signed-in user outside the
-- office writing the table directly:
--   - only a task that is theirs, or that they opened themselves (an editor's pause
--     notices to Lior and Ofir close when the editing resumes: app/editor.js);
--   - only what the screens change: done_at ("בוצע" and its undo), started_at
--     ("התחלתי") and result (how a brief ended; client_tasks_route_guard keeps it to
--     the task's owner). Who and when are stamped by the other triggers.
-- The system's own functions (the status page, WhatsApp answers, the reminders) run
-- as the database owner and are not looked at here, as before.
create or replace function public.client_tasks_scope_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  free text[] := array['done_at', 'done_by_email', 'started_at', 'started_by_email', 'result'];
begin
  if me = '' or current_user is distinct from 'authenticated' or public.is_office() then
    return new;
  end if;
  if old.owner is distinct from public.my_person() and old.created_by_email is distinct from me then
    raise exception 'not allowed: this task is someone else''s' using errcode = '42501';
  end if;
  if (to_jsonb(new) - free) is distinct from (to_jsonb(old) - free) then
    raise exception 'not allowed: only the office changes what a task says' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.client_tasks_scope_guard() from public, anon, authenticated;
create or replace trigger client_tasks_scope_guard before update on public.client_tasks
for each row execute function public.client_tasks_scope_guard();

-- ── 3. The client's logins form ──────────────
-- The client's free text ("למי מגיע קוד האימות"…) was readable by the whole office
-- without the vault. It moves to a column the API does not grant, read through
-- access_link_notes() by whoever may use that client's vault. client_note itself
-- stays (a page published before this one reads it) and stays empty from here on.
alter table public.client_access_links add column if not exists client_note_private text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_access_links_note_private_len') then
    alter table public.client_access_links add constraint client_access_links_note_private_len
      check (client_note_private is null or char_length(client_note_private) <= 1000);
  end if;
end $$;
update public.client_access_links set client_note_private = client_note, client_note = null
where client_note is not null;

create or replace function public.access_link_notes(p_clients uuid[] default null)
returns table (link_id uuid, note text)
language sql stable security definer set search_path = '' as $$
  select l.id, l.client_note_private
  from public.client_access_links l
  where l.client_note_private is not null
    and (p_clients is null or l.client_id = any (p_clients))
    and (select public.can_use_vault())
    and public.can_use_client_vault(l.client_id);
$$;
revoke execute on function public.access_link_notes(uuid[]) from public, anon;
grant execute on function public.access_link_notes(uuid[]) to authenticated;

-- The form's rules, as in 20261008100000_client_access_form.sql, with one change:
-- the notes are capped at 300 characters (NOTES_MAX in app/access-logic.js; they are
-- for "who gets the verification code", never a place for a password).
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
    if v_choice is null or v_choice not in ('have', 'none', 'reset') or (not v_main and v_choice <> 'have') then return 'choice'; end if;
    if char_length(v_user) > 200 or v_user ~ '[\x01-\x1f\x7f]' then return 'username'; end if;
    if v_choice = 'have' then
      if v_user = '' then return 'username'; end if;
      if btrim(v_pass) = '' or char_length(v_pass) > 200 or v_pass ~ '[\x01-\x1f\x7f]' then return 'password'; end if;
    else
      if v_pass <> '' then return 'password'; end if;
      if v_choice = 'none' and v_user <> '' then return 'username'; end if;
    end if;
    v_key := v_net || ':' || lower(v_label);
    if v_key = any (seen) then return 'duplicate'; end if;
    seen := seen || v_key;
  end loop;
  if not (array['instagram:', 'facebook:', 'tiktok:'] <@ seen) then return 'required'; end if;
  return null;
end $$;
revoke execute on function private.access_form_problem(jsonb) from public, anon, authenticated;

-- The submission, as before, except for what it does to a login that is already in
-- the vault. Before, the row of the same network was rewritten and its password left
-- Vault for good: with imported clients, whose logins the office had already saved,
-- anyone holding a forwarded link could wipe them.
--
-- Now a row is KEPT (never touched by the form) when it holds a password and the
-- office saved or checked it: its status is 'ok', or the last to save it was a person
-- and not the form. What the client sent then goes into a SECOND row of the same
-- network, marked as the client's ("מהלקוח, <date>" as its label; a custom platform
-- keeps its name), with the status the client's choice gives ('new' / 'missing' /
-- 'broken'). The office sees both in the card and decides which stays. A later form
-- of the same client updates that second row, its own, and never the office's.
-- No stored password leaves Vault here any more: the client's own unchecked row gets
-- its new password in place (vault.update_secret).
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
    v_status := case v_choice when 'have' then 'new' when 'none' then 'missing' else 'broken' end;
    v_note := case v_choice
      when 'have' then 'מהלקוח, בטופס פרטי הכניסה. עוד לא נבדק.'
      when 'none' then 'מהלקוח, בטופס פרטי הכניסה: אין כיום, צריך לפתוח.'
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
        and x.updated_by = 'client-form' and x.status <> 'ok'
        and (v_net <> 'other' or lower(btrim(coalesce(x.label, ''))) = lower(v_label))
      order by x.created_at, x.id limit 1;
      v_new := a.id is null;
      v_note := v_note || ' הפרטים שכבר היו בכספת נשארו בשורה נפרדת: לבדוק איזו נכונה.';
      if v_net <> 'other' then
        v_row_label := 'מהלקוח, ' || to_char(v_now at time zone 'Asia/Jerusalem', 'FMDD.FMMM.YYYY');
      end if;
    end if;
    if v_new then
      insert into public.client_access (client_id, network, label, username, status, note, updated_by, updated_at)
      values (c.id, v_net, v_row_label, v_user, v_status, v_note, 'client-form', v_now)
      returning id into v_rid;
    else
      v_rid := a.id;
      update public.client_access
      set username = case when v_choice = 'have' or (v_choice = 'reset' and v_user is not null) then v_user else username end,
          label = case when v_beside then v_row_label else label end,
          status = v_status, note = v_note, updated_by = 'client-form', updated_at = v_now
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

-- ── 4. Columns of a client that belong to a function ──
-- "office edits clients" lets the whole office change any column with a plain
-- request. Three columns have an owner that checks who is asking:
--   metricool_blog_id, metricool_brand   public.gantt_set_brand (Ilai and the owner),
--                                        and the metricool function (service role);
--   quote_id                             set when the client is opened (the signing
--                                        trigger, or the "לקוח חדש" form from a signed
--                                        agreement), and not changed afterwards: it
--                                        decides whose prices and agreement the card shows.
-- A signed-in user's own write keeps them as they were (the rest of the row is saved);
-- the functions, the service role and an import as the database owner pass, as with
-- clients_metricool_none_guard. The name sorts before that trigger, which reads the brand.
create or replace function public.clients_columns_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      new.metricool_blog_id := null;
      new.metricool_brand := null;
    else
      new.metricool_blog_id := old.metricool_blog_id;
      new.metricool_brand := old.metricool_brand;
      new.quote_id := old.quote_id;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.clients_columns_guard() from public, anon, authenticated;
create or replace trigger clients_columns_guard before insert or update on public.clients
for each row execute function public.clients_columns_guard();

-- The links of the card become addresses that the pages open (href). Until now any
-- text could be stored (the check was only "an object"). A value that a signed-in
-- user adds or changes must be an https:// address (or empty); values that are
-- already there are not looked at, so an imported row with an odd link still saves
-- its other fields, and the pages skip a stored value that is not https (safeLink).
-- An import as the database owner is not checked, as with the guards above.
create or replace function public.clients_links_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  k text;
  v jsonb;
begin
  if current_user is distinct from 'authenticated' or (tg_op = 'UPDATE' and new.links is not distinct from old.links) then
    return new;
  end if;
  for k, v in select key, value from jsonb_each(coalesce(new.links, '{}'::jsonb)) loop
    if tg_op = 'UPDATE' and v is not distinct from (old.links -> k) then continue; end if;
    if jsonb_typeof(v) = 'null' or v = '""'::jsonb then continue; end if;
    if jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') > 2000 or (v #>> '{}') !~ '^https://[^\s"<>]+$' then
      raise exception 'links: only an https:// address is kept (%)', left(k, 40) using errcode = '23514';
    end if;
  end loop;
  return new;
end $$;
revoke execute on function public.clients_links_guard() from public, anon, authenticated;
create or replace trigger clients_links_guard before insert or update on public.clients
for each row execute function public.clients_links_guard();

-- ── 5. Archive ───────────────────────────────
-- "archived clients are hidden" was put on every table with a client_id once
-- (20261003140000_manager_features.sql); a table made later did not get it. It is
-- created here wherever it is missing. Not on:
--   client_admin_log   the archive's own log, read by whoever archives;
--   staff_tasks        a task given on the spot only carries the client's name, and
--                      hiding it from its assignee would leave it ringing every 10
--                      minutes with nothing to mark (docs/ops.md, section 36).
do $$
declare t record;
begin
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'client_id'
      and c.table_name not in ('clients', 'client_admin_log', 'staff_tasks')
      and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.table_name
                      and p.policyname = 'archived clients are hidden')
  loop
    execute format('create policy %I on public.%I as restrictive for all to authenticated '
      || 'using (client_id is null or client_id not in (select private.archived_client_ids())) '
      || 'with check (client_id is null or client_id not in (select private.archived_client_ids()))',
      'archived clients are hidden', t.table_name);
  end loop;
end $$;

-- The three pages a client opens with a link looked at the status only, so the
-- scripts, the Gantt and the gallery of an archived client kept opening.
create or replace function public.get_scripts(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  l public.script_share_links;
  c public.clients;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then return jsonb_build_object('state', 'invalid'); end if;
  select * into l from public.script_share_links s where s.token_hash = private.status_token_hash(p_token);
  if not found then return jsonb_build_object('state', 'invalid'); end if;
  if l.revoked_at is not null then return jsonb_build_object('state', 'revoked'); end if;
  if l.expires_at <= now() then return jsonb_build_object('state', 'expired'); end if;
  select * into c from public.clients where id = l.client_id;
  if not found or c.status not in ('active', 'ending') or c.archived_at is not null then return jsonb_build_object('state', 'closed'); end if;
  return jsonb_build_object(
    'state', 'ok',
    'preview', public.is_staff(),
    'expiresAt', l.expires_at,
    'client', jsonb_build_object('name', c.name, 'business', coalesce(nullif(btrim(c.business), ''), c.name)),
    'scripts', coalesce((select jsonb_agg(jsonb_build_object('round', s.round, 'n', s.n, 'title', s.title, 'body', s.body,
                          'links', (select coalesce(jsonb_agg(x.value), '[]'::jsonb) from jsonb_array_elements(s.links) x
                                    where jsonb_typeof(x.value) = 'string' and (x.value #>> '{}') ~ '^https?://[^\s"<>]+$'),
                          'status', s.status, 'at', s.at) order by s.round, s.n)
                         from public.client_scripts s
                         where s.client_id = c.id and (btrim(s.title) <> '' or btrim(s.body) <> '')), '[]'::jsonb));
end $$;

create or replace function private.gantt_check(p_token text)
returns table (link_id uuid, client_id uuid, expires_at timestamptz, reason text)
language plpgsql stable security definer set search_path = '' as $$
declare
  l public.client_gantt_links;
  st text;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return query select null::uuid, null::uuid, null::timestamptz, 'invalid'::text; return;
  end if;
  select * into l from public.client_gantt_links g
  where g.token_hash = encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex');
  if not found then
    return query select null::uuid, null::uuid, null::timestamptz, 'invalid'::text; return;
  end if;
  select c.status into st from public.clients c where c.id = l.client_id and c.archived_at is null;
  return query select l.id, l.client_id, l.expires_at,
    case when l.revoked_at is not null then 'revoked'
         when l.expires_at <= now() then 'expired'
         when st is null or st not in ('active', 'ending') then 'closed'
         else null end;
end $$;

create or replace function private.gallery_check(p_token text)
returns table (link_id uuid, client_id uuid, expires_at timestamptz, reason text)
language plpgsql stable security definer set search_path = '' as $$
declare
  l public.client_gallery_links;
  st text;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return query select null::uuid, null::uuid, null::timestamptz, 'invalid'::text; return;
  end if;
  select * into l from public.client_gallery_links g where g.token_hash = private.status_token_hash(p_token);
  if not found then
    return query select null::uuid, null::uuid, null::timestamptz, 'invalid'::text; return;
  end if;
  select c.status into st from public.clients c where c.id = l.client_id and c.archived_at is null;
  return query select l.id, l.client_id, l.expires_at,
    case when l.revoked_at is not null then 'revoked'
         when l.expires_at <= now() then 'expired'
         when st is null or st not in ('active', 'ending', 'ended') then 'closed'
         else null end;
end $$;
revoke execute on function private.gantt_check(text) from public, anon, authenticated;
revoke execute on function private.gallery_check(text) from public, anon, authenticated;

-- ── 6. The staff list ────────────────────────
-- "staff read staff" lets every login read every row. The screens read three
-- columns: email and person (the directory: who marked what, by name) and phone (the
-- handoff buttons open a WhatsApp chat with the next person; everyone who hands work
-- over uses them). Who has the vault, and since when a row exists, were readable too
-- and no screen asks for them: the team screen gets its list from the staff-admin
-- function, and the database's own rules (can_use_vault) read the table themselves.
revoke select on public.staff from authenticated;
revoke select (vault, created_at) on public.staff from authenticated;
grant select (email, person, phone) on public.staff to authenticated;

-- ── 7. The files bucket ──────────────────────
-- Any content type was accepted. The list below is what the card uploads
-- (UPLOAD_TYPES in app/files-logic.js; tests/sql/security-hardening.test.mjs keeps the
-- two the same): pictures, videos and sound, PDF and the logo formats, office
-- documents, fonts, archives, plain text, the small text/uri-list object the card keeps
-- for a link in place of a file, and "unknown binary" (how a browser reports
-- .ai, .eps or .psd). Not on it, and so refused by Storage: a web page, a script, XML.
update storage.buckets
set allowed_mime_types = array[
  'image/*', 'video/*', 'audio/*', 'font/*',
  'application/pdf', 'application/postscript', 'application/illustrator', 'application/eps', 'application/x-eps',
  'application/octet-stream', 'application/zip', 'application/x-zip-compressed',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-fontobject', 'application/x-font-ttf', 'application/x-font-otf', 'application/font-woff',
  'text/plain', 'text/csv', 'text/uri-list']
where id = 'client-files';

-- ── 8. Functions the signed-out role could call ──
-- Four trigger functions and the deliverables calculator kept the default "everyone
-- may execute". Nothing calls them through the API: the triggers fire by themselves,
-- and package_deliverables() is called by the signing trigger and by a migration.
revoke execute on function public.client_tasks_stamp() from public, anon, authenticated;
revoke execute on function public.clients_touch() from public, anon, authenticated;
revoke execute on function public.office_reviews_stamp() from public, anon, authenticated;
revoke execute on function public.protocol_stamp() from public, anon, authenticated;
revoke execute on function public.package_deliverables(jsonb) from public, anon, authenticated;

-- ── 9. A notification's address ──────────────
-- reminder_log.url is opened by the inbox and by the phone's notification. The check
-- it had ("no scheme") still let "//host/…" through, which a browser reads as another
-- site. From here on: a page of the site, with its query and fragment. Rows already
-- written are not checked again.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reminder_log_url_page') then
    alter table public.reminder_log add constraint reminder_log_url_page
      check (url is null or url ~ '^[a-z0-9-]+\.html([?#][^\s\\]*)?$') not valid;
  end if;
end $$;
