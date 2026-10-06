-- The status of each login for the office's own work, without the vault flag.
--
-- Found in the live end-to-end run (6.10.2026): Ilai's card "יום אפיון: שעתיים" said
-- "אין עדיין רשתות בכספת" although the vault had rows, because staff.vault is false
-- for him and client_access is read only by vault users. Process 6 (the access
-- check, 30 minutes) is his, and its automatic "הגישות סומנו כנבדקו, לפי הסטטוסים
-- בכספת" reads the statuses.
--
-- access_status_for_work(clients) answers the office (the owner, Irit, Lior, Ofir,
-- Ilai: is_office()) with the client, the network, the label, the status and when
-- it was set. Never a user name, a note or a password: those stay behind the vault
-- flag, which only the owner switches on (the team page). Archived clients are
-- left out, as everywhere. Anyone else gets no rows.
--
-- After 20261003140000_manager_features.sql. Safe to run again; moves no data.

create or replace function public.access_status_for_work(p_clients uuid[] default null)
returns table (client_id uuid, network text, label text, status text, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.client_id, a.network, a.label, a.status, a.updated_at
  from public.client_access a
  join public.clients c on c.id = a.client_id and c.archived_at is null
  where (select public.is_office())
    and (p_clients is null or a.client_id = any (p_clients))
  order by a.client_id, a.created_at;
$$;
revoke execute on function public.access_status_for_work(uuid[]) from public, anon;
grant execute on function public.access_status_for_work(uuid[]) to authenticated;
