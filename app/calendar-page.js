// "יומן" (calendar.html; the owner's request of 15.10.2026, for Irit): the meetings and
// the shoot days in a week (the phone's first view) or a month, prev / next / today, in
// Israel time. A tap on an event opens the client's card. The office (the owners, Irit,
// Lior, Ofir) has "שליחת זימון" on each meeting and shoot day: Google Calendar opens with
// the event filled in and its guests in it (the client when the system has their email,
// the characterizer; Lior and Eli on a shoot day), and Google sends the invitations when
// Save is pressed. What is shown and to whom: app/calendar-view.js.
import { PEOPLE } from './protocol.js';
import { loadClients, loadChecks, loadTasks, loadDirectory, quoteFacts } from './protocol-data.js';
import { $, fill, h, errorText, mountSession, viewerOf, VIEWER_UNKNOWN, directory, landingTag } from './protocol-ui.js';
import {
  seesCalendar, sendsInvites, calendarEvents, byDay, weekDays, monthWeeks, rangeOf, shift, titleOf, todayKey, kindOf, timeText,
  inviteFor, emailsOf, clientEmails, guestNames, WEEKDAYS,
} from './calendar-view.js';
import { homeLink } from './shell-rules.js';
import { TZ, dayFromKeyIL } from './tz.js';
import { icon, iconSquare, dateLeaf, emptyRow } from './kit.js';

let viewer = null;
let clients = [];
let checks = {};
let tasks = [];
let emails = {};      // staff: person → email
let clientMail = {};  // client id → email (the office, from the agreements)
let view = 'week';
let anchor = todayKey();
let selected = null;  // the day open under the month
let busy = false;

const VIEW_KEY = 'astrateg.calendar.view';   // this browser's last choice: a convenience only
const HINT_KEY = 'astrateg.calendar.invited'; // the one line about Google is shown until the first invitation
const readKey = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const writeKey = (k, val) => { try { localStorage.setItem(k, val); } catch { /* no storage */ } };
const site = () => new URL('.', location.href).href;
const cardHref = (id) => `client.html?id=${encodeURIComponent(id)}`;
const clientOf = (id) => clients.find((c) => c.id === id) || null;
const dayFmt = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'numeric' });
const shortDay = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, weekday: 'short' });
const dayNum = (key) => Number(key.slice(8));

// ── Loading ───────────────────────────────
async function load() {
  if (busy) return;
  busy = true;
  if (!clients.length) $('state').textContent = 'טוען…';
  try {
    const [cs, ks, ts] = await Promise.all([loadClients(), loadChecks(), loadTasks({ openOnly: true })]);
    [clients, checks, tasks] = [cs, ks, ts];
    emails = emailsOf(directory);
    // The client's email is in the signed agreement (public.quote_facts answers the office).
    if (sendsInvites(viewer)) {
      const ids = [...new Set(clients.map((c) => c.quote_id).filter(Boolean))];
      clientMail = ids.length ? clientEmails(clients, await quoteFacts(ids)) : {};
    }
    $('state').textContent = '';
  } catch (err) {
    $('state').textContent = errorText(err);
  } finally { busy = false; }
  render();
}

