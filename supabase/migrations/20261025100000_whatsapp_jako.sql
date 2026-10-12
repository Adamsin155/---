-- The staff WhatsApp channel through a second provider (the owner's decision of
-- 12.10.2026; docs/ops.md, section 63): Jako (my.jako.co.il), with its own API key,
-- next to Meta's Cloud API directly (20260930180000_whatsapp.sql), which stays as it
-- was and stays the default. Additive and safe to run again: nothing is removed, and
-- a function whose answer had to grow got a new name beside the old one.
--
--   whatsapp_provider         one row: 'meta' (default) or 'jako', and Jako's two
--                             reply flows (the ns of the sub flow each quick reply
--                             starts: workspace data, not secrets). Set by the owner
--                             only; the provider only while the switch is off. (Not
--                             keys of app_settings: its list of keys is a check
--                             constraint, and widening one means removing it first.)
--   whatsapp_messages.provider  which provider a message went through. Jako returns
--                             no delivery updates: its rows are 'sent' or 'failed',
--                             never 'delivered' or 'read'. Its send returns no message
--                             id either; wa_message_id is read back from the person's
--                             chat at Jako after the send, when it can be.
--   whatsapp_poll             per person who agreed: when Jako was last asked what
--                             they wrote, and up to when it was read. Jako has no
--                             webhook, so "הסר" is heard by asking (the reminders
--                             function, every few minutes). No message text is kept.
--
-- Reply buttons with Jako: a quick reply there starts a sub flow, and the sub flow
-- calls the whatsapp-webhook function with a shared secret, who pressed and which
-- button. public.whatsapp_jako_hook() gives the function that secret (while the
-- provider is Jako), and public.whatsapp_jako_reply() applies the reply, once: the
-- key in whatsapp_inbound is the id of the press itself, as Jako's chat shows it.
--
-- The secrets (Vault, added by the owner himself; the names only here, and nothing
-- in this file creates or changes them): whatsapp_jako_api_key (sending) and
-- whatsapp_jako_hook_secret (the sub flows' calls). With provider 'jako' these two
-- are needed, and none of Meta's four.

-- ── The provider ───────────────────────────
create table if not exists public.whatsapp_provider (
  id boolean primary key default true check (id),   -- one row
  provider text not null default 'meta' check (provider in ('meta', 'jako')),
  -- The sub flows of the buttons "המשימה בוצעה" and "אני על זה" (Jako's ns of each).
  jako_flow_done text check (jako_flow_done is null or jako_flow_done ~ '^[A-Za-z0-9_.-]{3,100}$'),
  jako_flow_onit text check (jako_flow_onit is null or jako_flow_onit ~ '^[A-Za-z0-9_.-]{3,100}$'),
  updated_at timestamptz not null default now(),
  updated_by_email text
);
alter table public.whatsapp_provider enable row level security;
-- Read through public.whatsapp_settings() (the office) and by the functions only.
revoke all on public.whatsapp_provider from anon, authenticated;
insert into public.whatsapp_provider (id, provider) values (true, 'meta') on conflict (id) do nothing;

create or replace function private.whatsapp_provider() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select provider from public.whatsapp_provider where id), 'meta');
$$;

-- Whether Jako's API key is in Vault (never its value).
create or replace function private.whatsapp_jako_key_present() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'whatsapp_jako_api_key' and length(decrypted_secret) >= 20);
$$;

-- Whether the secret the sub flows call with is in Vault (never its value).
create or replace function private.whatsapp_jako_hook_present() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'whatsapp_jako_hook_secret' and length(decrypted_secret) >= 16);
$$;

