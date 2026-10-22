-- Irit edits the content Gantt too (the owner's request of 22.10.2026): mainly to paste
-- "קישור לתוכן" (the Drive link of each video) on the rows, the same as Ilai. After
-- 20261031110000_protocol_2110.sql. Two functions are replaced in place with the same
-- signature; no table, no policy, no column. Every statement can run again safely.
-- Tested with every migration in a real Postgres: tests/sql/gantt-metricool.test.mjs.
--
--   1. public.can_edit_gantt(): the owner, Ilai and now Irit (Ofir, as before, only inside
--      public.metricool_connect). The policies of public.client_gantt
--      (20261007100000_gantt_roles_statuses.sql) read it, so Irit adds, changes and
--      removes rows of a client's Gantt from here on.
--   2. Connecting a client to its Metricool brand stays as it was (the owner, Ilai and
--      Ofir: public.can_connect_metricool()). public.gantt_set_brand still asks
--      public.can_edit_gantt(), so the guard of the brand's columns
--      (public.clients_columns_guard, 20261014100000_security_hardening.sql) now also
--      refuses a change of the brand that Irit's own session makes through a function.
--      app/gantt.js canEdit and app/shell-rules.js editsGantt are the same list.

-- ── 1. Who edits the Gantt ───────────────────
create or replace function public.can_edit_gantt() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff() and exists (
    select 1 from public.staff s
    where s.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (s.person is null or s.person in ('ilai', 'irit')
        or (s.person = 'ofir' and coalesce(current_setting('astrateg.mc_connect', true), '') = '1')));
$$;
revoke execute on function public.can_edit_gantt() from public, anon;
grant execute on function public.can_edit_gantt() to authenticated;

-- ── 2. The brand stays with the three who connect it ──
-- As before: a signed-in user's own write keeps the three columns as they were. And now:
-- a function that changes the brand (public.gantt_set_brand) for a signed-in caller who
-- may not connect one (public.can_connect_metricool(): Irit edits the Gantt, she does not
-- connect brands) is refused. The service role (the metricool function) and an import as
-- the database owner carry no e-mail, and pass as before.
create or replace function public.clients_columns_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      new.metricool_blog_id := null;
      new.metricool_brand := null;
    else
      new.metricool_blog_id := old.metricool_blog_id;
      new.metricool_brand := old.metricool_brand;
      new.quote_id := old.quote_id;
    end if;
  elsif tg_op = 'UPDATE'
    and (new.metricool_blog_id is distinct from old.metricool_blog_id
      or new.metricool_brand is distinct from old.metricool_brand)
    and coalesce(auth.jwt() ->> 'email', '') <> ''
    and not public.can_connect_metricool() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.clients_columns_guard() from public, anon, authenticated;
