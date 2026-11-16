-- Gal, the office's bookkeeper ("מנהלת חשבונות"; the owner's request of 16.11.2026; docs/ops.md,
-- section 137). She signs in with her own login and has ONE screen, "לקוחות לחשבוניות"
-- (bookkeeper.html): the active clients (status 'active' or 'ending', not archived), and for each
-- what she types into an invoice: the contact's name, the business, ח.פ, the phone, the email, and
-- the amount with VAT a month and for the whole contract.
--
-- What she may read is decided here, not by the screen:
--   - she is not the office (public.is_office()) and has no client of her own (private.my_clients()
--     names nobody for her), so every table of the clients answers her with nothing: no client card,
--     mark, task, vault row, quote, Gantt, file or note;
--   - what she sees comes from one function, public.bookkeeper_clients(): those fields only, of the
--     active clients only. No client id, address, note, login or anything of the work;
--   - two tables every staff member reads are narrowed for her (restrictive policies, section 4):
--     the team list (public.staff: only her own row, as Tal) and the old system's characterizations
--     (public.legacy_characterizations: nothing).
-- Her row in public.staff needs staff_person_check to take 'gal': that is
-- supabase/pending/bookkeeper_gal_checks.sql, which waits for the owner's explicit approval. Until
-- it runs this file is harmless: nobody is 'gal' yet (the owners can already call the function).
-- Only adds and replaces. Safe to run again. Tested in tests/sql/bookkeeper-gal.test.mjs.

-- ── 1. Who she is ───────────────────────────
create or replace function private.bookkeeper_people() returns text[]
language sql immutable set search_path = '' as $$
  select array['gal']::text[];
$$;
revoke all on function private.bookkeeper_people() from public, anon;
grant execute on function private.bookkeeper_people() to authenticated; -- read by the policies of section 4

-- ── 2. The amount of each client ────────────
-- Where a client's price is written, the newest system first (as the money screens read it):
--   'quote'     the signed contract of the builder (clients.quote_id): quotes.monthly_gross_agorot
--               and quotes.term_gross_agorot, both with VAT, as signed (manager_client_finance());
--   'manual'    a signed contract uploaded by hand (public.manual_contracts, the latest): the monthly
--               price before VAT × 1.18; the whole contract = that × term_months;
--   'legacy'    the old system's signed contract (public.legacy_contracts, doc_type 'contract', the
--               latest): retainer (before VAT) × 1.18; the whole contract = total_amount, the
--               contract's own total with VAT (as dashboard.js reads it);
--   'payments'  the deal written on "תשלומי לקוחות" (public.client_payments, the latest deal): the
--               retainer (before VAT) × 1.18; the whole deal = amount, only when it is that monthly
--               amount × whole months (then it is with VAT); otherwise no total ('unclear').
-- VAT is 18% (VAT_RATE_PERCENT in app/pricing.js; tests/bookkeeper-gal.test.mjs keeps them equal).
-- Agorot. Nothing is guessed: what is not written stays null, with `why` saying what is missing.
create or replace function private.bookkeeper_amounts(p_client uuid, p_quote uuid)
returns table (monthly_agorot bigint, total_agorot bigint, months integer, source text, why text)
language plpgsql stable security definer set search_path = '' as $$
declare
  q record;
  m record;
  l record;
  p record;
  v_monthly bigint;
  v_n numeric;
