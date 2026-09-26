-- The consent the client ticks names the quote and the exact amounts.
create or replace function public.format_ils(p_agorot bigint) returns text
language sql immutable set search_path = '' as $$
  select case when p_agorot % 100 = 0
    then to_char(p_agorot / 100, 'FM999,999,990')
    else to_char(p_agorot / 100.0, 'FM999,999,990.00') end || ' ₪';
$$;

create or replace function public.consent_text_for(p_model jsonb) returns text
language sql immutable set search_path = '' as $$
  select 'קראתי ואני מאשר/ת את הצעת המחיר '
    || coalesce(p_model ->> 'number', '')
    || ': ' || public.format_ils((p_model -> 'totals' ->> 'monthlyGross')::bigint)
    || ' לחודש כולל מע״מ, בהתחייבות ל־' || coalesce(p_model ->> 'termMonths', '12')
    || ' חודשים (סה״כ ' || public.format_ils((p_model -> 'totals' ->> 'termGross')::bigint)
    || ' כולל מע״מ).';
$$;

revoke all on function public.format_ils(bigint) from public, anon, authenticated;
revoke all on function public.consent_text_for(jsonb) from public, anon, authenticated;
