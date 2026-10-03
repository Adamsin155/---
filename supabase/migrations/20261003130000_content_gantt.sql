-- The yearly content Gantt per client (gantt.html; app/gantt-template.js,
-- app/gantt-logic.js). One fixed template, relative to the contract (month n of the
-- package, the nth weekday, a business day, a time of day), becomes each client's
-- dated plan in the browser; the plan is stored here so a date can be moved for one
-- client without touching the template, and so what went up, and its link, is kept.
--
--   client_gantt         one row per entry: the template's key ('video.7', 'report.3',
--                        'monthly.4.2', 'end'; custom entries 'custom.<n>'), its Israel
--                        day and wall-clock time, kind, title, planned / posted /
--                        skipped, the day it went up, a link and a file
--                        (public.client_files.id, no foreign key: that table comes with
--                        the files' migration), a note, and whether the date was moved
--                        by hand (edited), which "update from the template" keeps
--                        unless that is confirmed.
--   client_gantt_links   a read-only link for the client, like the status page's
--                        (20260930170000_client_status.sql): only a SHA-256 hash of the
--                        token here, the token itself encrypted in Vault so the office
--                        can copy it again; expiry, revocation, who created it.
--
-- Who: the office (the owner, Irit, Lior, Ofir and Ilai, who owns the Gantt: processes
-- 9, 28 and 29) reads and writes; whoever else sees the client (its editor, Nirel on a
-- Natali client, Eli around a shoot, a task's owner: private.my_clients()) reads.
-- The client's link reaches the rows only through public.get_gantt(token), which
-- returns no internal entry (Ilai's plan, the renewal call), no note and no file path.
-- Who and when are stamped here (public.protocol_stamp). Safe to run again.

-- ── The plan ─────────────────────────────────
create table if not exists public.client_gantt (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  key text not null check (length(key) <= 40 and key ~ '^[a-z][a-z0-9]*(\.[0-9]{1,13}){0,2}$'),
  kind text not null check (kind in ('video', 'graphic', 'monthly', 'highlight', 'story', 'collab', 'ch14',
                                     'shoot', 'photo', 'report', 'plan', 'renewal', 'end', 'custom')),
  title text not null check (length(btrim(title)) between 1 and 200),
  day date not null check (day between date '2020-01-01' and date '2040-12-31'),
  time_il time,
  month smallint check (month is null or month between 0 and 121),
  num smallint check (num is null or num between 1 and 999),
  internal boolean not null default false,
  state text not null default 'planned' check (state in ('planned', 'posted', 'skipped')),
  posted_on date,
  file_id uuid,
  link text check (link is null or (length(link) <= 2000 and link ~ '^https://[^\s"<>]+$')),
  note text check (note is null or length(note) <= 500),
  edited boolean not null default false,
  template_version smallint not null default 1 check (template_version between 1 and 1000),
  created_at timestamptz not null default now(),
  by_email text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  at timestamptz not null default now(),
  unique (client_id, key)
);
create index if not exists client_gantt_client_day_idx on public.client_gantt (client_id, day);

drop trigger if exists client_gantt_stamp on public.client_gantt;
create trigger client_gantt_stamp before insert or update on public.client_gantt
for each row execute function public.protocol_stamp();

-- The database's own rules for a row, whatever the browser sent:
--  - Ilai's plan and the renewal call are internal (never on the client's link);
--  - a posted entry has the day it went up (today in Israel when none was given), and
--    one that is not posted has none;
--  - a file must be one of this client's (when public.client_files is there).
create or replace function public.client_gantt_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
declare ok boolean;
begin
  new.internal := new.internal or new.kind in ('plan', 'renewal');
  if new.state = 'posted' then
    new.posted_on := coalesce(new.posted_on, (now() at time zone 'Asia/Jerusalem')::date);
  else
    new.posted_on := null;
  end if;
  if new.file_id is not null and to_regclass('public.client_files') is not null then
    execute 'select exists (select 1 from public.client_files f where f.id = $1 and f.client_id = $2)'
      into ok using new.file_id, new.client_id;
    if not ok then raise exception 'file not of this client' using errcode = '23503'; end if;
  end if;
  return new;
end $$;
revoke execute on function public.client_gantt_rules() from public, anon, authenticated;
drop trigger if exists client_gantt_rules on public.client_gantt;
create trigger client_gantt_rules before insert or update on public.client_gantt
for each row execute function public.client_gantt_rules();

alter table public.client_gantt enable row level security;
drop policy if exists "gantt of own clients" on public.client_gantt;
drop policy if exists "office adds gantt entries" on public.client_gantt;
drop policy if exists "office changes gantt entries" on public.client_gantt;
drop policy if exists "office removes gantt entries" on public.client_gantt;
create policy "gantt of own clients" on public.client_gantt
  for select to authenticated
  using ((select public.is_office()) or client_id in (select private.my_clients()));
create policy "office adds gantt entries" on public.client_gantt
  for insert to authenticated with check ((select public.is_office()));
create policy "office changes gantt entries" on public.client_gantt
  for update to authenticated using ((select public.is_office())) with check ((select public.is_office()));
create policy "office removes gantt entries" on public.client_gantt
  for delete to authenticated using ((select public.is_office()));
revoke all on public.client_gantt from anon;
revoke truncate on public.client_gantt from authenticated;
grant select, insert, update, delete on public.client_gantt to authenticated;

-- ── The client's read-only link ──────────────
create table if not exists public.client_gantt_links (
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
create index if not exists client_gantt_links_client_idx on public.client_gantt_links (client_id, created_at desc);
alter table public.client_gantt_links enable row level security;
drop policy if exists "office reads gantt links" on public.client_gantt_links;
create policy "office reads gantt links" on public.client_gantt_links
  for select to authenticated using ((select public.is_office()));
revoke all on public.client_gantt_links from anon, authenticated;
-- Not the hash nor the Vault id: the token is read through gantt_link_token().
grant select (id, client_id, created_at, created_by, expires_at, revoked_at, revoked_by) on public.client_gantt_links to authenticated;

-- A revoked link's token leaves Vault; a removed link takes its token with it.
create or replace function public.client_gantt_links_forget() returns trigger
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
revoke execute on function public.client_gantt_links_forget() from public, anon, authenticated;
drop trigger if exists client_gantt_links_forget on public.client_gantt_links;
create trigger client_gantt_links_forget before update on public.client_gantt_links
for each row execute function public.client_gantt_links_forget();
drop trigger if exists client_gantt_links_cleanup on public.client_gantt_links;
create trigger client_gantt_links_cleanup after delete on public.client_gantt_links
for each row execute function public.client_gantt_links_forget();

-- The link a token opens, and why not: 'invalid', 'revoked', 'expired' or 'closed'.
create or replace function private.gantt_check(p_token text)
returns table (link_id uuid, client_id uuid, expires_at timestamptz, reason text)
language plpgsql stable security definer set search_path = '' as $$
declare
  l public.client_gantt_links;
  st text;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return query select null::uuid, null::uuid, null::timestamptz, 'invalid'::text; return;
  end if;
  select * into l from public.client_gantt_links g
  where g.token_hash = encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex');
  if not found then
    return query select null::uuid, null::uuid, null::timestamptz, 'invalid'::text; return;
  end if;
  select c.status into st from public.clients c where c.id = l.client_id;
  return query select l.id, l.client_id, l.expires_at,
    case when l.revoked_at is not null then 'revoked'
         when l.expires_at <= now() then 'expired'
         when st is null or st not in ('active', 'ending') then 'closed'
         else null end;
end $$;
revoke all on function private.gantt_check(text) from public, anon, authenticated;

-- The page (anonymous, by token): the client's name and contract, and the entries
-- the client may see. Never: internal entries, notes, who changed what, file paths.
create or replace function public.get_gantt(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  l record;
  c public.clients;
  files jsonb := '{}'::jsonb;
begin
  select * into l from private.gantt_check(p_token);
  if l.reason is not null then
    return jsonb_build_object('state', l.reason);
  end if;
  select * into c from public.clients where id = l.client_id;
  -- The files' links (public.client_files, when that table is there): only an https
  -- link the office gave the file, never its storage path.
  if to_regclass('public.client_files') is not null then
    execute $q$
      select coalesce(jsonb_object_agg(f.id::text, jsonb_build_object(
               'link', case when coalesce(f.link, '') ~ '^https://[^\s"<>]+$' then f.link end,
               'postedOn', f.posted_on)), '{}'::jsonb)
      from public.client_files f
      where f.client_id = $1 and f.deleted_at is null
        and f.id in (select g.file_id from public.client_gantt g where g.client_id = $1 and g.file_id is not null)
    $q$ into files using c.id;
  end if;
  return jsonb_build_object(
    'state', 'ok',
    'preview', public.is_staff(),
    'expiresAt', l.expires_at,
    'client', jsonb_build_object(
      'business', coalesce(nullif(btrim(c.business), ''), c.name), 'dealAt', c.deal_at, 'contractEnd', c.contract_end),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', g.key, 'kind', g.kind, 'title', g.title, 'day', g.day, 'time', to_char(g.time_il, 'HH24:MI'),
               'num', g.num, 'state', g.state,
               'postedOn', coalesce(g.posted_on, case when g.state = 'posted' then (files -> g.file_id::text ->> 'postedOn')::date end),
               'link', coalesce(g.link, files -> g.file_id::text ->> 'link'))
             order by g.day, g.time_il nulls last, g.key)
      from public.client_gantt g
      where g.client_id = c.id and not g.internal and g.kind not in ('plan', 'renewal')), '[]'::jsonb)
  );
