-- "לקוחות שלא מחוברים ל-Metricool": Ilai's card in "המשימות שלי" (the owner's request of
-- 6.10.2026; docs/ops.md, section 33). After 20261007100100_metricool.sql. Safe to run
-- again. It only adds: three columns, one trigger and one function. Nothing is removed.
--
-- The card lists every active client with no Metricool brand (clients.metricool_blog_id,
-- set by public.gantt_set_brand). A client that has no brand and should not have one
-- (no social management in its package) is marked here, and leaves the list:
--
--   clients.metricool_none      true: "no Metricool brand, and none is needed"
--   clients.metricool_none_by   who said so (email), stamped by the database
--   clients.metricool_none_at   when
--
-- Only Ilai and the owner set or undo it (public.can_edit_gantt(), the same two who
-- connect a client to its brand), through public.metricool_set_none(). A direct write
-- of the three columns from a browser is ignored, whoever sends it. The import of the
-- old clients runs as the database owner or the service role and may set the mark
-- itself.

alter table public.clients
  add column if not exists metricool_none boolean not null default false,
  add column if not exists metricool_none_by text,
  add column if not exists metricool_none_at timestamptz;
-- Column grants (20260930210000_hardening.sql): a new column of clients is readable
-- only when granted here. None of the three is the office's secret.
grant select (metricool_none, metricool_none_by, metricool_none_at) on public.clients to authenticated;

-- Keeps the mark as it was on any write that comes straight from a signed-in browser
-- (the role `authenticated`): only the function below, which runs as its owner, and
-- the database's own roles change it. A client that is connected to a brand carries
-- no mark, so connecting one clears it.
create or replace function public.clients_metricool_none_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      new.metricool_none := false;
      new.metricool_none_by := null;
      new.metricool_none_at := null;
    else
      new.metricool_none := old.metricool_none;
      new.metricool_none_by := old.metricool_none_by;
      new.metricool_none_at := old.metricool_none_at;
    end if;
  end if;
  if new.metricool_blog_id is not null or not coalesce(new.metricool_none, false) then
    new.metricool_none := false;
    new.metricool_none_by := null;
    new.metricool_none_at := null;
  end if;
  return new;
end $$;
revoke execute on function public.clients_metricool_none_guard() from public, anon, authenticated;
create or replace trigger clients_metricool_none_guard before insert or update on public.clients
for each row execute function public.clients_metricool_none_guard();

-- Ilai or the owner: "this client has no Metricool brand" (p_on), or back to the list.
-- A connected client cannot be marked: its brand is taken away first, on the Gantt.
create or replace function public.metricool_set_none(p_client uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_on boolean := coalesce(p_on, false);
  v_blog text;
begin
  if not public.can_edit_gantt() then raise exception 'not allowed' using errcode = '42501'; end if;
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
