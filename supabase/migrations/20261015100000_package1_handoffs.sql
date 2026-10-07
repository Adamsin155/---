-- Package 1 of the protocol audit (7.10.2026; docs/ops.md, section 37): the places
-- where the chain of hand-offs broke because a person could not get what they need
-- from the system. Most of it is the site (uploads on the editors' and Ilai's own
-- pages, Ilai's read-only view of the characterization, the wording). The database
-- gets one thing:
--
--   Eli reads the scripts of his own shoot days, and nothing else of the scripts.
--   Until now public.client_scripts was closed to him (20261003120000_scripts.sql:
--   Lior and the owner, or a grant per client that also lets the person WRITE), so
--   on a shoot day he worked from a link Lior chose to send. One function,
--   public.shoot_scripts(client), answers for him alone: the scripts (title, text,
--   order, inspiration links) of the shoot rounds whose day is from yesterday to 30
--   days ahead, in Israel days (the same forward edge as the shoot days he sees,
--   private.shoot_in_window; a day back, for his closing checks: "the numbering
--   matches the order of the scripts"). No policy on the table changes: he still
--   cannot select from it, and nothing lets him write.
--
-- (A first draft of this file also closed Ofir's open Drive-folder tasks. The owner
-- decided on 7.10.2026 that the finished videos stay in the client's Google Drive, so
-- the folder task stays as it was and this file touches no row.)
--
-- What did NOT need the database (checked, tests/sql/package1.test.mjs): Ilai already
-- reads every client's characterization and files (he is in is_office()); an editor
-- may upload videos only for a client whose editing is theirs (optional now: the
-- videos are handed over in Drive), and reads the files of the clients they see. The protocol version stays 7
-- and private.protocol_writers is unchanged (no item was added or taken out).
--
-- Safe to run again. Nothing here takes away or changes an object or a row.

-- ── The scripts of a shoot day, for its photographer ──
-- { client: { name, business }, rounds: [1, …], scripts: [{ round, n, title, body,
--   links, status }] }, or null: not Eli, not a client he shoots in that window, a
-- client that ended, was cancelled or is in the archive.
create or replace function public.shoot_scripts(p_client uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with c as (
    select cl.id, cl.name, cl.business, cl.shoot_at, cl.rounds
    from public.clients cl
    where cl.id = p_client and public.is_staff() and public.my_person() = 'eli'
      and cl.status in ('active', 'ending') and cl.archived_at is null
  ),
  today as (select (now() at time zone 'Asia/Jerusalem')::date as d),
  days as (
    -- The main shoot is round 1; an extra shoot round carries its own number and day.
    select 1 as round, c.shoot_at as at from c
    union all
    select (r ->> 'n')::int,
           case when pg_input_is_valid(r ->> 'shoot_at', 'timestamptz') then (r ->> 'shoot_at')::timestamptz end
    from c, jsonb_array_elements(coalesce(c.rounds, '[]'::jsonb)) r
    where (r ->> 'n') ~ '^[0-9]{1,2}$' and (r ->> 'n')::int between 2 and 50
  ),
  mine as (
    select d.round from days d, today
    where d.at is not null and (d.at at time zone 'Asia/Jerusalem')::date between today.d - 1 and today.d + 30
  )
  select jsonb_build_object(
    'client', jsonb_build_object('name', c.name, 'business', coalesce(nullif(btrim(c.business), ''), c.name)),
    'rounds', (select jsonb_agg(m.round order by m.round) from mine m),
    'scripts', coalesce((
      select jsonb_agg(jsonb_build_object('round', s.round, 'n', s.n, 'title', s.title, 'body', s.body,
               'links', (select coalesce(jsonb_agg(x.value), '[]'::jsonb) from jsonb_array_elements(s.links) x
                         where jsonb_typeof(x.value) = 'string' and (x.value #>> '{}') ~ '^https?://[^\s"<>]+$'),
               'status', s.status) order by s.round, s.n)
      from public.client_scripts s
      where s.client_id = c.id and s.round in (select m.round from mine m)
        and (btrim(s.title) <> '' or btrim(s.body) <> '')), '[]'::jsonb))
  from c
  where exists (select 1 from mine);
$$;
revoke all on function public.shoot_scripts(uuid) from public, anon;
grant execute on function public.shoot_scripts(uuid) to authenticated;
