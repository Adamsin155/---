-- Stage 1: the client messages center (messages.html; docs/plan/system-plan.md,
-- section 7 and Irit's day in section 3). The office's message templates, and a
-- record of every proactive message sent to a client from the day's queue.
-- The app suggests the message; Irit (or Lior, or the owner) sends it herself
-- in WhatsApp, by link only, and the system records that it was marked sent (it
-- cannot know whether WhatsApp delivered it).
-- Office staff only: the owner (staff.person is null), Irit, Lior and Ofir.
-- Who and when are always stamped here, never taken from the browser.

-- Office staff: a staff member (is_staff: a confirmed login on the allowlist)
-- who is the owner, Irit, Lior or Ofir.
create or replace function public.can_message_clients() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff() and exists (
    select 1 from public.staff s
    where s.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (s.person is null or s.person in ('irit', 'lior', 'ofir'))
  );
$$;
revoke execute on function public.can_message_clients() from public, anon;
grant execute on function public.can_message_clients() to authenticated;

-- ── Templates ─────────────────────────────
-- One row per message. The key never changes (the app looks it up); the office
-- edits the title and the body. {x} is filled by the app, [x] is filled by hand
-- before sending. A daily message belongs to one of the 8 stations (1–8, the
-- order of STATIONS in app/protocol.js).
create table public.message_templates (
  key text primary key check (key ~ '^[a-z][a-z_]*(\.[a-z_]+)?$'),
  title text not null check (length(btrim(title)) between 1 and 120),
  body text not null check (length(btrim(body)) between 1 and 4000),
  kind text not null check (kind in ('daily', 'milestone', 'thursday', 'delay')),
  station smallint check (station between 1 and 8),
  updated_by text,
  updated_at timestamptz not null default now(),
  constraint message_templates_daily_station check ((kind = 'daily') = (station is not null))
);
create unique index message_templates_daily_key on public.message_templates (station) where kind = 'daily';

-- Who changed a template and when. The key, the kind and the station stay as created.
create function public.message_templates_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_by := coalesce(nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''), 'system');
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.key := old.key;
    new.kind := old.kind;
    new.station := old.station;
  end if;
  return new;
end $$;

create trigger message_templates_stamp before insert or update on public.message_templates
for each row execute function public.message_templates_stamp();

-- ── Messages sent ─────────────────────────
-- Append-only: a row is the record that a message was sent, and it is never
-- changed or removed from the browser. `ref` says what the message was about,
-- so the same milestone or delay is not suggested twice: a milestone
-- ('welcome', 'r2.thanks' in an extra shoot round) or a promised process
-- ('p27', 'r2.p27'). Daily and Thursday messages have none.
create table public.client_messages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  kind text not null check (kind in ('daily', 'milestone', 'thursday', 'delay')),
  template_key text check (template_key is null or template_key ~ '^[a-z][a-z_]*(\.[a-z_]+)?$'),
  ref text check (ref is null or ref ~ '^(r[0-9]+\.)?[a-z0-9_]+$'),
  body text not null check (length(btrim(body)) between 1 and 4000),
  sent_by_email text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  sent_at timestamptz not null default now()
);
create index client_messages_client_idx on public.client_messages (client_id, sent_at desc);
create index client_messages_sent_idx on public.client_messages (sent_at desc);

-- At most one proactive message per client per Israel day (section 7).
create unique index client_messages_one_per_day
  on public.client_messages (client_id, ((sent_at at time zone 'Asia/Jerusalem')::date));

create function public.client_messages_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.sent_by_email := coalesce(nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''), 'system');
  new.sent_at := now();
  return new;
end $$;

create trigger client_messages_stamp before insert on public.client_messages
for each row execute function public.client_messages_stamp();

-- ── Access ────────────────────────────────
alter table public.message_templates enable row level security;
alter table public.client_messages enable row level security;

create policy "office reads templates" on public.message_templates
  for select to authenticated using (public.can_message_clients());
create policy "office adds templates" on public.message_templates
  for insert to authenticated with check (public.can_message_clients());
create policy "office edits templates" on public.message_templates
  for update to authenticated using (public.can_message_clients()) with check (public.can_message_clients());
