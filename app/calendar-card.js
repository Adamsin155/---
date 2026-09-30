// "היומן שלי" in "מה עליי" (clients.html): a personal, secret subscription link
// that Google Calendar, Apple Calendar or Outlook reads by itself, with the
// signed-in person's own shoot days, meetings, Zoom calls and deadlines
// (app/calendar-feed.js, served by supabase/functions/calendar).
//  - The database keeps only the SHA-256 of the token, so the link is shown once,
//    right after it is made; later the card says it is connected and when the
//    calendar last read it. "קישור חדש" replaces it (the old one stops at once),
//    "ניתוק" removes it.
//  - Until the migration 20260930200000_calendar_feeds.sql is in, the card stays hidden.
import { supabase, SUPABASE_URL } from './supa.js';
import { feedUrl, webcalUrl, googleAddUrl } from './calendar-feed.js';
import { $, fill, h, toast, errorText, formatWhen } from './protocol-ui.js';

let card = null;
let status = null;   // { connected, created_at, last_fetch_at } | null (not connected)
let fresh = null;    // the link made on this page (kept only in this page's memory)
let busy = false;

async function loadStatus() {
  const { data, error } = await supabase.rpc('calendar_feed_status');
  if (error) throw error;
  status = (Array.isArray(data) ? data[0] : data) || null;
}

const STEPS = [
  ['cal-g', 'Google Calendar', [
    'במחשב: לוחצים על הכפתור "הוספה ל־Google Calendar" למעלה ומאשרים, או ב־calendar.google.com: ״לוחות שנה אחרים״ ← ״+״ ← ״מכתובת URL״ ← מדביקים את הקישור.',
    'בטלפון אנדרואיד היומן מופיע לבד אחרי כמה דקות. אם לא: באפליקציית Google Calendar ← הגדרות ← מסמנים את ״אסטרטג״.',
  ]],
  ['cal-a', 'אייפון ו־Mac (היומן של Apple)', [
    'באייפון: לוחצים על "פתיחה ביומן של Apple" ומאשרים ״הירשם כמנוי״.',
    'או: הגדרות ← יומן ← חשבונות ← הוספת חשבון ← אחר ← הוספת לוח שנה כמנוי ← מדביקים את הקישור.',
  ]],
  ['cal-o', 'Outlook', [
    'ב־Outlook באינטרנט: יומן ← ״הוספת לוח שנה״ ← ״הירשם כמנוי מהאינטרנט״ ← מדביקים את הקישור ← ״ייבוא״.',
  ]],
];

function linkView(url) {
  return h('div', { class: 'cal-link', role: 'group', 'aria-labelledby': 'cal-link-h' },
    h('p', { class: 'cal-link-h', id: 'cal-link-h' }, 'הקישור ליומן שלך'),
    h('div', { class: 'linkbox' },
      h('label', { class: 'sr-only', for: 'cal-url' }, 'הקישור ליומן'),
      h('input', { class: 'input', id: 'cal-url', readonly: true, dir: 'ltr', value: url, onfocus: (e) => e.target.select() }),
      h('button', { type: 'button', class: 'btn btn-sm', id: 'cal-copy', onclick: () => copy(url) }, 'העתקה')),
    h('div', { class: 'cal-acts' },
      h('a', { class: 'btn btn-sm', id: 'cal-apple', href: webcalUrl(url) }, 'פתיחה ביומן של Apple'),
      h('a', { class: 'btn btn-sm', id: 'cal-google', href: googleAddUrl(url), target: '_blank', rel: 'noopener noreferrer' },
        'הוספה ל־Google Calendar', h('span', { class: 'sr-only' }, ' (נפתח בחלון חדש)'))),
    h('p', { class: 'hint cal-warn' }, 'הקישור אישי: מי שמחזיק בו רואה את היומן שלך. לא שולחים אותו לאף אחד. הוא מוצג רק עכשיו; אם הלך לאיבוד, יוצרים קישור חדש.'),
    h('details', { class: 'cal-how' },
      h('summary', {}, 'איך מוסיפים ליומן'),
      ...STEPS.map(([id, title, lines]) => h('section', { 'aria-labelledby': `${id}-h` },
        h('h3', { id: `${id}-h` }, title),
        h('ul', {}, ...lines.map((l) => h('li', {}, l)))))));
}

