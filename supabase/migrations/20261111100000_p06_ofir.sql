-- The owner's decision of 28.10.2026: "להוריד מעילאי את כל עניין הגישות לרשתות, זה צריך לעבור
-- לאופיר". Process 6 ("בדיקת הגישות וסידור הרשתות") is Ofir's as a whole: checking every login,
-- opening the networks the client has not got, and setting the pages up (Metricool was already
-- his, v11). Lior keeps the broken logins (p06.recovered). Ilai keeps his read of the vault: he
-- still posts the graphics to the networks (7ב, 23ב), so no permission of the vault changes here.
-- The protocol itself is data in app/protocol.js (who owns an item needs no new protocol
-- version: app/protocol-versions.js), and the reminders follow it by themselves
-- (app/reminder-rules.js `access`, `accessForm`, `accessClosed`). The database needs three things:
--   1. the client's logins form: a network the client marked "אין כיום, צריך לפתוח" opens an
--      urgent task for Ofir, not for Ilai (public.access_form_submit, as in
--      20261031100000_access_and_editors.sql with only that owner changed);
--   2. the tasks of that kind still open with Ilai pass to Ofir (the same words the form and the
--      card's vault write, "לפתוח ללקוח … ולהכניס את הגישה לכספת"); done ones stay as they were;
--   3. the writers table: process 6 is the office's now (Ofir is the office, which writes every
--      key), so Ilai's rows for it go empty.
-- Nothing else: no table, no policy, no trigger, no column, no protocol mark. The function is
-- replaced in place with the same signature. Every statement can run again safely. Tested with
-- every migration in a real Postgres: tests/sql/p06-ofir.test.mjs.

