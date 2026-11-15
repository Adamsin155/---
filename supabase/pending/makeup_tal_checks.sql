-- WAITING FOR THE OWNER'S APPROVAL. Not a migration yet: nothing runs this file.
--
-- Tal ('tal'), Natali's makeup artist, 15.11.2026: the second half of
-- supabase/migrations/20261213100000_makeup_tal.sql (docs/ops.md, section 132). Run it after that file.
--
-- 1. Two checks list the people a column may hold, and each has to take Tal:
--      staff.person          (her row on the team screen, so she can sign in),
--      reminder_log.person   (her notifications: a shoot day with Natali set, moved or cancelled).
--    Postgres cannot widen a check in place: it is taken away by name and added again, wider, at
--    once, keeping every value allowed before. No row and no column is touched. The same kind of
--    statement the owner approved before (noam_checks.sql, 20261205100100_shiel_checks.sql).
--    No other list takes her: she gets no task, note, question or client.
-- 2. private.makeup_unmark(day): when she answers "לא יכולה" after "מאשרת", the makeup marks SHE
--    wrote on that day's clients (their note starts "מאפרת: מגיעה לנטלי ב־") are taken off, so the item
--    is open again for Lior. A mark Lior made himself is never touched. Called only by
--    public.makeup_answer; nobody can call it from the browser. It is here and not in the migration
--    because it removes rows (one per item), which needs the owner's explicit approval.
-- Safe to run again. Tested in tests/sql/makeup-tal.test.mjs.

alter table public.staff drop constraint if exists staff_person_check;
alter table public.staff add constraint staff_person_check
  check (person in ('irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli', 'noam', 'stav', 'amos', 'editor', 'shiel', 'tal'));
alter table public.reminder_log drop constraint if exists reminder_log_person_check;
alter table public.reminder_log add constraint reminder_log_person_check
  check (person in ('owner', 'irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli', 'noam', 'stav', 'amos', 'tal'));

create or replace function private.makeup_unmark(p_day date) returns void
language sql security definer set search_path = '' as $$
  delete from public.protocol_checks k
  using private.natali_cases(p_day, p_day) n
  where k.client_id = n.client_id
    and k.item_key in ((case when n.round > 1 then 'r' || n.round || '.' else '' end) || 'p11b.makeup',
                       (case when n.round > 1 then 'r' || n.round || '.' else '' end) || 'p15.natali.makeup')
    and k.note like 'מאפרת: מגיעה לנטלי ב־%';
$$;
revoke all on function private.makeup_unmark(date) from public, anon, authenticated;
