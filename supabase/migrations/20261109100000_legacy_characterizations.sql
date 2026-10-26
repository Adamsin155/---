-- The characterizations of the old system (astrateg-crm), each in its client's card (the
-- owner's request of 26.10.2026): the filled characterization, the brief, the scripts that
-- were written there, the summary and the raw answers. They are kept as they were, to read
-- and print; the new system's own characterization (public.characterizations) is not touched.
--
-- One row per client (an import that runs again changes the same row). The old fields:
--   charterFilledText / charterFilledAt  → filled_text / filled_at
--   briefText / briefUpdatedAt           → brief_text / brief_at
--   charterScript / charterScriptAt      → script_text / script_at
--   charterSummary                       → summary_text
--   charterAnswers (question id → text)  → answers
-- The texts keep no phone number and no e-mail address: each is replaced with "[הוסר]" (the
-- client's contact details live in the card already). The answers are stripped the same way.
--
-- Who:
--   - reads: every member of staff (the owner, 26.10.2026: "כולם יכולים לראות את האיפיון"),
--     except the field sales agents (Stav, Amos), who see nothing of the clients; not a
--     client's link, not anyone signed out;
--   - writes: only public.legacy_characterization_import(), and only the owner (a staff login
--     with no person). The table has no write grant at all.
-- client_id is not a foreign key, as in public.legacy_contracts (the import checks the client
-- is there). The file only adds, and can run again safely
-- (tests/sql/legacy-characterizations.test.mjs).

create table if not exists public.legacy_characterizations (
  client_id uuid primary key,
  filled_text text check (filled_text is null or length(filled_text) <= 20000),
  filled_at timestamptz,
  brief_text text check (brief_text is null or length(brief_text) <= 20000),
  brief_at timestamptz,
  script_text text check (script_text is null or length(script_text) <= 20000),
  script_at timestamptz,
  summary_text text check (summary_text is null or length(summary_text) <= 20000),
  answers jsonb check (answers is null or (jsonb_typeof(answers) = 'object' and length(answers::text) <= 100000)),
  imported_at timestamptz not null default now(),
  imported_by text
);

alter table public.legacy_characterizations enable row level security;
revoke all on table public.legacy_characterizations from public, anon, authenticated;
grant select on table public.legacy_characterizations to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'legacy_characterizations' and policyname = 'legacy_characterizations_read') then
    create policy legacy_characterizations_read on public.legacy_characterizations for select to authenticated
      using ((select public.is_staff()) and not (select private.is_sales()));
  end if;
end $$;

-- ── No phone number, no e-mail address ──────
-- An e-mail address; an Israeli phone number (0 and the area code, or +972 / 00972 / 972 with
-- or without "(0)", the rest in groups of digits with a space, a dot or a dash between them,
-- the area code in brackets or not); a 1-800 / 1-700 / 1-599 number. Not part of a longer
-- run of digits (an amount, an id).
create or replace function private.legacy_unlisted(p text) returns text
language sql immutable set search_path = '' as $$
  select case when p is null then null else
    regexp_replace(
      regexp_replace(
        regexp_replace(p, '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}', '[הוסר]', 'g'),
        '(?<![0-9])(?:(?:\+|00)?972[ .-]{0,3}(?:\(0\)[ .-]{0,3})?|\(?0)[0-9]{1,2}\)?[ .-]{0,3}[0-9]{3}[ .-]{0,3}[0-9]{3,4}(?![0-9])', '[הוסר]', 'g'),
      '(?<![0-9])1[ .-]{0,3}(?:800|700|599)[ .-]{0,3}[0-9]{2,3}[ .-]{0,3}[0-9]{3,4}(?![0-9])', '[הוסר]', 'g')
  end;
$$;
revoke all on function private.legacy_unlisted(text) from public, anon, authenticated;

