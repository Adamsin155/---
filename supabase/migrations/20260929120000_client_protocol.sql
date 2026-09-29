-- Client work protocol: clients, per-item checks, an append-only history and
-- ad-hoc tasks. The protocol itself (processes, items, owners) lives in
-- app/protocol.js; the database stores only item keys and their state.
-- Every table is staff-only through row level security.

alter table public.staff add column if not exists person text
  check (person in ('irit', 'lior', 'ofir', 'shirel', 'ilai', 'editor'));

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 200),
  business text,
  phone text,
  package_name text,
  shoot_type text check (shoot_type in ('natali', 'dms')),
  characterizer text check (characterizer in ('ofir', 'shirel')),
  has_logo boolean,
  editor_name text,
  deal_at timestamptz not null default now(),
  char_at timestamptz,
  shoot_at timestamptz,
  contract_end date,
  status text not null default 'active' check (status in ('active', 'ending', 'ended')),
  notes text,
  quote_id uuid references public.quotes (id) on delete set null,
  protocol_version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by_email text default lower(coalesce(auth.jwt() ->> 'email', '')),
  updated_at timestamptz not null default now()
);

create index clients_status_idx on public.clients (status, deal_at desc);

create table public.protocol_checks (
  client_id uuid not null references public.clients (id) on delete cascade,
  item_key text not null check (item_key ~ '^p[0-9]+b?\.[a-z0-9.]+$'),
  state text not null check (state in ('done', 'na')),
  note text check (note is null or length(note) <= 2000),
  by_email text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  at timestamptz not null default now(),
  primary key (client_id, item_key)
);

create table public.protocol_log (
  id bigint generated always as identity primary key,
  client_id uuid not null references public.clients (id) on delete cascade,
  item_key text not null,
  action text not null check (action in ('done', 'na', 'clear')),
  note text,
  by_email text not null,
  at timestamptz not null default now()
);

create index protocol_log_client_idx on public.protocol_log (client_id, at desc);

create table public.client_tasks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 500),
  owner text not null check (owner in ('irit', 'lior', 'ofir', 'shirel', 'ilai', 'editor')),
  due_on date,
  done_at timestamptz,
  done_by_email text,
  created_by_email text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  created_at timestamptz not null default now()
);

create index client_tasks_open_idx on public.client_tasks (client_id) where done_at is null;

-- Who and when always come from the session, never from the browser.
create function public.protocol_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.by_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  new.at := now();
  return new;
end $$;

create trigger protocol_checks_stamp before insert or update on public.protocol_checks
for each row execute function public.protocol_stamp();

create function public.protocol_checks_log() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    insert into public.protocol_log (client_id, item_key, action, by_email)
    values (old.client_id, old.item_key, 'clear', lower(coalesce(auth.jwt() ->> 'email', '')));
    return old;
  end if;
  insert into public.protocol_log (client_id, item_key, action, note, by_email)
  values (new.client_id, new.item_key, new.state, new.note, new.by_email);
  return new;
end $$;

create trigger protocol_checks_log after insert or update or delete on public.protocol_checks
for each row execute function public.protocol_checks_log();

-- Who created a task and who finished it always come from the session.
create function public.client_tasks_stamp() returns trigger
language plpgsql set search_path = '' as $$
declare me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if tg_op = 'INSERT' then
    new.created_by_email := me;
    new.created_at := now();
  else
    new.created_by_email := old.created_by_email;
    new.created_at := old.created_at;
  end if;
  if new.done_at is null then
    new.done_by_email := null;
  elsif tg_op = 'INSERT' or old.done_at is null then
    new.done_at := now();
    new.done_by_email := me;
  else
    new.done_at := old.done_at;
    new.done_by_email := old.done_by_email;
  end if;
  return new;
end $$;

create trigger client_tasks_stamp before insert or update on public.client_tasks
for each row execute function public.client_tasks_stamp();

create function public.clients_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  else
    new.created_at := old.created_at;
    new.created_by_email := old.created_by_email;
  end if;
  return new;
end $$;

create trigger clients_touch before insert or update on public.clients
for each row execute function public.clients_touch();

alter table public.clients enable row level security;
alter table public.protocol_checks enable row level security;
alter table public.protocol_log enable row level security;
alter table public.client_tasks enable row level security;

create policy "staff manage clients" on public.clients
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "staff manage checks" on public.protocol_checks
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "staff read log" on public.protocol_log
  for select to authenticated using (public.is_staff());
create policy "staff manage tasks" on public.client_tasks
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Staff see each other's names in the protocol (who checked what).
create policy "staff read staff" on public.staff
  for select to authenticated using (public.is_staff());

-- Clients are removed only by marking them ended, and tasks only by marking
-- them done; nothing is deleted from the browser. The log is append-only.
revoke delete, truncate on public.clients from anon, authenticated;
revoke delete, truncate on public.client_tasks from anon, authenticated;
revoke truncate on public.protocol_checks from anon, authenticated;
revoke all on public.protocol_log from anon, authenticated;
grant select on public.protocol_log to authenticated;

-- Staff pick which person in the protocol they are (for "my work").
create function public.set_my_person(p_person text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'not staff'; end if;
  update public.staff set person = p_person
  where email = lower(coalesce(auth.jwt() ->> 'email', ''));
end $$;

revoke execute on function public.set_my_person(text) from public, anon;
grant execute on function public.set_my_person(text) to authenticated;
