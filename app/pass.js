// Ofir's pass over the clients (pass.html; process 33, system-plan section 3):
// the clients sorted by risk (app/health.js) with what changed since the previous
// pass; "עברתי" or "פתח משימה" (owner and due) on the red, yellow, changed and
// stuck ones (a stuck one: a task, an update to Lior or a written reason, never
// "עברתי" alone), one button for all the rest; completing the pass records it as the
// day's control (office_reviews p33). Under it: the data health checks, each fixed
// in one tap; the Thursday summary prefilled from the system (decision 20: by
// 13:00); "משימות שפתחתי"; "אין מי שייצא לאפיון" to Lior; and "בקשת שינוי".
// The logic: app/pass-logic.js.
import { PEOPLE, STAFF_PEOPLE, STATUS_FIELDS, BRIEF_REQUIRED } from './protocol.js';
import { clientState, weekKey, parseDate, CLAIM, addBusinessDays, clientLabel } from './protocol-logic.js';
import {
  loadClients, loadChecks, loadTasks, setCheck, addTask, loadDirectory, loadAllLog, loadStatusNotes, saveStatusNote, loadReviews, markReview,
} from './protocol-data.js';
import {
  $, fill, h, toast, errorText, personChip, formatWhen, formatStamp, formatDay, mountSession, directory, viewerOf, who, progressBar, taskBadge, capList
} from './protocol-ui.js';
import { loadMessagesSince, loadAccessStatus, loadDateChanges } from './owner-data.js';
import { clientHealth, station, procName } from './health.js';
import { healthBadge } from './health-ui.js';
import {
  passRows, passProgress, passDue, previousPass, snapshotOf, stuckOf, dataHealth, summaryDraft, thursdayTarget,
  closesRow, seenText, stuckTitle, cleanReason, reasonOk, REASON_MAX,
} from './pass-logic.js';
import { loadPasses, savePass, loadTasksBy, updateTask, addChangeRequest, loadChangeRequests } from './office-data.js';
import { officeLinks, markFirstLanded, startControl } from './office-ui.js';
import { emptyItem, dress } from './kit.js';
import { dayKeyIL, dayFromKeyIL, endOfDayIL, inputValueIL, fromInputIL, TZ } from './tz.js';

let viewer = null;
let me = null;
let myEmail = '';
let clients = [];
let checks = {};
let tasks = [];
let mine = [];            // tasks I opened (open, or done in the last 14 days)
let extras = {};          // log, messages, access, statusNotes, dateChanges, reviews
let passes = null;        // office_passes (null: the table is not there yet)
let requests = null;      // change requests (null: not there yet)
let entries = [];
let localPass = null;     // today's pass while the table is not there yet (kept in the page only)
let lastLoad = 0;
const states = new Map();
const stateOf = (c) => {
  if (!states.has(c.id)) states.set(c.id, clientState(c, checks[c.id] || {}, new Date()));
  return states.get(c.id);
};
const live = (c) => c.status === 'active' || c.status === 'ending';
const clientUrl = (id, hash = '') => `client.html?id=${encodeURIComponent(id)}${hash ? `#${hash}` : ''}`;
const hmFmt = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const hm = (d) => hmFmt.format(new Date(d));
const busy = () => !!document.querySelector('dialog[open]');
const groupBy = (rows, key) => { const m = new Map(); for (const r of rows || []) (m.get(r[key]) || m.set(r[key], []).get(r[key])).push(r); return m; };
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
  const since30 = new Date(now.getTime() - 30 * 864e5).toISOString();
  const got = await Promise.allSettled([
    loadAllLog(new Date(now.getTime() - 21 * 864e5).toISOString()), loadMessagesSince(since30), loadAccessStatus(),
    loadStatusNotes({ sinceWeek: weekKey(new Date(now.getTime() - 7 * 864e5)) }), loadDateChanges({ sinceIso: since30 }),
    loadReviews(dayKeyIL(new Date(now.getTime() - 14 * 864e5))), loadPasses(dayKeyIL(new Date(now.getTime() - 30 * 864e5))),
    loadTasksBy(myEmail, new Date(now.getTime() - 14 * 864e5).toISOString()), loadChangeRequests(),
  ]);
  const ok = (i) => (got[i].status === 'fulfilled' ? got[i].value : null);
  extras = { log: ok(0), messages: ok(1), access: ok(2), statusNotes: ok(3), dateChanges: ok(4), reviews: ok(5) || [] };
  passes = ok(6);
  mine = ok(7) || [];
  requests = ok(8);
  compute();
  lastLoad = Date.now();
  $('state').textContent = '';
  if (!busy()) renderKeepingFocus();
}

