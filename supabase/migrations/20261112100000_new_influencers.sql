-- Two more influencers, the owner's decision of 28.10.2026: Niro Levi ('niro') and "הצל",
-- Yoav Eliasi ('hatzel'). Each is sold exactly as Natali Dadon (app/catalog.js STARS): the
-- same three packages with the same prices and quantities, and a reel and a story at the
-- influencer as paid add-ons. A shoot day with either runs as Natali's (app/protocol.js
-- isStarDay): its own shoot type, Nirel preselected and seeing the client.
--
-- What this file changes, each function re-created from its latest definition with the
-- same signature, its grants kept (create or replace keeps them):
--   private.is_star_day(text)        new: the shoot types of a day like Natali's, in one place;
--   public.package_deliverables      the six new packages' quantities (Natali's), and the
--                                    reel and the story of each star add one collab or story
--                                    (as packageDeliverables() in app/protocol-logic.js);
--   public.open_client_on_signing    a signed agreement with Niro or "הצל" opens its client
--                                    with that shoot type (as with Natali: 'natali');
--   private.my_clients, public.can_see_client, private.landing_link_clients
--                                    Nirel sees every client of a star's day, not only
--                                    Natali's (20261014100000_security_hardening.sql,
--                                    20261031100000_access_and_editors.sql).
--
-- What it does not change: the checks that list the values of clients.shoot_type ('natali',
-- 'dms'; 20260929120000) and of deal_requests.influencer and .paid (20261003100000). A check
-- can only be widened by taking it away first, which this file never does. Until those three
-- are widened, a client with 'niro' or 'hatzel' and a field deal with them are refused, and
-- a signed agreement with them opens its client with no shoot type yet (set in the card). The
-- widening waits for the owner's approval: supabase/pending/new_influencers_checks.sql.
--
-- Only adds, safe to run again (tests/sql/new-influencers.test.mjs).

-- ── 1. A day like Natali's ───────────────────
create or replace function private.is_star_day(p_type text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p_type in ('natali', 'niro', 'hatzel'), false);
$$;
revoke all on function private.is_star_day(text) from public, anon;
grant execute on function private.is_star_day(text) to authenticated;

-- ── 2. What a signed agreement grants ────────
-- As 20261010100000_custom_contracts.sql, with the packages of Niro and of "הצל" (Natali's
-- quantities) and the reel and the story of every star.
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
      ('social-natali', 25, 35, 1, 0, 0, 0, 0),
      ('social-tv-natali', 42, 42, 1, 0, 0, 1, 0),
      ('podcast-niro', 20, 20, 0, 0, 0, 0, 1),
      ('social-niro', 25, 35, 1, 0, 0, 0, 0),
      ('social-tv-niro', 42, 42, 1, 0, 0, 1, 0),
      ('podcast-hatzel', 20, 20, 0, 0, 0, 0, 1),
      ('social-hatzel', 25, 35, 1, 0, 0, 0, 0),
      ('social-tv-hatzel', 42, 42, 1, 0, 0, 1, 0)
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

-- ── 3. The client a signed agreement opens ───
-- As 20260929160000_client_protocol_batch2.sql; Niro's and "הצל"'s agreements open the
-- client with their own shoot type.
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
      when 'niro' then 'niro' when 'hatzel' then 'hatzel' end;
    -- Until the check of clients.shoot_type takes Niro and "הצל" (the pending file), their client
    -- still opens, with no shoot type yet (the office sets it in the card).
    if v_type in ('niro', 'hatzel') and not exists (select 1 from pg_constraint
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

-- ── 4. Nirel sees every client of a star's day ──
-- As 20261014100000_security_hardening.sql.
create or replace function private.my_clients() returns setof uuid
language sql stable security definer set search_path = '' as $$
  with me as (select public.my_person() as p)
  select a.id from private.my_assigned_clients() as a(id)
  union
  select c.id from public.clients c, me
  where me.p = 'nirel' and private.is_star_day(c.shoot_type)
  union
  select c.id from public.clients c, me
  where me.p = 'eli' and private.shoot_in_window(c.shoot_at, c.rounds);
$$;

create or replace function public.can_see_client(p_client uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  with me as (select public.my_person() as p)
  select not private.is_archived(p_client) and (public.is_office() or (me.p is not null and (
    private.is_assigned(p_client)
    or exists (select 1 from public.clients c where c.id = p_client and (
      (me.p = 'nirel' and private.is_star_day(c.shoot_type))
      or (me.p = 'eli' and private.shoot_in_window(c.shoot_at, c.rounds)))))))
  from me;
$$;

-- As 20261031100000_access_and_editors.sql (the landing's personal link).
create or replace function private.landing_link_clients(p_person text) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.clients c
  where c.landing and c.status in ('active', 'ending')
    and (p_person in ('irit', 'lior', 'ofir', 'ilai', 'eli')
      or c.editor = p_person or c.editor2 = p_person
      or exists (select 1 from jsonb_array_elements(coalesce(c.rounds, '[]'::jsonb)) r where r ->> 'editor' = p_person or r ->> 'editor2' = p_person)
      or (p_person = 'nirel' and private.is_star_day(c.shoot_type)));
$$;
