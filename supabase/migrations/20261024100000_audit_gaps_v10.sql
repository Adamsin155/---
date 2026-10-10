-- The owner's approval of 10.10.2026 after the audit of the written protocols against the
-- system (docs/ops.md, section 58): protocol version 10. The protocol itself is data in
-- app/protocol.js. The database needs six things:
--   1. the clients that are already past a step version 10 added (never reopened);
--   2. the version;
--   3. "הלקוח ביקש תיקון" recorded by the office: the same task, by the same code, as a
--      fix the client writes on the status page;
--   4. a task given on the spot ("נודניק") to Nirel carries her mandatory brief;
--   5. the writers table (the new items, and the photographer's own marks);
--   6. nothing else: no table, no policy, no trigger. One column is added (staff_tasks.brief).
-- Additive: marks are added, never changed; functions are replaced in place with the same
-- signature, or added. Every statement can run again safely. Tested with every migration
-- in a real Postgres: tests/sql/audit-gaps.test.mjs.

-- ── 1. The clients that are already there ────
-- Only on the move to version 10 (run again later, this must not close a step that is
-- really waiting, so it looks at the version before raising it):
--   a. 29ב, Ilai's final check (new, 14 items): for every shoot of every client whose Gantt
--      was already sent (p29.sent, or rN.p29.sent in a shoot round), the check is history
--      (note 'ייבוא': done, never counted as work or late, never reopened).
--   b. the five critical mistakes in the editor's self-check (p22.self.*): where the four
--      self-checks that existed were all ticked, the editor finished his self-check before
--      the five existed, and they are marked "לא רלוונטי" with a note that says why. (An
--      editing that was already handed to Ofir, and videos Ofir already approved, are not
--      asked by the app itself: `passedIf` in app/protocol.js.)
do $$
begin
  if private.protocol_version_current() < 10 then
    insert into public.protocol_checks (client_id, item_key, state, note)
    select a.client_id, coalesce(substring(a.item_key from '^(r[0-9]+\.)'), '') || k.key, 'done', 'ייבוא'
    from public.protocol_checks a
    cross join unnest(array[
      'p29b.c.nets', 'p29b.c.access', 'p29b.c.metricool', 'p29b.c.look', 'p29b.c.logo', 'p29b.c.graphics', 'p29b.c.gfiles',
      'p29b.c.vfiles', 'p29b.c.vsched', 'p29b.c.gsched', 'p29b.c.gantt', 'p29b.c.match', 'p29b.c.updated', 'p29b.done']) as k (key)
    where a.item_key ~ '^(r[0-9]+\.)?p29\.sent$' and a.state in ('done', 'na')
    on conflict (client_id, item_key) do nothing;

    insert into public.protocol_checks (client_id, item_key, state, note)
    select s.client_id, s.pre || k.key, 'na', 'גרסה 10: הבדיקה העצמית הושלמה לפני שהפריט נוסף'
    from (
      select a.client_id, coalesce(substring(a.item_key from '^(r[0-9]+\.)'), '') as pre
      from public.protocol_checks a
      where a.item_key ~ '^(r[0-9]+\.)?p22\.self\.(spelling|broll|closing|complete)$' and a.state in ('done', 'na')
      group by 1, 2
      having count(*) = 4
    ) s
    cross join unnest(array['p22.self.sound', 'p22.self.exposure', 'p22.self.stable', 'p22.self.angles', 'p22.self.export']) as k (key)
    on conflict (client_id, item_key) do nothing;
  end if;
end $$;

-- ── 2. Protocol version 10 ───────────────────
create or replace function private.protocol_version_current() returns integer
language sql immutable set search_path = '' as $$ select 10 $$;
revoke all on function private.protocol_version_current() from public, anon, authenticated;
alter table public.clients alter column protocol_version set default 10;

-- ── 3. "הלקוח ביקש תיקון", recorded by the office ──
-- Until now only a fix the client wrote on the status page opened a task with a deadline
-- (public.request_fix, 20260930210000_hardening.sql); a fix asked for on WhatsApp hung on
-- Irit's memory. The part of request_fix that opens the task is now one private function,
-- and both ways call it: who fixes, by when (by 13:00 on a working day: that day; later,
-- or on Friday and Saturday: the next working day), the videos' notes mark, and the task
-- itself are decided in one place.
--   p_from  'status' (the client, on the page) or 'office' (written down by the office);
--   p_by    the client's name as signed, or the person who wrote it down.
create or replace function private.client_fix_open(
  p_client uuid, p_key text, p_item jsonb, p_note text, p_from text, p_by text, p_approval uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_item text := p_item ->> 'item';
  v_round integer := (p_item ->> 'round')::int;
  v_extra boolean := (p_item ->> 'round')::int > (p_item ->> 'included')::int;
  v_pre text := coalesce(substring(p_key from '^(r[0-9]+\.)'), '');
  v_owner text;
  v_marked boolean := false;
  v_local timestamp := now() at time zone 'Asia/Jerusalem';
  v_due date;
  v_task uuid := gen_random_uuid();
begin
  v_owner := case
    when v_extra then 'lior'
    when v_item = 'scripts' then 'lior'
    when v_item in ('graphics9', 'graphics') then 'ilai'
    else coalesce(nullif(p_item ->> 'editor', ''), 'ofir') end;
  if v_owner not in ('irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli') then v_owner := 'ofir'; end if;
  v_due := case
    when v_extra or v_item = 'scripts' or extract(dow from v_local) in (5, 6) or v_local::time >= time '13:00'
      then private.next_workday(v_local::date)
    else v_local::date end;
  if v_item = 'videos' and not v_extra and not exists (
      select 1 from public.protocol_checks s where s.client_id = p_client and s.item_key = v_pre || 'p27.notes' and s.state = 'done') then
    insert into public.protocol_checks (client_id, item_key, state, note)
    values (p_client, v_pre || 'p27.notes', 'done', jsonb_build_object('text', left(p_note, 1500), 'via', p_from)::text)
    on conflict (client_id, item_key) do update set state = 'done', note = excluded.note;
    v_marked := true;
  end if;
  insert into public.client_tasks (id, client_id, title, owner, due_on, source, brief)
  values (v_task, p_client,
    left(case when v_extra then 'הלקוח ביקש סבב תיקונים נוסף: ' || private.status_item_text(v_item, (p_item ->> 'shootRound')::int, 'label') || ' (להחליט ולחזור ללקוח)'
              else 'תיקון לבקשת הלקוח: ' || private.status_item_text(v_item, (p_item ->> 'shootRound')::int, 'label') || ' · סבב ' || v_round end, 500),
    v_owner, v_due, 'client_fix',
    jsonb_build_object('problem', left(p_note, 4000), 'from', p_from, 'item', v_item, 'item_key', p_key, 'round', v_round,
      'extra', v_extra, 'notes_marked', v_marked, 'approval', p_approval, 'by', p_by));
  return v_task;
end $$;
revoke all on function private.client_fix_open(uuid, text, jsonb, text, text, text, uuid) from public, anon, authenticated;

-- The client's own request (the status page): exactly as before, through the function above.
create or replace function public.request_fix(p_token text, p_key text, p_name text, p_wording text, p_note text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  l record;
  c public.clients;
  it jsonb;
  v_name text := private.clean_name(p_name);
  v_note text := btrim(coalesce(p_note, ''));
  v_wording text;
  v_now timestamptz := now();
  v_round integer;
  v_item text;
  v_task uuid;
  v_id uuid := gen_random_uuid();
begin
  select * into l from private.status_actor(p_token, p_name);
  if char_length(v_note) < 2 then raise exception 'note required' using errcode = '22023'; end if;
  if char_length(v_note) > 4000 then raise exception 'note too long' using errcode = '22023'; end if;
  select * into c from public.clients where id = l.client_id for update;
  select x.value into it from jsonb_array_elements(private.status_items(c.id)) as x where x.value ->> 'key' = p_key;
  if it is null or it ->> 'state' <> 'waiting' then
    raise exception 'not awaiting approval' using errcode = '22023';
  end if;
  v_item := it ->> 'item';
  v_round := (it ->> 'round')::int;
  v_wording := private.status_wording('fix', v_name, coalesce(nullif(btrim(c.business), ''), c.name), v_item, (it ->> 'shootRound')::int, v_round);
  if p_wording is distinct from v_wording then
    raise exception 'wording changed' using errcode = '22023';
  end if;
  v_task := private.client_fix_open(c.id, p_key, it, v_note, 'status', v_name, v_id);
  insert into public.client_approvals (id, client_id, link_id, item, item_key, shoot_round, decision, round, signer_name, note, wording,
    file_ref, version, ip, user_agent, at, evidence_hash, task_id)
  values (v_id, c.id, l.link_id, v_item, p_key, (it ->> 'shootRound')::int, 'fix', v_round, v_name, v_note, v_wording,
    it ->> 'link', it ->> 'sentAt', private.request_ip(), private.request_ua(), v_now,
    encode(extensions.digest(convert_to(concat_ws('|', c.id, p_key, 'fix', v_round, v_name, v_wording, v_note, it ->> 'link', it ->> 'sentAt',
      to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')), 'UTF8'), 'sha256'), 'hex'),
    v_task);
  return public.get_status(p_token);
end $$;
revoke all on function public.request_fix(text, text, text, text, text) from public;
grant execute on function public.request_fix(text, text, text, text, text) to anon, authenticated;

-- The office writes down a fix the client asked for outside the page (WhatsApp, a call).
-- The owner, Irit, Lior and Ofir (whoever follows the client's approvals); the item must
-- be waiting for the client's answer, exactly as on the page. No approval record is
-- written: public.client_approvals holds what the client did, and this is the office's
-- note. Returns the task that was opened.
create or replace function public.staff_request_fix(p_client uuid, p_key text, p_note text)
returns public.client_tasks
language plpgsql security definer set search_path = '' as $$
declare
  me text := public.reminder_person();
  c public.clients;
  it jsonb;
  v_note text := btrim(coalesce(p_note, ''));
  v_task uuid;
  t public.client_tasks;
begin
  if me is null or me not in ('owner', 'irit', 'lior', 'ofir') then raise exception 'not allowed' using errcode = '42501'; end if;
  if char_length(v_note) < 2 then raise exception 'note required' using errcode = '22023'; end if;
  if char_length(v_note) > 4000 then raise exception 'note too long' using errcode = '22023'; end if;
  select * into c from public.clients where id = p_client for update;
  if not found then raise exception 'client not found' using errcode = 'P0002'; end if;
  if c.status not in ('active', 'ending') then raise exception 'the client is not active' using errcode = '22023'; end if;
  select x.value into it from jsonb_array_elements(private.status_items(c.id)) as x where x.value ->> 'key' = p_key;
  if it is null or it ->> 'state' <> 'waiting' then
    raise exception 'not awaiting approval' using errcode = '22023';
  end if;
  v_task := private.client_fix_open(c.id, p_key, it, v_note, 'office', me, null);
  select * into t from public.client_tasks where id = v_task;
  return t;
end $$;
revoke all on function public.staff_request_fix(uuid, text, text) from public, anon, authenticated;
grant execute on function public.staff_request_fix(uuid, text, text) to authenticated;

-- The client's items for approval (20260930170000_client_status.sql), with one addition:
-- a fix the office wrote down is a round too. `round` counted the client's own requests
-- (public.client_approvals) and, for the videos, notes the office took from the group; a
-- request recorded by the office for the graphics or the scripts, or a later one for the
-- videos, is counted from its task (brief.from = 'office'), unless that same request is
-- already counted through the videos' notes mark it wrote (brief.notes_marked).
create or replace function private.status_items(p_client uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.clients;
  ctx record;
  spec record;
  pre text;
  k text;
  sent_at timestamptz;
  appr public.protocol_checks;
  notes public.protocol_checks;
  fixed boolean;
  used integer;
  fixing boolean;
  link text;
  out jsonb := '[]'::jsonb;
begin
  select * into c from public.clients where id = p_client;
  if not found then return out; end if;
  for ctx in
    select 1 as n, null::text as editor
    union all
    select (r ->> 'n')::int, r ->> 'editor' from jsonb_array_elements(c.rounds) r
    where (r ->> 'n') ~ '^[0-9]{1,2}$' and (r ->> 'n')::int between 2 and 50
    order by 1
  loop
    pre := case when ctx.n = 1 then '' else 'r' || ctx.n || '.' end;
    for spec in
      select * from (values
        (1, 'graphics9', 'p07.approved', true),
        (2, 'scripts', 'p13.approved', false),
        (3, 'graphics', 'p23.approved', true),
        (4, 'videos', 'p27.approved', false)) as v (ord, item, approve_key, base_only)
      order by ord
    loop
      continue when spec.base_only and ctx.n > 1;
      k := pre || spec.approve_key;
      if spec.item = 'scripts' then
        select case when count(*) filter (where s.item_key <> pre || 'p12.numbered') = 2
                     and (c.protocol_version < 2 or count(*) filter (where s.item_key = pre || 'p12.numbered') = 1)
                    then max(s.at) end into sent_at from public.protocol_checks s
        where s.client_id = c.id and s.item_key in (pre || 'p12.scripts', pre || 'p12.numbered', pre || 'p12.docs');
      else
        select s.at into sent_at from public.protocol_checks s
        where s.client_id = c.id and s.state = 'done'
          and s.item_key = pre || case spec.item when 'graphics9' then 'p07.sent' when 'graphics' then 'p23.sent' else 'p26.sent' end;
      end if;
      select * into appr from public.protocol_checks s where s.client_id = c.id and s.item_key = k;
      continue when appr.item_key is null and sent_at is null;
      select count(*) into used from public.client_approvals a where a.client_id = c.id and a.item_key = k and a.decision = 'fix';
      used := used + (select count(*) from public.client_tasks t where t.client_id = c.id and t.source = 'client_fix'
        and t.brief ->> 'item_key' = k and t.brief ->> 'from' = 'office'
        and coalesce((t.brief ->> 'notes_marked')::boolean, false) = false)::int;
      fixing := exists (select 1 from public.client_tasks t where t.client_id = c.id and t.source = 'client_fix'
        and t.done_at is null and t.brief ->> 'item_key' = k);
      if spec.item = 'videos' then
        select * into notes from public.protocol_checks s where s.client_id = c.id and s.item_key = pre || 'p27.notes' and s.state = 'done';
        fixed := exists (select 1 from public.protocol_checks s where s.client_id = c.id
          and ((s.item_key = pre || 'p27.fixes' and s.state in ('done', 'na')) or (s.item_key = pre || 'p27.final' and s.state = 'done')));
        if notes.item_key is not null and notes.note is distinct from 'ייבוא'
           and (case when pg_input_is_valid(coalesce(notes.note, ''), 'jsonb') and jsonb_typeof(notes.note::jsonb) = 'object'
                     then notes.note::jsonb ->> 'via' end) is distinct from 'status' then
          used := used + 1;
        end if;
        fixing := fixing or (notes.item_key is not null and not fixed);
      end if;
      link := nullif(c.links ->> case when spec.item = 'scripts' then 'scripts' else 'drive' end, '');
      if link is not null and link !~ '^https://[^\s"<>]+$' then link := null; end if;
      out := out || jsonb_build_object(
        'item', spec.item, 'key', k, 'shootRound', ctx.n,
        'state', case when appr.state in ('done', 'na') then 'approved' when fixing then 'fixing' else 'waiting' end,
        'round', used + 1, 'included', 1, 'sentAt', sent_at, 'approvedAt', case when appr.state = 'done' then appr.at end,
        'link', link, 'editor', coalesce(ctx.editor, case when ctx.n = 1 then c.editor end));
    end loop;
  end loop;
  return out;
end $$;
revoke execute on function private.status_items(uuid) from public, anon, authenticated;

-- ── 4. A task on the spot to Nirel carries her brief ──
-- Nirel's protocol: she never works out alone what is wanted. A task opened for her in the
-- client card must carry the four fields (the problem, what to change, what stays, the
-- result: BRIEF_MUST in app/protocol.js); a task given on the spot ("נודניק",
-- 20261011100000_staff_tasks.sql) did not. The brief is kept with the task, and the
-- database refuses a task for her without it, whichever function is called.
alter table public.staff_tasks add column if not exists brief jsonb
  check (brief is null or (jsonb_typeof(brief) = 'object' and length(brief::text) <= 4000));

create or replace function public.staff_task_create_brief(p_assignee text, p_body text, p_client uuid default null, p_brief jsonb default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me text := public.reminder_person();
  mail text := lower(coalesce(auth.jwt() ->> 'email', ''));
  txt text := btrim(coalesce(p_body, ''));
  cname text;
  rid uuid;
  v_brief jsonb;
  k text;
begin
  if me is null or not public.can_give_staff_tasks() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_assignee is null or p_assignee not in ('owner', 'irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli', 'stav', 'amos') then
    raise exception 'unknown assignee' using errcode = '22023';
  end if;
  if not exists (select 1 from public.staff s where coalesce(s.person, 'owner') = p_assignee) then
    raise exception 'the assignee has no login' using errcode = '22023';
  end if;
  if length(txt) < 1 or length(txt) > 500 then raise exception 'the task text is required (up to 500 characters)' using errcode = '22023'; end if;
  if p_brief is not null and jsonb_typeof(p_brief) <> 'object' then raise exception 'invalid brief' using errcode = '22023'; end if;
  -- Only the brief's own fields are kept, trimmed; an empty one is left out.
  select jsonb_object_agg(f.key, left(btrim(p_brief ->> f.key), 500)) into v_brief
  from unnest(array['problem', 'disliked', 'change', 'keep', 'result', 'materials']) as f (key)
  where btrim(coalesce(p_brief ->> f.key, '')) <> '';
  if p_assignee = 'nirel' then
    foreach k in array array['problem', 'change', 'keep', 'result'] loop
      if coalesce(v_brief ->> k, '') = '' then raise exception 'a task for Nirel needs the full brief' using errcode = '22023'; end if;
    end loop;
  end if;
  if p_client is not null then
    select left(case
             when coalesce(btrim(c.business), '') = '' or btrim(c.business) = btrim(c.name) then btrim(c.name)
             when btrim(c.name) = '' then btrim(c.business)
             else btrim(c.business) || ' · ' || btrim(c.name) end, 250)
      into cname from public.clients c where c.id = p_client;
    if not found then raise exception 'client not found' using errcode = 'P0002'; end if;
  end if;
  insert into public.staff_tasks (created_by, created_by_email, assignee, body, client_id, client_name, brief)
  values (me, mail, p_assignee, txt, p_client, cname, v_brief)
  returning id into rid;
  return rid;
end $$;
revoke all on function public.staff_task_create_brief(text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.staff_task_create_brief(text, text, uuid, jsonb) to authenticated;

-- The function the site called until now: the same checks, by the function above, with no
-- brief. So a task for Nirel is refused here too.
create or replace function public.staff_task_create(p_assignee text, p_body text, p_client uuid default null) returns uuid
language sql security definer set search_path = '' as $$
  select public.staff_task_create_brief(p_assignee, p_body, p_client, null);
$$;
revoke all on function public.staff_task_create(text, text, uuid) from public, anon, authenticated;
grant execute on function public.staff_task_create(text, text, uuid) to authenticated;

-- ── 5. Who writes which protocol item (v10) ──
-- The office (Irit, Lior, Ofir) writes every key. New rows, and nothing else changes:
--   p22.self.sound, .exposure, .stable, .angles, .export   the editor of that shoot (the five
--                                    critical mistakes of his self-check);
--   p29b.c.* (13), p29b.done, p29b.@part   Ilai (his final check);
--   p16.photographer                 Eli: "קיבלתי" on Lior's briefing. The page always
--                                    offered it to him, and this table had no row for it,
--                                    so the database refused his press;
--   p16.read                         Eli: "קראתי את התסריטים";
--   p18b.files                       Eli: the raw material and the chosen take per script.
-- (Ofir's five new checks of the videos, p25.q.*, are the office's: no row.)
-- protocol-writers:begin (generated by scripts/protocol-writers.mjs from app/protocol.js; do not edit by hand)
insert into private.protocol_writers (key, proc, round, persons) values
  ('@office', null, false, array['irit', 'lior', 'ofir']::text[]),
  ('@editors', null, false, array['anna', 'nadia', 'nirel', 'yariv']::text[]),
  ('p05.newlogo', 'p05', false, array['ilai']::text[]),
  ('p05.@wait', 'p05', false, array['ilai', 'irit', 'lior', 'ofir']::text[]),
  ('p05.@part', 'p05', false, array['ilai', 'irit', 'lior', 'ofir']::text[]),
  ('p06.verified', 'p06', false, array['ilai']::text[]),
  ('p06.newpages', 'p06', false, array['ilai']::text[]),
  ('p06.name', 'p06', false, array['ilai']::text[]),
  ('p06.bio', 'p06', false, array['ilai']::text[]),
  ('p06.details', 'p06', false, array['ilai']::text[]),
  ('p06.phone', 'p06', false, array['ilai']::text[]),
  ('p06.address', 'p06', false, array['ilai']::text[]),
  ('p06.look', 'p06', false, array['ilai']::text[]),
  ('p06.metricool', 'p06', false, array['ilai']::text[]),
  ('p06.@part', 'p06', false, array['ilai', 'lior']::text[]),
  ('p07.made', 'p07', false, array['ilai']::text[]),
  ('p07.@wait', 'p07', false, array['ilai', 'irit', 'ofir']::text[]),
  ('p07.@part', 'p07', false, array['ilai', 'irit', 'ofir']::text[]),
  ('p07b.posted', 'p07b', false, array['ilai']::text[]),
  ('p07b.@part', 'p07b', false, array['ilai']::text[]),
  ('p09.file', 'p09', false, array['ilai']::text[]),
  ('p09.c.name', 'p09', false, array['ilai']::text[]),
  ('p09.c.months', 'p09', false, array['ilai']::text[]),
  ('p09.c.num', 'p09', false, array['ilai']::text[]),
  ('p09.c.link', 'p09', false, array['ilai']::text[]),
  ('p09.c.day', 'p09', false, array['ilai']::text[]),
  ('p09.c.date', 'p09', false, array['ilai']::text[]),
  ('p09.c.time', 'p09', false, array['ilai']::text[]),
  ('p09.@part', 'p09', false, array['ilai']::text[]),
  ('p17b.arrived', 'p17b', true, array['eli']::text[]),
  ('p17b.drive', 'p17b', true, array['eli']::text[]),
  ('p17b.gear', 'p17b', true, array['eli']::text[]),
  ('p17b.zones', 'p17b', true, array['eli']::text[]),
  ('p17b.broll', 'p17b', true, array['eli']::text[]),
  ('p17b.variety', 'p17b', true, array['eli']::text[]),
  ('p17b.@part', 'p17b', true, array['eli']::text[]),
  ('p18b.order', 'p18b', true, array['eli']::text[]),
  ('p18b.quality', 'p18b', true, array['eli']::text[]),
  ('p18b.numbered', 'p18b', true, array['eli']::text[]),
  ('p18b.@part', 'p18b', true, array['eli']::text[]),
  ('p19b.folders', 'p19b', true, array['eli']::text[]),
  ('p19b.complete', 'p19b', true, array['eli']::text[]),
  ('p19b.opens', 'p19b', true, array['eli']::text[]),
  ('p19b.cards', 'p19b', true, array['eli']::text[]),
  ('p19b.handed', 'p19b', true, array['eli']::text[]),
  ('p19b.notes', 'p19b', true, array['eli']::text[]),
  ('p19b.@part', 'p19b', true, array['eli']::text[]),
  ('p22.received', 'p22', true, array['@editor']::text[]),
  ('p22.check.footage', 'p22', true, array['@editor']::text[]),
  ('p22.check.scripts', 'p22', true, array['@editor']::text[]),
  ('p22.check.logo', 'p22', true, array['@editor']::text[]),
  ('p22.check.phone', 'p22', true, array['@editor']::text[]),
  ('p22.edited', 'p22', true, array['@editor']::text[]),
  ('p22.self.spelling', 'p22', true, array['@editor']::text[]),
  ('p22.self.broll', 'p22', true, array['@editor']::text[]),
  ('p22.self.closing', 'p22', true, array['@editor']::text[]),
  ('p22.self.complete', 'p22', true, array['@editor']::text[]),
  ('p22.self.sound', 'p22', true, array['@editor']::text[]),
  ('p22.self.exposure', 'p22', true, array['@editor']::text[]),
  ('p22.self.stable', 'p22', true, array['@editor']::text[]),
  ('p22.self.angles', 'p22', true, array['@editor']::text[]),
  ('p22.self.export', 'p22', true, array['@editor']::text[]),
  ('p22.@wait', 'p22', true, array['@editor']::text[]),
  ('p22.@pause', 'p22', true, array['@editor', '@editor-free']::text[]),
  ('p22.@part', 'p22', true, array['@editor']::text[]),
  ('p23.made', 'p23', false, array['ilai']::text[]),
  ('p23.@wait', 'p23', false, array['ilai', 'irit', 'ofir']::text[]),
  ('p23.@part', 'p23', false, array['ilai', 'irit', 'ofir']::text[]),
  ('p23b.posted', 'p23b', false, array['ilai']::text[]),
  ('p23b.@part', 'p23b', false, array['ilai']::text[]),
  ('p24.drive', 'p24', true, array['@editor']::text[]),
  ('p24.d' || 'ropbox', 'p24', true, array['@editor']::text[]),
  ('p24.notify', 'p24', true, array['@editor']::text[]),
  ('p24.@wait', 'p24', true, array['@editor', 'ofir']::text[]),
  ('p24.@part', 'p24', true, array['@editor', 'ofir']::text[]),
  ('p27.fixes', 'p27', true, array['@editor']::text[]),
  ('p27.final', 'p27', true, array['@editor']::text[]),
  ('p27.toilai', 'p27', true, array['ilai']::text[]),
  ('p27.@wait', 'p27', true, array['@editor', 'ilai', 'irit']::text[]),
  ('p27.@pause', 'p27', true, array['@editor', '@editor-free']::text[]),
  ('p27.@part', 'p27', true, array['@editor', 'ilai', 'irit']::text[]),
  ('p28.scheduled', 'p28', true, array['ilai']::text[]),
  ('p28.@part', 'p28', true, array['ilai']::text[]),
  ('p29.filled', 'p29', true, array['ilai']::text[]),
  ('p29.@claim', 'p29', true, array['ilai', 'irit']::text[]),
  ('p29.@part', 'p29', true, array['ilai', 'irit']::text[]),
  ('p29b.c.nets', 'p29b', true, array['ilai']::text[]),
  ('p29b.c.access', 'p29b', true, array['ilai']::text[]),
  ('p29b.c.metricool', 'p29b', true, array['ilai']::text[]),
  ('p29b.c.look', 'p29b', true, array['ilai']::text[]),
  ('p29b.c.logo', 'p29b', true, array['ilai']::text[]),
  ('p29b.c.graphics', 'p29b', true, array['ilai']::text[]),
  ('p29b.c.gfiles', 'p29b', true, array['ilai']::text[]),
  ('p29b.c.vfiles', 'p29b', true, array['ilai']::text[]),
  ('p29b.c.vsched', 'p29b', true, array['ilai']::text[]),
  ('p29b.c.gsched', 'p29b', true, array['ilai']::text[]),
  ('p29b.c.gantt', 'p29b', true, array['ilai']::text[]),
  ('p29b.c.match', 'p29b', true, array['ilai']::text[]),
  ('p29b.c.updated', 'p29b', true, array['ilai']::text[]),
  ('p29b.done', 'p29b', true, array['ilai']::text[]),
  ('p29b.@part', 'p29b', true, array['ilai']::text[]),
  ('p17b.brollq', 'p17b', true, array['eli']::text[]),
  ('p22.missing', 'p22', true, array['@editor']::text[]),
  ('p27.fixed', 'p27', true, array['@editor']::text[]),
  ('p16.photographer', 'p16', true, array['eli']::text[]),
  ('p16.read', 'p16', true, array['eli']::text[]),
  ('p18b.files', 'p18b', true, array['eli']::text[]),
  ('p25.@qafixed', 'p25', true, array['@editor']::text[]),
  ('p23.@qafixed', 'p23', false, array['ilai']::text[]),
  ('p07.@qafixed', 'p07', false, array['ilai']::text[])
on conflict (key) do update set proc = excluded.proc, round = excluded.round, persons = excluded.persons;
update private.protocol_writers set persons = '{}'::text[] where key <> all (array['@office', '@editors', 'p05.newlogo', 'p05.@wait', 'p05.@part', 'p06.verified', 'p06.newpages', 'p06.name', 'p06.bio', 'p06.details', 'p06.phone', 'p06.address', 'p06.look', 'p06.metricool', 'p06.@part', 'p07.made', 'p07.@wait', 'p07.@part', 'p07b.posted', 'p07b.@part', 'p09.file', 'p09.c.name', 'p09.c.months', 'p09.c.num', 'p09.c.link', 'p09.c.day', 'p09.c.date', 'p09.c.time', 'p09.@part', 'p17b.arrived', 'p17b.drive', 'p17b.gear', 'p17b.zones', 'p17b.broll', 'p17b.variety', 'p17b.@part', 'p18b.order', 'p18b.quality', 'p18b.numbered', 'p18b.@part', 'p19b.folders', 'p19b.complete', 'p19b.opens', 'p19b.cards', 'p19b.handed', 'p19b.notes', 'p19b.@part', 'p22.received', 'p22.check.footage', 'p22.check.scripts', 'p22.check.logo', 'p22.check.phone', 'p22.edited', 'p22.self.spelling', 'p22.self.broll', 'p22.self.closing', 'p22.self.complete', 'p22.self.sound', 'p22.self.exposure', 'p22.self.stable', 'p22.self.angles', 'p22.self.export', 'p22.@wait', 'p22.@pause', 'p22.@part', 'p23.made', 'p23.@wait', 'p23.@part', 'p23b.posted', 'p23b.@part', 'p24.drive', 'p24.d' || 'ropbox', 'p24.notify', 'p24.@wait', 'p24.@part', 'p27.fixes', 'p27.final', 'p27.toilai', 'p27.@wait', 'p27.@pause', 'p27.@part', 'p28.scheduled', 'p28.@part', 'p29.filled', 'p29.@claim', 'p29.@part', 'p29b.c.nets', 'p29b.c.access', 'p29b.c.metricool', 'p29b.c.look', 'p29b.c.logo', 'p29b.c.graphics', 'p29b.c.gfiles', 'p29b.c.vfiles', 'p29b.c.vsched', 'p29b.c.gsched', 'p29b.c.gantt', 'p29b.c.match', 'p29b.c.updated', 'p29b.done', 'p29b.@part', 'p17b.brollq', 'p22.missing', 'p27.fixed', 'p16.photographer', 'p16.read', 'p18b.files', 'p25.@qafixed', 'p23.@qafixed', 'p07.@qafixed']::text[]);
-- protocol-writers:end
