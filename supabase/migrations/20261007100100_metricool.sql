-- Metricool and the content Gantt (docs/ops.md, section 27). After
-- 20261007100000_gantt_roles_statuses.sql. Safe to run again; the switch is off.
--
-- The office keeps every client as a Brand in one Metricool account. The edge
-- function `metricool` reads each mapped brand's planner and marks the Gantt:
-- scheduled, posted, failed (app/metricool-logic.js decides, public.gantt_sync_apply
-- writes).
--
--   Vault                     'metricool_user_token' and 'metricool_user_id', created by
--                             the owner in the SQL editor. Only public.metricool_config()
--                             (service role) reads them; nothing returns them to a browser.
--   app_settings              'metricool_enabled': off until the owner turns it on, and
--                             it cannot be turned on while a secret is missing.
--   clients.metricool_blog_id the brand of the client (Metricool's blogId), with its
--                             name; set from the Gantt page by Ilai or the owner
--                             (public.gantt_set_brand).
--   client_gantt_sync         the last sync of each client: when, ok or a short error
--                             code, and counts. Never a token, never a post's text.

-- ── The switch ───────────────────────────────
alter table public.app_settings drop constraint if exists app_settings_key_check;
alter table public.app_settings add constraint app_settings_key_check check (key in ('whatsapp_enabled', 'metricool_enabled'));
insert into public.app_settings (key, value) values ('metricool_enabled', 'false') on conflict (key) do nothing;

-- Which of the two secrets are in Vault (never their values).
create or replace function private.metricool_secrets_present()
returns table (user_token boolean, user_id boolean)
language sql stable security definer set search_path = '' as $$
  select
    exists (select 1 from vault.decrypted_secrets where name = 'metricool_user_token' and length(btrim(decrypted_secret)) >= 10),
    exists (select 1 from vault.decrypted_secrets where name = 'metricool_user_id' and btrim(decrypted_secret) ~ '^[0-9]{1,12}$');
$$;
create or replace function private.metricool_enabled() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select value = 'true'::jsonb from public.app_settings where key = 'metricool_enabled'), false);
$$;

-- ── The brand of a client ────────────────────
alter table public.clients
  add column if not exists metricool_blog_id text,
  add column if not exists metricool_brand text;
alter table public.clients drop constraint if exists clients_metricool_check;
alter table public.clients add constraint clients_metricool_check check (
  (metricool_blog_id is null or metricool_blog_id ~ '^[0-9]{1,12}$')
  and (metricool_brand is null or length(metricool_brand) <= 120));
-- One brand, one client.
create unique index if not exists clients_metricool_blog_idx on public.clients (metricool_blog_id) where metricool_blog_id is not null;
-- Column grants (20260930210000_hardening.sql): a new column of clients is readable
-- only when granted here. Neither is the office's secret.
grant select (metricool_blog_id, metricool_brand) on public.clients to authenticated;

