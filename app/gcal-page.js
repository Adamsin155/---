// The person's own Google Calendar on the calendar page (calendar.html; the owner's
// request of 21.10.2026, "סנכרון עם היומן גוגל של עירית"; docs/ops.md, section 65):
//   - "היומן שלי ב־Google": the card where a member of staff pastes the secret iCal
//     address of their Google calendar (once), sees how the last reading went, and
//     disconnects. The address is sent to the database once and never read back
//     (public.google_calendar_connect / _status / _disconnect).
//   - their Google events, read by the server every 15 minutes
//     (public.calendar_external_events, their own rows only), as events of the page in a
//     quiet grey with a "Google" tag; a tap opens the client's card when the meeting is
//     matched to a client.
//   - under a matched meeting or shoot day the system does not hold yet, the office and
//     the owners get one question (app/gcal-logic.js suggestionOf): "לקבוע במערכת…?",
//     saved exactly as the "קביעת מועד" dialogs save (app/date-set.js), or "לא קשור",
//     remembered for that event (public.google_calendar_dismiss).
// Until the migration 20261029100000_google_calendar_sync.sql is in, all of it stays hidden.
import { supabase } from './supa.js';
import { h, fill, toast, errorText, formatWhen, landingTag } from './protocol-ui.js';
import { googleIcsUrl, googleEvent, suggestionOf, suggestionText } from './gcal-logic.js';
import { saveMeeting, saveShootDay } from './date-set.js';
import { sendsInvites, timeText } from './calendar-view.js';
import { PEOPLE, SHOOT_TYPES } from './protocol.js';
import { icon, iconSquare } from './kit.js';

const COLS = 'uid, starts_at, ends_at, all_day, summary, location, client_id, kind_guess, dismissed_at';
let ctx = null;        // { viewer, email, clientOf, checksOf, onSaved, redraw }
let ready = false;     // the database has it
let status = null;     // { connected, since, readAt, error, events }
let rows = [];
let card = null;
let editing = false;   // the address field is open (connecting, or replacing)
let busy = false;
let unfolded = false; // the card is opened by hand, or right after connecting
const choice = new Map(); // event uid → the shoot type chosen under it

export function initGoogle(options) { ctx = options; }

// Status and rows. Quiet when the database does not have it yet.
export async function loadGoogle() {
  if (!ctx) return;
  try {
    const { data, error } = await supabase.rpc('google_calendar_status');
    if (error) throw error;
    status = data || { connected: false };
    ready = true;
  } catch { ready = false; status = null; rows = []; renderCard(); return; }
  if (status.connected) {
    const since = new Date(Date.now() - 8 * 864e5).toISOString();
    const { data, error } = await supabase.from('calendar_external_events').select(COLS)
      .eq('email', ctx.email).is('gone_at', null).gte('starts_at', since).order('starts_at').limit(2000);
    rows = error ? rows : (data || []);
  } else rows = [];
  renderCard();
}

export const googleEvents = () => (ready && status?.connected ? rows.map(googleEvent) : []);

// ── An event on the page ──────────────────
export function googleNode(e) {
  const row = e.google;
  const client = row.client_id ? ctx.clientOf(row.client_id) : null;
  const body = [
    iconSquare('calendar', 'gray', { size: 'sm' }),
    h('span', { class: 'cp-ev-t' },
      h('strong', { class: 'cp-ev-title' }, h('span', { class: 'gc-tag', 'aria-label': 'מהיומן ב־Google' }, 'Google'), ' ', e.title, client ? landingTag(client) : null),
      h('span', { class: 'cp-ev-sub' }, [timeText(e), client ? (client.business || client.name) : null, row.location || null].filter(Boolean).join(' · '))),
  ];
  const main = client ? h('a', { class: 'cp-ev-main', href: `client.html?id=${encodeURIComponent(client.id)}` }, body) : h('div', { class: 'cp-ev-main' }, body);
  return h('li', { class: 'cp-ev gc-ev', 'data-kind': 'google', 'data-uid': e.uid }, main, suggestionNode(row, client));
}

