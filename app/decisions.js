// Lior's first screen, "החלטות" (decisions.html; system-plan section 3, "ליאור"):
//  - the exceptions reported to him, each on a fixed path: reason → decision →
//    next action with an owner and a due date (opened as a linked task) → close;
//  - urgent tasks: "התחלתי" within 30 office minutes or back with him (decision 9);
//  - broken logins, closed as "תוקן" or "תוקן חלקית, עדיין חסר: ___" (partial keeps
//    the network red in the vault; Irit and Ilai are told by the reminder engine);
//  - editing still paused the next morning: move the deadlines or reassign, with
//    Ofir's proposal by load;
//  - the weekly campaign check on Tuesday (decision 21), as a recurring item;
//  - the non-urgent escalations of his 12:00 and 16:00 lists, computed by the
//    reminder engine itself (app/reminder-engine.js), so the screen and the lists agree;
//  - Ofir's change requests.
// The logic: app/decisions-logic.js.
import { PEOPLE, STAFF_PEOPLE, BRIEF_REQUIRED, NETWORKS } from './protocol.js';
import { clientState, addBusinessDays, businessDaysBetween, PAUSE, weekKey } from './protocol-logic.js';
import {
  loadClients, loadChecks, loadTasks, setCheck, clearCheck, addTask, setTaskDone, updateClient, loadDirectory, loadReviews, markReview,
  loadStatusNotes, saveAccess,
} from './protocol-data.js';
import {
  $, fill, h, toast, errorText, personChip, formatDay, formatStamp, mountSession, directory, viewerOf, who, taskBadge, briefDetails,
} from './protocol-ui.js';
import {
  urgentState, parseReport, exceptionPath, PATH, decisionRow, linkedTitle, pausedSinceYesterday, decisionNote, withEditor, campaignCheck,
} from './decisions-logic.js';
import { editorLoad, proposeEditor, loadText, eligibleEditors } from './qa-logic.js';
import { SHIFT_KEY, shiftNote, readShift, DECISION_KEY, accessFixedKey, accessFixNote, readAccessFix, readJson } from './office-marks.js';
import { buildEnv, candidates, liorShoot } from './reminder-engine.js';
import { loadDecisions, saveDecision, loadChangeRequests, decideChangeRequest, loadAccessRows, updateTask } from './office-data.js';
import { refreshQuestions } from './questions-ui.js';
import { officeLinks, markFirstLanded, startControl } from './office-ui.js';
import { dayKeyIL, TZ } from './tz.js';

let viewer = null;
let me = null;
let clients = [];
let checks = {};
let tasks = [];
let decisions = null;   // task_decisions (null: the table is not there yet)
let requests = null;
let access = null;      // logins (null: no vault for this user)
let reviews = [];
let statusNotes = [];
let lastLoad = 0;
const states = new Map();
const stateOf = (c) => {
  if (!states.has(c.id)) states.set(c.id, clientState(c, checks[c.id] || {}, new Date()));
  return states.get(c.id);
};
const live = (c) => c.status === 'active' || c.status === 'ending';
const clientOf = (id) => clients.find((c) => c.id === id) || null;
const clientUrl = (id, hash = '') => `client.html?id=${encodeURIComponent(id)}${hash ? `#${hash}` : ''}`;
const hmFmt = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const hm = (d) => hmFmt.format(new Date(d));
// The vault's own names, as the card's task titles use them ("הגישה ל־Instagram").
const NETWORK = Object.fromEntries(NETWORKS);
const staffOptions = (sel = null) => [
  h('option', { value: '' }, 'בחירה'),
  h('optgroup', { label: 'צוות' }, ...STAFF_PEOPLE().filter((p) => !p.editor).map((p) => h('option', { value: p.key, selected: sel === p.key }, p.name))),
  h('optgroup', { label: 'עורכים' }, ...STAFF_PEOPLE().filter((p) => p.editor).map((p) => h('option', { value: p.key, selected: sel === p.key }, p.name))),
];