-- ── 1. The client's logins form: a network to open is Ofir's ──
create or replace function public.access_form_submit(p_token text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  l public.client_access_links;
  c public.clients;
  a public.client_access;
  e jsonb;
  v_reason text;
  v_now timestamptz := now();
  v_net text;
  v_label text;
  v_row_label text;
  v_choice text;
  v_user text;
  v_pass text;
  v_status text;
  v_note text;
  v_rid uuid;
  v_sid uuid;
  v_new boolean;
  v_beside boolean;
  v_linked boolean;
  v_all text[] := '{}';
  v_open text[] := '{}';
  v_summary jsonb := '[]'::jsonb;
begin
  if public.is_staff() then
    raise exception 'staff cannot send the form for the client' using errcode = '42501';
  end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return jsonb_build_object('state', 'invalid');
  end if;
  select * into l from public.client_access_links s where s.token_hash = private.status_token_hash(p_token) for update;
  v_reason := private.access_link_reason(l);
  if v_reason is not null then
    return jsonb_build_object('state', v_reason);
  end if;

  if private.access_form_problem(p_payload) is not null then
    update public.client_access_links set attempts = attempts + 1, last_attempt_at = v_now where id = l.id;
    return jsonb_build_object('state', case when l.attempts + 1 >= 5 then 'locked' else 'refused' end, 'left', greatest(0, 4 - l.attempts));
  end if;

  select * into c from public.clients where id = l.client_id for update;

  for e in select value from jsonb_array_elements(p_payload -> 'entries') loop
    v_net := e ->> 'network';
    v_label := nullif(btrim(coalesce(e ->> 'label', '')), '');
    v_choice := e ->> 'choice';
    v_user := nullif(btrim(coalesce(e ->> 'username', '')), '');
    v_pass := coalesce(e ->> 'password', '');
    -- 'linked' is kept as status 'ok' with linked on (the column's status check stays as it was).
    v_status := case v_choice when 'have' then 'new' when 'none' then 'missing' when 'linked' then 'ok' else 'broken' end;
    v_linked := v_choice = 'linked';
    v_note := case v_choice
      when 'have' then 'מהלקוח, בטופס פרטי הכניסה. עוד לא נבדק.'
      when 'none' then 'מהלקוח, בטופס פרטי הכניסה: אין כיום, צריך לפתוח.'
      when 'linked' then 'מהלקוח, בטופס פרטי הכניסה: העמוד שויך לאסטרטג דרך מנהל העסקים.'
      else 'מהלקוח, בטופס פרטי הכניסה: יש, וצריך לחדש סיסמה.' end;
    v_row_label := v_label;

    -- The row of this network, when the vault has one (the oldest; 'other' by its name).
    select * into a from public.client_access x
    where x.client_id = c.id and x.network = v_net
      and (v_net <> 'other' or lower(btrim(coalesce(x.label, ''))) = lower(v_label))
    order by x.created_at, x.id limit 1;
    v_new := a.id is null;
    -- A login the office saved or checked stays as it is.
    v_beside := not v_new and a.secret_id is not null
      and (a.status = 'ok' or a.updated_by is distinct from 'client-form');
    if v_beside then
      -- The client's own row beside it, from an earlier form (never one the office confirmed).
      select * into a from public.client_access x
      where x.client_id = c.id and x.network = v_net and x.id <> a.id
        and x.updated_by = 'client-form' and (x.status <> 'ok' or x.linked)
        and (v_net <> 'other' or lower(btrim(coalesce(x.label, ''))) = lower(v_label))
      order by x.created_at, x.id limit 1;
      v_new := a.id is null;
      v_note := v_note || ' הפרטים שכבר היו בכספת נשארו בשורה נפרדת: לבדוק איזו נכונה.';
      if v_net <> 'other' then
        v_row_label := 'מהלקוח, ' || to_char(v_now at time zone 'Asia/Jerusalem', 'FMDD.FMMM.YYYY');
      end if;
    end if;
    if v_new then
      insert into public.client_access (client_id, network, label, username, status, linked, note, updated_by, updated_at)
      values (c.id, v_net, v_row_label, v_user, v_status, v_linked, v_note, 'client-form', v_now)
      returning id into v_rid;
    else
      v_rid := a.id;
      update public.client_access
      set username = case when v_choice = 'have' or (v_choice = 'reset' and v_user is not null) then v_user else username end,
          label = case when v_beside then v_row_label else label end,
          status = v_status, linked = v_linked, note = v_note, updated_by = 'client-form', updated_at = v_now
      where id = v_rid;
    end if;
    if v_choice = 'have' then
      -- The password. A row reached here is new, or the client's own unchecked one
      -- (or an office row with no password): nothing the office saved is replaced.
      if not v_new and a.secret_id is not null then
        perform vault.update_secret(a.secret_id, v_pass);
      else
        v_sid := vault.create_secret(v_pass, 'client_access:' || v_rid::text, 'client social access');
        update public.client_access set secret_id = v_sid where id = v_rid;
      end if;
    end if;
    insert into public.client_access_log (access_id, client_id, network, action, by_email)
    values (v_rid, c.id, v_net, case when v_new then 'create' else 'update' end, 'client-form');

    v_all := v_all || private.access_network_name(v_net, v_label);
    if v_choice = 'none' and (v_new or a.status is distinct from 'missing') then
      v_open := v_open || private.access_network_name(v_net, v_label);
    end if;
    -- 'beside': kept next to a login of the office (the card says so).
    v_summary := v_summary || (jsonb_build_object('network', v_net, 'label', v_label, 'choice', v_choice)
      || case when v_beside then jsonb_build_object('beside', true) else '{}'::jsonb end);
  end loop;

  -- The link is closed: one use. Its token leaves Vault (client_access_links_forget).
  -- The note goes where only the vault's users read it.
  update public.client_access_links
  set submitted_at = v_now, summary = v_summary, client_note = null,
      client_note_private = nullif(btrim(coalesce(p_payload ->> 'notes', '')), '')
  where id = l.id;

  -- Process 5, as the end of the characterization marks it (endedChecks in
  -- app/characterization.js). A mark already done keeps its time and its words.
  insert into public.protocol_checks (client_id, item_key, state, note)
  values (c.id, 'p05.access', 'done', left('מהלקוח, בטופס פרטי הכניסה: ' || array_to_string(v_all, ', '), 2000))
  on conflict (client_id, item_key) do update set state = 'done', note = excluded.note
    where public.protocol_checks.state <> 'done';
  insert into public.protocol_checks (client_id, item_key, state, note)
  values (c.id, 'p05.vault', 'done', 'נכנס לכספת מטופס פרטי הכניסה של הלקוח')
  on conflict (client_id, item_key) do update set state = 'done', note = excluded.note
    where public.protocol_checks.state <> 'done';

  -- "אין כיום, צריך לפתוח": Ofir opens the pages (the task the card's vault opens; Ilai's
  -- until 28.10.2026, the owner's decision: process 6 is Ofir's).
  if array_length(v_open, 1) > 0 then
    insert into public.client_tasks (client_id, title, owner, urgent)
    values (c.id, left('לפתוח ללקוח ' || array_to_string(v_open, ', ') || ' ולהכניס את הגישה לכספת (הלקוח סימן בטופס: אין כיום)', 500), 'ofir', true);
  end if;

  return jsonb_build_object('state', 'done');
end $$;
revoke all on function public.access_form_submit(text, jsonb) from public;
grant execute on function public.access_form_submit(text, jsonb) to anon, authenticated;

-- ── 2. The open "לפתוח ללקוח …" tasks pass from Ilai to Ofir ──
-- Only open ones, only Ilai's, only these words (the form's and the card vault's; both are
-- urgent tasks). One nobody started yet rings Ofir at once: the hand-over of the reminders'
-- rule `urgent` (app/reminder-engine.js planHandover).
update public.client_tasks set owner = 'ofir'
where owner = 'ilai' and done_at is null
  and title like 'לפתוח ללקוח %' and title like '% ולהכניס את הגישה לכספת%';

-- ── 3. Who writes which protocol item ──
-- Process 6 is the office's: the office (Irit, Lior, Ofir) writes every key, so p06 has no row
-- of its own any more, and Ilai's go empty. Nothing else changes.
-- protocol-writers:begin (generated by scripts/protocol-writers.mjs from app/protocol.js; do not edit by hand)
insert into private.protocol_writers (key, proc, round, persons) values
  ('@office', null, false, array['irit', 'lior', 'ofir']::text[]),
  ('@editors', null, false, array['anna', 'nadia', 'nirel', 'yariv']::text[]),
  ('p05.newlogo', 'p05', false, array['ilai']::text[]),
  ('p05.@wait', 'p05', false, array['ilai', 'irit', 'lior', 'ofir']::text[]),
  ('p05.@part', 'p05', false, array['ilai', 'irit', 'lior', 'ofir']::text[]),
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
update private.protocol_writers set persons = '{}'::text[] where key <> all (array['@office', '@editors', 'p05.newlogo', 'p05.@wait', 'p05.@part', 'p07.made', 'p07.@wait', 'p07.@part', 'p07b.posted', 'p07b.@part', 'p09.file', 'p09.c.name', 'p09.c.months', 'p09.c.num', 'p09.c.link', 'p09.c.day', 'p09.c.date', 'p09.c.time', 'p09.@part', 'p17b.arrived', 'p17b.drive', 'p17b.gear', 'p17b.zones', 'p17b.broll', 'p17b.variety', 'p17b.@part', 'p18b.order', 'p18b.quality', 'p18b.numbered', 'p18b.@part', 'p19b.folders', 'p19b.complete', 'p19b.opens', 'p19b.cards', 'p19b.handed', 'p19b.notes', 'p19b.@part', 'p22.received', 'p22.check.footage', 'p22.check.scripts', 'p22.check.logo', 'p22.check.phone', 'p22.edited', 'p22.self.spelling', 'p22.self.broll', 'p22.self.closing', 'p22.self.complete', 'p22.self.sound', 'p22.self.exposure', 'p22.self.stable', 'p22.self.angles', 'p22.self.export', 'p22.@wait', 'p22.@pause', 'p22.@part', 'p23.made', 'p23.@wait', 'p23.@part', 'p23b.posted', 'p23b.@part', 'p24.drive', 'p24.d' || 'ropbox', 'p24.notify', 'p24.@wait', 'p24.@part', 'p27.fixes', 'p27.final', 'p27.toilai', 'p27.@wait', 'p27.@pause', 'p27.@part', 'p28.scheduled', 'p28.@part', 'p29.filled', 'p29.@claim', 'p29.@part', 'p29b.c.nets', 'p29b.c.access', 'p29b.c.metricool', 'p29b.c.look', 'p29b.c.logo', 'p29b.c.graphics', 'p29b.c.gfiles', 'p29b.c.vfiles', 'p29b.c.vsched', 'p29b.c.gsched', 'p29b.c.gantt', 'p29b.c.match', 'p29b.c.updated', 'p29b.done', 'p29b.@part', 'p17b.brollq', 'p22.missing', 'p27.fixed', 'p16.photographer', 'p16.read', 'p18b.files', 'p25.@qafixed', 'p23.@qafixed', 'p07.@qafixed']::text[]);
-- protocol-writers:end
