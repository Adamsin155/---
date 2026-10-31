-- The income records of the old system, kept to look at (the owner, 31.10.2026; docs/ops.md, section 86).
--   public.old_income_deals  one row per deal of the old system, a copy as of 27.10.2026.
-- Nothing reads it but the owners' tab "הכנסות ישנות" (owner.html#old-income): no payment, commission,
-- salary or profit split touches it, it has no link to any other table and no trigger.
-- Who: the owners read (public.sees_money()). Nobody writes from the app or from a function. The rows
-- come in by SQL run by the owner, with on conflict (old_id) do nothing; they are not in this file.
-- Not in Realtime, not on the Claude gate's list (public.mcp_request_gate) and not in the tools of `ask`.
-- The amounts are as the old system recorded them, in whole shekels; whether with VAT is not known.
-- The file only adds, and can run again safely (tests/sql/old-income.test.mjs).

create table if not exists public.old_income_deals (
  old_id text primary key,
  deal_date date,
  business text,
  amount integer not null,
  retainer integer,
  package text,
  influencer_group text,
  payment_method text,
  close_type text,
  lead_source text,
  imported_at timestamptz not null default now()
);

alter table public.old_income_deals enable row level security;
revoke all on table public.old_income_deals from public, anon, authenticated, service_role;
grant select on table public.old_income_deals to authenticated, service_role;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'old_income_deals' and policyname = 'old_income_deals_read') then
    create policy old_income_deals_read on public.old_income_deals for select to authenticated using ((select public.sees_money()));
  end if;
end $$;
