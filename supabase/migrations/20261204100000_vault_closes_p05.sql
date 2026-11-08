-- A working access in the vault closes process 5 by itself (the owner, 8.11.2026; docs/ops.md,
-- section 112). The client's logins form already closed "התקבלה גישה" (p05.access) and
-- "הגישות בכספת" (p05.vault) when it was sent; a login the office put in the vault did not,
-- so somebody had to tick it by hand, and Ofir's check of the access (6) waited for that tick.
--
-- Now: a row of public.client_access with the status 'ok' (a page linked through Meta Business
-- is 'ok' with `linked` on) marks both items, in the name of whoever saved it (the stamp of
-- protocol_checks). A mark already there (done or "לא רלוונטי") is kept as it is: its time,
-- its person and its words. A broken or missing access marks nothing.
--
-- Once, for what is in the vault already: every client with a working access whose items are
-- still open gets them now.
--
-- Only adds. Safe to run again.

create or replace function private.client_access_closes_p05() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'ok' then return new; end if;
  insert into public.protocol_checks (client_id, item_key, state, note)
  values (new.client_id, 'p05.access', 'done', left('גישה תקינה נכנסה לכספת (' || new.network || ')', 2000))
  on conflict (client_id, item_key) do nothing;
  insert into public.protocol_checks (client_id, item_key, state, note)
  values (new.client_id, 'p05.vault', 'done', 'הגישה בכספת')
  on conflict (client_id, item_key) do nothing;
  return new;
end $$;
revoke all on function private.client_access_closes_p05() from public, anon, authenticated;

drop trigger if exists client_access_closes_p05 on public.client_access;
create trigger client_access_closes_p05 after insert or update of status on public.client_access
  for each row execute function private.client_access_closes_p05();

-- Once: what is in the vault already.
insert into public.protocol_checks (client_id, item_key, state, note)
select distinct on (a.client_id) a.client_id, 'p05.access', 'done', left('גישה תקינה כבר הייתה בכספת (' || a.network || ')', 2000)
from public.client_access a where a.status = 'ok'
order by a.client_id, a.updated_at
on conflict (client_id, item_key) do nothing;
insert into public.protocol_checks (client_id, item_key, state, note)
select distinct a.client_id, 'p05.vault', 'done', 'הגישה בכספת'
from public.client_access a where a.status = 'ok'
on conflict (client_id, item_key) do nothing;
