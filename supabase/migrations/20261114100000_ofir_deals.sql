-- Ofir reads the list of sent quotes with their amounts (the owner's decision of 29.10.2026:
-- "לאופיר את העסקאות של חודש", and asked what exactly: "כמו שאתה רואה"; docs/ops.md, section 74).
--
-- quotes.html ("הצעות שנשלחו", app/dashboard.js) shows the owners every sent and signed quote
-- with its amount, and the month's two sums ("נשלח החודש · כולל מע״מ", "נחתם החודש · כולל מע״מ").
-- The screen reads them from public.quotes itself (term_gross_agorot, monthly_gross_agorot);
-- it calls no sum function. Until now that table answered Ofir only with a contract that waits
-- for a decision or for the client (the approval card) and with the quotes he made himself
-- (20261013100000_money_owners_only.sql, the policy "money: who reads a quote").
--
-- From here:
--   * public.sees_quote_money(): the owners and Ofir, the people whose screen shows the quotes
--     with their amounts. A narrow function of its own: public.sees_money() (every sum of
--     income, the prices in the clients' table and its CSV, manager_client_finance()) stays
--     the two owners', and the payments app stays public.payout_owners'.
--   * the restrictive policy "money: who reads a quote" on public.quotes also lets
--     public.sees_quote_money() through. The quote versions follow the quotes (their policy
--     reads public.quotes), so Ofir reads the versions of the quotes he now reads.
--   * not changed: private.quote_reader() (so the sellers' deals, public.deal_requests, and
--     the AI preparations, public.contract_ai_runs, stay the owners' and Irit's), Irit (as
--     before: the whole list, the screen hides the amounts), Lior (still only the contracts
--     that wait for a decision, and his own), Ilai, the editors and everyone else.
--
-- Only adds and replaces: one new function, and the same policy given one more condition.
-- Every statement can run again safely. Tested in tests/sql/ofir-deals.test.mjs.

-- ── 1. Who sees the quotes with their amounts ──
create or replace function public.sees_quote_money() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff() and (public.sees_money() or coalesce(public.my_person() = 'ofir', false));
$$;
revoke execute on function public.sees_quote_money() from public, anon;
grant execute on function public.sees_quote_money() to authenticated;

-- ── 2. The quotes: Ofir reads them all ──────
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'quotes' and policyname = 'money: who reads a quote') then
    alter policy "money: who reads a quote" on public.quotes
      using ((select private.quote_reader()) = 'all'
        or (select public.sees_quote_money())
        or ((select private.quote_reader()) = 'approver' and approval <> 'none' and status = 'sent')
        or created_by_email = nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''));
  else
    create policy "money: who reads a quote" on public.quotes as restrictive
      for select to authenticated
      using ((select private.quote_reader()) = 'all'
        or (select public.sees_quote_money())
        or ((select private.quote_reader()) = 'approver' and approval <> 'none' and status = 'sent')
        or created_by_email = nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''));
  end if;
end $$;
