-- Team screen (team.html → the staff-admin function): who added or changed a
-- staff row, who removed one, and who made a sign-in link for whom and when.
-- The link itself is never stored. Only the function (service role) reads and
-- writes this table; the browser has no access.
create table if not exists public.staff_admin_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  by_email text not null,
  action text not null check (action in ('upsert', 'remove', 'link')),
  target_email text not null,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists staff_admin_log_link_idx on public.staff_admin_log (action, at desc);

alter table public.staff_admin_log enable row level security;
revoke all on public.staff_admin_log from public, anon, authenticated;