function compute(now = new Date()) {
  states.clear();
  const logBy = groupBy(extras.log, 'client_id');
  const msgBy = groupBy(extras.messages, 'client_id');
  const notesBy = groupBy(extras.statusNotes, 'client_id');
  const chBy = groupBy(extras.dateChanges, 'client_id');
  entries = clients.filter(live).map((c) => {
    const s = stateOf(c);
    const ex = {
      now, checks: checks[c.id] || {}, tasks: tasks.filter((t) => t.client_id === c.id),
      messages: extras.messages ? msgBy.get(c.id) || [] : null, log: extras.log ? logBy.get(c.id) || [] : null, access: extras.access,
      statusNotes: extras.statusNotes ? notesBy.get(c.id) || [] : null, dateChanges: extras.dateChanges ? chBy.get(c.id) || [] : null,
    };
    return { client: c, state: s, ex, health: clientHealth(c, s, ex), station: station(c, s, ex) };
  });
}

// Re-rendering keeps focus, the scroll, the summaries that were open and what was typed in them.
function renderKeepingFocus() {
  const focusId = document.activeElement?.id;
  const y = window.scrollY;
  const open = [...document.querySelectorAll('#th-body details[open]')].map((d) => d.closest('li')?.id).filter(Boolean);
  const typed = [...document.querySelectorAll('#th-body [id], #ps-list .ps-why [id]')].filter((el) => 'value' in el && el.dataset.dirty).map((el) => [el.id, el.value]);
  render();
  for (const id of open) { const d = document.getElementById(id)?.querySelector('details'); if (d) d.open = true; }
  for (const [id, v] of typed) { const el = document.getElementById(id); if (el) { el.value = v; el.dataset.dirty = '1'; } }
  window.scrollTo({ top: y });
  if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
}
document.addEventListener('input', (e) => { if (e.target.closest?.('#th-body, #ps-list .ps-why')) e.target.dataset.dirty = '1'; });

// ── The pass ────────────────────────────────
const todayPass = () => (passes === null ? (localPass?.day === dayKeyIL(new Date()) ? localPass : null) : passes.find((p) => p.day === dayKeyIL(new Date())) || null);
function rowsNow(now = new Date()) {
  const prev = previousPass(passes, now);
  return { prev, rows: passRows(entries, { prev: prev?.snapshot || null, stuck: (e) => stuckOf(e.client, e.state, e.ex, now) }) };
}

function render() {
  const now = new Date();
  compute(now);
  const { prev, rows } = rowsNow(now);
  const pass = todayPass();
  const seen = pass?.seen || {};
  const prog = passProgress(rows, seen);
  const due = passDue(extras.reviews, now);
  const health = dataHealth({ clients, stateOf, checks, tasks, now });
  fill($('ps-jump'), h('ul', { class: 'chips-row' },
    ...[['ps-h', 'המעבר', `${prog.handled}/${prog.total}`], ['hl-h', 'תקינות', health.total], ['th-h', 'סיכום חמישי', null], ['my-h', 'שפתחתי', mine.filter((t) => !t.done_at).length], ['nb-h', 'אין מי שייצא', null], ['cr-h', 'בקשת שינוי', null]]
      .map(([id, label, n]) => h('li', {}, h('button', {
        type: 'button', class: 'chip', onclick: () => { const el = $(id); el.scrollIntoView({ block: 'start' }); el.focus({ preventScroll: true }); },
      }, label, n === null ? null : h('span', { class: 'n' }, String(n)))))));
  fill($('ps-banners'), passes === null ? h('p', { class: 'of-banner is-warn', role: 'status' }, 'שמירת המעבר עוד לא זמינה במסד הנתונים (מיגרציה 20260930150000). אפשר לעבור על הרשימה, והבקרה של היום עדיין נרשמת.') : null);
  fill($('ps-status'),
    h('p', { class: 'ps-progress' },
      h('strong', {}, pass?.completed_at ? `המעבר הושלם ${hm(pass.completed_at)}` : due.thursday ? 'היום חמישי: מעבר מלא, והוא נחשב גם כבקרה של היום' : due.due ? 'היום מגיע מעבר' : 'המעבר הבא לא חובה היום'),
      h('span', {}, `עברת על ${prog.handled} מתוך ${prog.total} לקוחות`),
      progressBar(prog.handled, prog.total, 'לקוחות שעברת עליהם היום'),
      h('span', { class: 'muted' }, prev ? `המעבר הקודם: ${formatDay(prev.day)}${prev.by_email ? ` · ${who(prev.by_email)}` : ''}` : 'אין מעבר קודם להשוואה')));
  const attention = rows.filter((r) => r.attention);
  fill($('ps-list'), ...(attention.length ? attention.map((r) => passRow(r, closesRow(r, seen[r.client.id]) ? seen[r.client.id] : null, now)) : [emptyItem('אין לקוחות באדום, בצהוב, שהשתנו או תקועים.')]));
  capList($('ps-list'), 6, 'ps:list');
  const rest = rows.filter((r) => !r.attention);
  const restOpen = rest.filter((r) => !seen[r.client.id]);
  fill($('ps-rest'), rest.length ? [
    restOpen.length ? h('button', { type: 'button', class: 'btn btn-primary', id: 'ps-rest-btn', onclick: (e) => markRest(restOpen, e.currentTarget) }, `עברתי על כל השאר (${restOpen.length} לקוחות)`)
      : h('p', { class: 'ps-seen' }, `עברת על כל השאר (${rest.length} לקוחות)`),
    h('details', { class: 'dc-more' }, h('summary', {}, `הלקוחות הירוקים שלא השתנו (${rest.length})`),
      h('ul', { class: 'of-jobs' }, ...rest.map((r) => h('li', {}, h('a', { href: clientUrl(r.client.id) }, r.client.name), r.entry.station ? ` · ${r.entry.station.title}` : '')))),
  ] : null);
  renderHealth(health, now);
  renderThursday(now);
  renderMine(now);
  renderForms();
}

