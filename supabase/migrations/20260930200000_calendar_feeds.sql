-- Stage 6: personal calendar feeds ("היומן שלי" in "מה עליי"). Instead of the
-- Google Calendar API (decision 32 is still open), each staff member gets a secret
-- subscription link that any calendar app (Google, Apple, Outlook) reads every so
-- often. The edge function `calendar` (verify_jwt=false) serves it: the token in
-- the link is the only credential, so
--   - the database keeps only the SHA-256 of the token, never the token itself;
--     it is shown once, when it is made;
--   - one link per person; "קישור חדש" replaces it (the old one stops at once),
--     "ניתוק" removes it; removing someone from the staff removes their link;
--   - the function checks a token through calendar_feed_check(), which only the
--     service role may call, and learns whose feed it is (email and person). What
--     goes into the feed is decided in app/calendar-feed.js, by the same rule of who
--     sees which client as the policies here (private.my_clients()).
--   - the owner sees on the team screen who connected and when their calendar last
--     read the feed (calendar_feeds_team()), never a token or a hash.
-- The table has no grants to anon or authenticated and no policies: every read and
-- write goes through the functions below (security definer, search_path '').
-- Safe to run again. Tested in tests/sql/calendar.test.mjs.

create table if not exists public.calendar_feeds (
  email text primary key references public.staff (email) on delete cascade on update cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_fetch_at timestamptz,
  fetch_count integer not null default 0
);

alter table public.calendar_feeds enable row level security;
revoke all on public.calendar_feeds from public, anon, authenticated;

-- ── The signed-in person's own link ────────
-- The state of my link (no token, no hash): one row when connected, none otherwise.
create or replace function public.calendar_feed_status()
returns table (connected boolean, created_at timestamptz, last_fetch_at timestamptz, fetch_count integer)
language sql stable security definer set search_path = '' as $$
  select true, f.created_at, f.last_fetch_at, f.fetch_count
  from public.calendar_feeds f
  where public.is_staff() and f.email = lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

-- A new link for me: 32 random bytes, returned once in hex; only its SHA-256 is
-- stored. Replaces my previous link, which stops working at once.
create or replace function public.calendar_feed_rotate() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if me = '' or not public.is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into public.calendar_feeds (email, token_hash, created_at, last_fetch_at, fetch_count)
  values (me, encode(sha256(convert_to(token, 'UTF8')), 'hex'), now(), null, 0)
  on conflict (email) do update set
    token_hash = excluded.token_hash, created_at = now(), last_fetch_at = null, fetch_count = 0;
  return token;
end $$;

-- Disconnect: my link stops working.
create or replace function public.calendar_feed_revoke() returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from public.calendar_feeds where email = lower(coalesce(auth.jwt() ->> 'email', ''));
  return found;
end $$;

-- ── The function's check (service role only) ──
-- Whose feed a token opens: the staff row (email, person; person null = the owner),
-- or nothing. A malformed token is nothing. Records when the feed was last read
-- (at most once a minute, so a busy calendar app does not write on every read).
create or replace function public.calendar_feed_check(p_token text)
returns table (email text, person text)
language plpgsql volatile security definer set search_path = '' as $$
declare
  h text;
  f public.calendar_feeds;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return; end if;
  h := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  select * into f from public.calendar_feeds c where c.token_hash = h;
  if f.email is null then return; end if;
  update public.calendar_feeds c set last_fetch_at = now(), fetch_count = c.fetch_count + 1
  where c.email = f.email and (c.last_fetch_at is null or c.last_fetch_at < now() - interval '1 minute');
  return query select s.email, s.person from public.staff s where s.email = f.email;
end $$;

-- ── The owner's team screen ─────────────────
-- Who connected a calendar and when it last read the feed. The owner only (staff
-- row without a person); never a token or a hash.
create or replace function public.calendar_feeds_team()
returns table (email text, person text, created_at timestamptz, last_fetch_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select f.email, s.person, f.created_at, f.last_fetch_at
  from public.calendar_feeds f
  join public.staff s on s.email = f.email
  where public.is_staff() and exists (
    select 1 from public.staff o
    where o.email = lower(coalesce(auth.jwt() ->> 'email', '')) and o.person is null)
  order by f.email;
$$;

revoke execute on function public.calendar_feed_status() from public, anon;
revoke execute on function public.calendar_feed_rotate() from public, anon;
revoke execute on function public.calendar_feed_revoke() from public, anon;
revoke execute on function public.calendar_feeds_team() from public, anon;
revoke execute on function public.calendar_feed_check(text) from public, anon, authenticated;
grant execute on function public.calendar_feed_status() to authenticated;
grant execute on function public.calendar_feed_rotate() to authenticated;
grant execute on function public.calendar_feed_revoke() to authenticated;
grant execute on function public.calendar_feeds_team() to authenticated;
grant execute on function public.calendar_feed_check(text) to service_role;
