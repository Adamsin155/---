-- Hardening after the tech review:
-- staff must be a confirmed account, staff cannot sign for clients, signed rows are
-- frozen, the document hash covers number/date/terms, and each signature gets its
-- own evidence hash and stores the exact consent wording.

alter table public.quotes
  add column if not exists consent_text text,
  add column if not exists signature_hash text;

-- Staff = confirmed auth user whose email is on the allowlist.
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from auth.users u
    join public.staff s on s.email = lower(u.email)
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
  );
$$;

-- Bind number, date and terms into the hashed snapshot.
create or replace function public.quotes_set_hash() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.model := new.model
    || jsonb_build_object('number', new.number, 'createdAt', new.created_at);
  new.doc_hash := encode(extensions.digest(new.model::text, 'sha256'), 'hex');
  return new;
end $$;

create or replace function public.quotes_freeze_model() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status = 'signed' then
    raise exception 'signed quotes are immutable';
  end if;
  if new.model is distinct from old.model or new.doc_hash is distinct from old.doc_hash then
    raise exception 'quote content is immutable';
  end if;
  return new;
end $$;

create or replace function public.consent_text_for(p_model jsonb) returns text
language sql immutable set search_path = '' as $$
  select 'קראתי את הצעת המחיר ואני מאשר/ת אותה, כולל תקופת ההתחייבות ל־'
    || coalesce(p_model ->> 'termMonths', '12')
    || ' חודשים והמחירים המפורטים בה.';
$$;

create or replace function public.get_quote(p_token uuid) returns jsonb
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
    'consentText', coalesce(q.consent_text, public.consent_text_for(q.model)),
    'signerName', q.signer_name,
    'signedAt', q.signed_at,
    'signaturePng', q.signature_png,
    'signatureHash', q.signature_hash
  );
end $$;

create or replace function public.sign_quote(
  p_token uuid, p_name text, p_signature text, p_consent boolean
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  q public.quotes;
  headers json := nullif(current_setting('request.headers', true), '')::json;
  v_name text := btrim(coalesce(p_name, ''));
  v_png bytea;
  v_ip text;
  v_now timestamptz := now();
begin
  if public.is_staff() then
    raise exception 'staff cannot sign on behalf of a client' using errcode = '42501';
  end if;
  if p_consent is distinct from true then
    raise exception 'consent required' using errcode = '22023';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'invalid signer name' using errcode = '22023';
  end if;
  if p_signature is null
     or char_length(p_signature) > 200000
     or p_signature !~ '^data:image/png;base64,[A-Za-z0-9+/]+={0,2}$' then
    raise exception 'invalid signature' using errcode = '22023';
  end if;
  v_png := decode(substr(p_signature, 23), 'base64');
  if substr(v_png, 1, 8) <> '\x89504e470d0a1a0a'::bytea then
    raise exception 'invalid signature' using errcode = '22023';
  end if;

  select * into q from public.quotes where token = p_token for update;
  if not found or q.status = 'cancelled' then
    raise exception 'quote not found' using errcode = 'P0002';
  end if;
  if q.status = 'signed' then
    raise exception 'quote already signed' using errcode = '23505';
  end if;

  v_ip := coalesce(
    nullif(headers ->> 'cf-connecting-ip', ''),
    nullif(headers ->> 'x-real-ip', ''),
    nullif(btrim(reverse(split_part(reverse(coalesce(headers ->> 'x-forwarded-for', '')), ',', 1))), '')
  );

  update public.quotes set
    status = 'signed',
    signer_name = v_name,
    signature_png = p_signature,
    signed_at = v_now,
    consent_text = public.consent_text_for(q.model),
    signer_ip = left(v_ip, 64),
    signer_user_agent = left(coalesce(headers ->> 'user-agent', ''), 400),
    signature_hash = encode(extensions.digest(
      q.doc_hash || '|' || v_name || '|' || to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      || '|' || public.consent_text_for(q.model) || '|' || p_signature, 'sha256'), 'hex')
  where id = q.id;

  return public.get_quote(p_token);
end $$;

revoke all on function public.consent_text_for(jsonb) from public, anon, authenticated;

revoke all on public.quotes from authenticated;
revoke all on public.staff from authenticated;
grant select on public.quotes to authenticated;
grant select on public.staff to authenticated;