begin
  if p_quote is not null then
    select x.monthly_gross_agorot, x.term_gross_agorot,
      case when jsonb_typeof(x.model -> 'termMonths') = 'number' then round((x.model ->> 'termMonths')::numeric)::integer end as months
      into q from public.quotes x where x.id = p_quote;
    if found and (coalesce(q.monthly_gross_agorot, 0) > 0 or coalesce(q.term_gross_agorot, 0) > 0) then
      return query select nullif(q.monthly_gross_agorot, 0)::bigint, nullif(q.term_gross_agorot, 0)::bigint, q.months, 'quote'::text,
        case when coalesce(q.term_gross_agorot, 0) > 0 then null else 'no_total' end;
      return;
    end if;
  end if;

  select x.monthly_net_agorot, x.term_months into m from public.manual_contracts x
  where x.client_id = p_client and x.monthly_net_agorot is not null
  order by x.signed_on desc nulls last, x.created_at desc limit 1;
  if found then
    v_monthly := round(m.monthly_net_agorot * 1.18);
    return query select v_monthly, case when m.term_months is not null then v_monthly * m.term_months end, m.term_months, 'manual'::text,
      case when m.term_months is null then 'no_term' end;
    return;
  end if;

  select x.retainer, x.total_amount,
    case when jsonb_typeof(x.doc -> 'months') = 'number' then round((x.doc ->> 'months')::numeric)::integer end as months
    into l from public.legacy_contracts x
  where x.client_id = p_client and x.doc_type = 'contract' and (x.retainer > 0 or x.total_amount > 0)
  order by x.signed_at desc nulls last, x.id desc limit 1;
  if found then
    return query select case when l.retainer > 0 then round(l.retainer * 118)::bigint end,
      case when l.total_amount > 0 then round(l.total_amount * 100)::bigint end, l.months, 'legacy'::text,
      case when not coalesce(l.total_amount > 0, false) then 'no_total' when not coalesce(l.retainer > 0, false) then 'no_monthly' end;
    return;
  end if;

  select x.retainer, x.amount into p from public.client_payments x
  where x.client_id = p_client and (x.retainer > 0 or x.amount > 0)
  order by x.deal_date desc nulls last, x.at desc limit 1;
  if found then
    if not coalesce(p.retainer > 0, false) then
      return query select null::bigint, null::bigint, null::integer, 'payments'::text, 'no_monthly'::text;
      return;
    end if;
    v_monthly := round(p.retainer * 118);
    if not coalesce(p.amount > 0, false) then
      return query select v_monthly, null::bigint, null::integer, 'payments'::text, 'no_total'::text;
      return;
    end if;
    v_n := round(p.amount * 100 / v_monthly);
    if v_n between 1 and 60 and abs(p.amount * 100 - v_monthly * v_n) <= 200 then
      return query select v_monthly, round(p.amount * 100)::bigint, v_n::integer, 'payments'::text, null::text;
    else
      return query select v_monthly, null::bigint, null::integer, 'payments'::text, 'unclear'::text;
    end if;
    return;
  end if;

  return query select null::bigint, null::bigint, null::integer, null::text, 'none'::text;
end $$;
revoke all on function private.bookkeeper_amounts(uuid, uuid) from public, anon, authenticated;

-- ── 3. Her screen ───────────────────────────
-- One row per active client (status 'active' or 'ending', not archived; a client still "בקליטה"
-- is a client too), by business name:
--   contact_name, business, company_id (ח.פ), phone, email, status,
--   monthly_agorot, total_agorot (with VAT), months, source, why (see section 2).
-- Her, and the owners (to look at it). Nobody else: not the office, an editor, Eli or the sales.
create or replace function public.bookkeeper_clients()
returns table (contact_name text, business text, company_id text, phone text, email text, status text,
  monthly_agorot bigint, total_agorot bigint, months integer, source text, why text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (coalesce(public.my_person() = any (private.bookkeeper_people()), false) or coalesce(private.is_owner(), false)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
  select nullif(btrim(c.name), ''), nullif(btrim(c.business), ''), nullif(btrim(c.company_id), ''),
    nullif(btrim(c.phone), ''), nullif(btrim(c.contact_email), ''), c.status,
    a.monthly_agorot, a.total_agorot, a.months, a.source, a.why
  from public.clients c
  cross join lateral private.bookkeeper_amounts(c.id, c.quote_id) a
  where c.status in ('active', 'ending') and c.archived_at is null
  order by coalesce(nullif(btrim(c.business), ''), c.name) collate "C", c.name collate "C";
end $$;
revoke all on function public.bookkeeper_clients() from public, anon, authenticated;
grant execute on function public.bookkeeper_clients() to authenticated;

-- ── 4. Two tables every staff member reads: not her ──
-- A restrictive policy is added to the others, and every restrictive one must hold. For anyone who
-- is not the bookkeeper each is always true, so nobody else's reading changes.
do $$
begin
  -- The team list ("staff read staff": names and emails): only her own row, which is all her
  -- screen asks for (who she is). As Tal's ("makeup artist reads only her own row").
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'staff' and policyname = 'bookkeeper reads only her own row') then
    create policy "bookkeeper reads only her own row" on public.staff as restrictive for select to authenticated
      using (not coalesce((select public.my_person()) = any (private.bookkeeper_people()), false)
             or email = lower(coalesce(auth.jwt() ->> 'email', '')));
  end if;
  -- The old system's characterizations (every staff member but the sales reads them): nothing.
  if to_regclass('public.legacy_characterizations') is not null
     and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'legacy_characterizations' and policyname = 'bookkeeper reads no characterization') then
    create policy "bookkeeper reads no characterization" on public.legacy_characterizations as restrictive for select to authenticated
      using (not coalesce((select public.my_person()) = any (private.bookkeeper_people()), false));
  end if;
end $$;
