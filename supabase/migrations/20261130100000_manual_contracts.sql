-- A signed contract uploaded by hand, read and confirmed (the owner, 5.11.2026: "המערכת יכולה לדעת
-- מתוך החוזה שמעלים"; docs/ops.md, section 104). The contract-ai function reads the file and the
-- uploader confirms what was found; the confirmed details are kept here, one row for each contract
-- file, and quotes.html lists them as "נחתם · חוזה ידני" with their amounts.
--
-- Why a table of its own and not rows in public.quotes: a quote carries a public signing link, a
-- signature, a document hash and its triggers (the client signs it); a contract signed elsewhere has
-- none of these, and a row there would open the signing page to a document that was never made.
--
-- Who:
--   reads   whoever sees the quotes' money (public.sees_quote_money(): the owners, Irit, Ofir, Lior);
--   writes  the same, and only on a client they may add files to (public.can_upload_client_file),
--           and only for a signed contract file of that same client.
-- Who wrote it and when come from the session, never from the browser. Nothing is removed from here
-- by the site (clients and files are archived, never removed).
--
-- Only adds. Safe to run again. Tested in tests/sql/manual-contracts.test.mjs.

create table if not exists public.manual_contracts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id),
  file_id uuid not null unique references public.client_files (id),
  business text check (business is null or char_length(business) between 1 and 120),
  company_id text check (company_id is null or company_id ~ '^[0-9]{9}$'),
  contact_name text check (contact_name is null or char_length(contact_name) between 1 and 80),
  package_id text check (package_id is null or package_id ~ '^[a-z-]{3,40}$'),
  package_name text check (package_name is null or char_length(package_name) <= 200),
  monthly_net_agorot integer check (monthly_net_agorot is null or monthly_net_agorot between 100 and 20000000),
  term_months integer check (term_months is null or term_months between 1 and 60),
  signed_on date,
  read_by_ai boolean not null default false,
  created_by_email text not null default '',
  created_at timestamptz not null default now(),
  updated_by_email text,
  updated_at timestamptz
);
create index if not exists manual_contracts_client_idx on public.manual_contracts (client_id);

alter table public.manual_contracts enable row level security;
revoke all on table public.manual_contracts from public, anon, authenticated;
grant select, insert, update (business, company_id, contact_name, package_id, package_name, monthly_net_agorot, term_months, signed_on, read_by_ai)
  on table public.manual_contracts to authenticated;

-- The file must be a signed contract ("חוזה חתום") of the same client.
create or replace function private.manual_contract_file_ok(p_client uuid, p_file uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.client_files f
    where f.id = p_file and f.client_id = p_client and f.kind = 'material_other'
      and btrim(coalesce(f.label, '')) = 'חוזה חתום' and f.deleted_at is null);
$$;
revoke execute on function private.manual_contract_file_ok(uuid, uuid) from public, anon;
grant execute on function private.manual_contract_file_ok(uuid, uuid) to authenticated;

-- Who and when: from the session. The client and the file of a row never change.
create or replace function private.manual_contracts_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by_email := lower(coalesce(auth.jwt() ->> 'email', ''));
    new.created_at := now();
    new.updated_by_email := null;
    new.updated_at := null;
  else
    new.client_id := old.client_id;
    new.file_id := old.file_id;
    new.created_by_email := old.created_by_email;
    new.created_at := old.created_at;
    new.updated_by_email := lower(coalesce(auth.jwt() ->> 'email', ''));
    new.updated_at := now();
  end if;
  return new;
end $$;
create or replace trigger manual_contracts_stamp before insert or update on public.manual_contracts
for each row execute function private.manual_contracts_stamp();

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'manual_contracts' and policyname = 'manual contracts: who reads') then
    create policy "manual contracts: who reads" on public.manual_contracts
      for select to authenticated using ((select public.sees_quote_money()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'manual_contracts' and policyname = 'manual contracts: who adds') then
    create policy "manual contracts: who adds" on public.manual_contracts
      for insert to authenticated
      with check ((select public.sees_quote_money())
        and public.can_upload_client_file(client_id, 'material_other')
        and private.manual_contract_file_ok(client_id, file_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'manual_contracts' and policyname = 'manual contracts: who corrects') then
    create policy "manual contracts: who corrects" on public.manual_contracts
      for update to authenticated
      using ((select public.sees_quote_money()) and public.can_upload_client_file(client_id, 'material_other'))
      with check ((select public.sees_quote_money()) and public.can_upload_client_file(client_id, 'material_other'));
  end if;
end $$;
