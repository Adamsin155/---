-- The old system's documents, everything of them (the owner, 28.10.2026: "אמרתי לך להעתיק הכל").
-- Until now private.legacy_scrub() (20261105100000_legacy_contracts.sql) took out of every record the
-- client's company number and phone, and the signing's device (IP, browser), also inside the
-- signers and the signing history. The documents showed them, so they are part of the document:
-- from now on the record is kept as the old system kept it. Who reads it does not change: the
-- office only (public.legacy_contracts, is_office).
--
-- The function keeps its name and signature (public.legacy_contract_import calls it) and returns
-- the record as it came. Running the import again (scripts/legacy-contracts-import.mjs, the owner's
-- session) brings the missing fields into the rows already there (the same old id, the same row).
-- The file only replaces one function and can run again safely (tests/sql/legacy-contracts.test.mjs).

create or replace function private.legacy_scrub(p jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select p
$$;
revoke all on function private.legacy_scrub(jsonb) from public, anon, authenticated;