function passRow(r, seen, now) {
  const c = r.client;
  const top = r.reasons.slice(0, 2);
  const id = `ps-${c.id}`;
  return h('li', { class: `of-card ps-row${seen ? ' is-seen' : ''}`, id },
    h('div', { class: 'of-head' },
      healthBadge(r.color),
      h('a', { class: 'wclient', href: clientUrl(c.id) }, clientLabel(c)),
      c.landing === true ? h('span', { class: 'tag tag-landing' }, 'בקליטה') : null,
      r.entry.station ? h('span', { class: 'wtitle' }, r.entry.station.title) : null,
      r.stuck.length ? h('span', { class: 'tag tag-warn' }, 'לקוח תקוע') : null),
    top.length ? h('ul', { class: 'ps-reasons' }, ...top.map((x) => h('li', {}, [x.text, x.what].filter(Boolean).join(' · '), x.who && PEOPLE[x.who] ? [' · ', personChip(x.who)] : null))) : null,
    // How long what blocks the client has been open (stage 11: "כמה זמן המשימה פתוחה").
    r.stuck.length ? h('ul', { class: 'ps-reasons' }, ...r.stuck.map((x) => h('li', {}, `תקוע: ${x.text}`, x.age ? h('span', { class: 'ps-age' }, ` · ${x.age}`) : null))) : null,
    r.changes.texts.length ? h('ul', { class: 'ps-changes', 'aria-label': 'מה השתנה מאז המעבר הקודם' }, ...r.changes.texts.map((t) => h('li', {}, t))) : null,
    seen ? h('p', { class: 'ps-seen' }, `${seenText(seen)} · ${hm(seen.at)}`)
      : r.stuck.length ? stuckActs(r, id)
        : h('div', { class: 'of-acts' },
          h('button', { type: 'button', class: 'btn btn-sm', id: `${id}-seen`, 'aria-label': `עברתי: ${c.name}`, onclick: (e) => markSeen([c], 'seen', e.currentTarget) }, 'עברתי'),
          h('button', { type: 'button', class: 'btn btn-sm btn-primary', id: `${id}-task`, 'aria-label': `פתיחת משימה: ${c.name}`, onclick: () => openTask(r) }, 'פתח משימה')));
}

// A stuck client leaves the check with a clear action (Ofir's protocol, stage 11):
// a task, an update to Lior, or a short written reason why nothing is needed.
// "עברתי" alone is not offered (app/pass-logic.js closesRow).
const whyOpen = new Set();
function stuckActs(r, id) {
  const c = r.client;
  const open = whyOpen.has(c.id);
  return h('div', { class: 'ps-stuck-acts' },
    h('div', { class: 'of-acts', role: 'group', 'aria-label': `לקוח תקוע יוצא מהבדיקה עם פעולה ברורה: ${c.name}` },
      h('button', { type: 'button', class: 'btn btn-sm btn-primary', id: `${id}-task`, 'aria-label': `פתיחת משימה: ${c.name}`, onclick: () => openTask(r) }, 'פתח משימה'),
      h('button', { type: 'button', class: 'btn btn-sm', id: `${id}-lior`, 'aria-label': `עדכון לליאור: ${c.name}`, onclick: () => openTask(r, 'lior') }, 'עדכון לליאור'),
      h('button', {
        type: 'button', class: 'btn btn-sm btn-ghost', id: `${id}-why-open`, 'aria-expanded': String(open), 'aria-controls': `${id}-why`,
        onclick: () => { if (whyOpen.has(c.id)) whyOpen.delete(c.id); else whyOpen.add(c.id); renderKeepingFocus(); if (whyOpen.has(c.id)) $(`${id}-why-text`)?.focus(); },
      }, 'אין צורך בפעולה')),
    open ? h('form', { class: 'ps-why', id: `${id}-why`, novalidate: true, onsubmit: (e) => saveWhy(e, r, id) },
      h('label', { for: `${id}-why-text` }, 'למה לא נדרשת פעולה (נשמר במעבר של היום)'),
      h('div', { class: 'ps-why-row' },
        h('input', { class: 'input', id: `${id}-why-text`, maxlength: String(REASON_MAX), autocomplete: 'off', 'aria-describedby': `${id}-why-err` }),
        h('button', { type: 'submit', class: 'btn btn-sm', id: `${id}-why-save` }, 'שמירה')),
      h('p', { class: 'err', id: `${id}-why-err`, role: 'alert', hidden: true })) : null);
}
async function saveWhy(e, r, id) {
  e.preventDefault();
  const input = $(`${id}-why-text`);
  const reason = cleanReason(input.value);
  if (!reasonOk(reason)) {
    const err = $(`${id}-why-err`);
    err.textContent = 'כתבו בכמה מילים למה לא נדרשת פעולה, או פתחו משימה.';
    err.hidden = false;
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    return;
  }
  if (await markSeen([r.client], 'reason', $(`${id}-why-save`), null, reason)) whyOpen.delete(r.client.id);
}

