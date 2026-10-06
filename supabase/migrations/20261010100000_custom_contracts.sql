-- Custom (exceptional) contracts with a manager's approval (the owner's decisions of
-- 6.10.2026; docs/ops.md, section 28).
--   1. A quote whose selection carries `custom` (anything that differs from the
--      built-in rules: quantities, price, a discount above 200 ₪, the term, added
--      lines, special terms; app/pricing.js exceptionOf) is stored as approval
--      'pending'. The database decides that itself from the stored model, whatever the
--      caller sends. A regular quote is 'none' and behaves exactly as before.
--   2. While pending or rejected, the client's link does not exist: get_quote returns
--      nothing and sign_quote answers "not found", for everyone. The signing window
--      (72 hours for an agreement) starts at the approval, not at the creation.
--   3. public.quote_approve(id) / public.quote_reject(id, note): the owner (staff.person
--      is null), Ofir or Lior; one decision is enough. Ofir and Lior may not approve a
--      contract they prepared themselves; the owner may. A rejection needs a note.
--   4. public.quote_revise(...): the create-quote function (service role) stores a
--      corrected version of the same quote: back to 'pending' (also after an approval),
--      or 'none' when nothing exceptional is left. public.quote_versions keeps every
--      version and every decision.
--   5. What a signed agreement grants follows the customised quantities
--      (public.package_deliverables, as packageDeliverables() in app/protocol-logic.js;
--      the added lines are kept for display under `extra`).
--   6. Stav's and Amos's deals: "הצעה אחרת" (deal_requests.custom), and the statuses
--      'approval' (ממתין לאישור מנהל) and 'rejected' (לא אושר), which follow the linked
--      quote's approval.
-- Every statement can run again safely. Tested in tests/sql/custom-contracts.test.mjs.

-- ── 1. The approval state of a quote ─────────
alter table public.quotes
  add column if not exists approval text not null default 'none',
  add column if not exists approval_by_email text,
  add column if not exists approval_by text,          -- 'owner', 'ofir' or 'lior'
  add column if not exists approval_at timestamptz,
  add column if not exists approval_note text,
  add column if not exists exceptions jsonb,           -- [{ kind, text, … }] from exceptionOf, for the screens
  add column if not exists version integer not null default 1,
  add column if not exists submitted_at timestamptz,   -- when this version was sent for approval
  add column if not exists submitted_by_email text;    -- who prepared this version
alter table public.quotes drop constraint if exists quotes_approval_check;
alter table public.quotes add constraint quotes_approval_check
  check (approval in ('none', 'pending', 'approved', 'rejected'));
alter table public.quotes drop constraint if exists quotes_approval_note_check;
alter table public.quotes add constraint quotes_approval_note_check
  check (approval_note is null or length(approval_note) <= 1000);
alter table public.quotes drop constraint if exists quotes_exceptions_check;
alter table public.quotes add constraint quotes_exceptions_check
  check (exceptions is null or jsonb_typeof(exceptions) = 'array');
create index if not exists quotes_approval_idx on public.quotes (approval, submitted_at) where approval <> 'none';

-- A model is exceptional when its selection carries `custom`: the pricing engine drops
-- `custom` whenever nothing differs from the built-in rules (normalizeSelection).
create or replace function private.quote_is_exceptional(p_model jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_typeof(p_model -> 'selection' -> 'custom') = 'object', false);
$$;
revoke all on function private.quote_is_exceptional(jsonb) from public, anon, authenticated;

-- Who decides on an exceptional contract: the owner (no person), Ofir and Lior.
create or replace function public.can_approve_quotes() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff() and exists (
    select 1 from public.staff s
    where s.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (s.person is null or s.person in ('ofir', 'lior'))
  );
$$;
revoke execute on function public.can_approve_quotes() from public, anon;
grant execute on function public.can_approve_quotes() to authenticated;

