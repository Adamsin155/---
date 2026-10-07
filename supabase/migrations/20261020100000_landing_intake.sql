-- "קליטת לקוחות קיימים": taking in the clients that came from the old system, and
-- activating them (the owner's decision of 7.10.2026; docs/ops.md, section 41).
--
-- 20261018100000_clients_landing.sql made an imported client quiet (clients.landing).
-- This file is how a client leaves landing:
--
--   client_landing_marks   what each person said about an item the system shows as open
--                          for them on a client in landing: 'done' (it was done long ago),
--                          'open' (really still open) or 'na'. Kept apart from the
--                          protocol's own marks until the client is activated, so a wrong
--                          tap is changed back with another tap and no history is touched.
--   client_landing_done    who finished going over which client ("סיימתי עם הלקוח").
--   clients.landing_slot   0..9, given in turn when a client is activated: the weekly
--                          call of an activated client first comes up on working day
--                          slot + 1 after the activation, so forty first calls are spread
--                          over two weeks and not all on one morning (app/protocol-logic.js).
--
--   landing_take(client, marks, done, waiting)   any staff member, on a client they see
--                          and that is in landing: their own items only (the same rule as
--                          a mark in the client card, private.protocol_write_ok), and their
--                          own "I finished". When they finish and nobody in `waiting` (the
--                          others who still have open items there, as the screen computed)
--                          is still missing, the client is activated.
--   landing_done_for(person, clients)   the owners: close a person's part for them.
--   landing_activate(clients)           the owners: activate now.
--
-- Activating a client (private.landing_release): what was said to be done or not relevant
-- becomes imported history (the note 'ייבוא': never anybody's work, lateness or
-- performance), landing is turned off and landed_at / landed_by are stamped. From then
-- the deadlines of what stayed open are counted from landed_at (the app), and the
-- reminders load the client again (supabase/functions/reminders/index.ts).
--
-- A browser cannot change landing, landed_at, landed_by or landing_slot by itself: the
-- trigger below keeps them as they were for the role `authenticated` (as
-- clients_metricool_none_guard does for its columns). The functions here run as their
-- owner and pass, and so do the database's own roles (the import of the old clients).
-- Safe to run again; nothing is removed.

alter table public.clients add column if not exists landing_slot smallint;
grant select (landing_slot) on public.clients to authenticated;

-- No foreign key on purpose: these rows are a record, and a client that is erased
-- later leaves them behind without being held back by them.
create table if not exists public.client_landing_marks (
  client_id uuid not null,
  item_key text not null check (item_key ~ '^(r[0-9]+\.)?p[0-9]+[ab]?\.[a-z0-9.]+$'),
  choice text not null check (choice in ('done', 'open', 'na')),
  person text not null,
  by_email text not null,
  at timestamptz not null default now(),
  primary key (client_id, item_key)
);
create table if not exists public.client_landing_done (
  client_id uuid not null,
  person text not null,
  done boolean not null default true,
  by_email text not null,
  at timestamptz not null default now(),
  primary key (client_id, person)
);
alter table public.client_landing_marks enable row level security;
alter table public.client_landing_done enable row level security;
revoke all on public.client_landing_marks from public, anon, authenticated;
revoke all on public.client_landing_done from public, anon, authenticated;
grant select on public.client_landing_marks to authenticated;
grant select on public.client_landing_done to authenticated;

-- Read: whoever sees the client. Nobody writes these tables with a plain request.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'client_landing_marks' and policyname = 'landing marks readers') then
    create policy "landing marks readers" on public.client_landing_marks for select to authenticated using (false);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'client_landing_done' and policyname = 'landing done readers') then
    create policy "landing done readers" on public.client_landing_done for select to authenticated using (false);
  end if;
end $$;
alter policy "landing marks readers" on public.client_landing_marks
  using ((select public.is_office()) or client_id in (select private.my_clients()));
alter policy "landing done readers" on public.client_landing_done
  using ((select public.is_office()) or client_id in (select private.my_clients()));

-- The four columns belong to the functions below.
create or replace function public.clients_landing_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      new.landing := false;
      new.landed_at := null;
      new.landed_by := null;
      new.landing_slot := null;
    else
      new.landing := old.landing;
      new.landed_at := old.landed_at;
      new.landed_by := old.landed_by;
      new.landing_slot := old.landing_slot;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.clients_landing_guard() from public, anon, authenticated;
create or replace trigger clients_landing_guard before insert or update on public.clients
for each row execute function public.clients_landing_guard();

