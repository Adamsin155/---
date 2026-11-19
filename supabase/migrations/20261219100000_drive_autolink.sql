-- The clients' Drive folders found and connected by themselves (the owner, 19.11.2026;
-- docs/ops.md, section 143). The edge function `drive-link` lists the folders inside the main
-- clients folder every three hours in the day, asks Claude which folder is whose by MEANING
-- (the same name, or the same name in another language: "לאב מובייל" = "LAB MOBILE"; names that
-- only look alike, "נוריה" and "נורית", are different), and:
--   sure    → the card's Drive link is set, only while it is still empty, and noted as automatic;
--   unsure  → the possible folders are kept here, Irit and the owners are told once (the reminder
--             rule `driveAsk`), and Irit picks one in the card (public.drive_link_pick).
--   app_settings 'drive_clients_folder'   { "folder": "<folder id>" }: the main clients folder. Its
--                                         value is put by hand (not in this public file).
--   public.drive_link_state               one row per client the function decided something for.
--   public.drive_link_auto(...)           the service role's link (only into an empty link).
--   public.drive_link_pick(...)           the office's pick among the kept folders, or none.
--   public.drive_link_tick()              pg_cron, every three hours 05:17-17:17 UTC.
-- The file only adds, and can run again safely (tests/sql/drive-autolink.test.mjs).

alter table public.app_settings drop constraint if exists app_settings_key_check;
alter table public.app_settings add constraint app_settings_key_check
  check (key in ('whatsapp_enabled', 'metricool_enabled', 'drive_clients_folder'));

create table if not exists public.drive_link_state (
  client_id uuid primary key references public.clients (id) on delete cascade,
  status text not null check (status in ('auto', 'ask', 'picked', 'none')),
  folder_id text check (folder_id is null or folder_id ~ '^[A-Za-z0-9_-]{10,100}$'),
  folder_name text check (folder_name is null or char_length(folder_name) <= 200),
  -- [{ id, name }], the folders Irit chooses among (status 'ask'; kept after her answer).
  candidates jsonb not null default '[]'::jsonb
    check (jsonb_typeof(candidates) = 'array' and jsonb_array_length(candidates) <= 5 and length(candidates::text) <= 4000),
  -- The candidates' ids, sorted and joined: the same set is asked about once.
  ask_key text check (ask_key is null or char_length(ask_key) <= 600),
  updated_at timestamptz not null default now(),
  by_email text
);
alter table public.drive_link_state enable row level security;
drop policy if exists "office reads drive link state" on public.drive_link_state;
create policy "office reads drive link state" on public.drive_link_state
  for select to authenticated using (public.is_office());
revoke all on public.drive_link_state from anon, authenticated;
grant select on public.drive_link_state to authenticated;

-- The service role's link: into an empty Drive link only, never over one (a person's or an
-- earlier one). True when it was set.
create or replace function public.drive_link_auto(p_client uuid, p_folder text, p_name text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  if p_folder is null or p_folder !~ '^[A-Za-z0-9_-]{10,100}$' then return false; end if;
  update public.clients c
     set links = coalesce(c.links, '{}'::jsonb) || jsonb_build_object('drive', 'https://drive.google.com/drive/folders/' || p_folder)
   where c.id = p_client and coalesce(c.links ->> 'drive', '') = '';
  get diagnostics n = row_count;
  if n = 0 then return false; end if;
  insert into public.drive_link_state (client_id, status, folder_id, folder_name, updated_at, by_email)
  values (p_client, 'auto', p_folder, left(p_name, 200), now(), '')
  on conflict (client_id) do update set status = 'auto', folder_id = excluded.folder_id,
    folder_name = excluded.folder_name, updated_at = now(), by_email = '';
  return true;
end $$;
revoke execute on function public.drive_link_auto(uuid, text, text) from public, anon, authenticated;
grant execute on function public.drive_link_auto(uuid, text, text) to service_role;

-- The office picks one of the kept folders (or none) in the card: 'linked' | 'none' | 'kept'
-- (a link was put meanwhile: nothing changed) | 'taken' (another client has that folder).
create or replace function public.drive_link_pick(p_client uuid, p_folder text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  s public.drive_link_state;
  pick jsonb;
  n integer;
  who text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if not public.is_office() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into s from public.drive_link_state where client_id = p_client for update;
  if not found or s.status <> 'ask' then return 'kept'; end if;
  if p_folder is null then
    update public.drive_link_state set status = 'none', updated_at = now(), by_email = who where client_id = p_client;
    return 'none';
  end if;
  select e into pick from jsonb_array_elements(s.candidates) e where e ->> 'id' = p_folder limit 1;
  if pick is null then raise exception 'not one of the folders' using errcode = '22023'; end if;
  if exists (select 1 from public.clients c where c.id <> p_client
             and c.links ->> 'drive' ~ ('/folders/' || p_folder || '([/?#]|$)')) then
    return 'taken';
  end if;
  update public.clients c
     set links = coalesce(c.links, '{}'::jsonb) || jsonb_build_object('drive', 'https://drive.google.com/drive/folders/' || p_folder)
   where c.id = p_client and coalesce(c.links ->> 'drive', '') = '';
  get diagnostics n = row_count;
  if n = 0 then return 'kept'; end if;
  update public.drive_link_state set status = 'picked', folder_id = p_folder, folder_name = left(pick ->> 'name', 200),
    updated_at = now(), by_email = who where client_id = p_client;
  return 'linked';
end $$;
revoke execute on function public.drive_link_pick(uuid, text) from public, anon;
grant execute on function public.drive_link_pick(uuid, text) to authenticated;

create or replace function public.drive_link_tick() returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  secret text;
  request bigint;
begin
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'reminders_cron_secret' limit 1;
  if coalesce(secret, '') = '' then
    raise notice 'drive_link_tick: no reminders_cron_secret in Vault, nothing called';
    return null;
  end if;
  select net.http_post(
    url := 'https://czncjzziqrqtezpwxxpz.supabase.co/functions/v1/drive-link',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) into request;
  return request;
end $$;
revoke execute on function public.drive_link_tick() from public, anon, authenticated, service_role;

-- Every three hours, 05:17-17:17 UTC (07:17-20:17 in Israel). cron.schedule replaces a job of the same name.
select cron.schedule('drive-link', '17 5,8,11,14,17 * * *', 'select public.drive_link_tick()');
