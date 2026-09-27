-- Deal cancellation (commission clawback in the cancellation month) and
-- typed monthly variable costs (fuel, car depreciation, meetings, other).

alter table public.payout_deals
  add column cancelled_on date,
  add column paid_months smallint check (paid_months between 0 and 12),
  add constraint payout_deals_cancel_pair check ((cancelled_on is null) = (paid_months is null)),
  add constraint payout_deals_cancel_after check (cancelled_on is null or cancelled_on >= deal_date);
create index payout_deals_cancelled_idx on public.payout_deals (cancelled_on) where cancelled_on is not null;

alter table public.payout_expenses
  add column kind text not null default 'other' check (kind in ('fuel', 'depreciation', 'meetings', 'other')),
  add column qty integer check (qty is null or qty between 0 and 10000);

-- A deal belongs to its closing month; its cancellation belongs to the
-- cancellation month. Changing only the cancellation of a deal from a locked
-- month is allowed as long as the cancellation month itself is open.
create or replace function private.guard_dated_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  d_old date;
  d_new date;
  c_old date;
  c_new date;
  p_old smallint;
  p_new smallint;
  only_cancel boolean := false;
begin
  if tg_table_name = 'payout_deals' then
    if tg_op <> 'INSERT' then d_old := old.deal_date; c_old := old.cancelled_on; p_old := old.paid_months; end if;
    if tg_op <> 'DELETE' then d_new := new.deal_date; c_new := new.cancelled_on; p_new := new.paid_months; end if;
    if tg_op = 'UPDATE' then
      only_cancel := (new.deal_date, new.client, new.selection, new.perks, new.seller, new.note, new.quote_id)
        is not distinct from (old.deal_date, old.client, old.selection, old.perks, old.seller, old.note, old.quote_id);
    end if;
  else
    if tg_op <> 'INSERT' then d_old := old.income_date; end if;
    if tg_op <> 'DELETE' then d_new := new.income_date; end if;
  end if;
  if not only_cancel and (
       (d_old is not null and private.month_locked(to_char(d_old, 'YYYY-MM')))
    or (d_new is not null and private.month_locked(to_char(d_new, 'YYYY-MM')))) then
    raise exception 'month is locked';
  end if;
  if (c_old is distinct from c_new or p_old is distinct from p_new) and (
       (c_old is not null and private.month_locked(to_char(c_old, 'YYYY-MM')))
    or (c_new is not null and private.month_locked(to_char(c_new, 'YYYY-MM')))) then
    raise exception 'month is locked';
  end if;
  if tg_op = 'UPDATE' and tg_table_name = 'payout_deals' then
    new.updated_at := now();
  end if;
  return coalesce(new, old);
end $$;
revoke all on function private.guard_dated_row() from public, anon;
