-- The client's "social network logins" form (the owner's request of 6.10.2026):
-- a secret link sent with the welcome message, where the client fills the user
-- names and passwords of the social networks. The page is access.html
-- (app/access-form.js; the rules in app/access-logic.js).
--
--   client_access_links   one secret link per client, the same mechanism as the
--                         status page's link (20260930170000_client_status.sql): 32
--                         random bytes; only a SHA-256 hash of the token is kept in
--                         the table, the token itself sits encrypted in Vault so the
--                         office can copy the link again. It expires 14 days after it
--                         was made AND is closed by a successful submission (one use).
--                         A new link revokes the one before it; a link that is
--                         revoked, expired or filled has no token in Vault any more.
--                         The submission's time, the platforms and the choices (never
--                         a user name or a password) and the client's notes stay on
--                         the row. No IP and no browser are kept, as the status page
--                         keeps none for an opening.
--
-- The page is anonymous and write-only. It reaches the database ONLY through
--   access_form_info(token)             the business name and the link's state;
--   access_form_submit(token, payload)  checks the payload strictly and writes into
--                                       the EXISTING vault exactly as access_save()
--                                       does (the password into vault.secrets, a row
--                                       in client_access), and answers only a state.
-- Nothing stored is ever returned, to the client or to anyone, by either function.
--
-- What the client chose becomes the vault's status:
--   'have'  (user name + password)        → 'new': received from the client, not
--                                           checked yet. A NEW value of
--                                           client_access.status; Ilai's check (6) is
--                                           not done by it.
--   'none'  ("אין כיום, צריך לפתוח")       → 'missing', and one urgent task for Ilai
--                                           to open the pages, as the card opens it.
--   'reset' ("יש, וצריך לחדש סיסמה")       → 'broken' (Lior's "גישה שבורה" ladder
--                                           follows broken_since, as today).
-- A row of the same network is UPDATED (its id stays; a new password replaces the
-- old secret, which is deleted from Vault), never duplicated. Only the networks the
-- client filled are touched. Every row is stamped 'client-form' in updated_by and in
-- the vault's log, so the card shows who set what and when.
--
-- A submission marks p05.access and p05.vault (when they are not done yet) as the end
-- of the characterization does, so Ilai's "קיבלת גישות" and his 30 office minutes
-- start from it (app/reminder-rules.js, rule `access`).
--
-- Who may open the passwords does not change here: the vault flag and
-- can_use_client_vault(), as before.
--
-- After 20261006100100_date_change_note.sql. Every statement can run again safely;
-- no existing row is changed except the welcome template when it still has its
-- original words. Tested in a real Postgres with every migration:
-- tests/sql/access-form.test.mjs.

