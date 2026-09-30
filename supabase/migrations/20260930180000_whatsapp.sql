-- Stage 4: the staff WhatsApp channel (docs/plan/system-plan.md, stage 4 and the
-- channel "וו׳" of section 5; docs/ops.md, "וואטסאפ לצוות"). Dormant until the
-- owner turns it on: push notifications stay the main channel, and WhatsApp is a
-- second copy of the rings and the digests for whoever agreed to it.
--
--   app_settings              feature flags. 'whatsapp_enabled' is off until the owner
--                             turns it on (only with the four Vault secrets in place).
--   whatsapp_consent_texts    the exact wording of the consent screen, by version (a
--                             lawyer's change is a new row in a new migration).
--   whatsapp_consents         each person's current choice: WhatsApp or push only, the
--                             number it was given for, and when. Own row only; the
--                             office sees who agreed (whatsapp_team_status, no numbers).
--   whatsapp_consent_log      every choice and withdrawal, with the words shown, the
--                             number, the channel and the time (the evidence).
--   whatsapp_messages         one WhatsApp message per reminder_log row (the dedupe),
--                             with Meta's id and its delivery: sent, delivered, read,
--                             failed.
--   whatsapp_inbound          the replies already handled (Meta's message id: a reply
--                             that comes twice is applied once). No message text.
--
-- The staff number is public.staff.phone (the office sets it on the team screen).
-- The owner's row keeps none there (every staff member reads the staff list), so
-- the owner types a number on the consent screen, kept only in their own consent row.
-- Secrets (Vault, added by the owner; names only here): whatsapp_access_token,
-- whatsapp_phone_number_id, whatsapp_app_secret, whatsapp_verify_token. Only the
-- service-role functions below read them.

-- ── Feature flags ──────────────────────────
create table if not exists public.app_settings (
  key text primary key check (key in ('whatsapp_enabled')),
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by_email text
);
alter table public.app_settings enable row level security;
drop policy if exists "staff read settings" on public.app_settings;
create policy "staff read settings" on public.app_settings
  for select to authenticated using (public.is_staff());
revoke all on public.app_settings from anon, authenticated;
grant select on public.app_settings to authenticated;
insert into public.app_settings (key, value) values ('whatsapp_enabled', 'false') on conflict (key) do nothing;

-- Which of the four secrets are in Vault (never their values).
create or replace function private.whatsapp_secrets_present()
returns table (access_token boolean, phone_number_id boolean, app_secret boolean, verify_token boolean)
language sql stable security definer set search_path = '' as $$
  select
    exists (select 1 from vault.decrypted_secrets where name = 'whatsapp_access_token' and length(decrypted_secret) >= 20),
    exists (select 1 from vault.decrypted_secrets where name = 'whatsapp_phone_number_id' and decrypted_secret ~ '^[0-9]{5,30}$'),
    exists (select 1 from vault.decrypted_secrets where name = 'whatsapp_app_secret' and length(decrypted_secret) >= 16),
    exists (select 1 from vault.decrypted_secrets where name = 'whatsapp_verify_token' and length(decrypted_secret) >= 16);
$$;

create or replace function private.whatsapp_enabled() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select value = 'true'::jsonb from public.app_settings where key = 'whatsapp_enabled'), false);
$$;

-- The owner: a confirmed staff login whose row has no person.
create or replace function private.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff() and exists (
    select 1 from public.staff s where s.email = lower(coalesce(auth.jwt() ->> 'email', '')) and s.person is null);
$$;

-- The flag and which secrets are in place, for the team screen (the office).
create or replace function public.whatsapp_settings() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when public.is_office() then jsonb_build_object(
    'enabled', private.whatsapp_enabled(),
    'owner', private.is_owner(),
    'secrets', (select to_jsonb(s) from private.whatsapp_secrets_present() s))
  end;
$$;

