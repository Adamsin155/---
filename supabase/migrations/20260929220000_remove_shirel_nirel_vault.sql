-- Protocol v3: Shirel is no longer part of the protocol. Nirel gets the vault
-- (she needs the client logins for graphics work).
alter table public.staff drop constraint staff_person_check;
alter table public.staff add constraint staff_person_check
  check (person in ('irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'editor'));

alter table public.clients drop constraint clients_characterizer_check;
alter table public.clients add constraint clients_characterizer_check
  check (characterizer in ('ofir', 'lior'));

alter table public.client_tasks drop constraint client_tasks_owner_check;
alter table public.client_tasks add constraint client_tasks_owner_check
  check (owner in ('irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna'));

alter table public.client_status_notes drop constraint if exists client_status_notes_owner_check;
alter table public.client_status_notes add constraint client_status_notes_owner_check
  check (owner in ('irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna'));

update public.staff set vault = true where person = 'nirel';
