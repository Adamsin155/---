-- The history trigger function is not an API: only the trigger calls it.
revoke execute on function public.protocol_checks_log() from public, anon, authenticated;
