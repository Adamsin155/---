-- WAITING FOR THE OWNER'S APPROVAL. Not a migration yet: nothing runs this file.
--
-- Niro Levi ('niro') and "הצל" ('hatzel'), 28.10.2026: the second half of
-- supabase/migrations/20261112100000_new_influencers.sql. Three checks list the values a
-- column may hold, and each has to take the two new ones:
--   clients.shoot_type         ('natali', 'dms')                        20260929120000
--   deal_requests.influencer   ('natali', 'simeon')                     20261003100000
--   deal_requests.paid         the paid add-ons of the field's deals    20261003100000
-- Postgres cannot widen a check in place: it is taken away by name and added again, wider.
-- That is the only kind of statement here that takes anything away (three of them, each
-- followed at once by the wider check); no row and no column is touched. The same kind of
-- statement the owner approved knowingly once before (20261031120000_nirel_any_shoot.sql).
--
-- Once approved: run it in the SQL editor after 20261112100000_new_influencers.sql (or move
-- it to supabase/migrations/20261112100100_new_influencers_checks.sql with the approval noted
-- in its header). Safe to run again. Tested in tests/sql/new-influencers.test.mjs.
-- Until it runs: a client with Niro or "הצל" and a field deal with them are refused, and a
-- signed agreement with them opens its client with no shoot type yet (the office sets it later).

alter table public.clients drop constraint if exists clients_shoot_type_check;
alter table public.clients add constraint clients_shoot_type_check
  check (shoot_type in ('natali', 'niro', 'hatzel', 'dms'));

alter table public.deal_requests drop constraint if exists deal_requests_influencer_check;
alter table public.deal_requests add constraint deal_requests_influencer_check
  check (influencer in ('natali', 'simeon', 'niro', 'hatzel'));

-- A podcast deal may take up to 800 ₪ a month with no approval (the owner, 28.10.2026; app/catalog.js
-- maxDiscountFor); every other package keeps 200 ₪, as the app checks.
alter table public.deal_requests drop constraint if exists deal_requests_discount_agorot_check;
alter table public.deal_requests add constraint deal_requests_discount_agorot_check
  check (discount_agorot between 0 and 80000 and (discount_agorot <= 20000 or tier = 'podcast'));

alter table public.deal_requests drop constraint if exists deal_requests_paid_check;
alter table public.deal_requests add constraint deal_requests_paid_check
  check (paid <@ array['photographer', 'natali-reel', 'natali-story', 'niro-reel', 'niro-story',
    'hatzel-reel', 'hatzel-story', 'simeon-day']::text[]);
