-- "משפיען לבחירה" (the owner, 5.11.2026; the old system's "ALL IN ONE · משפיען לבחירה מרשימת
-- המשפיענים של אסטרטג"): an agreement whose influencer is chosen later, with the client.
-- Natali's packages and quantities (app/catalog.js INFLUENCERS.choice, the packages
-- 'podcast-choice', 'social-choice', 'social-tv-choice').
--
-- What this file changes:
--   public.package_deliverables   the three new packages' quantities (Natali's), so a signed
--                                 agreement opens its client with them. Re-created from
--                                 20261112100000_new_influencers.sql with three rows added;
--                                 its grants are kept (create or replace keeps them).
--   deal_requests.influencer      Stav's deal may name 'choice'. Postgres cannot widen a check
--                                 in place: it is taken away by name and added again at once,
--                                 wider ('natali', 'simeon', 'niro', 'hatzel', 'choice'). No
--                                 row and no column is touched. The same kind of statement the
--                                 owner approved knowingly before (20261031120000_nirel_any_shoot.sql,
--                                 supabase/pending/noam_checks.sql). NEEDS THE OWNER'S APPROVAL.
--
-- What it does not change: the signing trigger (public.open_client_on_signing) already opens a
-- 'choice' client with no shoot type (its case names only the four influencers), and the office
-- sets it in the card ("משפיען: עוד לא נבחר", app/client-open.js influencerToChoose).
--
-- Safe to run again. Tested in tests/sql/influencer-choice.test.mjs.

-- ── 1. What a signed agreement grants ────────
create or replace function public.package_deliverables(model jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  with p as (
    select model -> 'package' ->> 'id' as id,
           coalesce(model -> 'selection' -> 'paid', '[]'::jsonb) as paid,
           coalesce(model -> 'selection' -> 'free', '{}'::jsonb) as free,
           case when jsonb_typeof(model -> 'selection' -> 'custom') = 'object' then model -> 'selection' -> 'custom' else '{}'::jsonb end as custom
  ), t as (
    select p.*,
           case when jsonb_typeof(custom -> 'qty') = 'object' then custom -> 'qty' else '{}'::jsonb end as qty,
           case when jsonb_typeof(model -> 'termMonths') = 'number' then round((model ->> 'termMonths')::numeric)::int
                when jsonb_typeof(custom -> 'termMonths') = 'number' then round((custom ->> 'termMonths')::numeric)::int
                else 12 end as months
    from p
  ), s as (
    select t.paid, t.free, t.custom, t.months,
           case when jsonb_typeof(qty -> 'videos') = 'number' then (qty ->> 'videos')::numeric::int else v.videos end as videos,
           case when jsonb_typeof(qty -> 'graphics') = 'number' then (qty ->> 'graphics')::numeric::int else v.graphics end as graphics,
           case when jsonb_typeof(qty -> 'shootDays') = 'number' then (qty ->> 'shootDays')::numeric::int else v.shoot_days end as shoot_days,
           case when jsonb_typeof(qty -> 'collabs') = 'number' then (qty ->> 'collabs')::numeric::int else v.collabs end as collabs,
           case when jsonb_typeof(qty -> 'stories') = 'number' then (qty ->> 'stories')::numeric::int else v.stories end as stories,
           case when jsonb_typeof(qty -> 'ch14') = 'number' then (qty ->> 'ch14')::numeric::int else v.ch14 end as ch14,
           case when jsonb_typeof(qty -> 'photoDays') = 'number' then (qty ->> 'photoDays')::numeric::int else v.photo_days end as photo_days,
           case when jsonb_typeof(qty -> 'monthly') = 'number' then (qty ->> 'monthly')::numeric::int else 8 end as monthly
    from t join (values
      ('podcast-natali', 20, 20, 0, 0, 0, 0, 1),
      ('podcast-simeon', 20, 20, 0, 0, 0, 0, 1),
      ('social-simeon', 25, 35, 1, 1, 0, 0, 0),
      ('social-tv-simeon', 42, 42, 2, 3, 3, 1, 0),
      ('social-natali', 36, 36, 1, 0, 0, 0, 0),
      ('social-tv-natali', 36, 36, 1, 0, 0, 1, 0),
      ('podcast-niro', 20, 20, 0, 0, 0, 0, 1),
      ('social-niro', 36, 36, 1, 0, 0, 0, 0),
      ('social-tv-niro', 36, 36, 1, 0, 0, 1, 0),
      ('podcast-hatzel', 20, 20, 0, 0, 0, 0, 1),
      ('social-hatzel', 36, 36, 1, 0, 0, 0, 0),
      ('social-tv-hatzel', 36, 36, 1, 0, 0, 1, 0),
      ('podcast-choice', 20, 20, 0, 0, 0, 0, 1),
      ('social-choice', 36, 36, 1, 0, 0, 0, 0),
      ('social-tv-choice', 36, 36, 1, 0, 0, 1, 0)
    ) as v (id, videos, graphics, shoot_days, collabs, stories, ch14, photo_days) on v.id = t.id
  )
  select coalesce((
    select jsonb_strip_nulls(jsonb_build_object(
      'videos', videos,
      'graphics', graphics + coalesce((free ->> 'graphics')::int, 0),
      'shoot_days', shoot_days + case when paid ? 'simeon-day' then 1 else 0 end,
      'collabs', collabs + (paid ? 'natali-reel')::int + (paid ? 'niro-reel')::int + (paid ? 'hatzel-reel')::int,
      'stories', stories + coalesce((free ->> 'simeonStories')::int, 0)
        + (paid ? 'natali-story')::int + (paid ? 'niro-story')::int + (paid ? 'hatzel-story')::int,
      'ch14', ch14 + case when coalesce((free ->> 'extraCh14')::boolean, false) then 1 else 0 end,
      'monthly', case when paid ? 'photographer' then monthly * months else 0 end,
      'photo_days', case when photo_days > 0 then photo_days end,
      'simeon_join', case when coalesce((free ->> 'simeonJoin')::boolean, false) then 1 end))
      -- The added lines, after the nulls were stripped (a line's quantity may be null).
      || coalesce((
        select jsonb_build_object('extra', jsonb_agg(jsonb_build_object(
          'label', l ->> 'label',
          'qty', case when jsonb_typeof(l -> 'qty') = 'number' then l -> 'qty' else 'null'::jsonb end) order by ord))
        from jsonb_array_elements(case when jsonb_typeof(custom -> 'lines') = 'array' then custom -> 'lines' else '[]'::jsonb end)
          with ordinality as x (l, ord)
        where coalesce(l ->> 'label', '') <> ''
        having count(*) > 0), '{}'::jsonb)
    from s), '{}'::jsonb);
$$;

-- ── 2. Stav's deal may leave the influencer to be chosen ──
alter table public.deal_requests drop constraint if exists deal_requests_influencer_check;
alter table public.deal_requests add constraint deal_requests_influencer_check
  check (influencer in ('natali', 'simeon', 'niro', 'hatzel', 'choice'));