-- Ilai or the owner connects a client to its brand (null: disconnects). What the sync
-- set on the client's Gantt goes back to planned when the brand is taken away or changed.
create or replace function public.gantt_set_brand(p_client uuid, p_blog_id text, p_brand text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_blog text := nullif(btrim(coalesce(p_blog_id, '')), '');
  v_old text;
begin
  if not public.can_edit_gantt() then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_blog is not null and v_blog !~ '^[0-9]{1,12}$' then raise exception 'bad brand id' using errcode = '22023'; end if;
  select metricool_blog_id into v_old from public.clients where id = p_client and archived_at is null;
  if not found then raise exception 'client not found' using errcode = '22023'; end if;
  if v_blog is not null and exists (select 1 from public.clients where metricool_blog_id = v_blog and id <> p_client) then
    raise exception 'brand_taken: this brand is connected to another client' using errcode = 'P0001';
  end if;
  update public.clients set metricool_blog_id = v_blog,
    metricool_brand = case when v_blog is null then null else nullif(left(btrim(coalesce(p_brand, '')), 120), '') end
  where id = p_client;
  if v_old is distinct from v_blog then
    perform set_config('astrateg.gantt_sync', '1', true);
    delete from public.client_gantt where client_id = p_client and mc_extra and source = 'metricool';
    update public.client_gantt set
      state = case when source = 'metricool' and state in ('scheduled', 'error') then 'planned' else state end,
      mc_post_id = null, mc_status = null, mc_at = null, mc_networks = null, mc_error = null, mc_extra = false
    where client_id = p_client and (mc_post_id is not null or mc_status is not null or mc_extra);
    perform set_config('astrateg.gantt_sync', '', true);
    delete from public.client_gantt_sync where client_id = p_client;
  end if;
  return jsonb_build_object('blogId', v_blog, 'brand', (select metricool_brand from public.clients where id = p_client));
end $$;

-- ── The last sync of each client ─────────────
create table if not exists public.client_gantt_sync (
  client_id uuid primary key references public.clients (id) on delete cascade,
  at timestamptz not null default now(),
  ok boolean not null,
  error text check (error is null or length(error) <= 120),
  stats jsonb not null default '{}'::jsonb
);
alter table public.client_gantt_sync enable row level security;
drop policy if exists "gantt sync of own clients" on public.client_gantt_sync;
create policy "gantt sync of own clients" on public.client_gantt_sync
  for select to authenticated
  using ((select public.is_office()) or client_id in (select private.my_clients()));
-- An archived client is hidden everywhere (20261003140000_manager_features.sql).
drop policy if exists "archived clients are hidden" on public.client_gantt_sync;
create policy "archived clients are hidden" on public.client_gantt_sync
  as restrictive for all to authenticated
  using (client_id not in (select private.archived_client_ids()))
  with check (client_id not in (select private.archived_client_ids()));
revoke all on public.client_gantt_sync from anon, authenticated;
grant select on public.client_gantt_sync to authenticated;

-- ── The settings, for the team screen and the Gantt ──
-- The office: on or off, which secrets are in place (names only), how many clients are
-- connected and how their last sync went.
create or replace function public.metricool_settings() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when public.is_office() then jsonb_build_object(
    'enabled', private.metricool_enabled(),
    'owner', private.is_owner(),
    'canEdit', public.can_edit_gantt(),
    'secrets', (select to_jsonb(s) from private.metricool_secrets_present() s),
    'mapped', (select count(*) from public.clients c where c.metricool_blog_id is not null and c.status in ('active', 'ending') and c.archived_at is null),
    'synced', (select count(*) from public.client_gantt_sync s join public.clients c on c.id = s.client_id
               where s.ok and c.metricool_blog_id is not null and c.archived_at is null),
    'failed', (select count(*) from public.client_gantt_sync s join public.clients c on c.id = s.client_id
               where not s.ok and c.metricool_blog_id is not null and c.archived_at is null),
    'lastAt', (select max(s.at) from public.client_gantt_sync s),
    'lastError', (select s.error from public.client_gantt_sync s where not s.ok order by s.at desc limit 1))
  end;
$$;

-- On or off, by the owner only; on only when both secrets are in Vault.
create or replace function public.metricool_set_enabled(p_on boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s record;
begin
  if not private.is_owner() then raise exception 'not allowed: owner only' using errcode = '42501'; end if;
  select * into s from private.metricool_secrets_present();
  if p_on and not (s.user_token and s.user_id) then
    raise exception 'not_ready: Metricool secrets are missing in Vault' using errcode = 'P0001';
  end if;
  insert into public.app_settings (key, value, updated_at, updated_by_email)
  values ('metricool_enabled', to_jsonb(coalesce(p_on, false)), now(), lower(coalesce(auth.jwt() ->> 'email', '')))
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at, updated_by_email = excluded.updated_by_email;
  return public.metricool_settings();
end $$;

-- ── The function's own helpers (service role only) ──
-- The switch and the two secrets (null when one is missing or malformed).
create or replace function public.metricool_config()
returns table (enabled boolean, user_token text, user_id text)
language sql stable security definer set search_path = '' as $$
  select private.metricool_enabled() and s.user_token and s.user_id,
         case when s.user_token then (select btrim(decrypted_secret) from vault.decrypted_secrets where name = 'metricool_user_token' limit 1) end,
         case when s.user_id then (select btrim(decrypted_secret) from vault.decrypted_secrets where name = 'metricool_user_id' limit 1) end
  from private.metricool_secrets_present() s;
$$;

-- One client's sync, in one transaction: the changes app/metricool-logic.js worked out
-- and the line that says how it went. p_ops: { update: [{ id, fields }], insert: [row],
-- remove: [id] }; only the columns named here are ever written. A failed sync passes
-- no ops and p_ok = false with a short code.
create or replace function public.gantt_sync_apply(p_client uuid, p_ops jsonb, p_ok boolean, p_error text default null, p_stats jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  u jsonb;
  f jsonb;
  n_up integer := 0;
  n_in integer := 0;
  n_rm integer := 0;
  n integer;
begin
  perform set_config('astrateg.gantt_sync', '1', true);
  for u in select * from jsonb_array_elements(coalesce(p_ops -> 'update', '[]'::jsonb)) loop
    f := coalesce(u -> 'fields', '{}'::jsonb);
    update public.client_gantt g set
      state = case when f ? 'state' then f ->> 'state' else g.state end,
      source = case when f ? 'source' then f ->> 'source' else g.source end,
      posted_on = case when f ? 'posted_on' then (f ->> 'posted_on')::date else g.posted_on end,
      link = case when f ? 'link' then f ->> 'link' else g.link end,
      title = case when f ? 'title' then f ->> 'title' else g.title end,
      day = case when f ? 'day' then (f ->> 'day')::date else g.day end,
      time_il = case when f ? 'time_il' then (f ->> 'time_il')::time else g.time_il end,
      month = case when f ? 'month' then (f ->> 'month')::smallint else g.month end,
      edited = case when f ? 'edited' then (f ->> 'edited')::boolean else g.edited end,
      mc_post_id = case when f ? 'mc_post_id' then f ->> 'mc_post_id' else g.mc_post_id end,
      mc_status = case when f ? 'mc_status' then f ->> 'mc_status' else g.mc_status end,
      mc_at = case when f ? 'mc_at' then (f ->> 'mc_at')::timestamptz else g.mc_at end,
      mc_networks = case when f ? 'mc_networks' then
        (select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof(f -> 'mc_networks') = 'array' then f -> 'mc_networks' else '[]'::jsonb end) x)
        else g.mc_networks end,
      mc_error = case when f ? 'mc_error' then left(f ->> 'mc_error', 300) else g.mc_error end
    where g.id = (u ->> 'id')::uuid and g.client_id = p_client;
    get diagnostics n = row_count;
    n_up := n_up + n;
  end loop;
  for u in select * from jsonb_array_elements(coalesce(p_ops -> 'insert', '[]'::jsonb)) loop
    insert into public.client_gantt (client_id, key, kind, title, day, time_il, month, state, posted_on, link, edited, source,
      mc_post_id, mc_status, mc_at, mc_networks, mc_error, mc_extra)
    values (p_client, u ->> 'key', 'custom', left(u ->> 'title', 200), (u ->> 'day')::date, (u ->> 'time_il')::time, (u ->> 'month')::smallint,
      coalesce(u ->> 'state', 'planned'), (u ->> 'posted_on')::date, u ->> 'link', true, 'metricool',
      u ->> 'mc_post_id', u ->> 'mc_status', (u ->> 'mc_at')::timestamptz,
      (select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof(u -> 'mc_networks') = 'array' then u -> 'mc_networks' else '[]'::jsonb end) x),
      left(u ->> 'mc_error', 300), true)
    on conflict (client_id, key) do nothing;
    get diagnostics n = row_count;
    n_in := n_in + n;
  end loop;
  -- Only a row the sync itself added, and nobody touched since, is ever removed.
  delete from public.client_gantt g
  where g.client_id = p_client and g.mc_extra and g.source = 'metricool'
    and g.id in (select (x #>> '{}')::uuid from jsonb_array_elements(coalesce(p_ops -> 'remove', '[]'::jsonb)) x);
  get diagnostics n_rm = row_count;
  perform set_config('astrateg.gantt_sync', '', true);
  insert into public.client_gantt_sync (client_id, at, ok, error, stats)
  values (p_client, now(), coalesce(p_ok, false), left(p_error, 120), coalesce(p_stats, '{}'::jsonb))
  on conflict (client_id) do update set at = excluded.at, ok = excluded.ok, error = excluded.error,
    -- A failed run keeps the counts of the last good one next to its error.
    stats = case when excluded.ok then excluded.stats else public.client_gantt_sync.stats end;
  return jsonb_build_object('updated', n_up, 'inserted', n_in, 'removed', n_rm);
end $$;

revoke execute on function private.metricool_secrets_present() from public, anon, authenticated;
revoke execute on function private.metricool_enabled() from public, anon, authenticated;
revoke execute on function public.metricool_settings() from public, anon;
revoke execute on function public.metricool_set_enabled(boolean) from public, anon;
revoke execute on function public.gantt_set_brand(uuid, text, text) from public, anon;
revoke execute on function public.metricool_config() from public, anon, authenticated;
revoke execute on function public.gantt_sync_apply(uuid, jsonb, boolean, text, jsonb) from public, anon, authenticated;
grant execute on function public.metricool_settings() to authenticated;
grant execute on function public.metricool_set_enabled(boolean) to authenticated;
grant execute on function public.gantt_set_brand(uuid, text, text) to authenticated;
grant execute on function public.metricool_config() to service_role;
grant execute on function public.gantt_sync_apply(uuid, jsonb, boolean, text, jsonb) to service_role;
