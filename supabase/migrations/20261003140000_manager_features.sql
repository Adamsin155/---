-- The manager's features (docs/ops.md, section 19). Safe to run again; moves no data
-- except filling two new package quantities that were missing (5 below).
--   1. Managers: the owner (staff.person is null), Irit and Ofir (the owner's
--      decision). They switch between "המשימות שלי" and the manager profile (owner
--      screens 1–2 and the table), and they alone see the prices of the agreements in
--      the manager table. Lior sees everything else, never the money; everyone else
--      only what they must do (unchanged).
--   2. Screen 1 for Irit and Ofir: it already reads what the office reads; only the
--      login statuses (client_access) were behind the vault flag. A status overview
--      (client, network, status; never a user name or a password) for the managers.
--   3. Archive: the owner and Ofir only. An archived client is hidden from every list
--      and page (a restrictive policy on clients and on every table with a client_id),
--      its status-page link stops working, and its vault cannot be opened. Restoring
--      brings it all back. Permanent deletion only from the archive, with the business
--      name typed again; it removes the client and everything that belongs to it
--      (checks, history, tasks, messages, vault secrets, status links, files rows).
--      Storage objects are not removed here (docs/ops.md, section 19).
--   4. public.client_admin_log: who archived, restored or deleted which client and
--      when. It has no foreign key, so it outlives the client, and it keeps only the
--      business name (no phone, no personal details).
--   5. What a signed agreement grants: public.package_deliverables (called by
--      open_client_on_signing) now also stores the podcast packages' shoot day with a
--      photographer (photo_days) and "Simeon joins Natali's shoot" (simeon_join), and
--      the monthly photographer's contents follow the agreement's term. Existing
--      clients opened from an agreement get the two missing keys; nothing the office
--      typed is overwritten.
-- Tested in tests/sql/manager.test.mjs.

-- ── 1. Who is a manager ──────────────────────
create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff() and exists (
    select 1 from public.staff s
    where s.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (s.person is null or s.person in ('irit', 'ofir'))
  );
$$;

-- Archiving and deleting clients: the owner and Ofir.
create or replace function public.can_archive_clients() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff() and exists (
    select 1 from public.staff s
    where s.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (s.person is null or s.person = 'ofir')
  );
$$;
revoke execute on function public.is_manager() from public, anon;
revoke execute on function public.can_archive_clients() from public, anon;
grant execute on function public.is_manager() to authenticated;
grant execute on function public.can_archive_clients() to authenticated;

-- ── 3. Archive: the columns ──────────────────
alter table public.clients add column if not exists archived_at timestamptz;
alter table public.clients add column if not exists archived_by text;
-- Readable like the other columns (20260930210000_hardening.sql, section 1).
grant select (archived_at, archived_by) on public.clients to authenticated;
create index if not exists clients_archived_idx on public.clients (archived_at) where archived_at is not null;

