-- Nirel may edit any shoot, not only Natali Dadon's (the owner's decision of 21.10.2026).
-- She stays the one preselected for a Natali shoot (app/qa-logic.js preselected); only the
-- restriction goes.
--
-- The restriction was a check on public.clients (clients_nirel_natali_check, 20260929210000
-- _editor_rules.sql), and a check can only be taken away by name. The owner approved this one
-- statement knowingly (22.10.2026); it is the only one of its kind in this file, and the file
-- holds nothing else that takes anything away (tests/sql/nirel-any-shoot.test.mjs).
alter table public.clients drop constraint if exists clients_nirel_natali_check;

-- The landing's write of a real editor (20261026100000_landing_editor.sql), the same but
-- without the Natali-only rule for Nirel.
create or replace function public.landing_set_editor(p_client uuid, p_editor text default null, p_round integer default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me text;
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_who text;
  v_landing boolean;
  v_status text;
  v_type text;
  v_rounds jsonb;
  v_round jsonb;
  v_pre text := '';
  v_prev_at timestamptz;
  v_prev_by text;
  v_prev_set boolean := false;
  v_took boolean;
  k text;
begin
  if not public.is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  me := public.my_person();
  if not (private.is_owner() or coalesce(me, '') in ('irit', 'lior', 'ofir')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_client is null or not public.can_see_client(p_client) then raise exception 'not allowed' using errcode = '42501'; end if;

  select c.landing, c.status, c.shoot_type, coalesce(c.rounds, '[]'::jsonb)
    into v_landing, v_status, v_type, v_rounds
  from public.clients c where c.id = p_client for update;
  if not found then raise exception 'client not found' using errcode = '22023'; end if;
  if not v_landing then raise exception 'not in landing: this client is already active' using errcode = 'P0001'; end if;
  if v_status is null or v_status not in ('active', 'ending') then raise exception 'not in work' using errcode = 'P0001'; end if;

  -- The shoot: the client's own (round null), or an extra round that exists.
  if p_round is not null then
    if jsonb_typeof(v_rounds) = 'array' then
      select r into v_round from jsonb_array_elements(v_rounds) as t(r)
      where jsonb_typeof(r) = 'object' and r ->> 'n' = p_round::text limit 1;
    end if;
    if v_round is null or p_round < 2 then raise exception 'no such round' using errcode = '22023'; end if;
    v_pre := 'r' || p_round || '.';
    v_type := coalesce(nullif(v_round ->> 'shoot_type', ''), v_type);
  end if;

  if p_editor is not null and p_editor not in ('nadia', 'yariv', 'anna', 'nirel') then
    raise exception 'editor not allowed for this shoot' using errcode = '22023';
  end if;

  -- A real assignment, or imported history: not this function's to change.
  if exists (select 1 from public.protocol_checks x where x.client_id = p_client and x.item_key = v_pre || 'p22a.assigned') then
    raise exception 'already assigned: the editor is changed through Ofir' using errcode = 'P0001';
  end if;

  -- What this function wrote last time carries the same moment and the same hand as the
  -- answer "שויך" (one call, one transaction): that is how its own answers are told apart.
  select m.at, m.by_email, m.choice = 'done' into v_prev_at, v_prev_by, v_prev_set
  from public.client_landing_marks m where m.client_id = p_client and m.item_key = v_pre || 'p22a.assigned';
  v_prev_set := coalesce(v_prev_set, false);
  v_who := coalesce(me, 'owner');

  if p_editor is null then
    if not v_prev_set then
      return jsonb_build_object('editor', null, 'round', p_round, 'changed', false);
    end if;
    update public.client_landing_marks m set choice = 'open', person = v_who, by_email = v_email, at = now()
    where m.client_id = p_client and (
      m.item_key in (v_pre || 'p22a.load', v_pre || 'p22a.assigned')
      or (m.item_key in (v_pre || 'p22a.irit', v_pre || 'p22a.drive') and m.at = v_prev_at and m.by_email = v_prev_by));
  else
    insert into public.client_landing_marks as m (client_id, item_key, choice, person, by_email, at)
    values (p_client, v_pre || 'p22a.load', 'done', v_who, v_email, now()),
           (p_client, v_pre || 'p22a.assigned', 'done', v_who, v_email, now())
    on conflict (client_id, item_key) do update
      set choice = 'done', person = excluded.person, by_email = excluded.by_email, at = excluded.at;
    -- What closes with an assignment (app/qa.js saveAssign): Irit's check, and Lior's drive
    -- once he took it back, as the dialog closes them: unless somebody already answered
    -- "כבר בוצע" or "לא רלוונטי" (an answer "עדיין פתוח" is closed, as a real assignment would).
    v_took := exists (select 1 from public.protocol_checks x where x.client_id = p_client and x.item_key = v_pre || 'p19.took' and x.state in ('done', 'na'))
      or exists (select 1 from public.client_landing_marks x where x.client_id = p_client and x.item_key = v_pre || 'p19.took' and x.choice in ('done', 'na'));
    foreach k in array case when v_took then array[v_pre || 'p22a.irit', v_pre || 'p22a.drive'] else array[v_pre || 'p22a.irit'] end loop
      continue when exists (select 1 from public.protocol_checks x where x.client_id = p_client and x.item_key = k);
      insert into public.client_landing_marks as m (client_id, item_key, choice, person, by_email, at)
      values (p_client, k, 'done', v_who, v_email, now())
      on conflict (client_id, item_key) do update
        set choice = 'done', person = excluded.person, by_email = excluded.by_email, at = excluded.at
        where m.choice = 'open' or (m.at = v_prev_at and m.by_email = v_prev_by);
    end loop;
  end if;

  -- The editor of that shoot, where the assignment dialog writes it.
  if p_round is null then
    update public.clients c set editor = p_editor where c.id = p_client;
  else
    update public.clients c set rounds = (
      select jsonb_agg(case when jsonb_typeof(r) = 'object' and r ->> 'n' = p_round::text
        then jsonb_set(r, '{editor}', coalesce(to_jsonb(p_editor), 'null'::jsonb)) else r end order by i)
      from jsonb_array_elements(v_rounds) with ordinality as t(r, i))
    where c.id = p_client;
  end if;
  return jsonb_build_object('editor', p_editor, 'round', p_round, 'changed', true);
end $$;
revoke execute on function public.landing_set_editor(uuid, text, integer) from public, anon;
grant execute on function public.landing_set_editor(uuid, text, integer) to authenticated;
