-- Client protocol, third batch: the employee protocols. Named editors and Lior
-- as a fallback characterizer, the access vault (passwords encrypted with
-- Supabase Vault, every view logged), Ofir's weekly status summary, task
-- briefs, urgent tasks and escalations to Lior.

-- People in the protocol (staff.person, task owners, the assigned editor).
alter table public.staff drop constraint if exists staff_person_check;
alter table public.staff add constraint staff_person_check
  check (person in ('irit', 'lior', 'ofir', 'shirel', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'editor'));

alter table public.clients drop constraint if exists clients_characterizer_check;
alter table public.clients add constraint clients_characterizer_check
  check (characterizer in ('ofir', 'shirel', 'lior'));
alter table public.clients add column editor text check (editor in ('nadia', 'yariv', 'anna', 'nirel'));

-- Process ids may carry a letter: 11ב is p11b, 12א is p12a, 22א is p22a.
alter table public.protocol_checks drop constraint protocol_checks_item_key_check;
alter table public.protocol_checks add constraint protocol_checks_item_key_check
  check (item_key ~ '^(r[0-9]+\.)?p[0-9]+[ab]?\.[a-z0-9.]+$');

-- Tasks: any person in the protocol, a brief (required for Nirel in the app),
-- an urgent flag, and where the task came from.
alter table public.client_tasks drop constraint if exists client_tasks_owner_check;
alter table public.client_tasks add constraint client_tasks_owner_check
  check (owner in ('irit', 'lior', 'ofir', 'shirel', 'ilai', 'nirel', 'nadia', 'yariv', 'anna'));
alter table public.client_tasks drop constraint if exists client_tasks_source_check;
alter table public.client_tasks add constraint client_tasks_source_check
  check (source is null or source in ('p31', 'p33', 'escalation', 'status'));
alter table public.client_tasks
  add column brief jsonb check (brief is null or jsonb_typeof(brief) = 'object'),
  add column urgent boolean not null default false;

-- Ofir's Thursday summary: one per client per week (the week's Sunday).
create table public.client_status_notes (
  client_id uuid not null references public.clients (id) on delete cascade,
  week date not null check (extract(dow from week) = 0),
  current text check (length(current) <= 1000),
  missing text check (length(missing) <= 1000),
  next text check (length(next) <= 1000),
  owner text check (owner in ('irit', 'lior', 'ofir', 'shirel', 'ilai', 'nirel', 'nadia', 'yariv', 'anna')),
  due_on date,
  by_email text not null default '',
  at timestamptz not null default now(),
  primary key (client_id, week)
);

create trigger client_status_notes_stamp before insert or update on public.client_status_notes
for each row execute function public.protocol_stamp();

alter table public.client_status_notes enable row level security;
create policy "staff manage status notes" on public.client_status_notes
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
revoke delete, truncate on public.client_status_notes from anon, authenticated;

-- ── Access vault ─────────────────────────────
-- The table holds the network and user name; the password lives encrypted in
-- vault.secrets and is only read through access_reveal(), which logs who saw it.
create table public.client_access (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  network text not null check (network in ('instagram', 'facebook', 'tiktok', 'youtube', 'google', 'meta', 'other')),
  label text check (label is null or length(label) <= 100),
  username text check (username is null or length(username) <= 200),
  secret_id uuid,
  status text not null default 'ok' check (status in ('ok', 'broken', 'missing')),
  note text check (note is null or length(note) <= 500),
  updated_by text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index client_access_client_idx on public.client_access (client_id);

create table public.client_access_log (
  id bigint generated always as identity primary key,
  access_id uuid,
  client_id uuid not null references public.clients (id) on delete cascade,
  network text,
  action text not null check (action in ('create', 'update', 'reveal', 'delete')),
  by_email text not null,
  at timestamptz not null default now()
);
create index client_access_log_client_idx on public.client_access_log (client_id, at desc);

alter table public.client_access enable row level security;
alter table public.client_access_log enable row level security;
create policy "staff read access" on public.client_access for select to authenticated using (public.is_staff());
create policy "staff read access log" on public.client_access_log for select to authenticated using (public.is_staff());
-- Writes go only through the functions below.
revoke insert, update, delete, truncate on public.client_access from anon, authenticated;
revoke insert, update, delete, truncate on public.client_access_log from anon, authenticated;

-- Video editors do not use client passwords.
create function public.can_use_vault() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff s
    where s.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and coalesce(s.person, '') not in ('nadia', 'yariv', 'anna')
  );