-- A text of the old record: its lines as they were (Windows line ends made plain), without the
-- contact details; null when it is not text or is empty.
create or replace function private.legacy_char_text(p jsonb) returns text
language sql immutable set search_path = '' as $$
  select case when p is null or jsonb_typeof(p) <> 'string' then null
    else nullif(btrim(private.legacy_unlisted(replace(replace(p #>> '{}', E'\r\n', E'\n'), E'\r', E'\n')), E' \t\n'), '') end;
$$;
revoke all on function private.legacy_char_text(jsonb) from public, anon, authenticated;

-- The raw answers: every text in them without the contact details (at any depth); the empty
-- ones left out. Null when nothing is left or it is not an object.
create or replace function private.legacy_char_json(p jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare v jsonb;
begin
  if p is null or jsonb_typeof(p) = 'null' then return null; end if;
  if jsonb_typeof(p) = 'string' then
    return to_jsonb(private.legacy_char_text(p));
  elsif jsonb_typeof(p) = 'array' then
    select jsonb_agg(x.v order by x.i) into v
    from (select private.legacy_char_json(a.v) as v, a.i from jsonb_array_elements(p) with ordinality as a(v, i)) x
    where x.v is not null and x.v <> 'null'::jsonb;
    return v;
  elsif jsonb_typeof(p) = 'object' then
    select jsonb_object_agg(x.k, x.v) into v
    from (select e.k, private.legacy_char_json(e.v) as v from jsonb_each(p) as e(k, v)) x
    where x.v is not null and x.v <> 'null'::jsonb;
    return v;
  end if;
  return p;
end $$;
revoke all on function private.legacy_char_json(jsonb) from public, anon, authenticated;

-- ── The one way in: the owner imports a client's characterization ──
-- p_client: the new client's id; p_doc: the old client's fields named above (others are not
-- read). Runs again on the same client and changes the same row. Returns which parts were
-- kept and their lengths, not the texts.
create or replace function public.legacy_characterization_import(p_client uuid, p_doc jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_filled text;
  v_brief text;
  v_script text;
  v_summary text;
  v_answers jsonb;
  v_by text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_row public.legacy_characterizations;
begin
  if not private.is_owner() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_client is null or p_doc is null or jsonb_typeof(p_doc) <> 'object' then
    raise exception 'a client and a characterization' using errcode = '22023';
  end if;
  if not exists (select 1 from public.clients c where c.id = p_client) then
    raise exception 'no such client' using errcode = '22023';
  end if;
  if length(p_doc::text) > 400000 then raise exception 'the characterization is too large' using errcode = '22023'; end if;
  v_filled := private.legacy_char_text(p_doc -> 'charterFilledText');
  v_brief := private.legacy_char_text(p_doc -> 'briefText');
  v_script := private.legacy_char_text(p_doc -> 'charterScript');
  v_summary := private.legacy_char_text(p_doc -> 'charterSummary');
  v_answers := case when jsonb_typeof(p_doc -> 'charterAnswers') = 'object' then private.legacy_char_json(p_doc -> 'charterAnswers') end;
  if v_answers = '{}'::jsonb then v_answers := null; end if;
  if v_filled is null and v_brief is null and v_script is null and v_summary is null and v_answers is null then
    raise exception 'nothing to keep' using errcode = '22023';
  end if;
  if greatest(length(v_filled), length(v_brief), length(v_script), length(v_summary)) > 20000 then
    raise exception 'a text is too long (20000 characters at most)' using errcode = '22023';
  end if;
  if v_answers is not null and length(v_answers::text) > 100000 then
    raise exception 'the answers are too long' using errcode = '22023';
  end if;

  insert into public.legacy_characterizations as l (client_id, filled_text, filled_at, brief_text, brief_at, script_text, script_at,
    summary_text, answers, imported_at, imported_by)
  values (p_client, v_filled, private.legacy_time(p_doc -> 'charterFilledAt'), v_brief, private.legacy_time(p_doc -> 'briefUpdatedAt'),
    v_script, private.legacy_time(p_doc -> 'charterScriptAt'), v_summary, v_answers, now(), v_by)
  on conflict (client_id) do update
    set filled_text = excluded.filled_text, filled_at = excluded.filled_at, brief_text = excluded.brief_text, brief_at = excluded.brief_at,
        script_text = excluded.script_text, script_at = excluded.script_at, summary_text = excluded.summary_text,
        answers = excluded.answers, imported_at = excluded.imported_at, imported_by = excluded.imported_by
  returning * into v_row;
  return jsonb_build_object('client_id', v_row.client_id,
    'filled', length(v_row.filled_text), 'brief', length(v_row.brief_text), 'script', length(v_row.script_text),
    'summary', length(v_row.summary_text), 'answers', (select count(*) from jsonb_object_keys(coalesce(v_row.answers, '{}'::jsonb))),
    'imported_at', v_row.imported_at);
end $$;
revoke all on function public.legacy_characterization_import(uuid, jsonb) from public, anon;
grant execute on function public.legacy_characterization_import(uuid, jsonb) to authenticated;
