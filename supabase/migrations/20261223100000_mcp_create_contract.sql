-- "create_contract" from Claude (the owner, 23.11.2026; docs/ops.md, section 149): whoever builds contracts
-- (the owners, Lior, Ofir, Irit) creates a contract from Claude with the client's details typed in the chat,
-- as the builder does. The contract is created by the create-quote function; it asks
-- public.can_edit_quotes() when the deal sets the price (a free-hand contract), which the gate refused to a
-- connected app until now (so even the owner's send_contract of a free-hand contract was refused).
--
-- Only the gate changes: '/rpc/can_edit_quotes' joins what everyone switched on may ask (a yes/no about
-- themselves). Everything else as in 20261207100000_mcp_write.sql. Runs again safely.
--
-- The way back: run section 2 of 20261207100000_mcp_write.sql again.

create or replace function public.mcp_request_gate() returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  claims text := current_setting('request.jwt.claims', true);
  client text;
  method text;
  path text;
  sent text;
  owner boolean := false;
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
    and sent = (select g.key from private.mcp_gate g where g.id) then
    -- Everyone switched on (the owners, Lior, Ofir): the read tools and who-is-asking.
    if (method in ('GET', 'HEAD') and path in (
          '/clients', '/client_tasks', '/staff_tasks', '/protocol_checks', '/editor_progress', '/editor_progress_month',
          '/client_gantt', '/deal_requests', '/quotes', '/client_files'))
      or (method = 'POST' and path in (
          '/rpc/is_office', '/rpc/my_person', '/rpc/mcp_allowed', '/rpc/sees_money', '/rpc/sees_income',
          '/rpc/can_edit_quotes')) then
      return;
    end if;
    -- An owner: what the write tools use, and nothing else.
    if ((method in ('GET', 'HEAD') and path in ('/client_scripts', '/photographer_months', '/photographer_changes', '/staff_notes'))
        or (method = 'POST' and path in ('/protocol_checks', '/staff_notes', '/system_requests'))
        or (method = 'PATCH' and path in ('/clients', '/client_tasks', '/deal_requests'))
        or (method = 'DELETE' and path in ('/protocol_checks'))
        or (method = 'POST' and path in (
          '/rpc/staff_task_create', '/rpc/staff_task_create_brief', '/rpc/staff_task_done', '/rpc/staff_task_cancel', '/rpc/staff_note_delete',
          '/rpc/date_change_note', '/rpc/photographer_taken', '/rpc/photographer_taken_by', '/rpc/clients_private', '/rpc/clients_contact',
          '/rpc/deal_take'))) then
      -- Anything odd in the token (a sub that is not a uuid) is a no, never another error.
      begin
        owner := coalesce(private.is_owner(), false);
      exception when others then
        owner := false;
      end;
      if owner then
        return;
      end if;
    end if;
  end if;
  raise exception 'not available to a connected app' using errcode = '42501';
end $$;
grant execute on function public.mcp_request_gate() to public;
notify pgrst, 'reload config';
