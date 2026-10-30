-- Claude accounts of the owners, Lior and Ofir (docs/ops.md, section 84).
--   public.mcp_access   who is switched on, by the staff row's email. Seeded on for the owners (a staff
--                       row with no person), Lior and Ofir, as they are in public.staff right now.
--   public.mcp_usage    who, which tool, ok or a short code, when. Never the arguments, never the answers.
--                       Only the service role writes (the mcp function); the owners read.
--   public.mcp_allowed()         the function and the consent page: is the person asking switched on?
--   public.mcp_people()          the owner's card: each person who may be on, on or off, last use.
--   public.mcp_set_access(…)     the owner's card: the switch.
-- The people here are a copy of MCP_PEOPLE in app/mcp-logic.js (tests/sql/mcp.test.mjs holds them equal).
-- The file only adds, and can run again safely: a person switched off stays off.

create table if not exists public.mcp_access (
  email text primary key,
  enabled boolean not null default false,
  updated_by text,
  updated_at timestamptz not null default now()
);

create table if not exists public.mcp_usage (
  id bigint generated always as identity primary key,
  email text not null check (char_length(email) <= 200),
  tool text not null check (char_length(tool) <= 64),
  code text not null check (char_length(code) <= 32),
  at timestamptz not null default now()
);
create index if not exists mcp_usage_email_at on public.mcp_usage (email, at desc);

alter table public.mcp_access enable row level security;
alter table public.mcp_usage enable row level security;
revoke all on table public.mcp_access from public, anon, authenticated;
revoke all on table public.mcp_usage from public, anon, authenticated;
grant select on table public.mcp_access to authenticated;
grant select on table public.mcp_usage to authenticated;
grant select on table public.mcp_access to service_role;
grant select, insert on table public.mcp_usage to service_role;

