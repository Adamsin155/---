// Shared view helpers for the client protocol pages: login, people, dates, statuses.
import {
  supabase, currentStaff, explainError, sendPasswordReset, looksLikeEmail, RESET_NEEDS_EMAIL, RESET_SENT,
} from './supa.js';
import { h } from './quote-doc.js';
import { PEOPLE } from './protocol.js';
import { businessDaysBetween } from './protocol-logic.js';

export { h };
export const $ = (id) => document.getElementById(id);
// replaceChildren without the null/false placeholders that conditional rendering leaves.
export const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));

// The toast is a live region that stays in the page, so every message is announced.
// An optional action (for example "undo") keeps it up longer.
let toastTimer;
export function toast(msg, action = null) {
  const t = $('toast');
  fill(t, h('span', {}, msg), action ? h('button', {
    type: 'button', class: 'toast-act',
    onclick: () => { t.classList.remove('on'); action.run(); },
  }, action.label) : null);
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove('on'); fill(t); }, action ? 7000 : 4000);
}

export function errorText(err) {
  const msg = String(err?.message || err || '');
  if (/violates row-level security|permission denied/i.test(msg)) return 'אין הרשאה לפעולה. יש להתחבר מחדש עם משתמש צוות.';
  if (/relation .* does not exist|Could not find the table/i.test(msg)) return 'טבלאות הלקוחות עוד לא הוקמו במסד הנתונים.';
  return explainError(err);
}

// Person chip: always the name in text; the colour is only a secondary cue.
export const personChip = (key, extra = '') => h('span', { class: `pchip p-${key} ${extra}`.trim() }, PEOPLE[key]?.name || key);
export const peopleChips = (keys) => h('span', { class: 'pchips' }, ...keys.map((k) => personChip(k)));

// Staff are shown by their name in the protocol when known, else by their email's name part.
export const directory = {};
export const who = (email) => {
  if (!email) return '';
  const p = directory[String(email).toLowerCase()];
  return p && PEOPLE[p] ? PEOPLE[p].name : String(email).split('@')[0];
};

const dayFmt = new Intl.DateTimeFormat('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false });
const fullFmt = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' });

const isEndOfDay = (d) => d.getHours() === 23 && d.getMinutes() === 59;
export function formatWhen(d, now = new Date()) {
  if (!d) return '';
  const t = isEndOfDay(d) ? '' : ` ${timeFmt.format(d)}`;
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 864e5);
  if (days === 0) return `היום${t}`;
  if (days === 1) return `מחר${t}`;
  if (days === -1) return `אתמול${t}`;
  return `${dayFmt.format(d)}${t}`;
}
export const formatDay = (d) => (d ? fullFmt.format(new Date(d)) : '');
export const formatStamp = (v) => (v ? `${dayFmt.format(new Date(v))} ${timeFmt.format(new Date(v))}` : '');

// Late by minutes or hours within a day; beyond that in business days (weekends do not count).
export function lateBy(d, now = new Date()) {
  const mins = Math.round((now - d) / 6e4);
  if (mins < 60) return `${Math.max(mins, 1)} דק׳`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? 'שעה' : `${hours} שעות`;
  const days = businessDaysBetween(d, now);
  if (days <= 1) return 'יום עסקים';
  return `${days} ימי עסקים`;
}

export const STATUS_TEXT = {
  overdue: 'באיחור', today: 'להיום', open: 'פתוח', waiting: 'טרם התחיל', done: 'הושלם', due: 'לביצוע השבוע',
  client: 'ממתין ללקוח',
};

export function statusBadge(status, dueAt, now = new Date()) {
  const text = status === 'overdue' && dueAt ? `באיחור · ${lateBy(dueAt, now)}` : STATUS_TEXT[status];
  return h('span', { class: `sbadge s-${status}` }, h('span', { class: 'sicon', 'aria-hidden': 'true' }), text);
}

export function dueText(state, now = new Date()) {
  if (state.status === 'done') return '';
  if (state.dueAt) return `יעד: ${formatWhen(state.dueAt, now)}`;
  const from = state.proc.start?.from || '';
  if (/^p\d/.test(from) && !state.startAt) return `ממתין לסיום תהליך ${from.replace(/^p0?/, '').replace('b', 'ב')}`;
  if (state.proc.start && !state.startAt) return 'ממתין לתאריך';
  if (state.startAt && state.startAt > now) return `מתחיל: ${formatWhen(state.startAt, now)}`;
  return '';
}

export function progressBar(done, total, label) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return h('span', { class: 'pbar', role: 'img', 'aria-label': `${label}: ${done} מתוך ${total}` },
    h('span', { class: 'pbar-fill', style: `inline-size:${pct}%` }));
}

// Session bar + login form. Calls onReady(staff) once a staff member is signed in.
export function mountSession(onReady) {
  const setSession = (staff) => {
    $('session-dot').classList.toggle('on', !!staff?.isStaff);
    $('session-who').textContent = staff ? staff.email : 'לא מחובר';
    $('btn-logout').hidden = !staff;
  };
  async function boot() {
    let staff = null;
    try { staff = await currentStaff(); } catch { /* offline */ }
    setSession(staff);
    const ok = !!staff?.isStaff;
    $('login-block').hidden = ok;
    $('app').hidden = !ok;
    if (ok) return onReady(staff);
    if (staff && !staff.isStaff) {
      $('lg-err').textContent = 'המשתמש מחובר אך אינו מורשה. יש לבקש הרשאה ממנהל המערכת.';
      $('lg-err').hidden = false;
    }
    return null;
  }
  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('lg-submit').disabled = true;
    $('lg-err').hidden = true;
    $('lg-msg').hidden = true;
    const { error } = await supabase.auth.signInWithPassword({ email: $('lg-email').value.trim(), password: $('lg-pass').value });
    $('lg-submit').disabled = false;
    if (error) { $('lg-err').textContent = explainError(error); $('lg-err').hidden = false; return; }
    await boot();
  });
  $('lg-forgot').addEventListener('click', async (e) => {
    const email = $('lg-email').value.trim();
    $('lg-err').hidden = true;
    $('lg-msg').hidden = true;
    if (!looksLikeEmail(email)) { $('lg-err').textContent = RESET_NEEDS_EMAIL; $('lg-err').hidden = false; $('lg-email').focus(); return; }
    e.currentTarget.disabled = true;
    try { await sendPasswordReset(email); $('lg-msg').textContent = RESET_SENT; $('lg-msg').hidden = false; } catch (err) { $('lg-err').textContent = explainError(err); $('lg-err').hidden = false; }
    e.currentTarget.disabled = false;
  });
  $('btn-logout').addEventListener('click', async () => { await supabase.auth.signOut(); location.reload(); });
  return boot();
}

// Remembered per browser; the database copy (staff.person) wins when set.
export const store = {
  get(k) { try { return localStorage.getItem(`astrateg.${k}`); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(`astrateg.${k}`, v); } catch { /* private mode */ } },
};

// Agreement numbers for clients opened from a signed agreement: Map id -> { number, signed_at }.
export async function loadQuoteNumbers(ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Map();
  const { data, error } = await supabase.from('quotes').select('id, number, signed_at').in('id', list);
  if (error) throw error;
  return new Map(data.map((q) => [q.id, q]));
}