-- Whether everything the chosen provider needs is in place: Meta's four secrets, or
-- Jako's two and its two reply flows (a template with a button cannot go out without
-- its flow, and a button nobody hears must not go out at all).
-- (private.whatsapp_secrets_present() stays Meta's four, as it was.)
create or replace function private.whatsapp_ready() returns boolean
language sql stable security definer set search_path = '' as $$
  select case private.whatsapp_provider()
    when 'jako' then private.whatsapp_jako_key_present() and private.whatsapp_jako_hook_present()
      and coalesce((select p.jako_flow_done is not null and p.jako_flow_onit is not null from public.whatsapp_provider p where p.id), false)
    else (select s.access_token and s.phone_number_id and s.app_secret and s.verify_token from private.whatsapp_secrets_present() s)
  end;
$$;

-- The flag, the provider and which of ITS secrets are in place, for the team screen
-- (the office). With Meta the answer is what it was, plus 'provider' and 'ready'.
create or replace function public.whatsapp_settings() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when public.is_office() then jsonb_build_object(
    'enabled', private.whatsapp_enabled(),
    'owner', private.is_owner(),
    'provider', private.whatsapp_provider(),
    'ready', private.whatsapp_ready(),
    'secrets', case private.whatsapp_provider()
      when 'jako' then jsonb_build_object('jako_api_key', private.whatsapp_jako_key_present(), 'jako_hook_secret', private.whatsapp_jako_hook_present())
      else (select to_jsonb(s) from private.whatsapp_secrets_present() s) end)
    -- Jako's reply flows: set or not (the screen says which is missing).
    || case private.whatsapp_provider() when 'jako' then jsonb_build_object('flows',
         (select jsonb_build_object('done', p.jako_flow_done is not null, 'onit', p.jako_flow_onit is not null) from public.whatsapp_provider p where p.id))
       else '{}'::jsonb end
  end;
$$;

-- On or off, by the owner only; on only when the chosen provider's secrets are in Vault.
create or replace function public.whatsapp_set_enabled(p_on boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_owner() then raise exception 'not allowed: owner only' using errcode = '42501'; end if;
  if p_on and not private.whatsapp_ready() then
    raise exception 'not_ready: WhatsApp secrets (or, with Jako, its reply flows) are missing' using errcode = 'P0001';
  end if;
  insert into public.app_settings (key, value, updated_at, updated_by_email)
  values ('whatsapp_enabled', to_jsonb(coalesce(p_on, false)), now(), lower(coalesce(auth.jwt() ->> 'email', '')))
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at, updated_by_email = excluded.updated_by_email;
  return public.whatsapp_settings();
end $$;

-- The provider, by the owner only, and only while the switch is off: messages never
-- move from one provider to the other in the middle of a day by one click. Off →
-- the provider → on again (which then checks the new provider's secrets).
create or replace function public.whatsapp_set_provider(p_provider text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_owner() then raise exception 'not allowed: owner only' using errcode = '42501'; end if;
  if p_provider is null or p_provider not in ('meta', 'jako') then raise exception 'bad_provider' using errcode = '22023'; end if;
  if private.whatsapp_enabled() and p_provider is distinct from private.whatsapp_provider() then
    raise exception 'switch_off_first: turn WhatsApp off before changing the provider' using errcode = 'P0001';
  end if;
  insert into public.whatsapp_provider (id, provider, updated_at, updated_by_email)
  values (true, p_provider, now(), lower(coalesce(auth.jwt() ->> 'email', '')))
  on conflict (id) do update set provider = excluded.provider, updated_at = excluded.updated_at, updated_by_email = excluded.updated_by_email;
  return public.whatsapp_settings();
end $$;

-- Jako's two reply flows, by the owner only (at any time: they change nothing but
-- which sub flow a button starts). An empty value clears one, and the switch then
-- cannot be turned on until it is set again.
create or replace function public.whatsapp_set_jako_flows(p_done text, p_onit text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_done text := nullif(btrim(coalesce(p_done, '')), '');
  v_onit text := nullif(btrim(coalesce(p_onit, '')), '');
begin
  if not private.is_owner() then raise exception 'not allowed: owner only' using errcode = '42501'; end if;
  if v_done !~ '^[A-Za-z0-9_.-]{3,100}$' or v_onit !~ '^[A-Za-z0-9_.-]{3,100}$' then raise exception 'bad_flow' using errcode = '22023'; end if;
  insert into public.whatsapp_provider (id, jako_flow_done, jako_flow_onit, updated_at, updated_by_email)
  values (true, v_done, v_onit, now(), lower(coalesce(auth.jwt() ->> 'email', '')))
  on conflict (id) do update set jako_flow_done = excluded.jako_flow_done, jako_flow_onit = excluded.jako_flow_onit, updated_at = excluded.updated_at, updated_by_email = excluded.updated_by_email;
  return public.whatsapp_settings();
end $$;

-- ── The functions' own helpers (service role only) ──
-- The sender's settings, with the provider: on only when everything that provider
-- needs is there, and only that provider's secrets are returned. (A new name: the
-- answer has more columns than public.whatsapp_config().)
create or replace function public.whatsapp_config_v2()
returns table (enabled boolean, provider text, access_token text, phone_number_id text, jako_api_key text, jako_flow_done text, jako_flow_onit text)
language sql stable security definer set search_path = '' as $$
  select private.whatsapp_enabled() and private.whatsapp_ready(),
         p.provider,
         case when private.whatsapp_enabled() and p.provider = 'meta' then (select decrypted_secret from vault.decrypted_secrets where name = 'whatsapp_access_token' limit 1) end,
         case when private.whatsapp_enabled() and p.provider = 'meta' then (select decrypted_secret from vault.decrypted_secrets where name = 'whatsapp_phone_number_id' limit 1) end,
         case when private.whatsapp_enabled() and p.provider = 'jako' then (select decrypted_secret from vault.decrypted_secrets where name = 'whatsapp_jako_api_key' limit 1) end,
         case when p.provider = 'jako' then (select w.jako_flow_done from public.whatsapp_provider w where w.id) end,
         case when p.provider = 'jako' then (select w.jako_flow_onit from public.whatsapp_provider w where w.id) end
  from (select private.whatsapp_provider() as provider) p;
$$;

-- The secret the sub flows call the whatsapp-webhook function with, the provider, and
-- Jako's API key (the function reads the person's chat to find the press itself, and
-- so the exact message it answers). Only while the provider is Jako (also while the
-- switch is off: a reply to a message that already went out is still the person's to
-- give). Read from Vault, never set here.
create or replace function public.whatsapp_jako_hook()
returns table (provider text, hook_secret text, jako_api_key text)
language sql stable security definer set search_path = '' as $$
  select p.provider,
         case when p.provider = 'jako' then (select decrypted_secret from vault.decrypted_secrets where name = 'whatsapp_jako_hook_secret' and length(decrypted_secret) >= 16 limit 1) end,
         case when p.provider = 'jako' then (select decrypted_secret from vault.decrypted_secrets where name = 'whatsapp_jako_api_key' and length(decrypted_secret) >= 20 limit 1) end
  from (select private.whatsapp_provider() as provider) p;
$$;

-- A reply that came through Jako, applied once (p_inbound names the button and the
-- message it was matched to). p_plan comes from app/wa-logic.js jakoReplyPlan:
--   { op: 'nag_done', task }   "המשימה בוצעה" on a nagging task: closed by its
--                               assignee, through the function the app itself calls
--                               (public.staff_task_done), in that person's name
--   anything else               as with Meta: public.whatsapp_apply (task_start, claim,
--                               task_done on a simple task, none)
-- The message must be one that went through Jako to the number the reply came from.
create or replace function public.whatsapp_jako_reply(p_inbound text, p_message bigint, p_from text, p_plan jsonb)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  m public.whatsapp_messages;
  l public.reminder_log;
  v_task uuid;
  v_user uuid;
  v_result text;
  -- The message was not named by the press but assumed (the last one with that button).
  v_last boolean := coalesce(p_plan ->> 'match', '') = 'last';
begin
  select * into m from public.whatsapp_messages where id = p_message;
  if m.id is null or m.provider <> 'jako' or m.phone is distinct from p_from then
    insert into public.whatsapp_inbound (id, message_id, op, result) values (p_inbound, null, 'none', 'unknown') on conflict (id) do nothing;
    return 'unknown';
  end if;
  if coalesce(p_plan ->> 'op', 'none') <> 'nag_done' then
    v_result := public.whatsapp_apply(p_inbound, p_message, p_from, p_plan);
    if v_last and v_result <> 'duplicate' then
      update public.whatsapp_inbound set result = left(result || ' (last message)', 100) where id = p_inbound;
    end if;
    return v_result;
  end if;

  insert into public.whatsapp_inbound (id, message_id, op) values (p_inbound, p_message, 'nag_done') on conflict (id) do nothing;
  if not found then return 'duplicate'; end if;
  select * into l from public.reminder_log where id = m.log_id;
  -- The task is the one this reminder is about, whatever the plan says.
  if l.rule = 'nag' and pg_input_is_valid(split_part(l.key, ':', 3), 'uuid') and split_part(l.key, ':', 3) = p_plan ->> 'task' then
    v_task := split_part(l.key, ':', 3)::uuid;
  end if;
  -- The person's own confirmed login: the app's function checks it (public.is_staff()).
  select u.id into v_user from auth.users u where lower(u.email) = m.email and u.email_confirmed_at is not null limit 1;
  if v_task is null or v_user is null
     or not exists (select 1 from public.staff_tasks t where t.id = v_task and t.status = 'open' and t.assignee = l.person) then
    v_result := 'not_open';
  else
    -- As that person, for this transaction only: the function's own checks (only the
    -- assignee marks a task done) and its stamp of who marked it.
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'email', m.email, 'role', 'service_role')::text, true);
    perform public.staff_task_done(v_task);
    v_result := 'done';
  end if;
  update public.whatsapp_inbound set result = v_result || case when v_last then ' (last message)' else '' end where id = p_inbound;
  return v_result;
