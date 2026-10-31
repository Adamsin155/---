-- The owner's decisions of 31.10.2026 (docs/ops.md, section 85):
--   1. A deal from the field goes to Irit and to Ofir together. Whoever takes it first prepares it;
--      the other can no longer touch it. public.deal_take() is the one way to take it (one row, so
--      of two presses at the same moment only one wins), and the trigger below holds the rule for
--      every other write too. The owners may hand a deal to either of them (public.deal_hand_over).
--   2. Ofir now reads the sellers' deals, as he prepares them. Everything else of the money stays
--      as it was (public.sees_money(), public.sees_quote_money()).
--   3. "הנחה חריגה": deal_requests.special_discount_agorot, any amount. A column of its own, since
--      discount_agorot keeps its old limit (200 ₪).
--   4. The client's company number and business address come with the deal: company_id,
--      business_address (an agreement requires them: app/deal-logic.js and the create-quote
--      function; the table takes them either way).
-- Only adds and replaces. Every statement can run again safely. Tested in tests/sql/deal-pool.test.mjs.

-- ── 1. The new columns ───────────────────────
alter table public.deal_requests add column if not exists taken_by text;
alter table public.deal_requests add column if not exists taken_at timestamptz;
alter table public.deal_requests add column if not exists company_id text;
alter table public.deal_requests add column if not exists business_address text;
alter table public.deal_requests add column if not exists special_discount_agorot integer;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'deal_requests_taken_by_check' and conrelid = 'public.deal_requests'::regclass) then
    alter table public.deal_requests add constraint deal_requests_taken_by_check check (taken_by is null or taken_by in ('irit', 'ofir'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'deal_requests_company_id_check' and conrelid = 'public.deal_requests'::regclass) then
    alter table public.deal_requests add constraint deal_requests_company_id_check check (company_id is null or length(company_id) <= 20);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'deal_requests_business_address_check' and conrelid = 'public.deal_requests'::regclass) then
    alter table public.deal_requests add constraint deal_requests_business_address_check check (business_address is null or length(business_address) <= 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'deal_requests_special_discount_check' and conrelid = 'public.deal_requests'::regclass) then
    alter table public.deal_requests add constraint deal_requests_special_discount_check check (special_discount_agorot is null or special_discount_agorot between 0 and 100000000);
  end if;
end $$;

-- ── 2. Ofir reads the deals ──────────────────
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'deal_requests' and policyname = 'money: who reads a deal') then
    alter policy "money: who reads a deal" on public.deal_requests
      using ((select private.quote_reader()) = 'all'
        or coalesce((select public.my_person()) = 'ofir', false)
        or created_by_email = nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''));
  else
    create policy "money: who reads a deal" on public.deal_requests as restrictive
      for select to authenticated
      using ((select private.quote_reader()) = 'all'
        or coalesce((select public.my_person()) = 'ofir', false)
        or created_by_email = nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''));
  end if;
end $$;

-- ── 3. The rule, on every write ──────────────
-- The time it was taken comes from the database, never from the browser. A new deal is nobody's.
-- With no signed-in person (the system, the client signing) and for the owners nothing is refused.
-- For anyone else: a deal is taken only by the person pressing, only when it is still free and
-- waiting; a deal taken by someone else cannot be changed; a waiting deal that nobody took cannot
-- be moved or linked to a quote.
create or replace function public.deal_requests_taken() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  who text;
begin
  if tg_op = 'INSERT' then
    new.taken_by := null;
    new.taken_at := null;
    return new;
  end if;
  if new.taken_by is distinct from old.taken_by then
    new.taken_at := case when new.taken_by is null then null else now() end;
  else
    new.taken_at := old.taken_at;
  end if;
  if me = '' or public.sees_money() or new.status = 'signed' then
    return new;
  end if;
  who := public.my_person();
  if new.taken_by is distinct from old.taken_by
    and not (old.taken_by is null and new.taken_by = who and old.status = 'pending') then
    raise exception 'deal_taken' using errcode = 'P0001';
  end if;
  if old.taken_by is not null and old.taken_by is distinct from who then
    raise exception 'deal_taken' using errcode = 'P0001';
  end if;
  if old.status = 'pending' and old.taken_by is null and new.taken_by is null
    and (new.status is distinct from old.status or new.quote_id is distinct from old.quote_id) then
    raise exception 'deal_not_taken' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function public.deal_requests_taken() from public, anon, authenticated;
create or replace trigger deal_requests_taken before insert or update on public.deal_requests
for each row execute function public.deal_requests_taken();

-- ── 4. Taking a deal ─────────────────────────
-- { ok, taken_by, status }. ok: it is the caller's now (or was), or there is nothing to take (an
-- owner, or a deal no longer waiting and nobody's). Not ok: it is someone else's, and taken_by says whose.
create or replace function public.deal_take(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  who text := public.my_person();
  d public.deal_requests%rowtype;
begin
  if not (public.sees_money() or coalesce(who in ('irit', 'ofir'), false)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not public.sees_money() then
    update public.deal_requests set taken_by = who where id = p_id and taken_by is null and status = 'pending';
  end if;
  select * into d from public.deal_requests where id = p_id;
  if not found then
    raise exception 'deal not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('ok', public.sees_money() or d.taken_by is null or d.taken_by = who, 'taken_by', d.taken_by, 'status', d.status);
end $$;
revoke execute on function public.deal_take(uuid) from public, anon;
grant execute on function public.deal_take(uuid) to authenticated;

-- The owners hand a waiting deal to Irit or to Ofir; that person's ten minutes start again.
create or replace function public.deal_hand_over(p_id uuid, p_person text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d public.deal_requests%rowtype;
begin
  if not public.sees_money() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_person is null or p_person not in ('irit', 'ofir') then
    raise exception 'invalid person' using errcode = '22023';
  end if;
  update public.deal_requests set taken_by = p_person where id = p_id and status = 'pending' returning * into d;
  if not found then
    raise exception 'deal not waiting' using errcode = 'P0002';
  end if;
  return jsonb_build_object('ok', true, 'taken_by', d.taken_by, 'status', d.status);
end $$;
revoke execute on function public.deal_hand_over(uuid, text) from public, anon;
grant execute on function public.deal_hand_over(uuid, text) to authenticated;
