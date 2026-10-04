// Shared view helpers for the client protocol pages: login, people, dates, statuses.
import {
  supabase, currentStaff, explainError, sendPasswordReset, looksLikeEmail, cleanEmail, RESET_NEEDS_EMAIL, RESET_SENT,
} from './supa.js';
import { h } from './quote-doc.js';
import { PEOPLE, PROCESSES, scopeOf } from './protocol.js';
import { businessDaysBetween, readWaited } from './protocol-logic.js';
import { TZ, partsIL, daysBetweenIL, dayFromKeyIL } from './tz.js';
import { landFromLink, LINK_EXPIRED, PASSWORD_SAVED } from './set-password.js';

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
  // Each person may change only the clients they work on (the database decides): a
  // client moved to someone else while the page was open is refused.
  if (/violates row-level security/i.test(msg)) return 'אין לך הרשאה לפעולה הזו. אם העבודה בלקוח הועברה למישהו אחר, רעננו את הדף.';
  if (/permission denied/i.test(msg)) return 'אין הרשאה לפעולה. יש להתחבר מחדש עם משתמש צוות.';
  // An update that reached no row: the row is gone, or no longer this person's to see.
  if (err?.code === 'PGRST116' || /Cannot coerce the result to a single JSON object/i.test(msg)) return 'הפעולה לא נשמרה: הלקוח או הפריט כבר לא זמינים לך. רעננו את הדף.';
  if (/relation .* does not exist|Could not find the table/i.test(msg)) return 'טבלאות הלקוחות עוד לא הוקמו במסד הנתונים.';
  if (/not allowed/i.test(msg)) return 'אין לך הרשאה לפעולה הזו.';
  if (/clients_quote_id_key/i.test(msg)) return 'מההסכם הזה כבר נפתח לקוח. הוא מופיע ברשימת הלקוחות.';
  if (/round numbers must be unique/i.test(msg)) return 'יש כבר סבב צילום עם המספר הזה. רעננו את הדף ונסו שוב.';
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

// Dates are shown in Israel time on every device (a phone abroad shows the office's clock).
const dayFmt = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const fullFmt = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, day: 'numeric', month: 'numeric', year: 'numeric' });

const isEndOfDay = (d) => { const p = partsIL(d); return p.hour === 23 && p.minute === 59; };
export function formatWhen(d, now = new Date()) {
  if (!d) return '';
  const t = isEndOfDay(d) ? '' : ` ${timeFmt.format(d)}`;
  const days = daysBetweenIL(now, d);
  if (days === 0) return `היום${t}`;
  if (days === 1) return `מחר${t}`;
  if (days === -1) return `אתמול${t}`;
  return `${dayFmt.format(d)}${t}`;
}
// A bare day ('2026-10-01': a recheck date, a contract end) is that Israel day.
export const formatDay = (d) => (d ? fullFmt.format(dayFromKeyIL(d) || new Date(d)) : '');
export const formatStamp = (v) => (v ? `${dayFmt.format(new Date(v))} ${timeFmt.format(new Date(v))}` : '');

// A length of office time: "40 דק׳", "2 ש׳", "3 ש׳ ו־15 דק׳".
export const officeMinutes = (min) => (min < 60 ? `${min} דק׳` : `${Math.floor(min / 60)} ש׳${min % 60 ? ` ו־${min % 60} דק׳` : ''}`);

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

// After a wait ends: whether it moved the deadline (a wait that began after the
// deadline does not). `before` and `after` are the notes of the `waited` mark.
export function endWaitText(before, after) {
  const a = readWaited(before);
  const b = readWaited(after);
  if (b.ext > a.ext) return 'ההמתנה הסתיימה. היעד הוארך בזמן ההמתנה.';
  if (b.min > a.min) return 'ההמתנה הסתיימה. היא התחילה אחרי היעד, ולכן היעד לא זז.';
  return 'ההמתנה הסתיימה.';
}

// Processes where the client is part of the work (access, approvals, corrections):
// "waiting on the client" is offered there even before they are late, and it is
// the only place an 'own' role marks a wait.
export const CLIENT_PROCS = new Set(['p05', 'p07', 'p11', 'p13', 'p23', 'p26', 'p27']);

