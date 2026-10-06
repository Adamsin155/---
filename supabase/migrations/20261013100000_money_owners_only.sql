-- Money for the two owners only (the owner's decision, 6.10.2026; docs/ops.md, section 35).
--
-- Until now public.quotes (every agreement with its prices), public.quote_versions and
-- public.deal_requests answered the whole office (the owners, Irit, Lior, Ofir and Ilai),
-- and public.manager_client_finance() answered the managers (the owners, Irit, Ofir).
-- From here:
--   * sums of income and the prices of all the contracts together: the owners
--     (a staff login whose row has no person), public.sees_money();
--   * the price of one contract stays only where the work needs it:
--       - Irit, who builds the contracts, reads the quotes and the sellers' deals;
--       - Ofir and Lior read an exceptional contract while it waits for a decision
--         or for the client (the approval card);
--       - whoever made a quote reads that quote; a seller reads their own deals;
--   * everything else the office needs from a signed agreement (its number, the signing
--     day, the package, the quantities) comes from public.quote_facts(), without money.
-- The payments app (payout_* tables) was already for public.payout_owners only and is
-- not changed here.
--
-- Safe to run twice. Nothing is taken away from any table: functions are replaced,
-- and each table gets one more policy, a restrictive one, next to the ones it has.

-- ── 1. Who sees money ────────────────────────
create or replace function public.sees_money() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff() and exists (
    select 1 from public.staff s
    where s.email = lower(coalesce(auth.jwt() ->> 'email', '')) and s.person is null);
$$;
revoke execute on function public.sees_money() from public, anon;
grant execute on function public.sees_money() to authenticated;

-- How much of the quotes this login reads: 'all' (the owners and Irit), 'approver'
-- (Ofir and Lior: public.can_approve_quotes() without the owners), or 'none'.
create or replace function private.quote_reader() returns text
language sql stable security definer set search_path = '' as $$
  select case
    when not public.is_staff() then 'none'
    when public.sees_money() or coalesce(public.my_person() = 'irit', false) then 'all'
    when public.can_approve_quotes() then 'approver'
    else 'none' end;
$$;
revoke execute on function private.quote_reader() from public, anon;
grant execute on function private.quote_reader() to authenticated;

-- ── 2. The quotes, their versions and the sellers' deals ──
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'quotes' and policyname = 'money: who reads a quote') then
    alter policy "money: who reads a quote" on public.quotes
      using ((select private.quote_reader()) = 'all'
        or ((select private.quote_reader()) = 'approver' and approval <> 'none' and status = 'sent')
        or created_by_email = nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''));
  else
    create policy "money: who reads a quote" on public.quotes as restrictive
      for select to authenticated
      using ((select private.quote_reader()) = 'all'
        or ((select private.quote_reader()) = 'approver' and approval <> 'none' and status = 'sent')
        or created_by_email = nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''));
  end if;

  -- A version is read by whoever reads its quote now (the quotes' own policies decide).
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'quote_versions' and policyname = 'money: who reads a quote version') then
    alter policy "money: who reads a quote version" on public.quote_versions
      using (exists (select 1 from public.quotes q where q.id = quote_id));
  else
    create policy "money: who reads a quote version" on public.quote_versions as restrictive
      for select to authenticated
      using (exists (select 1 from public.quotes q where q.id = quote_id));
  end if;

  -- A deal carries what was agreed (the discount, a price typed by hand): the owners,
  -- Irit, and the seller whose deal it is.
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'deal_requests' and policyname = 'money: who reads a deal') then
    alter policy "money: who reads a deal" on public.deal_requests
      using ((select private.quote_reader()) = 'all'
        or created_by_email = nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''));
  else
    create policy "money: who reads a deal" on public.deal_requests as restrictive
      for select to authenticated
      using ((select private.quote_reader()) = 'all'
        or created_by_email = nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''));
  end if;
end $$;

-- ── 3. The prices next to each client: the owners ──
-- (It was public.is_manager(): the owners, Irit and Ofir.)
create or replace function public.manager_client_finance()
returns table (client_id uuid, quote_number text, signed_at timestamptz, monthly_net_agorot integer,
  monthly_gross_agorot integer, term_gross_agorot integer, discount_agorot integer, term_months integer)
language sql stable security definer set search_path = '' as $$
  select c.id, q.number, q.signed_at,
    case when jsonb_typeof(q.model -> 'totals' -> 'monthlyNet') = 'number' then round((q.model -> 'totals' ->> 'monthlyNet')::numeric)::integer end,
    q.monthly_gross_agorot, q.term_gross_agorot,
    case when jsonb_typeof(q.model -> 'totals' -> 'discount') = 'number' then round((q.model -> 'totals' ->> 'discount')::numeric)::integer end,
    case when jsonb_typeof(q.model -> 'termMonths') = 'number' then round((q.model ->> 'termMonths')::numeric)::integer end
  from public.clients c
  join public.quotes q on q.id = c.quote_id
  where (select public.sees_money()) and c.archived_at is null;
$$;
revoke execute on function public.manager_client_finance() from public, anon;
grant execute on function public.manager_client_finance() to authenticated;

-- ── 4. What the office needs from an agreement, without money ──
-- A selection without its money: the monthly discount, a price typed by hand, and the
-- price of each added line. The package, the add-ons, the quantities, the term and the
-- special terms stay (the protocol counts the deliverables from them).
create or replace function private.selection_without_money(p jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select case
    when jsonb_typeof(p) is distinct from 'object' then p
    when jsonb_typeof(p -> 'custom') is distinct from 'object' then p - 'discount'
    else (p - 'discount') || jsonb_build_object('custom',
      ((p -> 'custom') - 'price' - 'discount') ||
      case when jsonb_typeof(p -> 'custom' -> 'lines') = 'array'
        then jsonb_build_object('lines', (select coalesce(jsonb_agg(l - 'monthly'), '[]'::jsonb) from jsonb_array_elements(p -> 'custom' -> 'lines') l))
        else '{}'::jsonb end)
  end;
$$;
revoke execute on function private.selection_without_money(jsonb) from public, anon, authenticated;

-- The facts of agreements for the office (as public.quotes answered it until now, minus
-- the money and the client's link): these agreements, or with no list every signed one
-- (opening a client from a signed agreement). Whoever reads the quotes anyway gets the
-- selection whole, so a renewal starts from exactly what was signed.
create or replace function public.quote_facts(p_ids uuid[] default null)
returns table (id uuid, number text, status text, signed_at timestamptz, client_name text, client jsonb,
  tier text, influencer text, package_id text, selection jsonb, term_months integer)
language sql stable security definer set search_path = '' as $$
  select q.id, q.number, q.status, q.signed_at, q.client_name, q.model -> 'client',
    q.model -> 'package' ->> 'tierName', q.model -> 'package' ->> 'influencer', q.model -> 'package' ->> 'id',
    case when (select private.quote_reader()) = 'all' then q.model -> 'selection'
      else private.selection_without_money(q.model -> 'selection') end,
    case when jsonb_typeof(q.model -> 'termMonths') = 'number' then round((q.model ->> 'termMonths')::numeric)::integer end
  from public.quotes q
  where (select public.is_office())
    and case when p_ids is null then q.status = 'signed' else q.id = any (p_ids) end
  order by q.signed_at desc nulls last
  limit 1000;
$$;
revoke execute on function public.quote_facts(uuid[]) from public, anon;
grant execute on function public.quote_facts(uuid[]) to authenticated;
