-- The photographer's monthly availability (his protocol, step 1; docs/ops.md, section 39).
-- By the 15th of each month the photographer hands over every date he is free for shoot
-- days in the next month, so shoot days can be closed ahead. Until now nothing kept it:
-- the office ticked "the photographer confirmed" by itself.
--   public.photographer_months    one row per photographer and month, made only when he
--                                 presses "submit": the free dates, or `none` (an explicit
--                                 "no free day this month"). No row = not handed over.
--   public.photographer_changes   an unexpected change (בלת״ם): which dates, when it was
--                                 reported, and which of them had a shoot day set. One per
--                                 photographer per calendar month (Israel time), at most
--                                 two consecutive dates (48 hours). The dates come off the
--                                 month's free dates; this row is what remembers them.
--   public.photographer_people()  who is a photographer. ONE place: a second photographer
--                                 is added here (and to PHOTOGRAPHERS in
--                                 app/availability-logic.js) and nothing else changes.
--   public.can_read_availability(person)  the photographer reads his own; the owner,
--                                 Irit, Lior and Ofir read all. Nobody else.
--   public.can_manage_availability()      who may enter it in his name after a phone
--                                 call: the owner, Irit and Lior.
--   public.photographer_submit / photographer_change
--                                 the only ways to write. The browser cannot write the
--                                 tables: who and when are stamped here.
--   public.photographer_taken     the days that already have a shoot day (dates and a
--                                 count only, no client), for whoever reads availability:
--                                 the photographer sees clients only 30 days ahead.
-- The limits, in the database: after the 15th of the month before, a free day comes off
-- only as an unexpected change; a day with a shoot day set never comes off through an
-- update; one change a month; two consecutive dates at most. Whoever enters it in his
-- name (after he called) is not held by them, and is stamped as who did it.
-- Every statement can run again safely, and nothing existing is removed or rewritten.
-- Tested with every migration in a real Postgres: tests/sql/availability.test.mjs.

create or replace function public.photographer_people() returns text[]
language sql immutable set search_path = '' as $$
  select array['eli']::text[];
$$;

create or replace function public.can_read_availability(p_person text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    public.reminder_person() in ('owner', 'irit', 'lior', 'ofir')
    or (public.reminder_person() = p_person and p_person = any (public.photographer_people())), false);
$$;

create or replace function public.can_manage_availability() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.reminder_person() in ('owner', 'irit', 'lior'), false);
$$;

revoke execute on function public.photographer_people() from public, anon;
revoke execute on function public.can_read_availability(text) from public, anon;
revoke execute on function public.can_manage_availability() from public, anon;
grant execute on function public.photographer_people() to authenticated;
grant execute on function public.can_read_availability(text) to authenticated;
grant execute on function public.can_manage_availability() to authenticated;

create table if not exists public.photographer_months (
  person text not null,
  -- The first day of the month the dates belong to.
  month date not null check (extract(day from month) = 1),
  days date[] not null default '{}',
  -- "אין לי ימים פנויים בחודש הזה": said, not left empty.
  none boolean not null default false,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Who wrote it last: the photographer, or whoever entered it in his name.
  by_person text not null,
  by_email text not null check (by_email = lower(by_email)),
  primary key (person, month),
  check (not none or cardinality(days) = 0)
);

create table if not exists public.photographer_changes (
  id uuid primary key default gen_random_uuid(),
  person text not null,
  reported_at timestamptz not null default now(),
  -- The Israel calendar month it was reported in: one change a month.
  reported_month date not null check (extract(day from reported_month) = 1),
  days date[] not null check (cardinality(days) between 1 and 2),
  -- Which of them had a shoot day set at that moment.
  shoot_days date[] not null default '{}',
  note text check (note is null or length(note) <= 300),
  by_email text not null check (by_email = lower(by_email)),
  unique (person, reported_month)
);
create index if not exists photographer_changes_reported_idx on public.photographer_changes (reported_at desc);

