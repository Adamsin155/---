-- WAITS FOR THE OWNER'S APPROVAL of a drop + add: run only after he approved this file.
--
-- Shiel ('shiel'), 9.11.2026: the second half of 20261205100000_shiel.sql (docs/ops.md, section
-- 113). Two checks list the people (or the characterizers) a column may hold, and each has to take
-- Shiel:
--   staff.person            (his row on the team screen, so he can sign in),
--   clients.characterizer   (Irit can pick him as the one who runs the meeting).
-- Postgres cannot widen a check in place: it is taken away by name and added again, wider. That is
-- the only kind of statement here that takes anything away (each followed at once by the wider
-- check, which keeps every value allowed before); no row and no column is touched. The same kind of
-- statement the owner approved before (supabase/pending/noam_checks.sql for Noam).
-- No other list takes him (reminder_log, client_tasks, client_status_notes, client_questions,
-- staff_tasks): he gets no notification and no task (app/protocol.js SILENT_PEOPLE).
-- The default characterizer of a new client stays Noam.
-- Safe to run again. Tested in tests/sql/shiel.test.mjs.

alter table public.staff drop constraint if exists staff_person_check;
alter table public.staff add constraint staff_person_check
  check (person in ('irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli', 'noam', 'stav', 'amos', 'editor', 'shiel'));

alter table public.clients drop constraint if exists clients_characterizer_check;
alter table public.clients add constraint clients_characterizer_check
  check (characterizer in ('noam', 'ofir', 'lior', 'shiel'));
