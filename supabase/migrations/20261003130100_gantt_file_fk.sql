-- The content Gantt's file (client_gantt.file_id) becomes a real foreign key to
-- public.client_files (20261003110000_client_files.sql), now that the table exists.
-- A file row removed (only the SQL editor removes one; the app soft-deletes) leaves
-- the entry without its file (on delete set null). client_gantt_rules still checks
-- the file is of the same client.
-- Safe to run again; does nothing when public.client_files is not there.
do $$
begin
  if to_regclass('public.client_files') is null or to_regclass('public.client_gantt') is null then return; end if;
  if exists (select 1 from pg_constraint where conname = 'client_gantt_file_id_fkey' and conrelid = 'public.client_gantt'::regclass) then return; end if;
  -- An id that points at nothing (written before the key) is cleared first.
  update public.client_gantt g set file_id = null
  where g.file_id is not null and not exists (select 1 from public.client_files f where f.id = g.file_id);
  alter table public.client_gantt add constraint client_gantt_file_id_fkey
    foreign key (file_id) references public.client_files (id) on delete set null;
end $$;
create index if not exists client_gantt_file_idx on public.client_gantt (file_id) where file_id is not null;
