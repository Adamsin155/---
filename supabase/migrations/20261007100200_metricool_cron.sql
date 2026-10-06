-- The Metricool sync's clock (docs/ops.md, section 27). After 20261007100100_metricool.sql.
-- Every 15 minutes pg_cron calls public.metricool_tick(), which calls the `metricool`
-- edge function ({ action: 'sync' }) with the cron secret from Vault, the same
-- 'reminders_cron_secret' the reminders' clock uses (20260930110002_reminders_cron.sql):
-- never written in SQL or in the repository, and compared inside the database
-- (public.reminders_check_secret).
-- Nothing is called while the switch is off, while a secret is missing, or between
-- 00:00 and 06:00 in Israel (nothing is scheduled or checked at night; the schedule
-- itself is in UTC, so the hour is worked out here and the clock changes move nothing).
-- Safe to apply before the function is deployed and to run again.
create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.metricool_tick() returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  secret text;
  request bigint;
  ready boolean;
begin
  select c.enabled into ready from public.metricool_config() c;
  if not coalesce(ready, false) then return null; end if;
  if extract(hour from (now() at time zone 'Asia/Jerusalem')) < 6 then return null; end if;
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'reminders_cron_secret' limit 1;
  if coalesce(secret, '') = '' then
    raise notice 'metricool_tick: no reminders_cron_secret in Vault, nothing called';
    return null;
  end if;
  select net.http_post(
    url := 'https://czncjzziqrqtezpwxxpz.supabase.co/functions/v1/metricool',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := jsonb_build_object('action', 'sync'),
    timeout_milliseconds := 55000
  ) into request;
  return request;
end $$;

-- Only the scheduler (the postgres role, which owns it) runs it.
revoke execute on function public.metricool_tick() from public, anon, authenticated, service_role;

-- Every 15 minutes. cron.schedule replaces a job of the same name.
select cron.schedule('metricool-sync', '*/15 * * * *', 'select public.metricool_tick()');
