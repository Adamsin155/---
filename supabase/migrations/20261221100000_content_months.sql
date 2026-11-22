-- The contents of each month against the contract (the owner and Irit, 22.11.2026; docs/ops.md,
-- section 145). What went up, and what is scheduled, comes from Metricool: the content Gantt's
-- rows that stand on a Metricool post (mc_post_id), of the kinds a contract counts (a video, a
-- graphic, the monthly photographer's). A story, a collab and the Highlights are not counted.
--
-- One content counts once:
--   - a post that goes to several networks is one row already (one Metricool post);
--   - a content the team split into one post per network (Instagram+Facebook at 12:00 and TikTok
--     at 12:00, seen on the live data 22.11.2026) is several rows of the same client, day, minute
--     and kind. Such a group counts as the most posts any ONE network has in it: two posts to
--     different networks are one content; two posts to Instagram at the same minute are two.
--     A post with no network counts by itself.
--
-- public.content_months(p_from, p_to, p_client) → one row per client and month 'YYYY-MM' between
-- p_from and p_to: posted (went up) and planned (went up or still scheduled; a failed post is
-- neither), and the client's first month with any counted content (where its count starts,
-- app/content-month-logic.js). A client with content only outside the range gets one row with a
-- null month. SECURITY INVOKER: each person counts only the Gantt rows the table's own policies
-- show them (the office, Ilai; the reminders function as the service role sees all).
-- The file only adds, and can run again safely (tests/sql/content-months.test.mjs).

create or replace function public.content_months(p_from text, p_to text, p_client uuid default null)
returns table (client_id uuid, first_month text, month text, posted integer, planned integer)
language sql stable security invoker set search_path = '' as $$
  with base as (
    select g.id, g.client_id, g.day, g.time_il, g.kind, g.state,
           case when coalesce(cardinality(g.mc_networks), 0) = 0 then array['#' || g.id::text] else g.mc_networks end as nets
      from public.client_gantt g
     where g.mc_post_id is not null
       and g.kind in ('video', 'graphic', 'monthly')
       and (p_client is null or g.client_id = p_client)
  ),
  firsts as (
    select b.client_id, to_char(min(b.day), 'YYYY-MM') as first_month from base b group by b.client_id
  ),
  inrange as (
    select b.* from base b
     where to_char(b.day, 'YYYY-MM') between p_from and p_to
       and b.state in ('posted', 'scheduled')
  ),
  per_net as (
    select r.client_id, r.day, r.time_il, r.kind, n.net,
           count(*) filter (where r.state = 'posted') as c_posted,
           count(*) as c_planned
      from inrange r cross join lateral unnest(r.nets) as n(net)
     group by r.client_id, r.day, r.time_il, r.kind, n.net
  ),
  per_content as (
    select p.client_id, p.day, max(p.c_posted) as posted, max(p.c_planned) as planned
      from per_net p
     group by p.client_id, p.day, p.time_il, p.kind
  ),
  per_month as (
    select c.client_id, to_char(c.day, 'YYYY-MM') as month, sum(c.posted)::integer as posted, sum(c.planned)::integer as planned
      from per_content c
     group by c.client_id, to_char(c.day, 'YYYY-MM')
  )
  select f.client_id, f.first_month, m.month, coalesce(m.posted, 0) as posted, coalesce(m.planned, 0) as planned
    from firsts f left join per_month m on m.client_id = f.client_id
   order by f.client_id, m.month;
$$;
revoke execute on function public.content_months(text, text, uuid) from public, anon;
grant execute on function public.content_months(text, text, uuid) to authenticated, service_role;
