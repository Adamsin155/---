-- How many videos each editor has already edited per client (the owner's request of 22.10.2026).
-- On the editors' page each client card has one line, "ערכתי [ N ] מתוך M"; the office sees
-- the numbers beside each editor's client (Ofir's load list, the client card's head).
--
-- One row per client, shoot round and editor: round 1 is the client's own shoot, 2 and up a
-- round of `clients.rounds`. With two editors on a shoot (editor2, 21.10.2026) each keeps
-- their own number. The number may be above the editor's share: it is kept as written.
--
-- Who:
--   - reads: the office (the owner, Irit, Lior, Ofir) every row; an editor their own rows only,
--     for the shoots they edit now (main or second editor of that shoot);
--   - writes: only through public.editor_progress_set(), the editor of that shoot for
--     themselves, or the office for any editor of it. The table has no write grant at all.
-- client_id is not a foreign key on purpose: a client taken out of the system by the owner
-- (manager_features) must not be held back by these numbers; a row of a client that is no
-- longer there is read by nobody but the office, and means nothing.
-- The file only adds, and can run again safely (tests/sql/editor-progress.test.mjs).

create table if not exists public.editor_progress (
  client_id uuid not null,
  editor text not null check (editor in ('nadia', 'yariv', 'anna', 'nirel')),
  round integer not null default 1 check (round between 1 and 50),
  edited integer not null check (edited between 0 and 999),
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (client_id, round, editor)
);

alter table public.editor_progress enable row level security;
revoke all on table public.editor_progress from public, anon, authenticated;
grant select on table public.editor_progress to authenticated;

-- ── Who is the editor of a shoot ─────────────
-- The main or second editor of the client's own shoot (round 1), or of a round.
create or replace function private.edits_shoot(p_client uuid, p_round integer, p_person text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_person is not null and exists (
    select 1 from public.clients c where c.id = p_client and (
      (coalesce(p_round, 1) = 1 and (c.editor = p_person or c.editor2 = p_person))
      or (coalesce(p_round, 1) > 1 and jsonb_typeof(c.rounds) = 'array' and exists (
        select 1 from jsonb_array_elements(c.rounds) r
        where jsonb_typeof(r) = 'object' and r ->> 'n' = p_round::text
          and (r ->> 'editor' = p_person or (r ->> 'editor' is not null and r ->> 'editor2' = p_person))))));
$$;
revoke all on function private.edits_shoot(uuid, integer, text) from public, anon;
grant execute on function private.edits_shoot(uuid, integer, text) to authenticated;

-- The office of this table: the owner, Irit, Lior and Ofir.
create or replace function private.progress_office() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_owner() or coalesce(public.my_person(), '') in ('irit', 'lior', 'ofir');
$$;
revoke all on function private.progress_office() from public, anon;
grant execute on function private.progress_office() to authenticated;

-- ── Reading ──────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'editor_progress' and policyname = 'editor_progress_read') then
    create policy editor_progress_read on public.editor_progress for select to authenticated
      using (
        (select private.progress_office())
        or (editor = (select public.my_person())
          and client_id in (select private.my_assigned_clients())
          and private.edits_shoot(client_id, round, editor)));
  end if;
end $$;

-- ── Writing: the one way in ──────────────────
-- Sets the caller's number for the client's shoot (p_round null or 1: the client's own).
-- The office may also set it for an editor of that shoot (p_editor); an editor only for
-- themselves. Returns the row as saved.
create or replace function public.editor_progress_set(p_client uuid, p_edited integer, p_round integer default null, p_editor text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me text;
  v_office boolean;
  v_editor text;
  v_round integer := coalesce(p_round, 1);
  v_by text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_row public.editor_progress;
begin
  if not public.is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  me := public.my_person();
  v_office := private.progress_office();
  if p_client is null or p_edited is null or p_edited < 0 or p_edited > 999 then
    raise exception 'a whole number between 0 and 999' using errcode = '22023';
  end if;
  if v_round < 1 or v_round > 50 then raise exception 'no such round' using errcode = '22023'; end if;

  v_editor := coalesce(p_editor, me);
  if v_editor is distinct from me and not v_office then raise exception 'not allowed' using errcode = '42501'; end if;
  if not private.edits_shoot(p_client, v_round, v_editor) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  insert into public.editor_progress as e (client_id, editor, round, edited, updated_at, updated_by)
  values (p_client, v_editor, v_round, p_edited, now(), v_by)
  on conflict (client_id, round, editor) do update
    set edited = excluded.edited, updated_at = excluded.updated_at, updated_by = excluded.updated_by
  returning * into v_row;
  return to_jsonb(v_row);
end $$;
revoke all on function public.editor_progress_set(uuid, integer, integer, text) from public, anon;
grant execute on function public.editor_progress_set(uuid, integer, integer, text) to authenticated;