function suggestionNode(row, client) {
  if (!sendsInvites(ctx.viewer)) return null;
  const s = suggestionOf(row, client, { now: new Date() });
  if (!s) return null;
  const id = `gc-${row.uid}`.replace(/[^\w-]/g, '_');
  const type = choice.get(row.uid) ?? (SHOOT_TYPES[client.shoot_type] ? client.shoot_type : null);
  const person = client.characterizer || 'ofir';
  return h('div', { class: 'gc-sug', role: 'group', 'aria-labelledby': `${id}-q` },
    h('p', { class: 'gc-q', id: `${id}-q` }, suggestionText(s, client), s.kind === 'char' ? h('span', { class: 'gc-with' }, ` עם ${PEOPLE[person]?.name || ''}`) : null),
    s.kind === 'shoot' ? h('div', { class: 'gc-types', role: 'group', 'aria-label': 'עם מי מצלמים?' },
      h('span', { class: 'gc-types-h' }, 'עם מי מצלמים?'),
      Object.values(SHOOT_TYPES).map((t) => h('button', {
        type: 'button', class: 'chip', 'data-type': t.key, 'aria-pressed': String(type === t.key),
        onclick: () => { choice.set(row.uid, t.key); ctx.redraw(); document.querySelector(`#${id}-acts`)?.closest('.gc-sug')?.querySelector(`.chip[data-type="${t.key}"]`)?.focus(); },
      }, t.name))) : null,
    h('div', { class: 'gc-acts', id: `${id}-acts` },
      h('button', { type: 'button', class: 'btn btn-sm btn-primary gc-yes', disabled: busy, onclick: () => accept(row, client, s, type, person) }, 'לקבוע'),
      h('button', { type: 'button', class: 'btn-text gc-no', disabled: busy, onclick: () => dismiss(row) }, 'לא קשור')));
}

async function accept(row, client, s, type, person) {
  if (s.kind === 'shoot' && !type) { toast('בוחרים קודם עם מי מצלמים.'); return; }
  busy = true;
  ctx.redraw();
  try {
    let saved;
    if (s.kind === 'char') saved = await saveMeeting(client, { at: s.at, person }, { checks: ctx.checksOf(client.id) });
    else {
      saved = await saveShootDay(client, { at: s.at, type }, { me: ctx.viewer?.me ?? null });
      if (!saved.ok) return;
    }
    ctx.onSaved(saved.row, saved.marked || null);
    toast(`${s.kind === 'char' ? 'פגישת האפיון' : 'יום הצילום'} של ${client.business || client.name} נקבע במערכת: ${formatWhen(s.at)}.`);
  } catch (err) {
    toast(err?.rule ? err.message : `המועד לא נשמר. ${errorText(err)}`);
  } finally {
    busy = false;
    ctx.redraw();
  }
}

async function dismiss(row) {
  busy = true;
  ctx.redraw();
  try {
    const { error } = await supabase.rpc('google_calendar_dismiss', { p_uid: row.uid });
    if (error) throw error;
    row.dismissed_at = new Date().toISOString();
    toast('בסדר. לא נשאל שוב על הפגישה הזאת.');
  } catch (err) {
    toast(`לא נשמר. ${errorText(err)}`);
  } finally {
    busy = false;
    ctx.redraw();
  }
}

// ── "היומן שלי ב־Google" ──────────────────
const ERRORS = {
  gone: 'Google כבר לא מכיר את הכתובת (אולי אופסה). מדביקים כאן את הכתובת החדשה.',
  bad_url: 'הכתובת לא תקינה. מדביקים את "הכתובת הסודית בפורמט iCal".',
  not_ics: 'לא הצלחנו לקרוא את היומן מהכתובת. מדביקים את "הכתובת הסודית בפורמט iCal".',
  too_big: 'היומן גדול מדי לקריאה. כדאי לבחור יומן של עבודה בלבד.',
};
const errorLine = (code) => ERRORS[code] || 'Google לא ענה בקריאה האחרונה. ננסה שוב בעוד רבע שעה.';
const STEPS = [
  'במחשב, ב־calendar.google.com: לוחצים על ⚙ (הגדרות) למעלה.',
  'בצד ימין בוחרים את היומן שלך (תחת "הגדרות של היומנים שלי").',
  'יורדים ל"שילוב היומן" ומעתיקים את "כתובת סודית בפורמט iCal".',
  'מדביקים אותה כאן ולוחצים "חיבור".',
];

export function mountGoogleCard(el) { card = el; renderCard(); }