// ── One event ─────────────────────────────
function inviteOf(e) {
  if (!sendsInvites(viewer)) return null;
  const client = clientOf(e.client);
  return inviteFor(e, { client, emails, clientEmail: clientMail[e.client] || null, site: site() });
}
let hintShown = false; // once per drawing: under the first invitation only
function eventNode(e) {
  const k = kindOf(e);
  const client = clientOf(e.client);
  const who = e.kind === 'char' && client ? ` · עם ${PEOPLE[client.characterizer || 'ofir']?.name || ''}` : '';
  const body = [
    iconSquare(k.icon, k.tone, { size: 'sm' }),
    h('span', { class: 'cp-ev-t' },
      h('strong', { class: 'cp-ev-title' }, e.title, landingTag(client)),
      h('span', { class: 'cp-ev-sub' }, `${timeText(e)}${who}`)),
  ];
  const main = client
    ? h('a', { class: 'cp-ev-main', href: e.kind === 'task' ? `${cardHref(client.id)}#tasks` : cardHref(client.id) }, body)
    : h('div', { class: 'cp-ev-main' }, body);
  const inv = inviteOf(e);
  let invite = null;
  if (inv) {
    const showHint = !hintShown && !readKey(HINT_KEY);
    hintShown = true;
    invite = h('div', { class: 'cp-inv' },
      h('a', {
        class: 'btn btn-sm cp-invite', href: inv.url, target: '_blank', rel: 'noopener', 'data-guests': inv.guests.join(','),
        'aria-label': `שליחת זימון: ${e.title}`, onclick: () => writeKey(HINT_KEY, '1'),
      }, icon('send', { size: 16 }), 'שליחת זימון'),
      h('span', { class: 'cp-inv-who' }, `מוזמנים: ${guestNames(inv) || 'אין עדיין כתובות מייל'}`),
      showHint ? h('p', { class: 'cp-hint' }, 'נפתח Google Calendar: לוחצים ״שמירה״, ו־Google שולח את הזימון לכולם.') : null);
  }
  return h('li', { class: 'cp-ev', 'data-kind': e.kind, 'data-uid': e.uid }, main, invite);
}
const eventList = (list) => h('ul', { class: 'cp-evs' }, list.map(eventNode));

// ── The views ─────────────────────────────
function leafOfDay(key, today) {
  const top = key === today ? 'היום' : shortDay.format(dayFromKeyIL(key));
  return dateLeaf({ top, day: dayNum(key), tone: key === today ? 'navy' : 'purple', label: dayFmt.format(dayFromKeyIL(key)) });
}
function weekView(days) {
  const today = todayKey();
  return h('ol', { class: 'cp-week' }, weekDays(anchor).map((key) => {
    const list = days[key] || [];
    return h('li', { class: `cp-day${key === today ? ' is-today' : ''}${key < today ? ' is-past' : ''}`, 'data-day': key },
      leafOfDay(key, today),
      h('div', { class: 'cp-day-b' }, list.length ? eventList(list) : h('p', { class: 'cp-free' }, 'אין אירועים')));
  }));
}
function monthView(days) {
  const today = todayKey();
  const { month, weeks } = monthWeeks(anchor);
  const all = weeks.flat();
  if (!selected || !all.includes(selected)) selected = all.includes(today) && today.startsWith(month) ? today : `${month}-01`;
  const cell = (key) => {
    const list = days[key] || [];
    const out = !key.startsWith(month);
    const label = `${dayFmt.format(dayFromKeyIL(key))}, ${list.length ? `${list.length} אירועים` : 'אין אירועים'}`;
    return h('button', {
      type: 'button', class: `cp-cell${out ? ' is-out' : ''}${key === today ? ' is-today' : ''}`, 'data-day': key,
      'aria-pressed': String(key === selected), 'aria-label': label,
      onclick: () => { selected = key; render(); document.querySelector(`.cp-cell[data-day="${key}"]`)?.focus(); },
    },
    h('span', { class: 'cp-num', 'aria-hidden': 'true' }, String(dayNum(key))),
    list.length ? h('span', { class: 'cp-marks', 'aria-hidden': 'true' },
      list.slice(0, 3).map((e) => h('span', { class: 'cp-mark', 'data-tone': kindOf(e).tone }, h('span', { class: 'cp-mark-t' }, e.title))),
      list.length > 3 ? h('span', { class: 'cp-more' }, `+${list.length - 3}`) : null) : null);
  };
  const chosen = days[selected] || [];
  return h('div', { class: 'cp-month' },
    h('div', { class: 'cp-grid', role: 'group', 'aria-label': titleOf('month', anchor) },
      WEEKDAYS.map((d) => h('span', { class: 'cp-wd', 'aria-hidden': 'true' }, d)),
      all.map(cell)),
    h('section', { class: 'cp-chosen', 'aria-labelledby': 'cp-chosen-h' },
      h('div', { class: 'cp-chosen-head' }, leafOfDay(selected, today),
        h('h3', { id: 'cp-chosen-h' }, dayFmt.format(dayFromKeyIL(selected)))),
      chosen.length ? eventList(chosen) : emptyRow({ icon: 'calendar', text: 'אין אירועים ביום הזה.' })));
}

