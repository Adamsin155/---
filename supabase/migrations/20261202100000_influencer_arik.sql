-- A new influencer, Arik Mishali ('arik'; the owner, 8.11.2026: "the same packages and prices as
-- Natali"). Exactly as Niro Levi and "הצל" were added (20261112100000_new_influencers.sql and
-- supabase/pending/new_influencers_checks.sql): sold as Natali Dadon (app/catalog.js STARS),
-- with a shoot day of his own that runs as hers (app/protocol.js isStarDay; Nirel edits it).
--
-- What this file changes, each function re-created from its latest definition with the same
-- signature, its grants kept (create or replace keeps them):
--   private.is_star_day(text)        'arik' is a day like Natali's: Nirel sees its clients
--                                    (private.my_clients, public.can_see_client and
--                                    private.landing_link_clients all ask it; unchanged);
--   public.package_deliverables      the three packages 'podcast-arik', 'social-arik',
--                                    'social-tv-arik' (Natali's quantities), and his reel and
--                                    story add one collab or story (as packageDeliverables() in
--                                    app/protocol-logic.js). From 20261129100000_influencer_choice.sql;
--   public.open_client_on_signing    a signed agreement with Arik opens its client with the
--                                    shoot type 'arik'. From 20261118100000_no_manager_approval.sql.
--
-- ⚠ NEEDS THE OWNER'S EXPLICIT APPROVAL (section 5): three checks list the values a column may
-- hold, and each has to take Arik. Postgres cannot widen a check in place: each is taken away by
-- name ("drop constraint if exists") and added again at once, wider. No row and no column is
-- touched. The same kind of statement the owner approved for Niro and "הצל"
-- (supabase/pending/new_influencers_checks.sql) and for "משפיען לבחירה" (20261129100000):
--   clients.shoot_type          + 'arik'
--   deal_requests.influencer    + 'arik'
--   deal_requests.paid          + 'arik-reel', 'arik-story'
-- The values in each are copied from the live database's definitions (read 8.11.2026).
--
-- Not changed: the payouts system (payout_incomes.family stays 'natali', 'simeon'; as with Niro
-- and "הצל", Arik waits for the owner's rates: app/payouts/engine.js PAYOUT_FAMILIES).
--
-- Safe to run again. Tested in tests/sql/influencer-arik.test.mjs.

-- ── 1. A day like Natali's ───────────────────
create or replace function private.is_star_day(p_type text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p_type in ('natali', 'niro', 'hatzel', 'arik'), false);
$$;
revoke all on function private.is_star_day(text) from public, anon;
grant execute on function private.is_star_day(text) to authenticated;

-- ── 2. What a signed agreement grants ────────
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
      ('social-tv-choice', 36, 36, 1, 0, 0, 1, 0),
      ('podcast-arik', 20, 20, 0, 0, 0, 0, 1),
      ('social-arik', 36, 36, 1, 0, 0, 0, 0),
      ('social-tv-arik', 36, 36, 1, 0, 0, 1, 0)
    ) as v (id, videos, graphics, shoot_days, collabs, stories, ch14, photo_days) on v.id = t.id
  )
  select coalesce((
    select jsonb_strip_nulls(jsonb_build_object(
      'videos', videos,
      'graphics', graphics + coalesce((free ->> 'graphics')::int, 0),
      'shoot_days', shoot_days + case when paid ? 'simeon-day' then 1 else 0 end,
      'collabs', collabs + (paid ? 'natali-reel')::int + (paid ? 'niro-reel')::int + (paid ? 'hatzel-reel')::int
        + (paid ? 'arik-reel')::int,
      'stories', stories + coalesce((free ->> 'simeonStories')::int, 0)
        + (paid ? 'natali-story')::int + (paid ? 'niro-story')::int + (paid ? 'hatzel-story')::int + (paid ? 'arik-story')::int,
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

-- ── 3. The client a signed agreement opens ───
create or replace function public.open_client_on_signing() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  m jsonb;
  cid uuid;
  months int;
  signed timestamptz;
  v_type text;
begin
  if new.status is distinct from 'signed' or old.status = 'signed' then
    return new;
  end if;
  -- Everything that reads the agreement runs inside the protected block, so a
  -- surprising value can never undo the signature.
  begin
    m := new.model;
    -- Agreements are signable; older ones saved before the flag existed are too.
    if coalesce((m ->> 'signable')::boolean, true) is not true then
      return new;
    end if;
    if exists (select 1 from public.clients where quote_id = new.id) then
      return new;
    end if;
    months := coalesce(round((m ->> 'termMonths')::numeric)::int, 12);
    signed := coalesce(new.signed_at, now());
    v_type := case m -> 'selection' ->> 'influencer' when 'natali' then 'natali' when 'simeon' then 'dms'
      when 'niro' then 'niro' when 'hatzel' then 'hatzel' when 'arik' then 'arik' end;
    -- A contract "בלי משפיענים" (29.10.2026): no influencers' shoot day; the office sets the crew.
    if coalesce((m -> 'selection' -> 'custom' ->> 'noInfluencer')::boolean, false) then
      v_type := null;
    end if;
    -- Until the check of clients.shoot_type takes the new star (section 5 below), the client
    -- still opens, with no shoot type yet (the office sets it in the card).
    if v_type in ('niro', 'hatzel', 'arik') and not exists (select 1 from pg_constraint
        where conname = 'clients_shoot_type_check' and conrelid = 'public.clients'::regclass
          and pg_get_constraintdef(oid) like '%' || v_type || '%') then
      v_type := null;
    end if;
    insert into public.clients (name, business, phone, package_name, shoot_type, deal_at, contract_end, quote_id, deliverables)
    values (
      coalesce(nullif(btrim(m -> 'client' ->> 'name'), ''), new.client_name),
      nullif(btrim(m -> 'client' ->> 'company'), ''),
      nullif(btrim(m -> 'client' ->> 'phone'), ''),
      concat_ws(' · ', m -> 'package' ->> 'tierName', m -> 'package' ->> 'influencer'),
      v_type,
      signed,
      ((signed at time zone 'Asia/Jerusalem')::date + make_interval(months => months))::date,
      new.id,
      public.package_deliverables(m)
    )
    returning id into cid;
    insert into public.protocol_checks (client_id, item_key, state, note)
    select cid, k, 'done', 'נחתם במערכת: ' || new.number
    from unnest(array['p01.prepared', 'p01.sent', 'p01.signed']) as k;
  exception when others then
    raise warning 'open_client_on_signing failed for quote %: %', new.number, sqlerrm;
  end;
  return new;
end $$;
revoke execute on function public.open_client_on_signing() from public, anon, authenticated;

-- ── 4. (nothing: Nirel's access asks private.is_star_day, section 1) ──

-- ── 5. The three checks, wider (NEEDS THE OWNER'S APPROVAL) ──
-- Each "drop constraint if exists" is followed at once by the same check with Arik added.
alter table public.clients drop constraint if exists clients_shoot_type_check;
alter table public.clients add constraint clients_shoot_type_check
  check (shoot_type in ('natali', 'niro', 'hatzel', 'arik', 'dms'));

alter table public.deal_requests drop constraint if exists deal_requests_influencer_check;
alter table public.deal_requests add constraint deal_requests_influencer_check
  check (influencer in ('natali', 'simeon', 'niro', 'hatzel', 'arik', 'choice'));

alter table public.deal_requests drop constraint if exists deal_requests_paid_check;
alter table public.deal_requests add constraint deal_requests_paid_check
  check (paid <@ array['photographer', 'natali-reel', 'natali-story', 'niro-reel', 'niro-story',
    'hatzel-reel', 'hatzel-story', 'arik-reel', 'arik-story', 'simeon-day']::text[]);
