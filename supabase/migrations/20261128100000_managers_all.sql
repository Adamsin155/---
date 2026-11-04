-- Irit, Ofir and Lior get what the owners have and what any staff member can do, except
-- security and the payments app (the owner's decision of 4.11.2026; docs/ops.md, section 96).
--
-- Money: a new function, public.sees_income() (the owners and the three), for every
-- sum of income, the prices next to each client, the sent quotes with their amounts and the
-- sellers' deals. public.sees_money() itself is NOT changed: it stays the two owners' (a
-- staff row with no person), and so does every check that guards security or the payments
-- app. Work that was the owners' alone becomes the three managers' too.
--
--   given to the three                                   how
--   ─────────────────────────────────────────────────    ──────────────────────────────────
--   every sum of income, the prices in the table + CSV   manager_client_finance(): sees_income()
--   every quote with its amounts, versions, AI runs      private.quote_reader() 'all': sees_income()
--   the month's sums of quotes.html                      sees_quote_money(): sees_income()
--   the sellers' deals with their discount and price     "money: who reads a deal": quote_reader 'all'
--   handing a deal to Irit or Ofir                       deal_hand_over(): sees_income()
--   screen 1 (login statuses, never a password): Lior    is_manager(): + lior
--   archive and restore a client, the archive, its log   is_manager() (it was the owners and Ofir)
--   approving an exceptional contract: Irit              can_approve_quotes(): + irit (never her own)
--   the client's status-page link and gallery: Ofir      can_manage_status_links(): + ofir
--   the scripts (grants, share links): Irit, Ofir        can_manage_scripts(): + irit, ofir
--   changing the Gantt: Ofir, Lior                       can_edit_gantt(): + ofir, lior
--   connecting Metricool: Irit, Lior                     can_connect_metricool(): + irit, lior
--   Eli's availability in his name: Ofir                 can_manage_availability(): + ofir
--   every staff member's notifications: Irit, Ofir       "staff read own reminders": + irit, ofir
--   landing: close a person's part, activate clients     landing_done_for(), landing_activate(): is_manager()
--   the ask and mcp functions' money                     mcp_request_gate(): '/rpc/sees_income' on its list
--
--   kept the owners' (not changed here)
--   ─────────────────────────────────────────────────
--   permanent purge of a client: public.can_archive_clients() is now the owners' alone, and
--     public.purge_client() asks it (so Ofir no longer purges; archiving moved to is_manager())
--   the payments app: payout_* tables, public.payout_owners
--   public.sees_money(); the deal trigger's owner bypass (the owners work a deal without taking it)
--   the vault: the vault flag (staff-admin), vault_code_set, is_vault_owner
--   WhatsApp and Metricool on/off (their secrets), the Jako settings
--   the Claude connector: mcp_owner, mcp_people, mcp_set_access, the gate's key
--   the landing sign-in links (landing_link_make, _revoke, landing_links), calendar_feeds_team
--   the old-system imports run from the owner's terminal (legacy_contract_import,
--     legacy_characterization_import)
--
-- Only adds and replaces (create or replace, alter policy). Every statement can run again
-- safely. Tested in tests/sql/managers-all.test.mjs (every role, twice).

-- ── 1. Who reads income ───────────────────────
create or replace function public.sees_income() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff() and exists (
    select 1 from public.staff s
    where s.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (s.person is null or s.person in ('irit', 'ofir', 'lior')));
$$;
revoke execute on function public.sees_income() from public, anon;
grant execute on function public.sees_income() to authenticated;

-- ── 2. The managers: the owners, Irit, Ofir and now Lior ──
create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff() and exists (
    select 1 from public.staff s
    where s.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (s.person is null or s.person in ('irit', 'ofir', 'lior'))
  );
$$;
revoke execute on function public.is_manager() from public, anon;
grant execute on function public.is_manager() to authenticated;

-- ── 3. The quotes and their money ─────────────
-- 'all' (the owners and the three managers), 'approver' (whoever else decides on an
-- exceptional contract: nobody today), or 'none'.
create or replace function private.quote_reader() returns text
language sql stable security definer set search_path = '' as $$
  select case
    when not public.is_staff() then 'none'
    when public.sees_income() then 'all'
    when public.can_approve_quotes() then 'approver'
    else 'none' end;
$$;
revoke execute on function private.quote_reader() from public, anon;
grant execute on function private.quote_reader() to authenticated;

create or replace function public.sees_quote_money() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.sees_income();
$$;
revoke execute on function public.sees_quote_money() from public, anon;
grant execute on function public.sees_quote_money() to authenticated;

