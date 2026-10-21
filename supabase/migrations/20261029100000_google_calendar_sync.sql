-- Google Calendar → the system (the owner's request of 21.10.2026, "סנכרון עם היומן
-- גוגל של עירית"; docs/ops.md, section 65). The meetings Irit books in her own Google
-- Calendar appear on the system's calendar page, and a meeting that names a client and
-- says it is a characterization meeting or a shoot day is offered, to be confirmed by a
-- tap, as that client's date. Nothing is written into a client by itself.
--
--   private.google_calendar_links   one row per member of staff: the secret iCal address
--                                   of their Google calendar, and how its last reading
--                                   went. No grant to anon or authenticated, no policy:
--                                   a browser never reads the address back.
--   public.calendar_external_events the events read from it (7 days back to 120 ahead).
--                                   Each person reads their own rows only; nobody writes
--                                   from a browser. An event that left the feed is marked
--                                   gone_at (and hidden), never removed, so "לא קשור"
--                                   (dismissed_at) is remembered if it comes back.
--
--   google_calendar_connect(url)   me: save my address (Google's secret address only).
--   google_calendar_disconnect()   me: forget my address; my events are hidden.
--   google_calendar_status()       me: connected since, last read, last error, events.
--   google_calendar_dismiss(uid)   me: "לא קשור" on one of my events.
--   google_calendar_feeds()        the edge function `calendar` (service role): who to read.
--   google_calendar_apply(...)     the edge function: one person's events, in one go.
--   google_calendar_tick()         pg_cron, every 15 minutes: calls the edge function with
--                                  the cron secret from Vault (as public.metricool_tick).
--
-- The address is a secret: it is kept only here, read only by the service role's
-- function, never returned, never logged. Safe to run again; the file has none of the
-- three words the production tool refuses. Tested in tests/sql/google-calendar.test.mjs.

create table if not exists private.google_calendar_links (
  email text primary key,
  url text check (url is null or url ~ '^https://calendar\.google\.com/calendar/ical/[A-Za-z0-9%._+@-]{3,200}/private-[A-Za-z0-9]{8,100}/basic\.ics$'),
  connected_at timestamptz,
  read_at timestamptz,
  error text check (error is null or length(error) <= 60),
  events integer not null default 0,
  updated_at timestamptz not null default now()
);
revoke all on table private.google_calendar_links from public, anon, authenticated;

create table if not exists public.calendar_external_events (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  uid text not null check (length(uid) between 1 and 400),
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  summary text not null default '' check (length(summary) <= 200),
  location text not null default '' check (length(location) <= 200),
  client_id uuid,
  kind_guess text check (kind_guess is null or kind_guess in ('char', 'shoot')),
  seen_at timestamptz not null default now(),
  gone_at timestamptz,
  dismissed_at timestamptz,
  unique (email, uid)
);
create index if not exists calendar_external_events_when on public.calendar_external_events (email, starts_at) where gone_at is null;
alter table public.calendar_external_events enable row level security;
revoke all on table public.calendar_external_events from public, anon, authenticated;
grant select on table public.calendar_external_events to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'calendar_external_events' and policyname = 'own google events') then
    create policy "own google events" on public.calendar_external_events for select to authenticated using (false);
  end if;
end $$;
-- My own events, while they are in my calendar, while I am staff.
alter policy "own google events" on public.calendar_external_events
  using (email = lower(coalesce((select auth.jwt()) ->> 'email', '')) and gone_at is null and (select public.is_staff()));

-- ── Me ──────────────────────────────────────
create or replace function public.google_calendar_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when public.is_staff() then coalesce(
    (select jsonb_build_object('connected', true, 'since', l.connected_at, 'readAt', l.read_at, 'error', l.error, 'events', l.events)
     from private.google_calendar_links l
     where l.email = lower(coalesce(auth.jwt() ->> 'email', '')) and l.url is not null),
    jsonb_build_object('connected', false)) end;
$$;

create or replace function public.google_calendar_connect(p_url text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v text := btrim(coalesce(p_url, ''));
begin
  if me = '' or not public.is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  if length(v) > 400 or v !~ '^https://calendar\.google\.com/calendar/ical/[A-Za-z0-9%._+@-]{3,200}/private-[A-Za-z0-9]{8,100}/basic\.ics$' then
    raise exception 'bad_url: the secret iCal address of a Google calendar is expected' using errcode = '22023';
  end if;
  insert into private.google_calendar_links (email, url, connected_at, read_at, error, events, updated_at)
  values (me, v, now(), null, null, 0, now())
  on conflict (email) do update set url = excluded.url, connected_at = now(), read_at = null, error = null, events = 0, updated_at = now();
  -- Another calendar's events are not this one's: hidden until the next reading brings them back.
  update public.calendar_external_events set gone_at = now() where email = me and gone_at is null;
  return public.google_calendar_status();
end $$;

create or replace function public.google_calendar_disconnect() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if me = '' or not public.is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  update private.google_calendar_links set url = null, connected_at = null, read_at = null, error = null, events = 0, updated_at = now()
  where email = me;
  update public.calendar_external_events set gone_at = now() where email = me and gone_at is null;
  return public.google_calendar_status();
end $$;

create or replace function public.google_calendar_dismiss(p_uid text) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if me = '' or not public.is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.calendar_external_events set dismissed_at = coalesce(dismissed_at, now())
  where email = me and uid = p_uid;
  return found;
end $$;

-- ── The edge function (service role only) ──
-- Who to read: the connected members of staff (someone taken off the staff is not read).
create or replace function public.google_calendar_feeds() returns table (email text, url text)
language sql stable security definer set search_path = '' as $$
  select l.email, l.url from private.google_calendar_links l
  where l.url is not null and exists (select 1 from public.staff s where s.email = l.email)
  order by l.read_at nulls first, l.email;
$$;

-- One person's reading. p_ok: the rows of app/gcal-logic.js googleRows (uid, starts_at,
-- ends_at, all_day, summary, location, client_id, kind_guess); every row of that person
-- not in them is marked gone. A failed reading keeps the rows and records a short code.
create or replace function public.google_calendar_apply(p_email text, p_rows jsonb, p_ok boolean, p_error text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  n integer := 0;
  g integer := 0;
begin
  if not exists (select 1 from private.google_calendar_links l where l.email = p_email and l.url is not null) then
    return jsonb_build_object('skipped', true);
  end if;
  if not coalesce(p_ok, false) then
    update private.google_calendar_links set error = left(coalesce(nullif(btrim(p_error), ''), 'error'), 60), updated_at = now()
    where email = p_email;
    return jsonb_build_object('ok', false);
  end if;
  insert into public.calendar_external_events as e (email, uid, starts_at, ends_at, all_day, summary, location, client_id, kind_guess, seen_at, gone_at)
  select distinct on (r ->> 'uid')
    p_email, left(r ->> 'uid', 400), (r ->> 'starts_at')::timestamptz, nullif(r ->> 'ends_at', '')::timestamptz,
    coalesce((r ->> 'all_day')::boolean, false), left(coalesce(r ->> 'summary', ''), 200), left(coalesce(r ->> 'location', ''), 200),
    case when r ->> 'client_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (r ->> 'client_id')::uuid end,
    case when r ->> 'kind_guess' in ('char', 'shoot') then r ->> 'kind_guess' end,
    now(), null
  from (select x from jsonb_array_elements(case when jsonb_typeof(p_rows) = 'array' then p_rows else '[]'::jsonb end) x limit 2000) a (r)
  where coalesce(r ->> 'uid', '') <> '' and r ->> 'starts_at' is not null
  on conflict (email, uid) do update set
    starts_at = excluded.starts_at, ends_at = excluded.ends_at, all_day = excluded.all_day, summary = excluded.summary,
    location = excluded.location, client_id = excluded.client_id, kind_guess = excluded.kind_guess, seen_at = excluded.seen_at, gone_at = null;
  get diagnostics n = row_count;
  update public.calendar_external_events set gone_at = now()
  where email = p_email and gone_at is null and seen_at < now();
  get diagnostics g = row_count;
  update private.google_calendar_links set read_at = now(), error = null, events = n, updated_at = now()
  where email = p_email;
  return jsonb_build_object('ok', true, 'events', n, 'gone', g);
end $$;

-- ── The clock ──────────────────────────────
create extension if not exists pg_cron with schema pg_catalog;

-- Every 15 minutes, while someone is connected: the edge function `calendar` with
-- { action: 'google' } and the cron secret ('reminders_cron_secret' in Vault, compared
-- inside the database by public.reminders_check_secret), as the Metricool sync does.
create or replace function public.google_calendar_tick() returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  secret text;
  request bigint;
begin
  if not exists (select 1 from private.google_calendar_links where url is not null) then return null; end if;
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'reminders_cron_secret' limit 1;
  if coalesce(secret, '') = '' then
    raise notice 'google_calendar_tick: no reminders_cron_secret in Vault, nothing called';
    return null;
  end if;
  select net.http_post(
    url := 'https://czncjzziqrqtezpwxxpz.supabase.co/functions/v1/calendar',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := jsonb_build_object('action', 'google'),
    timeout_milliseconds := 55000
  ) into request;
  return request;
end $$;

revoke execute on function public.google_calendar_status() from public, anon;
revoke execute on function public.google_calendar_connect(text) from public, anon;
revoke execute on function public.google_calendar_disconnect() from public, anon;
revoke execute on function public.google_calendar_dismiss(text) from public, anon;
revoke execute on function public.google_calendar_feeds() from public, anon, authenticated;
revoke execute on function public.google_calendar_apply(text, jsonb, boolean, text) from public, anon, authenticated;
revoke execute on function public.google_calendar_tick() from public, anon, authenticated, service_role;
grant execute on function public.google_calendar_status() to authenticated;
grant execute on function public.google_calendar_connect(text) to authenticated;
grant execute on function public.google_calendar_disconnect() to authenticated;
grant execute on function public.google_calendar_dismiss(text) to authenticated;
grant execute on function public.google_calendar_feeds() to service_role;
grant execute on function public.google_calendar_apply(text, jsonb, boolean, text) to service_role;

-- A few minutes after the Metricool sync's quarter hours. cron.schedule replaces a job of the same name.
select cron.schedule('google-calendar-sync', '7,22,37,52 * * * *', 'select public.google_calendar_tick()');
