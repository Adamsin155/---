-- "עבודה לפי עובד" on the manager view (the owner, 30.10.2026; docs/ops.md, section 82).
-- public.editor_progress and public.editor_progress_month keep only the editor's running total,
-- so how much was edited on a given day was lost. From this file on every change of a total
-- adds a row here: by how much it changed, on which day in Israel.
--
-- Counting starts when this file runs: nothing from before can be known.
-- Who:
--   - reads: the office of the progress tables (private.progress_office: the owners, Irit, Lior, Ofir);
--   - writes: the triggers alone. The table has no write grant at all.
-- client_id is not a foreign key, for the same reason as in public.editor_progress.
-- The file only adds, and can run again safely (tests/sql/work-history.test.mjs).

create table if not exists public.editor_progress_log (
  id bigint generated always as identity primary key,
  client_id uuid not null,
  editor text not null,
  round integer,
  month text,
  day date not null default ((now() at time zone 'Asia/Jerusalem')::date),
  delta integer not null,
  edited integer not null,
  at timestamptz not null default now(),
  by_email text
);
create index if not exists editor_progress_log_day on public.editor_progress_log (day);

alter table public.editor_progress_log enable row level security;
revoke all on table public.editor_progress_log from public, anon, authenticated;
grant select on table public.editor_progress_log to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'editor_progress_log' and policyname = 'editor_progress_log_read') then
    create policy editor_progress_log_read on public.editor_progress_log for select to authenticated
      using ((select private.progress_office()));
  end if;
end $$;

-- One function for both tables: a shoot's total has `round`, a monthly client's has `month`.
create or replace function private.editor_progress_logged() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_before integer := case when tg_op = 'UPDATE' then old.edited else 0 end;
  v_row jsonb := to_jsonb(new);
begin
  if new.edited is distinct from v_before then
    insert into public.editor_progress_log (client_id, editor, round, month, delta, edited, by_email)
    values (new.client_id, new.editor, (v_row ->> 'round')::integer, v_row ->> 'month', new.edited - v_before, new.edited, new.updated_by);
  end if;
  return new;
end $$;
revoke all on function private.editor_progress_logged() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'editor_progress_logged' and tgrelid = 'public.editor_progress'::regclass) then
    create trigger editor_progress_logged after insert or update of edited on public.editor_progress
      for each row execute function private.editor_progress_logged();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'editor_progress_logged' and tgrelid = 'public.editor_progress_month'::regclass) then
    create trigger editor_progress_logged after insert or update of edited on public.editor_progress_month
      for each row execute function private.editor_progress_logged();
  end if;
end $$;
