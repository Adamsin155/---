-- A note on a date change: why a shoot day was set against the usual order.
--
-- Found in the live end-to-end run (6.10.2026): the card accepted a shoot day on the
-- evening of the characterization itself, before any script exists. The office is
-- not blocked (real life has exceptions), but it is asked to confirm, with the
-- reason: the shoot is in the past, before the characterization, or earlier than 3
-- business days after it (app/shoot-prep.js shootDateConcerns). The confirmation is
-- kept in the history of date changes that already exists (client_date_changes,
-- 20260930120000_owner_screens.sql): a `note` on the row.
--
-- The rows are still written by the database (the trigger clients_log_date_changes),
-- never by the browser. date_change_note() puts the note on the row the caller's
-- change just made (the latest row of that date, when it is theirs); a first setting of a date makes no row (nothing "changed"), so
-- there it adds one with no old value (the screens that count moved shoot days and
-- deadline changes skip rows without an old value).
--
-- After 20260930130000_assignment_rls.sql. Safe to run again; moves no data.

alter table public.client_date_changes add column if not exists note text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'client_date_changes_note_len') then
    alter table public.client_date_changes add constraint client_date_changes_note_len check (note is null or length(note) <= 500);
  end if;
end $$;

create or replace function public.date_change_note(p_client uuid, p_field text, p_round smallint, p_new text, p_note text)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  n text := nullif(btrim(coalesce(p_note, '')), '');
  rid bigint;
begin
  -- Whoever may change the client's dates: the office, on a client it sees.
  if not public.is_office() or not public.can_see_client(p_client) then raise exception 'not allowed'; end if;
  if p_field is null or p_field not in ('shoot_at', 'round_shoot_at') then raise exception 'unknown field'; end if;
  if n is null or length(n) > 500 then raise exception 'a note of 1 to 500 characters is required'; end if;
  -- The latest change of this date, when it is the caller's own and was just made.
  select d.id into rid from (
    select x.id, x.by_email, x.at, x.old_value, x.note from public.client_date_changes x
    where x.client_id = p_client and x.field = p_field and x.round is not distinct from p_round
    order by x.id desc limit 1
  ) d
  where d.by_email = me and d.at > now() - interval '5 minutes' and d.old_value is not null and d.note is null;
  if rid is not null then
    update public.client_date_changes set note = n where id = rid;
  else
    insert into public.client_date_changes (client_id, field, round, old_value, new_value, by_email, note)
    values (p_client, p_field, p_round, null, left(p_new, 100), me, n)
    returning id into rid;
  end if;
  return rid;
end $$;
revoke execute on function public.date_change_note(uuid, text, smallint, text, text) from public, anon;
grant execute on function public.date_change_note(uuid, text, smallint, text, text) to authenticated;
