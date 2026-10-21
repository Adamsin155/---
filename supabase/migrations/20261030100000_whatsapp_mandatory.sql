-- Work messages on WhatsApp are a required work channel (the owner's decision of
-- 21.10.2026): every staff member gets them on WhatsApp AND as the app's
-- notifications on the phone, both channels, not one or the other. Until now the
-- consent screen offered a free choice (20260930180000_whatsapp.sql: "זו בחירה שלך",
-- WhatsApp or push only) and "המשימות שלי" let a person stop. From here:
--
--   whatsapp_consent_texts    version 2: the wording of a required channel (the same
--                             hours, what is sent, the dedicated number, the privacy
--                             notice). The screen asks for both channels.
--                             THE WORDING AWAITS THE LAWYER'S OK.
--   whatsapp_my_consent()     asks again on every visit until WhatsApp is connected:
--                             whoever has not connected, chose push only before, or
--                             replied "הסר" (and 'required': true for the screen).
--   whatsapp_decide()         'whatsapp' only; "push only" is no longer a choice
--                             ('required').
--   whatsapp_withdraw()       no longer callable from the app (the card has no "stop").
--   whatsapp_removed_since()  for the reminders function (service role): who replied
--                             "הסר" on WhatsApp lately, so the owners hear it at once
--                             (app/reminder-rules.js, rule `waRemoved`).
--
-- "הסר" on WhatsApp still stops the messages to that number (Meta's policy, and Jako's
-- reading of it: public.whatsapp_apply is unchanged). That person is asked to connect
-- again on their next visit, and the owners get a notification in the app.
-- Additive: one new row, functions replaced in place, one permission taken back. No
-- row is changed. Safe to run again. Tested in a real Postgres:
-- tests/sql/whatsapp-mandatory.test.mjs.

-- ── The wording, version 2 ─────────────────
-- AWAITS THE LAWYER'S OK (as version 1 did): a change after the lawyer reads it is a
-- new version in a new migration. no_label is not shown any more (closing the screen
-- is "later", not a choice); the column needs a value.
insert into public.whatsapp_consent_texts (version, title, body, yes_label, no_label) values (2,
  'חובה: גם WhatsApp וגם התראות באפליקציה',
  E'הודעות העבודה מגיעות בשני ערוצים, ושניהם חובה לכל הצוות: WhatsApp, מהמספר העסקי הייעודי של אסטרטג, למספר {phone}, והתראות של האפליקציה בטלפון.\n\n'
  || E'מה יישלח: סיכום יומי, משימה חדשה, תזכורת למועד או לאיחור, חריגה, יום צילום, ושיוך עורך. רק עבודה.\n\n'
  || E'מתי: רק בימים א׳–ה׳ בין 08:30 ל־19:00, ובערב חג עד 13:00. לא בשבת ולא בחג. אין צורך לענות מחוץ לשעות העבודה שלך.\n\n'
  || E'הסר: תשובה ״הסר״ ב־WhatsApp עוצרת את ההודעות. זה ערוץ עבודה חובה, ולכן הבעלים יקבלו על כך הודעה, והמערכת תבקש לחבר שוב.\n\n'
  || 'נשמרים: מועד החיבור, והאם כל הודעה נשלחה, נמסרה ונקראה. פרטים בהודעת הפרטיות לעובדים.',
  'חיבור WhatsApp',
  'אחר כך')
on conflict (version) do nothing;

-- ── The caller's state ─────────────────────
-- As before, with: 'prompt' on every visit until WhatsApp goes to the number they
-- have today (not only before a first choice), and 'required'.
create or replace function public.whatsapp_my_consent() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  st public.staff;
  c public.whatsapp_consents;
  t public.whatsapp_consent_texts;
  v_owner boolean;
  v_phone text;
  v_active boolean;
