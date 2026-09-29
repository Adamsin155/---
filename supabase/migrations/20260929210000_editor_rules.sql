-- Nirel edits only Natali Dadon's clients; task sources for paused editing and
-- Irit's check after the weekly call.
alter table public.clients add constraint clients_nirel_natali_check
  check (editor is distinct from 'nirel' or shoot_type = 'natali');
alter table public.client_tasks drop constraint client_tasks_source_check;
alter table public.client_tasks add constraint client_tasks_source_check
  check (source is null or source in ('p31', 'p33', 'escalation', 'status', 'pause', 'followup'));