function render() {
  if (!card) return;
  const connected = !!status?.connected;
  card.dataset.state = fresh ? 'fresh' : connected ? 'on' : 'off';
  const meta = connected ? [
    `מחובר מאז ${formatWhen(new Date(status.created_at))}`,
    status.last_fetch_at ? `היומן התעדכן לאחרונה ${formatWhen(new Date(status.last_fetch_at))}` : 'היומן עוד לא קרא את הקישור',
  ].join(' · ') : null;
  fill(card,
    h('h2', { class: 'cal-h', id: 'cal-h', tabindex: '-1' }, 'היומן שלי'),
    connected ? h('p', { class: 'cal-meta', id: 'cal-meta' }, meta)
      : h('p', {}, 'ימי הצילום, הפגישות והיעדים שלך ביומן של הטלפון או המחשב. מתעדכן לבד, ורק עם העבודה שלך.'),
    fresh ? linkView(fresh) : null,
    h('div', { class: 'cal-acts' },
      connected
        ? [h('button', { type: 'button', class: 'btn-text', id: 'cal-rotate', disabled: busy, onclick: rotate }, 'קישור חדש'),
          h('button', { type: 'button', class: 'btn-text', id: 'cal-revoke', disabled: busy, onclick: revoke }, 'ניתוק')]
        : h('button', { type: 'button', class: 'btn btn-sm btn-primary', id: 'cal-make', disabled: busy, onclick: rotate }, 'חיבור ליומן')));
}

async function rotate() {
  if (status?.connected && !confirm('ליצור קישור חדש? הקישור הקודם יפסיק לעבוד מיד, וצריך להוסיף את החדש ליומן במקומו.')) return;
  busy = true;
  render();
  try {
    const { data: token, error } = await supabase.rpc('calendar_feed_rotate');
    if (error) throw error;
    fresh = feedUrl(SUPABASE_URL, String(token));
    await loadStatus().catch(() => { status = { connected: true, created_at: new Date().toISOString(), last_fetch_at: null }; });
    toast('הקישור ליומן מוכן. מעתיקים אותו ומוסיפים ליומן.');
  } catch (err) {
    toast(`הקישור לא נוצר. ${errorText(err)}`);
  } finally {
    busy = false;
    render();
  }
  $('cal-url')?.focus();
}

async function revoke() {
  if (!confirm('לנתק את היומן? הקישור יפסיק לעבוד, והאירועים של אסטרטג ייעלמו מהיומן בעדכון הבא שלו.')) return;
  busy = true;
  render();
  try {
    const { error } = await supabase.rpc('calendar_feed_revoke');
    if (error) throw error;
    status = null;
    fresh = null;
    toast('היומן נותק. הקישור כבר לא עובד.');
  } catch (err) {
    toast(`הניתוק לא נשמר. ${errorText(err)}`);
  } finally {
    busy = false;
    render();
  }
  $('cal-make')?.focus();
}

async function copy(url) {
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    $('cal-url').select();
    if (!document.execCommand('copy')) { toast('ההעתקה לא הצליחה. סמנו את הקישור והעתיקו ידנית.'); return; }
  }
  toast('הקישור הועתק. מדביקים אותו ביומן, ולא שולחים לאף אחד.');
}

// Shows the card in `el` for the signed-in staff member (hidden if the database is not ready).
export async function mountCalendar(el) {
  card = el;
  if (!card) return;
  try {
    await loadStatus();
  } catch {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  render();
}