create policy "office reads messages" on public.client_messages
  for select to authenticated using (public.can_message_clients());
create policy "office records messages" on public.client_messages
  for insert to authenticated with check (public.can_message_clients());

revoke all on public.message_templates from anon;
revoke all on public.client_messages from anon;
revoke delete, truncate on public.message_templates from authenticated;
revoke update, delete, truncate on public.client_messages from authenticated;

-- ── The templates as written (decision 25) ──
-- The same text as DEFAULT_TEMPLATES in app/messages-logic.js; tests/messages.test.mjs
-- checks that the two agree. Existing rows (edited by the office) are kept.
-- seed:begin
insert into public.message_templates (key, title, kind, station, body) values
  ('welcome', 'ברוכים הבאים', 'milestone', null, $t$היי {לקוח}, ברוכים הבאים לאסטרטג! שמחים להתחיל לעבוד איתכם.

מי בצוות שלכם:
{צוות}

התאריכים הקרובים:
{תאריכים}

מה נצטרך מכם: לוגו, צבעי המותג, ותמונות וסרטונים שכבר יש לכם. את הגישות לרשתות נקבל מכם בשיחה, לא כאן בקבוצה.

בכל יום חמישי תקבלו כאן עדכון קצר: מה עשינו, מה הלאה ומה צריך מכם. בכל שאלה אפשר לכתוב לנו כאן.$t$),
  ('access', 'מצב החומרים והגישות', 'milestone', null, $t$היי {לקוח}, עדכון קצר על החומרים לעמוד: התקבלו {התקבלו} מתוך {מתוך}.
עוד חסר: {חסר}.
חומרים אפשר לשלוח כאן בקבוצה. את הגישות לרשתות לא שולחים בקבוצה: נתאם שיחה קצרה ונקבל אותן מכם בטלפון.$t$),
  ('summary', 'מה הבנו על העסק', 'milestone', null, $t$היי {לקוח}, תודה על פגישת האפיון! כדי לוודא שהבנו נכון, זה מה שהבנו על {עסק}:
1. מה העסק עושה: [להשלים]
2. למי אתם פונים: [להשלים]
3. מה מייחד אתכם: [להשלים]
4. מה המטרה שלנו יחד: [להשלים]
5. על מה נשים דגש בתוכן: [להשלים]
משהו לא מדויק? כתבו לנו כאן ונתקן.$t$),
  ('scripts', 'תסריטים לאישור', 'milestone', null, $t$היי {לקוח}, התסריטים ליום הצילום מוכנים!
נקבע איתכם זום קצר כדי לעבור עליהם יחד ולאשר. לא מצלמים שום דבר שלא אישרתם.
מתי נוח לכם לזום?$t$),
  ('eve', 'יום לפני הצילום', 'milestone', null, $t$היי {לקוח}, מתכוננים ליום הצילום!
מתי: {תאריך}. הצוות מגיע ב־{שעת הצוות}, והמשפיענים ב־{שעה}.
איפה: {כתובת}
מי מגיע: {מגיעים}
מה להכין: העסק מסודר ונקי, מוצרים ושירותים מוכנים לצילום, שילוט ותאורה דולקים, ועובדים שמוכנים להופיע. בשעה הראשונה מצלמים את העסק עצמו, לפני שהמשפיענים מגיעים.
אם משהו השתנה, כתבו לנו כאן עוד היום.$t$),
  ('thanks', 'תודה אחרי הצילום', 'milestone', null, $t$היי {לקוח}, תודה על יום צילום מעולה!
החומרים כבר בדרך לעריכה, והסרטונים יהיו סגורים עד {תאריך}, כולל סבב תיקונים.
ושאלה קצרה: מ־1 עד 5, איך היה יום הצילום בשבילכם?$t$),
  ('videos', 'הסרטונים מוכנים', 'milestone', null, $t$היי {לקוח}, הסרטונים שלכם מוכנים!
יש לכם סבב תיקונים אחד (סבב 1 מתוך 1). כדאי לרכז את כל ההערות בהודעה אחת, לפי מספר הסרטון.
הערות שיגיעו עד 13:00 נטפל בהן עוד באותו יום, כדי שהכול יהיה סגור עד {תאריך}.$t$),
  ('first_post', 'הפוסט הראשון עלה', 'milestone', null, $t$היי {לקוח}, הפוסט הראשון שלכם עלה!
כל התכנים מתוזמנים לפי הגאנט השנתי, ובכל שבוע נעדכן אתכם מה עלה ומה בדרך.$t$),
  ('campaign', 'הקמפיין באוויר', 'milestone', null, $t$היי {לקוח}, הקמפיין שלכם באוויר!
בימים הראשונים הקמפיין לומד, ואחר כך רואים את התמונה המלאה. נעבור איתכם על התוצאות בשיחה השבועית.$t$),
  ('renewal', 'חידוש', 'milestone', null, $t$היי {לקוח}, בעוד כחודשיים, ב{תאריך}, מסתיימת שנת העבודה שלנו יחד.
נשמח לקבוע שיחה קצרה: נעבור על התוצאות ונתכנן יחד את ההמשך. מתי נוח לכם?$t$),
  ('thursday', 'עדכון חמישי', 'thursday', null, $t$היי {לקוח}, העדכון השבועי שלנו:
מה עשינו השבוע: {עשינו}.
מה הלאה: {הלאה}.
מה צריך מכם: {צריך}.
סוף שבוע נעים!$t$),
  ('delay', 'הודעה על עיכוב', 'delay', null, $t$היי {לקוח}, רצינו לעדכן מראש לגבי {מה}: זה ייקח קצת יותר זמן ממה שתכננו.
במקום {תאריך}, זה יהיה מוכן עד [מועד חדש].
מצטערים על העיכוב. אנחנו על זה.$t$),
  ('daily.join', 'הודעה יומית: הצטרפות', 'daily', 1, $t$היי {לקוח}, אנחנו מסדרים את כל מה שצריך כדי להתחיל: הצוות, פגישת האפיון והחומרים. אם יש שאלה, אנחנו כאן בקבוצה.$t$),
  ('daily.char', 'הודעה יומית: אפיון', 'daily', 2, $t$היי {לקוח}, אנחנו בשלב האפיון: לומדים את העסק לעומק ומסדרים את העמוד, הגרפיקות הראשונות וה־Highlights. נעדכן כאן כשיש משהו לאישור.$t$),
  ('daily.content', 'הודעה יומית: תוכן ואישור', 'daily', 3, $t$היי {לקוח}, היום אנחנו עובדים על התוכן ליום הצילום: הדגשים והתסריטים. לפני שמצלמים, הכול מגיע אליכם לאישור.$t$),
  ('daily.shoot', 'הודעה יומית: יום צילום', 'daily', 4, $t$היי {לקוח}, יום הצילום בפתח ואנחנו מתכוננים אליו. אם יש משהו שחשוב לכם שנדע, כתבו לנו כאן.$t$),
  ('daily.post', 'הודעה יומית: עריכה ובקרה', 'daily', 5, $t$היי {לקוח}, הסרטונים שלכם בעריכה. הם יהיו סגורים עד {תאריך}, ונשלח לכם אותם כאן.$t$),
  ('daily.publish', 'הודעה יומית: פרסום', 'daily', 6, $t$היי {לקוח}, אנחנו מתזמנים את התכנים שלכם ומכינים את הקמפיינים. נעדכן כאן ברגע שהם עולים.$t$),
  ('daily.ongoing', 'הודעה יומית: שוטף', 'daily', 7, $t$היי {לקוח}, התכנים שלכם ממשיכים לעלות לפי הגאנט. יש מבצע, אירוע או משהו חדש בעסק? ספרו לנו ונשלב אותו.$t$),
  ('daily.renewal', 'הודעה יומית: חידוש', 'daily', 8, $t$היי {לקוח}, אנחנו מסכמים את התוצאות של השנה שלנו יחד לקראת שיחת ההמשך. יש משהו שתרצו שנבדוק? כתבו לנו כאן.$t$)
on conflict (key) do nothing;
-- seed:end
