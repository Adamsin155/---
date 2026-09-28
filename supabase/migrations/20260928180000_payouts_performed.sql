-- Influencer work marked as done (shoot days, podcast recordings, posts).
-- Feeds the separate influencer tabs only: when a task is marked with a
-- date, the influencer is owed its share in that date's month.
create table public.payout_performed (
  deal_id uuid not null references public.payout_deals (id) on delete cascade,
  task_key text not null check (task_key ~ '^[a-z0-9-]+:[0-9]+$' or task_key = 'recording'),
  performed_on date not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  primary key (deal_id, task_key)
);
create index payout_performed_date_idx on public.payout_performed (performed_on);

alter table public.payout_performed enable row level security;
revoke all on public.payout_performed from anon;
create policy "owners select" on public.payout_performed for select to authenticated using ((select private.is_payout_owner()));
create policy "owners insert" on public.payout_performed for insert to authenticated with check ((select private.is_payout_owner()));
create policy "owners update" on public.payout_performed for update to authenticated using ((select private.is_payout_owner())) with check ((select private.is_payout_owner()));
create policy "owners delete" on public.payout_performed for delete to authenticated using ((select private.is_payout_owner()));
