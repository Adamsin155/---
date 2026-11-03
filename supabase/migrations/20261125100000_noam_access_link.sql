-- Noam makes the client's link to the logins form too (the owner, 3.11.2026: "צריך להוסיף לנעם
-- אופציה לעשות יצירת קישור לגישה לרשתות"): the link is part of process 5, hers when she runs the
-- meeting. Only replaces one function: whoever made, copied or revoked a link until now still does.
-- Safe to run again. Tested in tests/sql/noam-access-link.test.mjs.

create or replace function public.can_manage_access_links() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff() and exists (
    select 1 from public.staff s
    where s.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (s.person is null or s.person in ('irit', 'lior', 'ofir', 'noam'))
  );
$$;
revoke execute on function public.can_manage_access_links() from public, anon;
grant execute on function public.can_manage_access_links() to authenticated;
