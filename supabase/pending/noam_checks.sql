-- WAITING FOR THE OWNER'S APPROVAL. Not a migration yet: nothing runs this file.
--
-- Noam ('noam'), 1.11.2026: the second half of supabase/migrations/20261123100000_noam.sql.
-- Seven checks list the people (or the characterizers) a column may hold, and each has to take
-- Noam:
--   staff.person, reminder_log.person, client_tasks.owner, client_status_notes.owner,
--   client_questions.to_person, staff_tasks.created_by, staff_tasks.assignee,
--   clients.characterizer ('noam', 'ofir', 'lior').
-- Postgres cannot widen a check in place: it is taken away by name and added again, wider.
-- That is the only kind of statement here that takes anything away (each followed at once by
-- the wider check, which keeps every value allowed before); no row and no column is touched. The
-- same kind of statement the owner approved before (20261005100000_sales_amos.sql for Amos).
--
-- Once approved: run it in the SQL editor after 20261123100000_noam.sql (or move it to
-- supabase/migrations/20261123100100_noam_checks.sql with the approval noted in its header).
-- Safe to run again. Tested in tests/sql/noam.test.mjs.
-- Until it runs: Noam's row cannot be added on the team screen, nobody can pick him as the
-- characterizer, and a new client is still Ofir's by default (the database's default; the default
-- becomes Noam here, after the check that allows him).

alter table public.staff drop constraint if exists staff_person_check;
alter table public.staff add constraint staff_person_check
  check (person in ('irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli', 'noam', 'stav', 'amos', 'editor'));
alter table public.reminder_log drop constraint if exists reminder_log_person_check;
alter table public.reminder_log add constraint reminder_log_person_check
  check (person in ('owner', 'irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli', 'noam', 'stav', 'amos'));
alter table public.client_tasks drop constraint if exists client_tasks_owner_check;
alter table public.client_tasks add constraint client_tasks_owner_check
  check (owner in ('irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli', 'noam'));
alter table public.client_status_notes drop constraint if exists client_status_notes_owner_check;
alter table public.client_status_notes add constraint client_status_notes_owner_check
  check (owner in ('irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli', 'noam'));
-- A question to the person in charge (client_questions) and a task one gives another (staff_tasks).
alter table public.client_questions drop constraint if exists client_questions_to_person_check;
alter table public.client_questions add constraint client_questions_to_person_check
  check (to_person in ('irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli', 'noam'));
alter table public.staff_tasks drop constraint if exists staff_tasks_created_by_check;
alter table public.staff_tasks add constraint staff_tasks_created_by_check
  check (created_by in ('owner', 'irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli', 'noam', 'stav', 'amos'));
alter table public.staff_tasks drop constraint if exists staff_tasks_assignee_check;
alter table public.staff_tasks add constraint staff_tasks_assignee_check
  check (assignee in ('owner', 'irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli', 'noam', 'stav', 'amos'));
alter table public.clients drop constraint if exists clients_characterizer_check;
alter table public.clients add constraint clients_characterizer_check
  check (characterizer in ('noam', 'ofir', 'lior'));

-- A new client is Noam's to characterize (Ofir's since 20261003100000_sales_deals.sql). The clients
-- that exist keep whom they have.
alter table public.clients alter column characterizer set default 'noam';
