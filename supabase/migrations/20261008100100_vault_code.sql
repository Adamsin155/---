-- "קוד הכספת": one shared code of exactly 6 digits that opens the passwords of the
-- access vault (the owner's decision of 6.10.2026; docs/ops.md, section 29).
--
--   - Only the owner (a staff row with no person) sets or changes the code
--     (vault_code_set), from the card "קוד הכספת" on the team page. It is kept only as
--     a salted hash (pgcrypto's crypt with a Blowfish salt), in the private schema,
--     which the API does not expose; no function returns the code or its hash.
--   - Trivially weak codes are refused: one digit six times, and a run going up or
--     down (123456, 654321, 012345, 890123…).
--   - A password is shown (access_reveal: the only function that returns a stored
--     password) only after an unlock: the caller types the code once, vault_unlock
--     checks it here and records an unlock for THAT user for 10 minutes (a row in
--     private.vault_unlocks: nothing in the browser decides). After it, the code is
--     asked again. "נעילה עכשיו" ends it (vault_lock).
--   - 5 wrong codes lock that user for 15 minutes. Counted here, per user. Every wrong
--     code and every lockout is logged for the owner (public.vault_code_log: who and
--     when, never what was typed).
--   - Changing the code ends everyone's unlocks and lockouts.
--   - Until a code has been set the vault works exactly as before: nothing is locked
--     by surprise. vault_code_status() tells the page which it is.
--   - Who may use the vault at all does not change (staff.vault and
--     can_use_client_vault). Saving a login, the list, the statuses and the log are
--     not gated: only viewing a password.
--
-- After 20261008100000_client_access_form.sql. Every statement can run again safely;
-- a code already set stays. Tested in a real Postgres: tests/sql/vault-code.test.mjs.

-- ── Tables ───────────────────────────────────
-- The code: one row at most. In `private`, which PostgREST does not serve.
create table if not exists private.vault_code (
  id boolean primary key default true check (id),
  code_hash text not null,
  set_at timestamptz not null default now(),
  set_by text not null default ''
);
-- Each user's unlock, wrong attempts and lockout.
create table if not exists private.vault_unlocks (
  email text primary key,
  unlocked_until timestamptz,
  failed integer not null default 0 check (failed >= 0),
  locked_until timestamptz,
  last_failed_at timestamptz
);
revoke all on private.vault_code, private.vault_unlocks from public, anon, authenticated;

-- What happened, for the owner: who and when. Never a code.
create table if not exists public.vault_code_log (
  id bigint generated always as identity primary key,
  email text not null,
  event text not null check (event in ('set', 'changed', 'unlocked', 'wrong', 'lockout', 'locked')),
  at timestamptz not null default now()
);
create index if not exists vault_code_log_at_idx on public.vault_code_log (at desc);
-- The owner (a staff row with no person), as a policy may ask it (private.is_owner()
-- itself is not granted to the API's roles).
create or replace function public.is_vault_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_owner();
$$;
revoke execute on function public.is_vault_owner() from public, anon;
grant execute on function public.is_vault_owner() to authenticated;

alter table public.vault_code_log enable row level security;
drop policy if exists "owner reads the vault code log" on public.vault_code_log;
create policy "owner reads the vault code log" on public.vault_code_log
  for select to authenticated using ((select public.is_vault_owner()));
revoke all on public.vault_code_log from anon, authenticated;
grant select on public.vault_code_log to authenticated;

-- ── Helpers ──────────────────────────────────
-- A code that is no code: not six digits apart, one digit six times, or a run going
-- up or down by one (wrapping 9→0). The same rule as weakCode() in app/vault-code.js.
create or replace function private.vault_code_weak(p_code text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  up boolean := true;
  down boolean := true;
  same boolean := true;
  a integer;
  b integer;
begin
  if p_code is null or p_code !~ '^[0-9]{6}$' then return true; end if;
  for i in 1..5 loop
    a := substr(p_code, i, 1)::integer;
    b := substr(p_code, i + 1, 1)::integer;
    if b <> a then same := false; end if;
    if b <> (a + 1) % 10 then up := false; end if;
    if b <> (a + 9) % 10 then down := false; end if;
  end loop;
  return same or up or down;
end $$;

-- May this user see a password now: no code was ever set, or their unlock is alive.
create or replace function private.vault_open() returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from private.vault_code)
    or exists (select 1 from private.vault_unlocks u
               where u.email = lower(coalesce(auth.jwt() ->> 'email', '')) and u.unlocked_until > now());
$$;
revoke execute on function private.vault_code_weak(text) from public, anon, authenticated;
revoke execute on function private.vault_open() from public, anon, authenticated;

-- ── The owner sets or changes the code ───────
create or replace function public.vault_code_set(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  had boolean;
begin
  if not private.is_owner() then raise exception 'not allowed: owner only' using errcode = '42501'; end if;
  if p_code is null or p_code !~ '^[0-9]{6}$' then raise exception 'the code is exactly 6 digits' using errcode = '22023'; end if;
  if private.vault_code_weak(p_code) then raise exception 'weak code' using errcode = '22023'; end if;
  select exists (select 1 from private.vault_code) into had;
  insert into private.vault_code (id, code_hash, set_at, set_by)
  values (true, extensions.crypt(p_code, extensions.gen_salt('bf', 10)), now(), me)
  on conflict (id) do update set code_hash = excluded.code_hash, set_at = excluded.set_at, set_by = excluded.set_by;
  -- Everyone's unlocks end, and so do the counts and lockouts of the code before it.
  delete from private.vault_unlocks;
  insert into public.vault_code_log (email, event) values (me, case when had then 'changed' else 'set' end);
  return jsonb_build_object('set', true, 'changedAt', now());
end $$;

-- ── Typing the code ──────────────────────────
-- { state: 'open', until } | { state: 'wrong', left } | { state: 'locked', until }
-- | { state: 'none' } (no code was set: nothing to open). A wrong code is an answer,
-- not an error, so that its count is kept.
create or replace function public.vault_unlock(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  u private.vault_unlocks;
  v_hash text;
  v_until timestamptz;
begin
  if me = '' or not public.can_use_vault() then raise exception 'not allowed' using errcode = '42501'; end if;
  select code_hash into v_hash from private.vault_code;
  if v_hash is null then return jsonb_build_object('state', 'none'); end if;
  insert into private.vault_unlocks (email) values (me) on conflict (email) do nothing;
  select * into u from private.vault_unlocks where email = me for update;
  if u.locked_until is not null and u.locked_until > now() then
    return jsonb_build_object('state', 'locked', 'until', u.locked_until);
  end if;
  if u.locked_until is not null then
    -- A lockout that ended: five new attempts.
    u.failed := 0;
    update private.vault_unlocks set failed = 0, locked_until = null where email = me;
  end if;
  if p_code is not null and p_code ~ '^[0-9]{6}$' and extensions.crypt(p_code, v_hash) = v_hash then
    v_until := now() + interval '10 minutes';
    update private.vault_unlocks set unlocked_until = v_until, failed = 0, locked_until = null where email = me;
    insert into public.vault_code_log (email, event) values (me, 'unlocked');
    return jsonb_build_object('state', 'open', 'until', v_until);
  end if;
  if u.failed + 1 >= 5 then
    v_until := now() + interval '15 minutes';
    update private.vault_unlocks set failed = 0, locked_until = v_until, unlocked_until = null, last_failed_at = now() where email = me;
    insert into public.vault_code_log (email, event) values (me, 'wrong'), (me, 'lockout');
    return jsonb_build_object('state', 'locked', 'until', v_until);
  end if;
  update private.vault_unlocks set failed = failed + 1, last_failed_at = now() where email = me;
  insert into public.vault_code_log (email, event) values (me, 'wrong');
  return jsonb_build_object('state', 'wrong', 'left', 4 - u.failed);
end $$;

-- "נעילה עכשיו": this user's unlock ends.
create or replace function public.vault_lock() returns void
language plpgsql security definer set search_path = '' as $$
declare me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if me = '' or not public.is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  update private.vault_unlocks set unlocked_until = null where email = me and unlocked_until > now();
  if found then insert into public.vault_code_log (email, event) values (me, 'locked'); end if;
end $$;

-- What the pages may know: whether a code exists and when it was last changed (never
-- the code), and for the caller: open until when, locked until when, attempts left.
create or replace function public.vault_code_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  c private.vault_code;
  u private.vault_unlocks;
begin
  if not public.is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into c from private.vault_code;
  select * into u from private.vault_unlocks where email = me;
  return jsonb_build_object(
    'set', c.id is not null,
    'changedAt', c.set_at,
    'owner', private.is_owner(),
    'openUntil', case when u.unlocked_until > now() then u.unlocked_until end,
    'lockedUntil', case when u.locked_until > now() then u.locked_until end,
    'left', case when u.locked_until > now() then 0 else 5 - coalesce(u.failed, 0) end);
end $$;

-- ── A password is shown only with an unlock ──
-- As in 20261003140000_manager_features.sql / 20260930130000_assignment_rls.sql, plus the code.
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
  if not private.vault_open() then raise exception 'vault locked: the code is needed' using errcode = '42501'; end if;
  if a.secret_id is null then return null; end if;
  select decrypted_secret into secret from vault.decrypted_secrets where id = a.secret_id;
  insert into public.client_access_log (access_id, client_id, network, action, by_email)
  values (a.id, a.client_id, a.network, 'reveal', me);
  return secret;
end $$;

-- ── Grants ───────────────────────────────────
revoke all on function public.vault_code_set(text) from public, anon;
revoke all on function public.vault_unlock(text) from public, anon;
revoke all on function public.vault_lock() from public, anon;
revoke all on function public.vault_code_status() from public, anon;
revoke execute on function public.access_reveal(uuid) from public, anon;
grant execute on function public.vault_code_set(text) to authenticated;
grant execute on function public.vault_unlock(text) to authenticated;
grant execute on function public.vault_lock() to authenticated;
grant execute on function public.vault_code_status() to authenticated;
grant execute on function public.access_reveal(uuid) to authenticated;
