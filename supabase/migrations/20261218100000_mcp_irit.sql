-- Irit may be switched on for the Claude connector (the owner, 17.11.2026; docs/ops.md, section 142):
-- the free-text contract drafts of prepare_contract_draft are for the owners, Ofir, Lior and Irit,
-- the people who prepare contracts. Until now the connector's people were the owners, Lior and Ofir
-- (supabase/migrations/20261121100000_mcp.sql).
--
-- What changes: Irit is one of the people of the switch (public.mcp_allowed, public.mcp_people,
-- public.mcp_set_access). What does not: nobody is switched on by this file. Irit stays off until an
-- owner switches her on in the owner's card (צוות → Claude), as anyone added later. The owners' write
-- tools stay the owners' alone (public.my_person() null; supabase/functions/mcp/write-tools.js).
-- The people equal MCP_PEOPLE in app/mcp-logic.js (tests/sql/mcp-irit.test.mjs).
--
-- Only replaces functions (create or replace). Runs again safely.

create or replace function public.mcp_allowed() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff() and exists (
    select 1 from public.staff s
    join public.mcp_access a on a.email = s.email
    where s.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (s.person is null or s.person in ('lior', 'ofir', 'irit'))
      and a.enabled);
$$;
revoke execute on function public.mcp_allowed() from public, anon;
grant execute on function public.mcp_allowed() to authenticated;

create or replace function public.mcp_people()
returns table (email text, person text, enabled boolean, last_used timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.email, s.person, coalesce(a.enabled, false),
    (select max(u.at) from public.mcp_usage u where u.email = s.email and u.code = 'ok')
  from public.staff s
  left join public.mcp_access a on a.email = s.email
  where private.is_owner() and (s.person is null or s.person in ('lior', 'ofir', 'irit'))
  order by s.person nulls first, s.email;
$$;
revoke execute on function public.mcp_people() from public, anon;
grant execute on function public.mcp_people() to authenticated;

create or replace function public.mcp_set_access(p_email text, p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  who text := lower(coalesce(p_email, ''));
begin
  if not private.is_owner() or coalesce(auth.jwt() ->> 'client_id', '') <> '' then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_enabled is null or not exists (
    select 1 from public.staff s where s.email = who and (s.person is null or s.person in ('lior', 'ofir', 'irit'))
  ) then
    raise exception 'not one of the people of this switch' using errcode = '22023';
  end if;
  insert into public.mcp_access (email, enabled, updated_by, updated_at)
  values (who, p_enabled, lower(coalesce(auth.jwt() ->> 'email', '')), now())
  on conflict (email) do update set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end $$;
revoke execute on function public.mcp_set_access(text, boolean) from public, anon;
grant execute on function public.mcp_set_access(text, boolean) to authenticated;
