-- 7ב and 23ב close by themselves from the content Gantt (the owner, 16.11.2026; docs/ops.md,
-- section 138). Ilai had 84 "late" items of "7ב · העלאת 9 הגרפיקות שאושרו לרשתות" although he
-- schedules the graphics: the protocol waited for a mark nobody pressed ("הועלו"), and the Gantt,
-- where the work is really seen (Ilai's own marks, and the Metricool sync every 15 minutes), was not
-- read by it.
--
-- From here on the database closes the mark by itself, by the client's Gantt rows of kind 'graphic'
-- whose state is 'scheduled' or 'posted' (תוזמן / עלה; a cancelled one, 'skipped', is not counted):
--   7ב  p07b.posted  once the client approved the first graphics (p07.approved) and at least 9 are
--                    up (or all of them, when the client's Gantt has fewer than 9);
--   23ב p23b.posted  once the client approved the rest (p23.approved) and every graphic in the
--                    Gantt is up.
-- It happens whichever comes last: a Gantt row turning scheduled or posted (by Ilai or by the sync),
-- or the approval being marked. A mark that is already there (done, or "לא רלוונטי") is never
-- touched; a person can still mark it by hand as before. The mark is written as the system's
-- (by_email 'system': "אוטומטי" in the card, as the other marks the system makes) with the count in
-- its note. Nothing is ever cleared: a row that goes back to planned leaves the mark as it is.
--
-- The clients that are already behind are closed at the end of this file (section 4), only where the
-- Gantt already shows the graphics up; where it does not, the item stays open, as today: there the
-- graphics are really not in the Gantt.
--
-- Only adds: two functions and two triggers, then one pass over the active clients. No table,
-- column, policy or right changes; no row is removed or changed, only missing marks are added.
-- Safe to run again. Tested in a real Postgres: tests/sql/graphics-from-gantt.test.mjs.
-- Not run: waits for the owner's "מאשר להריץ את ה-SQL".

-- ── 1. The rule, for one client ──────────────
create or replace function private.graphics_up_marks(p_client uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_total integer;
  v_up integer;
  v_claims text;
  n integer := 0;
  k integer;
begin
  if p_client is null or not exists (select 1 from public.clients c where c.id = p_client and c.status in ('active', 'ending'))
     or private.is_archived(p_client) then
    return 0;
  end if;
  select count(*) filter (where g.state <> 'skipped'), count(*) filter (where g.state in ('scheduled', 'posted'))
    into v_total, v_up
  from public.client_gantt g where g.client_id = p_client and g.kind = 'graphic';
  if coalesce(v_up, 0) = 0 then return 0; end if;
  -- The marks are the system's, whoever's change set them off (Ilai in the Gantt, Irit marking the
  -- approval, the sync): public.protocol_stamp() writes 'system' when there is no signed-in email.
  v_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claims', '{}', true);
  -- 7ב: the first 9.
  if exists (select 1 from public.protocol_checks k0 where k0.client_id = p_client and k0.item_key = 'p07.approved' and k0.state = 'done')
     and v_up >= least(9, v_total) then
    insert into public.protocol_checks (client_id, item_key, state, note)
    values (p_client, 'p07b.posted', 'done', 'נסגר לבד מהגאנט: ' || v_up || ' גרפיקות תוזמנו או עלו')
    on conflict (client_id, item_key) do nothing;
    get diagnostics k = row_count; n := n + k;
  end if;
  -- 23ב: the rest, every graphic of the Gantt.
  if exists (select 1 from public.protocol_checks k0 where k0.client_id = p_client and k0.item_key = 'p23.approved' and k0.state = 'done')
     and v_up >= v_total then
    insert into public.protocol_checks (client_id, item_key, state, note)
    values (p_client, 'p23b.posted', 'done', 'נסגר לבד מהגאנט: כל ' || v_total || ' הגרפיקות בגאנט תוזמנו או עלו')
    on conflict (client_id, item_key) do nothing;
    get diagnostics k = row_count; n := n + k;
  end if;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  return n;
end $$;
revoke all on function private.graphics_up_marks(uuid) from public, anon, authenticated;

-- ── 2. When a Gantt graphic goes up ──────────
create or replace function private.client_gantt_graphics_up() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.graphics_up_marks(new.client_id);
  return null;
end $$;
revoke all on function private.client_gantt_graphics_up() from public, anon, authenticated;

create or replace trigger client_gantt_graphics_up after insert or update of state, kind on public.client_gantt
for each row when (new.kind = 'graphic' and new.state in ('scheduled', 'posted'))
execute function private.client_gantt_graphics_up();

-- ── 3. When the client's approval is marked ──
create or replace function private.protocol_checks_graphics_up() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.graphics_up_marks(new.client_id);
  return null;
end $$;
revoke all on function private.protocol_checks_graphics_up() from public, anon, authenticated;

create or replace trigger protocol_checks_graphics_up after insert or update of state on public.protocol_checks
for each row when (new.item_key in ('p07.approved', 'p23.approved') and new.state = 'done')
execute function private.protocol_checks_graphics_up();

-- ── 4. The clients already behind ────────────
select private.graphics_up_marks(c.id) from public.clients c where c.status in ('active', 'ending');
