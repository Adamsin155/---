-- The owner's decisions of 21.10.2026, after the staff training: protocol version 11.
-- The protocol itself is data in app/protocol.js; the hourly "ממתין ללקוח" reminder is a
-- rule of the reminders function (app/reminder-rules.js `waitNag`) and needs nothing here.
-- The database needs four things:
--   1. the version;
--   2. Ofir connects a client to its Metricool brand (until now Ilai and the owner only):
--      public.can_connect_metricool(), and public.metricool_connect, the way the site
--      connects from now on; "ללקוח אין מותג" (public.metricool_set_none) the same three;
--   3. the writers table: p06.metricool is Ofir's (the office writes every key), Ilai's
--      row for it goes empty;
--   4. nothing else: no table, no policy, no trigger, no column. No mark is written.
-- Functions are replaced in place with the same signature, or added. Every statement can
-- run again safely. Tested with every migration in a real Postgres:
-- tests/sql/protocol-2110.test.mjs.

-- ── 1. Protocol version 11 ───────────────────
create or replace function private.protocol_version_current() returns integer
language sql immutable set search_path = '' as $$ select 11 $$;
revoke all on function private.protocol_version_current() from public, anon, authenticated;
alter table public.clients alter column protocol_version set default 11;

-- ── 2. Who connects a client to Metricool ────
-- The owner, Ilai (the Gantt is his, and he may still fix a brand there) and Ofir (the
-- connection is his step since v11, right after he takes the accesses).
-- app/metricool-connect-logic.js CONNECTORS is the same list (tests/sql/protocol-2110.test.mjs).
create or replace function public.can_connect_metricool() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff() and exists (
    select 1 from public.staff s
    where s.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (s.person is null or s.person in ('ilai', 'ofir')));
$$;
revoke execute on function public.can_connect_metricool() from public, anon;
grant execute on function public.can_connect_metricool() to authenticated;

-- Who edits the Gantt stays Ilai and the owner. Ofir passes only inside
-- public.metricool_connect below, which sets the transaction's own flag
-- astrateg.mc_connect for the one call to public.gantt_set_brand (20261007100100), and
-- clears it right after. A flag with `true` lives only in that transaction: no request
-- of the site can set it.
create or replace function public.can_edit_gantt() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff() and exists (
    select 1 from public.staff s
    where s.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (s.person is null or s.person = 'ilai'
        or (s.person = 'ofir' and coalesce(current_setting('astrateg.mc_connect', true), '') = '1')));
$$;
revoke execute on function public.can_edit_gantt() from public, anon;
grant execute on function public.can_edit_gantt() to authenticated;

-- Connects a client to its brand (null: takes the brand away), as public.gantt_set_brand
-- does, for whoever public.can_connect_metricool() lets. The same answer.
create or replace function public.metricool_connect(p_client uuid, p_blog_id text, p_brand text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v jsonb;
begin
  if not public.can_connect_metricool() then raise exception 'not allowed' using errcode = '42501'; end if;
  perform set_config('astrateg.mc_connect', '1', true);
  v := public.gantt_set_brand(p_client, p_blog_id, p_brand);
  perform set_config('astrateg.mc_connect', '', true);
  return v;
end $$;
revoke execute on function public.metricool_connect(uuid, text, text) from public, anon;
grant execute on function public.metricool_connect(uuid, text, text) to authenticated;

-- "ללקוח אין מותג", or back to the list (20261012100000_metricool_none.sql): the same
-- function, for the same three.
create or replace function public.metricool_set_none(p_client uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_on boolean := coalesce(p_on, false);
  v_blog text;
begin
  if not public.can_connect_metricool() then raise exception 'not allowed' using errcode = '42501'; end if;
  select metricool_blog_id into v_blog from public.clients where id = p_client and archived_at is null;
  if not found then raise exception 'client not found' using errcode = '22023'; end if;
  if v_on and v_blog is not null then
    raise exception 'connected: this client is connected to a brand' using errcode = 'P0001';
  end if;
  update public.clients set
    metricool_none = v_on,
    metricool_none_by = case when v_on then lower(coalesce(auth.jwt() ->> 'email', '')) end,
    metricool_none_at = case when v_on then now() end
  where id = p_client and metricool_none is distinct from v_on;
  return jsonb_build_object('none', v_on);
end $$;
revoke execute on function public.metricool_set_none(uuid, boolean) from public, anon;
grant execute on function public.metricool_set_none(uuid, boolean) to authenticated;

-- ── 3. Who writes which protocol item (v11) ──
-- p06.metricool is Ofir's now: the office (Irit, Lior, Ofir) writes every key, so it has no
-- row of its own any more, and Ilai's goes empty. Nothing else changes.
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
  ('p06.@part', 'p06', false, array['ilai', 'lior', 'ofir']::text[]),
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
update private.protocol_writers set persons = '{}'::text[] where key <> all (array['@office', '@editors', 'p05.newlogo', 'p05.@wait', 'p05.@part', 'p06.verified', 'p06.newpages', 'p06.name', 'p06.bio', 'p06.details', 'p06.phone', 'p06.address', 'p06.look', 'p06.@part', 'p07.made', 'p07.@wait', 'p07.@part', 'p07b.posted', 'p07b.@part', 'p09.file', 'p09.c.name', 'p09.c.months', 'p09.c.num', 'p09.c.link', 'p09.c.day', 'p09.c.date', 'p09.c.time', 'p09.@part', 'p17b.arrived', 'p17b.drive', 'p17b.gear', 'p17b.zones', 'p17b.broll', 'p17b.variety', 'p17b.@part', 'p18b.order', 'p18b.quality', 'p18b.numbered', 'p18b.@part', 'p19b.folders', 'p19b.complete', 'p19b.opens', 'p19b.cards', 'p19b.handed', 'p19b.notes', 'p19b.@part', 'p22.received', 'p22.check.footage', 'p22.check.scripts', 'p22.check.logo', 'p22.check.phone', 'p22.edited', 'p22.self.spelling', 'p22.self.broll', 'p22.self.closing', 'p22.self.complete', 'p22.self.sound', 'p22.self.exposure', 'p22.self.stable', 'p22.self.angles', 'p22.self.export', 'p22.@wait', 'p22.@pause', 'p22.@part', 'p23.made', 'p23.@wait', 'p23.@part', 'p23b.posted', 'p23b.@part', 'p24.drive', 'p24.d' || 'ropbox', 'p24.notify', 'p24.@wait', 'p24.@part', 'p27.fixes', 'p27.final', 'p27.toilai', 'p27.@wait', 'p27.@pause', 'p27.@part', 'p28.scheduled', 'p28.@part', 'p29.filled', 'p29.@claim', 'p29.@part', 'p29b.c.nets', 'p29b.c.access', 'p29b.c.metricool', 'p29b.c.look', 'p29b.c.logo', 'p29b.c.graphics', 'p29b.c.gfiles', 'p29b.c.vfiles', 'p29b.c.vsched', 'p29b.c.gsched', 'p29b.c.gantt', 'p29b.c.match', 'p29b.c.updated', 'p29b.done', 'p29b.@part', 'p17b.brollq', 'p22.missing', 'p27.fixed', 'p16.photographer', 'p16.read', 'p18b.files', 'p25.@qafixed', 'p23.@qafixed', 'p07.@qafixed']::text[]);
-- protocol-writers:end