$$;

create function public.access_save(
  p_client uuid, p_id uuid, p_network text, p_label text, p_username text, p_password text, p_status text, p_note text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  rid uuid := p_id;
  sid uuid;
begin
  if not public.can_use_vault() then raise exception 'not allowed'; end if;
  if rid is null then
    insert into public.client_access (client_id, network, label, username, status, note, updated_by)
    values (p_client, p_network, nullif(btrim(p_label), ''), nullif(btrim(p_username), ''), coalesce(p_status, 'ok'), nullif(btrim(p_note), ''), me)
    returning id into rid;
  else
    update public.client_access
    set network = p_network, label = nullif(btrim(p_label), ''), username = nullif(btrim(p_username), ''),
        status = coalesce(p_status, status), note = nullif(btrim(p_note), ''), updated_by = me, updated_at = now()
    where id = rid and client_id = p_client
    returning secret_id into sid;
    if not found then raise exception 'access not found'; end if;
  end if;
  if coalesce(p_password, '') <> '' then
    select secret_id into sid from public.client_access where id = rid;
    if sid is null then
      sid := vault.create_secret(p_password, 'client_access:' || rid::text, 'client social access');
      update public.client_access set secret_id = sid where id = rid;
    else
      perform vault.update_secret(sid, p_password);
    end if;
  end if;
  insert into public.client_access_log (access_id, client_id, network, action, by_email)
  values (rid, p_client, p_network, case when p_id is null then 'create' else 'update' end, me);
  return rid;
end $$;

create function public.access_reveal(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  a public.client_access;
  secret text;
begin
  if not public.can_use_vault() then raise exception 'not allowed'; end if;
  select * into a from public.client_access where id = p_id;
  if a.id is null then raise exception 'access not found'; end if;
  if a.secret_id is null then return null; end if;
  select decrypted_secret into secret from vault.decrypted_secrets where id = a.secret_id;
  insert into public.client_access_log (access_id, client_id, network, action, by_email)
  values (a.id, a.client_id, a.network, 'reveal', me);
  return secret;
end $$;

create function public.access_delete(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  a public.client_access;
begin
  if not public.can_use_vault() then raise exception 'not allowed'; end if;
  select * into a from public.client_access where id = p_id;
  if a.id is null then return; end if;
  if a.secret_id is not null then delete from vault.secrets where id = a.secret_id; end if;
  delete from public.client_access where id = a.id;
  insert into public.client_access_log (access_id, client_id, network, action, by_email)
  values (a.id, a.client_id, a.network, 'delete', me);
end $$;

-- A client's passwords are removed with the client too.
create function public.client_access_cleanup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.secret_id is not null then delete from vault.secrets where id = old.secret_id; end if;
  return old;
end $$;
create trigger client_access_cleanup after delete on public.client_access
for each row execute function public.client_access_cleanup();

revoke execute on function public.can_use_vault() from public, anon;
revoke execute on function public.access_save(uuid, uuid, text, text, text, text, text, text) from public, anon;
revoke execute on function public.access_reveal(uuid) from public, anon;
revoke execute on function public.access_delete(uuid) from public, anon;
revoke execute on function public.client_access_cleanup() from public, anon, authenticated;
grant execute on function public.can_use_vault() to authenticated;
grant execute on function public.access_save(uuid, uuid, text, text, text, text, text, text) to authenticated;
grant execute on function public.access_reveal(uuid) to authenticated;
grant execute on function public.access_delete(uuid) to authenticated;
