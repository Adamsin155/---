-- get_quote must not write to a signed (frozen) quote; signing records the view.
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

create or replace function public.quotes_freeze_model() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status = 'signed' then
    raise exception 'signed quotes are immutable';
  end if;
  if new.model is distinct from old.model or new.doc_hash is distinct from old.doc_hash then
    raise exception 'quote content is immutable';
  end if;
  if new.status = 'signed' then
    new.first_viewed_at := coalesce(old.first_viewed_at, new.signed_at);
  end if;
  return new;
end $$;