// Records what was gone over; the pass completes when nothing is left, and that is the day's control (33).
async function markSeen(list, how, btn = null, task = null, reason = null) {
  const now = new Date();
  const day = dayKeyIL(now);
  const pass = todayPass();
  const seen = { ...(pass?.seen || {}) };
  for (const c of list) seen[c.id] = { how, at: now.toISOString(), ...(task ? { task } : {}), ...(reason ? { reason } : {}) };
  if (btn) btn.disabled = true;
  const { rows } = rowsNow(now);
  const done = passProgress(rows, seen).complete;
  try {
    if (passes !== null) {
      const row = await savePass({ day, seen, ...(done ? { snapshot: snapshotOf(entries), completed_at: now.toISOString() } : {}) });
      passes = [row, ...passes.filter((p) => p.day !== day)];
    } else {
      localPass = { day, seen, completed_at: done ? now.toISOString() : null };
    }
    if (done && !extras.reviews.some((r) => r.day === day && r.kind === 'p33')) {
      const rv = await markReview(day, 'p33');
      extras.reviews = [rv, ...extras.reviews];
    }
  } catch (err) {
    if (btn) btn.disabled = false;
    toast(`לא נשמר. ${errorText(err)}`);
    return false;
  }
  renderKeepingFocus();
  if (done) toast('המעבר הושלם ונרשם כבקרת הלקוחות של היום (33).');
  else if (how === 'rest') toast(`סומנו ${list.length} לקוחות.`);
  // Keyboard focus goes to the next client that needs action.
  const next = document.querySelector('.ps-row:not(.is-seen) button');
  if (btn && !btn.isConnected) (next || $('ps-rest-btn') || $('ps-h')).focus();
  return true;
}
const markRest = (rows, btn) => markSeen(rows.map((r) => r.client), 'rest', btn);

