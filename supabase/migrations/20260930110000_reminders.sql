-- Stage 3: the reminder engine (docs/plan/system-plan.md, principle 4 and
-- section 5; docs/ops.md, "מנוע התזכורות"). The rules are app/reminder-rules.js;
-- the reminders edge function runs them every minute (pg_cron, migration
-- 20260930110002) and writes here.
--
--   push_subscriptions  each staff member's devices (Web Push). A person sees and
--                       changes only their own, through the functions below; the
--                       office (owner, Irit, Lior, Ofir) sees who is connected.
--   reminder_log        every ladder step the engine handled: pending (claimed, being
--                       pushed), sent, queued for a digest, suppressed or failed. The
--                       key is unique: that is how each step goes out once. Everyone
--                       reads their own rows (the owner and Lior read all: the team
--                       screen) and marks them read.
--   reminder_runs       one row per tick: its lease (one tick at a time) and health.
--
-- Secrets are never here: the cron secret and the VAPID private key live in Vault
-- (vault.secrets, inserted by the lead) and are read only by service-role functions.

-- ── Devices ───────────────────────────────
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email)),
  -- Only the browsers' push services (the same list as PUSH_ENDPOINT in
  -- supabase/functions/reminders/webpush.js): the function never posts elsewhere.
  endpoint text not null unique check (length(endpoint) <= 1000 and endpoint ~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/'),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{80,100}$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{16,44}$'),
  user_agent text check (user_agent is null or length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  confirmed_at timestamptz,          -- the person said "קיבלתי" on a test notification
  last_ok_at timestamptz,            -- the push service last accepted a message
  fail_count integer not null default 0,
  last_error text check (last_error is null or length(last_error) <= 200)
);
create index push_subscriptions_email_idx on public.push_subscriptions (email);

alter table public.push_subscriptions enable row level security;
create policy "staff read own devices" on public.push_subscriptions
  for select to authenticated
  using (public.is_staff() and email = lower(coalesce(auth.jwt() ->> 'email', '')));
