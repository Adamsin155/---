-- A personal link to the taking-in, with no sign-in (the owner, 15.10.2026; docs/ops.md,
-- the bullets of that day at the end).
--
-- The staff who have not gone over their old clients get, from the owners, a link of
-- their own: it opens their intake screen alone (intake-link.html), with no password, no
-- menu and nothing else of the system. Through it they can only read what that screen
-- shows (the clients in landing that have something of theirs, their protocol marks and
-- the answers given so far) and answer their own items, exactly as landing_take does.
--
--   landing_link_make(person)        the owners: a new link for one person; an older
--                                    link of that person stops working. Returns the
--                                    token once (only its hash is kept).
--   landing_link_revoke(person)      the owners: that person's link stops working.
--   landing_links()                  the owners: who has a link, until when, last used.
--   landing_link_read(token)         anyone holding a live token: that person's screen.
--   landing_link_take(token, ...)    anyone holding a live token: landing_take as that
--                                    person (their items only, on clients in landing).
--
-- A link lives four days at most, and is worth nothing once the clients are activated
-- (nothing is in landing then). The answers are stamped with the person's own email,
-- as if they had signed in; the link row keeps when it was last used.

create table if not exists private.landing_links (
  id uuid primary key default gen_random_uuid(),
  person text not null,
  token_hash text not null unique,
  created_by text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  uses integer not null default 0
);
create index if not exists landing_links_person on private.landing_links (person);
revoke all on table private.landing_links from public, anon, authenticated;