// "פתח משימה": the next action with an owner and a due date; the client counts as gone over.
const tkDlg = $('dlg-task');
tkDlg.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === tkDlg) tkDlg.close(); });
let tkFor = null;
let tkReturn = null;
tkDlg.addEventListener('close', () => { if (tkReturn && document.getElementById(tkReturn)) document.getElementById(tkReturn).focus(); tkReturn = null; });
// `mode` 'lior': the same dialog as an update to Lior about a stuck client. It is an
// exception task for him (source 'escalation', as "אין מי שייצא לאפיון" below and the
// card's "דיווח חריגה לליאור"), so it lands in his "החלטות".
let tkMode = null;
function openTask(r, mode = null) {
  tkFor = r;
  tkMode = mode;
  tkReturn = document.activeElement?.id || null;
  const top = r.reasons[0];
  const step = r.entry.station?.current;
  const lior = mode === 'lior';
  $('tk-h').textContent = `${lior ? 'עדכון לליאור' : 'פתיחת משימה'} · ${r.client.name}`;
  $('tk-meta').textContent = lior ? 'ליאור מקבל את זה כחריגה ב״החלטות״. כתבו מה תקוע ומה צריך ממנו.'
    : top ? `${top.text}${top.what ? ` · ${top.what}` : ''}` : r.stuck[0]?.text || '';
  $('tk-title').value = lior ? stuckTitle(r) : step && !step.waiting ? step.what : '';
  const owner = lior ? 'lior' : top?.who && PEOPLE[top.who] && top.who !== 'editor' ? top.who : null;
  fill($('tk-owner'), ...staffOptions(owner));
  $('tk-owner').disabled = lior;
  $('tk-submit').textContent = lior ? 'שליחה לליאור' : 'פתיחת המשימה';
  $('tk-due').value = dayKeyIL(addBusinessDays(new Date(), 1));
  $('tk-err').hidden = true;
  tkDlg.showModal();
  $('tk-title').focus();
}
$('tk-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = tkFor;
  const title = $('tk-title').value.trim();
  const owner = $('tk-owner').value;
  const due = $('tk-due').value;
  const miss = [[!title, 'tk-title', 'מה צריך לעשות'], [!owner, 'tk-owner', 'אחראי'], [!due, 'tk-due', 'מועד יעד']].filter(([bad]) => bad);
  for (const [bad, id] of [[!title, 'tk-title'], [!owner, 'tk-owner'], [!due, 'tk-due']]) $(id).setAttribute('aria-invalid', String(bad));
  if (miss.length) { $('tk-err').textContent = `חסר: ${miss.map((x) => x[2]).join(', ')}. לכל משימה יש אחראי ומועד.`; $('tk-err').hidden = false; $(miss[0][1]).focus(); return; }
  if (BRIEF_REQUIRED.has(owner)) { $('tk-err').textContent = `משימה ל${PEOPLE[owner].name} צריכה בריף מלא: פותחים אותה בכרטיס הלקוח.`; $('tk-err').hidden = false; return; }
  $('tk-submit').disabled = true;
  try {
    const lior = tkMode === 'lior';
    const t = await addTask({ client_id: r.client.id, title, owner, due_on: due, source: lior ? 'escalation' : 'p33' });
    tasks = [t, ...tasks];
    mine = [t, ...mine];
    tkDlg.close();
    await markSeen([r.client], lior ? 'lior' : 'task', null, t.id);
    toast(lior ? `נשלח לליאור: ${title}` : `נפתחה משימה ל${PEOPLE[owner].name}: ${title}`);
  } catch (err) {
    $('tk-err').textContent = `המשימה לא נפתחה. ${errorText(err)}`;
    $('tk-err').hidden = false;
  }
  $('tk-submit').disabled = false;
});

// ── Data health: each one fixed in one tap ──
function renderHealth(hl, now) {
  $('hl-n').textContent = String(hl.total);
  const group = (title, list, row) => (list.length ? h('div', { class: 'ps-health-group' }, h('h3', {}, title, ' ', h('span', { class: 'n' }, String(list.length))),
    h('ul', { class: 'of-list' }, ...list.map(row))) : null);
  const dueWords = formatWhen(endOfDayIL(dayFromKeyIL(hl.dueFix)), now);
  fill($('hl-body'), hl.total ? [
    group('תהליך משותף שאף אחד לא לקח', hl.unowned, (x) => h('li', { class: 'of-card' },
      h('div', { class: 'of-head' }, h('a', { class: 'wclient', href: clientUrl(x.client.id, x.state.proc.id) }, clientLabel(x.client)), h('span', { class: 'wtitle' }, procName(x.state.proc))),
      h('div', { class: 'of-acts' }, h('button', {
        type: 'button', class: 'btn btn-sm', id: `hl-claim-${x.client.id}-${x.state.proc.id}`,
        onclick: (e) => fixClaim(x, e.currentTarget),
      }, `לשייך ל${PEOPLE[x.owner]?.name || x.owner}`)))),
    group('משימה בלי מועד יעד', hl.noDue, (x) => h('li', { class: 'of-card' },
      h('div', { class: 'of-head' }, h('a', { class: 'wclient', href: clientUrl(x.client.id, 'tasks') }, clientLabel(x.client)), personChip(x.task.owner), taskBadge(x.task)),
      h('p', { class: 'of-line' }, x.task.title),
      h('div', { class: 'of-acts' }, h('button', {
        type: 'button', class: 'btn btn-sm', id: `hl-due-${x.task.id}`, onclick: (e) => fixDue(x, hl.dueFix, e.currentTarget),
      }, `לקבוע יעד: ${dueWords}`)))),
    group('לקוח בלי עורך', hl.noEditor, (x) => h('li', { class: 'of-card' },
      h('div', { class: 'of-head' }, h('a', { class: 'wclient', href: clientUrl(x.client.id, x.state.proc.id) }, clientLabel(x.client)), x.n ? h('span', { class: 'wtitle' }, `סבב צילום ${x.n}`) : null),
      h('div', { class: 'of-acts' }, h('a', { class: 'btn btn-sm btn-primary', href: `qa.html#assign-${x.client.id}${x.n ? `-r${x.n}` : ''}` }, 'שיוך עורך')))),
  ] : h('p', { class: 'muted' }, 'לא נמצאו חוסרים: לכל תהליך אחראי, לכל משימה מועד, לכל צילום עורך.'));
}
async function fixClaim(x, btn) {
  btn.disabled = true;
  try {
    const row = await setCheck(x.client.id, CLAIM(x.state.proc), 'done', x.owner);
    (checks[x.client.id] ||= {})[row.item_key] = row;
  } catch (err) { btn.disabled = false; toast(`לא נשמר. ${errorText(err)}`); return; }
  renderKeepingFocus();
  toast(`${procName(x.state.proc)} אצל ${PEOPLE[x.owner]?.name}.`);
  $('hl-h').focus();
}
async function fixDue(x, due, btn) {
  btn.disabled = true;
  try {
    const t = await updateTask(x.task.id, { due_on: due });
    tasks = tasks.map((y) => (y.id === t.id ? t : y));
    mine = mine.map((y) => (y.id === t.id ? t : y));
  } catch (err) { btn.disabled = false; toast(`לא נשמר. ${errorText(err)}`); return; }
  renderKeepingFocus();
  toast(`נקבע מועד למשימה: ${x.task.title}`);
  $('hl-h').focus();
}

