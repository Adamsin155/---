-- The field sales see which days are taken by shoot days (Lior's request, approved by the
-- owner on 22.11.2026: "שלכל אנשי המכירות יהיה גישה ליומן, שיראו מתי יש ימי צילום";
-- docs/ops.md, section 144). The sales read no client at all (no row of public.clients
-- reaches them), so the calendar page cannot build these days from the clients as it does
-- for everyone else. This function hands them dates and a count only: no client, no hour,
-- no address, no influencer, no characterization meeting.
--
--   public.sales_calendar_people()     the people who get it: Stav. One line to add another
--                                      (and the same list in app/calendar-view.js,
--                                      SALES_CALENDAR; tests/sales-calendar.test.mjs).
--   public.sales_shoot_days(from, to)  { day, n }: every shoot day of an active or ending
--                                      client, its main one and every round's, in Israel
--                                      days; `n` = how many shoots are set on that day
--                                      (a day can hold two: two of Natali's clients, or a
--                                      day of Denis and a day of Natali). Whoever is in the
--                                      list, and the owners; up to four months at a time.
-- Each shoot is counted once: private.shoot_days_by gives every shoot to exactly one
-- photographer (20261107100000_shoot_crew.sql), so the sum over the photographers is every
-- shoot day.
-- The file only adds, and can run again safely (tests/sql/sales-calendar.test.mjs).

create or replace function public.sales_calendar_people() returns text[]
language sql immutable set search_path = '' as $$
  select array['stav']::text[];
$$;
revoke execute on function public.sales_calendar_people() from public, anon;
grant execute on function public.sales_calendar_people() to authenticated;

create or replace function public.sales_shoot_days(p_from date, p_to date) returns table (day date, n integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  who text := public.reminder_person();
begin
  if who is null or not (who = 'owner' or who = any (public.sales_calendar_people())) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 124 then
    raise exception 'a range of up to four months is required' using errcode = '22023';
  end if;
  return query
    select s.day, sum(s.n)::integer
    from unnest(public.photographer_people()) p (person)
    cross join lateral private.shoot_days_by(p.person, p_from, p_to) s
    group by s.day
    order by s.day;
end $$;
revoke all on function public.sales_shoot_days(date, date) from public, anon, authenticated;
grant execute on function public.sales_shoot_days(date, date) to authenticated;
