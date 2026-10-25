-- A shoot day without influencers (the owner's decision of 25.10.2026): Lior goes with one
-- photographer to film the client (some clients have such a day every month). "מי מצלם" is
-- kept with the shoot itself, never in a column of its own (app/protocol.js crewOf):
--   - the client's own shoot: clients.deliverables ->> 'shoot_crew' ('eli' | 'eliel'), with
--     clients.shoot_type empty;
--   - an extra round: its entry of clients.rounds, 'shoot_crew', with no 'shoot_type' of its own.
-- A shoot type always wins: a shoot with a type is a day with influencers, and Eli films it.
-- Eliel has no account in the system (a name only).
--
-- What changes here, nothing else:
--   1. The second photographer, Eliel, has a month of availability too (the owner, 25.10.2026):
--      he has no account, so his month is a record the office fills in his name, through the
--      same public.photographer_submit (the owner, Irit and Lior: public.can_manage_availability),
--      stamped with who did it (by_person). public.photographer_people() names him.
--   2. The shoot days of each photographer. private.shoot_days
--      (20261016100000_photographer_availability.sql) counted every shoot day for every
--      photographer ("there is no 'which photographer' on a shoot day"). Now there is: a day
--      without influencers is its photographer's (Eli's or Eliel's), any other day is Eli's.
--      private.shoot_days is Eli's (his availability card, public.photographer_taken, and the
--      guard that keeps him from taking off a day that has a shoot), as the app reads it
--      (app/availability-logic.js shootsByDay); public.photographer_taken_by(person, from, to)
--      is the same for a named photographer (Eliel's month on the office's card).
--   3. The client's message for the day before such a shoot (its own words: no influencers,
--      the shoot's own time), as DEFAULT_TEMPLATES in app/messages-logic.js says
--      (tests/messages.test.mjs). An office that already wrote one keeps its words.
-- The file only adds or replaces, and can run again safely (tests/sql/shoot-crew.test.mjs).

-- ── 1. The photographers ────────────────────
create or replace function public.photographer_people() returns text[]
language sql immutable set search_path = '' as $$
  select array['eli', 'eliel']::text[];
$$;

-- ── 2. The days each photographer is taken ──
-- A shoot's photographer: its crew on a day without influencers (no shoot type), else Eli.
create or replace function private.shoot_days_by(p_person text, p_from date, p_to date) returns table (day date, n integer)
language sql stable security definer set search_path = '' as $$
  select (s.at at time zone 'Asia/Jerusalem')::date, count(*)::integer
  from public.clients c
  cross join lateral (
    select c.shoot_at as at,
      case when coalesce(c.shoot_type, '') = '' and jsonb_typeof(c.deliverables) = 'object' then c.deliverables ->> 'shoot_crew' end as crew
    union all
    select case when pg_input_is_valid(r ->> 'shoot_at', 'timestamptz') then (r ->> 'shoot_at')::timestamptz end,
      case when jsonb_typeof(r) = 'object' and coalesce(r ->> 'shoot_type', '') = '' then r ->> 'shoot_crew' end
    from jsonb_array_elements(case when jsonb_typeof(c.rounds) = 'array' then c.rounds else '[]'::jsonb end) r
  ) s
  where c.status in ('active', 'ending') and c.archived_at is null and s.at is not null
    and (s.at at time zone 'Asia/Jerusalem')::date between p_from and p_to
    and (case when s.crew = any (public.photographer_people()) then s.crew else 'eli' end) = p_person
  group by 1;
$$;
revoke execute on function private.shoot_days_by(text, date, date) from public, anon, authenticated;

-- Eli's, as before for every caller of it.
create or replace function private.shoot_days(p_from date, p_to date) returns table (day date, n integer)
language sql stable security definer set search_path = '' as $$
  select s.day, s.n from private.shoot_days_by('eli', p_from, p_to) s;
$$;
revoke execute on function private.shoot_days(date, date) from public, anon, authenticated;

-- A named photographer's days, for whoever reads availability (as public.photographer_taken).
create or replace function public.photographer_taken_by(p_person text, p_from date, p_to date) returns table (day date, n integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_read_availability(public.reminder_person()) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_person is null or not (p_person = any (public.photographer_people())) then raise exception 'unknown photographer' using errcode = '22023'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 124 then raise exception 'a range of up to four months is required' using errcode = '22023'; end if;
  return query select s.day, s.n from private.shoot_days_by(p_person, p_from, p_to) s order by s.day;
end $$;
revoke all on function public.photographer_taken_by(text, date, date) from public, anon, authenticated;
grant execute on function public.photographer_taken_by(text, date, date) to authenticated;

-- ── 3. The message for the day before ───────
-- seed:begin
insert into public.message_templates (key, title, kind, station, body) values
  ('eve_solo', 'יום לפני הצילום (בלי משפיענים)', 'milestone', null, $t$היי {לקוח}, מתכוננים ליום הצילום!
מתי: {תאריך} בשעה {שעה}.
איפה: {כתובת}
מי מגיע: {מגיעים}
מה להכין: העסק מסודר ונקי, מוצרים ושירותים מוכנים לצילום, שילוט ותאורה דולקים, ועובדים שמוכנים להופיע. מתחילים בצילומי העסק עצמו, ואחר כך הסרטונים לפי התסריטים.
אם משהו השתנה, כתבו לנו עוד היום.$t$)
on conflict (key) do nothing;
-- seed:end
