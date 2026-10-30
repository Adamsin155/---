-- What was added to the clients' Google Drive folders, day by day, for "עבודה לפי עובד" (the
-- owner, 30.10.2026: "בכל יום לראות כמה קבצים עולים"; docs/ops.md, section 83).
--   public.drive_daily       per client, day (Israel), folder and kind: how many files.
--   public.drive_scan_state  per client: when it was last counted, and what failed.
--   public.drive_scan_tick() pg_cron, every 10 minutes in the day: the edge function `drive-scan`
--                            with the cron secret from Vault (as public.google_calendar_tick).
-- Only counts, folder names and days: no file name, no link, no content.
-- Who: the office of the progress tables reads (private.progress_office); only the service role writes.
-- client_id is not a foreign key, for the same reason as in public.editor_progress.
-- The file only adds, and can run again safely (tests/sql/drive-daily.test.mjs).

create table if not exists public.drive_daily (
  client_id uuid not null,
  day date not null,
  folder text not null default '',
  kind text not null check (kind in ('video', 'graphic', 'raw', 'other')),
  files integer not null default 0 check (files >= 0),
  primary key (client_id, day, folder, kind)
);
create index if not exists drive_daily_day on public.drive_daily (day);

create table if not exists public.drive_scan_state (
  client_id uuid primary key,
  scanned_at timestamptz not null default now(),
  error text,
  files integer not null default 0,
  truncated boolean not null default false
);

alter table public.drive_daily enable row level security;
alter table public.drive_scan_state enable row level security;
revoke all on table public.drive_daily from public, anon, authenticated;
revoke all on table public.drive_scan_state from public, anon, authenticated;
grant select on table public.drive_daily to authenticated;
grant select on table public.drive_scan_state to authenticated;
grant select, insert, update on table public.drive_daily to service_role;
grant select, insert, update on table public.drive_scan_state to service_role;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'drive_daily' and policyname = 'drive_daily_read') then
    create policy drive_daily_read on public.drive_daily for select to authenticated using ((select private.progress_office()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'drive_scan_state' and policyname = 'drive_scan_state_read') then
    create policy drive_scan_state_read on public.drive_scan_state for select to authenticated using ((select private.progress_office()));
  end if;
end $$;

create or replace function public.drive_scan_tick() returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  secret text;
  request bigint;
begin
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'reminders_cron_secret' limit 1;
  if coalesce(secret, '') = '' then
    raise notice 'drive_scan_tick: no reminders_cron_secret in Vault, nothing called';
    return null;
  end if;
  select net.http_post(
    url := 'https://czncjzziqrqtezpwxxpz.supabase.co/functions/v1/drive-scan',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 58000
  ) into request;
  return request;
end $$;
revoke execute on function public.drive_scan_tick() from public, anon, authenticated, service_role;

-- Every 10 minutes, 05:00-20:59 UTC. cron.schedule replaces a job of the same name.
select cron.schedule('drive-scan', '3,13,23,33,43,53 5-20 * * *', 'select public.drive_scan_tick()');
