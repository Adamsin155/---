-- The owner changes things from Claude on the phone (the owner, 9.11.2026; docs/ops.md, section 116).
-- The mcp function's write tools (supabase/functions/mcp/write-tools.js) write with the owner's own
-- OAuth token, so row level security, the triggers and the stamps are the app's. Two things here:
--   1. public.system_requests   "בקשת שינוי/תיקון למערכת": a free-text request about the system itself,
--                               recorded from Claude; the developer (Claude Code) reads the list.
--                               The owners only. Nothing is deleted (no delete grant).
--   2. public.mcp_request_gate()  as in 20261128100000_managers_all.sql, unchanged for everyone, plus:
--                               a connected app's token that carries the mcp function's key AND is an
--                               owner's (private.is_owner()) may also use what the write tools use
--                               (WRITE_GATE in supabase/functions/mcp/write-tools.js; the test
--                               tests/sql/mcp-write.test.mjs holds the lists equal). Lior's and Ofir's
--                               tokens stay read-only. The browser's own sessions are untouched: the
--                               first line still returns for any request without client_id.
-- Only adds and replaces functions; nothing is dropped. Safe to run twice.
-- The way back for the gate (the read-only gate of 4.11.2026): run section 7 of
-- 20261128100000_managers_all.sql again. The emergency line of docs/ops.md, section 84, still holds.

-- ── 1. Requests for a change to the system ──
create table if not exists public.system_requests (
  id uuid primary key default gen_random_uuid(),
  body text not null check (length(btrim(body)) between 1 and 2000),
  source text not null default 'claude' check (source in ('claude', 'app')),
  created_by_email text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  created_at timestamptz not null default now(),
  -- Filled by the developer when it is handled (from the SQL editor or a later screen).
  handled_at timestamptz,
  handled_note text check (handled_note is null or length(handled_note) <= 1000)
);
create index if not exists system_requests_open_idx on public.system_requests (created_at desc) where handled_at is null;

alter table public.system_requests enable row level security;
revoke all on table public.system_requests from public, anon, authenticated;
grant select on table public.system_requests to authenticated;
grant insert (body) on table public.system_requests to authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'system_requests' and policyname = 'system_requests_owner_read') then
    create policy system_requests_owner_read on public.system_requests for select to authenticated using ((select private.mcp_owner()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'system_requests' and policyname = 'system_requests_owner_insert') then
    create policy system_requests_owner_insert on public.system_requests for insert to authenticated
      with check ((select private.mcp_owner()) and created_by_email = lower(coalesce(auth.jwt() ->> 'email', '')) and handled_at is null and handled_note is null);
  end if;
end $$;

-- ── 2. The gate ──
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
    and sent = (select g.key from private.mcp_gate g where g.id) then
    -- Everyone switched on (the owners, Lior, Ofir): the read tools and who-is-asking.
    if (method in ('GET', 'HEAD') and path in (
          '/clients', '/client_tasks', '/staff_tasks', '/protocol_checks', '/editor_progress', '/editor_progress_month',
          '/client_gantt', '/deal_requests', '/quotes', '/client_files'))
      or (method = 'POST' and path in (
          '/rpc/is_office', '/rpc/my_person', '/rpc/mcp_allowed', '/rpc/sees_money', '/rpc/sees_income')) then
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
          '/rpc/deal_take')))
      and private.is_owner() then
      return;
    end if;
  end if;
  raise exception 'not available to a connected app' using errcode = '42501';
end $$;
-- Every role PostgREST can become has to be able to run it, or nothing works.
grant execute on function public.mcp_request_gate() to public;

alter role authenticator set pgrst.db_pre_request = 'public.mcp_request_gate';
notify pgrst, 'reload config';
