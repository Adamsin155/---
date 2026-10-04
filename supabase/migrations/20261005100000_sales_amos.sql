-- Amos (staff.person 'amos') is a field sales agent like Stav (the owner's decision,
-- 4.10.2026): the same deal page, his own deals only, nothing of the clients.
-- Safe to run again. Tested in tests/sql/deals.test.mjs.
alter table public.staff drop constraint if exists staff_person_check;
alter table public.staff add constraint staff_person_check
  check (person in ('irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli', 'stav', 'amos', 'editor'));
alter table public.reminder_log drop constraint if exists reminder_log_person_check;
alter table public.reminder_log add constraint reminder_log_person_check
  check (person in ('owner', 'irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli', 'stav', 'amos'));

-- Sales (PEOPLE[…].sales in app/protocol.js): Stav and Amos.
create or replace function private.is_sales() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_person() in ('stav', 'amos'), false);
$$;
revoke execute on function private.is_sales() from public, anon;
grant execute on function private.is_sales() to authenticated;

alter table public.deal_requests drop constraint if exists deal_requests_seller_check;
alter table public.deal_requests add constraint deal_requests_seller_check
  check (seller is null or seller in ('stav', 'amos'));

create or replace function public.deal_requests_stamp() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    if me <> '' then
      new.created_by_email := me;
      new.seller := public.my_person();
      if new.seller is not null and new.seller not in ('stav', 'amos') then new.seller := null; end if;
    end if;
    new.status := 'pending';
    new.quote_id := null;
    new.sent_at := null;
    new.signed_at := null;
    new.status_by_email := null;
  else
    new.id := old.id;
    new.created_at := old.created_at;
    new.created_by_email := old.created_by_email;
    new.seller := old.seller;
    if new.quote_id is not null and new.quote_id is distinct from old.quote_id and new.status = 'pending' then
      new.status := 'sent';
    end if;
    if new.status is distinct from old.status then
      new.status_by_email := nullif(me, '');
      if new.status = 'sent' and new.sent_at is null then new.sent_at := now(); end if;
      if new.status = 'signed' and new.signed_at is null then new.signed_at := now(); end if;
      if new.status = 'pending' then new.sent_at := null; new.signed_at := null; end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.deal_requests_stamp() from public, anon, authenticated;