end $$;

-- The office: a new link (the one before it stops working), its token again, revoke.
create or replace function public.gantt_link_create(p_client uuid, p_days integer default 400) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_token text;
  v_id uuid := gen_random_uuid();
  v_secret uuid;
  v_exp timestamptz := now() + make_interval(days => least(greatest(coalesce(p_days, 400), 1), 800));
begin
  if not public.is_office() then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.clients where id = p_client and status in ('active', 'ending')) then
    raise exception 'client not open' using errcode = '22023';
  end if;
  update public.client_gantt_links set revoked_at = now(), revoked_by = me
  where client_id = p_client and revoked_at is null;
  v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  v_secret := vault.create_secret(v_token, 'gantt_link:' || v_id::text, 'client content gantt link');
  insert into public.client_gantt_links (id, client_id, token_hash, secret_id, created_by, expires_at)
  values (v_id, p_client, encode(extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex'), v_secret, me, v_exp);
  return jsonb_build_object('id', v_id, 'token', v_token, 'expiresAt', v_exp);
end $$;

create or replace function public.gantt_link_token(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_secret uuid;
  v_token text;
begin
  if not public.is_office() then raise exception 'not allowed' using errcode = '42501'; end if;
  select secret_id into v_secret from public.client_gantt_links
  where id = p_id and revoked_at is null and expires_at > now();
  if v_secret is null then return null; end if;
  select decrypted_secret into v_token from vault.decrypted_secrets where id = v_secret;
  return v_token;
end $$;

create or replace function public.gantt_link_revoke(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_office() then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.client_gantt_links set revoked_at = now(), revoked_by = lower(coalesce(auth.jwt() ->> 'email', ''))
  where id = p_id and revoked_at is null;
end $$;

revoke all on function public.get_gantt(text) from public;
grant execute on function public.get_gantt(text) to anon, authenticated;
revoke all on function public.gantt_link_create(uuid, integer) from public, anon;
revoke all on function public.gantt_link_token(uuid) from public, anon;
revoke all on function public.gantt_link_revoke(uuid) from public, anon;
grant execute on function public.gantt_link_create(uuid, integer) to authenticated;
grant execute on function public.gantt_link_token(uuid) to authenticated;
grant execute on function public.gantt_link_revoke(uuid) to authenticated;
