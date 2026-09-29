-- The vault is opened by a flag on the staff row, set only by the database
-- admin. It used to follow staff.person, which each user can change for
-- themselves ("who am I"), so an editor could pick another name and see
-- passwords. New staff rows get no vault until the admin grants it.
alter table public.staff add column vault boolean not null default false;
update public.staff set vault = true
where person is null or person in ('irit', 'lior', 'ofir', 'shirel', 'ilai');

create or replace function public.can_use_vault() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff s
    where s.email = lower(coalesce(auth.jwt() ->> 'email', '')) and s.vault
  );
$$;