// ── The Thursday summary, prefilled ─────────
function renderThursday(now) {
  const target = thursdayTarget(now);
  const wk = weekKey(now);
  const notes = new Map((extras.statusNotes || []).filter((n) => n.week === wk).map((n) => [n.client_id, n]));
  // No weekly summary is asked for a client that was not taken in yet.
  const list = entries.filter((e) => e.client.landing !== true).sort((a, b) => notes.has(a.client.id) - notes.has(b.client.id));
  const done = list.filter((e) => notes.has(e.client.id)).length;
  fill($('th-body'),
    h('p', { class: 'ps-progress' },
      target ? h('span', { class: `ps-target${target.late && done < list.length ? ' late' : ''}` }, target.late ? `היעד 13:00 עבר` : 'יעד: היום 13:00, כדי שעירית תשלח לקוחות אחר הצהריים') : h('span', {}, 'סיכום לכל לקוח בכל יום חמישי. אפשר להתחיל מוקדם.'),
      h('span', {}, `סוכמו ${done} מתוך ${list.length}`), progressBar(done, list.length, 'לקוחות שסוכמו השבוע')),
    extras.statusNotes === null ? h('p', { class: 'muted' }, 'סיכומי המצב לא נטענו.') : h('ul', { class: 'of-list' }, ...list.map((e) => summaryRow(e, notes.get(e.client.id), now))));
}
function summaryRow(e, note, now) {
  const c = e.client;
  const draft = summaryDraft(c, e.state, e.station, checks[c.id] || {}, tasks, now);
  const v = note || draft;
  const id = `th-${c.id}`;
  return h('li', { class: 'of-card', id },
    h('details', { class: 'ps-sum', open: false },
      h('summary', {},
        h('strong', {}, clientLabel(c)),
        note ? h('span', { class: 'sbadge s-done' }, h('span', { class: 'sicon', 'aria-hidden': 'true' }), `סוכם · ${who(note.by_email)} · ${formatStamp(note.at)}`)
          : h('span', { class: 'sbadge s-waiting' }, h('span', { class: 'sicon', 'aria-hidden': 'true' }), 'טרם סוכם · ממולא מהמערכת'),
        v.current ? h('span', { class: 'muted small ps-preview' }, v.current) : null),
      h('form', { class: 'ps-form', novalidate: true, onsubmit: (ev) => saveSummary(ev, c) },
        ...STATUS_FIELDS.map(([k, label]) => h('div', { class: 'field' }, h('label', { for: `${id}-${k}` }, label),
          h('textarea', { class: 'input', id: `${id}-${k}`, name: k, rows: '2', maxlength: k === 'next' ? '500' : '1000' }, v[k] || ''))),
        h('div', { class: 'row2' },
          h('div', { class: 'field' }, h('label', { for: `${id}-owner` }, 'אחראי'), h('select', { class: 'input', id: `${id}-owner`, name: 'owner' }, ...staffOptions(v.owner))),
          h('div', { class: 'field' }, h('label', { for: `${id}-due` }, 'מועד יעד'), h('input', { class: 'input', id: `${id}-due`, name: 'due_on', type: 'date', dir: 'ltr', value: v.due_on || '' }))),
        h('p', { class: 'err', id: `${id}-err`, role: 'alert', hidden: true }),
        h('div', { class: 'of-acts' },
          h('button', { type: 'submit', class: 'btn btn-primary btn-sm', id: `${id}-save`, value: 'save' }, note ? 'שמירת השינויים' : 'שמירה'),
          // Not `${id}-next`: that is the id of the field "פעולה הבאה" above (a duplicate id, found by the e2e check).
          h('button', { type: 'submit', class: 'btn btn-sm', id: `${id}-save-next`, value: 'next' }, 'שמירה והבא')))));
}
async function saveSummary(ev, c) {
  ev.preventDefault();
  const f = ev.currentTarget;
  const goNext = ev.submitter?.value === 'next';
  const val = (n) => f.elements[n].value.trim() || null;
  const row = { client_id: c.id, week: weekKey(new Date()), current: val('current'), missing: val('missing'), next: val('next'), owner: val('owner'), due_on: val('due_on') };
  const errEl = f.querySelector('.err');
  const miss = [['current', 'מצב נוכחי'], ['next', 'פעולה הבאה'], ['owner', 'אחראי'], ['due_on', 'מועד יעד']].filter(([k]) => !row[k]);
  for (const k of ['current', 'next', 'owner', 'due_on']) f.elements[k].setAttribute('aria-invalid', String(!row[k]));
  if (miss.length) { errEl.textContent = `חסר: ${miss.map((x) => x[1]).join(', ')}.`; errEl.hidden = false; f.elements[miss[0][0]].focus(); return; }
  for (const b of f.querySelectorAll('button')) b.disabled = true;
  try {
    const saved = await saveStatusNote(row);
    extras.statusNotes = [saved, ...(extras.statusNotes || []).filter((n) => !(n.client_id === saved.client_id && n.week === saved.week))];
    for (const el of f.elements) delete el.dataset.dirty;
  } catch (err) {
    errEl.textContent = `הסיכום לא נשמר. ${errorText(err)}`;
    errEl.hidden = false;
    for (const b of f.querySelectorAll('button')) b.disabled = false;
    return;
  }
  renderKeepingFocus();
  toast(`סיכום המצב של ${c.name} נשמר.`);
  const nextRow = [...document.querySelectorAll('#th-body .ps-sum')].find((d) => d.querySelector('.s-waiting'));
  if (goNext && nextRow) { nextRow.open = true; nextRow.querySelector('textarea').focus(); } else document.querySelector(`#th-${CSS.escape(c.id)} summary`)?.focus();
}