create or replace function private.mcp_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_owner();
$$;
revoke all on function private.mcp_owner() from public, anon;
grant execute on function private.mcp_owner() to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mcp_access' and policyname = 'mcp_access_owner_read') then
    create policy mcp_access_owner_read on public.mcp_access for select to authenticated using ((select private.mcp_owner()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mcp_usage' and policyname = 'mcp_usage_owner_read') then
    create policy mcp_usage_owner_read on public.mcp_usage for select to authenticated using ((select private.mcp_owner()));
  end if;
end $$;

insert into public.mcp_access (email, enabled, updated_by)
select s.email, true, 'seed' from public.staff s
where s.person is null or s.person in ('lior', 'ofir')
on conflict (email) do nothing;

-- Is the person asking (their own JWT) one of these, and switched on? Asked on every request.
create or replace function public.mcp_allowed() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff() and exists (
    select 1 from public.staff s
    join public.mcp_access a on a.email = s.email
    where s.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (s.person is null or s.person in ('lior', 'ofir'))
      and a.enabled);
$$;
revoke execute on function public.mcp_allowed() from public, anon;
grant execute on function public.mcp_allowed() to authenticated;

-- The owner's card. Nothing for anyone else (as public.calendar_feeds_team). Someone added to the
-- staff later shows here as off, until the owner switches them on.
create or replace function public.mcp_people()
returns table (email text, person text, enabled boolean, last_used timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.email, s.person, coalesce(a.enabled, false),
    (select max(u.at) from public.mcp_usage u where u.email = s.email and u.code = 'ok')
  from public.staff s
  left join public.mcp_access a on a.email = s.email
  where private.is_owner() and (s.person is null or s.person in ('lior', 'ofir'))
  order by s.person nulls first, s.email;
$$;
revoke execute on function public.mcp_people() from public, anon;
grant execute on function public.mcp_people() to authenticated;

-- The switch: the owners only, from the app itself. A token a connected app holds (it carries
-- client_id) never turns anyone on or off.
create or replace function public.mcp_set_access(p_email text, p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  who text := lower(coalesce(p_email, ''));
begin
  if not private.is_owner() or coalesce(auth.jwt() ->> 'client_id', '') <> '' then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_enabled is null or not exists (
    select 1 from public.staff s where s.email = who and (s.person is null or s.person in ('lior', 'ofir'))
  ) then
    raise exception 'not one of the people of this switch' using errcode = '22023';
  end if;
  insert into public.mcp_access (email, enabled, updated_by, updated_at)
  values (who, p_enabled, lower(coalesce(auth.jwt() ->> 'email', '')), now())
  on conflict (email) do update set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end $$;
revoke execute on function public.mcp_set_access(text, boolean) from public, anon;
grant execute on function public.mcp_set_access(text, boolean) to authenticated;

-- ── The gate: a connected app's token is good for the mcp function and nothing else ──
-- An OAuth token has the person's full rights at the REST API (Supabase: scopes do not limit the
-- database), so PostgREST asks public.mcp_request_gate() before every request:
--   - no client_id in the JWT (every browser session, the service role, anon): returns at once, reading
--     no table. That path is one text search and must never fail: the whole system goes through it;
--   - client_id: refused unless the request carries the key only the mcp function holds (a column list
--     cannot be seen from here, so a table on the list could otherwise be read with any columns), and
--     is GET or HEAD on a listed table, or POST on a listed rpc.
-- The lists are what the function and its tools really use (TABLES in supabase/functions/ask/tools.js,
-- GATE_RPCS in supabase/functions/mcp/handler.js; tests/sql/mcp-gate.test.mjs holds them equal).
-- The way back, in an emergency (docs/ops.md, section 84):
--   alter role authenticator reset pgrst.db_pre_request; notify pgrst, 'reload config';
create table if not exists private.mcp_gate (
  id boolean primary key default true check (id),
  key text not null default (gen_random_uuid()::text || gen_random_uuid()::text)
);
revoke all on table private.mcp_gate from public, anon, authenticated;
insert into private.mcp_gate (id) values (true) on conflict (id) do nothing;

-- The key, for the mcp function (the service role) alone.
create or replace function public.mcp_gate_key() returns text
language sql stable security definer set search_path = '' as $$
  select g.key from private.mcp_gate g where g.id;
$$;
revoke execute on function public.mcp_gate_key() from public, anon, authenticated;
grant execute on function public.mcp_gate_key() to service_role;

create or replace function public.mcp_request_gate() returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  claims text := current_setting('request.jwt.claims', true);
  client text;
  method text;
  path text;
  sent text;
begin
  -- Everyone but a connected app. Nothing above or on this line can raise.
  if claims is null or position('client_id' in claims) = 0 then
    return;
  end if;
  begin
    client := claims::jsonb ->> 'client_id';
    sent := nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-mcp-gate';
  exception when others then
    client := coalesce(client, '');
    sent := null;
  end;
  if coalesce(client, '') = '' then
    return;
  end if;
  method := coalesce(current_setting('request.method', true), '');
  path := coalesce(current_setting('request.path', true), '');
  if sent is not null
    and sent = (select g.key from private.mcp_gate g where g.id)
    and (
      (method in ('GET', 'HEAD') and path in (
        '/clients', '/client_tasks', '/staff_tasks', '/protocol_checks', '/editor_progress', '/editor_progress_month',
        '/client_gantt', '/deal_requests', '/quotes', '/client_files'))
      or (method = 'POST' and path in (
        '/rpc/is_office', '/rpc/my_person', '/rpc/mcp_allowed', '/rpc/sees_money'))
    ) then
    return;
  end if;
  raise exception 'not available to a connected app' using errcode = '42501';
end $$;
-- Every role PostgREST can become has to be able to run it, or nothing works.
grant execute on function public.mcp_request_gate() to public;

-- Storage is not behind PostgREST: its own rule, on top of the policies already there.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'no connected apps') then
    create policy "no connected apps" on storage.objects as restrictive for all to authenticated
      using (coalesce(auth.jwt() ->> 'client_id', '') = '')
      with check (coalesce(auth.jwt() ->> 'client_id', '') = '');
  end if;
end $$;

alter role authenticator set pgrst.db_pre_request = 'public.mcp_request_gate';
notify pgrst, 'reload config';