// ── Data ────────────────────────────────────
let inflight = null;
function load() {
  inflight ||= doLoad().finally(() => { inflight = null; });
  return inflight;
}
async function doLoad() {
  if (!clients.length) $('state').textContent = 'טוען…';
  const now = new Date();
  try {
    [clients, checks, tasks] = await Promise.all([loadClients(), loadChecks(), loadTasks({ openOnly: true })]);
  } catch (err) {
    $('state').textContent = errorText(err);
    return;
  }
  const got = await Promise.allSettled([
    loadDecisions(), loadChangeRequests(), loadAccessRows(), loadReviews(dayKeyIL(new Date(now.getTime() - 14 * 864e5))),
    loadStatusNotes({ sinceWeek: weekKey(now) }),
  ]);
  const ok = (i) => (got[i].status === 'fulfilled' ? got[i].value : null);
  decisions = ok(0);
  requests = ok(1);
  access = ok(2);
  reviews = ok(3) || [];
  statusNotes = ok(4) || [];
  states.clear();
  lastLoad = Date.now();
  $('state').textContent = '';
  renderKeepingState();
  refreshQuestions($('my-questions'), me, clients);
}

// Re-rendering keeps focus, the scroll, the forms that were open and what was typed.
function renderKeepingState() {
  const focusId = document.activeElement?.id;
  const y = window.scrollY;
  const open = [...document.querySelectorAll('#dc-page details[open]')].map((d) => d.id).filter(Boolean);
  const typed = [...document.querySelectorAll('#dc-page [data-dirty]')].map((el) => [el.id, el.value]);
  render();
  for (const id of open) { const d = document.getElementById(id); if (d) d.open = true; }
  for (const [id, v] of typed) { const el = document.getElementById(id); if (el) { el.value = v; el.dataset.dirty = '1'; } }
  window.scrollTo({ top: y });
  if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
}
document.addEventListener('input', (e) => { if (e.target.closest?.('#dc-page') && e.target.id) e.target.dataset.dirty = '1'; });
const clean = (root) => { for (const el of root.querySelectorAll('[data-dirty]')) delete el.dataset.dirty; };

// ── Render ──────────────────────────────────
function render() {
  const now = new Date();
  states.clear();
  const exceptions = tasks.filter((t) => t.source === 'escalation' && !t.done_at && clientOf(t.client_id) && live(clientOf(t.client_id)))
    .sort((a, b) => (b.urgent - a.urgent) || (new Date(a.created_at) - new Date(b.created_at)));
  const urgent = tasks.filter((t) => t.urgent && t.source !== 'escalation' && !t.done_at && clientOf(t.client_id) && live(clientOf(t.client_id)))
    .map((t) => ({ t, u: urgentState(t, now) })).sort((a, b) => (b.u.returned - a.u.returned) || (a.u.deadline - b.u.deadline));
  const broken = (access || []).filter((a) => a.status === 'broken' && clientOf(a.client_id) && live(clientOf(a.client_id)));
  const paused = pausedSinceYesterday({ clients, stateOf, checks, now });
  const cc = campaignCheck(reviews, now);
  const list = listItems(now);
  const openReq = (requests || []).filter((r) => !r.decided_at);
  const env = { now, clients: clients.filter(live), checksOf: (c) => checks[c.id] || {}, stateOf };
  const shoot = liorShoot(env);
  fill($('dc-banners'),
    shoot.active ? h('p', { class: 'of-banner is-warn', role: 'status' }, h('strong', {}, me === 'lior' ? 'אתה ביום צילום.' : 'ליאור ביום צילום.'),
      ' עד מסירת הכונן החריגות עוברות לאופיר, ושאר ההודעות מחכות לסיכום אחרי היום (החלטה 8).') : null,
    decisions === null ? h('p', { class: 'of-banner is-warn', role: 'status' }, 'שמירת ההחלטות עוד לא זמינה במסד הנתונים (מיגרציה 20260930150000). אפשר לסגור חריגות, בלי המסלול.') : null);
  fill($('dc-jump'), h('ul', { class: 'chips-row' },
    ...[['ex-h', 'חריגות', exceptions.length], ['ur-h', 'דחוף', urgent.length], access !== null ? ['ac-h', 'גישות', broken.length] : null, ['pz-h', 'עריכה עצורה', paused.length],
      cc.show ? ['cp-h', 'קמפיינים', cc.done ? 0 : 1] : null, ['ls-h', 'רשימות', list.length], ['cq-h', 'בקשות שינוי', openReq.length]].filter(Boolean)
      .map(([id, label, n]) => h('li', {}, h('button', {
        type: 'button', class: 'chip', onclick: () => { const el = $(id); el.scrollIntoView({ block: 'start' }); el.focus({ preventScroll: true }); },
      }, label, h('span', { class: 'n' }, String(n)))))));
  $('ex-n').textContent = String(exceptions.length);
  fill($('ex-list'), ...(exceptions.length ? exceptions.map((t) => exceptionCard(t, now)) : [h('li', { class: 'empty' }, 'אין חריגות פתוחות.')]));
  $('ur-n').textContent = String(urgent.length);
  fill($('ur-list'), ...(urgent.length ? urgent.map((x) => urgentCard(x, now)) : [h('li', { class: 'empty' }, 'אין משימות דחופות פתוחות.')]));
  $('ac-sec').hidden = access === null;
  $('ac-n').textContent = String(broken.length);
  fill($('ac-list'), ...(broken.length ? broken.map((a) => accessCard(a, now)) : [h('li', { class: 'empty' }, 'אין גישות שבורות.')]));
  $('pz-n').textContent = String(paused.length);
  const load = editorLoad({ clients, stateOf, checks, tasks, now });
  fill($('pz-list'), ...(paused.length ? paused.map((p) => pausedCard(p, load, now)) : [h('li', { class: 'empty' }, 'אין עריכה שעצורה מאתמול.')]));
  $('cp-sec').hidden = !cc.show;
  if (cc.show) renderCampaigns(cc, now);
  $('ls-n').textContent = String(list.length);
  fill($('ls-list'), ...(list.length ? list.map((r) => h('li', { class: 'of-card' },
    h('div', { class: 'of-head' }, h('a', { class: 'wclient', href: r.url }, r.title), r.overdue ? h('span', { class: 'sbadge s-overdue' }, h('span', { class: 'sicon', 'aria-hidden': 'true' }), 'באיחור') : null),
    r.body ? h('p', { class: 'of-line' }, r.body) : null)) : [h('li', { class: 'empty' }, 'אין כרגע הסלמות ברשימות.')]));
  $('cq-n').textContent = String(openReq.length);
  fill($('cq-list'), ...(requests === null ? [h('li', { class: 'empty' }, 'בקשות השינוי עוד לא זמינות במסד הנתונים.')]
    : openReq.length ? openReq.map((r) => requestCard(r)) : [h('li', { class: 'empty' }, 'אין בקשות שינוי פתוחות.')]));
}

