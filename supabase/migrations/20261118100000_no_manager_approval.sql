-- No manager's approval for any contract (the owner, 29.10.2026: "להוריד את חוזה חריג באישור מנהל";
-- docs/ops.md, section 79). Until now a quote whose selection differs from the built-in rules
-- (20261010100000_custom_contracts.sql) waited as approval 'pending' for the owner, Ofir or Lior.
--   1. A new quote is always approval 'none': its link works at once, like a regular one. What
--      differs from the package (exceptions, from app/pricing.js exceptionOf) is still stored with
--      it, for the owners to see, as information only. "הוכן ע״י AI" (prepared_by) is unchanged.
--   2. A quote that was still 'pending' is left exactly as it is (no row is changed), and can now
--      be sent: its link opens and it can be signed. Only 'rejected' (a manager said no before this
--      date) still has no link. A corrected version (quote_revise) is a regular quote from now on.
--   3. A contract "בלי משפיענים" (selection.custom.noInfluencer, the free contract of "הכנת חוזה עם
--      AI") opens its client with no influencers' shoot type.
--   4. The field's free deal (deal.html, 29.10.2026): Stav writes what he closed in his own words
--      (deal_requests.custom = { text }), and chooses what Irit prepares: deal_requests.doc_type
--      'agreement' (חוזה) or 'quote' (הצעת מחיר). The old shape of "הצעה אחרת" stays valid.
-- The approval functions, columns and history stay (nothing is taken away); nothing calls
-- quote_approve or quote_reject any more. Only adds and replaces; every statement can run again
-- safely. Tested in tests/sql/no-approval.test.mjs.

-- ── 1. Creating a quote: never pending ───────
-- As 20261106100000_contract_ai.sql, without the pending branch.
create or replace function public.quotes_set_hash() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_hours int := nullif(new.model ->> 'validHours', '')::int;
  v_ai boolean := false;
begin
  new.version := 1;
  new.approval_by_email := null;
  new.approval_by := null;
  new.approval_at := null;
  new.approval_note := null;
  new.submitted_by_email := lower(nullif(new.created_by_email, ''));
  -- Prepared with "הכנת חוזה עם AI": a successful run of the creator's own, from the last 24 hours.
  if new.prepared_by = 'ai' and new.ai_run_id is not null and new.created_by is not null then
    v_ai := exists (
      select 1 from public.contract_ai_runs r
      where r.id = new.ai_run_id and r.user_id = new.created_by and r.status = 'ok'
        and r.created_at > now() - interval '24 hours');
  end if;
  if not v_ai then
    new.prepared_by := null;
    new.ai_run_id := null;
  end if;
  new.approval := 'none';
  new.submitted_at := null;
  -- What differs from the package stays with the quote, for the owners to see.
  if not private.quote_is_exceptional(new.model) then
    new.exceptions := null;
  end if;
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
revoke execute on function public.quotes_set_hash() from public, anon, authenticated;

-- ── 2. A quote that waited: it can be sent and signed ──
-- As 20261106100000_contract_ai.sql; only a rejected contract can never be signed.
create or replace function public.quotes_freeze_model() returns trigger
language plpgsql set search_path = '' as $$
declare flow boolean := coalesce(current_setting('astrateg.quote_flow', true), '') = 'on';
begin
  if old.status = 'signed' then
    raise exception 'signed quotes are immutable';
  end if;
  if new.prepared_by is distinct from old.prepared_by or new.ai_run_id is distinct from old.ai_run_id then
    raise exception 'who prepared a quote is fixed at its creation';
  end if;
  if not flow then
    if new.model is distinct from old.model or new.doc_hash is distinct from old.doc_hash
       or new.expires_at is distinct from old.expires_at then
      raise exception 'quote content is immutable';
    end if;
    if new.approval is distinct from old.approval or new.approval_by_email is distinct from old.approval_by_email
       or new.approval_by is distinct from old.approval_by or new.approval_at is distinct from old.approval_at
       or new.approval_note is distinct from old.approval_note or new.exceptions is distinct from old.exceptions
       or new.version is distinct from old.version or new.submitted_at is distinct from old.submitted_at
       or new.submitted_by_email is distinct from old.submitted_by_email then
      raise exception 'the approval of a quote changes only through its functions';
    end if;
  end if;
  -- Only a contract a manager turned down before 29.10.2026 can never be signed.
  if new.status = 'signed' and new.approval = 'rejected' then
    raise exception 'this contract was not approved' using errcode = '42501';
  end if;
  if new.status = 'signed' then
    new.first_viewed_at := coalesce(old.first_viewed_at, new.signed_at);
  end if;
  return new;
end $$;
revoke all on function public.quotes_freeze_model() from public, anon, authenticated;

-- The client's link: as 20261010100000_custom_contracts.sql, answering "nothing" only for a
-- contract a manager turned down.
create or replace function public.get_quote(p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q public.quotes;
begin
  select * into q from public.quotes where token = p_token;
  if not found or q.status = 'cancelled' or q.approval = 'rejected' then
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

-- As 20260930170000_client_status.sql, with the same refusal.
create or replace function public.sign_quote(
  p_token uuid, p_name text, p_signature text, p_consent boolean, p_whatsapp boolean default false
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
  -- Not approved by a manager before 29.10.2026: to the client it does not exist.
  if not found or q.status = 'cancelled' or q.approval = 'rejected' then
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

  insert into public.client_consents (quote_id, kind, given, wording, version, phone, ip, user_agent, at)
  values (q.id, 'whatsapp', coalesce(p_whatsapp, false), private.whatsapp_consent_text(), 'whatsapp-v1-2026-09-30',
    nullif(left(btrim(coalesce(q.model -> 'client' ->> 'phone', '')), 40), ''), left(v_ip, 64),
    left(coalesce(headers ->> 'user-agent', ''), 400), v_now)
  on conflict (quote_id, kind) do nothing;

  return public.get_quote(p_token);
end $$;
revoke all on function public.get_quote(uuid) from public;
revoke all on function public.sign_quote(uuid, text, text, boolean, boolean) from public;
grant execute on function public.get_quote(uuid) to anon, authenticated;
grant execute on function public.sign_quote(uuid, text, text, boolean, boolean) to anon, authenticated;

-- A corrected version (index.html?revise=…, for a quote that waited or was turned down): as
-- 20261010100000_custom_contracts.sql, and now always a regular quote, valid from now, with what
-- differs from the package kept for the owners.
create or replace function public.quote_revise(
  p_id uuid, p_model jsonb, p_client_name text, p_monthly_gross integer, p_term_gross integer,
  p_exceptions jsonb, p_by_email text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  q public.quotes;
  v_exc boolean := private.quote_is_exceptional(p_model);
  v_hours int := nullif(p_model ->> 'validHours', '')::int;
  v_now timestamptz := now();
  v_expires timestamptz;
begin
  select * into q from public.quotes where id = p_id for update;
  if not found or q.status <> 'sent' then
    raise exception 'quote not found' using errcode = 'P0002';
  end if;
  if q.approval = 'none' then
    raise exception 'only a contract that went for approval can be revised' using errcode = '22023';
  end if;
  v_expires := case when v_hours is null then null else v_now + make_interval(hours => v_hours) end;
  perform set_config('astrateg.quote_flow', 'on', true);
  update public.quotes set
    model = (p_model - 'validUntil')
      || jsonb_build_object('number', q.number, 'createdAt', q.created_at)
      || case when v_expires is null then '{}'::jsonb else jsonb_build_object('validUntil', v_expires) end,
    client_name = p_client_name,
    monthly_gross_agorot = p_monthly_gross,
    term_gross_agorot = p_term_gross,
    exceptions = case when v_exc then p_exceptions end,
    approval = 'none',
    approval_by_email = null, approval_by = null, approval_at = null, approval_note = null,
    version = q.version + 1,
    submitted_at = null,
    submitted_by_email = lower(nullif(p_by_email, '')),
    first_viewed_at = null,
    expires_at = v_expires
  where id = q.id;
  update public.quotes set doc_hash = encode(extensions.digest(model::text, 'sha256'), 'hex') where id = q.id
  returning * into q;
  perform set_config('astrateg.quote_flow', '', true);
  perform private.quote_log(q, 'revised', lower(nullif(p_by_email, '')), null, null);
  return jsonb_build_object('id', q.id, 'number', q.number, 'created_at', q.created_at, 'approval', q.approval,
    'version', q.version, 'token', q.token);
end $$;
revoke all on function public.quote_revise(uuid, jsonb, text, integer, integer, jsonb, text) from public, anon, authenticated;
grant execute on function public.quote_revise(uuid, jsonb, text, integer, integer, jsonb, text) to service_role;

-- ── 3. The client a signed agreement opens ───
-- As 20261112100000_new_influencers.sql, and a contract "בלי משפיענים" has no influencers' shoot type.
create or replace function public.open_client_on_signing() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  m jsonb;
  cid uuid;
  months int;
  signed timestamptz;
  v_type text;
begin
  if new.status is distinct from 'signed' or old.status = 'signed' then
    return new;
  end if;
  -- Everything that reads the agreement runs inside the protected block, so a
  -- surprising value can never undo the signature.
  begin
    m := new.model;
    -- Agreements are signable; older ones saved before the flag existed are too.
    if coalesce((m ->> 'signable')::boolean, true) is not true then
      return new;
    end if;
    if exists (select 1 from public.clients where quote_id = new.id) then
      return new;
    end if;
    months := coalesce(round((m ->> 'termMonths')::numeric)::int, 12);
    signed := coalesce(new.signed_at, now());
    v_type := case m -> 'selection' ->> 'influencer' when 'natali' then 'natali' when 'simeon' then 'dms'
      when 'niro' then 'niro' when 'hatzel' then 'hatzel' end;
    -- A contract "בלי משפיענים" (29.10.2026): no influencers' shoot day; the office sets the crew.
    if coalesce((m -> 'selection' -> 'custom' ->> 'noInfluencer')::boolean, false) then
      v_type := null;
    end if;
    -- Until the check of clients.shoot_type takes Niro and "הצל" (the pending file), their client
    -- still opens, with no shoot type yet (the office sets it in the card).
    if v_type in ('niro', 'hatzel') and not exists (select 1 from pg_constraint
        where conname = 'clients_shoot_type_check' and conrelid = 'public.clients'::regclass
          and pg_get_constraintdef(oid) like '%' || v_type || '%') then
      v_type := null;
    end if;
    insert into public.clients (name, business, phone, package_name, shoot_type, deal_at, contract_end, quote_id, deliverables)
    values (
      coalesce(nullif(btrim(m -> 'client' ->> 'name'), ''), new.client_name),
      nullif(btrim(m -> 'client' ->> 'company'), ''),
      nullif(btrim(m -> 'client' ->> 'phone'), ''),
      concat_ws(' · ', m -> 'package' ->> 'tierName', m -> 'package' ->> 'influencer'),
      v_type,
      signed,
      ((signed at time zone 'Asia/Jerusalem')::date + make_interval(months => months))::date,
      new.id,
      public.package_deliverables(m)
    )
    returning id into cid;
    insert into public.protocol_checks (client_id, item_key, state, note)
    select cid, k, 'done', 'נחתם במערכת: ' || new.number
    from unnest(array['p01.prepared', 'p01.sent', 'p01.signed']) as k;
  exception when others then
    raise warning 'open_client_on_signing failed for quote %: %', new.number, sqlerrm;
  end;
  return new;
end $$;

-- ── 4. The field's free deal ─────────────────
-- What Irit prepares from the deal: 'agreement' (חוזה) or 'quote' (הצעת מחיר); null on the
-- deals sent before (an agreement, as always).
alter table public.deal_requests add column if not exists doc_type text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'deal_requests_doc_type_check' and conrelid = 'public.deal_requests'::regclass) then
    alter table public.deal_requests add constraint deal_requests_doc_type_check check (doc_type is null or doc_type in ('agreement', 'quote'));
  end if;
end $$;

-- "הצעה אחרת": as 20261010100000_custom_contracts.sql, or (since 29.10.2026) the seller's own
-- words only: { text } of 1 to 2000 characters, nothing else required.
create or replace function private.deal_custom_ok(c jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select c is null or coalesce(
    jsonb_typeof(c) = 'object' and (
      (
        (c - array['text']) = '{}'::jsonb
        and jsonb_typeof(c -> 'text') = 'string'
        and length(btrim(c ->> 'text')) between 1 and 2000
      ) or (
        (c - array['description', 'videos', 'graphics', 'shoot_days', 'price_agorot', 'term_months']) = '{}'::jsonb
        and jsonb_typeof(c -> 'description') = 'string'
        and length(btrim(c ->> 'description')) between 1 and 2000
        and private.json_int_between(c -> 'videos', 0, 200)
        and private.json_int_between(c -> 'graphics', 0, 300)
        and private.json_int_between(c -> 'shoot_days', 0, 12)
        and jsonb_typeof(c -> 'price_agorot') = 'number' and private.json_int_between(c -> 'price_agorot', 100, 10000000)
        and jsonb_typeof(c -> 'term_months') = 'number' and private.json_int_between(c -> 'term_months', 1, 36)
      )
    ),
    false);
$$;
revoke all on function private.deal_custom_ok(jsonb) from public, anon;
grant execute on function private.deal_custom_ok(jsonb) to authenticated;
