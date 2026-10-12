-- The staff WhatsApp channel through a second provider (the owner's decision of
-- 12.10.2026; docs/ops.md, section 63): Jako (my.jako.co.il), with its own API key,
-- next to Meta's Cloud API directly (20260930180000_whatsapp.sql), which stays as it
-- was and stays the default. Additive and safe to run again: nothing is removed, and
-- a function whose answer had to grow got a new name beside the old one.
--
--   whatsapp_provider         one row: 'meta' (default) or 'jako'. Set by the owner
--                             only, and only while the switch is off. (Not a key of
--                             app_settings: its list of keys is a check constraint,
--                             and widening one means removing it first.)
--   whatsapp_messages.provider  which provider a message went through. Jako returns
--                             no message id and no delivery updates: its rows are
--                             'sent' or 'failed', never 'delivered' or 'read'.
--   whatsapp_poll             per person who agreed: when Jako was last asked what
--                             they wrote, and up to when it was read. Jako has no
--                             webhook, so "הסר" is heard by asking (the reminders
--                             function, every few minutes). No message text is kept.
--
-- The secret (Vault, added by the owner; the name only here): whatsapp_jako_api_key.
-- With provider 'jako' it is the only one needed, and none of Meta's four.

-- ── The provider ───────────────────────────
create table if not exists public.whatsapp_provider (
  id boolean primary key default true check (id),   -- one row
  provider text not null default 'meta' check (provider in ('meta', 'jako')),
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

-- Whether the secrets of the chosen provider are all in Vault: Meta's four, or
-- Jako's one. (private.whatsapp_secrets_present() stays Meta's four, as it was.)
create or replace function private.whatsapp_ready() returns boolean
language sql stable security definer set search_path = '' as $$
  select case private.whatsapp_provider()
    when 'jako' then private.whatsapp_jako_key_present()
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
      when 'jako' then jsonb_build_object('jako_api_key', private.whatsapp_jako_key_present())
      else (select to_jsonb(s) from private.whatsapp_secrets_present() s) end)
  end;
$$;

-- On or off, by the owner only; on only when the chosen provider's secrets are in Vault.
create or replace function public.whatsapp_set_enabled(p_on boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_owner() then raise exception 'not allowed: owner only' using errcode = '42501'; end if;
  if p_on and not private.whatsapp_ready() then
    raise exception 'not_ready: WhatsApp secrets are missing in Vault' using errcode = 'P0001';
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

-- ── The functions' own helpers (service role only) ──
-- The sender's settings, with the provider: on only when that provider's secrets are
-- all there, and only that provider's secrets are returned. (A new name: the answer
-- has more columns than public.whatsapp_config().)
create or replace function public.whatsapp_config_v2()
returns table (enabled boolean, provider text, access_token text, phone_number_id text, jako_api_key text)
language sql stable security definer set search_path = '' as $$
  select private.whatsapp_enabled() and private.whatsapp_ready(),
         p.provider,
         case when private.whatsapp_enabled() and p.provider = 'meta' then (select decrypted_secret from vault.decrypted_secrets where name = 'whatsapp_access_token' limit 1) end,
         case when private.whatsapp_enabled() and p.provider = 'meta' then (select decrypted_secret from vault.decrypted_secrets where name = 'whatsapp_phone_number_id' limit 1) end,
         case when private.whatsapp_enabled() and p.provider = 'jako' then (select decrypted_secret from vault.decrypted_secrets where name = 'whatsapp_jako_api_key' limit 1) end
  from (select private.whatsapp_provider() as provider) p;
$$;

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