export const STATUS_TEXT = {
  overdue: 'באיחור', today: 'להיום', open: 'פתוח', waiting: 'טרם התחיל', done: 'הושלם', due: 'לביצוע השבוע',
  client: 'ממתין ללקוח',
};

export function statusBadge(status, dueAt, now = new Date()) {
  const text = status === 'overdue' && dueAt ? `באיחור · ${lateBy(dueAt, now)}` : STATUS_TEXT[status];
  return h('span', { class: `sbadge s-${status}` }, h('span', { class: 'sicon', 'aria-hidden': 'true' }), text);
}

const numOf = (id) => PROCESSES.find((p) => p.id === id)?.num || id.replace(/^p0?/, '');
const itemLabel = (key) => PROCESSES.flatMap((p) => p.items).find((i) => i.key === key)?.label || key;
export function dueText(state, now = new Date()) {
  if (state.status === 'done') return '';
  // Waiting on the client moved the deadline on (office time); say by how much.
  if (state.dueAt && state.extended > 0) return `יעד: ${formatWhen(state.dueAt, now)} · הוארך ב־${officeMinutes(state.extended)} של המתנה ללקוח`;
  if (state.dueAt) return `יעד: ${formatWhen(state.dueAt, now)}`;
  const from = state.proc.start?.from || '';
  if (state.proc.start && !state.startAt) {
    // What it waits for: a process, or one item ("the editor was assigned"), or a date.
    const proc = /^(?:r\d+-)?(p\d+[a-z]?)$/.exec(from);
    if (proc) return `ממתין לסיום תהליך ${numOf(proc[1])}`;
    const item = /^item:(?:r\d+\.)?((p\d+[a-z]?)\..+)$/.exec(from);
    if (item) return `ממתין ל: ${itemLabel(item[1])} (תהליך ${numOf(item[2])})`;
    return 'ממתין לתאריך';
  }
  if (state.startAt && state.startAt > now) return `מתחיל: ${formatWhen(state.startAt, now)}`;
  return '';
}

export function progressBar(done, total, label) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return h('span', { class: 'pbar', role: 'img', 'aria-label': `${label}: ${done} מתוך ${total}` },
    h('span', { class: 'pbar-fill', style: `inline-size:${pct}%` }));
}

// Whether this tab had not shown any page of the app before this one (a new tab,
// the installed app starting): the first screens land only then (app/office-ui.js).
const TAB_SEEN = 'astrateg.tabSeen';
export const TAB_FRESH = (() => { try { return !sessionStorage.getItem(TAB_SEEN); } catch { return true; } })();
const markTabSeen = () => { try { sessionStorage.setItem(TAB_SEEN, '1'); } catch { /* no storage */ } };
// Landed on the first screen in this tab (app/office-ui.js firstScreenOf): set by
// clients.html when it sends the person there, and by the first screens themselves.
// Without storage: as landed, so the list is never left behind by itself.
const LANDED = 'astrateg.firstLanded';
export function markFirstLanded() { try { sessionStorage.setItem(LANDED, '1'); } catch { /* no storage */ } }
export function firstLanded() { try { return sessionStorage.getItem(LANDED) === '1'; } catch { return true; } }