-- One client leaves landing. Only the functions below call it.
create or replace function private.landing_release(p_client uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  perform 1 from public.clients c where c.id = p_client and c.landing for update;
  if not found then return false; end if;
  -- A real mark made meanwhile stays as it is. "Not relevant" is never an answer to
  -- the client's approval of the content (protocol_checks refuses it).
  insert into public.protocol_checks (client_id, item_key, state, note)
  select m.client_id, m.item_key, case when m.choice = 'na' then 'na' else 'done' end, 'ייבוא'
  from public.client_landing_marks m
  where m.client_id = p_client and m.choice in ('done', 'na')
    and not (m.choice = 'na' and m.item_key ~ '^(r[0-9]+\.)?p13\.approved$')
  on conflict (client_id, item_key) do nothing;
  update public.clients c set
    landing = false, landed_at = now(), landed_by = v_email,
    landing_slot = (select count(*) from public.clients x where x.landed_at is not null) % 10
  where c.id = p_client and c.landing;
  return true;
end $$;
revoke execute on function private.landing_release(uuid) from public, anon, authenticated;

-- A person goes over one client in landing. p_marks: { item key: 'done' | 'open' | 'na' };
-- p_done: true "I finished with this client", false takes that back, null leaves it;
-- p_waiting: the other people who still have open items on the client.
create or replace function public.landing_take(p_client uuid, p_marks jsonb default '{}'::jsonb, p_done boolean default null, p_waiting text[] default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me text;
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_landing boolean;
  k text;
  v text;
  v_released boolean := false;
begin
  if not public.is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  me := public.my_person();
  -- The owners have no items of their own: they activate.
  if me is null or not public.can_see_client(p_client) then raise exception 'not allowed' using errcode = '42501'; end if;
  select c.landing into v_landing from public.clients c where c.id = p_client for update;
  if not found then raise exception 'client not found' using errcode = '22023'; end if;
  if not v_landing then raise exception 'not in landing: this client is already active' using errcode = 'P0001'; end if;
  if p_marks is not null and jsonb_typeof(p_marks) <> 'object' then raise exception 'bad marks' using errcode = '22023'; end if;

  for k, v in select * from jsonb_each_text(coalesce(p_marks, '{}'::jsonb)) loop
    if v is null or v not in ('done', 'open', 'na') then raise exception 'bad choice' using errcode = '22023'; end if;
    -- Items only: never a mark of the process itself (who took it, waiting, paused).
    if k !~ '^(r[0-9]+\.)?p[0-9]+[ab]?\.[a-z0-9.]+$'
      or k ~ '\.(claim|wait|waited|pause|snooze|answered|shift|ended)$' or k ~ '\.(handoff|fixed)\.' then
      raise exception 'bad item' using errcode = '22023';
    end if;
    if not private.protocol_write_ok(p_client, k, null) then raise exception 'not allowed: not your item' using errcode = '42501'; end if;
    insert into public.client_landing_marks as m (client_id, item_key, choice, person, by_email, at)
    values (p_client, k, v, me, v_email, now())
    on conflict (client_id, item_key) do update set choice = excluded.choice, person = excluded.person, by_email = excluded.by_email, at = excluded.at;
  end loop;

  if p_done is not null then
    insert into public.client_landing_done as d (client_id, person, done, by_email, at)
    values (p_client, me, p_done, v_email, now())
    on conflict (client_id, person) do update set done = excluded.done, by_email = excluded.by_email, at = excluded.at;
    if p_done and p_waiting is not null and not exists (
      select 1 from unnest(p_waiting) as w(p)
      where w.p is distinct from me and not exists (
        select 1 from public.client_landing_done x where x.client_id = p_client and x.person = w.p and x.done)
    ) then
      v_released := private.landing_release(p_client);
    end if;
  end if;
  return jsonb_build_object('landing', not v_released);
end $$;
revoke execute on function public.landing_take(uuid, jsonb, boolean, text[]) from public, anon;
grant execute on function public.landing_take(uuid, jsonb, boolean, text[]) to authenticated;

-- The owners close a person's part on these clients (what that person left open stays open).
create or replace function public.landing_done_for(p_person text, p_clients uuid[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  n integer := 0;
begin
  if not private.is_owner() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_person is null or not exists (select 1 from public.staff s where s.person = p_person) then
    raise exception 'no such person' using errcode = '22023';
  end if;
  insert into public.client_landing_done as d (client_id, person, done, by_email, at)
  select c.id, p_person, true, v_email, now() from public.clients c
  where c.id = any (coalesce(p_clients, '{}'::uuid[])) and c.landing
  on conflict (client_id, person) do update set done = true, by_email = excluded.by_email, at = excluded.at;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.landing_done_for(text, uuid[]) from public, anon;
grant execute on function public.landing_done_for(text, uuid[]) to authenticated;

-- The owners activate these clients now. Returns how many left landing.
create or replace function public.landing_activate(p_clients uuid[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  n integer := 0;
begin
  if not private.is_owner() then raise exception 'not allowed' using errcode = '42501'; end if;
  for v_id in select c.id from public.clients c
    where c.id = any (coalesce(p_clients, '{}'::uuid[])) and c.landing order by c.deal_at, c.id loop
    if private.landing_release(v_id) then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke execute on function public.landing_activate(uuid[]) from public, anon;
grant execute on function public.landing_activate(uuid[]) to authenticated;