// The engine's own list items for Lior (his 12:00 and 16:00 lists), still true now.
// Exceptions and paused editing have their own sections above.
function listItems(now) {
  const staff = Object.entries(directory).map(([email, person]) => ({ email, person }));
  const env = buildEnv({ clients, checks, tasks, staff, access: (access || []).filter((a) => a.status === 'broken'), reviews, statusNotes, now });
  const seen = new Set();
  return candidates(env).filter((r) => r.person === 'lior' && r.list && !['exception', 'paused'].includes(r.rule))
    .sort((a, b) => a.at - b.at)
    .filter((r) => { const k = `${r.rule}:${r.clientId}:${r.title}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

// ── Exceptions: the fixed path ──────────────
function exceptionCard(t, now) {
  const c = clientOf(t.client_id);
  const d = (decisions || []).find((x) => x.task_id === t.id) || null;
  const path = exceptionPath(t, d);
  const rep = parseReport(t.title);
  const next = d?.next_task_id ? tasks.find((x) => x.id === d.next_task_id) : null;
  const id = `ex-${t.id}`;
  return h('li', { class: `of-card dc-card${t.urgent ? ' is-late' : ''}`, id: `${id}-card` },
    h('div', { class: 'of-head' },
      h('a', { class: 'wclient', href: clientUrl(c.id, 'tasks') }, c.name), taskBadge(t),
      rep.reason ? h('span', { class: 'wtitle' }, rep.reason) : null),
    h('p', { class: 'dc-report' }, rep.details || t.title),
    h('p', { class: 'of-line muted' }, `${rep.proc ? `${rep.proc} · ` : ''}דווח ע״י ${who(t.created_by_email) || '—'} · ${formatStamp(t.created_at)}`),
    t.urgent ? startControl(t, me, () => renderKeepingState()) : null,
    h('ol', { class: 'dc-path', 'aria-label': 'המסלול' }, ...PATH.map(([k, label]) => h('li', {
      class: path.done[k] ? 'is-done' : path.step === k ? 'is-now' : '', 'aria-current': path.step === k ? 'step' : null,
    }, `${label}${path.done[k] ? ' ✓' : ''}`))),
    next ? h('p', { class: 'of-line' }, 'פעולה הבאה: ', h('strong', {}, next.title), ' · ', personChip(next.owner), next.due_on ? ` · עד ${formatDay(next.due_on)}` : '') : null,
    h('details', { class: 'ps-sum', id: `${id}-d` },
      h('summary', { id: `${id}-s` }, h('span', { class: 'btn btn-sm' }, path.ready ? 'לסגירה' : 'טיפול בחריגה')),
      exceptionForm(t, d, path, rep, id)));
}
function exceptionForm(t, d, path, rep, id) {
  const disabledNext = !!d?.next_task_id;
  return h('form', { class: 'dc-form', novalidate: true, onsubmit: (e) => { e.preventDefault(); stepException(t, id, e.submitter?.value || 'save'); } },
    h('div', { class: 'field' }, h('label', { for: `${id}-reason` }, '1. סיבה: מה קרה ולמה'),
      h('textarea', { class: 'input', id: `${id}-reason`, rows: '2', maxlength: '1000' }, d?.reason || rep.details || '')),
    h('div', { class: 'field' }, h('label', { for: `${id}-decision` }, '2. החלטה'),
      h('textarea', { class: 'input', id: `${id}-decision`, rows: '2', maxlength: '1000' }, d?.decision || '')),
    disabledNext ? h('p', { class: 'of-line' }, '3. פעולה הבאה: נפתחה משימה מקושרת.') : [
      h('div', { class: 'field' }, h('label', { for: `${id}-next` }, '3. פעולה הבאה'),
        h('input', { class: 'input', id: `${id}-next`, maxlength: '400', autocomplete: 'off' })),
      h('div', { class: 'row3' },
        h('div', { class: 'field' }, h('label', { for: `${id}-owner` }, 'אחראי'), h('select', { class: 'input', id: `${id}-owner` }, ...staffOptions(null))),
        h('div', { class: 'field' }, h('label', { for: `${id}-due` }, 'מועד'), h('input', { class: 'input', id: `${id}-due`, type: 'date', dir: 'ltr', value: dayKeyIL(addBusinessDays(new Date(), 1)) })),
        h('label', { class: 'wrow', for: `${id}-urgent` }, h('input', { type: 'checkbox', class: 'cbx', id: `${id}-urgent` }), h('span', { class: 'wlabel' }, 'דחוף'))),
    ],
    h('p', { class: 'err', id: `${id}-err`, role: 'alert', hidden: true }),
    h('div', { class: 'of-acts' },
      h('button', { type: 'submit', class: 'btn btn-sm', value: 'save', id: `${id}-save` }, 'שמירה'),
      h('button', { type: 'submit', class: 'btn btn-sm btn-primary', value: 'close', id: `${id}-close` }, disabledNext ? '4. סגירת החריגה' : 'פתיחת המשימה וסגירה')));
}
async function stepException(t, id, action) {
  const err = $(`${id}-err`);
  const fail = (text, focus) => { err.textContent = text; err.hidden = false; if (focus) $(focus).focus(); };
  err.hidden = true;
  const reason = $(`${id}-reason`).value.trim();
  const decision = $(`${id}-decision`).value.trim();
  const d0 = (decisions || []).find((x) => x.task_id === t.id) || null;
  const nextEl = $(`${id}-next`);
  const next = nextEl ? nextEl.value.trim() : '';
  const owner = nextEl ? $(`${id}-owner`).value : '';
  const due = nextEl ? $(`${id}-due`).value : '';
  if (action === 'close') {
    if (!reason) return fail('קודם הסיבה: מה קרה ולמה.', `${id}-reason`);
    if (!decision) return fail('ואז ההחלטה, בקצרה.', `${id}-decision`);
    if (!d0?.next_task_id) {
      if (!next) return fail('מה הפעולה הבאה? היא נפתחת כמשימה עם אחראי ומועד.', `${id}-next`);
      if (!owner) return fail('למי הפעולה הבאה?', `${id}-owner`);
      if (!due) return fail('עד מתי?', `${id}-due`);
      if (BRIEF_REQUIRED.has(owner)) return fail(`משימה ל${PEOPLE[owner].name} צריכה בריף מלא: פותחים אותה בכרטיס הלקוח, ואז חוזרים לסגור.`, `${id}-owner`);
    }
  } else if (!reason && !decision) return fail('אין מה לשמור עדיין.', `${id}-reason`);
  for (const b of $(`${id}-d`).querySelectorAll('button')) b.disabled = true;
  try {
    let nextId = d0?.next_task_id || null;
    if (action === 'close' && !nextId) {
      const nt = await addTask({ client_id: t.client_id, title: linkedTitle(next, t), owner, due_on: due, urgent: $(`${id}-urgent`).checked });
      tasks = [nt, ...tasks];
      nextId = nt.id;
    }
    if (decisions !== null) {
      const row = await saveDecision(decisionRow(t, { reason, decision, nextTaskId: nextId }));
      decisions = [row, ...decisions.filter((x) => x.task_id !== t.id)];
    }
    if (action === 'close') {
      const done = await setTaskDone(t.id, true);
      tasks = tasks.map((x) => (x.id === t.id ? done : x));
    }
  } catch (e) {
    for (const b of $(`${id}-d`).querySelectorAll('button')) b.disabled = false;
    return fail(`לא נשמר. ${errorText(e)}`);
  }
  clean($(`${id}-card`));
  renderKeepingState();
  if (action === 'close') {
    toast(`החריגה נסגרה. הפעולה הבאה אצל ${PEOPLE[owner]?.name || 'האחראי'}.`);
    ($('ex-list').querySelector('summary') || $('ex-h')).focus();
  } else toast('נשמר.');
}

// ── Urgent tasks ────────────────────────────
function urgentCard({ t, u }, now) {
  const c = clientOf(t.client_id);
  const id = `ur-${t.id}`;
  return h('li', { class: `of-card${u.returned ? ' is-late' : ''}` },
    h('div', { class: 'of-head' }, h('a', { class: 'wclient', href: clientUrl(c.id, 'tasks') }, c.name), personChip(t.owner), taskBadge(t),
      u.returned ? h('span', { class: 'sbadge s-overdue' }, h('span', { class: 'sicon', 'aria-hidden': 'true' }), 'חזרה אליך') : null),
    h('p', { class: 'of-line' }, t.title),
    h('p', { class: 'of-line muted' }, u.started ? `התחיל/ה ${formatStamp(u.startedAt)}` : u.returned ? `לא נלחץ ״התחלתי״ עד ${hm(u.deadline)}` : `״התחלתי״ עד ${hm(u.deadline)}`),
    briefDetails(t),
    startControl(t, me, () => renderKeepingState()),
    u.returned && t.owner !== me ? h('div', { class: 'dc-inline' },
      h('div', { class: 'field' }, h('label', { for: `${id}-to` }, 'להעביר ל'), h('select', { class: 'input', id: `${id}-to` }, ...staffOptions(null))),
      h('button', { type: 'button', class: 'btn btn-sm', id: `${id}-move`, onclick: (e) => moveTask(t, $(`${id}-to`).value, e.currentTarget) }, 'העברה')) : null);
}
async function moveTask(t, owner, btn) {
  if (!owner) { toast('בחרו למי להעביר.'); return; }
  if (BRIEF_REQUIRED.has(owner)) { toast(`משימה ל${PEOPLE[owner].name} צריכה בריף: מעבירים בכרטיס הלקוח.`); return; }
  btn.disabled = true;
  try {
    const row = await updateTask(t.id, { owner });
    tasks = tasks.map((x) => (x.id === t.id ? row : x));
  } catch (e) { btn.disabled = false; toast(`לא הועבר. ${errorText(e)}`); return; }
  renderKeepingState();
  toast(`המשימה הועברה ל${PEOPLE[owner].name}. היא מקבלת אותה עכשיו עם ״התחלתי״.`);
}

// ── Broken logins ───────────────────────────
function accessCard(a, now) {
  const c = clientOf(a.client_id);
  const id = `ac-${a.id}`;
  // Closed as partly fixed since its last change: it stays red, with what is missing.
  const fix = readAccessFix(checks[c.id]?.[accessFixedKey(a.network)]);
  const partial = fix?.partial && fix.at >= new Date(new Date(a.updated_at).getTime() - 5 * 6e4) ? fix : null;
  return h('li', { class: 'of-card is-late' },
    h('div', { class: 'of-head' }, h('a', { class: 'wclient', href: clientUrl(c.id, 'access') }, c.name), h('span', { class: 'wtitle' }, NETWORK[a.network] || a.network)),
    h('p', { class: 'of-line' }, partial ? [h('span', { class: 'tag tag-warn' }, 'תוקן חלקית'), ` עדיין חסר: ${partial.missing} · ${formatStamp(partial.at)}`] : `לא עובדת מאז ${formatStamp(a.updated_at)}${a.note ? ` · ${a.note}` : ''}`),
    h('div', { class: 'of-acts' },
      h('button', { type: 'button', class: 'btn btn-sm', id: `${id}-ok`, onclick: (e) => closeAccess(a, false, '', e.currentTarget) }, 'תוקן')),
    h('div', { class: 'dc-inline' },
      h('div', { class: 'field' }, h('label', { for: `${id}-missing` }, partial ? 'עדיין חסר (עדכון):' : 'תוקן חלקית, עדיין חסר:'), h('input', { class: 'input', id: `${id}-missing`, maxlength: '300', autocomplete: 'off' })),
      h('button', {
        type: 'button', class: 'btn btn-sm', id: `${id}-part`,
        onclick: (e) => { const m = $(`${id}-missing`).value.trim(); if (!m) { toast('כתבו מה עדיין חסר.'); $(`${id}-missing`).focus(); return; } closeAccess(a, true, m, e.currentTarget); },
      }, 'תוקן חלקית')));
}
async function closeAccess(a, partial, missing, btn) {
  btn.disabled = true;
  const c = clientOf(a.client_id);
  try {
    await saveAccess(a.client_id, {
      id: a.id, network: a.network, label: a.label, username: a.username, password: null,
      status: partial ? 'broken' : 'ok', note: partial ? `תוקן חלקית, עדיין חסר: ${missing}` : null,
    });
    const row = await setCheck(a.client_id, accessFixedKey(a.network), 'done', accessFixNote({ partial, missing, access: a.id }));
    (checks[a.client_id] ||= {})[row.item_key] = row;
    // Lior's task to restore it closes with it.
    const net = NETWORK[a.network] || a.network;
    for (const t of tasks.filter((x) => x.client_id === a.client_id && !x.done_at && x.owner === 'lior' && x.title.includes(`הגישה ל־${net}`))) {
      const done = await setTaskDone(t.id, true);
      tasks = tasks.map((x) => (x.id === t.id ? done : x));
    }
    access = await loadAccessRows();
  } catch (e) { btn.disabled = false; toast(`לא נשמר. ${errorText(e)}`); return; }
  renderKeepingState();
  toast(partial ? `נשמר כתוקן חלקית. הרשת נשארת אדומה בכספת; עירית ועילאי מקבלים עדכון.` : `הגישה של ${c.name} תקינה. עירית ועילאי מקבלים עדכון.`);
  $('ac-h').focus();
}

// ── Editing still paused ────────────────────
function pausedCard(p, load, now) {
  const c = p.client;
  const id = `pz-${c.id}-${p.pre.replace(/\W/g, '') || 'b'}`;
  const type = p.ctx.shoot_type;
  const proposal = proposeEditor(load, type, [p.editor].filter(Boolean));
  const decided = readJson(checks[c.id]?.[DECISION_KEY(p.pre)]);
  const shift = readShift(checks[c.id]?.[SHIFT_KEY(p.pre)]);
  // The suggestion: the business days paused so far, less what was already moved.
  const days = Math.max(1, businessDaysBetween(new Date(p.pause.at), now) - shift);
  return h('li', { class: 'of-card' },
    h('div', { class: 'of-head' }, h('a', { class: 'wclient', href: clientUrl(c.id, p.state.proc.id) }, c.name), p.n ? h('span', { class: 'wtitle' }, `סבב ${p.n}`) : null,
      p.editor ? personChip(p.editor) : null, h('span', { class: 'tag tag-warn' }, 'עצורה')),
    h('p', { class: 'of-line' }, `עצורה מאז ${formatStamp(p.pause.at)}${p.pause.stage ? ` · שלב: ${p.pause.stage}` : ''}${p.pause.left ? ` · נשאר: ${p.pause.left}` : ''}${p.pause.why ? ` · ${p.pause.why}` : ''}`),
    proposal ? h('p', { class: 'of-line' }, h('strong', {}, 'הצעת אופיר לפי העומס: '), `${PEOPLE[proposal].name} (${loadText(load[proposal])})`) : null,
    p.decidedToday ? h('p', { class: 'ps-seen' }, decided?.choice === 'reassign' ? `הוחלט היום: הועבר ל${PEOPLE[decided.editor]?.name}` : `הוחלט היום: המועדים הוזזו ב־${decided?.days || shift} ימי עסקים`) : null,
    h('form', { class: 'dc-form', novalidate: true, onsubmit: (e) => { e.preventDefault(); decidePaused(p, id, proposal); } },
      h('fieldset', { class: 'dc-choice' }, h('legend', { class: 'sr-only' }, 'ההחלטה'),
        h('div', { class: 'dc-inline' },
          h('label', { class: 'wrow', for: `${id}-move` }, h('input', { type: 'radio', class: 'radio', name: `${id}-c`, id: `${id}-move`, value: 'move', checked: true }), h('span', { class: 'wlabel' }, 'להזיז את המועדים ב־')),
          h('div', { class: 'field' }, h('label', { for: `${id}-days`, class: 'sr-only' }, 'ימי עסקים'), h('input', { class: 'input', id: `${id}-days`, type: 'number', min: '1', max: '10', value: String(days), inputmode: 'numeric', dir: 'ltr' })),
          h('span', {}, 'ימי עסקים')),
        h('div', { class: 'dc-inline' },
          h('label', { class: 'wrow', for: `${id}-re` }, h('input', { type: 'radio', class: 'radio', name: `${id}-c`, id: `${id}-re`, value: 'reassign' }), h('span', { class: 'wlabel' }, 'להעביר ל')),
          h('div', { class: 'field' }, h('label', { for: `${id}-to`, class: 'sr-only' }, 'העורך החדש'),
            h('select', { class: 'input', id: `${id}-to` }, ...eligibleEditors(type).filter((e) => e !== p.editor).map((e) => h('option', { value: e, selected: e === proposal }, `${PEOPLE[e].name}${e === proposal ? ' (ההצעה)' : ''}`)))))),
      h('p', { class: 'err', id: `${id}-err`, role: 'alert', hidden: true }),
      h('div', { class: 'of-acts' }, h('button', { type: 'submit', class: 'btn btn-sm btn-primary', id: `${id}-go` }, 'החלטה'))));
}
async function decidePaused(p, id, proposal) {
  const c = p.client;
  const choice = document.querySelector(`input[name="${id}-c"]:checked`)?.value;
  const err = $(`${id}-err`);
  $(`${id}-go`).disabled = true;
  try {
    if (choice === 'move') {
      const days = Number($(`${id}-days`).value);
      if (!Number.isInteger(days) || days < 1 || days > 10) { err.textContent = 'בחרו בין 1 ל־10 ימי עסקים.'; err.hidden = false; $(`${id}-go`).disabled = false; $(`${id}-days`).focus(); return; }
      const total = readShift(checks[c.id]?.[SHIFT_KEY(p.pre)]) + days;
      (checks[c.id] ||= {})[SHIFT_KEY(p.pre)] = await setCheck(c.id, SHIFT_KEY(p.pre), 'done', shiftNote(total, 'עריכה עצורה'));
      checks[c.id][DECISION_KEY(p.pre)] = await setCheck(c.id, DECISION_KEY(p.pre), 'done', decisionNote({ choice, days, proposal }));
      toast(`המועדים של ${c.name} הוזזו ב־${days} ימי עסקים. העורך רואה את המועדים החדשים.`);
    } else {
      const editor = $(`${id}-to`).value;
      const updated = await updateClient(c.id, withEditor(c, p.n, editor));
      clients = clients.map((x) => (x.id === c.id ? updated : x));
      (checks[c.id] ||= {})[DECISION_KEY(p.pre)] = await setCheck(c.id, DECISION_KEY(p.pre), 'done', decisionNote({ choice, editor, proposal }));
      // The new editor starts: the pause of the one before ends, and its tasks close.
      await clearCheck(c.id, PAUSE(p.state.proc));
      delete checks[c.id][PAUSE(p.state.proc)];
      for (const t of tasks.filter((x) => x.client_id === c.id && x.source === 'pause' && !x.done_at)) {
        try { const done = await setTaskDone(t.id, true); tasks = tasks.map((x) => (x.id === t.id ? done : x)); } catch { /* the owners close them */ }
      }
      toast(`העריכה של ${c.name} הועברה ל${PEOPLE[editor].name}. ${PEOPLE[editor].name} מקבל/ת הודעה על לקוח חדש בעריכה.`);
    }
  } catch (e) {
    err.textContent = `לא נשמר. ${errorText(e)}`;
    err.hidden = false;
    $(`${id}-go`).disabled = false;
    return;
  }
  states.clear();
  renderKeepingState();
  $('pz-h').focus();
}

// ── The weekly campaign check (Tuesday) ─────
function renderCampaigns(cc, now) {
  const liveCampaigns = clients.filter(live).filter((c) => stateOf(c).states.find((s) => s.proc.id === 'p30')?.complete);
  fill($('cp-body'),
    h('p', { class: 'of-line' }, cc.done ? `בוצעה השבוע · ${who(cc.done.by_email)} · ${formatStamp(cc.done.at)}` : cc.late ? 'היום המוצע היה שלישי. עוד לא בוצעה השבוע.' : 'היום: ביצועים, לידים, עלויות וקריאייטיבים, לפני השיחות השבועיות.'),
    liveCampaigns.length ? h('ul', { class: 'of-jobs' }, ...liveCampaigns.map((c) => h('li', {}, h('a', { href: clientUrl(c.id, 'p30') }, c.name)))) : h('p', { class: 'muted' }, 'אין לקוחות עם קמפיין פעיל.'),
    cc.done ? null : h('div', { class: 'of-acts' }, h('button', {
      type: 'button', class: 'btn btn-sm btn-primary', id: 'cp-done',
      onclick: async (e) => {
        e.currentTarget.disabled = true;
        try { const r = await markReview(dayKeyIL(new Date()), 'campaigns'); reviews = [r, ...reviews]; } catch (err) { e.currentTarget.disabled = false; toast(`לא נשמר. ${errorText(err)}`); return; }
        renderKeepingState();
        toast('בדיקת הקמפיינים השבועית נרשמה.');
        $('cp-h').focus();
      },
    }, 'בדיקת הקמפיינים בוצעה')));
}

// ── Change requests ─────────────────────────
function requestCard(r) {
  const c = r.client_id ? clientOf(r.client_id) : null;
  const id = `cq-${r.id}`;
  return h('li', { class: 'of-card' },
    h('div', { class: 'of-head' }, h('strong', {}, `מ${who(r.created_by_email) || 'אופיר'}`), h('span', { class: 'muted' }, formatStamp(r.created_at)), c ? h('a', { class: 'wclient', href: clientUrl(c.id) }, c.name) : null),
    h('dl', { class: 'call-sum' }, h('dt', {}, 'הבעיה'), h('dd', {}, r.problem), h('dt', {}, 'למה מפריע'), h('dd', {}, r.why), h('dt', {}, 'ההצעה'), h('dd', {}, r.proposal)),
    h('form', { class: 'dc-inline', novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      const v = $(`${id}-dec`).value.trim();
      if (!v) { toast('כתבו את ההחלטה.'); $(`${id}-dec`).focus(); return; }
      $(`${id}-go`).disabled = true;
      try { const row = await decideChangeRequest(r.id, v); requests = requests.map((x) => (x.id === r.id ? row : x)); } catch (err) { $(`${id}-go`).disabled = false; toast(`לא נשמר. ${errorText(err)}`); return; }
      clean(e.currentTarget);
      renderKeepingState();
      toast('ההחלטה נשמרה. אופיר רואה אותה בעמוד המעבר.');
      $('cq-h').focus();
    } },
    h('div', { class: 'field grow' }, h('label', { for: `${id}-dec` }, 'ההחלטה'), h('input', { class: 'input', id: `${id}-dec`, maxlength: '1000', autocomplete: 'off' })),
    h('button', { type: 'submit', class: 'btn btn-sm btn-primary', id: `${id}-go` }, 'החלטה וסגירה')));
}

// ── Boot ────────────────────────────────────
$('btn-refresh').addEventListener('click', () => load());
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('app').hidden && !document.activeElement?.closest('form')) load(); });
setInterval(() => {
  if ($('app').hidden || $('dc-page').hidden || document.activeElement?.closest('form')) return;
  if (Date.now() - lastLoad > 5 * 60e3) load(); else if (!document.hidden) renderKeepingState();
}, 60e3);

mountSession(async (staff) => {
  const [dir, v] = await Promise.all([loadDirectory(), viewerOf(staff.email)]);
  Object.assign(directory, dir);
  viewer = v;
  me = v.me;
  markFirstLanded();
  if (v.error || v.scope !== 'office') { $('no-access').hidden = false; return; }
  $('dc-page').hidden = false;
  $('head-actions').prepend(...officeLinks(v, 'decisions.html'));
  await load();
});
