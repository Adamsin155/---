-- The signed documents of the old system (astrateg-crm), each in its client's card (the
-- owner's request of 25.10.2026): 36 contracts, a termination and an addendum. They were
-- signed there, with the client's name, the time and a drawn signature; here they are kept
-- as they were, to read and print, never to sign again or change.
--
-- One row per old document, keyed by its old numeric id (an import that runs again changes
-- the same row). `doc` is the whole old record, minus what is not needed to read it and
-- identifies the signer's device or number: the IP address and the browser of the signing
-- (signedIp, signedUserAgent; also ip / userAgent / ua at any depth, in the signers and in
-- the signing history), the phone (phone) and the company number (hp). The columns beside
-- it are what the card's list shows without reading the whole document.
--
-- Who:
--   - reads: the office only (public.is_office(): the owner, Irit, Lior, Ofir, Ilai); not
--     an editor, not the photographer, not a client's link, not anyone signed out;
--   - writes: only public.legacy_contract_import(), and only the owner (a staff login with
--     no person). The table has no write grant at all.
-- client_id is not a foreign key, as in the other per-client tables of the latest migrations
-- (the import checks the client is there).
-- The file only adds, and can run again safely (tests/sql/legacy-contracts.test.mjs).

create table if not exists public.legacy_contracts (
  id bigint primary key,                       -- the old system's id
  client_id uuid not null,
  doc_type text not null default 'contract' check (doc_type in ('contract', 'termination', 'addendum')),
  doc_number text,
  signer_name text,
  signed_at timestamptz,
  total_amount numeric,
  retainer numeric,
  signature text check (signature ~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' and length(signature) < 400000),
  doc jsonb not null check (jsonb_typeof(doc) = 'object'),
  imported_at timestamptz not null default now(),
  imported_by text
);
create index if not exists legacy_contracts_client_idx on public.legacy_contracts (client_id);

alter table public.legacy_contracts enable row level security;
revoke all on table public.legacy_contracts from public, anon, authenticated;
grant select on table public.legacy_contracts to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'legacy_contracts' and policyname = 'legacy_contracts_read') then
    create policy legacy_contracts_read on public.legacy_contracts for select to authenticated
      using ((select public.is_office()));
  end if;
end $$;

-- ── What is kept of an old record ────────────
-- The record without the device and the numbers of the signer: the keys below at any depth
-- (the signers, the signing history), and the phone and the company number.
create or replace function private.legacy_scrub(p jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
begin
  if p is null then return null; end if;
  if jsonb_typeof(p) = 'object' then
    return coalesce((
      select jsonb_object_agg(e.k, private.legacy_scrub(e.v))
      from jsonb_each(p) as e(k, v)
      where lower(e.k) not in ('signedip', 'signeduseragent', 'ip', 'useragent', 'ua', 'phone', 'hp')
    ), '{}'::jsonb);
  elsif jsonb_typeof(p) = 'array' then
    return coalesce((
      select jsonb_agg(private.legacy_scrub(a.v) order by a.i)
      from jsonb_array_elements(p) with ordinality as a(v, i)
    ), '[]'::jsonb);
  end if;
  return p;
end $$;
revoke all on function private.legacy_scrub(jsonb) from public, anon, authenticated;

-- A number of the old record (a number, or text such as "5,000" or "₪5000"); null otherwise.
create or replace function private.legacy_number(p jsonb) returns numeric
language plpgsql immutable set search_path = '' as $$
declare s text;
begin
  if p is null then return null; end if;
  if jsonb_typeof(p) = 'number' then return (p #>> '{}')::numeric; end if;
  if jsonb_typeof(p) <> 'string' then return null; end if;
  s := regexp_replace(p #>> '{}', '[\s,₪]', '', 'g');
  if s ~ '^-?\d+(\.\d+)?$' then return s::numeric; end if;
  return null;
end $$;
revoke all on function private.legacy_number(jsonb) from public, anon, authenticated;

-- A time of the old record (ISO text, or milliseconds / seconds since 1970); null otherwise.
create or replace function private.legacy_time(p jsonb) returns timestamptz
language plpgsql stable set search_path = '' as $$
declare n numeric;
begin
  if p is null then return null; end if;
  if jsonb_typeof(p) = 'number' then
    n := (p #>> '{}')::numeric;
    return to_timestamp(case when n > 100000000000 then n / 1000 else n end);
  end if;
  if jsonb_typeof(p) = 'string' and pg_input_is_valid(p #>> '{}', 'timestamptz') then
    return (p #>> '{}')::timestamptz;
  end if;
  return null;
end $$;
revoke all on function private.legacy_time(jsonb) from public, anon, authenticated;

-- ── The one way in: the owner imports a document ──
-- p_client: the new client's id; p_doc: the old record as the old system kept it. Runs again
-- on the same old id and changes the same row. Returns the row without the document.
create or replace function public.legacy_contract_import(p_client uuid, p_doc jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint;
  v_type text;
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
  v_sig := nullif(btrim(coalesce(p_doc ->> 'signature', '')), '');
  if v_sig is not null and (v_sig !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' or length(v_sig) >= 400000) then
    raise exception 'the signature: a PNG picture' using errcode = '22023';
  end if;
  v_signer := coalesce(nullif(btrim(coalesce(p_doc ->> 'signerName', '')), ''), nullif(btrim(coalesce(p_doc #>> '{signers,0,name}', '')), ''));
  v_doc := private.legacy_scrub(p_doc);

  insert into public.legacy_contracts as l (id, client_id, doc_type, doc_number, signer_name, signed_at, total_amount, retainer, signature, doc, imported_at, imported_by)
  values (v_id, p_client, v_type, nullif(btrim(coalesce(p_doc ->> 'docNumber', '')), ''), v_signer,
    private.legacy_time(p_doc -> 'signedAt'), private.legacy_number(p_doc -> 'totalAmount'), private.legacy_number(p_doc -> 'retainer'),
    v_sig, v_doc, now(), v_by)
  on conflict (id) do update
    set client_id = excluded.client_id, doc_type = excluded.doc_type, doc_number = excluded.doc_number,
        signer_name = excluded.signer_name, signed_at = excluded.signed_at, total_amount = excluded.total_amount,
        retainer = excluded.retainer, signature = excluded.signature, doc = excluded.doc,
        imported_at = excluded.imported_at, imported_by = excluded.imported_by
  returning * into v_row;
  return to_jsonb(v_row) - 'doc' - 'signature';
end $$;
revoke all on function public.legacy_contract_import(uuid, jsonb) from public, anon;
grant execute on function public.legacy_contract_import(uuid, jsonb) to authenticated;
