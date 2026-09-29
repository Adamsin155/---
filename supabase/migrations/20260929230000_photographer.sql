-- Protocol v4: the photographer (Eli) has his own shoot-day processes (17ב,
-- 18ב, 19ב). He does not use the access vault.
alter table public.staff drop constraint staff_person_check;
alter table public.staff add constraint staff_person_check
  check (person in ('irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli', 'editor'));

alter table public.client_tasks drop constraint client_tasks_owner_check;
alter table public.client_tasks add constraint client_tasks_owner_check
  check (owner in ('irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli'));

alter table public.client_status_notes drop constraint client_status_notes_owner_check;
alter table public.client_status_notes add constraint client_status_notes_owner_check
  check (owner in ('irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli'));