-- ── 1. The status 'new' ──────────────────────
-- Every check on the column is rebuilt (its name is the default one; whatever it is,
-- it goes), then the one list.
do $$
declare r record;
begin
  for r in
    select c.conname from pg_constraint c
    where c.conrelid = 'public.client_access'::regclass and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ~ '\mstatus\M'
  loop
    execute format('alter table public.client_access drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.client_access add constraint client_access_status_check
  check (status in ('ok', 'broken', 'missing', 'new'));

-- The status of each login for the office's own work, as access_status_for_work()
-- (20261006100000) with one more column, `by_client`: the row was set by the client's
-- form and nobody of the office saved it since. A status the client gave is not a
-- check (app/ilai-logic.js). A function of its own, so that the older one keeps its
-- shape (its migration stays safe to run again, and a page published before this one
-- keeps working). Never a user name, a note or a password.
create or replace function public.access_work_statuses(p_clients uuid[] default null)
returns table (client_id uuid, network text, label text, status text, updated_at timestamptz, by_client boolean)
language sql stable security definer set search_path = '' as $$
  select a.client_id, a.network, a.label, a.status, a.updated_at, a.updated_by is not distinct from 'client-form'
  from public.client_access a
  join public.clients c on c.id = a.client_id and c.archived_at is null
  where (select public.is_office())
    and (p_clients is null or a.client_id = any (p_clients))
  order by a.client_id, a.created_at;
$$;
revoke execute on function public.access_work_statuses(uuid[]) from public, anon;
grant execute on function public.access_work_statuses(uuid[]) to authenticated;

-- ── 2. Who manages the links ─────────────────
-- The owner, Irit, Lior and Ofir create, copy and revoke them (the office reads them).
create or replace function public.can_manage_access_links() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff() and exists (
    select 1 from public.staff s
    where s.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (s.person is null or s.person in ('irit', 'lior', 'ofir'))
  );
$$;
revoke execute on function public.can_manage_access_links() from public, anon;
grant execute on function public.can_manage_access_links() to authenticated;

-- ── 3. The links ─────────────────────────────
create table if not exists public.client_access_links (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  secret_id uuid,
  created_at timestamptz not null default now(),
  created_by text not null default '',
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by text,
  submitted_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  last_attempt_at timestamptz,
  summary jsonb,
  client_note text check (client_note is null or char_length(client_note) <= 1000)
);
create index if not exists client_access_links_client_idx on public.client_access_links (client_id, created_at desc);

alter table public.client_access_links enable row level security;
drop policy if exists "office reads access links" on public.client_access_links;
create policy "office reads access links" on public.client_access_links
  for select to authenticated using ((select public.is_office()));
revoke all on public.client_access_links from anon, authenticated;
-- Not the hash nor the Vault id: the token is read through access_link_token().
grant select (id, client_id, created_at, created_by, expires_at, revoked_at, revoked_by, submitted_at, attempts, summary, client_note)
  on public.client_access_links to authenticated;

-- A link's token leaves Vault with the link (a client removed takes both), and as
-- soon as the link is revoked or filled.
create or replace function public.client_access_links_cleanup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.secret_id is not null then delete from vault.secrets where id = old.secret_id; end if;
  return old;
end $$;
revoke execute on function public.client_access_links_cleanup() from public, anon, authenticated;
drop trigger if exists client_access_links_cleanup on public.client_access_links;
create trigger client_access_links_cleanup after delete on public.client_access_links
for each row execute function public.client_access_links_cleanup();

create or replace function public.client_access_links_forget() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.revoked_at is not null or new.submitted_at is not null) and old.secret_id is not null then
    delete from vault.secrets where id = old.secret_id;
    new.secret_id := null;
  end if;
  return new;
end $$;
revoke execute on function public.client_access_links_forget() from public, anon, authenticated;
drop trigger if exists client_access_links_forget on public.client_access_links;
create trigger client_access_links_forget before update on public.client_access_links
for each row execute function public.client_access_links_forget();

-- ── 4. Helpers (private: only the functions here call them) ──
-- The link a token opens, and why not when it does not: 'invalid' (malformed or
-- unknown), 'revoked', 'done' (already filled), 'locked' (5 refused submissions),
-- 'expired', or 'closed' (the client ended, was cancelled or archived).
create or replace function private.access_link_reason(l public.client_access_links) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when l.id is null then 'invalid'
    when l.revoked_at is not null then 'revoked'
    when l.submitted_at is not null then 'done'
    when l.attempts >= 5 then 'locked'
    when l.expires_at <= now() then 'expired'
    when not exists (select 1 from public.clients c where c.id = l.client_id
                     and c.status in ('active', 'ending') and c.archived_at is null) then 'closed'
    else null end;
$$;

-- A network as the office reads it (NETWORK_NAMES in app/access-logic.js).
create or replace function private.access_network_name(p_network text, p_label text) returns text
language sql immutable set search_path = '' as $$
  select case p_network
    when 'instagram' then 'Instagram' when 'facebook' then 'Facebook' when 'tiktok' then 'TikTok'
    when 'youtube' then 'YouTube' when 'google' then 'Google Business' when 'meta' then 'Meta Business'
    else coalesce(nullif(btrim(p_label), ''), 'אחר') end;
$$;

-- What is wrong with a submission (null: it may be saved). The same rules as
-- payloadProblem() in app/access-logic.js (tests/sql/access-form.test.mjs runs both
-- on the same cases):
--   { entries: [{ network, label, choice, username, password }], notes }
--   - 3 to 12 entries, no other field anywhere, every value a string or null;
--   - instagram, facebook and tiktok each exactly once, with a choice;
--   - besides them only youtube, google, meta or 'other' with a label of 1–40
--     characters, always with a user name and a password;
--   - 'have': a user name (1–200) and a password (1–200); 'reset': a user name is
--     optional and there is no password; 'none': neither;
--   - no control character (a line break, a tab) in a label, a user name or a
--     password; notes up to 1000 characters; no network twice.
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
  if char_length(coalesce(p ->> 'notes', '')) > 1000 then return 'notes too long'; end if;
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

revoke execute on function private.access_link_reason(public.client_access_links) from public, anon, authenticated;
revoke execute on function private.access_network_name(text, text) from public, anon, authenticated;
revoke execute on function private.access_form_problem(jsonb) from public, anon, authenticated;