// ── Tasks I opened ──────────────────────────
function renderMine(now) {
  const today = dayKeyIL(now);
  const open = mine.filter((t) => !t.done_at).sort((a, b) => (a.due_on || '9') < (b.due_on || '9') ? -1 : 1);
  const done = mine.filter((t) => t.done_at).slice(0, 10);
  $('my-n').textContent = String(open.length);
  const byId = new Map(clients.map((c) => [c.id, c]));
  const row = (t) => {
    const c = byId.get(t.client_id);
    const late = !t.done_at && t.due_on && t.due_on < today;
    return h('li', { class: `of-card${late ? ' is-late' : ''}${t.done_at ? ' is-done' : ''}` },
      h('div', { class: 'of-head' }, c ? h('a', { class: 'wclient', href: clientUrl(c.id, 'tasks') }, clientLabel(c)) : null, personChip(t.owner), taskBadge(t)),
      h('p', { class: 'of-line' }, t.title),
      h('p', { class: 'of-line' }, t.done_at ? `בוצע · ${who(t.done_by_email)} · ${formatStamp(t.done_at)}` : [t.due_on ? `${late ? 'באיחור · ' : ''}עד ${formatDay(t.due_on)}` : 'בלי מועד', ` · נפתחה ${formatStamp(t.created_at)}`]),
      t.urgent && !t.done_at ? startControl(t, me, () => renderKeepingFocus()) : null);
  };
  fill($('my-list'), ...(open.length || done.length ? [...open.map(row), ...done.map(row)] : [emptyItem('לא פתחת משימות בשבועיים האחרונים.')]));
}

