-- Stage 3: the owner's screens (docs/plan/system-plan.md, section 6; decisions
-- 22–24; app/health.js, owner.html).
--  1. client_questions: "שאלה לאחראי" on screen 1. The owner (or the office) asks
--     the one person responsible; the question is saved with the client, the
--     person sees it in "מה עליי" and answers there, and the answer shows back in
--     the owner's row.
--  2. client_date_changes: every change of a date a deadline hangs on (the deal,
--     the meeting, the shoot day, a shoot round, the contract end, a task's due
--     day), written by the database itself. It turns a moved shoot day red, and
--     screen 4 counts deadline changes per person (anti-gaming, section 6).
-- Who and when are always stamped here, never taken from the browser.

-- ── Who may ask ───────────────────────────
-- Office staff: a staff member (is_staff: a confirmed login on the allowlist)
-- who is the owner (staff.person is null), Irit, Lior or Ofir.
create or replace function public.can_ask_questions() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff() and exists (
    select 1 from public.staff s
    where s.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (s.person is null or s.person in ('irit', 'lior', 'ofir'))
  );
$$;
revoke execute on function public.can_ask_questions() from public, anon;
grant execute on function public.can_ask_questions() to authenticated;

-- Whether a question is addressed to the signed-in person (their staff.person).
create or replace function public.is_my_question(p_to text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff() and exists (
    select 1 from public.staff s
    where s.email = lower(coalesce(auth.jwt() ->> 'email', '')) and s.person = p_to
  );
$$;
revoke execute on function public.is_my_question(text) from public, anon;
grant execute on function public.is_my_question(text) to authenticated;

-- ── Questions ─────────────────────────────
-- client_id is null for a question about the office rather than one client (a
-- daily review not done). `about` is the reason code of the row it was asked
-- from, and `context` that reason in words, so the answer finds its way back.
create table public.client_questions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients (id) on delete cascade,
  to_person text not null check (to_person in ('irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli')),
  about text check (about is null or about ~ '^[a-z0-9_.:-]{1,80}$'),
  context text check (context is null or length(context) <= 300),
  question text not null check (length(btrim(question)) between 1 and 1000),
  asked_by text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  asked_at timestamptz not null default now(),
  answer text check (answer is null or length(btrim(answer)) between 1 and 2000),
  answered_by text,
  answered_at timestamptz,
  constraint client_questions_answered check ((answer is null) = (answered_at is null))
);
create index client_questions_open_idx on public.client_questions (to_person, asked_at desc) where answer is null;
create index client_questions_client_idx on public.client_questions (client_id, asked_at desc);
create index client_questions_asked_idx on public.client_questions (asked_at desc);

-- Asking stamps who and when. After that a question changes only by its answer
-- (or the answer taken back), and who answered and when come from the session.
create function public.client_questions_stamp() returns trigger
language plpgsql set search_path = '' as $$
declare me text := coalesce(nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''), 'system');
begin
  if tg_op = 'INSERT' then
    new.asked_by := me;
    new.asked_at := now();
    new.question := btrim(new.question);
    new.answer := null;
    new.answered_by := null;
    new.answered_at := null;
    return new;
  end if;
  new.id := old.id;
  new.client_id := old.client_id;
  new.to_person := old.to_person;
  new.about := old.about;
  new.context := old.context;
  new.question := old.question;
  new.asked_by := old.asked_by;
  new.asked_at := old.asked_at;
  if new.answer is null then
    new.answered_by := null;
    new.answered_at := null;
  else
    new.answer := btrim(new.answer);
    new.answered_by := me;
    new.answered_at := now();
  end if;
  return new;
end $$;

create trigger client_questions_stamp before insert or update on public.client_questions
for each row execute function public.client_questions_stamp();
-- Trigger functions are not an API: only the trigger calls them.
revoke execute on function public.client_questions_stamp() from public, anon, authenticated;

alter table public.client_questions enable row level security;
-- The office reads and asks; the person asked reads their own and answers them.
create policy "office reads questions" on public.client_questions
  for select to authenticated using ((select public.can_ask_questions()));
create policy "addressee reads own questions" on public.client_questions
  for select to authenticated using (public.is_my_question(to_person));
create policy "office asks questions" on public.client_questions
  for insert to authenticated with check ((select public.can_ask_questions()));
create policy "addressee answers" on public.client_questions
  for update to authenticated using (public.is_my_question(to_person)) with check (public.is_my_question(to_person));
-- Undo: whoever asked may take back their own question within 5 minutes, before it is answered.
create policy "asker withdraws a fresh question" on public.client_questions
  for delete to authenticated using (
    (select public.can_ask_questions())
    and asked_by = lower(coalesce(auth.jwt() ->> 'email', ''))
    and answer is null
    and asked_at > now() - interval '5 minutes'
  );

