-- Setting the vault code failed on the live project with "DELETE requires a WHERE
-- clause" (6.10.2026): Supabase loads pg-safeupdate for the API roles, and it refuses
-- a DELETE with no WHERE even inside a security-definer function. The test database
-- (PGlite) has no such guard, so the tests passed. The same function as in
-- 20261008100100_vault_code.sql, with the clearing of the unlocks written with a WHERE.
-- Safe to run again; moves no data.

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
  delete from private.vault_unlocks where true;
  insert into public.vault_code_log (email, event) values (me, case when had then 'changed' else 'set' end);
  return jsonb_build_object('set', true, 'changedAt', now());
end $$;
revoke all on function public.vault_code_set(text) from public, anon;
grant execute on function public.vault_code_set(text) to authenticated;