// ── To Lior: nobody to go; a change request ──
function renderForms() {
  const upcoming = clients.filter(live).sort((a, b) => (parseDate(a.char_at) || Infinity) - (parseDate(b.char_at) || Infinity));
  const keep = (sel) => $(sel).value;
  const nb = keep('nb-client');
  fill($('nb-client'), h('option', { value: '' }, 'בחירת לקוח'), ...upcoming.map((c) => h('option', { value: c.id, selected: nb === c.id }, `${c.name}${c.char_at ? ` · ${formatStamp(c.char_at)}` : ''}`)));
  const cr = keep('cr-client');
  fill($('cr-client'), h('option', { value: '' }, 'לא קשור ללקוח'), ...clients.filter(live).map((c) => h('option', { value: c.id, selected: cr === c.id }, c.name)));
  fill($('cr-list'), ...(requests || []).slice(0, 5).map((r) => h('li', { class: 'of-card' },
    h('p', { class: 'of-line' }, h('strong', {}, r.problem)),
    h('p', { class: 'of-line' }, r.decision ? `ליאור: ${r.decision} · ${formatStamp(r.decided_at)}` : `נשלח ${formatStamp(r.created_at)} · מחכה להחלטה של ליאור`))));
}
$('nb-client').addEventListener('change', () => {
  const c = clients.find((x) => x.id === $('nb-client').value);
  if (!c) return;
  if (c.char_at) $('nb-at').value = inputValueIL(new Date(c.char_at));
  if (c.address) $('nb-address').value = c.address;
});
$('nb-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const c = clients.find((x) => x.id === $('nb-client').value);
  const at = fromInputIL($('nb-at').value);
  const address = $('nb-address').value.trim();
  const info = $('nb-info').value.trim();
  const miss = [[!c, 'nb-client', 'לקוח'], [!at, 'nb-at', 'מועד'], [!address, 'nb-address', 'כתובת']].filter(([bad]) => bad);
  if (miss.length) { $('nb-err').textContent = `חסר: ${miss.map((x) => x[2]).join(', ')}.`; $('nb-err').hidden = false; $(miss[0][1]).focus(); return; }
  $('nb-err').hidden = true;
  $('nb-submit').disabled = true;
  const title = `אין מי שייצא לאפיון: ${formatStamp(at)} · ${address}${info ? ` · ${info}` : ''}`.slice(0, 500);
  try {
    const t = await addTask({ client_id: c.id, title, owner: 'lior', source: 'escalation', due_on: dayKeyIL(at) });
    tasks = [t, ...tasks];
    mine = [t, ...mine];
    $('nb-form').reset();
    toast(`נשלח לליאור: אין מי שייצא לאפיון של ${c.name}.`);
    renderKeepingFocus();
  } catch (err) {
    $('nb-err').textContent = `לא נשלח. ${errorText(err)}`;
    $('nb-err').hidden = false;
  }
  $('nb-submit').disabled = false;
});
$('cr-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = { problem: $('cr-problem').value.trim(), why: $('cr-why').value.trim(), proposal: $('cr-proposal').value.trim() };
  const miss = [['problem', 'מה הבעיה'], ['why', 'למה היא מפריעה'], ['proposal', 'מה להציע']].filter(([k]) => !v[k]);
  for (const k of ['problem', 'why', 'proposal']) $(`cr-${k}`).setAttribute('aria-invalid', String(!v[k]));
  if (miss.length) { $('cr-err').textContent = `חסר: ${miss.map((x) => x[1]).join(', ')}.`; $('cr-err').hidden = false; $(`cr-${miss[0][0]}`).focus(); return; }
  if (requests === null) { $('cr-err').textContent = 'בקשות שינוי עוד לא זמינות במסד הנתונים (מיגרציה 20260930150000).'; $('cr-err').hidden = false; return; }
  $('cr-err').hidden = true;
  $('cr-submit').disabled = true;
  try {
    const row = await addChangeRequest({ ...v, client_id: $('cr-client').value || null });
    requests = [row, ...requests];
    $('cr-form').reset();
    toast('בקשת השינוי נשלחה לליאור. היא מופיעה אצלו ב״החלטות״.');
    renderKeepingFocus();
  } catch (err) {
    $('cr-err').textContent = `לא נשלח. ${errorText(err)}`;
    $('cr-err').hidden = false;
  }
  $('cr-submit').disabled = false;
});

// ── Boot ────────────────────────────────────
$('btn-refresh').addEventListener('click', () => load());
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('app').hidden && !busy() && !document.activeElement?.closest('form')) load(); });
setInterval(() => {
  if ($('app').hidden || $('ps-page').hidden || busy() || document.activeElement?.closest('form')) return;
  if (Date.now() - lastLoad > 5 * 60e3) load();
}, 60e3);

// The kit (docs/ops.md, section 52): each section's heading and each card take an icon square.
dress($('app'), [['#ps-h', 'eye', 'blue', 'md'], ['#hl-h', 'shield', 'green', 'md'], ['#th-h', 'calendar', 'teal', 'md'], ['#my-h', 'check-circle', 'purple', 'md'], ['#nb-h', 'users', 'orange', 'md'], ['#cr-h', 'edit', 'purple', 'md'], ['#na-h', 'lock', 'navy'],
  ['#my-list .of-head', 'check-circle', 'purple', 'md'], ['#cr-list .of-head', 'edit', 'purple', 'md']]);

mountSession(async (staff) => {
  const [dir, v] = await Promise.all([loadDirectory(), viewerOf(staff.email)]);
  Object.assign(directory, dir);
  viewer = v;
  me = v.me;
  myEmail = String(staff.email || '').toLowerCase();
  markFirstLanded();
  if (v.error || v.scope !== 'office') { $('no-access').hidden = false; return; }
  $('ps-page').hidden = false;
  $('head-actions').prepend(...officeLinks(v, 'pass.html'));
  await load();
});