-- The sellers' deals: the owners and the three (quote_reader 'all'), and the seller whose deal it is.
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'deal_requests' and policyname = 'money: who reads a deal') then
    alter policy "money: who reads a deal" on public.deal_requests
      using ((select private.quote_reader()) = 'all'
        or created_by_email = nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''));
  else
    create policy "money: who reads a deal" on public.deal_requests as restrictive
      for select to authenticated
      using ((select private.quote_reader()) = 'all'
        or created_by_email = nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''));
  end if;
end $$;

-- The prices next to each client (the managers' table and its CSV).
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
  where (select public.sees_income()) and c.archived_at is null;
$$;
revoke execute on function public.manager_client_finance() from public, anon;
grant execute on function public.manager_client_finance() to authenticated;

-- ── 4. Handing a deal between Irit and Ofir ───
-- As 20261122100000_deal_pool.sql, with one more way through the trigger: a hand-over made
-- by public.deal_hand_over() (it sets astrateg.deal_hand_over for its own update only). The
-- owners still pass without it; Irit and Ofir still cannot take a deal from each other by
-- any other write.
create or replace function public.deal_requests_taken() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  who text;
begin
  if tg_op = 'INSERT' then
    new.taken_by := null;
    new.taken_at := null;
    return new;
  end if;
  if new.taken_by is distinct from old.taken_by then
    new.taken_at := case when new.taken_by is null then null else now() end;
  else
    new.taken_at := old.taken_at;
  end if;
  if me = '' or public.sees_money() or new.status = 'signed' then
    return new;
  end if;
  if coalesce(current_setting('astrateg.deal_hand_over', true), '') = 'on'
    and public.sees_income() and old.status = 'pending' and new.status = 'pending'
    and new.taken_by in ('irit', 'ofir') and new.quote_id is not distinct from old.quote_id then
    return new;
  end if;
  who := public.my_person();
  if new.taken_by is distinct from old.taken_by
    and not (old.taken_by is null and new.taken_by = who and old.status = 'pending') then
    raise exception 'deal_taken' using errcode = 'P0001';
  end if;
  if old.taken_by is not null and old.taken_by is distinct from who then
    raise exception 'deal_taken' using errcode = 'P0001';
  end if;
  if old.status = 'pending' and old.taken_by is null and new.taken_by is null
    and (new.status is distinct from old.status or new.quote_id is distinct from old.quote_id) then
    raise exception 'deal_not_taken' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function public.deal_requests_taken() from public, anon, authenticated;

create or replace function public.deal_hand_over(p_id uuid, p_person text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d public.deal_requests%rowtype;
begin
  if not public.sees_income() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_person is null or p_person not in ('irit', 'ofir') then
    raise exception 'invalid person' using errcode = '22023';
  end if;
  perform set_config('astrateg.deal_hand_over', 'on', true);
  update public.deal_requests set taken_by = p_person where id = p_id and status = 'pending' returning * into d;
  perform set_config('astrateg.deal_hand_over', '', true);
  if d.id is null then
    raise exception 'deal not waiting' using errcode = 'P0002';
  end if;
  return jsonb_build_object('ok', true, 'taken_by', d.taken_by, 'status', d.status);
end $$;
revoke execute on function public.deal_hand_over(uuid, text) from public, anon;
grant execute on function public.deal_hand_over(uuid, text) to authenticated;

-- ── 5. The archive for the managers; the permanent purge for the owners ──
-- public.purge_client() asks public.can_archive_clients(): from here that is the owners'
-- alone (it was the owners and Ofir). Archiving, restoring, the archive list and its log
-- ask public.is_manager() (the owners, Irit, Ofir, Lior).
create or replace function public.can_archive_clients() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff() and exists (
    select 1 from public.staff s
    where s.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and s.person is null
  );
$$;
revoke execute on function public.can_archive_clients() from public, anon;
grant execute on function public.can_archive_clients() to authenticated;

create or replace function public.archive_client(p_client uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  c public.clients;
begin
  if not public.is_manager() then raise exception 'not allowed' using errcode = '42501'; end if;
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
  if not public.is_manager() then raise exception 'not allowed' using errcode = '42501'; end if;
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

create or replace function public.archived_clients()
returns table (id uuid, label text, name text, business text, package_name text, status text,
  deal_at timestamptz, contract_end date, archived_at timestamptz, archived_by text)
language sql stable security definer set search_path = '' as $$
  select c.id, private.client_label(c.business, c.name), c.name, c.business, c.package_name, c.status,
    c.deal_at, c.contract_end, c.archived_at, c.archived_by
  from public.clients c
  where (select public.is_manager()) and c.archived_at is not null
  order by c.archived_at desc;
$$;
revoke execute on function public.archive_client(uuid) from public, anon;
revoke execute on function public.restore_client(uuid) from public, anon;
revoke execute on function public.archived_clients() from public, anon;
grant execute on function public.archive_client(uuid) to authenticated;
grant execute on function public.restore_client(uuid) to authenticated;
grant execute on function public.archived_clients() to authenticated;

alter policy "archivers read the log" on public.client_admin_log
  using ((select public.is_manager()));

-- ── 6. Work that was the owners' (and some of the staff's) ──
-- An exceptional contract: the owners, Ofir, Lior and now Irit; still never one they
-- prepared themselves (public.quote_approve: only a row with no person may).
create or replace function public.can_approve_quotes() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff() and exists (
    select 1 from public.staff s
    where s.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (s.person is null or s.person in ('irit', 'ofir', 'lior'))
  );
$$;
revoke execute on function public.can_approve_quotes() from public, anon;
grant execute on function public.can_approve_quotes() to authenticated;

-- The client's status-page link and the gallery link: + Ofir.
create or replace function public.can_manage_status_links() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff() and exists (
    select 1 from public.staff s
    where s.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (s.person is null or s.person in ('irit', 'lior', 'ofir'))
  );
$$;
revoke execute on function public.can_manage_status_links() from public, anon;
grant execute on function public.can_manage_status_links() to authenticated;

-- The scripts (who else writes them, share links, "approved"): + Irit and Ofir.
create or replace function public.can_manage_scripts() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff() and exists (
    select 1 from public.staff s
    where s.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (s.person is null or s.person in ('lior', 'irit', 'ofir'))
  );
$$;
revoke execute on function public.can_manage_scripts() from public, anon;
grant execute on function public.can_manage_scripts() to authenticated;

-- The Gantt: the owners, Ilai, Irit, and now Ofir and Lior; Noam as before (only while he
-- connects Metricool).
create or replace function public.can_edit_gantt() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff() and exists (
    select 1 from public.staff s
    where s.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (s.person is null or s.person in ('ilai', 'irit', 'ofir', 'lior')
        or (s.person = 'noam' and coalesce(current_setting('astrateg.mc_connect', true), '') = '1')));
$$;
revoke execute on function public.can_edit_gantt() from public, anon;
grant execute on function public.can_edit_gantt() to authenticated;

-- Connecting a client's Metricool brand: + Irit and Lior.
create or replace function public.can_connect_metricool() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff() and exists (
    select 1 from public.staff s
    where s.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (s.person is null or s.person in ('ilai', 'ofir', 'noam', 'irit', 'lior')));
$$;
revoke execute on function public.can_connect_metricool() from public, anon;
grant execute on function public.can_connect_metricool() to authenticated;

-- The photographer's availability in his name, after a phone call: + Ofir.
create or replace function public.can_manage_availability() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.reminder_person() in ('owner', 'irit', 'lior', 'ofir'), false);
$$;
revoke execute on function public.can_manage_availability() from public, anon;
grant execute on function public.can_manage_availability() to authenticated;

-- Every staff member's notifications (the team's log): the owners, Lior, and now Irit and Ofir.
alter policy "staff read own reminders" on public.reminder_log
  using (person = public.reminder_person() or public.reminder_person() in ('owner', 'lior', 'irit', 'ofir'));