-- Who can have a link: the people who take in (never sales, never the owners).
create or replace function private.landing_link_person_ok(p_person text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_person in ('irit', 'lior', 'ofir', 'ilai', 'nadia', 'yariv', 'anna', 'nirel', 'eli')
    and exists (select 1 from public.staff s where s.person = p_person);
$$;
revoke execute on function private.landing_link_person_ok(text) from public, anon, authenticated;

create or replace function private.landing_link_hash(p_token text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(convert_to(coalesce(p_token, ''), 'UTF8'), 'sha256'), 'hex');
$$;
revoke execute on function private.landing_link_hash(text) from public, anon, authenticated;

-- The person a live token stands for (null: malformed, unknown, revoked or expired).
create or replace function private.landing_link_who(p_token text) returns text
language sql stable security definer set search_path = '' as $$
  select l.person from private.landing_links l
  where coalesce(p_token, '') ~ '^[0-9a-f]{64}$'
    and l.token_hash = private.landing_link_hash(p_token)
    and l.revoked_at is null and l.expires_at > now()
    and private.landing_link_person_ok(l.person);
$$;
revoke execute on function private.landing_link_who(text) from public, anon, authenticated;

-- private.protocol_write_ok for a named person instead of the signed-in one (the same
-- rules: the office everything, the writers' table, the editor of that shoot).
create or replace function private.protocol_write_as(p_person text, p_client uuid, p_key text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  m text[];
  w private.protocol_writers;
  v_rule text;
  v_editor text;
begin
  if p_person is null then return false; end if;
  if p_person = any (coalesce((select w0.persons from private.protocol_writers w0 where w0.key = '@office'), '{}')) then return true; end if;
  m := regexp_match(coalesce(p_key, ''), '^(?:r([0-9]+)\.)?((p[0-9]+[ab]?)\.(.+))$');
  if m is null then return false; end if;
  select * into w from private.protocol_writers x where x.key = m[2];
  if not found then
    v_rule := case
      when m[4] = 'claim' then m[3] || '.@claim'
      when m[4] in ('wait', 'waited') then m[3] || '.@wait'
      when m[4] = 'pause' then m[3] || '.@pause'
      when m[4] ~ '^handoff\.[a-z0-9]+$' then m[3] || '.@part'
      when m[4] ~ '^fixed\.[0-9]+(\.[0-9]+)?$' then m[3] || '.@qafixed' end;
    select * into w from private.protocol_writers x where x.key = v_rule;
  end if;
  if w.key is null or (m[1] is not null and not w.round) then return false; end if;
  if p_person = any (w.persons) then return true; end if;
  if not (w.persons && array['@editor', '@editor-free']) then return false; end if;
  select case when m[1] is null then c.editor
              else (select r ->> 'editor' from jsonb_array_elements(c.rounds) r where r ->> 'n' = m[1] limit 1) end
    into v_editor
  from public.clients c where c.id = p_client;
  return ('@editor' = any (w.persons) and v_editor is not null and v_editor = p_person)
    or ('@editor-free' = any (w.persons) and v_editor is null
        and p_person = any (coalesce((select w1.persons from private.protocol_writers w1 where w1.key = '@editors'), '{}')));
end $$;
revoke execute on function private.protocol_write_as(text, uuid, text) from public, anon, authenticated;

-- The clients in landing (and in work) a person may go over: the office and Ilai all of
-- them, the photographer all of them (the screen keeps those around a shoot day), an
-- editor the clients they edit, Nirel every client of Natali (app/landing-logic.js, canTake).
create or replace function private.landing_link_clients(p_person text) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.clients c
  where c.landing and c.status in ('active', 'ending')
    and (p_person in ('irit', 'lior', 'ofir', 'ilai', 'eli')
      or c.editor = p_person
      or exists (select 1 from jsonb_array_elements(coalesce(c.rounds, '[]'::jsonb)) r where r ->> 'editor' = p_person)
      or (p_person = 'nirel' and c.shoot_type = 'natali'));
$$;
revoke execute on function private.landing_link_clients(text) from public, anon, authenticated;

-- ── The owners ──
create or replace function public.landing_link_make(p_person text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if not private.is_owner() then raise exception 'not allowed: owner only' using errcode = '42501'; end if;
  if not private.landing_link_person_ok(p_person) then raise exception 'no such person' using errcode = '22023'; end if;
  update private.landing_links set revoked_at = now() where person = p_person and revoked_at is null;
  insert into private.landing_links (person, token_hash, created_by, expires_at)
  values (p_person, private.landing_link_hash(v_token), lower(coalesce(auth.jwt() ->> 'email', '')), now() + interval '4 days');
  return v_token;
end $$;
revoke execute on function public.landing_link_make(text) from public, anon;
grant execute on function public.landing_link_make(text) to authenticated;

create or replace function public.landing_link_revoke(p_person text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  if not private.is_owner() then raise exception 'not allowed: owner only' using errcode = '42501'; end if;
  update private.landing_links set revoked_at = now() where person = p_person and revoked_at is null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.landing_link_revoke(text) from public, anon;
grant execute on function public.landing_link_revoke(text) to authenticated;

create or replace function public.landing_links() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_owner() then raise exception 'not allowed: owner only' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('person', l.person, 'created_at', l.created_at, 'expires_at', l.expires_at,
      'last_used_at', l.last_used_at, 'uses', l.uses) order by l.person)
    from private.landing_links l where l.revoked_at is null and l.expires_at > now()), '[]'::jsonb);
end $$;
revoke execute on function public.landing_links() from public, anon;
grant execute on function public.landing_links() to authenticated;

-- ── The link itself (no sign-in) ──
-- What the intake screen needs, and nothing else: no phone, notes, address, money,
-- links or emails.
create or replace function public.landing_link_read(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_person text := private.landing_link_who(p_token);
begin
  if v_person is null then raise exception 'link not valid' using errcode = '42501'; end if;
  update private.landing_links set last_used_at = now(), uses = uses + 1
  where token_hash = private.landing_link_hash(p_token);
  return jsonb_build_object(
    'person', v_person,
    'expires_at', (select l.expires_at from private.landing_links l where l.token_hash = private.landing_link_hash(p_token)),
    'clients', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'business', c.business, 'package_name', c.package_name, 'shoot_type', c.shoot_type,
        'characterizer', c.characterizer, 'has_logo', c.has_logo, 'editor_name', c.editor_name, 'deal_at', c.deal_at,
        'char_at', c.char_at, 'shoot_at', c.shoot_at, 'contract_end', c.contract_end, 'status', c.status,
        'created_at', c.created_at, 'deliverables', c.deliverables, 'rounds', c.rounds, 'editor', c.editor,
        'protocol_version', c.protocol_version, 'landing', c.landing, 'landed_at', c.landed_at, 'landing_slot', c.landing_slot))
      from public.clients c where c.id in (select private.landing_link_clients(v_person))), '[]'::jsonb),
    'checks', coalesce((select jsonb_agg(jsonb_build_object('client_id', k.client_id, 'item_key', k.item_key, 'state', k.state, 'note', k.note, 'at', k.at))
      from public.protocol_checks k where k.client_id in (select private.landing_link_clients(v_person))), '[]'::jsonb),
    'marks', coalesce((select jsonb_agg(jsonb_build_object('client_id', m.client_id, 'item_key', m.item_key, 'choice', m.choice, 'person', m.person, 'at', m.at))
      from public.client_landing_marks m where m.client_id in (select private.landing_link_clients(v_person))), '[]'::jsonb),
    'done', coalesce((select jsonb_agg(jsonb_build_object('client_id', d.client_id, 'person', d.person, 'done', d.done, 'at', d.at))
      from public.client_landing_done d where d.client_id in (select private.landing_link_clients(v_person))), '[]'::jsonb));
