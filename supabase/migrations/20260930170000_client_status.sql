-- Stage 4: the client's side (docs/plan/system-plan.md, section 7 and stage 4;
-- decisions 26–30 in docs/plan/decisions.md).
--
--   client_status_links   a secret link per client to status.html (like the quote's
--                         signing link): only a SHA-256 hash of the token is kept in
--                         the table; the token itself sits encrypted in Vault, so
--                         Irit, Lior and the owner can copy the link again later.
--                         Expiry (180 days by default), revocation, who created it.
--   client_status_views   every opening of the page (time only, no IP), at most one
--                         row per link every 5 minutes; staff previews are not counted.
--   client_approvals      the client's approvals and fix requests on the page, kept as
--                         evidence: the item, its round, the name typed, the exact
--                         wording shown, the file link and version, IP and browser,
--                         the server's time and a hash over all of it. Append-only.
--   client_surveys        the satisfaction questions (decision 28): 1–5 the day after
--                         the shoot day and after the first delivery, 0–10 sixty days
--                         before the renewal. Answered on the page or recorded by the
--                         office from the group. A low score opens a task for Lior.
--   client_consents       the WhatsApp service-updates checkbox on the signing page
--                         (decision 26): given or not, the wording shown and its
--                         version, the phone, IP and browser; its revocation.
--
-- The page is anonymous and reaches the database ONLY through the security definer
-- functions below, each taking the token and checking it (format, hash, revocation,
-- expiry, the client still open) before returning anything, and returning only what
-- the client may see: never internal deadlines, who is late, internal notes, logins
-- or costs. No table is granted to anon.
--
-- An approval marks the protocol item (p07.approved, p13.approved, p27.approved; for
-- the rest of the graphics, whose process has no approval item, the mark
-- p23.approved), so what follows it starts as if Irit had marked it. A fix request
-- opens a task (source 'client_fix') for whoever fixes: Lior (scripts), Ilai
-- (graphics), the editor of that shoot (videos; also the protocol's p27.notes, which
-- the editor's page and ladder already follow), or Lior when the included round was
-- used (decision 18: a second round is his call). Survey calls are source 'survey'.
-- The reminder rules for both are in app/status-rules.js.
--
-- Who and when are stamped here, never taken from the browser.
-- Every statement can run again safely. Tested in a real Postgres with every
-- migration: tests/sql/status.test.mjs.

-- ── Who manages the links ────────────────────
-- Irit, Lior and the owner create, copy and revoke links (the office reads them).
create or replace function public.can_manage_status_links() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff() and exists (
    select 1 from public.staff s
    where s.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (s.person is null or s.person in ('irit', 'lior'))
  );
$$;
revoke execute on function public.can_manage_status_links() from public, anon;
grant execute on function public.can_manage_status_links() to authenticated;

-- ── Tables ───────────────────────────────────
create table if not exists public.client_status_links (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  secret_id uuid,
  created_at timestamptz not null default now(),
  created_by text not null default '',
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by text
);
create index if not exists client_status_links_client_idx on public.client_status_links (client_id, created_at desc);

create table if not exists public.client_status_views (
  id bigint generated always as identity primary key,
  link_id uuid not null references public.client_status_links (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  at timestamptz not null default now()
);
create index if not exists client_status_views_link_idx on public.client_status_views (link_id, at desc);
create index if not exists client_status_views_client_idx on public.client_status_views (client_id, at desc);

create table if not exists public.client_approvals (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  link_id uuid references public.client_status_links (id) on delete set null,
  item text not null check (item in ('scripts', 'graphics9', 'graphics', 'videos')),
  item_key text not null check (item_key ~ '^(r[0-9]+\.)?p[0-9]+[ab]?\.approved$'),
  shoot_round integer not null default 1 check (shoot_round between 1 and 50),
  decision text not null check (decision in ('approve', 'fix')),
  round integer not null check (round between 1 and 50),
  signer_name text not null check (char_length(signer_name) between 2 and 120),
  note text check (note is null or char_length(note) <= 4000),
  wording text not null check (char_length(wording) <= 2000),
  file_ref text check (file_ref is null or char_length(file_ref) <= 1000),
  version text check (version is null or char_length(version) <= 100),
  ip text,
  user_agent text,
  at timestamptz not null default now(),
  evidence_hash text not null,
  task_id uuid references public.client_tasks (id) on delete set null
);
create index if not exists client_approvals_client_idx on public.client_approvals (client_id, at desc);

create table if not exists public.client_surveys (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  kind text not null check (kind in ('shoot', 'delivery', 'nps')),
  score integer not null,
  respondent text not null check (char_length(respondent) between 2 and 120),
  question text not null,
  source text not null check (source in ('page', 'office')),
  link_id uuid references public.client_status_links (id) on delete set null,
  recorded_by text not null default '',
  at timestamptz not null default now(),
  task_id uuid references public.client_tasks (id) on delete set null,
  constraint client_surveys_score check (
    (kind = 'nps' and score between 0 and 10) or (kind <> 'nps' and score between 1 and 5)),
  constraint client_surveys_once unique (client_id, kind)
);
create index if not exists client_surveys_at_idx on public.client_surveys (at desc);

create table if not exists public.client_consents (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes (id) on delete cascade,
  kind text not null check (kind in ('whatsapp')),
  given boolean not null,
  wording text not null,
  version text not null,
  phone text,
  ip text,
  user_agent text,
  at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_via text check (revoked_via is null or revoked_via in ('whatsapp', 'phone', 'staff')),
  revoked_by text,
  constraint client_consents_once unique (quote_id, kind)
);

-- ── Access: read by the office, written only through the functions below ──
alter table public.client_status_links enable row level security;
alter table public.client_status_views enable row level security;
alter table public.client_approvals enable row level security;
alter table public.client_surveys enable row level security;
alter table public.client_consents enable row level security;

drop policy if exists "office reads status links" on public.client_status_links;
create policy "office reads status links" on public.client_status_links
  for select to authenticated using ((select public.is_office()));
drop policy if exists "office reads status views" on public.client_status_views;
create policy "office reads status views" on public.client_status_views
  for select to authenticated using ((select public.is_office()));
drop policy if exists "office reads approvals" on public.client_approvals;
create policy "office reads approvals" on public.client_approvals
  for select to authenticated using ((select public.is_office()));
drop policy if exists "office reads surveys" on public.client_surveys;
create policy "office reads surveys" on public.client_surveys
  for select to authenticated using ((select public.is_office()));
drop policy if exists "office reads consents" on public.client_consents;
create policy "office reads consents" on public.client_consents
  for select to authenticated using ((select public.is_office()));

revoke all on public.client_status_links, public.client_status_views, public.client_approvals,
  public.client_surveys, public.client_consents from anon, authenticated;
grant select on public.client_status_views, public.client_approvals, public.client_surveys, public.client_consents to authenticated;
-- Not the hash nor the Vault id: the token is read through status_link_token().
grant select (id, client_id, created_at, created_by, expires_at, revoked_at, revoked_by) on public.client_status_links to authenticated;

-- A link's token is removed from Vault with the link (a client removed takes both).
create or replace function public.client_status_links_cleanup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.secret_id is not null then delete from vault.secrets where id = old.secret_id; end if;
  return old;
end $$;
revoke execute on function public.client_status_links_cleanup() from public, anon, authenticated;
drop trigger if exists client_status_links_cleanup on public.client_status_links;
create trigger client_status_links_cleanup after delete on public.client_status_links
for each row execute function public.client_status_links_cleanup();

-- ── Task sources: a client's fix request and a survey call ──
-- Rebuilt from the constraint as it stands (other migrations add their own), plus these.
do $$
declare
  def text;
  vals text[];
begin
  select pg_get_constraintdef(c.oid) into def
  from pg_constraint c where c.conname = 'client_tasks_source_check' and c.conrelid = 'public.client_tasks'::regclass;
  select coalesce(array_agg(m[1]), '{}') into vals from regexp_matches(coalesce(def, ''), '''([^'']+)''', 'g') as m;
  select array_agg(distinct v order by v) into vals from unnest(vals || array['client_fix', 'survey']) as v;
  alter table public.client_tasks drop constraint if exists client_tasks_source_check;
  execute format('alter table public.client_tasks add constraint client_tasks_source_check check (source is null or source = any (array[%s]::text[]))',
    (select string_agg(quote_literal(v), ', ') from unnest(vals) as v));
end $$;

-- ── Helpers (private: only the functions here call them) ──
-- The request's IP and browser, as the signing page keeps them.
create or replace function private.request_ip() returns text
language sql stable set search_path = '' as $$
  with h as (select nullif(current_setting('request.headers', true), '')::json as j)
  select left(coalesce(
    nullif(j ->> 'cf-connecting-ip', ''),
    nullif(j ->> 'x-real-ip', ''),
    nullif(btrim(reverse(split_part(reverse(coalesce(j ->> 'x-forwarded-for', '')), ',', 1))), '')), 64)
  from h;
$$;
create or replace function private.request_ua() returns text
language sql stable set search_path = '' as $$
  select left(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'user-agent', ''), 400);
$$;

-- The next Israel working day (Sunday–Thursday). Holidays are not in the database:
-- the reminder rules count real business days (app/holidays.js) from this date.
create or replace function private.next_workday(p_day date) returns date
language sql immutable set search_path = '' as $$
  select min(d)::date from generate_series((p_day + 1)::timestamp, (p_day + 7)::timestamp, interval '1 day') as d
  where extract(dow from d) not in (5, 6);
$$;
create or replace function private.today_il() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Jerusalem')::date;
$$;

-- A name as typed: trimmed, inner runs of spaces made one (app/status-logic.js cleanName).
create or replace function private.clean_name(p text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(btrim(coalesce(p, ''), E' \t\r\n'), E'[ \t\r\n]+', ' ', 'g');
$$;

-- The item as the client reads it: its name, the name after "ל" ("לתסריטים"), and
-- where it goes once approved. The same table as ITEMS in app/status-logic.js
-- (tests/sql/status.test.mjs checks that the two agree).
create or replace function private.status_item_text(p_item text, p_shoot_round integer, p_form text) returns text
language sql immutable set search_path = '' as $$
  select case p_form when 'label' then v.label when 'lamed' then v.lamed else v.next end
    || case when p_form <> 'next' and coalesce(p_shoot_round, 1) > 1 then ' (סבב צילום ' || p_shoot_round || ')' else '' end
  from (values
    ('scripts', 'התסריטים ליום הצילום', 'לתסריטים ליום הצילום', 'ליום הצילום'),
    ('graphics9', '9 הגרפיקות הראשונות', 'ל־9 הגרפיקות הראשונות', 'לפרסום בעמוד'),
    ('graphics', 'יתרת הגרפיקות', 'ליתרת הגרפיקות', 'לתזמון ולפרסום'),
    ('videos', 'הסרטונים', 'לסרטונים', 'לתזמון ולפרסום')
  ) as v (item, label, lamed, next)
  where v.item = p_item;
$$;

-- The exact words above each button (the legal drafts, section 4), the same as
-- wordingFor() in app/status-logic.js. What is stored is what was shown.
create or replace function private.status_wording(
  p_decision text, p_name text, p_business text, p_item text, p_shoot_round integer, p_round integer, p_included integer default 1
) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_decision = 'approve' then
      'אני, ' || private.clean_name(p_name) || ', מאשר/ת בשם ' || p_business || ' את '
      || private.status_item_text(p_item, p_shoot_round, 'label') || ', סבב ' || p_round
      || ', כפי שהוא, כולל נכונות המידע שבו. אחרי האישור הפריט עובר '
      || private.status_item_text(p_item, p_shoot_round, 'next') || '.'
    when p_round <= p_included then
      'אני, ' || private.clean_name(p_name) || ', מבקש/ת תיקון '
      || private.status_item_text(p_item, p_shoot_round, 'lamed') || '. זה סבב ' || p_round || ' מתוך ' || p_included
      || ' הכלולים. כתבו כאן את כל ההערות בבת אחת. הפריט יחזור אלינו לתיקון.'
    else
      'אני, ' || private.clean_name(p_name) || ', מבקש/ת תיקון נוסף '
      || private.status_item_text(p_item, p_shoot_round, 'lamed')
      || ', מעבר לסבבים הכלולים בחבילה. כתבו כאן את כל ההערות בבת אחת. נחזור אליך לפני שמתחילים.'
  end;
$$;

-- The survey questions (the legal drafts, section 5), as QUESTIONS in app/status-logic.js.
create or replace function private.survey_question(p_kind text) returns text
language sql immutable set search_path = '' as $$
  select case p_kind
    when 'shoot' then 'שאלה אחת, לא חובה: מ־1 עד 5, איך היה יום הצילום בשבילכם?'
    when 'delivery' then 'שאלה אחת, לא חובה: מ־1 עד 5, כמה אתם מרוצים מהסרטונים שקיבלתם?'
    when 'nps' then 'שאלה אחת, לא חובה: מ־0 עד 10, כמה סביר שתמליצו על אסטרטג לעסק אחר?'
  end;
$$;

-- The WhatsApp consent on the signing page (the legal drafts, section 1): the label
-- and the "מה זה?" line, exactly as q.html shows them (tests/status.test.mjs).
create or replace function private.whatsapp_consent_text() returns text
language sql immutable set search_path = '' as $$
  select 'אני מסכים/ה לקבל מאסטרטג עדכוני שירות ב־WhatsApp, בלי פרסום. אפשר להפסיק בכל עת.'
    || E'\n' || 'תזכורות ליום צילום, "יש אישור שמחכה לך", "בעריכה, צפי X" ושאלת משוב קצרה. ההודעות יגיעו מהמספר העסקי של אסטרטג לטלפון שמסרת, בשעות העבודה. ההסכמה לא חובה ולא משפיעה על ההסכם. להפסקה: השב/י "הסר" או אמור/י לנו.';
$$;

-- The protocol marks the page reads (state and time, never a note or who): what the
-- client did or received. Internal marks (returns for fixes, waits, pauses, moved
-- deadlines, claims) and every internal check stay out. The same list as MARKS in
-- app/status-logic.js (tests/sql/status.test.mjs).
create or replace function private.status_mark_ok(p_key text) returns boolean
language sql immutable set search_path = '' as $$
  select p_key ~ ('^(r[0-9]+\.)?(p02\.opened|p04\.(ended|saved)|p05\.(access|logo|colors|photos|videos)'
    || '|p07\.(sent|approved)|p11\.(ok\.client|calendar)|p12\.(scripts|numbered|docs)|p13\.approved'
    || '|p19\.(all|took)|p23\.(sent|approved)|p26\.sent|p27\.(notes|fixes|final|approved)'
    || '|p28\.scheduled|p29\.sent|p30\.live|p34\.talk)$');
$$;

-- A token: 32 random bytes, base64url (43 characters).
create or replace function private.status_token_hash(p_token text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(convert_to(coalesce(p_token, ''), 'UTF8'), 'sha256'), 'hex');
$$;

-- The link a token opens, and why not when it does not: 'invalid' (malformed or
-- unknown), 'revoked', 'expired', or 'closed' (the client ended or was cancelled).
create or replace function private.status_check(p_token text)
returns table (link_id uuid, client_id uuid, expires_at timestamptz, reason text)
language plpgsql stable security definer set search_path = '' as $$
declare
  l public.client_status_links;
  st text;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return query select null::uuid, null::uuid, null::timestamptz, 'invalid'::text; return;
  end if;
  select * into l from public.client_status_links s where s.token_hash = private.status_token_hash(p_token);
  if not found then
    return query select null::uuid, null::uuid, null::timestamptz, 'invalid'::text; return;
  end if;
  select c.status into st from public.clients c where c.id = l.client_id;
  return query select l.id, l.client_id, l.expires_at,
    case when l.revoked_at is not null then 'revoked'
         when l.expires_at <= now() then 'expired'
         when st is null or st not in ('active', 'ending') then 'closed'
         else null end;
end $$;

-- The client's items for approval, per shoot (the main one, then each extra round):
--   graphics9  the first 9 graphics   sent p07.sent             approved p07.approved
--   scripts    the scripts            ready p12.scripts+numbered+docs   approved p13.approved
--   graphics   the rest of them       sent p23.sent             approved p23.approved (a mark)
--   videos     the videos             sent p26.sent             approved p27.approved
-- state: 'approved', 'fixing' (a fix task is open, or for the videos the client's
-- notes are with the editor), or 'waiting' (for the client). round: the fix rounds
-- used so far + 1 (for the videos, notes the office took from the group count too).
create or replace function private.status_items(p_client uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.clients;
  ctx record;
  spec record;
  pre text;
  k text;
  sent_at timestamptz;
  appr public.protocol_checks;
  notes public.protocol_checks;
  fixed boolean;
  used integer;
  fixing boolean;
  link text;
  out jsonb := '[]'::jsonb;
begin
  select * into c from public.clients where id = p_client;
  if not found then return out; end if;
  for ctx in
    select 1 as n, null::text as editor
    union all
    select (r ->> 'n')::int, r ->> 'editor' from jsonb_array_elements(c.rounds) r
    where (r ->> 'n') ~ '^[0-9]{1,2}$' and (r ->> 'n')::int between 2 and 50
    order by 1
  loop
    pre := case when ctx.n = 1 then '' else 'r' || ctx.n || '.' end;
    for spec in
      select * from (values
        (1, 'graphics9', 'p07.approved', true),
        (2, 'scripts', 'p13.approved', false),
        (3, 'graphics', 'p23.approved', true),
        (4, 'videos', 'p27.approved', false)) as v (ord, item, approve_key, base_only)
      order by ord
    loop
      continue when spec.base_only and ctx.n > 1;
      k := pre || spec.approve_key;
      if spec.item = 'scripts' then
        select case when count(*) = 3 then max(s.at) end into sent_at from public.protocol_checks s
        where s.client_id = c.id and s.item_key in (pre || 'p12.scripts', pre || 'p12.numbered', pre || 'p12.docs');
      else
        select s.at into sent_at from public.protocol_checks s
        where s.client_id = c.id and s.state = 'done'
          and s.item_key = pre || case spec.item when 'graphics9' then 'p07.sent' when 'graphics' then 'p23.sent' else 'p26.sent' end;
      end if;
      select * into appr from public.protocol_checks s where s.client_id = c.id and s.item_key = k;
      continue when appr.item_key is null and sent_at is null;
      select count(*) into used from public.client_approvals a where a.client_id = c.id and a.item_key = k and a.decision = 'fix';
      fixing := exists (select 1 from public.client_tasks t where t.client_id = c.id and t.source = 'client_fix'
        and t.done_at is null and t.brief ->> 'item_key' = k);
      if spec.item = 'videos' then
        select * into notes from public.protocol_checks s where s.client_id = c.id and s.item_key = pre || 'p27.notes' and s.state = 'done';
        fixed := exists (select 1 from public.protocol_checks s where s.client_id = c.id
          and ((s.item_key = pre || 'p27.fixes' and s.state in ('done', 'na')) or (s.item_key = pre || 'p27.final' and s.state = 'done')));
        -- Notes the office took from the group are a round too; the page's own are counted above.
        if notes.item_key is not null and notes.note is distinct from 'ייבוא'
           and (case when pg_input_is_valid(coalesce(notes.note, ''), 'jsonb') and jsonb_typeof(notes.note::jsonb) = 'object'
                     then notes.note::jsonb ->> 'via' end) is distinct from 'status' then
          used := used + 1;
        end if;
        fixing := fixing or (notes.item_key is not null and not fixed);
      end if;
      link := nullif(c.links ->> case when spec.item = 'scripts' then 'scripts' else 'drive' end, '');
      if link is not null and link !~ '^https://[^\s"<>]+$' then link := null; end if;
      out := out || jsonb_build_object(
        'item', spec.item, 'key', k, 'shootRound', ctx.n,
        'state', case when appr.state in ('done', 'na') then 'approved' when fixing then 'fixing' else 'waiting' end,
        'round', used + 1, 'included', 1, 'sentAt', sent_at, 'approvedAt', case when appr.state = 'done' then appr.at end,
        'link', link, 'editor', coalesce(ctx.editor, case when ctx.n = 1 then c.editor end));
    end loop;
  end loop;
  return out;
end $$;

-- Which questions are open now: 'shoot' from the day after the shoot day, for 21
-- days; 'delivery' from the first approval or final versions of the videos (not
-- imported history), for 21 days; 'nps' from 60 to 30 days before the contract
-- ends, never on a day the renewal message went out (the legal drafts, section 5).
-- Only the main shoot, once each (decision 28: two points only).
create or replace function private.status_surveys_due(p_client uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  with c as (select * from public.clients where id = p_client and status in ('active', 'ending')),
  d as (select min(s.at) as at from public.protocol_checks s
        where s.client_id = p_client and s.item_key in ('p27.approved', 'p27.final') and s.state = 'done'
          and s.note is distinct from 'ייבוא'),
  t as (select private.today_il() as today)
  select coalesce(array_agg(k order by o), '{}') from (
    select 'shoot' as k, 1 as o from c, t
      where c.shoot_at is not null and (c.shoot_at at time zone 'Asia/Jerusalem')::date < t.today
        and t.today <= (c.shoot_at at time zone 'Asia/Jerusalem')::date + 21
    union all
    select 'delivery', 2 from d, t
      where d.at is not null and t.today <= (d.at at time zone 'Asia/Jerusalem')::date + 21
    union all
    select 'nps', 3 from c, t
      where c.status = 'active' and c.contract_end is not null
        and t.today between c.contract_end - 60 and c.contract_end - 30
        and not exists (select 1 from public.client_messages m where m.client_id = p_client
          and m.template_key = 'renewal' and (m.sent_at at time zone 'Asia/Jerusalem')::date = t.today)
  ) x
  where not exists (select 1 from public.client_surveys s where s.client_id = p_client and s.kind = x.k);
$$;

revoke execute on function private.request_ip(), private.request_ua(), private.next_workday(date), private.today_il(),
  private.clean_name(text), private.status_item_text(text, integer, text),
  private.status_wording(text, text, text, text, integer, integer, integer), private.survey_question(text),
  private.whatsapp_consent_text(), private.status_mark_ok(text), private.status_token_hash(text),
  private.status_check(text), private.status_items(uuid), private.status_surveys_due(uuid)
  from public, anon, authenticated;

-- ── The page (anonymous, by token) ───────────
-- Everything the page shows, or { state: 'invalid' | 'revoked' | 'expired' | 'closed' }.
create or replace function public.get_status(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  l record;
  c public.clients;
  staff boolean := public.is_staff();
begin
  select * into l from private.status_check(p_token);
  if l.reason is not null then
    return jsonb_build_object('state', l.reason);
  end if;
  select * into c from public.clients where id = l.client_id;
  if not staff and not exists (select 1 from public.client_status_views v
                               where v.link_id = l.link_id and v.at > now() - interval '5 minutes') then
    insert into public.client_status_views (link_id, client_id) values (l.link_id, c.id);
  end if;
  return jsonb_build_object(
    'state', 'ok',
    'preview', staff,
    'expiresAt', l.expires_at,
    'client', jsonb_build_object(
      'name', c.name, 'business', coalesce(nullif(btrim(c.business), ''), c.name), 'status', c.status,
      'shootType', c.shoot_type, 'charAt', c.char_at, 'shootAt', c.shoot_at, 'contractEnd', c.contract_end,
      'rounds', coalesce((select jsonb_agg(jsonb_build_object('n', (r ->> 'n')::int, 'shootAt', r ->> 'shoot_at', 'startAt', r ->> 'start_at') order by (r ->> 'n')::int)
                          from jsonb_array_elements(c.rounds) r where (r ->> 'n') ~ '^[0-9]{1,2}$'), '[]'::jsonb)),
    'marks', coalesce((select jsonb_object_agg(s.item_key, jsonb_build_object('s', s.state, 'at', case when s.note = 'ייבוא' then null else s.at end))
                       from public.protocol_checks s where s.client_id = c.id and private.status_mark_ok(s.item_key)), '{}'::jsonb),
    'links', coalesce((select jsonb_object_agg(k, c.links ->> k) from unnest(array['drive', 'scripts', 'gantt']) k
                       where coalesce(c.links ->> k, '') ~ '^https://[^\s"<>]+$'), '{}'::jsonb),
    -- Who would fix an item (the editor) is the database's own business.
    'items', coalesce((select jsonb_agg(x.value - 'editor') from jsonb_array_elements(private.status_items(c.id)) as x), '[]'::jsonb),
    'approvals', coalesce((select jsonb_agg(jsonb_build_object('item', a.item, 'key', a.item_key, 'shootRound', a.shoot_round, 'decision', a.decision,
                            'round', a.round, 'name', a.signer_name, 'note', a.note, 'at', a.at) order by a.at desc)
                           from (select * from public.client_approvals where client_id = c.id order by at desc limit 20) a), '[]'::jsonb),
    'thursday', (select jsonb_build_object('body', m.body, 'at', m.sent_at) from public.client_messages m
                 where m.client_id = c.id and m.kind = 'thursday' and m.sent_at > now() - interval '21 days'
                 order by m.sent_at desc limit 1),
    'surveys', jsonb_build_object(
      'due', to_jsonb(private.status_surveys_due(c.id)),
      'answered', coalesce((select jsonb_agg(jsonb_build_object('kind', s.kind, 'score', s.score, 'at', s.at) order by s.at)
                            from public.client_surveys s where s.client_id = c.id), '[]'::jsonb))
  );
end $$;

-- The link, ready for a client's action: a staff member signed in cannot act for
-- the client (like signing), and the name must look like a name.
create or replace function private.status_actor(p_token text, p_name text)
returns table (link_id uuid, client_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  l record;
begin
  if public.is_staff() then
    raise exception 'staff cannot act for the client' using errcode = '42501';
  end if;
  select * into l from private.status_check(p_token);
  if l.reason is not null then
    raise exception 'status link %', l.reason using errcode = 'P0002';
  end if;
  if char_length(private.clean_name(p_name)) not between 2 and 120 then
    raise exception 'invalid name' using errcode = '22023';
  end if;
  return query select l.link_id, l.client_id;
end $$;

-- "מאשר/ת": the item as evidence, and its protocol mark.
create or replace function public.approve_item(p_token text, p_key text, p_name text, p_wording text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  l record;
  c public.clients;
  it jsonb;
  v_name text := private.clean_name(p_name);
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_wording text;
  v_now timestamptz := now();
begin
  select * into l from private.status_actor(p_token, p_name);
  if char_length(coalesce(v_note, '')) > 2000 then raise exception 'note too long' using errcode = '22023'; end if;
  select * into c from public.clients where id = l.client_id;
  select x.value into it from jsonb_array_elements(private.status_items(c.id)) as x where x.value ->> 'key' = p_key;
  if it is null or it ->> 'state' <> 'waiting' then
    raise exception 'not awaiting approval' using errcode = '22023';
  end if;
  v_wording := private.status_wording('approve', v_name, coalesce(nullif(btrim(c.business), ''), c.name), it ->> 'item', (it ->> 'shootRound')::int, (it ->> 'round')::int);
  if p_wording is distinct from v_wording then
    raise exception 'wording changed' using errcode = '22023';
  end if;
  insert into public.client_approvals (client_id, link_id, item, item_key, shoot_round, decision, round, signer_name, note, wording,
    file_ref, version, ip, user_agent, at, evidence_hash)
  values (c.id, l.link_id, it ->> 'item', p_key, (it ->> 'shootRound')::int, 'approve', (it ->> 'round')::int, v_name, v_note, v_wording,
    it ->> 'link', it ->> 'sentAt', private.request_ip(), private.request_ua(), v_now,
    encode(extensions.digest(convert_to(concat_ws('|', c.id, p_key, 'approve', it ->> 'round', v_name, v_wording, v_note, it ->> 'link', it ->> 'sentAt',
      to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')), 'UTF8'), 'sha256'), 'hex'));
  insert into public.protocol_checks (client_id, item_key, state, note)
  values (c.id, p_key, 'done', left('אושר בדף המצב על ידי ' || v_name, 2000))
  on conflict (client_id, item_key) do update set state = 'done', note = excluded.note;
  return public.get_status(p_token);
end $$;

-- "מבקש/ת תיקון": the request as evidence, and a task for whoever fixes.
create or replace function public.request_fix(p_token text, p_key text, p_name text, p_wording text, p_note text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  l record;
  c public.clients;
  it jsonb;
  v_name text := private.clean_name(p_name);
  v_note text := btrim(coalesce(p_note, ''));
  v_wording text;
  v_now timestamptz := now();
  v_round integer;
  v_extra boolean;
  v_item text;
  v_pre text;
  v_owner text;
  v_marked boolean := false;
  v_local timestamp := now() at time zone 'Asia/Jerusalem';
  v_due date;
  v_task uuid := gen_random_uuid();
  v_id uuid := gen_random_uuid();
begin
  select * into l from private.status_actor(p_token, p_name);
  if char_length(v_note) < 2 then raise exception 'note required' using errcode = '22023'; end if;
  if char_length(v_note) > 4000 then raise exception 'note too long' using errcode = '22023'; end if;
  select * into c from public.clients where id = l.client_id;
  select x.value into it from jsonb_array_elements(private.status_items(c.id)) as x where x.value ->> 'key' = p_key;
  if it is null or it ->> 'state' <> 'waiting' then
    raise exception 'not awaiting approval' using errcode = '22023';
  end if;
  v_item := it ->> 'item';
  v_round := (it ->> 'round')::int;
  v_extra := v_round > (it ->> 'included')::int;
  v_pre := coalesce(substring(p_key from '^(r[0-9]+\.)'), '');
  v_wording := private.status_wording('fix', v_name, coalesce(nullif(btrim(c.business), ''), c.name), v_item, (it ->> 'shootRound')::int, v_round);
  if p_wording is distinct from v_wording then
    raise exception 'wording changed' using errcode = '22023';
  end if;
  -- Who fixes: the included round goes to the one who made it; another round is
  -- Lior's call (decision 18), and he tells the client first.
  v_owner := case
    when v_extra then 'lior'
    when v_item = 'scripts' then 'lior'
    when v_item in ('graphics9', 'graphics') then 'ilai'
    else coalesce(nullif(it ->> 'editor', ''), 'ofir') end;
  if v_owner not in ('irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli') then v_owner := 'ofir'; end if;
  -- When: scripts a business day (Lior's protocol); graphics and videos the same day
  -- for notes by 13:00, else the next working day (decisions 17, 18).
  v_due := case
    when v_extra or v_item = 'scripts' or extract(dow from v_local) in (5, 6) or v_local::time >= time '13:00'
      then private.next_workday(v_local::date)
    else v_local::date end;
  -- The videos' notes go where the editor already looks (the protocol's p27.notes).
  if v_item = 'videos' and not v_extra and not exists (
      select 1 from public.protocol_checks s where s.client_id = c.id and s.item_key = v_pre || 'p27.notes' and s.state = 'done') then
    insert into public.protocol_checks (client_id, item_key, state, note)
    values (c.id, v_pre || 'p27.notes', 'done', jsonb_build_object('text', v_note, 'via', 'status')::text)
    on conflict (client_id, item_key) do update set state = 'done', note = excluded.note;
    v_marked := true;
  end if;
  insert into public.client_tasks (id, client_id, title, owner, due_on, source, brief)
  values (v_task, c.id,
    left(case when v_extra then 'הלקוח ביקש סבב תיקונים נוסף: ' || private.status_item_text(v_item, (it ->> 'shootRound')::int, 'label') || ' (להחליט ולחזור ללקוח)'
              else 'תיקון לבקשת הלקוח: ' || private.status_item_text(v_item, (it ->> 'shootRound')::int, 'label') || ' · סבב ' || v_round end, 500),
    v_owner, v_due, 'client_fix',
    jsonb_build_object('problem', left(v_note, 4000), 'from', 'status', 'item', v_item, 'item_key', p_key, 'round', v_round,
      'extra', v_extra, 'notes_marked', v_marked, 'approval', v_id, 'by', v_name));
  insert into public.client_approvals (id, client_id, link_id, item, item_key, shoot_round, decision, round, signer_name, note, wording,
    file_ref, version, ip, user_agent, at, evidence_hash, task_id)
  values (v_id, c.id, l.link_id, v_item, p_key, (it ->> 'shootRound')::int, 'fix', v_round, v_name, v_note, v_wording,
    it ->> 'link', it ->> 'sentAt', private.request_ip(), private.request_ua(), v_now,
    encode(extensions.digest(convert_to(concat_ws('|', c.id, p_key, 'fix', v_round, v_name, v_wording, v_note, it ->> 'link', it ->> 'sentAt',
      to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')), 'UTF8'), 'sha256'), 'hex'),
    v_task);
  return public.get_status(p_token);
end $$;

-- A survey answered on the page.
create or replace function public.answer_survey(p_token text, p_kind text, p_score integer, p_name text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  l record;
begin
  select * into l from private.status_actor(p_token, p_name);
  if not (p_kind = any (private.status_surveys_due(l.client_id))) then
    raise exception 'survey not open' using errcode = '22023';
  end if;
  insert into public.client_surveys (client_id, kind, score, respondent, question, source, link_id, recorded_by)
  values (l.client_id, p_kind, p_score, private.clean_name(p_name), private.survey_question(p_kind), 'page', l.link_id, 'client');
  return public.get_status(p_token);
end $$;

-- ── A low score: Lior calls within a business day (decision 28) ──
-- 1–5: 3 or less opens the task; 2 or less also rings the owner (decision 24).
-- 0–10: 6 or less opens it; 4 or less also the owner.
create or replace function public.client_surveys_stamp() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  low boolean := (new.kind <> 'nps' and new.score <= 3) or (new.kind = 'nps' and new.score <= 6);
  severe boolean := (new.kind <> 'nps' and new.score <= 2) or (new.kind = 'nps' and new.score <= 4);
  label text := case new.kind when 'shoot' then 'יום הצילום' when 'delivery' then 'הסרטונים' else 'המלצה' end;
begin
  new.at := now();
  new.recorded_by := case when new.source = 'page' then 'client'
                          else coalesce(nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''), 'system') end;
  new.question := private.survey_question(new.kind);
  new.respondent := private.clean_name(new.respondent);
  new.task_id := null;
  if low then
    new.task_id := gen_random_uuid();
    insert into public.client_tasks (id, client_id, title, owner, due_on, source, brief)
    values (new.task_id, new.client_id,
      left('להתקשר ללקוח: ציון ' || new.score || (case when new.kind = 'nps' then ' מתוך 10' else ' מתוך 5' end) || ' בשאלה על ' || label, 500),
      'lior', private.next_workday(private.today_il()), 'survey',
      jsonb_build_object('survey', new.id, 'kind', new.kind, 'score', new.score, 'owner_alert', severe, 'by', new.respondent));
  end if;
  return new;
end $$;
revoke execute on function public.client_surveys_stamp() from public, anon, authenticated;
drop trigger if exists client_surveys_stamp on public.client_surveys;
create trigger client_surveys_stamp before insert on public.client_surveys
for each row execute function public.client_surveys_stamp();

-- ── A fix is done: its task closes by itself ──
-- The client approved the item (on the page or in the group, marked by the office),
-- or the editor finished the client's video notes (p27.fixes, or the final versions).
-- The task for Lior about another round stays until he closes it.
create or replace function public.client_fix_tasks_close() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  pre text := coalesce(substring(new.item_key from '^(r[0-9]+\.)'), '');
  base text := substring(new.item_key from '^(?:r[0-9]+\.)?(.*)$');
begin
  if new.state not in ('done', 'na') then return new; end if;
  if base in ('p07.approved', 'p13.approved', 'p23.approved', 'p27.approved') then
    update public.client_tasks set done_at = now()
    where client_id = new.client_id and source = 'client_fix' and done_at is null and brief ->> 'item_key' = new.item_key;
  elsif base in ('p27.fixes', 'p27.final') then
    update public.client_tasks set done_at = now()
    where client_id = new.client_id and source = 'client_fix' and done_at is null
      and brief ->> 'item_key' = pre || 'p27.approved' and coalesce((brief ->> 'extra')::boolean, false) = false;
  end if;
  return new;
end $$;
revoke execute on function public.client_fix_tasks_close() from public, anon, authenticated;
drop trigger if exists client_fix_tasks_close on public.protocol_checks;
create trigger client_fix_tasks_close after insert or update on public.protocol_checks
for each row execute function public.client_fix_tasks_close();

-- ── The office: links, answers from the group, a revoked consent ──
-- A new link for the client (the one before it stops working). Returns the token
-- once; status_link_token() gives it again to Irit, Lior and the owner.
create or replace function public.status_link_create(p_client uuid, p_days integer default 180) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_token text;
  v_id uuid := gen_random_uuid();
  v_secret uuid;
  v_exp timestamptz := now() + make_interval(days => least(greatest(coalesce(p_days, 180), 1), 365));
begin
  if not public.can_manage_status_links() then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.clients where id = p_client and status in ('active', 'ending')) then
    raise exception 'client not open' using errcode = '22023';
  end if;
  update public.client_status_links set revoked_at = now(), revoked_by = me
  where client_id = p_client and revoked_at is null;
  v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  v_secret := vault.create_secret(v_token, 'status_link:' || v_id::text, 'client status page link');
  insert into public.client_status_links (id, client_id, token_hash, secret_id, created_by, expires_at)
  values (v_id, p_client, private.status_token_hash(v_token), v_secret, me, v_exp);
  return jsonb_build_object('id', v_id, 'token', v_token, 'expiresAt', v_exp);
end $$;

create or replace function public.status_link_token(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_secret uuid;
  v_token text;
begin
  if not public.can_manage_status_links() then raise exception 'not allowed' using errcode = '42501'; end if;
  select secret_id into v_secret from public.client_status_links
  where id = p_id and revoked_at is null and expires_at > now();
  if v_secret is null then return null; end if;
  select decrypted_secret into v_token from vault.decrypted_secrets where id = v_secret;
  return v_token;
end $$;

create or replace function public.status_link_revoke(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_manage_status_links() then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.client_status_links set revoked_at = now(), revoked_by = lower(coalesce(auth.jwt() ->> 'email', ''))
  where id = p_id and revoked_at is null;
end $$;

-- An answer the client gave in the group, recorded by the office (the owner, Irit,
-- Lior or Ofir: whoever sends the client messages).
create or replace function public.survey_record(p_client uuid, p_kind text, p_score integer, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.can_message_clients() then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into public.client_surveys (client_id, kind, score, respondent, question, source)
  values (p_client, p_kind, p_score, private.clean_name(p_name), private.survey_question(p_kind), 'office')
  returning id into v_id;
  return v_id;
end $$;

-- The client asked to stop the WhatsApp updates ("הסר" in WhatsApp, by phone, or
-- told a staff member): when and how, and who recorded it.
create or replace function public.whatsapp_consent_revoke(p_client uuid, p_via text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_message_clients() then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.client_consents k set revoked_at = now(), revoked_via = p_via,
    revoked_by = lower(coalesce(auth.jwt() ->> 'email', ''))
  from public.clients c
  where c.id = p_client and k.quote_id = c.quote_id and k.kind = 'whatsapp' and k.given and k.revoked_at is null;
end $$;

-- ── The signing page: the WhatsApp checkbox (decision 26) ──
-- sign_quote gains an optional fifth argument; callers with four keep working (it
-- defaults to not given). The checkbox is never a condition of signing. Its value is
-- stored with the signature as evidence, with the exact wording shown and its
-- version, the phone it was given for, and the IP and browser.
drop function if exists public.sign_quote(uuid, text, text, boolean);
create or replace function public.sign_quote(
  p_token uuid, p_name text, p_signature text, p_consent boolean, p_whatsapp boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  q public.quotes;
  headers json := nullif(current_setting('request.headers', true), '')::json;
  v_name text := btrim(coalesce(p_name, ''));
  v_png bytea;
  v_ip text;
  v_now timestamptz := now();
begin
  if public.is_staff() then
    raise exception 'staff cannot sign on behalf of a client' using errcode = '42501';
  end if;
  if p_consent is distinct from true then
    raise exception 'consent required' using errcode = '22023';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'invalid signer name' using errcode = '22023';
  end if;
  if p_signature is null
     or char_length(p_signature) > 200000
     or p_signature !~ '^data:image/png;base64,[A-Za-z0-9+/]+={0,2}$' then
    raise exception 'invalid signature' using errcode = '22023';
  end if;

  select * into q from public.quotes where token = p_token for update;
  if not found or q.status = 'cancelled' then
    raise exception 'quote not found' using errcode = 'P0002';
  end if;
  if q.status = 'signed' then
    raise exception 'quote already signed' using errcode = '23505';
  end if;
  if q.expires_at is not null and v_now > q.expires_at then
    raise exception 'quote expired' using errcode = '22023';
  end if;

  v_png := decode(substr(p_signature, 23), 'base64');
  if substr(v_png, 1, 8) <> '\x89504e470d0a1a0a'::bytea then
    raise exception 'invalid signature' using errcode = '22023';
  end if;

  v_ip := coalesce(
    nullif(headers ->> 'cf-connecting-ip', ''),
    nullif(headers ->> 'x-real-ip', ''),
    nullif(btrim(reverse(split_part(reverse(coalesce(headers ->> 'x-forwarded-for', '')), ',', 1))), '')
  );

  update public.quotes set
    status = 'signed',
    signer_name = v_name,
    signature_png = p_signature,
    signed_at = v_now,
    consent_text = public.consent_text_for(q.model),
    signer_ip = left(v_ip, 64),
    signer_user_agent = left(coalesce(headers ->> 'user-agent', ''), 400),
    signature_hash = encode(extensions.digest(
      q.doc_hash || '|' || v_name || '|' || to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      || '|' || public.consent_text_for(q.model) || '|' || p_signature, 'sha256'), 'hex')
  where id = q.id;

  insert into public.client_consents (quote_id, kind, given, wording, version, phone, ip, user_agent, at)
  values (q.id, 'whatsapp', coalesce(p_whatsapp, false), private.whatsapp_consent_text(), 'whatsapp-v1-2026-09-30',
    nullif(left(btrim(coalesce(q.model -> 'client' ->> 'phone', '')), 40), ''), left(v_ip, 64),
    left(coalesce(headers ->> 'user-agent', ''), 400), v_now)
  on conflict (quote_id, kind) do nothing;

  return public.get_quote(p_token);
end $$;

-- ── Grants ───────────────────────────────────
revoke all on function public.get_status(text) from public;
revoke all on function public.approve_item(text, text, text, text, text) from public;
revoke all on function public.request_fix(text, text, text, text, text) from public;
revoke all on function public.answer_survey(text, text, integer, text) from public;
revoke all on function private.status_actor(text, text) from public, anon, authenticated;
grant execute on function public.get_status(text) to anon, authenticated;
grant execute on function public.approve_item(text, text, text, text, text) to anon, authenticated;
grant execute on function public.request_fix(text, text, text, text, text) to anon, authenticated;
grant execute on function public.answer_survey(text, text, integer, text) to anon, authenticated;

revoke all on function public.status_link_create(uuid, integer) from public, anon;
revoke all on function public.status_link_token(uuid) from public, anon;
revoke all on function public.status_link_revoke(uuid) from public, anon;
revoke all on function public.survey_record(uuid, text, integer, text) from public, anon;
revoke all on function public.whatsapp_consent_revoke(uuid, text) from public, anon;
grant execute on function public.status_link_create(uuid, integer) to authenticated;
grant execute on function public.status_link_token(uuid) to authenticated;
grant execute on function public.status_link_revoke(uuid) to authenticated;
grant execute on function public.survey_record(uuid, text, integer, text) to authenticated;
grant execute on function public.whatsapp_consent_revoke(uuid, text) to authenticated;

revoke all on function public.sign_quote(uuid, text, text, boolean, boolean) from public;
grant execute on function public.sign_quote(uuid, text, text, boolean, boolean) to anon, authenticated;

-- ── The survey messages (decision 25: the office edits them in messages.html) ──
-- The same text as DEFAULT_TEMPLATES in app/messages-logic.js (tests/messages.test.mjs).
-- seed:begin
insert into public.message_templates (key, title, kind, station, body) values
  ('survey_delivery', 'שאלה על הסרטונים', 'milestone', null, $t$היי {לקוח}, שאלה אחת, לא חובה: מ־1 עד 5, כמה אתם מרוצים מהסרטונים שקיבלתם?
אפשר לענות לנו בהודעה או בדף המצב שלכם. התשובה עוזרת לנו לשפר את השירות.$t$),
  ('survey_nps', 'שאלת המלצה', 'milestone', null, $t$היי {לקוח}, שאלה אחת, לא חובה: מ־0 עד 10, כמה סביר שתמליצו על אסטרטג לעסק אחר?
אפשר לענות לנו בהודעה או בדף המצב שלכם. התשובה עוזרת לנו לשפר את השירות.$t$)
on conflict (key) do nothing;
-- seed:end
