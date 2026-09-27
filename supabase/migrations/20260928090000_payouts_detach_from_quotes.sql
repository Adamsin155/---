-- Astrateg Payment does not depend on the quote builder's tables.
alter table public.payout_deals drop constraint if exists payout_deals_quote_id_fkey;
comment on column public.payout_deals.quote_id is 'Optional reference to a signed quote; no foreign key, so the payouts tables stand alone.';
