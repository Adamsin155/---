-- The owner's decision of 3.11.2026: Lior's protocol work is four things only (docs/ops.md,
-- section 92): the campaign (30, one item with its start date and daily budget), a pre-shoot form
-- (36, shown as "11ג"), the scripts as one Google Docs link (12) and the Zoom (13, one item).
-- Everything else of his (2, 6, 10, 11ב, 12א, 15–21, 22א's drive, 31) left the protocol.
-- Protocol version 12. The protocol itself is data in app/protocol.js; the items that left are
-- `retired` there, for every client whatever version it started under: no list, no reminder, no
-- lateness. Their marks stay in the history as they are. The database needs four things:
--   1. the history of clients that were already past the two new items when they came (the
--      pre-shoot form of a shoot that already took place; the scripts link where the scripts were
--      already written or the Zoom already held);
--   2. the version;
--   3. the scripts' Google Docs link (clients.links.scripts_doc) closing the item by itself;
--   4. the writers table (no row changes: the new items are Lior's, and the office writes every
--      key; the block is written again so the newest one is this version's).
-- Additive only: no table, no column, no policy; marks are added, never changed or taken away.
-- Every statement can run again safely. Tested with every migration in a real Postgres:
-- tests/sql/lior-four.test.mjs.

-- ── 1. Clients that were past the new items before they existed ──
-- Imported history (note 'ייבוא'): done, never counted as work or late. Only on the move to
-- version 12: run again later, this must not close an item that is really waiting.
do $$
begin
  if private.protocol_version_current() < 12 then
    -- The pre-shoot form of a shoot that is behind the client: its date passed, or the day was
    -- closed (19), or an editor was already assigned (22א).
    insert into public.protocol_checks (client_id, item_key, state, note)
    select c.id, 'p36.form', 'done', 'ייבוא'
    from public.clients c
    where c.shoot_at < now()
       or exists (select 1 from public.protocol_checks x where x.client_id = c.id
                  and x.item_key in ('p19.all', 'p19.drive', 'p19.took', 'p22a.assigned') and x.state in ('done', 'na'))
    on conflict (client_id, item_key) do nothing;

    -- The same for each extra shoot round whose own date passed.
    insert into public.protocol_checks (client_id, item_key, state, note)
    select c.id, 'r' || (e ->> 'n') || '.p36.form', 'done', 'ייבוא'
    from public.clients c
    cross join lateral jsonb_array_elements(case when jsonb_typeof(c.rounds) = 'array' then c.rounds else '[]'::jsonb end) e
    where (e ->> 'n') ~ '^[0-9]{1,3}$'
      and pg_input_is_valid(e ->> 'shoot_at', 'timestamptz') and (e ->> 'shoot_at')::timestamptz < now()
    on conflict (client_id, item_key) do nothing;

    -- The scripts link where the scripts were already written (12) or the Zoom held (13).
    insert into public.protocol_checks (client_id, item_key, state, note)
    select distinct x.client_id, coalesce(substring(x.item_key from '^(r[0-9]+\.)'), '') || 'p12.link', 'done', 'ייבוא'
    from public.protocol_checks x
    where x.item_key ~ '^(r[0-9]+\.)?(p12\.(docs|scripts)|p13\.(zoom|approved))$' and x.state in ('done', 'na')
    on conflict (client_id, item_key) do nothing;
  end if;
end $$;

-- ── 2. Protocol version 12 ────────────────────
create or replace function private.protocol_version_current() returns integer
language sql immutable set search_path = '' as $$ select 12 $$;
revoke all on function private.protocol_version_current() from public, anon, authenticated;
alter table public.clients alter column protocol_version set default 12;

-- ── 3. The scripts' link closes the scripts item ──
-- Saving the Google Docs link with all the scripts (clients.links.scripts_doc, an https://
-- address: public.clients_links_guard) closes "הקישור לקובץ התסריטים נשמר" (p12.link) of the
-- client's own shoot and of every extra round that has begun (its start_at passed), where it is
-- still open. A mark already done keeps its time and its words. The same rule as the app's
-- scriptsKeysToClose (app/lior-four.js), which writes it too when this trigger is not there yet.
create or replace function public.clients_scripts_doc_saved() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_new text := nullif(btrim(coalesce(new.links ->> 'scripts_doc', '')), '');
  v_old text := case when tg_op = 'UPDATE' then nullif(btrim(coalesce(old.links ->> 'scripts_doc', '')), '') end;
  v_note constant text := 'נסגר לבד: נשמר הקישור לקובץ התסריטים';
begin
  if v_new is null or v_new is not distinct from v_old then return new; end if;
  insert into public.protocol_checks (client_id, item_key, state, note)
  select new.id, k, 'done', v_note
  from (
    select 'p12.link' as k
    union all
    select 'r' || (e ->> 'n') || '.p12.link'
    from jsonb_array_elements(case when jsonb_typeof(new.rounds) = 'array' then new.rounds else '[]'::jsonb end) e
    where (e ->> 'n') ~ '^[0-9]{1,3}$'
      and pg_input_is_valid(e ->> 'start_at', 'timestamptz') and (e ->> 'start_at')::timestamptz <= now()
  ) keys
  on conflict (client_id, item_key) do update set state = 'done', note = excluded.note
    where public.protocol_checks.state not in ('done', 'na');
  return new;
end $$;
-- Trigger functions are not an API: only the trigger calls them.
revoke execute on function public.clients_scripts_doc_saved() from public, anon, authenticated;
create or replace trigger clients_zz_scripts_doc after insert or update of links on public.clients
for each row execute function public.clients_scripts_doc_saved();

-- ── 4. Who writes which protocol item (v12) ──
-- The new items (p36.form, p12.link) are Lior's, and the office writes every key, so no row is
-- added; the items that left were Lior's and Irit's (the office), so no row goes either.