-- ── The history: every version and every decision ──
create table if not exists public.quote_versions (
  id bigint generated always as identity primary key,
  quote_id uuid not null references public.quotes (id) on delete cascade,
  version integer not null,
  event text not null check (event in ('submitted', 'revised', 'approved', 'rejected')),
  at timestamptz not null default now(),
  by_email text,
  by_person text,
  note text check (note is null or length(note) <= 1000),
  approval text not null,
  exceptions jsonb,
  model jsonb not null,
  doc_hash text not null
);
create index if not exists quote_versions_quote_idx on public.quote_versions (quote_id, id);
alter table public.quote_versions enable row level security;
drop policy if exists "office reads quote versions" on public.quote_versions;
create policy "office reads quote versions" on public.quote_versions
  for select to authenticated using ((select public.is_office()));
revoke all on public.quote_versions from public, anon, authenticated;
grant select on public.quote_versions to authenticated;

create or replace function private.quote_log(q public.quotes, p_event text, p_email text, p_person text, p_note text) returns void
language sql security definer set search_path = '' as $$
  insert into public.quote_versions (quote_id, version, event, by_email, by_person, note, approval, exceptions, model, doc_hash)
  values (q.id, q.version, p_event, nullif(p_email, ''), p_person, p_note, q.approval, q.exceptions, q.model, q.doc_hash);
$$;
revoke all on function private.quote_log(public.quotes, text, text, text, text) from public, anon, authenticated;

-- ── Creating a quote ─────────────────────────
-- As before (number, date and deadline bound into the hashed snapshot), and now the
-- approval state, decided here from the model: an exceptional quote is pending, has no
-- deadline yet and no "valid until" in its snapshot (both are set at the approval).
create or replace function public.quotes_set_hash() returns trigger
language plpgsql set search_path = '' as $$
declare v_hours int := nullif(new.model ->> 'validHours', '')::int;
begin
  new.version := 1;
  new.approval_by_email := null;
  new.approval_by := null;
  new.approval_at := null;
  new.approval_note := null;
  new.submitted_by_email := lower(nullif(new.created_by_email, ''));
  if private.quote_is_exceptional(new.model) then
    new.approval := 'pending';
    new.submitted_at := new.created_at;
    new.expires_at := null;
  else
    new.approval := 'none';
    new.exceptions := null;
    new.submitted_at := null;
    if v_hours is not null then
      new.expires_at := new.created_at + make_interval(hours => v_hours);
    end if;
  end if;
  new.model := new.model
    || jsonb_build_object('number', new.number, 'createdAt', new.created_at)
    || case when new.expires_at is null then '{}'::jsonb
            else jsonb_build_object('validUntil', new.expires_at) end;
  new.doc_hash := encode(extensions.digest(new.model::text, 'sha256'), 'hex');
  return new;
end $$;

create or replace function public.quotes_log_submitted() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.approval = 'pending' then
    perform private.quote_log(new, 'submitted', new.submitted_by_email, null, null);
  end if;
  return new;
end $$;
revoke execute on function public.quotes_log_submitted() from public, anon, authenticated;
drop trigger if exists quotes_log_submitted on public.quotes;
create trigger quotes_log_submitted after insert on public.quotes
for each row execute function public.quotes_log_submitted();

-- ── Nothing changes outside the approval functions ──
-- The content, the hash, the deadline and the approval fields move only inside
-- quote_approve / quote_reject / quote_revise (they set a flag for their own
-- transaction). A quote that is pending or rejected can never become signed.
create or replace function public.quotes_freeze_model() returns trigger
language plpgsql set search_path = '' as $$
declare flow boolean := coalesce(current_setting('astrateg.quote_flow', true), '') = 'on';
begin
  if old.status = 'signed' then
    raise exception 'signed quotes are immutable';
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
  if new.status = 'signed' and new.approval in ('pending', 'rejected') then
    raise exception 'this contract awaits a manager''s approval' using errcode = '42501';
  end if;
  if new.status = 'signed' then
    new.first_viewed_at := coalesce(old.first_viewed_at, new.signed_at);
  end if;
  return new;