-- Writes only through the functions below (the email is always the caller's).
revoke all on public.push_subscriptions from anon, authenticated;
grant select on public.push_subscriptions to authenticated;

-- Connects this device to the signed-in staff member. A device belongs to whoever
-- connected it last (a phone that changed hands stops getting the previous
-- person's reminders); at most 10 devices a person, the oldest go.
create function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  rid uuid;
begin
  if me = '' or not public.is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint and email <> me;
  insert into public.push_subscriptions (email, endpoint, p256dh, auth, user_agent)
  values (me, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update set
    user_agent = excluded.user_agent,
    last_seen_at = now(),
    -- New keys are a new subscription: it is confirmed and counted again.
    confirmed_at = case when public.push_subscriptions.p256dh = excluded.p256dh and public.push_subscriptions.auth = excluded.auth
                        then public.push_subscriptions.confirmed_at end,
    fail_count = case when public.push_subscriptions.p256dh = excluded.p256dh and public.push_subscriptions.auth = excluded.auth
                      then public.push_subscriptions.fail_count else 0 end,
    p256dh = excluded.p256dh,
    auth = excluded.auth
  returning id into rid;
  delete from public.push_subscriptions
  where id in (select id from public.push_subscriptions where email = me order by last_seen_at desc offset 10);
  return rid;
end $$;

-- Disconnects this device (only the caller's own).
create function public.push_unsubscribe(p_endpoint text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.push_subscriptions
  where endpoint = p_endpoint and email = lower(coalesce(auth.jwt() ->> 'email', '')) and public.is_staff();
  return found;
end $$;

-- "קיבלתי": the test notification reached this device.
create function public.push_confirm(p_endpoint text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.push_subscriptions set confirmed_at = now()
  where endpoint = p_endpoint and email = lower(coalesce(auth.jwt() ->> 'email', '')) and public.is_staff();
  return found;
end $$;

-- Who is connected, for the team screen and Irit (section 3: she helps people
-- install): devices per staff row, never the endpoints or keys. Office only.
create function public.push_status()
returns table (email text, person text, devices integer, confirmed integer, last_ok_at timestamptz, failing integer)
language sql stable security definer set search_path = '' as $$
  select s.email, s.person,
         count(p.id)::integer,
         count(p.confirmed_at)::integer,
         max(p.last_ok_at),
         count(p.id) filter (where p.fail_count > 0)::integer
  from public.staff s
  left join public.push_subscriptions p on p.email = s.email
  where public.can_message_clients()
  group by s.email, s.person
  order by s.email;
$$;

revoke execute on function public.push_subscribe(text, text, text, text) from public, anon;
revoke execute on function public.push_unsubscribe(text) from public, anon;
revoke execute on function public.push_confirm(text) from public, anon;
revoke execute on function public.push_status() from public, anon;
grant execute on function public.push_subscribe(text, text, text, text) to authenticated;
grant execute on function public.push_unsubscribe(text) to authenticated;
grant execute on function public.push_confirm(text) to authenticated;
grant execute on function public.push_status() to authenticated;

-- ── The log ───────────────────────────────
create table public.reminder_log (
  id bigint generated always as identity primary key,
  key text not null unique check (length(key) between 3 and 400),
  rule text not null check (rule ~ '^[a-zA-Z0-9]+$'),
  person text not null check (person in ('owner', 'irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli')),
  level text not null check (level in ('ring', 'quiet', 'digest', 'board')),
  channel text not null check (channel in ('push', 'app', 'digest')),
  -- 'pending': claimed by a tick and being pushed; 'sent' or 'failed' once the push
  -- services answered. A tick that stopped in between leaves it pending, and a
  -- later tick takes it again (public.reminders_reclaim).
  status text not null check (status in ('pending', 'sent', 'queued', 'suppressed', 'failed')),
  reason text check (reason is null or length(reason) <= 200),
  exempt boolean not null default false,  -- a protocol clock, shoot day, urgent, digest or test: not in the daily cap
  client_id uuid references public.clients (id) on delete set null,
  ref text check (ref is null or ref ~ '^(r[0-9]+\.)?p[0-9]+[ab]?$'),
  title text not null check (length(title) <= 300),
  body text check (body is null or length(body) <= 2000),
  url text check (url is null or (length(url) <= 300 and url !~ '^[a-z]+:')),
  due_at timestamptz,        -- when the step was due
  created_at timestamptz not null default now(),
  sent_at timestamptz,       -- when it reached a device, the app or a digest
  read_at timestamptz,
  digest_key text,           -- the digest that carried a queued line
  claimed_at timestamptz not null default now(),  -- when a tick last took it (a pending push)
  attempts smallint not null default 0            -- how many times a later tick took it again
);
create index reminder_log_person_idx on public.reminder_log (person, created_at desc);
create index reminder_log_queued_idx on public.reminder_log (person) where status = 'queued';
create index reminder_log_created_idx on public.reminder_log (created_at);
create index reminder_log_pending_idx on public.reminder_log (claimed_at) where status = 'pending';

-- The protocol person of the signed-in staff member ('owner' for the owner's row);
-- null unless the login is a confirmed staff member (public.is_staff(), as every
-- other staff rule since 20260926203000_harden_signing.sql).
create function public.reminder_person() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(s.person, 'owner') from public.staff s
  where s.email = lower(coalesce(auth.jwt() ->> 'email', '')) and public.is_staff()
  limit 1;
$$;

alter table public.reminder_log enable row level security;
-- Everyone reads their own; the owner and Lior read all (the team screen, decision 22).
create policy "staff read own reminders" on public.reminder_log
  for select to authenticated
  using (person = public.reminder_person() or public.reminder_person() in ('owner', 'lior'));
revoke all on public.reminder_log from anon, authenticated;
grant select on public.reminder_log to authenticated;

-- Marks the caller's own reminders read (all of them when p_ids is null).
create function public.reminders_mark_read(p_ids bigint[] default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  me text := public.reminder_person();
  n integer;
begin
  if me is null then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.reminder_log set read_at = now()
  where person = me and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.reminder_person() from public, anon;
revoke execute on function public.reminders_mark_read(bigint[]) from public, anon;
grant execute on function public.reminder_person() to authenticated;
grant execute on function public.reminders_mark_read(bigint[]) to authenticated;

-- ── The function's own helpers (service role only) ──
-- Which of these keys the log already has (the engine's dedupe).
create function public.reminders_known(p_keys text[]) returns table (key text)
language sql stable set search_path = '' as $$
  select l.key from public.reminder_log l where l.key = any (p_keys);
$$;

-- The cron secret, compared inside the database: the function never reads it.
-- Hashes are compared, so the time taken says nothing about the secret.
create function public.reminders_check_secret(p_secret text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare s text;
begin
  select decrypted_secret into s from vault.decrypted_secrets where name = 'reminders_cron_secret' limit 1;
  if s is null or length(s) < 32 or p_secret is null then return false; end if;
  return pg_catalog.sha256(convert_to(p_secret, 'UTF8')) = pg_catalog.sha256(convert_to(s, 'UTF8'));
end $$;

-- The VAPID private key (base64url, the raw P-256 scalar) and the contact
-- (mailto: or https:), for signing pushes.
create function public.reminders_vapid() returns table (private_key text, subject text)
language sql stable security definer set search_path = '' as $$
  select (select decrypted_secret from vault.decrypted_secrets where name = 'vapid_private_key' limit 1),
         (select decrypted_secret from vault.decrypted_secrets where name = 'vapid_subject' limit 1);
$$;

-- ── Runs: one tick at a time, and a record of each ──
create table public.reminder_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  stats jsonb,
  error text check (error is null or length(error) <= 200)
);
alter table public.reminder_runs enable row level security;
revoke all on public.reminder_runs from anon, authenticated;

-- A new run, unless one started in the last 2 minutes is still going (then null).
create function public.reminders_begin() returns bigint
language plpgsql security definer set search_path = '' as $$
declare rid bigint;
begin
  perform pg_advisory_xact_lock(hashtext('public.reminders_begin'));
  if exists (select 1 from public.reminder_runs where finished_at is null and started_at > now() - interval '2 minutes') then
    return null;
  end if;
  insert into public.reminder_runs default values returning id into rid;
  delete from public.reminder_runs where started_at < now() - interval '14 days';
  return rid;
end $$;

create function public.reminders_end(p_id bigint, p_ok boolean, p_stats jsonb, p_error text) returns void
language sql security definer set search_path = '' as $$
  update public.reminder_runs set finished_at = now(), ok = p_ok, stats = p_stats, error = left(p_error, 200) where id = p_id;
$$;

-- Pushes a tick claimed before p_before and never finished (it timed out or was
-- stopped): taken again in one statement, so two ticks never take the same row.
create function public.reminders_reclaim(p_before timestamptz) returns setof public.reminder_log
language sql set search_path = '' as $$
  update public.reminder_log set claimed_at = now(), attempts = attempts + 1
  where status = 'pending' and claimed_at < p_before
  returning *;
$$;

-- ── Broken access: since when ──
-- The reminder ladder of process 6 runs from the moment the access broke:
-- when a row became 'broken'. Editing a row that is still broken (a note, another
-- password that fails) keeps it, so the ladder does not start over; any other
-- status clears it. Kept here, never written by the app.
alter table public.client_access add column if not exists broken_since timestamptz;
update public.client_access set broken_since = updated_at where status = 'broken' and broken_since is null;
create function public.client_access_broken_since() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status <> 'broken' then
    new.broken_since := null;
  elsif tg_op = 'UPDATE' and old.status = 'broken' then
    new.broken_since := coalesce(old.broken_since, old.updated_at);
  else
    new.broken_since := now();
  end if;
  return new;
end $$;
create trigger client_access_broken_since before insert or update on public.client_access
for each row execute function public.client_access_broken_since();
revoke execute on function public.client_access_broken_since() from public, anon, authenticated;

revoke execute on function public.reminders_known(text[]) from public, anon, authenticated;
revoke execute on function public.reminders_check_secret(text) from public, anon, authenticated;
revoke execute on function public.reminders_vapid() from public, anon, authenticated;
revoke execute on function public.reminders_begin() from public, anon, authenticated;
revoke execute on function public.reminders_end(bigint, boolean, jsonb, text) from public, anon, authenticated;
revoke execute on function public.reminders_reclaim(timestamptz) from public, anon, authenticated;
grant execute on function public.reminders_known(text[]) to service_role;
grant execute on function public.reminders_check_secret(text) to service_role;
grant execute on function public.reminders_vapid() to service_role;
grant execute on function public.reminders_begin() to service_role;
grant execute on function public.reminders_end(bigint, boolean, jsonb, text) to service_role;
grant execute on function public.reminders_reclaim(timestamptz) to service_role;