alter table public.photographer_months enable row level security;
alter table public.photographer_changes enable row level security;
-- A policy is made once (closed), then set to its rule: running the file again only
-- sets the rule again.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'photographer_months' and policyname = 'availability readers') then
    create policy "availability readers" on public.photographer_months for select to authenticated using (false);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'photographer_changes' and policyname = 'availability change readers') then
    create policy "availability change readers" on public.photographer_changes for select to authenticated using (false);
  end if;
end $$;
alter policy "availability readers" on public.photographer_months using (public.can_read_availability(person));
alter policy "availability change readers" on public.photographer_changes using (public.can_read_availability(person));
-- No direct writes from the browser: the two functions below.
revoke all on public.photographer_months from public, anon, authenticated;
revoke all on public.photographer_changes from public, anon, authenticated;
grant select on public.photographer_months to authenticated;
grant select on public.photographer_changes to authenticated;

-- The Israel days that have a shoot day set (a client's first one, or any round's), with
-- how many, among the clients the office works on. There is no "which photographer" on a
-- shoot day: every shoot day counts for every photographer.
create or replace function private.shoot_days(p_from date, p_to date) returns table (day date, n integer)
language sql stable security definer set search_path = '' as $$
  select (s.at at time zone 'Asia/Jerusalem')::date, count(*)::integer
  from public.clients c
  cross join lateral (
    select c.shoot_at as at
    union all
    select case when pg_input_is_valid(r ->> 'shoot_at', 'timestamptz') then (r ->> 'shoot_at')::timestamptz end
    from jsonb_array_elements(case when jsonb_typeof(c.rounds) = 'array' then c.rounds else '[]'::jsonb end) r
  ) s
  where c.status in ('active', 'ending') and c.archived_at is null and s.at is not null
    and (s.at at time zone 'Asia/Jerusalem')::date between p_from and p_to
  group by 1;
$$;
revoke execute on function private.shoot_days(date, date) from public, anon, authenticated;

create or replace function public.photographer_taken(p_from date, p_to date) returns table (day date, n integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_read_availability(public.reminder_person()) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 124 then raise exception 'a range of up to four months is required' using errcode = '22023'; end if;
  return query select s.day, s.n from private.shoot_days(p_from, p_to) s order by s.day;
end $$;

-- Hands a month over, or updates it. The photographer for himself; the owner, Irit or
-- Lior in his name (p_person). Returns the row.
create or replace function public.photographer_submit(p_month date, p_days date[], p_none boolean default false, p_person text default null)
returns public.photographer_months
language plpgsql security definer set search_path = '' as $$
declare
  v_me text := public.reminder_person();
  v_mail text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_who text := coalesce(p_person, public.reminder_person());
  v_none boolean := coalesce(p_none, false);
  v_today date := (now() at time zone 'Asia/Jerusalem')::date;
  v_this date := date_trunc('month', (now() at time zone 'Asia/Jerusalem'))::date;
  v_days date[];
  v_old public.photographer_months;
  v_removed date[];
  v_row public.photographer_months;
begin
  if v_me is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_who is null or not (v_who = any (public.photographer_people())) then
    if public.can_manage_availability() then raise exception 'unknown photographer' using errcode = '22023'; end if;
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_who <> v_me and not public.can_manage_availability() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_month is null or p_month <> date_trunc('month', p_month)::date
     or p_month < v_this or p_month > (v_this + interval '3 months')::date then
    raise exception 'availability_month: this month or one of the next three' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct d order by d), '{}'::date[]) into v_days
  from unnest(coalesce(p_days, '{}'::date[])) d where d is not null;
  if exists (select 1 from unnest(v_days) d where d < p_month or d >= (p_month + interval '1 month')::date) then
    raise exception 'availability_month: a day outside the month' using errcode = '22023';
  end if;
  if v_none and cardinality(v_days) > 0 then raise exception 'availability_none: no free day and free days together' using errcode = '22023'; end if;
  if not v_none and cardinality(v_days) = 0 then raise exception 'availability_empty: mark the free days, or say there are none' using errcode = '22023'; end if;

  select * into v_old from public.photographer_months m where m.person = v_who and m.month = p_month for update;
  -- His own update: what comes off is held by the limits.
  if found and v_who = v_me then
    select coalesce(array_agg(d order by d), '{}'::date[]) into v_removed from unnest(v_old.days) d where d <> all (v_days);
    if cardinality(v_removed) > 0 then
      if exists (select 1 from private.shoot_days(p_month, (p_month + interval '1 month')::date - 1) s where s.day = any (v_removed)) then
        raise exception 'availability_taken: a shoot day is set on a day that came off' using errcode = '22023';
      end if;
      if v_today > (p_month - interval '1 month')::date + 14 then
        raise exception 'availability_locked: after the 15th a free day comes off only as an unexpected change' using errcode = '22023';
      end if;
    end if;
  end if;

  insert into public.photographer_months as m (person, month, days, none, by_person, by_email)
  values (v_who, p_month, v_days, v_none, v_me, v_mail)
  on conflict (person, month) do update set days = excluded.days, none = excluded.none, updated_at = now(), by_person = excluded.by_person, by_email = excluded.by_email
  returning * into v_row;
  return v_row;
