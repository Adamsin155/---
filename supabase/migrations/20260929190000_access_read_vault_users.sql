-- Video editors do not use client logins: they cannot read the access rows or
-- their log either (user names included), not only the passwords.
drop policy "staff read access" on public.client_access;
drop policy "staff read access log" on public.client_access_log;
create policy "vault users read access" on public.client_access
  for select to authenticated using (public.can_use_vault());
create policy "vault users read access log" on public.client_access_log
  for select to authenticated using (public.can_use_vault());
