-- Quotes, client signing and staff access for the Astrateg quote builder.
-- Prices are computed by the create-quote edge function from app/pricing.js;
-- the database stores the resulting model as an immutable snapshot.

create extension if not exists pgcrypto with schema extensions;

create table public.staff (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

create sequence public.quote_number_seq;

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  token uuid not null unique default gen_random_uuid(),
  number text not null unique default (
    'AST-' || to_char(now() at time zone 'Asia/Jerusalem', 'YYYY') || '-' ||
    lpad(nextval('public.quote_number_seq')::text, 4, '0')
  ),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_by_email text,
  model jsonb not null,
  doc_hash text not null default '',
  client_name text not null,
  monthly_gross_agorot integer not null,
  term_gross_agorot integer not null,
  status text not null default 'sent' check (status in ('sent', 'signed', 'cancelled')),
  first_viewed_at timestamptz,
  signer_name text,
  signature_png text,
  signed_at timestamptz,
  signer_ip text,
  signer_user_agent text
);

create index quotes_created_at_idx on public.quotes (created_at desc);
create index quotes_created_by_idx on public.quotes (created_by);

-- The hash identifies exactly which document was signed.
create function public.quotes_set_hash() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.doc_hash := encode(extensions.digest(new.model::text, 'sha256'), 'hex');
  return new;
end $$;

create trigger quotes_set_hash before insert on public.quotes
for each row execute function public.quotes_set_hash();

-- Snapshots never change after creation.
create function public.quotes_freeze_model() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.model is distinct from old.model or new.doc_hash is distinct from old.doc_hash then
    raise exception 'quote content is immutable';
  end if;
  return new;
end $$;

create trigger quotes_freeze_model before update on public.quotes
for each row execute function public.quotes_freeze_model();

create function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff s
    where s.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

alter table public.staff enable row level security;
alter table public.quotes enable row level security;

create policy "staff can see own row" on public.staff
  for select to authenticated
  using (email = lower(coalesce(auth.jwt() ->> 'email', '')));

create policy "staff read quotes" on public.quotes
  for select to authenticated
  using (public.is_staff());

-- Public read of a single quote by its unguessable token.
create function public.get_quote(p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q public.quotes;
begin
  select * into q from public.quotes where token = p_token;
  if not found or q.status = 'cancelled' then
    return null;
  end if;
  if q.first_viewed_at is null and not public.is_staff() then
    update public.quotes set first_viewed_at = now() where id = q.id;
  end if;
  return jsonb_build_object(
    'number', q.number,
    'createdAt', q.created_at,
    'model', q.model,
    'docHash', q.doc_hash,
    'status', q.status,
    'signerName', q.signer_name,
    'signedAt', q.signed_at,
    'signaturePng', q.signature_png
  );
end $$;

create function public.sign_quote(
  p_token uuid, p_name text, p_signature text, p_consent boolean
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  q public.quotes;
  headers json := nullif(current_setting('request.headers', true), '')::json;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if p_consent is distinct from true then
    raise exception 'consent required' using errcode = '22023';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'invalid signer name' using errcode = '22023';
  end if;
  if p_signature is null
     or left(p_signature, 22) <> 'data:image/png;base64,'
     or char_length(p_signature) > 400000 then
    raise exception 'invalid signature' using errcode = '22023';
  end if;

  select * into q from public.quotes where token = p_token for update;
  if not found or q.status = 'cancelled' then
    raise exception 'quote not found' using errcode = 'P0002';
  end if;
  if q.status = 'signed' then
    raise exception 'quote already signed' using errcode = '23505';
  end if;

  update public.quotes set
    status = 'signed',
    signer_name = v_name,
    signature_png = p_signature,
    signed_at = now(),
    signer_ip = left(split_part(coalesce(headers ->> 'x-forwarded-for', ''), ',', 1), 64),
    signer_user_agent = left(coalesce(headers ->> 'user-agent', ''), 400)
  where id = q.id;

  return public.get_quote(p_token);
end $$;

create function public.cancel_quote(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_staff() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.quotes set status = 'cancelled' where id = p_id and status = 'sent';
  if not found then
    raise exception 'only unsigned quotes can be cancelled' using errcode = '22023';
  end if;
end $$;

revoke all on function public.get_quote(uuid) from public, anon, authenticated;
revoke all on function public.sign_quote(uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.cancel_quote(uuid) from public, anon, authenticated;
revoke all on function public.is_staff() from public, anon, authenticated;
revoke all on function public.quotes_set_hash() from public, anon, authenticated;
revoke all on function public.quotes_freeze_model() from public, anon, authenticated;
grant execute on function public.get_quote(uuid) to anon, authenticated;
grant execute on function public.sign_quote(uuid, text, text, boolean) to anon, authenticated;
grant execute on function public.cancel_quote(uuid) to authenticated;
grant execute on function public.is_staff() to authenticated;

revoke all on public.quotes from anon;
revoke all on public.staff from anon;
revoke insert, update, delete on public.quotes from authenticated;
revoke insert, update, delete on public.staff from authenticated;