end $$;
revoke execute on function public.landing_link_read(text) from public;
grant execute on function public.landing_link_read(text) to anon, authenticated;

-- landing_take (20261020100000_landing_intake.sql) as the link's person.
create or replace function public.landing_link_take(p_token text, p_client uuid, p_marks jsonb default '{}'::jsonb, p_done boolean default null, p_waiting text[] default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me text := private.landing_link_who(p_token);
  v_email text;
  v_landing boolean;
  k text;
  v text;
  v_released boolean := false;
begin
  if me is null then raise exception 'link not valid' using errcode = '42501'; end if;
  if p_client is null or p_client not in (select private.landing_link_clients(me)) then
    -- Not one of theirs, or no longer in landing.
    if exists (select 1 from public.clients c where c.id = p_client and not c.landing) then
      raise exception 'not in landing: this client is already active' using errcode = 'P0001';
    end if;
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select lower(s.email) into v_email from public.staff s where s.person = me order by s.created_at limit 1;
  select c.landing into v_landing from public.clients c where c.id = p_client for update;
  if not v_landing then raise exception 'not in landing: this client is already active' using errcode = 'P0001'; end if;
  if p_marks is not null and jsonb_typeof(p_marks) <> 'object' then raise exception 'bad marks' using errcode = '22023'; end if;

  for k, v in select * from jsonb_each_text(coalesce(p_marks, '{}'::jsonb)) loop
    if v is null or v not in ('done', 'open', 'na') then raise exception 'bad choice' using errcode = '22023'; end if;
    if k !~ '^(r[0-9]+\.)?p[0-9]+[ab]?\.[a-z0-9.]+$'
      or k ~ '\.(claim|wait|waited|pause|snooze|answered|shift|ended)$' or k ~ '\.(handoff|fixed)\.' then
      raise exception 'bad item' using errcode = '22023';
    end if;
    if not private.protocol_write_as(me, p_client, k) then raise exception 'not allowed: not your item' using errcode = '42501'; end if;
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
  update private.landing_links set last_used_at = now(), uses = uses + 1 where token_hash = private.landing_link_hash(p_token);
  return jsonb_build_object('landing', not v_released);
end $$;
revoke execute on function public.landing_link_take(text, uuid, jsonb, boolean, text[]) from public;
grant execute on function public.landing_link_take(text, uuid, jsonb, boolean, text[]) to anon, authenticated;
