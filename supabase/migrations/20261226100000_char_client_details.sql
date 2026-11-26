-- "פרטי הלקוח" in the characterization form (Irit and the owner, 26.11.2026; docs/ops.md, section 155):
-- Ofir fills in the meeting the contact's name, the business, the business's name for the invoice,
-- the company id, the contact's phone and the email (none required; app/characterization.js
-- CLIENT_FIELDS). When the form is saved, the client's card gets what it is MISSING:
--   clients.invoice_name   new: "שם לחשבונית" (the office reads and writes it, as the address)
--   clients.business       when empty
--   clients.company_id     when empty (private.clean_company_id)
--   clients.contact_email  when empty (private.clean_email)
--   clients.phone          when empty: the contact's phone, else the business phone (as 25.11)
--   clients.address, char_at as in 20261225100000_autofill_client.sql.
-- A field already filled is never overwritten. Nothing is dropped or deleted; runs again safely.

alter table public.clients add column if not exists invoice_name text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clients_invoice_name_check') then
    alter table public.clients add constraint clients_invoice_name_check check (invoice_name is null or char_length(invoice_name) <= 200);
  end if;
end $$;
grant select (invoice_name), insert (invoice_name), update (invoice_name) on table public.clients to authenticated;

create or replace function private.clean_text(v text, n integer) returns text
language sql immutable set search_path = '' as $$
  select nullif(left(regexp_replace(btrim(coalesce(v, '')), '\s+', ' ', 'g'), n), '');
$$;
revoke execute on function private.clean_text(text, integer) from public, anon, authenticated;

create or replace function public.characterizations_fill_client() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  ph text := coalesce(private.clean_phone(new.fields ->> 'contact_phone'), private.clean_phone(new.fields ->> 'phone'));
  ad text := private.clean_address(new.fields ->> 'address');
  bz text := private.clean_text(new.fields ->> 'business_name', 120);
  inv text := private.clean_text(new.fields ->> 'invoice_name', 200);
  cid text := private.clean_company_id(new.fields ->> 'company_id');
  em text := private.clean_email(new.fields ->> 'email');
  filled boolean := exists (select 1 from jsonb_each_text(coalesce(new.fields, '{}'::jsonb)) f where btrim(f.value) <> '');
begin
  if not filled then return new; end if;
  update public.clients c
     set phone = case when coalesce(btrim(c.phone), '') = '' and ph is not null then ph else c.phone end,
         address = case when coalesce(btrim(c.address), '') = '' and ad is not null then ad else c.address end,
         business = case when coalesce(btrim(c.business), '') = '' and bz is not null then bz else c.business end,
         invoice_name = case when coalesce(btrim(c.invoice_name), '') = '' and inv is not null then inv else c.invoice_name end,
         company_id = case when coalesce(btrim(c.company_id), '') = '' and cid is not null then cid else c.company_id end,
         contact_email = case when coalesce(btrim(c.contact_email), '') = '' and em is not null then em else c.contact_email end,
         char_at = coalesce(c.char_at, now())
   where c.id = new.client_id
     and ((coalesce(btrim(c.phone), '') = '' and ph is not null)
       or (coalesce(btrim(c.address), '') = '' and ad is not null)
       or (coalesce(btrim(c.business), '') = '' and bz is not null)
       or (coalesce(btrim(c.invoice_name), '') = '' and inv is not null)
       or (coalesce(btrim(c.company_id), '') = '' and cid is not null)
       or (coalesce(btrim(c.contact_email), '') = '' and em is not null)
       or c.char_at is null);
  return new;
end $$;
revoke execute on function public.characterizations_fill_client() from public, anon, authenticated;

notify pgrst, 'reload schema';