revoke all on public.client_questions from anon;
revoke truncate on public.client_questions from authenticated;
grant select, insert, update, delete on public.client_questions to authenticated;

-- ── Date changes ──────────────────────────
-- Append-only, written only by the triggers below. A date set for the first time
-- is not a change; a date changed or removed is. `round` is the extra shoot round
-- (clients.rounds[].n), `task_id` the task whose due day changed.
create table public.client_date_changes (
  id bigint generated always as identity primary key,
  client_id uuid not null references public.clients (id) on delete cascade,
  field text not null check (field in ('deal_at', 'char_at', 'shoot_at', 'contract_end', 'round_shoot_at', 'task_due')),
  round smallint,
  task_id uuid,
  old_value text,
  new_value text,
  by_email text not null,
  at timestamptz not null default now()
);
create index client_date_changes_client_idx on public.client_date_changes (client_id, at desc);
create index client_date_changes_at_idx on public.client_date_changes (at desc);

-- Timestamps are kept in their ISO form ("2026-10-13T08:00:00+00:00").
create function public.clients_log_date_changes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  me text := coalesce(nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''), 'system');
  r jsonb;
  o jsonb;
begin
  if old.deal_at is distinct from new.deal_at then
    insert into public.client_date_changes (client_id, field, old_value, new_value, by_email)
    values (new.id, 'deal_at', to_jsonb(old.deal_at) #>> '{}', to_jsonb(new.deal_at) #>> '{}', me);
  end if;
  if old.char_at is not null and old.char_at is distinct from new.char_at then
    insert into public.client_date_changes (client_id, field, old_value, new_value, by_email)
    values (new.id, 'char_at', to_jsonb(old.char_at) #>> '{}', to_jsonb(new.char_at) #>> '{}', me);
  end if;
  if old.shoot_at is not null and old.shoot_at is distinct from new.shoot_at then
    insert into public.client_date_changes (client_id, field, old_value, new_value, by_email)
    values (new.id, 'shoot_at', to_jsonb(old.shoot_at) #>> '{}', to_jsonb(new.shoot_at) #>> '{}', me);
  end if;
  if old.contract_end is not null and old.contract_end is distinct from new.contract_end then
    insert into public.client_date_changes (client_id, field, old_value, new_value, by_email)
    values (new.id, 'contract_end', old.contract_end::text, new.contract_end::text, me);
  end if;
  -- Extra shoot rounds: a round whose date was set and then changed (or removed).
  if jsonb_typeof(old.rounds) = 'array' and jsonb_typeof(new.rounds) = 'array' then
    for o in select value from jsonb_array_elements(old.rounds) loop
      continue when jsonb_typeof(o) <> 'object' or nullif(o ->> 'shoot_at', '') is null or coalesce(o ->> 'n', '') !~ '^[0-9]{1,4}$';
      select value into r from jsonb_array_elements(new.rounds) where jsonb_typeof(value) = 'object' and value ->> 'n' = o ->> 'n' limit 1;
      if r is not null and nullif(r ->> 'shoot_at', '') is distinct from (o ->> 'shoot_at') then
        insert into public.client_date_changes (client_id, field, round, old_value, new_value, by_email)
        values (new.id, 'round_shoot_at', (o ->> 'n')::smallint, o ->> 'shoot_at', nullif(r ->> 'shoot_at', ''), me);
      end if;
      r := null;
    end loop;
  end if;
  return new;
end $$;

create trigger clients_date_changes after update of deal_at, char_at, shoot_at, contract_end, rounds on public.clients
for each row execute function public.clients_log_date_changes();
revoke execute on function public.clients_log_date_changes() from public, anon, authenticated;

create function public.client_tasks_log_due_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.due_on is not null and old.due_on is distinct from new.due_on then
    insert into public.client_date_changes (client_id, field, task_id, old_value, new_value, by_email)
    values (new.client_id, 'task_due', new.id, old.due_on::text, new.due_on::text,
      coalesce(nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''), 'system'));
  end if;
  return new;
end $$;

create trigger client_tasks_due_changes after update of due_on on public.client_tasks
for each row execute function public.client_tasks_log_due_change();
revoke execute on function public.client_tasks_log_due_change() from public, anon, authenticated;

alter table public.client_date_changes enable row level security;
-- The office (the owner, Irit, Lior, Ofir: the shoot day moved turns a client
-- red on their screens) reads every change; anyone else on the staff reads only
-- the changes they made themselves, their own row of screen 4 (decision 22).
create policy "office or own date changes" on public.client_date_changes
  for select to authenticated using (
    (select public.can_ask_questions())
    or ((select public.is_staff()) and by_email = lower(coalesce((select auth.jwt()) ->> 'email', '')))
  );
revoke all on public.client_date_changes from anon, authenticated;
grant select on public.client_date_changes to authenticated;