end $$;

-- Meta's settings, as before, and nothing at all while the provider is Jako: a
-- function that still asks this way (one deployed before this migration, or the
-- webhook's answers) then sends nothing through Meta.
create or replace function public.whatsapp_config()
returns table (enabled boolean, access_token text, phone_number_id text)
language sql stable security definer set search_path = '' as $$
  select private.whatsapp_provider() = 'meta' and private.whatsapp_enabled() and s.access_token and s.phone_number_id and s.app_secret and s.verify_token,
         case when private.whatsapp_provider() = 'meta' and private.whatsapp_enabled() then (select decrypted_secret from vault.decrypted_secrets where name = 'whatsapp_access_token' limit 1) end,
         case when private.whatsapp_provider() = 'meta' and private.whatsapp_enabled() then (select decrypted_secret from vault.decrypted_secrets where name = 'whatsapp_phone_number_id' limit 1) end
  from private.whatsapp_secrets_present() s;
$$;

-- Meta's webhook is Meta's: while the provider is Jako it gets no secrets, so the
-- whatsapp-webhook function answers 503 "not ready" to every call, as it does before
-- the secrets are added, and applies nothing.
create or replace function public.whatsapp_webhook_secrets()
returns table (app_secret text, verify_token text, phone_number_id text)
language sql stable security definer set search_path = '' as $$
  select case when p.meta then (select decrypted_secret from vault.decrypted_secrets where name = 'whatsapp_app_secret' limit 1) end,
         case when p.meta then (select decrypted_secret from vault.decrypted_secrets where name = 'whatsapp_verify_token' limit 1) end,
         case when p.meta then (select decrypted_secret from vault.decrypted_secrets where name = 'whatsapp_phone_number_id' limit 1) end
  from (select private.whatsapp_provider() = 'meta' as meta) p;
$$;

-- ── Messages ───────────────────────────────
alter table public.whatsapp_messages add column if not exists provider text not null default 'meta' check (provider in ('meta', 'jako'));

-- ── "הסר" without a webhook ────────────────
-- (No foreign key to public.staff: a row of someone who left is never read again, as
-- whatsapp_poll_due starts from the consents, and it holds two times and no more.)
create table if not exists public.whatsapp_poll (
  email text primary key,
  checked_at timestamptz,   -- when the provider was last asked (the pace)
  read_until timestamptz    -- incoming messages were read up to here
);
alter table public.whatsapp_poll enable row level security;
revoke all on public.whatsapp_poll from anon, authenticated;

-- Who is asked now: people whose consent stands for the number they have today (as
-- app/wa-logic.js waRecipients), not asked in the last p_every_seconds, the longest
-- wait first, at most p_max. Marks them asked, and returns from when to read: where
-- the last reading ended, never before the consent itself (a "הסר" written before
-- someone agreed again must not stop the new consent).
create or replace function public.whatsapp_poll_due(p_max integer default 5, p_every_seconds integer default 300)
returns table (email text, person text, phone text, since timestamptz)
language plpgsql set search_path = '' as $$
begin
  return query
  with due as (
    select c.email as c_email, c.person as c_person, c.phone as c_phone, greatest(coalesce(p.read_until, c.decided_at), c.decided_at) as c_since
    from public.whatsapp_consents c
    join public.staff s on s.email = c.email
    left join public.whatsapp_poll p on p.email = c.email
    where c.status = 'granted' and c.phone is not null and (s.person is null or s.phone = c.phone)
      and (p.checked_at is null or p.checked_at <= now() - make_interval(secs => greatest(coalesce(p_every_seconds, 300), 60)))
    order by p.checked_at nulls first, c.email
    limit least(greatest(coalesce(p_max, 5), 1), 50)
  ), marked as (
    insert into public.whatsapp_poll as w (email, checked_at)
    select d.c_email, now() from due d
    on conflict on constraint whatsapp_poll_pkey do update set checked_at = excluded.checked_at
    returning w.email
  )
  select d.c_email, d.c_person, d.c_phone, d.c_since from due d join marked m on m.email = d.c_email order by d.c_email;
end $$;

-- A reading that succeeded: the next one starts where it ended. Only forward, and
-- never past now.
create or replace function public.whatsapp_poll_done(p_email text, p_until timestamptz) returns void
language sql set search_path = '' as $$
  insert into public.whatsapp_poll as w (email, checked_at, read_until)
  select s.email, now(), least(coalesce(p_until, now()), now()) from public.staff s where s.email = lower(coalesce(p_email, ''))
  on conflict on constraint whatsapp_poll_pkey do update set read_until = greatest(coalesce(w.read_until, excluded.read_until), excluded.read_until);
$$;

revoke execute on function private.whatsapp_provider() from public, anon, authenticated;
revoke execute on function private.whatsapp_jako_key_present() from public, anon, authenticated;
revoke execute on function private.whatsapp_ready() from public, anon, authenticated;
revoke execute on function private.whatsapp_jako_hook_present() from public, anon, authenticated;
revoke execute on function public.whatsapp_set_jako_flows(text, text) from public, anon;
grant execute on function public.whatsapp_set_jako_flows(text, text) to authenticated;
revoke execute on function public.whatsapp_jako_hook() from public, anon, authenticated;
revoke execute on function public.whatsapp_jako_reply(text, bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.whatsapp_jako_hook() to service_role;
grant execute on function public.whatsapp_jako_reply(text, bigint, text, jsonb) to service_role;
revoke execute on function public.whatsapp_settings() from public, anon;
revoke execute on function public.whatsapp_set_enabled(boolean) from public, anon;
revoke execute on function public.whatsapp_set_provider(text) from public, anon;
grant execute on function public.whatsapp_settings() to authenticated;
grant execute on function public.whatsapp_set_enabled(boolean) to authenticated;
grant execute on function public.whatsapp_set_provider(text) to authenticated;

revoke execute on function public.whatsapp_config() from public, anon, authenticated;
revoke execute on function public.whatsapp_config_v2() from public, anon, authenticated;
revoke execute on function public.whatsapp_webhook_secrets() from public, anon, authenticated;
revoke execute on function public.whatsapp_poll_due(integer, integer) from public, anon, authenticated;
revoke execute on function public.whatsapp_poll_done(text, timestamptz) from public, anon, authenticated;
grant execute on function public.whatsapp_config() to service_role;
grant execute on function public.whatsapp_config_v2() to service_role;
grant execute on function public.whatsapp_webhook_secrets() to service_role;
grant execute on function public.whatsapp_poll_due(integer, integer) to service_role;
grant execute on function public.whatsapp_poll_done(text, timestamptz) to service_role;
grant select, insert, update on public.whatsapp_poll to service_role;
grant select on public.whatsapp_provider to service_role;
