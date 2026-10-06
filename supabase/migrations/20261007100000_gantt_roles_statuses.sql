-- The content Gantt, the owner's decisions of 6.10.2026 (docs/ops.md, section 27).
-- After 20261003130000_content_gantt.sql and 20261003130100_gantt_file_fk.sql.
--
-- A. Who changes the Gantt: Ilai (it is his: processes 9, 28, 29) and the owner.
--    Irit, Lior and Ofir read it and still create, copy and revoke the client's
--    read-only link (the link functions stay with the office). Everyone else as before:
--    whoever sees the client reads. Enforced here, not only in the page.
-- C. The states of an entry: planned → scheduled (it sits in Metricool's planner and
--    goes up by itself) → posted; error (the publishing failed); skipped. "חסר" (its
--    time has passed and it is neither scheduled nor posted) is derived, never stored
--    (app/gantt-logic.js entryStatus). `source` says who set the state: 'manual' (a
--    person) or 'metricool' (the sync, 20261007100100_metricool.sql), so that the sync
--    never takes back what a person marked.
--    The client's link (get_gantt) shows planned / scheduled / posted only: a failed
--    post reads as planned, and a scheduled one whose time has passed as posted.
-- Safe to run again. Running the Gantt's first migration again afterwards brings its
-- old write rules back: run this one after it.

-- ── A. Who writes ────────────────────────────
create or replace function public.can_edit_gantt() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff() and exists (
    select 1 from public.staff s
    where s.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (s.person is null or s.person = 'ilai'));
$$;
revoke execute on function public.can_edit_gantt() from public, anon;
grant execute on function public.can_edit_gantt() to authenticated;

drop policy if exists "office adds gantt entries" on public.client_gantt;
drop policy if exists "office changes gantt entries" on public.client_gantt;
drop policy if exists "office removes gantt entries" on public.client_gantt;
drop policy if exists "gantt editors add entries" on public.client_gantt;
drop policy if exists "gantt editors change entries" on public.client_gantt;
drop policy if exists "gantt editors remove entries" on public.client_gantt;
create policy "gantt editors add entries" on public.client_gantt
  for insert to authenticated with check ((select public.can_edit_gantt()));
create policy "gantt editors change entries" on public.client_gantt
  for update to authenticated using ((select public.can_edit_gantt())) with check ((select public.can_edit_gantt()));
create policy "gantt editors remove entries" on public.client_gantt
  for delete to authenticated using ((select public.can_edit_gantt()));

-- ── C. The states, and what the sync keeps on a row ──
alter table public.client_gantt drop constraint if exists client_gantt_state_check;
alter table public.client_gantt add constraint client_gantt_state_check
  check (state in ('planned', 'scheduled', 'posted', 'error', 'skipped'));

alter table public.client_gantt
  add column if not exists source text not null default 'manual',
  add column if not exists mc_post_id text,
  add column if not exists mc_status text,
  add column if not exists mc_at timestamptz,
  add column if not exists mc_networks text[],
  add column if not exists mc_error text,
  add column if not exists mc_extra boolean not null default false;
alter table public.client_gantt drop constraint if exists client_gantt_source_check;
alter table public.client_gantt add constraint client_gantt_source_check check (source in ('manual', 'metricool'));
alter table public.client_gantt drop constraint if exists client_gantt_mc_check;
alter table public.client_gantt add constraint client_gantt_mc_check check (
  (mc_post_id is null or mc_post_id ~ '^[0-9]{1,13}$')
  and (mc_status is null or mc_status in ('pending', 'published', 'error', 'draft'))
  and (mc_error is null or length(mc_error) <= 300)
  and (mc_networks is null or cardinality(mc_networks) <= 20));
-- One post of Metricool stands on one entry of a client.
create unique index if not exists client_gantt_mc_post_idx on public.client_gantt (client_id, mc_post_id) where mc_post_id is not null;