// Session bar + login form. Calls onReady(staff) once a staff member is signed in.
// A personal sign-in link in the address bar first asks for a password (set-password.js).
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
    if (ok) {
      markTabSeen();
      // Stage 4: the one-time WhatsApp consent screen, only when the owner turned WhatsApp on (app/whatsapp.js).
      import('./whatsapp.js').then((m) => m.promptWhatsapp()).catch(() => {});
      // The managers' switch, "המשימות שלי" / "מבט מנהל", at the top of every page (app/manager-ui.js).
      import('./manager-ui.js').then((m) => m.mountModeSwitch(staff.email)).catch(() => {});
      return onReady(staff);
    }
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
    const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail($('lg-email').value), password: $('lg-pass').value });
    $('lg-submit').disabled = false;
    if (error) { $('lg-err').textContent = explainError(error); $('lg-err').hidden = false; return; }
    await boot();
  });
  $('lg-forgot').addEventListener('click', async (e) => {
    const email = cleanEmail($('lg-email').value);
    $('lg-err').hidden = true;
    $('lg-msg').hidden = true;
    if (!looksLikeEmail(email)) { $('lg-err').textContent = RESET_NEEDS_EMAIL; $('lg-err').hidden = false; $('lg-email').focus(); return; }
    e.currentTarget.disabled = true;
    try { await sendPasswordReset(email); $('lg-msg').textContent = RESET_SENT; $('lg-msg').hidden = false; } catch (err) { $('lg-err').textContent = explainError(err); $('lg-err').hidden = false; }
    e.currentTarget.disabled = false;
  });
  $('btn-logout').addEventListener('click', async () => { await supabase.auth.signOut(); location.reload(); });
  // Opened from a personal sign-in link (team.html): choose a password first.
  return (async () => {
    const landed = await landFromLink();
    if (landed === 'password') toast(PASSWORD_SAVED);
    const result = await boot();
    if (landed === 'expired') {
      if ($('login-block').hidden) toast(LINK_EXPIRED);
      else { $('lg-err').textContent = LINK_EXPIRED; $('lg-err').hidden = false; }
    }
    return result;
  })();
}

// Who is signed in, from the database (staff.person), and what they see (SCOPE in
// protocol.js). The owner's row has no person and sees the office. This shapes the
// screens only: what anyone may read or change is decided by the database.
// If the lookup fails, nothing is assumed: the screens show only a notice.
export async function viewerOf(email) {
  const { data, error } = await supabase.from('staff').select('person').eq('email', String(email || '').toLowerCase()).maybeSingle();
  if (error) return { me: null, scope: 'own', error };
  const person = data?.person || null;
  return { me: person && person !== 'editor' && PEOPLE[person] ? person : null, scope: scopeOf(person), error: null };
}
export const VIEWER_UNKNOWN = 'לא הצלחנו לזהות את המשתמש שלך בפרוטוקול. רעננו את הדף; אם זה חוזר, פנו למנהל המערכת.';

// Per-browser conveniences only (never who the user is).
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

// ── Tasks: urgent flag, escalations to Lior, briefs ──
// (Import declarations are hoisted, so this one works from the end of the module.)
import { BRIEF_FIELDS } from './protocol.js';

export const isEscalation = (t) => t?.source === 'escalation';
// Urgent is the task's own flag only (the card sorts by it too); an escalation is urgent only when marked so.
export const isUrgentTask = (t) => !!t?.urgent;
export const hasBrief = (t) => !!t?.brief && BRIEF_FIELDS.some(([k]) => String(t.brief[k] ?? '').trim());

// Where a task came from, for a short neutral label ('escalation' has its own badge).
export const TASK_SOURCES = {
  p31: 'משיחה שבועית', p33: 'מהבקרה', status: 'מסיכום מצב', pause: 'עריכה הושהתה', followup: 'בדיקה אחרי שיחה',
};

// "Urgent" and "reported exception": text and icon, never colour alone. Null for an ordinary task.
export function taskBadge(t) {
  const badge = (cls, text) => h('span', { class: `sbadge ${cls}` }, h('span', { class: 'sicon', 'aria-hidden': 'true' }), text);
  const list = [isUrgentTask(t) ? badge('s-urgent', 'דחוף') : null, isEscalation(t) ? badge('s-escalation', 'חריגה שדווחה') : null].filter(Boolean);
  return list.length ? list : null;
}

// The brief of a task (what exactly to fix), folded under the task.
export function briefDetails(t, open = false) {
  if (!hasBrief(t)) return null;
  return h('details', { class: 'brief', open },
    h('summary', {}, 'בריף למשימה'),
    h('dl', { class: 'brief-list' }, ...BRIEF_FIELDS.filter(([k]) => String(t.brief[k] ?? '').trim())
      .flatMap(([k, label]) => [h('dt', {}, label), h('dd', {}, String(t.brief[k]).trim())])));
}