end $$;

-- ── 3. Approve / reject ──────────────────────
create or replace function public.quote_approve(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  q public.quotes;
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_person text;
  v_hours int;
  v_now timestamptz := now();
begin
  if not public.can_approve_quotes() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select s.person into v_person from public.staff s where s.email = me;
  select * into q from public.quotes where id = p_id for update;
  if not found or q.status <> 'sent' then
    raise exception 'quote not found' using errcode = 'P0002';
  end if;
  if q.approval <> 'pending' then
    raise exception 'this contract is not waiting for approval' using errcode = '22023';
  end if;
  -- Ofir and Lior never approve what they prepared themselves; the owner may.
  if v_person is not null and q.submitted_by_email is not distinct from me then
    raise exception 'you cannot approve a contract you prepared' using errcode = '42501';
  end if;
  v_hours := nullif(q.model ->> 'validHours', '')::int;
  perform set_config('astrateg.quote_flow', 'on', true);
  update public.quotes set
    approval = 'approved',
    approval_by_email = me,
    approval_by = coalesce(v_person, 'owner'),
    approval_at = v_now,
    approval_note = null,
    first_viewed_at = null,
    -- The signing window starts now.
    expires_at = case when v_hours is null then null else v_now + make_interval(hours => v_hours) end,
    model = (model - 'validUntil') || case when v_hours is null then '{}'::jsonb
      else jsonb_build_object('validUntil', v_now + make_interval(hours => v_hours)) end
  where id = q.id;
  update public.quotes set doc_hash = encode(extensions.digest(model::text, 'sha256'), 'hex') where id = q.id
  returning * into q;
  perform set_config('astrateg.quote_flow', '', true);
  perform private.quote_log(q, 'approved', me, coalesce(v_person, 'owner'), null);
  return jsonb_build_object('id', q.id, 'number', q.number, 'token', q.token, 'approval', q.approval, 'expiresAt', q.expires_at);
end $$;

create or replace function public.quote_reject(p_id uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  q public.quotes;
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_person text;
  v_note text := btrim(coalesce(p_note, ''));
begin
  if not public.can_approve_quotes() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if char_length(v_note) < 1 or char_length(v_note) > 1000 then
    raise exception 'a note is required (up to 1000 characters)' using errcode = '22023';
  end if;
  select s.person into v_person from public.staff s where s.email = me;
  select * into q from public.quotes where id = p_id for update;
  if not found or q.status <> 'sent' then
    raise exception 'quote not found' using errcode = 'P0002';
  end if;
  if q.approval <> 'pending' then
    raise exception 'this contract is not waiting for approval' using errcode = '22023';
  end if;
  perform set_config('astrateg.quote_flow', 'on', true);
  update public.quotes set
    approval = 'rejected',
    approval_by_email = me,
    approval_by = coalesce(v_person, 'owner'),
    approval_at = now(),
    approval_note = v_note
  where id = q.id
  returning * into q;
  perform set_config('astrateg.quote_flow', '', true);
  perform private.quote_log(q, 'rejected', me, coalesce(v_person, 'owner'), v_note);
  return jsonb_build_object('id', q.id, 'number', q.number, 'approval', q.approval);
end $$;

-- ── 4. A corrected version of the same quote ──
-- Called by the create-quote edge function only (service role), after it validated the
-- selection and computed the model again. The quote keeps its number, date and link
-- token. Exceptional: pending again (also when it was already approved), without a
-- deadline. Nothing exceptional left: a regular quote, valid from now.
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
  v_expires := case when v_exc or v_hours is null then null else v_now + make_interval(hours => v_hours) end;
  perform set_config('astrateg.quote_flow', 'on', true);
  update public.quotes set
    model = (p_model - 'validUntil')
      || jsonb_build_object('number', q.number, 'createdAt', q.created_at)
      || case when v_expires is null then '{}'::jsonb else jsonb_build_object('validUntil', v_expires) end,
    client_name = p_client_name,
    monthly_gross_agorot = p_monthly_gross,
    term_gross_agorot = p_term_gross,
    exceptions = case when v_exc then p_exceptions end,
    approval = case when v_exc then 'pending' else 'none' end,
    approval_by_email = null, approval_by = null, approval_at = null, approval_note = null,
    version = q.version + 1,
    submitted_at = case when v_exc then v_now end,
    submitted_by_email = lower(nullif(p_by_email, '')),
    first_viewed_at = null,
    expires_at = v_expires
  where id = q.id;
  update public.quotes set doc_hash = encode(extensions.digest(model::text, 'sha256'), 'hex') where id = q.id
  returning * into q;
  perform set_config('astrateg.quote_flow', '', true);
  perform private.quote_log(q, 'revised', lower(nullif(p_by_email, '')), null, null);
  return jsonb_build_object('id', q.id, 'number', q.number, 'created_at', q.created_at, 'approval', q.approval,
    'version', q.version, 'token', case when q.approval = 'none' then q.token end);
end $$;

revoke all on function public.quote_approve(uuid) from public, anon, authenticated;
revoke all on function public.quote_reject(uuid, text) from public, anon, authenticated;
revoke all on function public.quote_revise(uuid, jsonb, text, integer, integer, jsonb, text) from public, anon, authenticated;
grant execute on function public.quote_approve(uuid) to authenticated;
grant execute on function public.quote_reject(uuid, text) to authenticated;
grant execute on function public.quote_revise(uuid, jsonb, text, integer, integer, jsonb, text) to service_role;

-- ── 2. The client's link while it is not approved ──
-- As 20260927090000_validity_and_consent.sql, with one more reason to answer "nothing".
create or replace function public.get_quote(p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q public.quotes;
begin
  select * into q from public.quotes where token = p_token;
  if not found or q.status = 'cancelled' or q.approval in ('pending', 'rejected') then
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
  -- Waiting for a manager, or not approved: to the client it does not exist yet.
  if not found or q.status = 'cancelled' or q.approval in ('pending', 'rejected') then
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

-- ── 5. What a signed agreement grants ────────
-- As packageDeliverables() in app/protocol-logic.js (tests/sql/custom-contracts.test.mjs
-- and tests/sql/manager.test.mjs compare the two). A contract changed by hand
-- (model.selection.custom): the package's own quantities as typed (add-ons still add on
-- top), the monthly photographer's contents a month, the term, and the added lines,
-- kept for display only under `extra` (no counters).
create or replace function public.package_deliverables(model jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  with p as (
    select model -> 'package' ->> 'id' as id,
           coalesce(model -> 'selection' -> 'paid', '[]'::jsonb) as paid,
           coalesce(model -> 'selection' -> 'free', '{}'::jsonb) as free,
           case when jsonb_typeof(model -> 'selection' -> 'custom') = 'object' then model -> 'selection' -> 'custom' else '{}'::jsonb end as custom
  ), t as (
    select p.*,
           case when jsonb_typeof(custom -> 'qty') = 'object' then custom -> 'qty' else '{}'::jsonb end as qty,
           case when jsonb_typeof(model -> 'termMonths') = 'number' then round((model ->> 'termMonths')::numeric)::int
                when jsonb_typeof(custom -> 'termMonths') = 'number' then round((custom ->> 'termMonths')::numeric)::int
                else 12 end as months
    from p
  ), s as (
    select t.paid, t.free, t.custom, t.months,
           case when jsonb_typeof(qty -> 'videos') = 'number' then (qty ->> 'videos')::numeric::int else v.videos end as videos,
           case when jsonb_typeof(qty -> 'graphics') = 'number' then (qty ->> 'graphics')::numeric::int else v.graphics end as graphics,
           case when jsonb_typeof(qty -> 'shootDays') = 'number' then (qty ->> 'shootDays')::numeric::int else v.shoot_days end as shoot_days,
           case when jsonb_typeof(qty -> 'collabs') = 'number' then (qty ->> 'collabs')::numeric::int else v.collabs end as collabs,
           case when jsonb_typeof(qty -> 'stories') = 'number' then (qty ->> 'stories')::numeric::int else v.stories end as stories,
           case when jsonb_typeof(qty -> 'ch14') = 'number' then (qty ->> 'ch14')::numeric::int else v.ch14 end as ch14,
           case when jsonb_typeof(qty -> 'photoDays') = 'number' then (qty ->> 'photoDays')::numeric::int else v.photo_days end as photo_days,
           case when jsonb_typeof(qty -> 'monthly') = 'number' then (qty ->> 'monthly')::numeric::int else 8 end as monthly
    from t join (values
      ('podcast-natali', 20, 20, 0, 0, 0, 0, 1),
      ('podcast-simeon', 20, 20, 0, 0, 0, 0, 1),
      ('social-simeon', 25, 35, 1, 1, 0, 0, 0),
      ('social-tv-simeon', 42, 42, 2, 3, 3, 1, 0),
      ('social-natali', 25, 35, 1, 0, 0, 0, 0),
      ('social-tv-natali', 42, 42, 1, 0, 0, 1, 0)
    ) as v (id, videos, graphics, shoot_days, collabs, stories, ch14, photo_days) on v.id = t.id
  )
  select coalesce((
    select jsonb_strip_nulls(jsonb_build_object(
      'videos', videos,
      'graphics', graphics + coalesce((free ->> 'graphics')::int, 0),
      'shoot_days', shoot_days + case when paid ? 'simeon-day' then 1 else 0 end,
      'collabs', collabs + case when paid ? 'natali-reel' then 1 else 0 end,
      'stories', stories + coalesce((free ->> 'simeonStories')::int, 0) + case when paid ? 'natali-story' then 1 else 0 end,
      'ch14', ch14 + case when coalesce((free ->> 'extraCh14')::boolean, false) then 1 else 0 end,
      'monthly', case when paid ? 'photographer' then monthly * months else 0 end,
      'photo_days', case when photo_days > 0 then photo_days end,
      'simeon_join', case when coalesce((free ->> 'simeonJoin')::boolean, false) then 1 end))
      -- The added lines, after the nulls were stripped (a line's quantity may be null).
      || coalesce((
        select jsonb_build_object('extra', jsonb_agg(jsonb_build_object(
          'label', l ->> 'label',
          'qty', case when jsonb_typeof(l -> 'qty') = 'number' then l -> 'qty' else 'null'::jsonb end) order by ord))
        from jsonb_array_elements(case when jsonb_typeof(custom -> 'lines') = 'array' then custom -> 'lines' else '[]'::jsonb end)
          with ordinality as x (l, ord)
        where coalesce(l ->> 'label', '') <> ''
        having count(*) > 0), '{}'::jsonb)
    from s), '{}'::jsonb);
$$;

-- ── 6. The field's deals: "הצעה אחרת" and the approval statuses ──
-- A deal is either a built-in package (tier and influencer, as before) or another
-- offer in the seller's words (custom): what it includes, optional quantities, the
-- monthly price he agreed and the term.
create or replace function private.json_int_between(v jsonb, lo integer, hi integer) returns boolean
language sql immutable set search_path = '' as $$
  select v is null or jsonb_typeof(v) = 'null'
    or (jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric = trunc((v #>> '{}')::numeric)
        and (v #>> '{}')::numeric between lo and hi);
$$;
create or replace function private.deal_custom_ok(c jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select c is null or coalesce(
    jsonb_typeof(c) = 'object'
    and (c - array['description', 'videos', 'graphics', 'shoot_days', 'price_agorot', 'term_months']) = '{}'::jsonb
    and jsonb_typeof(c -> 'description') = 'string'
    and length(btrim(c ->> 'description')) between 1 and 2000
    and private.json_int_between(c -> 'videos', 0, 200)
    and private.json_int_between(c -> 'graphics', 0, 300)
    and private.json_int_between(c -> 'shoot_days', 0, 12)
    and jsonb_typeof(c -> 'price_agorot') = 'number' and private.json_int_between(c -> 'price_agorot', 100, 10000000)
    and jsonb_typeof(c -> 'term_months') = 'number' and private.json_int_between(c -> 'term_months', 1, 36),
    false);
$$;
revoke all on function private.json_int_between(jsonb, integer, integer) from public, anon;
revoke all on function private.deal_custom_ok(jsonb) from public, anon;
grant execute on function private.json_int_between(jsonb, integer, integer) to authenticated;
grant execute on function private.deal_custom_ok(jsonb) to authenticated;

alter table public.deal_requests add column if not exists custom jsonb;
alter table public.deal_requests alter column tier drop not null;
alter table public.deal_requests alter column influencer drop not null;
alter table public.deal_requests drop constraint if exists deal_requests_custom_check;
alter table public.deal_requests add constraint deal_requests_custom_check
  check (private.deal_custom_ok(custom));
alter table public.deal_requests drop constraint if exists deal_requests_kind_check;
alter table public.deal_requests add constraint deal_requests_kind_check
  check (custom is not null or (tier is not null and influencer is not null));
-- 'approval' ממתין לאישור מנהל, 'rejected' לא אושר: between 'pending' and 'sent'.
alter table public.deal_requests drop constraint if exists deal_requests_status_check;
alter table public.deal_requests add constraint deal_requests_status_check
  check (status in ('pending', 'approval', 'rejected', 'sent', 'signed', 'cancelled'));

-- As 20261005100000_sales_amos.sql; linking a quote now follows that quote's approval:
-- waiting for a manager → 'approval', not approved → 'rejected', otherwise "חוזה נשלח".
create or replace function public.deal_requests_stamp() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_approval text;
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    if me <> '' then
      new.created_by_email := me;
      new.seller := public.my_person();
      if new.seller is not null and new.seller not in ('stav', 'amos') then new.seller := null; end if;
    end if;
    new.status := 'pending';
    new.quote_id := null;
    new.sent_at := null;
    new.signed_at := null;
    new.status_by_email := null;
  else
    new.id := old.id;
    new.created_at := old.created_at;
    new.created_by_email := old.created_by_email;
    new.seller := old.seller;
    if new.quote_id is not null and new.quote_id is distinct from old.quote_id and new.status = 'pending' then
      select q.approval into v_approval from public.quotes q where q.id = new.quote_id;
      new.status := case v_approval when 'pending' then 'approval' when 'rejected' then 'rejected' else 'sent' end;
    end if;
    if new.status is distinct from old.status then
      new.status_by_email := nullif(me, '');
      if new.status = 'sent' and new.sent_at is null then new.sent_at := now(); end if;
      if new.status = 'signed' and new.signed_at is null then new.signed_at := now(); end if;
      if new.status in ('pending', 'approval', 'rejected') then new.sent_at := null; new.signed_at := null; end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.deal_requests_stamp() from public, anon, authenticated;

-- The linked quote was sent for approval again, approved or rejected: its deal follows.
-- Never undoes the decision: a failure here is only a warning.
create or replace function public.deal_on_approval() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.approval is not distinct from old.approval then
    return new;
  end if;
  begin
    update public.deal_requests
    set status = case new.approval when 'pending' then 'approval' when 'rejected' then 'rejected' else 'sent' end
    where quote_id = new.id and status in ('pending', 'approval', 'rejected', 'sent');
  exception when others then
    raise warning 'deal_on_approval failed for quote %: %', new.number, sqlerrm;
  end;
  return new;
end $$;
revoke execute on function public.deal_on_approval() from public, anon, authenticated;
drop trigger if exists quotes_deal_approval on public.quotes;
create trigger quotes_deal_approval after update of approval on public.quotes
for each row execute function public.deal_on_approval();