-- On or off, by the owner only; on only when all four secrets are in Vault.
create or replace function public.whatsapp_set_enabled(p_on boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s record;
begin
  if not private.is_owner() then raise exception 'not allowed: owner only' using errcode = '42501'; end if;
  select * into s from private.whatsapp_secrets_present();
  if p_on and not (s.access_token and s.phone_number_id and s.app_secret and s.verify_token) then
    raise exception 'not_ready: WhatsApp secrets are missing in Vault' using errcode = 'P0001';
  end if;
  insert into public.app_settings (key, value, updated_at, updated_by_email)
  values ('whatsapp_enabled', to_jsonb(coalesce(p_on, false)), now(), lower(coalesce(auth.jwt() ->> 'email', '')))
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at, updated_by_email = excluded.updated_by_email;
  return public.whatsapp_settings();
end $$;

-- ── Consent ────────────────────────────────
create table if not exists public.whatsapp_consent_texts (
  version integer primary key check (version > 0),
  title text not null,
  body text not null,          -- paragraphs separated by a blank line; {phone} is the number
  yes_label text not null,
  no_label text not null,
  created_at timestamptz not null default now()
);
alter table public.whatsapp_consent_texts enable row level security;
drop policy if exists "staff read consent texts" on public.whatsapp_consent_texts;
create policy "staff read consent texts" on public.whatsapp_consent_texts
  for select to authenticated using (public.is_staff());
revoke all on public.whatsapp_consent_texts from anon, authenticated;
grant select on public.whatsapp_consent_texts to authenticated;

-- Version 1: the legal draft of 30.9.2026 (section 2א), awaiting a lawyer. The
-- "where to stop" line names the app's actual place (מה עליי), and "[שינוי]" is a
-- line under the text on the screen, not part of it.
insert into public.whatsapp_consent_texts (version, title, body, yes_label, no_label) values (1,
  'הודעות עבודה ב־WhatsApp',
  E'המערכת יכולה לשלוח לך הודעות עבודה ב־WhatsApp, מהמספר העסקי של אסטרטג, למספר {phone}.\n\n'
  || E'מה יישלח: סיכום יומי, משימה חדשה, תזכורת למועד או לאיחור, חריגה, יום צילום, ושיוך עורך.\n\n'
  || E'מתי: רק בימים א׳–ה׳ בין 08:30 ל־19:00, ובערב חג עד 13:00. לא בשבת ולא בחג. אין צורך לענות מחוץ לשעות העבודה שלך.\n\n'
  || E'זו בחירה שלך. אם לא תסכים/י, תקבל/י את אותן התראות באפליקציה בלבד (Push), ואין לזה שום השפעה על העבודה או על ההערכה שלך.\n\n'
  || E'אפשר להפסיק בכל עת ב״מה עליי״ ← ״הודעות ב־WhatsApp״, או בתשובה ״הסר״ ב־WhatsApp.\n\n'
  || 'נשמרים: ההסכמה ומועדה, והאם כל הודעה נמסרה ונקראה. פרטים בהודעת הפרטיות לעובדים.',
  'אני מסכים/ה לקבל הודעות ב־WhatsApp',
  'לא, רק התראות באפליקציה')
on conflict (version) do nothing;

create table if not exists public.whatsapp_consents (
  email text primary key references public.staff (email) on delete cascade,
  person text not null,
  status text not null check (status in ('granted', 'declined', 'withdrawn')),
  phone text check (phone is null or phone ~ '^9725[0-9]{8}$'),  -- the number the choice was made for
  text_version integer not null references public.whatsapp_consent_texts (version),
  decided_at timestamptz not null default now(),
  withdrawn_via text check (withdrawn_via is null or withdrawn_via in ('app', 'whatsapp'))
);
create index if not exists whatsapp_consents_phone_idx on public.whatsapp_consents (phone) where status = 'granted';
alter table public.whatsapp_consents enable row level security;
drop policy if exists "staff read own consent" on public.whatsapp_consents;
create policy "staff read own consent" on public.whatsapp_consents
  for select to authenticated
  using (public.is_staff() and email = lower(coalesce(auth.jwt() ->> 'email', '')));
revoke all on public.whatsapp_consents from anon, authenticated;
grant select on public.whatsapp_consents to authenticated;

create table if not exists public.whatsapp_consent_log (
  id bigint generated always as identity primary key,
  email text not null,
  person text not null,
  action text not null check (action in ('granted', 'declined', 'withdrawn')),
  via text not null check (via in ('app', 'whatsapp')),
  phone text,
  text_version integer references public.whatsapp_consent_texts (version),
  wording text,               -- the words on the screen, with the number, as shown
  answer text,                -- the button pressed
  user_agent text check (user_agent is null or length(user_agent) <= 300),
  at timestamptz not null default now()
);
create index if not exists whatsapp_consent_log_email_idx on public.whatsapp_consent_log (email, at desc);
alter table public.whatsapp_consent_log enable row level security;
drop policy if exists "staff read own consent log" on public.whatsapp_consent_log;
create policy "staff read own consent log" on public.whatsapp_consent_log
  for select to authenticated
  using (public.is_staff() and email = lower(coalesce(auth.jwt() ->> 'email', '')));
revoke all on public.whatsapp_consent_log from anon, authenticated;
grant select on public.whatsapp_consent_log to authenticated;

-- A number as the screen shows it: 972501234567 → 050-123-4567.
create or replace function private.phone_text(p text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(p, '^972(5[0-9])([0-9]{3})([0-9]{4})$', '0\1-\2-\3');
$$;

-- The caller's WhatsApp state, for the consent screen and "מה עליי":
--   enabled, owner, phone (their own number: staff.phone, or the owner's consent
--   number), status, decided_at, version (of their choice), active (messages go),
--   prompt (show the screen now), text { version, title, body (with the number),
--   yes, no }. Nothing about anyone else.
create or replace function public.whatsapp_my_consent() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  st public.staff;
  c public.whatsapp_consents;
  t public.whatsapp_consent_texts;
  v_owner boolean;
  v_phone text;
  v_active boolean;
begin
  if not public.is_staff() then return null; end if;
  select * into st from public.staff where email = me;
  select * into c from public.whatsapp_consents where email = me;
  select * into t from public.whatsapp_consent_texts order by version desc limit 1;
  v_owner := st.person is null;
  v_phone := case when v_owner then c.phone else st.phone end;
  v_active := c.status = 'granted' and c.phone is not null and c.phone = v_phone;
  return jsonb_build_object(
    'enabled', private.whatsapp_enabled(),
    'owner', v_owner,
    'phone', v_phone,
    'status', c.status,
    'decided_at', c.decided_at,
    'version', c.text_version,
    'active', coalesce(v_active, false),
    -- Asked once: no choice yet, or WhatsApp was agreed for a number that changed since.
    'prompt', private.whatsapp_enabled() and (v_owner or v_phone is not null)
              and (c.status is null or (c.status = 'granted' and not coalesce(v_active, false))),
    'text', jsonb_build_object('version', t.version, 'title', t.title,
              'body', replace(t.body, '{phone}', coalesce(private.phone_text(v_phone), '[מספר הנייד שלך]')),
              'yes', t.yes_label, 'no', t.no_label));
end $$;

-- The choice on the consent screen: 'whatsapp' or 'push'. p_version is the text
-- the screen showed (the latest; an older screen is refused). The number is the
-- caller's staff.phone; the owner, who keeps none there, gives it (p_phone).
create or replace function public.whatsapp_decide(p_choice text, p_version integer, p_phone text default null, p_user_agent text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  st public.staff;
  t public.whatsapp_consent_texts;
  v_phone text;
  v_who text;
  v_act text;
begin
  if not public.is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_choice is null or p_choice not in ('whatsapp', 'push') then raise exception 'bad_choice' using errcode = '22023'; end if;
  select * into st from public.staff where email = me;
  select * into t from public.whatsapp_consent_texts order by version desc limit 1;
  if p_version is distinct from t.version then raise exception 'stale_text' using errcode = '22023'; end if;
  v_who := coalesce(st.person, 'owner');
  if st.person is null then
    v_phone := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '');
    if v_phone ~ '^05[0-9]{8}$' then v_phone := '972' || substr(v_phone, 2); end if;
    if v_phone is null then
      v_phone := (select c.phone from public.whatsapp_consents c where c.email = me);
    end if;
  else
    v_phone := st.phone;
  end if;
  if p_choice = 'whatsapp' and (v_phone is null or v_phone !~ '^9725[0-9]{8}$') then
    raise exception 'no_phone' using errcode = '22023';
  end if;
  if v_phone is not null and v_phone !~ '^9725[0-9]{8}$' then v_phone := null; end if;
  v_act := case when p_choice = 'whatsapp' then 'granted' else 'declined' end;
  insert into public.whatsapp_consents (email, person, status, phone, text_version, decided_at, withdrawn_via)
  values (me, v_who, v_act, v_phone, t.version, now(), null)
  on conflict (email) do update set person = excluded.person, status = excluded.status, phone = excluded.phone,
    text_version = excluded.text_version, decided_at = excluded.decided_at, withdrawn_via = null;
  insert into public.whatsapp_consent_log (email, person, action, via, phone, text_version, wording, answer, user_agent)
  values (me, v_who, v_act, 'app', v_phone, t.version,
          t.title || E'\n\n' || replace(t.body, '{phone}', coalesce(private.phone_text(v_phone), '[מספר הנייד שלך]')),
          case when p_choice = 'whatsapp' then t.yes_label else t.no_label end, left(p_user_agent, 300));
  return public.whatsapp_my_consent();
end $$;

-- Stop WhatsApp messages from the app ("מה עליי"). Push stays as it was.
create or replace function public.whatsapp_withdraw(p_user_agent text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  c public.whatsapp_consents;
begin
  if not public.is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.whatsapp_consents set status = 'withdrawn', decided_at = now(), withdrawn_via = 'app'
  where email = me and status = 'granted' returning * into c;
  if c.email is not null then
    insert into public.whatsapp_consent_log (email, person, action, via, phone, text_version, user_agent)
    values (c.email, c.person, 'withdrawn', 'app', c.phone, c.text_version, left(p_user_agent, 300));
  end if;
  return public.whatsapp_my_consent();
end $$;

-- ── Messages ───────────────────────────────
create table if not exists public.whatsapp_messages (
  id bigint generated always as identity primary key,
  log_id bigint not null unique references public.reminder_log (id) on delete cascade,  -- one message per reminder
  person text not null,
  email text not null,
  phone text not null check (phone ~ '^9725[0-9]{8}$'),
  template text not null check (template ~ '^[a-z0-9_]{1,60}$'),
  wa_message_id text unique check (wa_message_id is null or length(wa_message_id) <= 200),
  status text not null default 'pending' check (status in ('pending', 'sent', 'delivered', 'read', 'failed')),
  error text check (error is null or length(error) <= 200),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz
);
create index if not exists whatsapp_messages_person_idx on public.whatsapp_messages (person, created_at desc);
create index if not exists whatsapp_messages_pending_idx on public.whatsapp_messages (created_at) where status = 'pending';
alter table public.whatsapp_messages enable row level security;
drop policy if exists "staff read own whatsapp" on public.whatsapp_messages;
create policy "staff read own whatsapp" on public.whatsapp_messages
  for select to authenticated using (person = public.reminder_person());
revoke all on public.whatsapp_messages from anon, authenticated;
grant select on public.whatsapp_messages to authenticated;

create table if not exists public.whatsapp_inbound (
  id text primary key check (length(id) between 1 and 200),  -- Meta's id of the incoming message
  message_id bigint references public.whatsapp_messages (id) on delete set null,
  op text not null check (op ~ '^[a-z_]{1,30}$'),
  result text check (result is null or length(result) <= 100),
  received_at timestamptz not null default now()
);
alter table public.whatsapp_inbound enable row level security;
revoke all on public.whatsapp_inbound from anon, authenticated;

-- Per person, for the team screen (the office): the choice, whether a number is
-- set, whether messages go, and this week's messages (since Sunday 00:00, Israel
-- time). Never the numbers themselves.
create or replace function public.whatsapp_team_status()
returns table (email text, person text, status text, phone_set boolean, active boolean,
               sent integer, delivered integer, read integer, failed integer)
language sql stable security definer set search_path = '' as $$
  with week as (
    select ((d - extract(dow from d)::integer)::timestamp at time zone 'Asia/Jerusalem') as since
    from (select (now() at time zone 'Asia/Jerusalem')::date as d) x
  )
  select s.email, coalesce(s.person, 'owner'), c.status,
         (case when s.person is null then c.phone else s.phone end) is not null,
         coalesce(c.status = 'granted' and c.phone = (case when s.person is null then c.phone else s.phone end), false),
         count(m.id) filter (where m.status in ('sent', 'delivered', 'read'))::integer,
         count(m.id) filter (where m.status in ('delivered', 'read'))::integer,
         count(m.id) filter (where m.status = 'read')::integer,
         count(m.id) filter (where m.status = 'failed')::integer
  from public.staff s
  cross join week
  left join public.whatsapp_consents c on c.email = s.email
  left join public.whatsapp_messages m on m.email = s.email and m.created_at >= week.since
  where public.is_office()
  group by s.email, s.person, c.status, c.phone, s.phone
  order by s.email;
$$;

-- ── The functions' own helpers (service role only) ──
-- The sender's settings: on, and the token and number id, only when all are there.
create or replace function public.whatsapp_config()
returns table (enabled boolean, access_token text, phone_number_id text)
language sql stable security definer set search_path = '' as $$
  select private.whatsapp_enabled() and s.access_token and s.phone_number_id and s.app_secret and s.verify_token,
         case when private.whatsapp_enabled() then (select decrypted_secret from vault.decrypted_secrets where name = 'whatsapp_access_token' limit 1) end,
         case when private.whatsapp_enabled() then (select decrypted_secret from vault.decrypted_secrets where name = 'whatsapp_phone_number_id' limit 1) end
  from private.whatsapp_secrets_present() s;
$$;

-- The webhook's secrets: the app secret (the signature), the verify token (Meta's
-- subscription check) and the number id (messages to another number are ignored).
create or replace function public.whatsapp_webhook_secrets()
returns table (app_secret text, verify_token text, phone_number_id text)
language sql stable security definer set search_path = '' as $$
  select (select decrypted_secret from vault.decrypted_secrets where name = 'whatsapp_app_secret' limit 1),
         (select decrypted_secret from vault.decrypted_secrets where name = 'whatsapp_verify_token' limit 1),
         (select decrypted_secret from vault.decrypted_secrets where name = 'whatsapp_phone_number_id' limit 1);
$$;

-- Everyone's choice and both numbers; the function decides who gets messages
-- (app/wa-logic.js waRecipients: agreed, and the number is still the one agreed to).
create or replace function public.whatsapp_recipients()
returns table (email text, person text, status text, consent_phone text, staff_phone text)
language sql stable set search_path = '' as $$
  select s.email, coalesce(s.person, 'owner'), c.status, c.phone, s.phone
  from public.staff s join public.whatsapp_consents c on c.email = s.email
  where c.status = 'granted';
$$;

-- A delivery update from Meta (the webhook): only forward (sent → delivered →
-- read; failed only before delivery), so a late or repeated callback changes
-- nothing. "Read" also marks the reminder read in the app.
create or replace function public.whatsapp_status(p_wa_id text, p_status text, p_at timestamptz, p_error text default null)
returns boolean
language plpgsql set search_path = '' as $$
declare
  m public.whatsapp_messages;
  rank_old integer;
  rank_new integer := case p_status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else null end;
  v_at timestamptz := least(coalesce(p_at, now()), now());
begin
  select * into m from public.whatsapp_messages where wa_message_id = p_wa_id for update;
  if m.id is null then return false; end if;
  rank_old := case m.status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 when 'failed' then 1 else 0 end;
  if p_status = 'failed' then
    if m.status in ('delivered', 'read', 'failed') then return false; end if;
    update public.whatsapp_messages set status = 'failed', failed_at = v_at, error = left(coalesce(p_error, 'failed'), 200) where id = m.id;
    return true;
  end if;
  if rank_new is null or rank_new <= rank_old then return false; end if;
  update public.whatsapp_messages set
    status = p_status,
    sent_at = coalesce(sent_at, v_at),
    delivered_at = case when rank_new >= 2 then coalesce(delivered_at, v_at) else delivered_at end,
    read_at = case when rank_new = 3 then coalesce(read_at, v_at) else read_at end,
    error = null
  where id = m.id;
  if rank_new = 3 then
    update public.reminder_log set read_at = coalesce(read_at, v_at) where id = m.log_id;
  end if;
  return true;
end $$;

-- A reply from WhatsApp, applied once (p_inbound is Meta's id of the incoming
-- message). p_plan comes from app/wa-logic.js replyPlan, made by the webhook from
-- the message it answers (p_message) and the button:
--   { op: 'task_start', task }   "אני על זה" on a task: its started_at (the
--                                 client_tasks_started trigger stamps who and when)
--   { op: 'claim', item }        "אני על זה" on a process: its claim, as in the app
--   { op: 'task_done', task }    "בוצע" on a simple task
--   { op: 'help', title }        "צריך עזרה": an exception to Lior (rule 'exception')
--   { op: 'withdraw' }           "הסר": stops WhatsApp messages to this number
--   { op: 'none', why }          recorded only
-- The sender must be the number the message went to; the writes are as that
-- person (their email in the request's claims, for the stamps and the guards).
create or replace function public.whatsapp_apply(p_inbound text, p_message bigint, p_from text, p_plan jsonb)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_op text := coalesce(p_plan ->> 'op', 'none');
  m public.whatsapp_messages;
  l public.reminder_log;
  c public.whatsapp_consents;
  v_n integer := 0;
  v_result text;
begin
  if v_op !~ '^[a-z_]{1,30}$' then v_op := 'none'; end if;
  insert into public.whatsapp_inbound (id, message_id, op) values (p_inbound, p_message, v_op) on conflict (id) do nothing;
  if not found then return 'duplicate'; end if;

  if v_op = 'withdraw' then
    for c in update public.whatsapp_consents set status = 'withdrawn', decided_at = now(), withdrawn_via = 'whatsapp'
             where phone = p_from and status = 'granted' returning * loop
      insert into public.whatsapp_consent_log (email, person, action, via, phone, text_version)
      values (c.email, c.person, 'withdrawn', 'whatsapp', c.phone, c.text_version);
      v_n := v_n + 1;
    end loop;
    v_result := case when v_n > 0 then 'withdrawn' else 'not_found' end;
    update public.whatsapp_inbound set result = v_result where id = p_inbound;
    return v_result;
  end if;

  select * into m from public.whatsapp_messages where id = p_message;
  if m.id is null or m.phone is distinct from p_from then
    update public.whatsapp_inbound set result = 'unknown', op = 'none' where id = p_inbound;
    return 'unknown';
  end if;
  select * into l from public.reminder_log where id = m.log_id;
  perform set_config('request.jwt.claims', jsonb_build_object('email', m.email, 'role', 'service_role')::text, true);

  if v_op = 'task_start' then
    update public.client_tasks set started_at = now()
    where id = (p_plan ->> 'task')::uuid and owner = l.person and done_at is null and started_at is null;
    get diagnostics v_n = row_count;
    v_result := case when v_n > 0 then 'started' else 'unchanged' end;
  elsif v_op = 'task_done' then
    update public.client_tasks set done_at = now()
    where id = (p_plan ->> 'task')::uuid and owner = l.person and done_at is null
      and coalesce(brief ->> 'route', '') = '' and result is null;
    get diagnostics v_n = row_count;
    v_result := case when v_n > 0 then 'done' else 'unchanged' end;
  elsif v_op = 'claim' then
    if l.client_id is null or l.ref is null or p_plan ->> 'item' is distinct from l.ref || '.claim' then
      v_result := 'unchanged';
    else
      insert into public.protocol_checks (client_id, item_key, state, note)
      values (l.client_id, l.ref || '.claim', 'done', l.person)
      on conflict (client_id, item_key) do nothing;
      get diagnostics v_n = row_count;
      -- Already taken: by this person (a second press) or by someone else.
      v_result := case when v_n > 0 or exists (select 1 from public.protocol_checks
                         where client_id = l.client_id and item_key = l.ref || '.claim' and note = l.person)
                       then 'claimed' else 'taken' end;
    end if;
  elsif v_op = 'help' then
    if l.client_id is null or not exists (select 1 from public.clients where id = l.client_id) then
      v_result := 'no_client';
    else
      -- One open request per reminder: pressing again does not open another.
      insert into public.client_tasks (client_id, title, owner, source, due_on)
      select l.client_id, t.title, 'lior', 'escalation', (now() at time zone 'Asia/Jerusalem')::date
      from (select left(coalesce(nullif(btrim(p_plan ->> 'title'), ''), 'צריך עזרה'), 500) as title) t
      where not exists (select 1 from public.client_tasks x where x.client_id = l.client_id and x.source = 'escalation'
                          and x.done_at is null and x.title = t.title);
      v_result := 'help';
    end if;
  else
    v_op := 'none';
    v_result := left(coalesce(p_plan ->> 'why', 'none'), 100);
  end if;
  update public.whatsapp_inbound set result = v_result, op = v_op where id = p_inbound;
  return v_result;
end $$;

revoke execute on function private.whatsapp_secrets_present() from public, anon, authenticated;
revoke execute on function private.whatsapp_enabled() from public, anon, authenticated;
revoke execute on function private.is_owner() from public, anon, authenticated;
revoke execute on function private.phone_text(text) from public, anon, authenticated;
revoke execute on function public.whatsapp_settings() from public, anon;
revoke execute on function public.whatsapp_set_enabled(boolean) from public, anon;
revoke execute on function public.whatsapp_my_consent() from public, anon;
revoke execute on function public.whatsapp_decide(text, integer, text, text) from public, anon;
revoke execute on function public.whatsapp_withdraw(text) from public, anon;
revoke execute on function public.whatsapp_team_status() from public, anon;
grant execute on function public.whatsapp_settings() to authenticated;
grant execute on function public.whatsapp_set_enabled(boolean) to authenticated;
grant execute on function public.whatsapp_my_consent() to authenticated;
grant execute on function public.whatsapp_decide(text, integer, text, text) to authenticated;
grant execute on function public.whatsapp_withdraw(text) to authenticated;
grant execute on function public.whatsapp_team_status() to authenticated;

revoke execute on function public.whatsapp_config() from public, anon, authenticated;
revoke execute on function public.whatsapp_webhook_secrets() from public, anon, authenticated;
revoke execute on function public.whatsapp_recipients() from public, anon, authenticated;
revoke execute on function public.whatsapp_status(text, text, timestamptz, text) from public, anon, authenticated;
revoke execute on function public.whatsapp_apply(text, bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.whatsapp_config() to service_role;
grant execute on function public.whatsapp_webhook_secrets() to service_role;
grant execute on function public.whatsapp_recipients() to service_role;
grant execute on function public.whatsapp_status(text, text, timestamptz, text) to service_role;
grant execute on function public.whatsapp_apply(text, bigint, text, jsonb) to service_role;
-- The service role writes the messages (the tick) and reads the replies' rows.
grant select, insert, update on public.whatsapp_messages to service_role;
grant select on public.whatsapp_consents, public.whatsapp_inbound to service_role;
