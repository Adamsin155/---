-- Writing the shoot day's scripts (process 12) in the system (scripts.html), and a
-- read-only link to them for the influencers (scripts-view.html).
--
--   client_scripts       one row per script slot that was ever saved: client, shoot
--                        round, number (1..N; N is the package's video count), title,
--                        text, inspiration links (https only), status (draft / ready /
--                        approved) and a version that every save moves on, so two
--                        devices never overwrite each other silently.
--   script_grants        who else may write a client's scripts. Lior and the owner
--                        always may; Lior (or the owner) grants anyone on the staff,
--                        per client. Nobody else sees the scripts at all.
--   script_share_links   a secret link (like the status page's, 20260930170000): only
--                        a SHA-256 hash of the token in the table, the token itself in
--                        Vault so Lior and the owner can copy the link again; expiry
--                        (180 days), revocation (the token leaves Vault).
--
-- The page with the link is anonymous and reaches the database only through
-- get_scripts(token), which returns the client's name and the scripts that have a
-- title or text (with their status and links): no internal notes, no people, no dates.
-- The client approves the scripts as before, on the status page (approve_item marks
-- p13.approved); when p13.approved is marked (there, or by Lior), the scripts of that
-- shoot round that are "ready" become "approved" by themselves.
-- Only Lior and the owner mark a script "approved" by hand, or take it back.
-- Who and when are stamped here, never taken from the browser.
-- Every statement can run again safely. Tested in a real Postgres with every
-- migration: tests/sql/scripts.test.mjs.

-- ── Who ──────────────────────────────────────
-- Lior and the owner manage the scripts: grants, share links, "approved".
create or replace function public.can_manage_scripts() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff() and exists (
    select 1 from public.staff s
    where s.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (s.person is null or s.person = 'lior')
  );
$$;

create table if not exists public.script_grants (
  client_id uuid not null references public.clients (id) on delete cascade,
  person text not null check (person ~ '^[a-z]{2,20}$'),
  granted_by text not null default '',
  at timestamptz not null default now(),
  primary key (client_id, person)
);

-- The clients whose scripts were granted to the signed-in person (the set form, for
-- the policies: computed once per query).
create or replace function private.my_script_clients() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select g.client_id from public.script_grants g
  where public.my_person() is not null and g.person = public.my_person();
$$;

-- One client (the page asks before showing anything).
create or replace function public.can_write_scripts(p_client uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.can_manage_scripts() or (public.is_staff() and public.my_person() is not null and exists (
    select 1 from public.script_grants g where g.client_id = p_client and g.person = public.my_person()));
$$;

revoke execute on function public.can_manage_scripts() from public, anon;
revoke execute on function private.my_script_clients() from public, anon;
revoke execute on function public.can_write_scripts(uuid) from public, anon;
grant execute on function public.can_manage_scripts() to authenticated;
grant execute on function private.my_script_clients() to authenticated;
grant execute on function public.can_write_scripts(uuid) to authenticated;

-- ── The scripts ──────────────────────────────
create table if not exists public.client_scripts (
  client_id uuid not null references public.clients (id) on delete cascade,
  round integer not null default 1 check (round between 1 and 50),
  n integer not null check (n between 1 and 200),
  title text not null default '' check (char_length(title) <= 300),
  body text not null default '' check (char_length(body) <= 20000),
  links jsonb not null default '[]'::jsonb
    check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 10 and length(links::text) <= 6000),
  status text not null default 'draft' check (status in ('draft', 'ready', 'approved')),
  version integer not null default 1,
  by_email text not null default '',
  at timestamptz not null default now(),
  primary key (client_id, round, n)
);

-- Who saved and when, the version, the links (https addresses only), and "approved"
-- only by Lior or the owner. Runs as the caller (not security definer), so a write
-- made by the database itself (the approval below, from the status page) passes.
create or replace function public.client_scripts_stamp() returns trigger
language plpgsql set search_path = '' as $$
declare
  me text := coalesce(nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''), 'system');
  l jsonb;
begin
  if current_user in ('authenticated', 'anon') and not public.can_manage_scripts() and (
       (new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved'))
       or (tg_op = 'UPDATE' and old.status = 'approved' and new.status <> 'approved')) then
    raise exception 'only Lior or the owner approves a script' using errcode = '42501';
  end if;
  for l in select value from jsonb_array_elements(new.links) loop
    if jsonb_typeof(l) <> 'string' or char_length(l #>> '{}') > 500 or (l #>> '{}') !~ '^https?://[^\s"<>]+$' then
      raise exception 'invalid inspiration link' using errcode = '22023';
    end if;
  end loop;
  if tg_op = 'UPDATE' then
    new.client_id := old.client_id;
    new.round := old.round;
    new.n := old.n;
    new.version := old.version + 1;
  else
    new.version := 1;
  end if;
  new.by_email := me;
  new.at := now();
  return new;
end $$;
revoke execute on function public.client_scripts_stamp() from public, anon, authenticated;
drop trigger if exists client_scripts_stamp on public.client_scripts;
create trigger client_scripts_stamp before insert or update on public.client_scripts
for each row execute function public.client_scripts_stamp();

-- The client approved the scripts (process 13: p13.approved, or rN.p13.approved for
-- a shoot round), on the status page or marked by Lior: what was ready is approved.
create or replace function public.client_scripts_on_approval() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.state = 'done' and new.item_key ~ '^(r[0-9]{1,2}\.)?p13\.approved$'
     and (tg_op = 'INSERT' or old.state is distinct from 'done') then
    update public.client_scripts set status = 'approved'
    where client_id = new.client_id and status = 'ready'
      and round = coalesce(substring(new.item_key from '^r([0-9]{1,2})\.')::int, 1);
  end if;
  return null;
end $$;
revoke execute on function public.client_scripts_on_approval() from public, anon, authenticated;
drop trigger if exists client_scripts_on_approval on public.protocol_checks;
create trigger client_scripts_on_approval after insert or update on public.protocol_checks
for each row execute function public.client_scripts_on_approval();

-- ── The share link ───────────────────────────
create table if not exists public.script_share_links (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  secret_id uuid,
  created_at timestamptz not null default now(),
  created_by text not null default '',
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by text
);
create index if not exists script_share_links_client_idx on public.script_share_links (client_id, created_at desc);

-- A revoked link's token leaves Vault; a removed link (a client removed) too.
create or replace function public.script_share_links_forget() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.secret_id is not null then delete from vault.secrets where id = old.secret_id; end if;
    return old;
  end if;
  if new.revoked_at is not null and old.secret_id is not null then
    delete from vault.secrets where id = old.secret_id;
    new.secret_id := null;
  end if;
  return new;
end $$;
revoke execute on function public.script_share_links_forget() from public, anon, authenticated;
drop trigger if exists script_share_links_forget on public.script_share_links;
create trigger script_share_links_forget before update on public.script_share_links
for each row execute function public.script_share_links_forget();
drop trigger if exists script_share_links_cleanup on public.script_share_links;
create trigger script_share_links_cleanup after delete on public.script_share_links
for each row execute function public.script_share_links_forget();

-- ── Who reads and writes ─────────────────────
alter table public.script_grants enable row level security;
alter table public.client_scripts enable row level security;
alter table public.script_share_links enable row level security;

drop policy if exists "script grants: managers and the person" on public.script_grants;
create policy "script grants: managers and the person" on public.script_grants
  for select to authenticated using ((select public.can_manage_scripts()) or person = (select public.my_person()));

drop policy if exists "scripts: read" on public.client_scripts;
create policy "scripts: read" on public.client_scripts
  for select to authenticated using ((select public.can_manage_scripts()) or client_id in (select private.my_script_clients()));
drop policy if exists "scripts: add" on public.client_scripts;
create policy "scripts: add" on public.client_scripts
  for insert to authenticated with check ((select public.can_manage_scripts()) or client_id in (select private.my_script_clients()));
drop policy if exists "scripts: edit" on public.client_scripts;
create policy "scripts: edit" on public.client_scripts
  for update to authenticated
  using ((select public.can_manage_scripts()) or client_id in (select private.my_script_clients()))
  with check ((select public.can_manage_scripts()) or client_id in (select private.my_script_clients()));
drop policy if exists "scripts: remove (managers)" on public.client_scripts;
create policy "scripts: remove (managers)" on public.client_scripts
  for delete to authenticated using ((select public.can_manage_scripts()));

drop policy if exists "script links: managers read" on public.script_share_links;
create policy "script links: managers read" on public.script_share_links
  for select to authenticated using ((select public.can_manage_scripts()));

revoke all on public.script_grants, public.client_scripts, public.script_share_links from anon, authenticated;
grant select on public.script_grants to authenticated;
grant select, insert, update, delete on public.client_scripts to authenticated;
-- Not the hash nor the Vault id: the token is read through scripts_share_token().
grant select (id, client_id, created_at, created_by, expires_at, revoked_at, revoked_by) on public.script_share_links to authenticated;

-- ── The page's functions (signed in) ─────────
-- The client as the scripts page needs it, for whoever may write its scripts (null
-- for anyone else): a granted editor does not otherwise see the client.
create or replace function public.scripts_client(p_client uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'business', coalesce(nullif(btrim(c.business), ''), c.name), 'status', c.status,
    'shootType', c.shoot_type, 'charAt', c.char_at, 'shootAt', c.shoot_at,
    'videos', case when coalesce(c.deliverables ->> 'videos', '') ~ '^[0-9]{1,3}$' then (c.deliverables ->> 'videos')::int end,
    'rounds', coalesce((select jsonb_agg((r ->> 'n')::int order by (r ->> 'n')::int) from jsonb_array_elements(c.rounds) r
                        where (r ->> 'n') ~ '^[0-9]{1,2}$' and (r ->> 'n')::int between 2 and 50), '[]'::jsonb),
    'manage', public.can_manage_scripts())
  from public.clients c
  where c.id = p_client and public.can_write_scripts(p_client);
$$;

-- Grant or take back one person's access to one client's scripts.
create or replace function public.scripts_grant(p_client uuid, p_person text, p_on boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_manage_scripts() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_on then
    if p_person is null or p_person = 'lior' or not exists (select 1 from public.staff s where s.person = p_person) then
      raise exception 'unknown person' using errcode = '22023';
    end if;
    if not exists (select 1 from public.clients where id = p_client) then raise exception 'unknown client' using errcode = '22023'; end if;
    insert into public.script_grants (client_id, person, granted_by)
    values (p_client, p_person, lower(coalesce(auth.jwt() ->> 'email', '')))
    on conflict (client_id, person) do nothing;
  else
    delete from public.script_grants where client_id = p_client and person = p_person;
  end if;
end $$;

-- A new share link (the one before it stops working). Returns the token once;
-- scripts_share_token() gives it again to Lior and the owner.
create or replace function public.scripts_share_create(p_client uuid, p_days integer default 180) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_token text;
  v_id uuid := gen_random_uuid();
  v_secret uuid;
  v_exp timestamptz := now() + make_interval(days => least(greatest(coalesce(p_days, 180), 1), 365));
begin
  if not public.can_manage_scripts() then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.clients where id = p_client and status in ('active', 'ending')) then
    raise exception 'client not open' using errcode = '22023';
  end if;
  update public.script_share_links set revoked_at = now(), revoked_by = me
  where client_id = p_client and revoked_at is null;
  v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  v_secret := vault.create_secret(v_token, 'scripts_link:' || v_id::text, 'scripts share link');
  insert into public.script_share_links (id, client_id, token_hash, secret_id, created_by, expires_at)
  values (v_id, p_client, private.status_token_hash(v_token), v_secret, me, v_exp);
  return jsonb_build_object('id', v_id, 'token', v_token, 'expiresAt', v_exp);
end $$;

create or replace function public.scripts_share_token(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_secret uuid;
  v_token text;
begin
  if not public.can_manage_scripts() then raise exception 'not allowed' using errcode = '42501'; end if;
  select secret_id into v_secret from public.script_share_links
  where id = p_id and revoked_at is null and expires_at > now();
  if v_secret is null then return null; end if;
  select decrypted_secret into v_token from vault.decrypted_secrets where id = v_secret;
  return v_token;
end $$;

create or replace function public.scripts_share_revoke(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_manage_scripts() then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.script_share_links set revoked_at = now(), revoked_by = lower(coalesce(auth.jwt() ->> 'email', ''))
  where id = p_id and revoked_at is null;
end $$;

-- ── The read-only page (anonymous, by token) ──
-- { state: 'ok', preview, client: { name, business }, scripts: [...] }, or
-- { state: 'invalid' | 'revoked' | 'expired' | 'closed' }.
create or replace function public.get_scripts(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  l public.script_share_links;
  c public.clients;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then return jsonb_build_object('state', 'invalid'); end if;
  select * into l from public.script_share_links s where s.token_hash = private.status_token_hash(p_token);
  if not found then return jsonb_build_object('state', 'invalid'); end if;
  if l.revoked_at is not null then return jsonb_build_object('state', 'revoked'); end if;
  if l.expires_at <= now() then return jsonb_build_object('state', 'expired'); end if;
  select * into c from public.clients where id = l.client_id;
  if not found or c.status not in ('active', 'ending') then return jsonb_build_object('state', 'closed'); end if;
  return jsonb_build_object(
    'state', 'ok',
    'preview', public.is_staff(),
    'expiresAt', l.expires_at,
    'client', jsonb_build_object('name', c.name, 'business', coalesce(nullif(btrim(c.business), ''), c.name)),
    'scripts', coalesce((select jsonb_agg(jsonb_build_object('round', s.round, 'n', s.n, 'title', s.title, 'body', s.body,
                          'links', (select coalesce(jsonb_agg(x.value), '[]'::jsonb) from jsonb_array_elements(s.links) x
                                    where jsonb_typeof(x.value) = 'string' and (x.value #>> '{}') ~ '^https?://[^\s"<>]+$'),
                          'status', s.status, 'at', s.at) order by s.round, s.n)
                         from public.client_scripts s
                         where s.client_id = c.id and (btrim(s.title) <> '' or btrim(s.body) <> '')), '[]'::jsonb));
end $$;

-- ── Grants ───────────────────────────────────
revoke all on function public.scripts_client(uuid) from public, anon;
revoke all on function public.scripts_grant(uuid, text, boolean) from public, anon;
revoke all on function public.scripts_share_create(uuid, integer) from public, anon;
revoke all on function public.scripts_share_token(uuid) from public, anon;
revoke all on function public.scripts_share_revoke(uuid) from public, anon;
grant execute on function public.scripts_client(uuid) to authenticated;
grant execute on function public.scripts_grant(uuid, text, boolean) to authenticated;
grant execute on function public.scripts_share_create(uuid, integer) to authenticated;
grant execute on function public.scripts_share_token(uuid) to authenticated;
grant execute on function public.scripts_share_revoke(uuid) to authenticated;
revoke all on function public.get_scripts(text) from public;
grant execute on function public.get_scripts(text) to anon, authenticated;
