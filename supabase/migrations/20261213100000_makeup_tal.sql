-- Tal, Natali Dadon's makeup artist (the owner's request of 15.11.2026; docs/ops.md, section 132).
-- She signs in with her own login and has ONE screen, "הימים שלי עם נטלי" (makeup.html): the days of
-- a shoot with Natali (shoot_type 'natali' only; not Niro's, "הצל"'s or Arik's days), the date and the
-- hour of the shoot, the businesses of that day, and her answer: "מאשרת" with the hour she arrives at
-- Natali's home (typed, required), or "לא יכולה".
--
-- What she may read and write is decided here, not by the screen:
--   - she is not the office (public.is_office()) and has no client of her own (private.my_clients()
--     names nobody for her), so every table of the clients answers her with nothing: no client, phone,
--     note, mark, task, vault, quote or money;
--   - what she sees comes from one function, public.makeup_my_days(): the date, the shoot time, the
--     business name and the round number of each Natali shoot from today on, and her answers. No id,
--     address, phone or note of a client;
--   - she writes only through public.makeup_answer(): a row of public.makeup_answers (who and when are
--     stamped here), and on "מאשרת" the makeup items of that day's clients (11ב p11b.makeup and 15
--     p15.natali.makeup, a round's with its prefix), with her hour in the note. A mark Lior made himself
--     is kept as it is.
--   - the browser does not write the table; the office reads it (Lior's "לפני יום צילום").
-- "לא יכולה" after "מאשרת" takes her own marks off again through private.makeup_unmark, which is in
-- supabase/pending/makeup_tal_checks.sql (it needs the owner's explicit approval, with the two checks
-- that let her row and her notifications be stored). Until that file runs, this one is harmless:
-- nobody is 'tal' yet.
-- Only adds and replaces. Safe to run again. Tested in tests/sql/makeup-tal.test.mjs.

-- ── 1. Who she is ───────────────────────────
create or replace function private.makeup_people() returns text[]
language sql immutable set search_path = '' as $$
  select array['tal']::text[];
$$;
revoke all on function private.makeup_people() from public, anon, authenticated;

-- ── 2. The days with Natali ─────────────────
-- Every shoot with Natali between two dates (Israel days), the client's own and each round's: the
-- day, the shoot time, the client, the business name and the round. A round takes the client's shoot
-- type unless it has its own, or is a day without influencers (a photographer as its crew), as
-- roundContext in app/protocol-logic.js. Live clients only, as the reminders see them.
create or replace function private.natali_cases(p_from date, p_to date)
returns table (day date, shoot_at timestamptz, client_id uuid, business text, round integer)
language sql stable security definer set search_path = '' as $$
  select (s.at at time zone 'Asia/Jerusalem')::date, s.at, c.id,
    coalesce(nullif(btrim(c.business), ''), c.name), s.n
  from public.clients c
  cross join lateral (
    select c.shoot_at as at, c.shoot_type as t, 1 as n
    union all
    select case when pg_input_is_valid(r ->> 'shoot_at', 'timestamptz') then (r ->> 'shoot_at')::timestamptz end,
      case when coalesce(r ->> 'shoot_type', '') = '' and (r ->> 'shoot_crew') = any (public.photographer_people()) then null
           else coalesce(nullif(r ->> 'shoot_type', ''), c.shoot_type) end,
      case when (r ->> 'n') ~ '^[0-9]{1,3}$' then (r ->> 'n')::integer else 0 end
    from jsonb_array_elements(case when jsonb_typeof(c.rounds) = 'array' then c.rounds else '[]'::jsonb end) r
    where jsonb_typeof(r) = 'object'
  ) s
  where c.status in ('active', 'ending') and c.archived_at is null and coalesce(c.landing, false) = false
    and s.at is not null and s.t = 'natali'
    and (s.at at time zone 'Asia/Jerusalem')::date between p_from and p_to;
$$;
revoke all on function private.natali_cases(date, date) from public, anon, authenticated;

-- ── 3. Her answers ──────────────────────────
-- One row per answer; the latest of a day is where it stands. `shoot_at` is the day's first shoot
-- with Natali when she answered: once it moves, the answer no longer holds and she is asked again.
create table if not exists public.makeup_answers (
  id bigint generated always as identity primary key,
  day date not null,
  shoot_at timestamptz not null,
  answer text not null check (answer in ('yes', 'no')),
  arrive_time text check (arrive_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  clients uuid[] not null default '{}',
  person text not null,
  by_email text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  at timestamptz not null default now(),
  constraint makeup_answers_hour check ((answer = 'yes') = (arrive_time is not null))
);
create index if not exists makeup_answers_day_idx on public.makeup_answers (day, at);
alter table public.makeup_answers enable row level security;
revoke all on public.makeup_answers from public, anon, authenticated;
grant select on public.makeup_answers to authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'makeup_answers' and policyname = 'office reads makeup answers') then
    create policy "office reads makeup answers" on public.makeup_answers for select to authenticated using ((select public.is_office()));
  end if;
end $$;

-- ── 4. Her screen ───────────────────────────
-- { days: [{ day, shoot_at, business, round }], answers: [{ id, day, shoot_at, answer, arrive_time, at }] },
-- from today (Israel) on, 120 days ahead. Her, and the office (to look at it).
create or replace function public.makeup_my_days() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_from date := (now() at time zone 'Asia/Jerusalem')::date;
begin
  if not (coalesce(public.my_person() = any (private.makeup_people()), false) or public.is_office()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'days', coalesce((select jsonb_agg(jsonb_build_object('day', n.day, 'shoot_at', n.shoot_at, 'business', n.business, 'round', n.round)
      order by n.shoot_at, n.business) from private.natali_cases(v_from, v_from + 120) n), '[]'::jsonb),
    'answers', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'day', a.day, 'shoot_at', a.shoot_at, 'answer', a.answer, 'arrive_time', a.arrive_time, 'at', a.at)
      order by a.id) from public.makeup_answers a where a.day >= v_from), '[]'::jsonb));
