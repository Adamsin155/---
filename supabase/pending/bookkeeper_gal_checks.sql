-- WAITING FOR THE OWNER'S APPROVAL. Not a migration yet: nothing runs this file.
--
-- Gal ('gal'), the office's bookkeeper, 16.11.2026: the second half of
-- supabase/migrations/20261215100000_bookkeeper_gal.sql (docs/ops.md, section 137). Run it after that file.
--
-- One check lists the people a column may hold, and it has to take Gal:
--   staff.person   (her row on the team screen, so she can sign in).
-- Postgres cannot widen a check in place: it is taken away by name and added again, wider, at once,
-- keeping every value allowed before (the list of 20261214100100_amit_checks.sql). No row and no
-- column is touched. The same kind of statement the owner approved before (noam_checks.sql,
-- makeup_tal_checks.sql, 20261214100100_amit_checks.sql).
-- No other list takes her: she gets no notification, task, note, question or client.
-- Safe to run again. Tested in tests/sql/bookkeeper-gal.test.mjs.

alter table public.staff drop constraint if exists staff_person_check;
alter table public.staff add constraint staff_person_check
  check (person in ('irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli', 'noam', 'stav', 'amos', 'editor', 'shiel', 'amit', 'tal', 'gal'));
