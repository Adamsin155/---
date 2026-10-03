-- The parts of a Supabase project that our migrations expect before they run,
-- reduced to what the tests need (loaded by tests/sql/pg.mjs into PGlite, never
-- into a real project):
--   - the API roles anon, authenticated and service_role, with Supabase's default
--     grants on what the migrations create in public;
--   - auth.users (id, email, email_confirmed_at) and auth.jwt() / auth.uid() /
--     auth.role(), read from the request.jwt.claims setting as PostgREST sets it;
--   - the schemas extensions, vault, cron and net. Vault keeps the secret in plain
--     text here (the real one encrypts it); cron and net only record calls, so a
--     migration that schedules a job or posts to a function still loads.
create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists vault;
create schema if not exists cron;
create schema if not exists net;

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

grant usage on schema public, extensions, auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  email_confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid;
$$;
create function auth.role() returns text language sql stable as $$
  select nullif(auth.jwt() ->> 'role', '');
$$;
grant execute on all functions in schema auth to anon, authenticated, service_role;

-- Vault: same names and arguments as Supabase's, without the encryption.
create table vault.secrets (
  id uuid primary key default gen_random_uuid(),
  name text unique,
  description text not null default '',
  secret text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create view vault.decrypted_secrets as
  select id, name, description, secret, secret as decrypted_secret, created_at, updated_at from vault.secrets;
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '', new_key_id uuid default null)
returns uuid language plpgsql as $$
declare rid uuid;
begin
  insert into vault.secrets (secret, name, description) values (new_secret, new_name, coalesce(new_description, '')) returning id into rid;
  return rid;
end $$;
create function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null, new_description text default null, new_key_id uuid default null)
returns void language sql as $$
  update vault.secrets set secret = coalesce(new_secret, secret), name = coalesce(new_name, name),
    description = coalesce(new_description, description), updated_at = now()
  where id = secret_id;
$$;
revoke all on schema vault from public;
grant usage on schema vault to service_role;

-- pg_cron and pg_net stand-ins (PGlite has neither extension).
create table cron.job (
  jobid bigint generated always as identity primary key,
  jobname text unique,
  schedule text not null,
  command text not null,
  active boolean not null default true
);
create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid;
$$;
create function cron.schedule(schedule text, command text) returns bigint language sql as $$
  insert into cron.job (schedule, command) values (schedule, command) returning jobid;
$$;
create function cron.unschedule(job_name text) returns boolean language sql as $$
  with d as (delete from cron.job where jobname = job_name returning 1) select exists (select 1 from d);
$$;
create function cron.unschedule(job_id bigint) returns boolean language sql as $$
  with d as (delete from cron.job where jobid = job_id returning 1) select exists (select 1 from d);
$$;
create table net.calls (
  id bigint generated always as identity primary key,
  method text not null,
  url text not null,
  body jsonb,
  headers jsonb,
  at timestamptz not null default now()
);
create function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds integer default 5000)
returns bigint language sql as $$
  insert into net.calls (method, url, body, headers) values ('POST', url, body, headers) returning id;
$$;
create function net.http_get(url text, params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb,
  timeout_milliseconds integer default 5000)
returns bigint language sql as $$
  insert into net.calls (method, url, headers) values ('GET', url, headers) returning id;
$$;
revoke all on schema cron, net from public;

-- Storage (20261003110000_client_files.sql keeps the client files in a private
-- bucket and puts its policies on storage.objects): the two tables with the columns
-- the policies read, row level security on the objects as in Supabase, and
-- storage.foldername() exactly as Supabase defines it. No file is stored here; a
-- test inserts a storage.objects row as the Storage server does on an upload (as
-- the signed-in user, so the policies decide).
create schema if not exists storage;
create table storage.buckets (
  id text primary key,
  name text not null unique,
  owner uuid,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  owner_id text,
  metadata jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language plpgsql as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end $$;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.objects, storage.buckets to anon, authenticated, service_role;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