function renderCard() {
  if (!card) return;
  card.hidden = !ready;
  if (!ready) return;
  const on = !!status?.connected;
  const meta = on ? [
    `מחובר מאז ${formatWhen(new Date(status.since))}`,
    status.readAt ? `נקרא לאחרונה ${formatWhen(new Date(status.readAt))} · ${status.events === 1 ? 'אירוע אחד' : `${status.events} אירועים`}` : 'הקריאה הראשונה תוך רבע שעה',
  ].join(' · ') : null;
  const form = !on || editing ? h('form', { class: 'gc-form', novalidate: true, onsubmit: connect },
    h('ol', { class: 'gc-steps' }, STEPS.map((s) => h('li', {}, s))),
    h('div', { class: 'field' },
      h('label', { for: 'gc-url' }, 'הכתובת הסודית של היומן שלך ב־Google'),
      h('div', { class: 'linkbox' },
        h('input', { class: 'input', id: 'gc-url', type: 'url', dir: 'ltr', autocomplete: 'off', spellcheck: 'false', inputmode: 'url', placeholder: 'https://calendar.google.com/calendar/ical/…/basic.ics', 'aria-describedby': 'gc-err gc-priv' }),
        h('button', { type: 'submit', class: 'btn btn-sm btn-primary', id: 'gc-save', disabled: busy }, 'חיבור'))),
    h('p', { class: 'err', id: 'gc-err', role: 'alert', hidden: true }),
    h('p', { class: 'hint', id: 'gc-priv' }, 'הכתובת סודית: היא נשמרת במערכת רק לקריאת היומן שלך, ואף אחד לא רואה אותה, גם לא את/ה. רק את/ה רואה את האירועים שלך.'),
    on ? h('button', { type: 'button', class: 'btn-text', onclick: () => { editing = false; renderCard(); } }, 'ביטול') : null) : null;
  fill(card, h('details', { class: 'gc-fold', open: !on || editing || unfolded || !!status?.error, ontoggle: (e) => { unfolded = e.currentTarget.open; } },
    h('summary', {},
      h('span', { class: 'gc-h' }, icon('calendar', { size: 18 }), 'היומן שלי ב־Google'),
      h('span', { class: `gc-state${on ? ' is-on' : ''}` }, on ? (status.error ? 'יש בעיה' : 'מחובר') : 'לא מחובר')),
    on ? null : h('p', { class: 'gc-lede' }, 'הפגישות שקבעת ביומן Google שלך יופיעו כאן, ביומן של המערכת. מתעדכן לבד כל רבע שעה.'),
    meta ? h('p', { class: 'gc-meta', id: 'gc-meta' }, meta) : null,
    on && status.error ? h('p', { class: 'gc-warn', role: 'status' }, errorLine(status.error)) : null,
    form,
    on && !editing ? h('div', { class: 'gc-acts' },
      h('button', { type: 'button', class: 'btn-text', id: 'gc-replace', onclick: () => { editing = true; renderCard(); document.getElementById('gc-url')?.focus(); } }, 'החלפת כתובת'),
      h('button', { type: 'button', class: 'btn-text', id: 'gc-off', disabled: busy, onclick: disconnect }, 'ניתוק')) : null));
}

async function connect(ev) {
  ev.preventDefault();
  const input = document.getElementById('gc-url');
  const err = document.getElementById('gc-err');
  const url = googleIcsUrl(input.value);
  if (!url) {
    err.textContent = input.value.trim() ? 'זו לא הכתובת הסודית של Google. היא מתחילה ב־https://calendar.google.com/calendar/ical/ ונגמרת ב־basic.ics.' : 'מדביקים את הכתובת.';
    err.hidden = false;
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    return;
  }
  busy = true;
  try {
    const { data, error } = await supabase.rpc('google_calendar_connect', { p_url: url });
    if (error) throw error;
    status = data || { connected: true };
    editing = false;
    unfolded = true;
    rows = [];
    toast('היומן חובר. האירועים יופיעו כאן תוך רבע שעה.');
  } catch (e) {
    err.textContent = /bad_url/.test(e?.message || '') ? 'זו לא הכתובת הסודית של Google.' : `לא נשמר. ${errorText(e)}`;
    err.hidden = false;
    busy = false;
    return;
  }
  busy = false;
  renderCard();
  ctx.redraw();
  document.getElementById('gc-replace')?.focus();
}

async function disconnect() {
  if (!confirm('לנתק את היומן של Google? האירועים שלו ייעלמו מהיומן כאן. אפשר לחבר שוב בכל רגע.')) return;
  busy = true;
  try {
    const { data, error } = await supabase.rpc('google_calendar_disconnect');
    if (error) throw error;
    status = data || { connected: false };
    rows = [];
    toast('היומן של Google נותק.');
  } catch (e) {
    toast(`הניתוק לא נשמר. ${errorText(e)}`);
  } finally {
    busy = false;
    renderCard();
    ctx.redraw();
  }
}
