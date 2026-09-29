-- Deal term: annual (12 months) or half-year (6 months).
alter table public.payout_deals
  add column term_months smallint not null default 12 check (term_months in (6, 12)),
  add constraint payout_deals_paid_within_term check (paid_months is null or paid_months <= term_months),
  add constraint payout_deals_installments_within_term check (installments is null or installments <= term_months);

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
      only_cancel := (new.deal_date, new.client, new.selection, new.perks, new.seller, new.note, new.quote_id, new.pay_method, new.installments, new.term_months)
        is not distinct from (old.deal_date, old.client, old.selection, old.perks, old.seller, old.note, old.quote_id, old.pay_method, old.installments, old.term_months);
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
