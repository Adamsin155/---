-- WAITING FOR THE OWNER'S APPROVAL ("מאשר להריץ את ה-SQL"). Not run.
--
-- The content Gantt shows only what is really scheduled (the owner, 11.11.2026; docs/ops.md,
-- section 128). The Metricool sync (app/metricool-logic.js planSync) now writes a post that no
-- entry takes as a row of ITS KIND, numbered after the rows of that kind ('video.13', "סרטון 13"),
-- and turns the extra 'custom' rows it made before into rows of their kind. Until now
-- public.gantt_sync_apply wrote every new row as kind 'custom' and could not change a row's kind,
-- key or number. This replaces the function, and nothing else:
--   insert   kind 'video' or 'graphic' when the sync names it (anything else stays 'custom'),
--            and its number; still mc_extra (a row the sync made), so it leaves with its post;
--   update   kind, key and num, only on a row the sync made (mc_extra and source 'metricool'),
--            only to 'video', 'graphic' or 'custom', and a key of that kind's shape.
-- No table, column, row or right changes. Before this runs, the new edge function's rows simply
-- arrive as 'custom' rows, as they did before (the extra fields are ignored).
create or replace function public.gantt_sync_apply(p_client uuid, p_ops jsonb, p_ok boolean, p_error text default null, p_stats jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  u jsonb;
  f jsonb;
  n_up integer := 0;
  n_in integer := 0;
  n_rm integer := 0;
  n integer;
  v_kind text;
begin
  perform set_config('astrateg.gantt_sync', '1', true);
  for u in select * from jsonb_array_elements(coalesce(p_ops -> 'update', '[]'::jsonb)) loop
    f := coalesce(u -> 'fields', '{}'::jsonb);
    -- A new kind, key and number: only for a row the sync made, and only a kind it makes.
    v_kind := case when f ->> 'kind' in ('video', 'graphic', 'custom') then f ->> 'kind' end;
    update public.client_gantt g set
      state = case when f ? 'state' then f ->> 'state' else g.state end,
      source = case when f ? 'source' then f ->> 'source' else g.source end,
      posted_on = case when f ? 'posted_on' then (f ->> 'posted_on')::date else g.posted_on end,
      link = case when f ? 'link' then f ->> 'link' else g.link end,
      title = case when f ? 'title' then f ->> 'title' else g.title end,
      day = case when f ? 'day' then (f ->> 'day')::date else g.day end,
      time_il = case when f ? 'time_il' then (f ->> 'time_il')::time else g.time_il end,
      month = case when f ? 'month' then (f ->> 'month')::smallint else g.month end,
      edited = case when f ? 'edited' then (f ->> 'edited')::boolean else g.edited end,
      kind = case when v_kind is not null and g.mc_extra and g.source = 'metricool' then v_kind else g.kind end,
      key = case when v_kind is not null and g.mc_extra and g.source = 'metricool'
                  and f ->> 'key' ~ ('^' || v_kind || '\.[0-9]{1,4}$') then f ->> 'key' else g.key end,
      num = case when v_kind is not null and g.mc_extra and g.source = 'metricool' and f ? 'num' then (f ->> 'num')::smallint else g.num end,
      mc_post_id = case when f ? 'mc_post_id' then f ->> 'mc_post_id' else g.mc_post_id end,
      mc_status = case when f ? 'mc_status' then f ->> 'mc_status' else g.mc_status end,
      mc_at = case when f ? 'mc_at' then (f ->> 'mc_at')::timestamptz else g.mc_at end,
      mc_networks = case when f ? 'mc_networks' then
        (select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof(f -> 'mc_networks') = 'array' then f -> 'mc_networks' else '[]'::jsonb end) x)
        else g.mc_networks end,
      mc_error = case when f ? 'mc_error' then left(f ->> 'mc_error', 300) else g.mc_error end
    where g.id = (u ->> 'id')::uuid and g.client_id = p_client;
    get diagnostics n = row_count;
    n_up := n_up + n;
  end loop;
  for u in select * from jsonb_array_elements(coalesce(p_ops -> 'insert', '[]'::jsonb)) loop
    v_kind := case when u ->> 'kind' in ('video', 'graphic') and u ->> 'key' ~ ('^' || (u ->> 'kind') || '\.[0-9]{1,4}$') then u ->> 'kind' else 'custom' end;
    insert into public.client_gantt (client_id, key, kind, title, day, time_il, month, num, state, posted_on, link, edited, source,
      mc_post_id, mc_status, mc_at, mc_networks, mc_error, mc_extra)
    values (p_client, u ->> 'key', v_kind, left(u ->> 'title', 200), (u ->> 'day')::date, (u ->> 'time_il')::time, (u ->> 'month')::smallint,
      case when v_kind = 'custom' then null else (u ->> 'num')::smallint end,
      coalesce(u ->> 'state', 'planned'), (u ->> 'posted_on')::date, u ->> 'link', true, 'metricool',
      u ->> 'mc_post_id', u ->> 'mc_status', (u ->> 'mc_at')::timestamptz,
      (select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof(u -> 'mc_networks') = 'array' then u -> 'mc_networks' else '[]'::jsonb end) x),
      left(u ->> 'mc_error', 300), true)
    on conflict (client_id, key) do nothing;
    get diagnostics n = row_count;
    n_in := n_in + n;
  end loop;
  -- Only a row the sync itself added, and nobody touched since, is ever removed.
  delete from public.client_gantt g
  where g.client_id = p_client and g.mc_extra and g.source = 'metricool'
    and g.id in (select (x #>> '{}')::uuid from jsonb_array_elements(coalesce(p_ops -> 'remove', '[]'::jsonb)) x);
  get diagnostics n_rm = row_count;
  perform set_config('astrateg.gantt_sync', '', true);
  insert into public.client_gantt_sync (client_id, at, ok, error, stats)
  values (p_client, now(), coalesce(p_ok, false), left(p_error, 120), coalesce(p_stats, '{}'::jsonb))
  on conflict (client_id) do update set at = excluded.at, ok = excluded.ok, error = excluded.error,
    -- A failed run keeps the counts of the last good one next to its error.
    stats = case when excluded.ok then excluded.stats else public.client_gantt_sync.stats end;
  return jsonb_build_object('updated', n_up, 'inserted', n_in, 'removed', n_rm);
end $$;

revoke execute on function public.gantt_sync_apply(uuid, jsonb, boolean, text, jsonb) from public, anon, authenticated;
grant execute on function public.gantt_sync_apply(uuid, jsonb, boolean, text, jsonb) to service_role;
