-- The slow pages, fast (the owner, 29.10.2026: "יאלה תתחיל"; docs/ops.md, section 77).
--
-- "מעבר על הלקוחות" (pass.html), "כל הלקוחות במבט" (owner.html#all) and "המשימות שלי"
-- (clients.html#mine) read every mark of every client (public.protocol_checks, seven pages
-- of a thousand rows) and weeks of the history (public.protocol_log, several more pages)
-- before they draw. Two reading functions answer the same in one call each:
--
--   * public.protocol_checks_compact(p_client): every mark one reads, in one answer, with
--     each repeated value (the state, the note, who and when) written once:
--       { "v": [value, ...], "c": [[client_id, [[item_key, s, n, e, a], ...]], ...] }
--     s, n, e and a are the places in "v" of the row's state, note, by_email and at (a
--     note may be null). The clients in order of client_id and the marks of each in
--     order of item_key, as the pages asked for them. The time is written as the table
--     answers it (the same text), so nothing a page compares changes.
--   * public.protocol_log_brief(p_since, p_suffixes, p_history): of the history, only
--     what the three pages read (app/health.js LOG_NEEDS): since p_since, the newest row
--     of each client (the "last activity") and every row of an item ending in one of
--     p_suffixes (a sending of the graphics, the client's notes on the videos, an
--     editing stop); and from all time, every row of an item ending in one of p_history
--     (the rounds of corrections, read whole). An item "ends in" s when it is s or ends
--     in "." followed by s. Rows as the table gives them, oldest first.
--
-- Both are SECURITY INVOKER: they read the tables as the signed-in person, under the same
-- row level security as the pages' own reads ("read checks of own clients", "history of
-- own clients"). Nobody reads a row more, or a row less, than before. Nothing is written.
-- Before this migration the pages read the tables as they always did (app/protocol-data.js).
--
-- Only adds. Every statement can run again safely. Tested in tests/sql/speed-pages.test.mjs.

-- ── 1. The marks, in one answer ─────────────
create or replace function public.protocol_checks_compact(p_client uuid default null) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with r as (
    select k.client_id, k.item_key,
      to_jsonb(k.state) as s, coalesce(to_jsonb(k.note), 'null'::jsonb) as n,
      coalesce(to_jsonb(k.by_email), 'null'::jsonb) as e, to_jsonb(k.at) as a
    from public.protocol_checks k
    where p_client is null or k.client_id = p_client
  ),
  w as (
    select d.v, (row_number() over (order by d.v) - 1)::int as i
    from (select distinct x.v from r, lateral (values (r.s), (r.n), (r.e), (r.a)) as x(v)) as d
  ),
  c as (
    select r.client_id,
      jsonb_agg(jsonb_build_array(r.item_key, ws.i, wn.i, we.i, wa.i) order by r.item_key) as rows
    from r
    join w as ws on ws.v = r.s
    join w as wn on wn.v = r.n
    join w as we on we.v = r.e
    join w as wa on wa.v = r.a
    group by r.client_id
  )
  select jsonb_build_object(
    'v', coalesce((select jsonb_agg(w.v order by w.i) from w), '[]'::jsonb),
    'c', coalesce((select jsonb_agg(jsonb_build_array(c.client_id, c.rows) order by c.client_id) from c), '[]'::jsonb));
$$;
revoke execute on function public.protocol_checks_compact(uuid) from public, anon;
grant execute on function public.protocol_checks_compact(uuid) to authenticated;

-- ── 2. Of the history, what the pages read ──
create or replace function public.protocol_log_brief(p_since timestamptz, p_suffixes text[] default '{}', p_history text[] default '{}') returns jsonb
language sql stable security invoker set search_path = '' as $$
  with w as (
    select l.id, l.client_id, l.item_key, l.at
    from public.protocol_log l
    where l.at >= p_since
  ),
  picked as (
    select x.id from (select distinct on (w.client_id) w.id from w order by w.client_id, w.at desc, w.id desc) as x
    union
    select w.id from w
    where exists (select 1 from unnest(coalesce(p_suffixes, '{}')) as s(v) where w.item_key = s.v or right(w.item_key, length(s.v) + 1) = '.' || s.v)
    union
    select l.id from public.protocol_log l
    where cardinality(coalesce(p_history, '{}')) > 0
      and exists (select 1 from unnest(p_history) as s(v) where l.item_key = s.v or right(l.item_key, length(s.v) + 1) = '.' || s.v)
  )
  select coalesce(jsonb_agg(jsonb_build_object('client_id', l.client_id, 'item_key', l.item_key, 'action', l.action,
    'note', l.note, 'by_email', l.by_email, 'at', l.at) order by l.at, l.id), '[]'::jsonb)
  from public.protocol_log l
  where l.id in (select picked.id from picked);
$$;
revoke execute on function public.protocol_log_brief(timestamptz, text[], text[]) from public, anon;
grant execute on function public.protocol_log_brief(timestamptz, text[], text[]) to authenticated;
