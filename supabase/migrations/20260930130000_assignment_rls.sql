-- Stage 3: each person sees only their own clients, enforced by the database
-- (docs/plan/system-plan.md: principle 1 in section 2, appendix ב "הרשאות שורה",
-- the risk "דליפת מידע"). Until now every staff member (is_staff) could read and
-- change every client; the app only hid what was not theirs.
--
-- Who sees what:
--   - The office sees every client: the owner (staff.person is null), Irit, Lior,
--     Ofir, and Ilai (graphics, access and scheduling for nearly every client).
--   - Everyone else sees only the clients they work on:
--       * an editor: the clients whose editing is theirs (clients.editor, or the
--         editor of any extra shoot round in clients.rounds);
--       * Nirel: also every Natali Dadon client (clients.shoot_type = 'natali');
--       * Eli: every client with a shoot day (the main one or a round's) from 7
--         days ago to 30 days ahead, in Israel days;
--       * anyone: a client where they have a task that is open, or was finished
--         in the last 30 days.
--   - The same rule covers the protocol checks, their history and the tasks. Checks
--     and tasks can be written only on a client one can see; opening a task for
--     someone else there (an exception reported to Lior, a paused edit) stays allowed.
--   - Client details (clients rows) are added and changed by the office only.
--   - The access vault: the vault flag (staff.vault, set by the admin) and, outside
--     the office, a client assigned to the person (their editing or a task of
--     theirs), as the plan says for Nirel: "כספת: רק ללקוחות שהיא משויכת אליהם".
--     Seeing a Natali client is not enough to see its logins. This holds for the
--     rows, their log, and access_save / access_reveal / access_delete.
--   - Ofir's weekly summaries and the daily reviews: the office only.
-- The quote and payout tables do not change. The triggers that stamp who and when
-- stay as they are (they only set values on the row being written).
--
-- can_see_client(id) is the rule for one client. The policies use the same rule in
-- its set form, private.my_clients(), which a query computes once, so an editor's
-- list does not run the rule again for each of thousands of checks.
-- Tested against every migration in a real Postgres: tests/sql/rls.test.mjs.

-- ── Who is signed in ─────────────────────────
-- The signed-in person in the protocol (staff.person). Null for the owner, and for
-- anyone who is not a confirmed staff login.
create or replace function public.my_person() returns text
language sql stable security definer set search_path = '' as $$
  select s.person from public.staff s
  where s.email = lower(coalesce(auth.jwt() ->> 'email', '')) and public.is_staff();
$$;

-- The office: the owner (no person), Irit, Lior, Ofir and Ilai.
create or replace function public.is_office() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff() and exists (
    select 1 from public.staff s
    where s.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (s.person is null or s.person in ('irit', 'lior', 'ofir', 'ilai'))
  );
$$;

-- ── Clients of one person (not the office) ──
-- Assigned: their editing (the main shoot or any round), or a task of theirs that is
-- open or was finished in the last 30 days. This is also what opens the vault.
create or replace function private.my_assigned_clients() returns setof uuid
language sql stable security definer set search_path = '' as $$
  with me as (select public.my_person() as p)
  select c.id from public.clients c, me
  where me.p is not null and (
    c.editor = me.p
    or exists (select 1 from jsonb_array_elements(c.rounds) r where r ->> 'editor' = me.p))
  union
  select t.client_id from public.client_tasks t, me
  where t.owner = me.p and (t.done_at is null or t.done_at > now() - interval '30 days');
$$;

-- Everything they may see: the assigned clients, plus every Natali client for
-- Nirel, plus the clients with a shoot day from 7 days ago to 30 days ahead for Eli
-- (Israel days; a round's date that does not read as a time is skipped).
create or replace function private.my_clients() returns setof uuid
language sql stable security definer set search_path = '' as $$
  with me as (select public.my_person() as p),
       today as (select (now() at time zone 'Asia/Jerusalem')::date as d)
  select a.id from private.my_assigned_clients() as a(id)
  union
  select c.id from public.clients c, me
  where me.p = 'nirel' and c.shoot_type = 'natali'
  union
  select c.id from public.clients c, me, today
  where me.p = 'eli' and exists (
    select 1 from (
      select c.shoot_at as at
      union all
      select case when pg_input_is_valid(r ->> 'shoot_at', 'timestamptz') then (r ->> 'shoot_at')::timestamptz end
      from jsonb_array_elements(c.rounds) r
    ) s
    where (s.at at time zone 'Asia/Jerusalem')::date between today.d - 7 and today.d + 30);
$$;

-- ── The rule, for one client ─────────────────
create or replace function public.can_see_client(p_client uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_office() or exists (select 1 from private.my_clients() as m(id) where m.id = p_client);
$$;

-- The access vault of one client (the card asks before showing the logins).
create or replace function public.can_use_client_vault(p_client uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.can_use_vault() and (public.is_office()
    or exists (select 1 from private.my_assigned_clients() as m(id) where m.id = p_client));
$$;

revoke execute on function public.my_person() from public, anon;
revoke execute on function public.is_office() from public, anon;
revoke execute on function private.my_assigned_clients() from public, anon;
revoke execute on function private.my_clients() from public, anon;
revoke execute on function public.can_see_client(uuid) from public, anon;
revoke execute on function public.can_use_client_vault(uuid) from public, anon;
grant execute on function public.my_person() to authenticated;
grant execute on function public.is_office() to authenticated;
grant execute on function private.my_assigned_clients() to authenticated;
grant execute on function private.my_clients() to authenticated;
grant execute on function public.can_see_client(uuid) to authenticated;
grant execute on function public.can_use_client_vault(uuid) to authenticated;

-- ── Policies ─────────────────────────────────
-- (select …) around a function without arguments: computed once per query.

-- Clients: seen by the rule; added and changed by the office.
drop policy if exists "staff manage clients" on public.clients;
create policy "see own clients" on public.clients
  for select to authenticated
  using ((select public.is_office()) or id in (select private.my_clients()));
create policy "office adds clients" on public.clients
  for insert to authenticated
  with check ((select public.is_office()));
create policy "office edits clients" on public.clients
  for update to authenticated
  using ((select public.is_office())) with check ((select public.is_office()));

-- Protocol checks: read and written only on clients one can see.
drop policy if exists "staff manage checks" on public.protocol_checks;
create policy "checks of own clients" on public.protocol_checks
  for all to authenticated
  using ((select public.is_office()) or client_id in (select private.my_clients()))
  with check ((select public.is_office()) or client_id in (select private.my_clients()));

-- The history (written only by the trigger).
drop policy if exists "staff read log" on public.protocol_log;
create policy "history of own clients" on public.protocol_log
  for select to authenticated
  using ((select public.is_office()) or client_id in (select private.my_clients()));

-- Tasks: on clients one can see, for anyone (an exception reported to Lior).
drop policy if exists "staff manage tasks" on public.client_tasks;
create policy "tasks of own clients" on public.client_tasks
  for all to authenticated
  using ((select public.is_office()) or client_id in (select private.my_clients()))
  with check ((select public.is_office()) or client_id in (select private.my_clients()));

-- Ofir's weekly summaries and the daily reviews: the office only.
drop policy if exists "staff manage status notes" on public.client_status_notes;
create policy "office manages status notes" on public.client_status_notes
  for all to authenticated
  using ((select public.is_office())) with check ((select public.is_office()));
drop policy if exists "staff manage reviews" on public.office_reviews;
create policy "office manages reviews" on public.office_reviews
  for all to authenticated
  using ((select public.is_office())) with check ((select public.is_office()));

-- The vault's rows (network, user name) and their log: the vault flag and an
-- assigned client. Writes still go only through the functions below.
drop policy if exists "vault users read access" on public.client_access;
drop policy if exists "vault users read access log" on public.client_access_log;
create policy "vault of assigned clients" on public.client_access
  for select to authenticated
  using ((select public.can_use_vault())
    and ((select public.is_office()) or client_id in (select private.my_assigned_clients())));
create policy "vault log of assigned clients" on public.client_access_log
  for select to authenticated
  using ((select public.can_use_vault())
    and ((select public.is_office()) or client_id in (select private.my_assigned_clients())));

-- ── The vault's functions check the client too ──
create or replace function public.access_save(
  p_client uuid, p_id uuid, p_network text, p_label text, p_username text, p_password text, p_status text, p_note text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  rid uuid := p_id;
  sid uuid;
begin
  if not public.can_use_client_vault(p_client) then raise exception 'not allowed'; end if;
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

create or replace function public.access_reveal(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  a public.client_access;
  secret text;
begin
  if not public.can_use_vault() then raise exception 'not allowed'; end if;
  select * into a from public.client_access where id = p_id;
  if a.id is null then raise exception 'access not found'; end if;
  if not public.can_use_client_vault(a.client_id) then raise exception 'not allowed'; end if;
  if a.secret_id is null then return null; end if;
  select decrypted_secret into secret from vault.decrypted_secrets where id = a.secret_id;
  insert into public.client_access_log (access_id, client_id, network, action, by_email)
  values (a.id, a.client_id, a.network, 'reveal', me);
  return secret;
end $$;

create or replace function public.access_delete(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  a public.client_access;
begin
  if not public.can_use_vault() then raise exception 'not allowed'; end if;
  select * into a from public.client_access where id = p_id;
  if a.id is null then return; end if;
  if not public.can_use_client_vault(a.client_id) then raise exception 'not allowed'; end if;
  if a.secret_id is not null then delete from vault.secrets where id = a.secret_id; end if;
  delete from public.client_access where id = a.id;
  insert into public.client_access_log (access_id, client_id, network, action, by_email)
  values (a.id, a.client_id, a.network, 'delete', me);
end $$;