-- ── 5. The page (anonymous, by token) ────────
-- Only: the state, and for a link that can still be filled the business name.
-- `preview`: a signed-in staff member is looking (they cannot send it).
create or replace function public.access_form_info(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  l public.client_access_links;
  v_reason text;
  v_business text;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return jsonb_build_object('state', 'invalid');
  end if;
  select * into l from public.client_access_links s where s.token_hash = private.status_token_hash(p_token);
  v_reason := private.access_link_reason(l);
  if v_reason is not null then
    return jsonb_build_object('state', v_reason);
  end if;
  select coalesce(nullif(btrim(c.business), ''), c.name) into v_business from public.clients c where c.id = l.client_id;
  return jsonb_build_object('state', 'ok', 'business', v_business, 'preview', public.is_staff());
end $$;

-- The submission. Answers { state: 'done' } once everything is saved; { state:
-- 'refused', left: n } when the payload breaks a rule (counted: after 5 the link is
-- locked); or { state: <why the link does not open> }. Never a stored value.
-- The link's row and then the client's row are locked, so two submissions sent at the
-- same moment cannot interleave: the second finds the link filled.
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
  v_choice text;
  v_user text;
  v_pass text;
  v_status text;
  v_note text;
  v_rid uuid;
  v_sid uuid;
  v_new boolean;
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

    -- The row of this network, when the vault has one (the oldest; 'other' by its name).
    select * into a from public.client_access x
    where x.client_id = c.id and x.network = v_net
      and (v_net <> 'other' or lower(btrim(coalesce(x.label, ''))) = lower(v_label))
    order by x.created_at, x.id limit 1;
    v_new := a.id is null;
    if v_new then
      insert into public.client_access (client_id, network, label, username, status, note, updated_by, updated_at)
      values (c.id, v_net, v_label, v_user, v_status, v_note, 'client-form', v_now)
      returning id into v_rid;
    else
      v_rid := a.id;
      update public.client_access
      set username = case when v_choice = 'have' or (v_choice = 'reset' and v_user is not null) then v_user else username end,
          status = v_status, note = v_note, updated_by = 'client-form', updated_at = v_now
      where id = v_rid;
    end if;
    if v_choice = 'have' then
      -- The password: a new secret; the one before it leaves Vault.
      if not v_new and a.secret_id is not null then
        update public.client_access set secret_id = null where id = v_rid;
        delete from vault.secrets where id = a.secret_id;
      end if;
      v_sid := vault.create_secret(v_pass, 'client_access:' || v_rid::text, 'client social access');
      update public.client_access set secret_id = v_sid where id = v_rid;
    end if;
    insert into public.client_access_log (access_id, client_id, network, action, by_email)
    values (v_rid, c.id, v_net, case when v_new then 'create' else 'update' end, 'client-form');

    v_all := v_all || private.access_network_name(v_net, v_label);
    if v_choice = 'none' and (v_new or a.status is distinct from 'missing') then
      v_open := v_open || private.access_network_name(v_net, v_label);
    end if;
    v_summary := v_summary || jsonb_build_object('network', v_net, 'label', v_label, 'choice', v_choice);
  end loop;

  -- The link is closed: one use. Its token leaves Vault (client_access_links_forget).
  update public.client_access_links
  set submitted_at = v_now, summary = v_summary, client_note = nullif(btrim(coalesce(p_payload ->> 'notes', '')), '')
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

-- ── 6. The office: create, copy again, revoke ──
-- A new link for the client (the one still waiting stops working). Returns the token
-- once; access_link_token() gives it again while the link can still be filled.
create or replace function public.access_link_create(p_client uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_token text;
  v_id uuid := gen_random_uuid();
  v_secret uuid;
  v_exp timestamptz := now() + interval '14 days';
begin
  if not public.can_manage_access_links() then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.clients where id = p_client and status in ('active', 'ending') and archived_at is null) then
    raise exception 'client not open' using errcode = '22023';
  end if;
  update public.client_access_links set revoked_at = now(), revoked_by = me
  where client_id = p_client and revoked_at is null and submitted_at is null;
  v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  v_secret := vault.create_secret(v_token, 'access_link:' || v_id::text, 'client social logins form link');
  insert into public.client_access_links (id, client_id, token_hash, secret_id, created_by, expires_at)
  values (v_id, p_client, private.status_token_hash(v_token), v_secret, me, v_exp);
  return jsonb_build_object('id', v_id, 'token', v_token, 'expiresAt', v_exp);
end $$;

create or replace function public.access_link_token(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_secret uuid;
  v_token text;
begin
  if not public.can_manage_access_links() then raise exception 'not allowed' using errcode = '42501'; end if;
  select secret_id into v_secret from public.client_access_links
  where id = p_id and revoked_at is null and submitted_at is null and attempts < 5 and expires_at > now();
  if v_secret is null then return null; end if;
  select decrypted_secret into v_token from vault.decrypted_secrets where id = v_secret;
  return v_token;
end $$;

create or replace function public.access_link_revoke(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_manage_access_links() then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.client_access_links set revoked_at = now(), revoked_by = lower(coalesce(auth.jwt() ->> 'email', ''))
  where id = p_id and revoked_at is null and submitted_at is null;
end $$;

-- ── Grants ───────────────────────────────────
revoke all on function public.access_form_info(text) from public;
revoke all on function public.access_form_submit(text, jsonb) from public;
grant execute on function public.access_form_info(text) to anon, authenticated;
grant execute on function public.access_form_submit(text, jsonb) to anon, authenticated;

revoke all on function public.access_link_create(uuid) from public, anon;
revoke all on function public.access_link_token(uuid) from public, anon;
revoke all on function public.access_link_revoke(uuid) from public, anon;
grant execute on function public.access_link_create(uuid) to authenticated;
grant execute on function public.access_link_token(uuid) to authenticated;
grant execute on function public.access_link_revoke(uuid) to authenticated;

-- ── 7. The messages (the office edits them in messages.html) ──
-- The welcome message gets a place for the link, {פרטי כניסה}: the queue fills it
-- with one line and the link while the client has a link waiting, and with a plain
-- sentence when there is none. The same text as DEFAULT_TEMPLATES in
-- app/messages-logic.js (tests/messages.test.mjs); `access_nudge` is new.
-- A welcome the office already edited keeps its words: the queue adds the line at its
-- end when there is a link (withAccessVar in app/access-logic.js).
-- seed:begin
insert into public.message_templates (key, title, kind, station, body) values
  ('welcome', 'ברוכים הבאים', 'milestone', null, $t$היי {לקוח}, ברוכים הבאים לאסטרטג! שמחים להתחיל לעבוד איתכם.

מי בצוות שלכם:
{צוות}

התאריכים הקרובים:
{תאריכים}

מה נצטרך מכם: לוגו, צבעי המותג, ותמונות וסרטונים שכבר יש לכם. את הגישות לרשתות לא שולחים בהודעה.
{פרטי כניסה}

בכל יום חמישי תקבלו מאיתנו עדכון קצר: מה עשינו, מה הלאה ומה צריך מכם. בכל שאלה אפשר לכתוב לנו.$t$),
  ('access_nudge', 'תזכורת: פרטי הכניסה לרשתות', 'milestone', null, $t$היי {לקוח}, תזכורת קטנה: כדי שנוכל להתחיל לעבוד על הרשתות שלכם חסרים לנו פרטי הכניסה. ממלאים אותם בקישור המאובטח, זה לוקח שתי דקות:
{קישור}
אם משהו לא ברור, כתבו לנו ונעזור.$t$)
on conflict (key) do nothing;
-- seed:end
-- The welcome as it was seeded (20260930100000_client_messages.sql), never edited.
update public.message_templates set body = $t$היי {לקוח}, ברוכים הבאים לאסטרטג! שמחים להתחיל לעבוד איתכם.

מי בצוות שלכם:
{צוות}

התאריכים הקרובים:
{תאריכים}

מה נצטרך מכם: לוגו, צבעי המותג, ותמונות וסרטונים שכבר יש לכם. את הגישות לרשתות לא שולחים בהודעה.
{פרטי כניסה}

בכל יום חמישי תקבלו מאיתנו עדכון קצר: מה עשינו, מה הלאה ומה צריך מכם. בכל שאלה אפשר לכתוב לנו.$t$
where key = 'welcome' and body = $t$היי {לקוח}, ברוכים הבאים לאסטרטג! שמחים להתחיל לעבוד איתכם.

מי בצוות שלכם:
{צוות}

התאריכים הקרובים:
{תאריכים}

מה נצטרך מכם: לוגו, צבעי המותג, ותמונות וסרטונים שכבר יש לכם. את הגישות לרשתות לא שולחים בהודעה: נקבל אותן מכם בשיחה.

בכל יום חמישי תקבלו מאיתנו עדכון קצר: מה עשינו, מה הלאה ומה צריך מכם. בכל שאלה אפשר לכתוב לנו.$t$;
