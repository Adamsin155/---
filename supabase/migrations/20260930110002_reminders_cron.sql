-- Stage 3: the reminder engine's clock. pg_cron calls public.reminders_tick()
-- every minute, and it calls the reminders edge function with the cron secret
-- from Vault ('reminders_cron_secret'), never written in SQL or in the
-- repository. The schedule is in UTC, but the function works out Israel time
-- itself (app/tz.js), so the move to winter time changes nothing here.
-- Until the secret exists in Vault the tick does nothing, so this can be applied
-- before the function is deployed. docs/ops.md: "מנוע התזכורות".
create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.reminders_tick() returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  secret text;
  request bigint;
begin
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'reminders_cron_secret' limit 1;
  if coalesce(secret, '') = '' then
    raise notice 'reminders_tick: no reminders_cron_secret in Vault, nothing called';
    return null;
  end if;
  select net.http_post(
    url := 'https://czncjzziqrqtezpwxxpz.supabase.co/functions/v1/reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := jsonb_build_object('action', 'tick'),
    timeout_milliseconds := 55000
  ) into request;
  return request;
end $$;

-- Only the scheduler (the postgres role, which owns it) runs it.
revoke execute on function public.reminders_tick() from public, anon, authenticated, service_role;

-- Every minute. cron.schedule replaces a job of the same name.
select cron.schedule('reminders-tick', '* * * * *', 'select public.reminders_tick()');
-- The scheduler's own history: a week is enough (a row a minute otherwise piles up).
select cron.schedule('reminders-cron-history', '17 3 * * *', $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$);