function render() {
  const { from, until } = rangeOf(view, anchor);
  const events = calendarEvents({ viewer, clients, checks, tasks, from, until, site: site() });
  const days = byDay(events);
  hintShown = false;
  $('cp-title').textContent = titleOf(view, anchor);
  $('cp-week').setAttribute('aria-pressed', String(view === 'week'));
  $('cp-month').setAttribute('aria-pressed', String(view === 'month'));
  const unit = view === 'month' ? 'החודש' : 'השבוע';
  $('cp-prev').setAttribute('aria-label', `${unit} הקודם`);
  $('cp-next').setAttribute('aria-label', `${unit} הבא`);
  const now = todayKey();
  const { first, last } = rangeOf(view, anchor);
  $('cp-today').disabled = view === 'week' ? now >= first && now <= last : anchor.slice(0, 7) === now.slice(0, 7);
  const n = events.length;
  fill($('cp-view'),
    h('p', { class: 'cp-count', role: 'status' }, n ? `${n} אירועים ב${view === 'month' ? 'חודש' : 'שבוע'} הזה` : `אין אירועים ב${view === 'month' ? 'חודש' : 'שבוע'} הזה`),
    view === 'month' ? monthView(days) : weekView(days));
}

function go(next) { anchor = next; selected = null; render(); }
function setView(v) {
  if (v === view) return;
  view = v;
  writeKey(VIEW_KEY, v);
  if (v === 'month') selected = anchor;
  render();
}

// ── Start ─────────────────────────────────
$('cp-prev').append(icon('go', { size: 20 }));
$('cp-next').append(icon('go', { size: 20 }));
$('cp-week').addEventListener('click', () => setView('week'));
$('cp-month').addEventListener('click', () => setView('month'));
$('cp-prev').addEventListener('click', () => go(shift(view, anchor, -1)));
$('cp-next').addEventListener('click', () => go(shift(view, anchor, 1)));
$('cp-today').addEventListener('click', () => { const t = todayKey(); anchor = t; selected = t; render(); });

mountSession(async (staff) => {
  const v = await viewerOf(staff.email);
  viewer = v;
  Object.assign(directory, await loadDirectory());
  if (v.error) { $('app').hidden = true; $('state').textContent = VIEWER_UNKNOWN; return; }
  if (!seesCalendar(v)) {
    $('app').hidden = true;
    const home = homeLink(v);
    $('state').classList.add('no-access');
    fill($('state'), h('strong', {}, 'אין לך גישה לעמוד הזה.'), h('a', { class: 'btn', href: home.href }, home.label));
    return;
  }
  // The phone opens on the week; a wide screen on the month; a choice made here is kept.
  const saved = readKey(VIEW_KEY);
  view = saved === 'week' || saved === 'month' ? saved : (window.matchMedia?.('(min-width: 900px)').matches ? 'month' : 'week');
  $('cp-lede').textContent = v.scope === 'office'
    ? 'פגישות האפיון וימי הצילום של כל הלקוחות. לחיצה על אירוע פותחת את כרטיס הלקוח.'
    : 'האירועים שלך. לחיצה על אירוע פותחת את כרטיס הלקוח.';
  await load();
  setInterval(() => { if (!document.hidden) load(); }, 120e3);
});
