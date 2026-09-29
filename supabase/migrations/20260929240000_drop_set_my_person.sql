-- Who someone is (staff.person) is set only by the admin now; the app reads it
-- and no longer lets people choose. Removing the self-service function closes
-- the door to impersonating another role.
drop function if exists public.set_my_person(text);
