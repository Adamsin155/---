-- How many videos each editor edited THIS MONTH, for a monthly client (the owner's request of
-- 22.10.2026). Some clients get a fixed number of videos every month instead of one package:
-- the client's deliverables say so (`videos_month`: 8, and a month that differs in
-- `videos_month_except`: { "2026-10": 12 }; app/edit-count.js monthTarget). For such a client
-- the editors' page shows "ערכתי [ N ] מתוך 8" for the current Israel month, from 0 again on
-- the 1st of every month (nothing carries over); the office sees the same number. Every other
-- client keeps its count per shoot (public.editor_progress, 20261101100000_editor_progress.sql).
--
-- One row per client, editor and month ('YYYY-MM', the Israel calendar month).
--
-- Who, exactly as public.editor_progress:
--   - reads: the office (the owner, Irit, Lior, Ofir) every row; an editor their own rows only,
--     of a client they edit now (main or second editor of the client's own shoot, also while
--     the client is in landing: clients.editor, as landing_set_editor records it);
--   - writes: only through public.editor_progress_month_set(), the editor for themselves, or
--     the office for any editor of the client. The table has no write grant at all.
--   An editor writes the current month, or the month before it (a page left open over the
--   night of the 1st, a last correction on the 1st); the office any month.
-- client_id is not a foreign key, for the same reason as in public.editor_progress.
-- The file only adds, and can run again safely (tests/sql/editor-progress-month.test.mjs).

create table if not exists public.editor_progress_month (
  client_id uuid not null,
  editor text not null check (editor in ('nadia', 'yariv', 'anna', 'nirel')),
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  edited integer not null check (edited between 0 and 999),
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (client_id, editor, month)
);

alter table public.editor_progress_month enable row level security;
revoke all on table public.editor_progress_month from public, anon, authenticated;
grant select on table public.editor_progress_month to authenticated;

-- ── Reading ──────────────────────────────────
-- (private.progress_office and private.edits_shoot: 20261101100000_editor_progress.sql.)
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'editor_progress_month' and policyname = 'editor_progress_month_read') then
    create policy editor_progress_month_read on public.editor_progress_month for select to authenticated
      using (
        (select private.progress_office())
        or (editor = (select public.my_person())
          and client_id in (select private.my_assigned_clients())
          and private.edits_shoot(client_id, 1, editor)));
  end if;
end $$;

-- ── Writing: the one way in ──────────────────
-- Sets the caller's number for the client in a month (p_month null: the current Israel month).
-- The office may also set it for an editor of the client (p_editor); an editor only for
-- themselves, this month or the one before. Returns the row as saved.
create or replace function public.editor_progress_month_set(p_client uuid, p_edited integer, p_month text default null, p_editor text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me text;
  v_office boolean;
  v_editor text;
  -- The Israel calendar month now, and the one before it ('YYYY-MM').
  v_now text := to_char(now() at time zone 'Asia/Jerusalem', 'YYYY-MM');
  v_before text := to_char(date_trunc('month', now() at time zone 'Asia/Jerusalem') - interval '1 month', 'YYYY-MM');
  v_month text := coalesce(nullif(btrim(p_month), ''), to_char(now() at time zone 'Asia/Jerusalem', 'YYYY-MM'));
  v_by text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_row public.editor_progress_month;
begin
  if not public.is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  me := public.my_person();
  v_office := private.progress_office();
  if p_client is null or p_edited is null or p_edited < 0 or p_edited > 999 then
    raise exception 'a whole number between 0 and 999' using errcode = '22023';
  end if;
  if v_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'a month as YYYY-MM' using errcode = '22023'; end if;

  v_editor := coalesce(p_editor, me);
  if v_editor is distinct from me and not v_office then raise exception 'not allowed' using errcode = '42501'; end if;
  if not private.edits_shoot(p_client, 1, v_editor) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not v_office and v_month not in (v_now, v_before) then
    raise exception 'not allowed: only this month or the one before' using errcode = '42501';
  end if;

  insert into public.editor_progress_month as e (client_id, editor, month, edited, updated_at, updated_by)
  values (p_client, v_editor, v_month, p_edited, now(), v_by)
  on conflict (client_id, editor, month) do update
    set edited = excluded.edited, updated_at = excluded.updated_at, updated_by = excluded.updated_by
  returning * into v_row;
  return to_jsonb(v_row);
end $$;
revoke all on function public.editor_progress_month_set(uuid, integer, text, text) from public, anon;
grant execute on function public.editor_progress_month_set(uuid, integer, text, text) to authenticated;
