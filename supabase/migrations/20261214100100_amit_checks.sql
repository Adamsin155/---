-- WAITS FOR THE OWNER'S APPROVAL of a drop + add: run only after he approved this file.
--
-- Amit ('amit'), 15.11.2026: the second half of 20261214100000_amit.sql (docs/ops.md, section 132).
-- She does what Noam did, so every check that took Noam (supabase/pending/noam_checks.sql) takes her:
--   staff.person                  (her row on the team screen, so she can sign in),
--   reminder_log.person           (her notifications: push, WhatsApp, the morning digest),
--   client_tasks.owner            (a task on a client's card, "לפתוח ללקוח …" from the logins form),
--   client_status_notes.owner,
--   client_questions.to_person    (a question to the person in charge),
--   staff_tasks.created_by, staff_tasks.assignee   (a task one gives another, "נודניק"),
--   clients.characterizer         (Irit can pick her as the one who runs the meeting).
-- Postgres cannot widen a check in place: it is taken away by name and added again, wider. That is
-- the only kind of statement here that takes anything away (each followed at once by the wider
-- check, which keeps every value allowed before, live: Noam's and Shiel's too); no row and no column
-- is touched. The same kind of statement the owner approved before (noam_checks.sql,
-- 20261205100100_shiel_checks.sql).
-- The default characterizer of a new client stays Ofir (set in 20261214100000_amit.sql).
-- Safe to run again. Tested in tests/sql/amit.test.mjs.

alter table public.staff drop constraint if exists staff_person_check;
alter table public.staff add constraint staff_person_check
  check (person in ('irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli', 'noam', 'stav', 'amos', 'editor', 'shiel', 'amit', 'tal'));
alter table public.reminder_log drop constraint if exists reminder_log_person_check;
alter table public.reminder_log add constraint reminder_log_person_check
  check (person in ('owner', 'irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli', 'noam', 'stav', 'amos', 'amit', 'tal'));
alter table public.client_tasks drop constraint if exists client_tasks_owner_check;
alter table public.client_tasks add constraint client_tasks_owner_check
  check (owner in ('irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli', 'noam', 'amit'));
alter table public.client_status_notes drop constraint if exists client_status_notes_owner_check;
alter table public.client_status_notes add constraint client_status_notes_owner_check
  check (owner in ('irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli', 'noam', 'amit'));
alter table public.client_questions drop constraint if exists client_questions_to_person_check;
alter table public.client_questions add constraint client_questions_to_person_check
  check (to_person in ('irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli', 'noam', 'amit'));
alter table public.staff_tasks drop constraint if exists staff_tasks_created_by_check;
alter table public.staff_tasks add constraint staff_tasks_created_by_check
  check (created_by in ('owner', 'irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli', 'noam', 'stav', 'amos', 'amit'));
alter table public.staff_tasks drop constraint if exists staff_tasks_assignee_check;
alter table public.staff_tasks add constraint staff_tasks_assignee_check
  check (assignee in ('owner', 'irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli', 'noam', 'stav', 'amos', 'amit'));
alter table public.clients drop constraint if exists clients_characterizer_check;
alter table public.clients add constraint clients_characterizer_check
  check (characterizer in ('noam', 'ofir', 'lior', 'shiel', 'amit'));
