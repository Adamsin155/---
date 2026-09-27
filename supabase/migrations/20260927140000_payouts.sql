-- Monthly payouts: deals, settings versions, extra income, one-off expenses
-- and locked months. Owner-only: every table is readable and writable only
-- by users listed in payout_owners (separate from the quote `staff` table).
-- No business values here: the repository is public. Settings are entered
-- from the app (or by the owner in the SQL editor).

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table public.payout_owners (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

-- In a schema that the API does not expose, as Supabase recommends for
-- security definer helpers used by policies.
create function private.is_payout_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.payout_owners o where o.user_id = (select auth.uid()));
$$;
revoke all on function private.is_payout_owner() from public, anon;
grant execute on function private.is_payout_owner() to authenticated;

create table public.payout_settings (
  id uuid primary key default gen_random_uuid(),
  effective_from date not null unique,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  note text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null
);

create table public.payout_deals (
  id uuid primary key default gen_random_uuid(),
  deal_date date not null,
  client text not null check (length(btrim(client)) between 1 and 200),
  selection jsonb not null check (jsonb_typeof(selection) = 'object'),
  perks jsonb not null default '[]' check (jsonb_typeof(perks) = 'array'),
  seller text check (length(seller) <= 100),
  note text check (length(note) <= 2000),
  quote_id uuid unique references public.quotes (id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create index payout_deals_date_idx on public.payout_deals (deal_date);

create table public.payout_incomes (
  id uuid primary key default gen_random_uuid(),
  income_date date not null,
  label text not null check (length(btrim(label)) between 1 and 200),
  family text not null check (family in ('simeon', 'natali')),
  amount_agorot bigint not null check (amount_agorot > 0),
  note text check (length(note) <= 2000),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null
);
create index payout_incomes_date_idx on public.payout_incomes (income_date);

create table public.payout_expenses (
  id uuid primary key default gen_random_uuid(),
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  label text not null check (length(btrim(label)) between 1 and 200),
  payee text check (length(payee) <= 200),
  amount_agorot bigint not null check (amount_agorot >= 0),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null
);
create index payout_expenses_month_idx on public.payout_expenses (month);

-- A locked month keeps the report it was paid by. Deleting the row reopens it.
create table public.payout_locks (
  month text primary key check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  report jsonb not null,
  locked_at timestamptz not null default now(),
  locked_by uuid default auth.uid() references auth.users (id) on delete set null
);

-- ---------- lock enforcement ----------

create function private.month_locked(p_month text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.payout_locks l where l.month = p_month);
$$;

create function private.guard_dated_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  d_old date;
  d_new date;
begin
  if tg_table_name = 'payout_deals' then
    if tg_op <> 'INSERT' then d_old := old.deal_date; end if;
    if tg_op <> 'DELETE' then d_new := new.deal_date; end if;
  else
    if tg_op <> 'INSERT' then d_old := old.income_date; end if;
    if tg_op <> 'DELETE' then d_new := new.income_date; end if;
  end if;
  if (d_old is not null and private.month_locked(to_char(d_old, 'YYYY-MM')))
     or (d_new is not null and private.month_locked(to_char(d_new, 'YYYY-MM'))) then
    raise exception 'month is locked';
  end if;
  if tg_op = 'UPDATE' and tg_table_name = 'payout_deals' then
    new.updated_at := now();
  end if;
  return coalesce(new, old);
end $$;

create trigger payout_deals_guard before insert or update or delete on public.payout_deals
for each row execute function private.guard_dated_row();
create trigger payout_incomes_guard before insert or update or delete on public.payout_incomes
for each row execute function private.guard_dated_row();

create function private.guard_expense() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op <> 'INSERT' and private.month_locked(old.month))
     or (tg_op <> 'DELETE' and private.month_locked(new.month)) then
    raise exception 'month is locked';
  end if;
  return coalesce(new, old);
end $$;

create trigger payout_expenses_guard before insert or update or delete on public.payout_expenses
for each row execute function private.guard_expense();

-- Settings may not start in or before a locked month, so a locked month is
-- never recomputed with different values.
create function private.guard_settings() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  last_locked text;
begin
  select max(month) into last_locked from public.payout_locks;
  if last_locked is not null and (
       (tg_op <> 'INSERT' and to_char(old.effective_from, 'YYYY-MM') <= last_locked)
    or (tg_op <> 'DELETE' and to_char(new.effective_from, 'YYYY-MM') <= last_locked)) then
    raise exception 'settings overlap a locked month';
  end if;
  return coalesce(new, old);
end $$;

create trigger payout_settings_guard before insert or update or delete on public.payout_settings
for each row execute function private.guard_settings();

revoke all on function private.month_locked(text) from public, anon;
revoke all on function private.guard_dated_row() from public, anon;
revoke all on function private.guard_expense() from public, anon;
revoke all on function private.guard_settings() from public, anon;

-- ---------- access ----------

alter table public.payout_owners enable row level security;
alter table public.payout_settings enable row level security;
alter table public.payout_deals enable row level security;
alter table public.payout_incomes enable row level security;
alter table public.payout_expenses enable row level security;
alter table public.payout_locks enable row level security;

revoke all on public.payout_owners, public.payout_settings, public.payout_deals,
  public.payout_incomes, public.payout_expenses, public.payout_locks from anon;

-- Owners are added in the SQL editor only; a user can see whether they are one.
revoke insert, update, delete on public.payout_owners from authenticated;
create policy "owner sees own row" on public.payout_owners
  for select to authenticated using (user_id = (select auth.uid()));

do $$
declare t text;
begin
  foreach t in array array['payout_settings', 'payout_deals', 'payout_incomes', 'payout_expenses', 'payout_locks'] loop
    execute format('create policy "owners select" on public.%I for select to authenticated using ((select private.is_payout_owner()))', t);
    execute format('create policy "owners insert" on public.%I for insert to authenticated with check ((select private.is_payout_owner()))', t);
    execute format('create policy "owners update" on public.%I for update to authenticated using ((select private.is_payout_owner())) with check ((select private.is_payout_owner()))', t);
    execute format('create policy "owners delete" on public.%I for delete to authenticated using ((select private.is_payout_owner()))', t);
  end loop;
end $$;

-- A locked month's snapshot is never edited in place: reopen (delete) and lock again.
revoke update on public.payout_locks from authenticated;
