-- The owner's requests of 27.10.2026, the database's part.
--
-- The old system's documents, every one of them (public.legacy_contracts,
-- 20261105100000_legacy_contracts.sql): until now only the signed ones were brought over.
-- A document that was still waiting for the client's signature there ("ממתין לחתימה"), and
-- a price offer ("הצעת מחיר"), are kept too, each with its state:
--   status  'signed'   signed in the old system (every row brought over before this file);
--           'pending'  sent there and never signed;
--           'quote'    a price offer.
-- A document that was not signed keeps no signature and no signing time, whatever the old
-- record holds (the card and the document's page say "לא נחתם"). The way in is still
-- public.legacy_contract_import(), the owner's only, and again on the same old id changes
-- the same row. The old record's own word is read: 'נחתם' / 'ממתין לחתימה' / 'הצעת מחיר'
-- (or signed / pending / quote); a record with no state is a signed one, as before.
--
-- The rest of the day's requests need nothing here:
--   - "לקוח חדש" for Lior and Ofir: the policy "office adds clients" (20260930130000) lets
--     the whole office add a client already; the screen opened it to them;
--   - the client's signed contract as a file: a file of the kind 'material_other' with the
--     label "חוזה חתום" (public.can_upload_client_file: the owner, Irit, Lior and Ofir);
--   - the characterization at any time: public.characterizations is the office's to write.
-- The file only adds, and can run again safely (tests/sql/batch-2710.test.mjs).

alter table public.legacy_contracts add column if not exists status text not null default 'signed';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'legacy_contracts_status_check' and conrelid = 'public.legacy_contracts'::regclass) then
    alter table public.legacy_contracts add constraint legacy_contracts_status_check check (status in ('signed', 'pending', 'quote'));
  end if;
end $$;
create index if not exists legacy_contracts_status_idx on public.legacy_contracts (client_id, status);

-- The state of an old record: 'signed', 'pending', 'quote', or null when it is none of them.
create or replace function private.legacy_status(p jsonb) returns text
language sql immutable set search_path = '' as $$
  select case btrim(coalesce(p ->> 'status', ''))
    when '' then 'signed'
    when 'נחתם' then 'signed'
    when 'signed' then 'signed'
    when 'ממתין לחתימה' then 'pending'
    when 'pending' then 'pending'
    when 'הצעת מחיר' then 'quote'
    when 'quote' then 'quote'
    else null
  end;
$$;
revoke all on function private.legacy_status(jsonb) from public, anon, authenticated;

-- ── The one way in: the owner imports a document (any of the three states) ──
create or replace function public.legacy_contract_import(p_client uuid, p_doc jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint;
  v_type text;
  v_status text;
  v_sig text;
  v_signer text;
  v_doc jsonb;
  v_by text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_row public.legacy_contracts;
begin
  if not private.is_owner() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_client is null or p_doc is null or jsonb_typeof(p_doc) <> 'object' then
    raise exception 'a client and a document' using errcode = '22023';
  end if;
  if not exists (select 1 from public.clients c where c.id = p_client) then
    raise exception 'no such client' using errcode = '22023';
  end if;
  if coalesce(p_doc ->> 'id', '') !~ '^\d{1,15}$' then
    raise exception 'the old id: a whole number' using errcode = '22023';
  end if;
  if length(p_doc::text) > 2000000 then raise exception 'the document is too large' using errcode = '22023'; end if;
  v_id := (p_doc ->> 'id')::bigint;
  v_type := coalesce(nullif(btrim(coalesce(p_doc ->> 'docType', '')), ''), 'contract');
  if v_type not in ('contract', 'termination', 'addendum') then
    raise exception 'an unknown document type' using errcode = '22023';
  end if;
  v_status := private.legacy_status(p_doc);
  if v_status is null then
    raise exception 'an unknown state: signed, waiting for a signature, or a price offer' using errcode = '22023';
  end if;
  v_sig := nullif(btrim(coalesce(p_doc ->> 'signature', '')), '');
  if v_sig is not null and (v_sig !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' or length(v_sig) >= 400000) then
    raise exception 'the signature: a PNG picture' using errcode = '22023';
  end if;
  -- Not signed: no signature and no signing time are kept.
  if v_status <> 'signed' then v_sig := null; end if;
  v_signer := coalesce(nullif(btrim(coalesce(p_doc ->> 'signerName', '')), ''), nullif(btrim(coalesce(p_doc #>> '{signers,0,name}', '')), ''));
  v_doc := private.legacy_scrub(p_doc);

  insert into public.legacy_contracts as l (id, client_id, doc_type, doc_number, signer_name, signed_at, total_amount, retainer, signature, doc, imported_at, imported_by, status)
  values (v_id, p_client, v_type, nullif(btrim(coalesce(p_doc ->> 'docNumber', '')), ''), v_signer,
    case when v_status = 'signed' then private.legacy_time(p_doc -> 'signedAt') end,
    private.legacy_number(p_doc -> 'totalAmount'), private.legacy_number(p_doc -> 'retainer'),
    v_sig, v_doc, now(), v_by, v_status)
  on conflict (id) do update
    set client_id = excluded.client_id, doc_type = excluded.doc_type, doc_number = excluded.doc_number,
        signer_name = excluded.signer_name, signed_at = excluded.signed_at, total_amount = excluded.total_amount,
        retainer = excluded.retainer, signature = excluded.signature, doc = excluded.doc,
        imported_at = excluded.imported_at, imported_by = excluded.imported_by, status = excluded.status
  returning * into v_row;
  return to_jsonb(v_row) - 'doc' - 'signature';
end $$;
revoke all on function public.legacy_contract_import(uuid, jsonb) from public, anon;
grant execute on function public.legacy_contract_import(uuid, jsonb) to authenticated;
