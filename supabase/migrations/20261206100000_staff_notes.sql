-- "הערה מיוחדת" for one employee (Lior and the owner, 9.11.2026; docs/ops.md, section 114).
-- The owners, Irit, Lior and Ofir write a note to one person on the team ("לא לגעת בלקוח
-- מסעדת בוכרה"). It stays at the top of every page that person opens until one of them
-- deletes it; the person gets one push when it is written (the reminders' rule
-- `staffNote`, app/reminder-rules.js) and cannot remove it.
--   public.can_write_staff_notes()  who writes and deletes notes: the owners, Irit, Lior, Ofir.
--                                   ONE place (and WRITERS in app/staff-notes-logic.js).
--   public.staff_notes              one row per note. Deleting sets deleted_at (the history
--                                   stays): the note is gone for its person and for the screens.
--   public.staff_note_delete(id)    the only way to delete: a writer, stamped here.
-- Reading (row level security): the writers read every note; anyone else reads only their
-- own notes that were not deleted. Writing: the writers insert (person, body) only; who wrote
-- it and when are the table's defaults, never taken from the caller.
-- Only adds. Every statement can run again safely; nothing is dropped except this table's own
-- policies, each recreated in the next statement. Tested in tests/sql/staff-notes.test.mjs.

create or replace function public.can_write_staff_notes() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.reminder_person() in ('owner', 'irit', 'lior', 'ofir'), false);
$$;
revoke execute on function public.can_write_staff_notes() from public, anon;
grant execute on function public.can_write_staff_notes() to authenticated;

create table if not exists public.staff_notes (
  id uuid primary key default gen_random_uuid(),
  -- The person on the team the note is for (a key of PEOPLE in app/protocol.js, as
  -- public.staff.person and public.reminder_log.person). No list here: a new person on
  -- the team needs no change to this table.
  person text not null check (person ~ '^[a-z][a-z0-9_]{0,39}$'),
  body text not null check (length(btrim(body)) between 1 and 1000),
  created_by_email text default lower(auth.jwt() ->> 'email'),
  -- Who wrote it as a person key ('owner' for the owners), for the name on the note: the
  -- person reading it cannot always map an email to a name.
  created_by text default public.reminder_person(),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by_email text
);
create index if not exists staff_notes_person_idx on public.staff_notes (person) where deleted_at is null;
create index if not exists staff_notes_created_idx on public.staff_notes (created_at desc);

alter table public.staff_notes enable row level security;
drop policy if exists "staff notes: writers and their person read" on public.staff_notes;
create policy "staff notes: writers and their person read" on public.staff_notes
  for select to authenticated
  using (public.can_write_staff_notes()
         or (deleted_at is null and person = public.reminder_person()));
drop policy if exists "staff notes: writers write" on public.staff_notes;
create policy "staff notes: writers write" on public.staff_notes
  for insert to authenticated
  with check (public.can_write_staff_notes() and deleted_at is null and deleted_by_email is null
              and created_by_email = lower(coalesce(auth.jwt() ->> 'email', ''))
              and created_by = public.reminder_person());
-- The browser inserts only who it is for and what it says; no update, no delete (soft
-- delete: public.staff_note_delete).
revoke all on public.staff_notes from public, anon, authenticated;
grant select on public.staff_notes to authenticated;
grant insert (person, body) on public.staff_notes to authenticated;

-- Deletes a note: a writer, any note (the owners, Irit, Lior and Ofir decide together).
-- Deleting again changes nothing. The note's notification, if still unread in its
-- person's list, is marked read with it.
create or replace function public.staff_note_delete(p_id uuid) returns public.staff_notes
language plpgsql security definer set search_path = '' as $$
declare
  n public.staff_notes;
begin
  if not public.can_write_staff_notes() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into n from public.staff_notes where id = p_id for update;
  if not found then raise exception 'note not found' using errcode = 'P0002'; end if;
  if n.deleted_at is not null then return n; end if;
  update public.staff_notes set deleted_at = now(), deleted_by_email = lower(coalesce(auth.jwt() ->> 'email', ''))
  where id = p_id returning * into n;
  update public.reminder_log set read_at = now()
  where person = n.person and rule = 'staffNote' and read_at is null and key like 'staffNote:-:' || p_id::text || ':%';
  return n;
end $$;
revoke all on function public.staff_note_delete(uuid) from public, anon, authenticated;
grant execute on function public.staff_note_delete(uuid) to authenticated;