-- The database's rules for a row, whatever the browser sent (as before), and now:
--  - a person's write never sets the sync's columns, and a state a person changes is
--    'manual' from then on. Only public.gantt_sync_apply (service role,
--    20261007100100_metricool.sql) writes them, inside its own transaction flag.
create or replace function public.client_gantt_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  ok boolean;
  sync boolean := coalesce(current_setting('astrateg.gantt_sync', true), '') = '1';
begin
  new.internal := new.internal or new.kind in ('plan', 'renewal');
  if new.state = 'posted' then
    new.posted_on := coalesce(new.posted_on, (now() at time zone 'Asia/Jerusalem')::date);
  else
    new.posted_on := null;
  end if;
  if not sync then
    if tg_op = 'INSERT' then
      new.source := 'manual';
      new.mc_post_id := null; new.mc_status := null; new.mc_at := null;
      new.mc_networks := null; new.mc_error := null; new.mc_extra := false;
    else
      new.source := case when new.state is distinct from old.state then 'manual' else old.source end;
      new.mc_post_id := old.mc_post_id; new.mc_status := old.mc_status; new.mc_at := old.mc_at;
      new.mc_networks := old.mc_networks; new.mc_error := old.mc_error; new.mc_extra := old.mc_extra;
    end if;
  end if;
  if new.file_id is not null and to_regclass('public.client_files') is not null then
    execute 'select exists (select 1 from public.client_files f where f.id = $1 and f.client_id = $2)'
      into ok using new.file_id, new.client_id;
    if not ok then raise exception 'file not of this client' using errcode = '23503'; end if;
  end if;
  return new;
end $$;
revoke execute on function public.client_gantt_rules() from public, anon, authenticated;

-- ── The client's link: planned / scheduled / posted only ──
create or replace function public.get_gantt(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  l record;
  c public.clients;
  files jsonb := '{}'::jsonb;
begin
  select * into l from private.gantt_check(p_token);
  if l.reason is not null then
    return jsonb_build_object('state', l.reason);
  end if;
  select * into c from public.clients where id = l.client_id;
  if to_regclass('public.client_files') is not null then
    execute $q$
      select coalesce(jsonb_object_agg(f.id::text, jsonb_build_object(
               'link', case when coalesce(f.link, '') ~ '^https://[^\s"<>]+$' then f.link end,
               'postedOn', f.posted_on)), '{}'::jsonb)
      from public.client_files f
      where f.client_id = $1 and f.deleted_at is null
        and f.id in (select g.file_id from public.client_gantt g where g.client_id = $1 and g.file_id is not null)
    $q$ into files using c.id;
  end if;
  return jsonb_build_object(
    'state', 'ok',
    'preview', public.is_staff(),
    'expiresAt', l.expires_at,
    'client', jsonb_build_object(
      'business', coalesce(nullif(btrim(c.business), ''), c.name), 'dealAt', c.deal_at, 'contractEnd', c.contract_end),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', g.key, 'kind', g.kind, 'title', g.title, 'day', g.day, 'time', to_char(g.time_il, 'HH24:MI'),
               'num', g.num, 'state', g.shown,
               'postedOn', case when g.shown = 'posted' then coalesce(g.posted_on, (files -> g.file_id::text ->> 'postedOn')::date,
                                                                     case when g.state = 'scheduled' then g.day end) end,
               'link', coalesce(g.link, files -> g.file_id::text ->> 'link'))
             order by g.day, g.time_il nulls last, g.key)
      from (
        select x.*,
          case when x.state = 'error' then 'planned'
               when x.state = 'scheduled'
                 and ((x.day + coalesce(x.time_il, time '12:00')) at time zone 'Asia/Jerusalem') <= now() then 'posted'
               else x.state end as shown
        from public.client_gantt x
        where x.client_id = c.id and not x.internal and x.kind not in ('plan', 'renewal')) g), '[]'::jsonb)
  );
end $$;
revoke all on function public.get_gantt(text) from public;
grant execute on function public.get_gantt(text) to anon, authenticated;
