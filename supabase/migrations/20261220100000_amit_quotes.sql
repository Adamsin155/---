-- Amit builds quotes and contracts and reads the list of sent quotes with their amounts, as Irit
-- (the owner, 22.11.2026, at Lior's request: "שתתן לעמית גישה להכנת חוזים והצעות מחיר", and asked
-- whether she sees the list: "כן שתראה את הרשימה"; docs/ops.md, section 144).
--
-- Building is already open to her: create-quote and contract-ai answer the office
-- (public.is_office(), with Amit since 20261214100000_amit.sql), and the screens follow
-- app/manager-rules.js (QUOTE_BUILDERS). What the database still closed to her: the restrictive
-- policy "money: who reads a quote" let her read only the quotes she made. From here
-- public.sees_quote_money() answers her too, and with it:
--   * public.quotes, every quote with its amounts (the list and the month's two sums of quotes.html);
--   * public.quote_versions (their policy reads public.quotes);
--   * public.manual_contracts, the contracts signed elsewhere (read, add, correct, as Irit);
--   * public.hidden_quotes (it was open to the office already).
-- And public.can_edit_quotes() (at the end): the price and the package's name of one quote, as Irit.
-- Not changed: public.sees_income() and private.quote_reader() (the prices in the clients' table,
-- the sellers' deals with their discount, the AI runs of others, approving an exceptional
-- contract), public.sees_money() and the payments app. Nobody else's rights moved.
--
-- Replaces one function and adds one (below). Safe to run again. Tested in tests/sql/amit-quotes.test.mjs.

create or replace function public.sees_quote_money() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.sees_income() or (public.is_staff() and coalesce(public.my_person() = 'amit', false));
$$;
revoke execute on function public.sees_quote_money() from public, anon;
grant execute on function public.sees_quote_money() to authenticated;

-- "שינויים להצעה הזו" and a price typed in "חוזה מותאם אישית" (selection.custom.price, packageName,
-- influencerName; docs/ops.md, section 123): until now public.is_manager() only, which create-quote
-- asked. Irit builds her contracts with them, so Amit too. A function of its own, so that nothing else
-- of the managers' (public.is_manager(): the archive, screen 1, the approvals) moves to her.
-- create-quote asks this one from here (supabase/functions/create-quote/http.js callerMayEditQuote):
-- run this file BEFORE deploying create-quote.
create or replace function public.can_edit_quotes() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_manager() or (public.is_staff() and coalesce(public.my_person() = 'amit', false));
$$;
revoke execute on function public.can_edit_quotes() from public, anon;
grant execute on function public.can_edit_quotes() to authenticated;
