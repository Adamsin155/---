-- Two document types: a quote (view only) and an engagement agreement (signed).
-- The type lives in the immutable model (model.docType / model.signable).

create or replace function public.consent_text_for(p_model jsonb) returns text
language sql immutable set search_path = '' as $$
  select 'קראתי ואני מאשר/ת את '
    || case when p_model ->> 'docType' = 'agreement' then 'הסכם ההתקשרות' else 'הצעת המחיר' end
    || ' ' || coalesce(p_model ->> 'number', '')
    || ', כולל תנאי ההסכם והתמורה: ' || public.format_ils((p_model -> 'totals' ->> 'monthlyNet')::bigint)
    || ' לחודש + מע״מ (' || public.format_ils((p_model -> 'totals' ->> 'monthlyGross')::bigint)
    || ' כולל מע״מ), בהתחייבות ל־' || coalesce(p_model ->> 'termMonths', '12')
    || ' חודשים (סה״כ ' || public.format_ils((p_model -> 'totals' ->> 'termGross')::bigint)
    || ' כולל מע״מ).';
$$;
revoke all on function public.consent_text_for(jsonb) from public, anon, authenticated;

-- Quotes marked as not signable cannot be signed.
create or replace function public.quotes_block_unsignable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'signed' and old.status <> 'signed'
     and coalesce(new.model ->> 'signable', 'true') = 'false' then
    raise exception 'this document does not require a signature' using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function public.quotes_block_unsignable() from public, anon, authenticated;

drop trigger if exists quotes_block_unsignable on public.quotes;
create trigger quotes_block_unsignable before update on public.quotes
for each row execute function public.quotes_block_unsignable();
