-- The signer also confirms they are authorised to bind the client.
create or replace function public.consent_text_for(p_model jsonb) returns text
language sql immutable set search_path = '' as $$
  select 'קראתי ואני מאשר/ת את '
    || case when p_model ->> 'docType' = 'agreement' then 'הסכם ההתקשרות' else 'הצעת המחיר' end
    || ' ' || coalesce(p_model ->> 'number', '')
    || ', כולל תנאי ההסכם והתמורה: ' || public.format_ils((p_model -> 'totals' ->> 'monthlyNet')::bigint)
    || ' לחודש + מע״מ (' || public.format_ils((p_model -> 'totals' ->> 'monthlyGross')::bigint)
    || ' כולל מע״מ), בהתחייבות ל־' || coalesce(p_model ->> 'termMonths', '12')
    || ' חודשים (סה״כ ' || public.format_ils((p_model -> 'totals' ->> 'termGross')::bigint)
    || ' כולל מע״מ). אני מצהיר/ה שאני מוסמך/ת לחתום על ההסכם בשם הלקוח ולחייב אותו.';
$$;
revoke all on function public.consent_text_for(jsonb) from public, anon, authenticated;