end $$;

-- An unexpected change (בלת״ם), by the photographer himself: one or two consecutive
-- dates from today on, each free or with a shoot day set; once a calendar month.
-- The dates come off his free dates, and the row says which had a shoot day.
create or replace function public.photographer_change(p_days date[], p_note text default null)
returns public.photographer_changes
language plpgsql security definer set search_path = '' as $$
declare
  v_me text := public.reminder_person();
  v_mail text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_today date := (now() at time zone 'Asia/Jerusalem')::date;
  v_this date := date_trunc('month', (now() at time zone 'Asia/Jerusalem'))::date;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_days date[];
  v_shoots date[];
  v_row public.photographer_changes;
begin
  if v_me is null or not (v_me = any (public.photographer_people())) then raise exception 'not allowed' using errcode = '42501'; end if;
  select coalesce(array_agg(distinct d order by d), '{}'::date[]) into v_days
  from unnest(coalesce(p_days, '{}'::date[])) d where d is not null;
  if cardinality(v_days) < 1 or cardinality(v_days) > 2 or (cardinality(v_days) = 2 and v_days[2] - v_days[1] <> 1) then
    raise exception 'availability_change_span: one date or two consecutive dates (48 hours)' using errcode = '22023';
  end if;
  if v_days[1] < v_today then raise exception 'availability_change_past: a date that passed' using errcode = '22023'; end if;
  if length(v_note) > 300 then raise exception 'the note is up to 300 characters' using errcode = '22023'; end if;
  if exists (select 1 from public.photographer_changes c where c.person = v_me and c.reported_month = v_this) then
    raise exception 'availability_change_used: one unexpected change a month' using errcode = '22023';
  end if;
  select coalesce(array_agg(s.day order by s.day), '{}'::date[]) into v_shoots
  from private.shoot_days(v_days[1], v_days[cardinality(v_days)]) s;
  if exists (
    select 1 from unnest(v_days) d
    where d <> all (v_shoots) and not exists (
      select 1 from public.photographer_months m
      where m.person = v_me and m.month = date_trunc('month', d)::date and d = any (m.days))
  ) then
    raise exception 'availability_change_not_free: a date that is neither free nor has a shoot day' using errcode = '22023';
  end if;
  insert into public.photographer_changes (person, reported_month, days, shoot_days, note, by_email)
  values (v_me, v_this, v_days, v_shoots, v_note, v_mail)
  returning * into v_row;
  update public.photographer_months m
  set days = array(select d from unnest(m.days) d where d <> all (v_days) order by d), updated_at = now()
  where m.person = v_me and m.month in (select date_trunc('month', d)::date from unnest(v_days) d);
  return v_row;
end $$;

revoke all on function public.photographer_taken(date, date) from public, anon, authenticated;
revoke all on function public.photographer_submit(date, date[], boolean, text) from public, anon, authenticated;
revoke all on function public.photographer_change(date[], text) from public, anon, authenticated;
grant execute on function public.photographer_taken(date, date) to authenticated;
grant execute on function public.photographer_submit(date, date[], boolean, text) to authenticated;
grant execute on function public.photographer_change(date[], text) to authenticated;