end $$;
revoke all on function public.makeup_my_days() from public, anon, authenticated;
grant execute on function public.makeup_my_days() to authenticated;

-- "מאשרת" (with the hour she arrives at Natali's home, before the shoot) or "לא יכולה", for one day.
-- Her, or the office in her name (after a phone call). Returns the row.
create or replace function public.makeup_answer(p_day date, p_answer text, p_arrive text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me text := public.my_person();
  v_first timestamptz;
  v_ids uuid[];
  v_row public.makeup_answers;
  v_note text;
begin
  if not (coalesce(v_me = any (private.makeup_people()), false) or public.is_office()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_answer is null or p_answer not in ('yes', 'no') then
    raise exception 'the answer is yes or no' using errcode = '22023';
  end if;
  if p_day is null or p_day < (now() at time zone 'Asia/Jerusalem')::date then
    raise exception 'that day has passed' using errcode = '22023';
  end if;
  select min(n.shoot_at), array_agg(distinct n.client_id) into v_first, v_ids from private.natali_cases(p_day, p_day) n;
  if v_first is null then
    raise exception 'no shoot day with Natali on that day' using errcode = '22023';
  end if;
  if p_answer = 'yes' then
    if p_arrive is null or p_arrive !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'the hour of arrival is required (HH:MM)' using errcode = '22023';
    end if;
    if p_arrive >= to_char(v_first at time zone 'Asia/Jerusalem', 'HH24:MI') then
      raise exception 'the hour of arrival is before the shoot' using errcode = '22023';
    end if;
  else
    p_arrive := null;
  end if;
  insert into public.makeup_answers (day, shoot_at, answer, arrive_time, clients, person)
  values (p_day, v_first, p_answer, p_arrive, v_ids, coalesce(v_me, 'owner'))
  returning * into v_row;
  if p_answer = 'yes' then
    -- Her hour in the note. Her own earlier mark takes the new hour; a mark Lior made himself stays.
    v_note := 'מאפרת: מגיעה לנטלי ב־' || p_arrive;
    insert into public.protocol_checks as k (client_id, item_key, state, note)
    select n.client_id, (case when n.round > 1 then 'r' || n.round || '.' else '' end) || i.key, 'done', v_note
    from private.natali_cases(p_day, p_day) n
    cross join (values ('p11b.makeup'), ('p15.natali.makeup')) as i (key)
    on conflict (client_id, item_key) do update set state = 'done', note = excluded.note, by_email = excluded.by_email, at = now()
      where k.note like 'מאפרת: מגיעה לנטלי ב־%';
  elsif to_regprocedure('private.makeup_unmark(date)') is not null then
    -- "לא יכולה": her own marks of that day come off (supabase/pending/makeup_tal_checks.sql).
    execute 'select private.makeup_unmark($1)' using p_day;
  end if;
  return to_jsonb(v_row) - 'by_email' - 'clients';
end $$;
revoke all on function public.makeup_answer(date, text, text) from public, anon, authenticated;
grant execute on function public.makeup_answer(date, text, text) to authenticated;