-- Landing the old system's clients: closing a person's part, activating clients.
create or replace function public.landing_done_for(p_person text, p_clients uuid[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  n integer := 0;
begin
  if not public.is_manager() then raise exception 'not allowed' using errcode = '42501'; end if;
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

create or replace function public.landing_activate(p_clients uuid[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  n integer := 0;
begin
  if not public.is_manager() then raise exception 'not allowed' using errcode = '42501'; end if;
  for v_id in select c.id from public.clients c
    where c.id = any (coalesce(p_clients, '{}'::uuid[])) and c.landing order by c.deal_at, c.id loop
    if private.landing_release(v_id) then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke execute on function public.landing_activate(uuid[]) from public, anon;
grant execute on function public.landing_activate(uuid[]) to authenticated;

-- ── 7. The ask and mcp functions read money through sees_income() ──
-- As 20261121100000_mcp.sql, with '/rpc/sees_income' on the list of what a connected app's
-- token may call (the mcp function asks it; GATE_RPCS in supabase/functions/mcp/handler.js).
-- Nothing else of the gate changes: the key, the tables, the methods.
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
        '/rpc/is_office', '/rpc/my_person', '/rpc/mcp_allowed', '/rpc/sees_money', '/rpc/sees_income'))
    ) then
    return;
  end if;
  raise exception 'not available to a connected app' using errcode = '42501';
end $$;
grant execute on function public.mcp_request_gate() to public;
