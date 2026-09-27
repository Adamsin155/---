-- Validity window: a quote is valid for 48 hours, an agreement can be signed
-- within 72 hours (model.validHours, set by the pricing engine). The deadline is
-- bound into the hashed snapshot. Rows created before this migration keep no deadline.
-- The consent wording now names the client and its company ID.

alter table public.quotes add column if not exists expires_at timestamptz;

create or replace function public.quotes_set_hash() returns trigger
language plpgsql set search_path = '' as $$
declare v_hours int := nullif(new.model ->> 'validHours', '')::int;
begin
  if v_hours is not null then
    new.expires_at := new.created_at + make_interval(hours => v_hours);
  end if;
  new.model := new.model
    || jsonb_build_object('number', new.number, 'createdAt', new.created_at)
    || case when new.expires_at is null then '{}'::jsonb
            else jsonb_build_object('validUntil', new.expires_at) end;
  new.doc_hash := encode(extensions.digest(new.model::text, 'sha256'), 'hex');
  return new;
end $$;

create or replace function public.quotes_freeze_model() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status = 'signed' then
    raise exception 'signed quotes are immutable';
  end if;
  if new.model is distinct from old.model or new.doc_hash is distinct from old.doc_hash
     or new.expires_at is distinct from old.expires_at then
    raise exception 'quote content is immutable';
  end if;
  if new.status = 'signed' then
    new.first_viewed_at := coalesce(old.first_viewed_at, new.signed_at);
  end if;
  return new;
end $$;

create or replace function public.consent_text_for(p_model jsonb) returns text
language sql immutable set search_path = '' as $$
  select 'קראתי ואני מאשר/ת את '
    || case when p_model ->> 'docType' = 'agreement' then 'הסכם ההתקשרות' else 'הצעת המחיר' end
    || ' ' || coalesce(p_model ->> 'number', '')
    || ', כולל תנאי ההסכם והתמורה: ' || public.format_ils((p_model -> 'totals' ->> 'monthlyNet')::bigint)
    || ' לחודש + מע״מ (' || public.format_ils((p_model -> 'totals' ->> 'monthlyGross')::bigint)
    || ' כולל מע״מ), בהתחייבות ל־' || coalesce(p_model ->> 'termMonths', '12')
    || ' חודשים (סה״כ ' || public.format_ils((p_model -> 'totals' ->> 'termGross')::bigint)
    || ' כולל מע״מ). אני מצהיר/ה שאני מוסמך/ת לחתום על ההסכם בשם '
    || coalesce(nullif(p_model -> 'client' ->> 'company', ''), nullif(p_model -> 'client' ->> 'name', ''), 'הלקוח')
    || coalesce(', ח.פ ' || nullif(p_model -> 'client' ->> 'companyId', ''), '')
    || ' ולחייב אותו.';
$$;
revoke all on function public.consent_text_for(jsonb) from public, anon, authenticated;

create or replace function public.get_quote(p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q public.quotes;
begin
  select * into q from public.quotes where token = p_token;
  if not found or q.status = 'cancelled' then
    return null;
  end if;
  if q.status = 'sent' and q.first_viewed_at is null and not public.is_staff() then
    update public.quotes set first_viewed_at = now() where id = q.id;
  end if;
  return jsonb_build_object(
    'number', q.number,
    'createdAt', q.created_at,
    'expiresAt', q.expires_at,
    'expired', q.status <> 'signed' and q.expires_at is not null and now() > q.expires_at,
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

  select * into q from public.quotes where token = p_token for update;
  if not found or q.status = 'cancelled' then
    raise exception 'quote not found' using errcode = 'P0002';
  end if;
  if q.status = 'signed' then
    raise exception 'quote already signed' using errcode = '23505';
  end if;
  if q.expires_at is not null and v_now > q.expires_at then
    raise exception 'quote expired' using errcode = '22023';
  end if;

  v_png := decode(substr(p_signature, 23), 'base64');
  if substr(v_png, 1, 8) <> '\x89504e470d0a1a0a'::bytea then
    raise exception 'invalid signature' using errcode = '22023';
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