-- Only archive_client() and restore_client() change them (they set this flag for
-- their own transaction); any other write keeps them as they were.
create or replace function public.clients_archive_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('astrateg.archiving', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.archived_at := null;
    new.archived_by := null;
  else
    new.archived_at := old.archived_at;
    new.archived_by := old.archived_by;
  end if;
  return new;
end $$;
revoke execute on function public.clients_archive_guard() from public, anon, authenticated;
drop trigger if exists clients_archive_guard on public.clients;
create trigger clients_archive_guard before insert or update on public.clients
for each row execute function public.clients_archive_guard();

create or replace function private.archived_client_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.clients c where c.archived_at is not null;
$$;
create or replace function private.is_archived(p_client uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.clients c where c.id = p_client and c.archived_at is not null);
$$;
revoke execute on function private.archived_client_ids() from public, anon;
revoke execute on function private.is_archived(uuid) from public, anon;
grant execute on function private.archived_client_ids() to authenticated;
grant execute on function private.is_archived(uuid) to authenticated;

-- ── 3. Archive: hidden everywhere ────────────
-- Restrictive policies are added to the permissive ones (AND): whoever could read or
-- write a row still can, unless its client is archived. For the office too.
drop policy if exists "archived clients are hidden" on public.clients;
create policy "archived clients are hidden" on public.clients
  as restrictive for all to authenticated
  using (archived_at is null) with check (archived_at is null);

-- Every table with a client_id (checks, history, tasks, messages, questions, the vault,
-- status links, surveys, notifications…). A table added later gets the same policy by
-- running this block again (or its own migration adds it).
do $$
declare t record;
begin
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'client_id' and c.table_name not in ('clients', 'client_admin_log')
  loop
    execute format('drop policy if exists %I on public.%I', 'archived clients are hidden', t.table_name);
    execute format('create policy %I on public.%I as restrictive for all to authenticated '
      || 'using (client_id is null or client_id not in (select private.archived_client_ids())) '
      || 'with check (client_id is null or client_id not in (select private.archived_client_ids()))',
      'archived clients are hidden', t.table_name);
  end loop;
end $$;

-- The one-client rules (20260930130000_assignment_rls.sql) say no for an archived
-- client, so the functions that check them (the vault, status links) say no too.
create or replace function public.can_see_client(p_client uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  with me as (select public.my_person() as p)
  select not private.is_archived(p_client) and (public.is_office() or (me.p is not null and (
    private.is_assigned(p_client)
    or exists (select 1 from public.client_tasks t where t.client_id = p_client and t.owner = me.p
      and (t.done_at is null or t.done_at > now() - interval '30 days'))
    or exists (select 1 from public.clients c where c.id = p_client and (
      (me.p = 'nirel' and c.shoot_type = 'natali')
      or (me.p = 'eli' and private.shoot_in_window(c.shoot_at, c.rounds)))))))
  from me;
$$;

create or replace function public.can_use_client_vault(p_client uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not private.is_archived(p_client)
    and public.can_use_vault() and (public.is_office() or private.is_assigned(p_client));
$$;

-- The office's three columns (20260930210000_hardening.sql): not for an archived client.
create or replace function public.clients_private(p_ids uuid[] default null)
returns table (id uuid, phone text, notes text, closed_reason text)
language sql stable security definer set search_path = '' as $$
  select c.id, c.phone, c.notes, c.closed_reason
  from public.clients c
  where (select public.is_office()) and c.archived_at is null and (p_ids is null or c.id = any (p_ids));
$$;

-- The status page (20260930170000_client_status.sql): an archived client's link
-- answers 'closed', like an ended client's, so approvals and surveys stop too.
create or replace function private.status_check(p_token text)
returns table (link_id uuid, client_id uuid, expires_at timestamptz, reason text)
language plpgsql stable security definer set search_path = '' as $$
declare
  l public.client_status_links;
  st text;
  gone boolean;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return query select null::uuid, null::uuid, null::timestamptz, 'invalid'::text; return;
  end if;
  select * into l from public.client_status_links s where s.token_hash = private.status_token_hash(p_token);
  if not found then
    return query select null::uuid, null::uuid, null::timestamptz, 'invalid'::text; return;
  end if;
  select c.status, c.archived_at is not null into st, gone from public.clients c where c.id = l.client_id;
  return query select l.id, l.client_id, l.expires_at,
    case when l.revoked_at is not null then 'revoked'
         when l.expires_at <= now() then 'expired'
         when st is null or gone or st not in ('active', 'ending') then 'closed'
         else null end;
end $$;

-- ── 2. Screen 1 for the managers: login statuses ──
create or replace function public.access_status_overview()
returns table (client_id uuid, network text, status text, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.client_id, a.network, a.status, a.updated_at
  from public.client_access a
  join public.clients c on c.id = a.client_id and c.archived_at is null
  where (select public.is_manager())
  order by a.client_id;
$$;
revoke execute on function public.access_status_overview() from public, anon;
grant execute on function public.access_status_overview() to authenticated;

-- ── 1. The prices, for the managers ──────────
-- From the signed agreement each client was opened from. Lior, Ilai and everyone
-- else get no rows.
create or replace function public.manager_client_finance()
returns table (client_id uuid, quote_number text, signed_at timestamptz, monthly_net_agorot integer,
  monthly_gross_agorot integer, term_gross_agorot integer, discount_agorot integer, term_months integer)
language sql stable security definer set search_path = '' as $$
  select c.id, q.number, q.signed_at,
    case when jsonb_typeof(q.model -> 'totals' -> 'monthlyNet') = 'number' then round((q.model -> 'totals' ->> 'monthlyNet')::numeric)::integer end,
    q.monthly_gross_agorot, q.term_gross_agorot,
    case when jsonb_typeof(q.model -> 'totals' -> 'discount') = 'number' then round((q.model -> 'totals' ->> 'discount')::numeric)::integer end,
    case when jsonb_typeof(q.model -> 'termMonths') = 'number' then round((q.model ->> 'termMonths')::numeric)::integer end
  from public.clients c
  join public.quotes q on q.id = c.quote_id
  where (select public.is_manager()) and c.archived_at is null;
$$;
revoke execute on function public.manager_client_finance() from public, anon;
grant execute on function public.manager_client_finance() to authenticated;

-- ── 4. Who archived, restored or deleted ─────
create table if not exists public.client_admin_log (
  id bigint generated always as identity primary key,
  client_id uuid not null,               -- no foreign key: the row outlives the client
  business text not null check (length(business) <= 200),
  action text not null check (action in ('archive', 'restore', 'purge')),
  by_email text not null,
  by_person text,
  at timestamptz not null default now(),
  detail jsonb not null default '{}'::jsonb  -- counts only (what a deletion removed)
);
create index if not exists client_admin_log_at_idx on public.client_admin_log (at desc);
alter table public.client_admin_log enable row level security;
drop policy if exists "archivers read the log" on public.client_admin_log;
create policy "archivers read the log" on public.client_admin_log
  for select to authenticated using ((select public.can_archive_clients()));
revoke all on public.client_admin_log from anon, authenticated;
grant select on public.client_admin_log to authenticated;

-- The name the office knows the client by: the business, or the client's name when
-- no business was entered. The archive, the confirmation and the log use it.
create or replace function private.client_label(p_business text, p_name text) returns text
language sql immutable set search_path = '' as $$
  select left(coalesce(nullif(btrim(p_business), ''), btrim(p_name), ''), 200);
$$;
-- Typed text compared as people see it: no direction marks, spaces collapsed.
create or replace function private.same_name(a text, b text) returns boolean
language sql immutable set search_path = '' as $$
  select lower(btrim(regexp_replace(regexp_replace(coalesce(a, ''), '[‎‏‪-‮⁦-⁩]', '', 'g'), '\s+', ' ', 'g')))
       = lower(btrim(regexp_replace(regexp_replace(coalesce(b, ''), '[‎‏‪-‮⁦-⁩]', '', 'g'), '\s+', ' ', 'g')))
     and btrim(coalesce(b, '')) <> '';
$$;

-- ── 3. Archive, restore, delete ──────────────
create or replace function public.archive_client(p_client uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  c public.clients;
begin
  if not public.can_archive_clients() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into c from public.clients where id = p_client for update;
  if not found then raise exception 'client not found' using errcode = 'P0002'; end if;
  if c.archived_at is null then
    perform set_config('astrateg.archiving', 'on', true);
    update public.clients set archived_at = now(), archived_by = me where id = p_client returning * into c;
    perform set_config('astrateg.archiving', '', true);
    insert into public.client_admin_log (client_id, business, action, by_email, by_person)
    values (c.id, private.client_label(c.business, c.name), 'archive', me, public.my_person());
  end if;
  return jsonb_build_object('id', c.id, 'archived_at', c.archived_at, 'archived_by', c.archived_by);
end $$;

create or replace function public.restore_client(p_client uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  c public.clients;
begin
  if not public.can_archive_clients() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into c from public.clients where id = p_client for update;
  if not found then raise exception 'client not found' using errcode = 'P0002'; end if;
  if c.archived_at is not null then
    perform set_config('astrateg.archiving', 'on', true);
    update public.clients set archived_at = null, archived_by = null where id = p_client returning * into c;
    perform set_config('astrateg.archiving', '', true);
    insert into public.client_admin_log (client_id, business, action, by_email, by_person)
    values (c.id, private.client_label(c.business, c.name), 'restore', me, public.my_person());
  end if;
  return jsonb_build_object('id', c.id, 'archived_at', null);
end $$;

-- The archive: the owner and Ofir.
create or replace function public.archived_clients()
returns table (id uuid, label text, name text, business text, package_name text, status text,
  deal_at timestamptz, contract_end date, archived_at timestamptz, archived_by text)
language sql stable security definer set search_path = '' as $$
  select c.id, private.client_label(c.business, c.name), c.name, c.business, c.package_name, c.status,
    c.deal_at, c.contract_end, c.archived_at, c.archived_by
  from public.clients c
  where (select public.can_archive_clients()) and c.archived_at is not null
  order by c.archived_at desc;
$$;

-- Permanent deletion: only an archived client, only with its name typed again.
-- Everything with its client_id goes (most of it would go by the foreign keys'
-- cascade; the rest, like notifications and change requests that keep a null, and
-- any table added later, is deleted here). The signed agreement (public.quotes) and
-- the client's consents stay: they are the sales record and the signature, not the
-- client's work. Files in Storage are not deleted here (docs/ops.md, section 19).
create or replace function public.purge_client(p_client uuid, p_confirm text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  c public.clients;
  lbl text;
  t record;
  n bigint;
  counts jsonb := '{}'::jsonb;
  secrets int;
begin
  if not public.can_archive_clients() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into c from public.clients where id = p_client for update;
  if not found then raise exception 'client not found' using errcode = 'P0002'; end if;
  if c.archived_at is null then raise exception 'archive the client first' using errcode = '22023'; end if;
  lbl := private.client_label(c.business, c.name);
  if not private.same_name(p_confirm, lbl) then raise exception 'the name does not match' using errcode = '22023'; end if;

  -- The vault's secrets: the logins and the status-page tokens.
  with s as (
    select a.secret_id from public.client_access a where a.client_id = p_client and a.secret_id is not null
    union
    select l.secret_id from public.client_status_links l where l.client_id = p_client and l.secret_id is not null
  ), d as (delete from vault.secrets v using s where v.id = s.secret_id returning 1)
  select count(*) into secrets from d;
  counts := counts || jsonb_build_object('vault_secrets', secrets);

  -- The checks first: clearing one writes a history row, which goes next.
  delete from public.protocol_checks where client_id = p_client;
  get diagnostics n = row_count;
  counts := counts || jsonb_build_object('protocol_checks', n);
  for t in
    select c2.table_name from information_schema.columns c2
    join information_schema.tables x on x.table_schema = c2.table_schema and x.table_name = c2.table_name and x.table_type = 'BASE TABLE'
    where c2.table_schema = 'public' and c2.column_name = 'client_id'
      and c2.table_name not in ('clients', 'client_admin_log', 'protocol_checks')
    order by (c2.table_name = 'protocol_log'), c2.table_name
  loop
    execute format('delete from public.%I where client_id = $1', t.table_name) using p_client;
    get diagnostics n = row_count;
    if n > 0 then counts := counts || jsonb_build_object(t.table_name, n); end if;
  end loop;
  -- Rows a trigger wrote while the rest went (the history of the cleared checks).
  delete from public.protocol_log where client_id = p_client;
  delete from public.clients where id = p_client;

  insert into public.client_admin_log (client_id, business, action, by_email, by_person, detail)
  values (p_client, lbl, 'purge', me, public.my_person(), counts);
  return jsonb_build_object('id', p_client, 'deleted', counts);
end $$;

revoke execute on function public.archive_client(uuid) from public, anon;
revoke execute on function public.restore_client(uuid) from public, anon;
revoke execute on function public.archived_clients() from public, anon;
revoke execute on function public.purge_client(uuid, text) from public, anon;
revoke execute on function private.client_label(text, text) from public, anon;
revoke execute on function private.same_name(text, text) from public, anon;
grant execute on function public.archive_client(uuid) to authenticated;
grant execute on function public.restore_client(uuid) to authenticated;
grant execute on function public.archived_clients() to authenticated;
grant execute on function public.purge_client(uuid, text) to authenticated;

-- ── 5. What a signed agreement grants ────────
-- As packageDeliverables() in app/protocol-logic.js (tests/sql/manager.test.mjs
-- compares the two for every package and add-on). New: photo_days (the podcast
-- packages' "יום צילום עם צלם בבית העסק"), simeon_join (the free "צירוף סמיון ליום
-- הצילום עם נטלי"), and the monthly photographer's 8 contents a month for the term.
create or replace function public.package_deliverables(model jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  with p as (
    select model -> 'package' ->> 'id' as id,
           coalesce(model -> 'selection' -> 'paid', '[]'::jsonb) as paid,
           coalesce(model -> 'selection' -> 'free', '{}'::jsonb) as free,
           case when jsonb_typeof(model -> 'termMonths') = 'number' then round((model ->> 'termMonths')::numeric)::int else 12 end as months
  ), s as (
    select p.*, v.videos, v.graphics, v.shoot_days, v.collabs, v.stories, v.ch14, v.photo_days
    from p join (values
      ('podcast-natali', 20, 20, 0, 0, 0, 0, 1),
      ('podcast-simeon', 20, 20, 0, 0, 0, 0, 1),
      ('social-simeon', 25, 35, 1, 1, 0, 0, 0),
      ('social-tv-simeon', 42, 42, 2, 3, 3, 1, 0),
      ('social-natali', 25, 35, 1, 0, 0, 0, 0),
      ('social-tv-natali', 42, 42, 1, 0, 0, 1, 0)
    ) as v (id, videos, graphics, shoot_days, collabs, stories, ch14, photo_days) on v.id = p.id
  )
  select coalesce((
    select jsonb_strip_nulls(jsonb_build_object(
      'videos', videos,
      'graphics', graphics + coalesce((free ->> 'graphics')::int, 0),
      'shoot_days', shoot_days + case when paid ? 'simeon-day' then 1 else 0 end,
      'collabs', collabs + case when paid ? 'natali-reel' then 1 else 0 end,
      'stories', stories + coalesce((free ->> 'simeonStories')::int, 0) + case when paid ? 'natali-story' then 1 else 0 end,
      'ch14', ch14 + case when coalesce((free ->> 'extraCh14')::boolean, false) then 1 else 0 end,
      'monthly', case when paid ? 'photographer' then 8 * months else 0 end,
      'photo_days', nullif(photo_days, 0),
      'simeon_join', case when coalesce((free ->> 'simeonJoin')::boolean, false) then 1 end))
    from s), '{}'::jsonb);
$$;

-- Clients already opened from an agreement: the two new keys, where the agreement
-- grants them and the client does not have them yet. What is there stays.
update public.clients c
set deliverables = jsonb_strip_nulls(jsonb_build_object(
    'photo_days', public.package_deliverables(q.model) -> 'photo_days',
    'simeon_join', public.package_deliverables(q.model) -> 'simeon_join')) || coalesce(c.deliverables, '{}'::jsonb)
from public.quotes q
where q.id = c.quote_id
  and ((public.package_deliverables(q.model) ? 'photo_days' and not coalesce(c.deliverables, '{}'::jsonb) ? 'photo_days')
    or (public.package_deliverables(q.model) ? 'simeon_join' and not coalesce(c.deliverables, '{}'::jsonb) ? 'simeon_join'));
