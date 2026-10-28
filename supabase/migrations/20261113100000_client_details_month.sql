-- The owner's requests of 28.10.2026 for the client's details, the database's part
-- (docs/ops.md, section 71).
--
-- The client's email ("אימייל") and company number ("ח.פ", or an ID number, "ת.ז"), filled
-- by the office in "עריכת פרטים" (app/client-card.js, app/client-contact.js):
--   public.clients.contact_email  lower case, loosely an address (one @, a dot after it);
--   public.clients.company_id     exactly 9 digits (the screen takes away spaces and
--                                 dashes, and gives an 8-digit ID number its leading zero).
-- (Not "email": many functions name their own variables and columns email, and a column of
-- that name on clients would make their queries ambiguous.)
-- Both are the office's, like the client's phone (20260930210000_hardening.sql): no
-- "grant select" for them, so an editor, Eli, Nirel or a field agent cannot read them
-- however they ask; the office reads them through public.clients_contact() (beside
-- public.clients_private(), which stays as it is), and writes them as every other column
-- ("office edits clients").
--
-- A client opened from a signed agreement already has both in it (the quote builder asks
-- for them: model.client.email, model.client.companyId). They are copied once here for
-- the clients there are, and for a new client when it is opened from an agreement (a
-- trigger), only when well formed and only into an empty field.
--
-- "יום צילום חודשי" (the switch next to "סרטונים בחודש") needs nothing here: it is the key
-- shoot_monthly of clients.deliverables, a free jsonb object (as videos_month is).
--
-- The file only adds, and can run again safely (tests/sql/client-details-month.test.mjs).

alter table public.clients add column if not exists contact_email text;
alter table public.clients add column if not exists company_id text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clients_contact_email_check' and conrelid = 'public.clients'::regclass) then
    alter table public.clients add constraint clients_contact_email_check
      check (contact_email is null or (length(contact_email) <= 254 and contact_email = lower(contact_email) and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'clients_company_id_check' and conrelid = 'public.clients'::regclass) then
    alter table public.clients add constraint clients_company_id_check check (company_id is null or company_id ~ '^[0-9]{9}$');
  end if;
end $$;
-- Never readable through the API by a signed-in user (the office reads them below).
revoke select (contact_email, company_id) on public.clients from anon, authenticated;

-- What an agreement says, as the columns keep it (null when not well formed).
create or replace function private.clean_email(v text) returns text
language sql immutable set search_path = '' as $$
  select case when length(btrim(v)) <= 254 and btrim(v) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then lower(btrim(v)) end;
$$;
create or replace function private.clean_company_id(v text) returns text
language sql immutable set search_path = '' as $$
  select case when regexp_replace(coalesce(v, ''), '[[:space:].-]', '', 'g') ~ '^[0-9]{8,9}$'
    then lpad(regexp_replace(v, '[[:space:].-]', '', 'g'), 9, '0') end;
$$;
revoke execute on function private.clean_email(text) from public, anon, authenticated;
revoke execute on function private.clean_company_id(text) from public, anon, authenticated;

-- ── The office reads them ──
-- As public.clients_private() (20261003140000_manager_features.sql): the office only, not an
-- archived client; all clients when p_ids is null. A function of its own, so that
-- clients_private() and the migrations that define it stay exactly as they are.
create or replace function public.clients_contact(p_ids uuid[] default null)
returns table (id uuid, contact_email text, company_id text)
language sql stable security definer set search_path = '' as $$
  select c.id, c.contact_email, c.company_id
  from public.clients c
  where (select public.is_office()) and c.archived_at is null and (p_ids is null or c.id = any (p_ids));
$$;
revoke execute on function public.clients_contact(uuid[]) from public, anon;
grant execute on function public.clients_contact(uuid[]) to authenticated;

-- ── From the signed agreement ──
-- The clients there are: once, only into an empty field.
update public.clients c set
  contact_email = coalesce(c.contact_email, private.clean_email(q.model -> 'client' ->> 'email')),
  company_id = coalesce(c.company_id, private.clean_company_id(q.model -> 'client' ->> 'companyId'))
from public.quotes q
where q.id = c.quote_id
  and ((c.contact_email is null and private.clean_email(q.model -> 'client' ->> 'email') is not null)
    or (c.company_id is null and private.clean_company_id(q.model -> 'client' ->> 'companyId') is not null));

-- A new client opened from an agreement (the signing trigger, or "לקוח חדש" from a signed
-- agreement): the same, as it is added. The name sorts after clients_columns_guard.
create or replace function public.clients_contact_from_quote() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  m jsonb;
begin
  if new.quote_id is not null and (new.contact_email is null or new.company_id is null) then
    select q.model -> 'client' into m from public.quotes q where q.id = new.quote_id;
    if m is not null then
      new.contact_email := coalesce(new.contact_email, private.clean_email(m ->> 'email'));
      new.company_id := coalesce(new.company_id, private.clean_company_id(m ->> 'companyId'));
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.clients_contact_from_quote() from public, anon, authenticated;
create or replace trigger clients_contact_from_quote before insert on public.clients
for each row execute function public.clients_contact_from_quote();