begin
  if not public.is_staff() then return null; end if;
  select * into st from public.staff where email = me;
  select * into c from public.whatsapp_consents where email = me;
  select * into t from public.whatsapp_consent_texts order by version desc limit 1;
  v_owner := st.person is null;
  v_phone := case when v_owner then c.phone else st.phone end;
  v_active := c.status = 'granted' and c.phone is not null and c.phone = v_phone;
  return jsonb_build_object(
    'enabled', private.whatsapp_enabled(),
    'required', true,
    'owner', v_owner,
    'phone', v_phone,
    'status', c.status,
    'via', c.withdrawn_via,
    'decided_at', c.decided_at,
    'version', c.text_version,
    'active', coalesce(v_active, false),
    -- Asked on every visit until connected: a person with a number (the owner types his).
    'prompt', private.whatsapp_enabled() and (v_owner or v_phone is not null) and not coalesce(v_active, false),
    'text', jsonb_build_object('version', t.version, 'title', t.title,
              'body', replace(t.body, '{phone}', coalesce(private.phone_text(v_phone), '[מספר הנייד שלך]')),
              'yes', t.yes_label, 'no', t.no_label));
end $$;

-- ── Connecting ─────────────────────────────
-- As before, but only 'whatsapp': "push only" is no longer a choice.
create or replace function public.whatsapp_decide(p_choice text, p_version integer, p_phone text default null, p_user_agent text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  st public.staff;
  t public.whatsapp_consent_texts;
  v_phone text;
  v_who text;
begin
  if not public.is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_choice = 'push' then raise exception 'required: WhatsApp is a required work channel' using errcode = '22023'; end if;
  if p_choice is distinct from 'whatsapp' then raise exception 'bad_choice' using errcode = '22023'; end if;
  select * into st from public.staff where email = me;
  select * into t from public.whatsapp_consent_texts order by version desc limit 1;
  if p_version is distinct from t.version then raise exception 'stale_text' using errcode = '22023'; end if;
  v_who := coalesce(st.person, 'owner');
  if st.person is null then
    v_phone := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '');
    if v_phone ~ '^05[0-9]{8}$' then v_phone := '972' || substr(v_phone, 2); end if;
    if v_phone is null then
      v_phone := (select c.phone from public.whatsapp_consents c where c.email = me);
    end if;
  else
    v_phone := st.phone;
  end if;
  if v_phone is null or v_phone !~ '^9725[0-9]{8}$' then raise exception 'no_phone' using errcode = '22023'; end if;
  insert into public.whatsapp_consents (email, person, status, phone, text_version, decided_at, withdrawn_via)
  values (me, v_who, 'granted', v_phone, t.version, now(), null)
  on conflict (email) do update set person = excluded.person, status = excluded.status, phone = excluded.phone,
    text_version = excluded.text_version, decided_at = excluded.decided_at, withdrawn_via = null;
  insert into public.whatsapp_consent_log (email, person, action, via, phone, text_version, wording, answer, user_agent)
  values (me, v_who, 'granted', 'app', v_phone, t.version,
          t.title || E'\n\n' || replace(t.body, '{phone}', coalesce(private.phone_text(v_phone), '[מספר הנייד שלך]')),
          t.yes_label, left(p_user_agent, 300));
  return public.whatsapp_my_consent();
end $$;

-- ── No "stop" in the app ───────────────────
-- The function stays (its history in whatsapp_consent_log reads the same); the app
-- may no longer call it. "הסר" on WhatsApp is the one way out, and it is told.
revoke execute on function public.whatsapp_withdraw(text) from public, anon, authenticated;

-- ── "הסר": the owners hear ─────────────────
-- Who replied "הסר" on WhatsApp since p_since (Meta's webhook or Jako's reading, both
-- through public.whatsapp_apply), one row per time, for the reminders function: the
-- rule `waRemoved` rings the owners "<name> ניתק/ה את WhatsApp" (its key is the log
-- row's id, so each time is told once).
create or replace function public.whatsapp_removed_since(p_since timestamptz)
returns table (id bigint, email text, person text, at timestamptz)
language sql stable security definer set search_path = '' as $$
  select l.id, l.email, l.person, l.at
  from public.whatsapp_consent_log l
  where l.action = 'withdrawn' and l.via = 'whatsapp' and l.at >= coalesce(p_since, now() - interval '2 days')
  order by l.id;
$$;

revoke execute on function public.whatsapp_my_consent() from public, anon;
revoke execute on function public.whatsapp_decide(text, integer, text, text) from public, anon;
grant execute on function public.whatsapp_my_consent() to authenticated;
grant execute on function public.whatsapp_decide(text, integer, text, text) to authenticated;
revoke execute on function public.whatsapp_removed_since(timestamptz) from public, anon, authenticated;
grant execute on function public.whatsapp_removed_since(timestamptz) to service_role;
