-- The client's details fill themselves (Irit and the owner, 25.11.2026; docs/ops.md, section 153):
-- "כל הלקוחות החדשים - יש חוזה ואיפיון, אבל הפרטים לא מתמלאים בכרטיס לקוח". The details are in the
-- system already: the characterization form (Ofir: the business phone and address) and the contract
-- uploaded by hand (read by contract-ai: company id, and now also the phone, the email and the
-- address). Whichever screen writes them, the client's card gets what it is MISSING; a field
-- already filled is never overwritten.
--   characterizations  after insert or update: clients.phone, clients.address from the form's
--                      fields; clients.char_at (the characterization call), when it has none, the
--                      moment the form is first saved with content (the owner: "לסמן את התאריך
--                      שהייתה השיחה, לא צריכים להזין ידני").
--   manual_contracts   three columns: phone, email, address (as read, corrected in the review);
--                      after insert or update: clients.company_id, contact_email, phone, address.
-- Nothing is dropped or deleted; runs again safely. The old clients: a separate one-time fill, run
-- only after the owner saw the list.

alter table public.manual_contracts
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists address text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'manual_contracts_contact_check') then
    alter table public.manual_contracts add constraint manual_contracts_contact_check check (
      (phone is null or length(phone) <= 40)
      and (email is null or length(email) <= 254)
      and (address is null or length(address) <= 200));
  end if;
end $$;

grant insert (phone, email, address), update (phone, email, address) on table public.manual_contracts to authenticated;

-- A phone as the office writes it: digits, +, -, spaces, brackets; 7 to 20 characters.
create or replace function private.clean_phone(v text) returns text
language sql immutable set search_path = '' as $$
  select case when btrim(coalesce(v, '')) ~ '^[0-9+()\- ]{7,20}$' and btrim(v) ~ '[0-9]{3}' then btrim(v) end;
$$;
create or replace function private.clean_address(v text) returns text
language sql immutable set search_path = '' as $$
  select case when length(regexp_replace(btrim(coalesce(v, '')), '\s+', ' ', 'g')) between 4 and 200
    then regexp_replace(btrim(v), '\s+', ' ', 'g') end;
$$;
revoke execute on function private.clean_phone(text) from public, anon, authenticated;
revoke execute on function private.clean_address(text) from public, anon, authenticated;

-- ── The characterization form → the card ──
create or replace function public.characterizations_fill_client() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  ph text := private.clean_phone(new.fields ->> 'phone');
  ad text := private.clean_address(new.fields ->> 'address');
  filled boolean := exists (select 1 from jsonb_each_text(coalesce(new.fields, '{}'::jsonb)) f where btrim(f.value) <> '');
begin
  if not filled then return new; end if;
  update public.clients c
     set phone = case when coalesce(btrim(c.phone), '') = '' and ph is not null then ph else c.phone end,
         address = case when coalesce(btrim(c.address), '') = '' and ad is not null then ad else c.address end,
         char_at = coalesce(c.char_at, now())
   where c.id = new.client_id
     and ((coalesce(btrim(c.phone), '') = '' and ph is not null)
       or (coalesce(btrim(c.address), '') = '' and ad is not null)
       or c.char_at is null);
  return new;
end $$;
revoke execute on function public.characterizations_fill_client() from public, anon, authenticated;
drop trigger if exists characterizations_zz_fill_client on public.characterizations;
create trigger characterizations_zz_fill_client after insert or update on public.characterizations
for each row execute function public.characterizations_fill_client();

-- ── A contract uploaded by hand → the card ──
create or replace function public.manual_contracts_fill_client() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  cid text := private.clean_company_id(new.company_id);
  em text := private.clean_email(new.email);
  ph text := private.clean_phone(new.phone);
  ad text := private.clean_address(new.address);
begin
  if new.client_id is null then return new; end if;
  update public.clients c
     set company_id = case when coalesce(btrim(c.company_id), '') = '' and cid is not null then cid else c.company_id end,
         contact_email = case when coalesce(btrim(c.contact_email), '') = '' and em is not null then em else c.contact_email end,
         phone = case when coalesce(btrim(c.phone), '') = '' and ph is not null then ph else c.phone end,
         address = case when coalesce(btrim(c.address), '') = '' and ad is not null then ad else c.address end
   where c.id = new.client_id
     and ((coalesce(btrim(c.company_id), '') = '' and cid is not null)
       or (coalesce(btrim(c.contact_email), '') = '' and em is not null)
       or (coalesce(btrim(c.phone), '') = '' and ph is not null)
       or (coalesce(btrim(c.address), '') = '' and ad is not null));
  return new;
end $$;
revoke execute on function public.manual_contracts_fill_client() from public, anon, authenticated;
drop trigger if exists manual_contracts_zz_fill_client on public.manual_contracts;
create trigger manual_contracts_zz_fill_client after insert or update on public.manual_contracts
for each row execute function public.manual_contracts_fill_client();

notify pgrst, 'reload schema';
