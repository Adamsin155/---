// Ofir's first screen (qa.html; system-plan section 3, "אופיר"): the quality-
// control queue (videos, 25, and the rest of the graphics, 23), each with how long
// it has waited against the one-hour target (stopped while he is in a
// characterization, decision 11); "אישור" or "החזרה לתיקון" with the issues, a due
// time and a round counter. Below it today's characterizations, the shoots waiting
// for an editor with the assignment (22א: Nirel preselected for Natali, an optional
// reason for anyone else and on a joint day), and each editor's load.
// The quality-control dialog shows what is being checked: the round's videos by their
// Drive link (and any uploaded into the system, played in place), or the rest of the
// graphics from the client's files.
// The logic: app/qa-logic.js and app/office-marks.js.
import { PEOPLE, SHOOT_TYPES, EDITORS, CRITICAL_MISTAKES, CRITICAL_TITLE, mistakeIssue, evenSplit, splitProblem } from './protocol.js';
import { clientState, clientLabel } from './protocol-logic.js';
import {
  loadClients, loadChecks, loadTasks, setCheck, clearCheck, setChecksBulk, clearChecksBulk, addTask, updateClient, loadDirectory, setTaskDone, editor2Ready,
} from './protocol-data.js';
import {
  $, fill, h, toast, errorText, personChip, formatWhen, formatStamp, leafOf, mountSession, directory, viewerOf, officeMinutes, landingTag,
} from './protocol-ui.js';
import {
  qaQueue, qaFixing, charsToday, awaitingEditor, editorLoad, loadText, dayText, preselected, reasonNeeded, reasonHint,
  eligibleEditors, jointFromSelection, reasonNote, folderTitle, folderDueOn,
  swapClock, swapReasonNeeded, swapNote, suggestAssignment, SUGGESTED_TAG, CONTINUITY_TAG,
} from './qa-logic.js';
import { autoReasonOf, AUTO_DRIVE_NOTE } from './auto-assign.js';
import { ladderWords, setOfirMeetings } from './fast-ladder.js';
import {
  QA_KINDS, qaState, returnKey, returnNote, fixDue, ofirMeetings, meetingNow, REASON_KEY, ISSUE_MAX, ISSUE_TEXT_MAX, ISSUE_REF_MAX,
} from './office-marks.js';
import { withEditor, swapEditor } from './decisions-logic.js';
import { loadScriptCounts, scriptsWords } from './production-data.js';
import { liorShoot } from './reminder-engine.js';
import { loadSelections } from './office-data.js';
import { offerHandoff } from './handoff-ui.js';
import { refreshQuestions } from './questions-ui.js';
import { officeLinks, markFirstLanded, navLink } from './office-ui.js';
import { mountApprovals } from './approvals-ui.js';
import { emptyItem, dress, dateLeaf, iconSquare } from './kit.js';
import { canSeeOfficeQueues } from './manager-rules.js';
import { inputValueIL, fromInputIL, dayFromKeyIL, endOfDayIL, TZ } from './tz.js';
import { mountWorkFiles, forgetFiles } from './files-ui.js';
import { loadIntake } from './landing-data.js';
import { withLandingEditors } from './landing-logic.js';
import { videoWindow, graphicsWindow, videosLinkOf } from './files-logic.js';

let viewer = null;
let me = null;
let clients = [];
let checks = {};
let tasks = [];
let selections = new Map();
let lastLoad = 0;
const states = new Map();
const stateOf = (c) => {
  if (!states.has(c.id)) states.set(c.id, clientState(c, checks[c.id] || {}, new Date()));
  return states.get(c.id);
};
const checksOf = (c) => checks[c.id] || {};
const clientUrl = (id, hash = '') => `client.html?id=${encodeURIComponent(id)}${hash ? `#${hash}` : ''}`;
const hmFmt = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const hm = (d) => hmFmt.format(d);
const busy = () => !!document.querySelector('dialog[open]');
const roundText = (ctx) => (ctx?.round ? ` · סבב צילום ${ctx.round}` : '');
// "25 דק׳", "שעה", "1 ש׳ ו־10 דק׳".
const waitWords = (min) => (min === 60 ? 'שעה' : officeMinutes(min));
// What stands in place of a clock on work of a client that came from the old system (docs/ops.md, sections 41 and 46).
const LANDING_LINE = 'בקליטה · בלי שעון עד שהלקוח יופעל';
const LANDING_EDITOR_LINE = 'בקליטה: עירית יכולה לרשום את העורך האמיתי';
const meetings = () => ofirMeetings(clients.filter((c) => c.status === 'active' || c.status === 'ending'), checksOf);

// ── Data ────────────────────────────────────
let inflight = null;
// How many scripts each shoot has ('<client>:<round>' → n; 21.10.2026), next to its editor.
let scriptN = {};
const scriptsLine = (clientId, n) => scriptsWords(scriptN[`${clientId}:${n || 1}`] || 0);
function load() {
  inflight ||= doLoad().finally(() => { inflight = null; });
  return inflight;
}
async function doLoad() {
  if (!clients.length) $('state').textContent = 'טוען…';
  try {
    [clients, checks, tasks] = await Promise.all([loadClients(), loadChecks(), loadTasks({ openOnly: true })]);
  } catch (err) {
    $('state').textContent = errorText(err);
    return;
  }
  // A client in landing whose real editor the office recorded on the intake screen
  // (docs/ops.md, the bullets of 14.10.2026): assigned, as it will be once activated.
  if (clients.some((c) => c.landing === true)) {
    const intake = await loadIntake();
    checks = withLandingEditors(clients, checks, intake.marks);
  }
  states.clear();
  // Natali's shoots waiting for an editor, and the ones in editing (an editor can be changed): was it a joint day.
  const natali = [
    ...awaitingEditor({ clients, stateOf, checks }).filter((a) => a.ctx.shoot_type === 'natali').map((a) => a.client.quote_id),
    ...Object.values(editorLoad({ clients, stateOf, checks, tasks })).flatMap((l) => l.jobs).filter((j) => j.client.shoot_type === 'natali').map((j) => j.client.quote_id),
  ];
  [selections, scriptN] = await Promise.all([loadSelections([...new Set(natali.filter(Boolean))]).catch(() => new Map()), loadScriptCounts()]);
  lastLoad = Date.now();
  $('state').textContent = '';
  if (!busy()) renderKeepingFocus();
  refreshQuestions($('my-questions'), me, clients);
}

function renderKeepingFocus() {
  const focusId = document.activeElement?.id;
  const y = window.scrollY;
  render();
  window.scrollTo({ top: y });
  if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
}

// ── Render ──────────────────────────────────
function render() {
  const now = new Date();
  states.clear();
  const ms = meetings();
  setOfirMeetings(ms); // the fast ladder waits for the end of his meeting (protocol v10)
  const queue = qaQueue({ clients, stateOf, checks, meetings: ms, now });
  const fixing = qaFixing({ clients, stateOf, checks });
  const chars = charsToday({ clients, stateOf, now });
  const waiting = awaitingEditor({ clients, stateOf, checks });
  // Clients still in landing wait for Irit to record the real editor: one folded line (20.10.2026).
  const timed = waiting.filter((a) => !a.landing);
  const landing = waiting.filter((a) => a.landing);
  const load = editorLoad({ clients, stateOf, checks, tasks, now });
  renderBanners(ms, now);
  fill($('of-jump'), h('ul', { class: 'chips-row' },
    ...[['qa-h', 'בקרה', queue.length], ['char-h', 'אפיונים', chars.length], ['assign-h', 'שיוך עורך', timed.length], ['load-h', 'עומס', null]]
      .map(([id, label, n]) => h('li', {}, h('button', {
        type: 'button', class: 'chip', onclick: () => { const el = $(id); el.scrollIntoView({ block: 'start' }); el.focus({ preventScroll: true }); },
      }, label, n === null ? null : h('span', { class: 'n' }, String(n)))))));
  $('qa-n').textContent = String(queue.length);
  fill($('qa-list'), ...(queue.length ? queue.map((x) => qaCard(x, ms, now)) : [emptyItem('אין כרגע עבודה שמחכה לבקרה שלך.', { icon: 'shield' })]));
  fill($('qa-fixing'), fixing.length ? h('details', { class: 'of-fixing' },
    h('summary', {}, `הוחזרו לתיקון ועוד לא חזרו (${fixing.length})`),
    h('ul', { class: 'of-list' }, ...fixing.map((x) => h('li', { class: 'of-card' },
      h('div', { class: 'of-head' },
        h('a', { class: 'wclient', href: clientUrl(x.client.id, x.proc.id) }, clientLabel(x.client)), landingTag(x.client),
        h('span', { class: 'wtitle' }, `${QA_KINDS[x.kind].title}${roundText(x.ctx)} · סבב ${x.open.n}`),
        personChip(x.who === 'editor' ? 'editor' : x.who)),
      h('p', { class: 'of-line' }, `${x.open.issues.length === 1 ? 'בעיה אחת' : `${x.open.issues.length} בעיות`} · תוקנו ${x.open.fixed.size}`,
        x.open.due ? h('span', { class: x.open.due < now && x.client.landing !== true ? 'late' : '' }, ` · עד ${formatWhen(x.open.due, now)}`) : null))))) : null);
  $('char-n').textContent = String(chars.length);
  fill($('char-list'), ...(chars.length ? chars.map((x) => charCard(x, now)) : [emptyItem('אין היום אפיונים שלך.', { icon: 'target', tone: 'orange' })]));
  $('assign-n').textContent = String(timed.length);
  fill($('assign-list'), ...(timed.length ? timed.map((a) => assignCard(a, load, now)) : landing.length ? [] : [emptyItem('אין לקוחות שמחכים לשיוך עורך.', { icon: 'scissors', tone: 'blue' })]),
    landing.length ? h('li', { class: 'of-landing-fold' }, h('details', { id: 'as-landing-fold', open: openFolds.has('landing') ? true : null, ontoggle: (e) => keepFold('landing', e.currentTarget.open) },
      h('summary', {}, h('strong', {}, `בקליטה (${landing.length})`), h('span', { class: 'muted' }, ' · עירית רושמת את העורך האמיתי')),
      h('ul', { class: 'of-list' }, ...landing.map((a) => assignCard(a, load, now))))) : null);
  fill($('load-list'), ...EDITORS.map((k) => loadCard(load[k], now)));
}

function renderBanners(ms, now) {
  const m = meetingNow(ms, now);
  const env = { now, clients: clients.filter((c) => c.status === 'active' || c.status === 'ending'), checksOf, stateOf };
  const shoot = liorShoot(env);
  fill($('of-banners'),
    m ? h('p', { class: 'of-banner', role: 'status' }, h('strong', {}, me === 'ofir' ? `אתה באפיון עד ${hm(m.to)}.` : `אופיר באפיון עד ${hm(m.to)}.`),
      ' שעון הבקרה עצור, ומי שמחכה לבקרה רואה ״אופיר באפיון, בקרה עד…״.') : null,
    shoot.active && me !== 'lior' ? h('p', { class: 'of-banner is-warn', role: 'status' }, h('strong', {}, 'ליאור ביום צילום.'),
      ' חריגות, גם דחופות, עוברות אליך עד מסירת הכונן (החלטה 8). ', h('a', { href: 'decisions.html' }, 'להחלטות')) : null);
}

function qaCard(x, ms, now) {
  const k = QA_KINDS[x.kind];
  const pct = Math.min(100, Math.round((x.waited / x.target) * 100));
  // The graphics are on Ofir's fast ladder (protocol v9): its own minutes, and its own words while he is in a meeting (v10).
  const inMeeting = !x.fast && !!meetingNow(ms, now);
  return h('li', { class: `of-card${x.late ? ' is-late' : ''}`, 'data-key': x.key },
    h('div', { class: 'of-head' },
      h('a', { class: 'wclient', href: clientUrl(x.client.id, x.proc.id) }, clientLabel(x.client)), landingTag(x.client),
      h('span', { class: 'wtitle' }, `${k.title}${roundText(x.ctx)}`),
      x.round > 1 ? h('span', { class: 'tag' }, `בדיקה ${x.round} · אחרי תיקון`) : null,
      x.late ? h('span', { class: 'sbadge s-overdue' }, h('span', { class: 'sicon', 'aria-hidden': 'true' }), 'עבר היעד') : null),
    // A client in landing: the work is here as usual, and its hour is counted from the activation.
    x.landing ? h('p', { class: 'of-line muted' }, LANDING_LINE) : h('p', { class: 'of-line' },
      x.fast ? `${ladderWords(x.fast, now)} · הגיע ${formatWhen(x.readyAt, now)} · לאשר עד ${formatWhen(x.dueAt, now)}`
        : `מחכה ${waitWords(x.waited)} מתוך שעה · בקרה עד ${formatWhen(x.dueAt, now)}`,
      inMeeting ? h('span', { class: 'muted' }, ' · השעון עצור בזמן האפיון') : null),
    x.landing ? null : h('span', { class: `of-meter${x.late ? ' is-late' : ''}`, role: 'img', 'aria-label': `זמן המתנה: ${x.waited} מתוך ${x.target} דקות` },
      h('span', { style: `inline-size:${pct}%` })),
    // The graphics are checked by Ofir alone (protocol v9). Lior supervises here: he sees them, without the button.
    me === 'lior' && x.kind !== 'videos' ? h('p', { class: 'of-line muted qa-ofir-only' }, 'אופיר בודק את הגרפיקות.') : h('div', { class: 'of-acts' },
      h('button', {
        type: 'button', class: 'btn k-btn-navy btn-sm', id: `qa-open-${x.key.replace(/\W/g, '_')}`,
        'aria-label': `לבדיקה: ${x.client.name}, ${k.title}`, onclick: () => openQa(x),
      }, 'לבדיקה')));
}

function charCard(x, now) {
  const c = x.client;
  const nav = navLink(c.address);
  return h('li', { class: `of-card${x.done ? ' is-done' : ''}` },
    // The hour as a leaf of today's calendar (docs/ops.md, section 62): green once it is over.
    h('div', { class: 'of-head has-leaf' },
      dateLeaf({ ...leafOf(x.at, now), tone: x.done ? 'green' : 'navy' }),
      h('a', { class: 'wclient', href: clientUrl(c.id, 'p04') }, clientLabel(c)),
      x.done ? h('span', { class: 'sbadge s-done' }, h('span', { class: 'sicon', 'aria-hidden': 'true' }), 'הסתיים') : x.at <= now ? h('span', { class: 'tag' }, 'עכשיו') : null),
    h('p', { class: 'of-line' }, c.address ? `כתובת: ${c.address}` : 'אין כתובת בכרטיס', c.business ? ` · ${c.business}` : ''),
    h('div', { class: 'of-acts' },
      nav ? h('a', { class: 'btn btn-sm', href: nav, target: '_blank', rel: 'noopener' }, 'ניווט', h('span', { class: 'sr-only' }, ` ל${c.name} (נפתח בחלון חדש)`)) : null,
      c.phone ? h('a', { class: 'btn btn-sm', href: `tel:${String(c.phone).replace(/[^\d+]/g, '')}` }, 'התקשרות', h('span', { class: 'sr-only' }, ` ל${c.name}`)) : null,
      h('a', { class: 'btn btn-sm btn-ghost', href: clientUrl(c.id, 'p04') }, 'לכרטיס', h('span', { class: 'sr-only' }, ` של ${c.name}`))));
}

// The suggestion of one waiting shoot (the owner's choice of 13.10.2026; app/qa-logic.js
// suggestAssignment): the card and the dialog ask the same question, so they never disagree.
const inCardOf = (a) => (!a.swap && a.ctx.editor && eligibleEditors(a.ctx.shoot_type).includes(a.ctx.editor) ? a.ctx.editor : null);
const suggestionOf = (a, load, joint, now = new Date()) => suggestAssignment({
  client: a.client, n: a.n, shootType: a.ctx.shoot_type, joint, inCard: inCardOf(a), load, checks: checksOf(a.client), now,
});
// "שיוך ל<שם>" on the card: two taps on the same button, the first asks ("בטוח? שיוך ל…"),
// the second assigns (the pattern of the owner's "מפעילים" buttons, app/landing-control.js).
// Not a toast with "ביטול": an assignment cannot be taken back cleanly (the editor is rung
// within the minute, the editing days start, the folder task opens). The question goes
// away by itself, and a second tap that comes with the first (a double tap) is not an answer.
const ARM_MS = 6000;
const ARM_GUARD_MS = 350;
let armed = null; // { key, editor, at }
let armTimer = null;
let quickBusy = false;
function disarm(draw = true) {
  clearTimeout(armTimer);
  if (!armed) return;
  armed = null;
  if (draw && !busy()) renderKeepingFocus();
}
function arm(a, editor) {
  clearTimeout(armTimer);
  armed = { key: a.key, editor, at: Date.now() };  armTimer = setTimeout(() => disarm(), ARM_MS);
  renderKeepingFocus();
}
async function quickAssign(a, editor, joint) {
  if (quickBusy) return;
  quickBusy = true;
  disarm(false);
  renderKeepingFocus();
  let saved;
  try {
    saved = await saveAssign(a, editor, joint, '');
  } catch (err) {
    quickBusy = false;
    toast(`השיוך לא נשמר. ${errorText(err)}`);
    renderKeepingFocus();
    return;
  }
  quickBusy = false;
  renderKeepingFocus();
  $('assign-h').focus({ preventScroll: true });
  toast(`${a.client.name} שויך ל${PEOPLE[editor].name}.${saved.folder}`);
  offerHandoff({ client: saved.client, key: `${a.pre}p22a.assigned`, checks: () => checks[a.client.id], me });
}

function assignCard(a, load, now) {
  const type = a.ctx.shoot_type;
  const joint = jointFromSelection(selections.get(a.client.quote_id));
  const sug = suggestionOf(a, load, joint, now);
  // One tap for the usual case: a joint day (decision 31) or another editor for Natali goes
  // through the dialog, where a reason can be written (not required).
  const oneTap = !!sug.editor && !reasonNeeded({ shootType: type, joint, editor: sug.editor });
  const name = sug.editor ? PEOPLE[sug.editor].name : null;
  const id = a.key.replace(/\W/g, '_');
  if (armed?.key === a.key && (!oneTap || armed.editor !== sug.editor)) { clearTimeout(armTimer); armed = null; } // the suggestion changed under the question
  const sure = armed?.key === a.key;
  const label = `${a.client.name}${roundText(a.ctx)}`;
  // The day of the shoot as a leaf (a day that has passed is not "late": the camera's colour).
  const shot = a.ctx.shoot_at ? new Date(a.ctx.shoot_at) : null;
  return h('li', { class: 'of-card', 'data-key': a.key },
    h('div', { class: `of-head${shot ? ' has-leaf' : ''}` },
      shot ? dateLeaf({ ...leafOf(shot, now), tone: 'teal' }) : null,
      h('a', { class: 'wclient', href: clientUrl(a.client.id, a.proc.id) }, clientLabel(a.client)), landingTag(a.client),
      h('span', { class: 'wtitle' }, `${SHOOT_TYPES[type]?.name || 'סוג יום הצילום לא נקבע'}${roundText(a.ctx)}`),
      a.state.status === 'overdue' && a.client.landing !== true ? h('span', { class: 'sbadge s-overdue' }, h('span', { class: 'sicon', 'aria-hidden': 'true' }), 'באיחור') : null),
    h('p', { class: 'of-line as-shot' }, [a.ctx.shoot_at ? `הצילום: ${formatStamp(a.ctx.shoot_at)}` : null, joint ? 'יום משותף לנטלי ולסמיון' : null, scriptsLine(a.client.id, a.n)].filter(Boolean).join(' · ')),
    // An old client already in editing: its real editor is known in the office, not guessed here.
    a.client.landing === true ? h('p', { class: 'of-line muted as-landing' }, LANDING_EDITOR_LINE) : null,
    // Whom the system suggests, and why (the same number the load list below shows).
    h('p', { class: `k-note as-sug${sug.editor ? '' : ' k-note-warn'}`, id: `as-sug-${id}`, 'data-editor': sug.editor || '', 'data-why': sug.why },
      iconSquare(sug.editor ? 'user' : 'question', sug.editor ? 'teal' : 'orange', { size: 'sm' }),
      h('span', { class: 'as-sug-t' }, h('strong', {}, sug.editor ? `מומלץ: ${name}` : 'אין המלצה'), ` · ${sug.reason}`,
        sug.editor && !oneTap ? ' · ביום משותף בוחרים עורך בחלון' : '')),
    a.fast ? h('p', { class: 'of-line as-fast' }, ladderWords(a.fast, now), ` · לשייך עד ${formatWhen(a.fast.dueAt, now)}`) : null,
    // The assignment is Ofir's alone (protocol v9). Lior supervises here: he sees it, without the buttons.
    me === 'lior' ? h('p', { class: 'of-line muted as-ofir-only' }, 'אופיר משייך את העורך.') : h('div', { class: 'of-acts as-acts' },
      oneTap ? h('button', {
        type: 'button', class: `btn btn-sm as-go ${sure ? 'btn-primary is-sure' : 'k-btn-navy'}`, id: `as-go-${id}`, disabled: quickBusy,
        'aria-label': sure ? `בטוח? שיוך של ${label} ל${name}. לחיצה נוספת משייכת` : `שיוך של ${label} ל${name}`,
        onclick: () => {
          if (!sure) { arm(a, sug.editor); return; }
          if (Date.now() - armed.at < ARM_GUARD_MS) return;
          quickAssign(a, sug.editor, joint);
        },
      }, sure ? `בטוח? שיוך ל${name}` : `שיוך ל${name}`) : null,
      h('button', {
        type: 'button', class: `btn btn-sm${oneTap ? '' : ' k-btn-navy'}`, id: `as-open-${id}`, disabled: quickBusy,
        'aria-label': `${oneTap ? 'עורך אחר' : 'שיוך עורך'}: ${label}`, onclick: () => { disarm(); openAssign(a); },
      }, oneTap ? 'עורך אחר' : 'שיוך עורך'),
      sure ? h('span', { class: 'sr-only', role: 'status' }, `לחיצה נוספת משייכת את ${a.client.name} ל${name}.`) : null));
}

// Each job can change hands from here ("החלפת עורך"): the notice of an automatic
// assignment says so, and this is where Ofir looks for it.
const swapId = (j) => `sw-${j.client.id}${j.n ? `-r${j.n}` : ''}${j.second ? '-2' : ''}`;
// Folds the reader opened stay open across the page's refresh (the load per editor, "בקליטה").
const openFolds = new Set();
const keepFold = (key, open) => { if (open) openFolds.add(key); else openFolds.delete(key); };
// "עומס עורכים" is one line per editor (20.10.2026): the name, the load and what is late;
// the clients (and "החלפת עורך") open under it. The assign window keeps its recommendation.
function loadCard(l, now) {
  const late = l.jobs.filter((j) => j.dueAt && !j.landing && j.dueAt < now).length;
  const head = [personChip(l.editor), l.editor === 'nirel' ? h('span', { class: 'tag' }, 'נטלי בלבד') : null,
    h('span', { class: 'of-line' }, loadText(l)), late ? h('span', { class: 'late of-load-late' }, ` · ${late === 1 ? 'אחת באיחור' : `${late} באיחור`}`) : null];
  if (!l.jobs.length) return h('li', { class: 'of-card of-editor' }, h('div', { class: 'of-head' }, ...head));
  return h('li', { class: 'of-card of-editor' }, h('details', { class: 'of-load-fold', open: openFolds.has(l.editor) ? true : null, ontoggle: (e) => keepFold(l.editor, e.currentTarget.open) },
    h('summary', { class: 'of-head' }, ...head),
    h('ul', { class: 'of-jobs' }, ...l.jobs.map((j) => h('li', {},
      h('a', { href: clientUrl(j.client.id, `${j.pre ? j.pre.replace('.', '-') : ''}p22`) }, j.client.name, j.n ? ` · סבב ${j.n}` : ''),
      j.landing ? [' ', landingTag(j.client)] : ` · ${j.day === null ? 'טרם שויך' : dayText(j.day, j.of)}`,
      j.stage === 'closing' ? ' · תיקונים וסגירה' : '',
      ` · ${scriptsLine(j.client.id, j.n)}`,
      j.paused ? [' ', h('span', { class: 'tag tag-warn' }, 'עצורה')] : null,
      // Two editors on the shoot: with whom.
      j.partner && PEOPLE[j.partner] ? [' ', h('span', { class: 'tag as-partner' }, `יחד עם ${PEOPLE[j.partner].name}`)] : null,
      autoReasonOf(checksOf(j.client), j.pre) ? [' ', h('span', { class: 'tag' }, 'שויך אוטומטית')] : null,
      j.dueAt && !j.landing ? h('span', { class: `muted${j.dueAt < now ? ' late' : ''}` }, ` · יעד ${formatWhen(j.dueAt, now)}`) : null,
      h('button', {
        type: 'button', class: 'btn-text sw-btn', id: swapId(j),
        'aria-label': `החלפת עורך: ${j.client.name}${j.n ? `, סבב ${j.n}` : ''} (עכשיו ${PEOPLE[l.editor].name})`, onclick: () => openSwap(l.editor, j),
      }, 'החלפת עורך'))))));
}

// ── Dialogs ─────────────────────────────────
function dialog(id, onClose = null) {
  const d = $(id);
  d.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === d) d.close(); });
  d.addEventListener('close', () => { onClose?.(); if (!busy()) renderKeepingFocus(); returnFocus(); });
  return d;
}
let returnTo = null;
const returnFocus = () => { if (returnTo && document.getElementById(returnTo)) document.getElementById(returnTo).focus(); returnTo = null; };
const showErr = (id, text) => { $(id).textContent = text; $(id).hidden = false; };

// Quality control: the checks, then "אישור" or "החזרה לתיקון".
const qaDlg = dialog('dlg-qa');
let qaItem = null;
function openQa(x) {
  qaItem = x;
  returnTo = document.activeElement?.id || null;
  const k = QA_KINDS[x.kind];
  const now = new Date();
  $('qa-dlg-h').textContent = `בקרת איכות · ${x.client.name}`;
  $('qa-meta').textContent = `${k.title}${roundText(x.ctx)} · ${x.round > 1 ? `בדיקה ${x.round}, אחרי ${x.round - 1 === 1 ? 'סבב תיקונים אחד' : `${x.round - 1} סבבי תיקונים`}` : 'בדיקה ראשונה'} · ${x.landing ? LANDING_LINE : x.fast ? `${ladderWords(x.fast, now)} · לאשר עד ${formatWhen(x.dueAt, now)}` : `מחכה ${waitWords(x.waited)} · בקרה עד ${formatWhen(x.dueAt, now)}`}`;
  const last = x.rounds.at(-1);
  fill($('qa-prev'), last ? h('details', { class: 'of-prev', open: true },
    h('summary', {}, `מה הוחזר בסבב ${last.n} (לבדוק שתוקן)`),
    h('ul', {}, ...last.issues.map((i) => h('li', {}, i.ref ? `${k.unit} ${i.ref}: ${i.text}` : i.text)))) : null);
  // What is being checked. The videos are in the client's Drive (the editor's link, or
  // the card's); the ones uploaded into the system, if any, are played here. The
  // graphics are in the client's files.
  const videos = x.kind === 'videos';
  const first9 = x.kind === 'graphics9';
  const cs = checksOf(x.client);
  const drive = videos ? videosLinkOf(x.client, cs, x.pre) : null;
  forgetFiles(x.client.id);
  fill($('qa-files'),
    drive ? h('a', { class: 'btn', id: 'qa-drive', href: drive, target: '_blank', rel: 'noopener noreferrer' }, 'פתיחת הסרטונים בדרייב', h('span', { class: 'sr-only' }, ' (נפתח בחלון חדש)')) : null,
    videos && !drive ? h('p', { class: 'hint', id: 'qa-nodrive' }, 'אין קישור לסרטונים בדרייב. אם גם לא הועלו לכאן סרטונים: לבקש מהעורך.') : null,
    mountWorkFiles({
      client: x.client, kind: videos ? 'deliverable_video' : 'deliverable_graphic', me, readOnly: true, hideEmpty: videos, idp: 'qa-f', toast,
      window: videos ? videoWindow(x.client, cs, Number(/^r(\d+)\./.exec(x.pre)?.[1] || 1)) : graphicsWindow(cs, first9 ? 'first' : 'rest'),
      title: videos ? 'סרטונים שהועלו למערכת' : 'הגרפיקות לבדיקה',
      total: videos ? null : first9 ? 9 : Math.max(0, (Number(x.client.deliverables?.graphics) || 0) - 9) || null,
    }));
  renderChecks();
  setMode('check');
  $('qa-err').hidden = true;
  qaDlg.showModal();
  $('qa-checks').querySelector('input')?.focus();
}
function renderChecks() {
  const x = qaItem;
  const cs = checksOf(x.client);
  const k = QA_KINDS[x.kind];
  const labelOf = (key) => {
    const proc = x.proc.items.find((i) => i.key === `${x.pre}${key}`);
    return (proc?.label || key).replace(/^(נבדק|אופיר בדק): /, '');
  };
  // The five critical mistakes of editing (protocol v10) come under their own line. Videos that
  // were approved before they existed are not asked for them (`passedIf`: then they are not here).
  const itemOf = (key) => x.proc.items.find((i) => i.key === `${x.pre}${key}`);
  const asked = k.checks.filter((key) => !itemOf(key)?.history);
  $('qa-checks-legend').textContent = `${asked.length} הבדיקות (${k.title})`;
  fill($('qa-checks'), ...asked.flatMap((key, n) => {
    const full = `${x.pre}${key}`;
    const id = `qa-c-${key.replace(/\W/g, '_')}`;
    const critical = !!itemOf(key)?.mistake;
    return [
      critical && !itemOf(asked[n - 1])?.mistake ? h('p', { class: 'of-sub of-critical', id: 'qa-critical' }, CRITICAL_TITLE) : null,
      h('label', { class: 'wrow', for: id },
        h('input', { type: 'checkbox', class: 'cbx', id, checked: cs[full]?.state === 'done', onchange: (e) => toggleCheck(full, e.currentTarget) }),
        h('span', { class: 'wlabel' }, labelOf(key)))];
  }));
}
async function toggleCheck(key, input) {
  const c = qaItem.client;
  input.disabled = true;
  try {
    if (input.checked) (checks[c.id] ||= {})[key] = await setCheck(c.id, key, 'done');
    else { await clearCheck(c.id, key); delete checks[c.id][key]; }
  } catch (err) {
    input.checked = !input.checked;
    toast(`הסימון לא נשמר. ${errorText(err)}`);
  }
  input.disabled = false;
  input.focus();
}
function setMode(mode) {
  const ret = mode === 'return';
  $('qa-checks-box').hidden = ret;
  $('qa-return').hidden = !ret;
  $('qa-to-return').hidden = ret;
  $('qa-approve').hidden = ret;
  $('qa-back').hidden = !ret;
  $('qa-send-return').hidden = !ret;
  if (ret) {
    const n = qaState(checksOf(qaItem.client), qaItem.pre, qaItem.kind).returns + 1;
    $('qa-return-h').textContent = `החזרה לתיקון · סבב ${n}`;
    $('qa-return-hint').textContent = `לכל שורה: מספר ה${QA_KINDS[qaItem.kind].unit} ומה לתקן. הרשימה עוברת ${qaItem.kind === 'videos' ? 'לעורך' : 'לעילאי'} מיד.`;
    fill($('qa-issues'));
    addIssue();
    renderMistakes();
    $('qa-due').value = inputValueIL(fixDue(new Date()));
  }
}
// A critical mistake that failed (the videos; protocol v10): one tap adds a line that names it,
// and the usual return for fixes carries it to the editor. The video's number is typed as always.
function renderMistakes() {
  const box = $('qa-mistakes');
  const show = qaItem.kind === 'videos';
  box.hidden = !show;
  if (!show) { fill(box); return; }
  fill(box, h('p', { class: 'of-mistakes-h', id: 'qa-mistakes-h' }, 'טעות קריטית? לחיצה מוסיפה שורה:'),
    h('div', { class: 'chips-row of-mistake-chips' }, ...CRITICAL_MISTAKES.map(([key, name]) => h('button', {
      type: 'button', class: 'chip of-mistake', id: `qa-m-${key}`, 'data-mistake': key, onclick: () => addMistake(key),
    }, name))));
}
function addMistake(key) {
  const text = mistakeIssue(key);
  const rows = [...$('qa-issues').children];
  if (rows.some((li) => li.querySelector('[data-text]').value.trim() === text)) { toast('השורה הזאת כבר ברשימה.'); return; }
  // The first row, while it is still empty, takes it; otherwise a new row.
  let row = rows.find((li) => !li.querySelector('[data-text]').value.trim() && !li.querySelector('[data-ref]').value.trim());
  if (!row) { addIssue(); row = $('qa-issues').lastElementChild; }
  if (!row || row.querySelector('[data-text]').value.trim()) return;
  row.querySelector('[data-text]').value = text;
  row.querySelector('[data-ref]').focus();
}
function addIssue(focus = false) {
  const list = $('qa-issues');
  if (list.children.length >= ISSUE_MAX) { toast(`עד ${ISSUE_MAX} שורות בסבב אחד.`); return; }
  const i = list.children.length + 1;
  const unit = QA_KINDS[qaItem.kind].unit;
  const row = h('li', { class: 'of-issue' },
    h('div', { class: 'field of-ref' }, h('label', { for: `qa-ref-${i}` }, `${unit} מס׳`),
      h('input', { class: 'input', id: `qa-ref-${i}`, 'data-ref': '', maxlength: String(ISSUE_REF_MAX), inputmode: 'numeric', autocomplete: 'off', dir: 'ltr' })),
    h('div', { class: 'field grow' }, h('label', { for: `qa-text-${i}` }, 'מה לתקן'),
      h('textarea', { class: 'input', id: `qa-text-${i}`, 'data-text': '', rows: '2', maxlength: String(ISSUE_TEXT_MAX) })),
    h('button', {
      type: 'button', class: 'btn-text danger of-remove', 'aria-label': `הסרת שורה ${i}`,
      onclick: (e) => { const li = e.currentTarget.closest('li'); const prev = li.previousElementSibling; li.remove(); (prev?.querySelector('textarea') || $('qa-add')).focus(); },
    }, 'הסרה'));
  list.append(row);
  if (focus) row.querySelector('input').focus();
}
$('qa-add').addEventListener('click', () => addIssue(true));
$('qa-to-return').addEventListener('click', () => { setMode('return'); $('qa-err').hidden = true; $('qa-issues').querySelector('input')?.focus(); });
$('qa-back').addEventListener('click', () => { setMode('check'); $('qa-err').hidden = true; $('qa-checks').querySelector('input')?.focus(); });

// "אישור": only with every check done.
$('qa-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const x = qaItem;
  const k = QA_KINDS[x.kind];
  const cs = checksOf(x.client);
  const open = k.checks.filter((key) => cs[`${x.pre}${key}`]?.state !== 'done');
  if (open.length) {
    showErr('qa-err', `כדי לאשר צריך לסמן את כל ${k.checks.length} הבדיקות (חסרות ${open.length}). אם משהו לא תקין: ״החזרה לתיקון״.`);
    $(`qa-c-${open[0].replace(/\W/g, '_')}`)?.focus();
    return;
  }
  $('qa-approve').disabled = true;
  const key = `${x.pre}${k.approved}`;
  try {
    (checks[x.client.id] ||= {})[key] = await setCheck(x.client.id, key, 'done');
  } catch (err) {
    showErr('qa-err', `האישור לא נשמר. ${errorText(err)}`);
    $('qa-approve').disabled = false;
    return;
  }
  $('qa-approve').disabled = false;
  qaDlg.close();
  toast(x.kind === 'videos' ? `אושר. עירית מקבלת ״לשלוח ללקוח עכשיו״, וליאור ״קמפיין״.` : 'אושר. עירית מקבלת ״לשלוח ללקוח״.');
  states.clear();
  offerHandoff({ client: x.client, key, checks: () => checks[x.client.id], me });
});

// "החזרה לתיקון": the issues, the due time, the round.
$('qa-send-return').addEventListener('click', async () => {
  const x = qaItem;
  const issues = [...$('qa-issues').children].map((li) => ({ ref: li.querySelector('[data-ref]').value, text: li.querySelector('[data-text]').value }))
    .filter((i) => i.text.trim());
  if (!issues.length) {
    showErr('qa-err', 'כתבו לפחות שורה אחת: מה לתקן.');
    $('qa-issues').querySelector('textarea')?.focus();
    return;
  }
  const due = fromInputIL($('qa-due').value);
  if (!due) { showErr('qa-err', 'בחרו עד מתי לתקן.'); $('qa-due').focus(); return; }
  const c = x.client;
  const cs = checksOf(c);
  const n = qaState(cs, x.pre, x.kind).returns + 1;
  const key = returnKey(x.pre, x.kind, n);
  $('qa-send-return').disabled = true;
  try {
    (checks[c.id] ||= {})[key] = await setCheck(c.id, key, 'done', returnNote(issues, due));
  } catch (err) {
    showErr('qa-err', `ההחזרה לא נשמרה. ${errorText(err)}`);
    $('qa-send-return').disabled = false;
    return;
  }
  // The checks were of this version; the fixed one is checked again.
  const done = QA_KINDS[x.kind].checks.map((k) => `${x.pre}${k}`).filter((k) => cs[k]?.state === 'done');
  if (done.length) {
    try { await clearChecksBulk(c.id, done); for (const k of done) delete checks[c.id][k]; } catch { /* the return is saved; the checks stay */ }
  }
  $('qa-send-return').disabled = false;
  qaDlg.close();
  const fixer = QA_KINDS[x.kind].fixer(x.ctx);
  const whom = fixer === 'editor' ? 'לעורך' : `ל${PEOPLE[fixer]?.name || 'עורך'}`;
  toast(`הוחזר לתיקון (סבב ${n}). הרשימה עוברת ${whom}, עד ${formatWhen(due)}.`, {
    label: 'ביטול',
    run: async () => {
      try { await clearCheck(c.id, key); delete checks[c.id][key]; toast('ההחזרה בוטלה. הבדיקות נפתחו מחדש.'); renderKeepingFocus(); } catch (err) { toast(`הביטול לא נשמר. ${errorText(err)}`); }
    },
  });
});

// The assignment (22א).
const asDlg = dialog('dlg-assign');
let asItem = null;
const AS_AFTER = $('as-after').textContent;
function openAssign(a) {
  asItem = a;
  returnTo = document.activeElement?.id || null;
  const type = a.ctx.shoot_type;
  const joint = jointFromSelection(selections.get(a.client.quote_id));
  const sw = a.swap || null;
  $('as-h').textContent = `${sw ? 'החלפת עורך' : 'שיוך עורך'} · ${a.client.name}${roundText(a.ctx)}`;
  $('as-meta').textContent = sw
    ? [SHOOT_TYPES[type]?.name, `עכשיו אצל ${PEOPLE[sw.from].name}`, sw.job.day === null ? null : dayText(sw.job.day, sw.job.of), sw.job.paused ? 'העריכה עצורה' : null].filter(Boolean).join(' · ')
    : [SHOOT_TYPES[type]?.name, a.ctx.shoot_at ? `צולם ${formatStamp(a.ctx.shoot_at)}` : null, a.client.landing === true ? LANDING_LINE : a.fast ? `${ladderWords(a.fast, new Date())} · לשייך עד ${formatWhen(a.fast.dueAt)}` : a.dueAt ? `לשייך עד ${formatWhen(a.dueAt)}` : null].filter(Boolean).join(' · ');
  $('as-joint-wrap').hidden = type !== 'natali';
  $('as-joint').checked = joint;
  $('as-reason').value = '';
  $('as-err').hidden = true;
  $('as-submit').textContent = sw ? 'החלפה' : 'שיוך';
  $('as-after').textContent = sw ? 'ההחלפה נרשמת בהיסטוריה של הלקוח, העורך החדש מקבל את ההודעה על לקוח חדש בעריכה, ומוכן לו וואטסאפ עם שני המועדים.' : AS_AFTER;
  // The editing clocks of a swap (app/qa-logic.js swapClock): a late job keeps its deadlines unless Ofir says otherwise.
  $('as-clock-wrap').hidden = !sw;
  if (sw) {
    const now = new Date();
    const k = swapClock(sw.job, now);
    $('as-clock-restart').checked = k.choice === 'restart';
    $('as-clock-keep').checked = k.choice === 'keep';
    $('as-clock-restart-label').textContent = `לספור מחדש מהיום: יעד ${formatWhen(k.restartDue, now)}`;
    $('as-clock-keep-label').textContent = k.keepDue ? `להשאיר את המועד: יעד ${formatWhen(k.keepDue, now)}${k.late ? ' (באיחור)' : ''}` : 'להשאיר את המועדים כמו שהם';
    $('as-clock-late').hidden = !k.late;
    $('as-clock-late').textContent = k.late ? 'העריכה כבר באיחור. ההחלפה לא מאפסת את האיחור, אלא אם בוחרים לספור מחדש וכותבים למה.' : '';
  }
  renderEditors(true);
  asDlg.showModal();
  ($('as-editors').querySelector('input:checked') || $('as-editors').querySelector('input:not(:disabled)'))?.focus();
}
function renderEditors(preselect = false) {
  const a = asItem;
  const type = a.ctx.shoot_type;
  const joint = $('as-joint').checked;
  const load = editorLoad({ clients, stateOf, checks, tasks, now: new Date() });
  const pre = preselected(type, joint);
  const from = a.swap?.from || null;
  // The suggestion (protocol v9: Ofir assigns, the system only suggests): the rule's own
  // choice (Nirel for Natali), else the least loaded editor who may take this shoot. It is
  // marked and already chosen, so the usual case is one tap on "שיוך".
  // A swap preselects nobody but the rule's own, never the one who has it now.
  // The same answer as the card's line (suggestAssignment): an editor the office already
  // wrote in the card, the editor of the client's earlier round, else the least loaded.
  const sug = a.swap ? null : suggestionOf(a, load, joint);
  const inCard = inCardOf(a);
  const first = a.swap ? (pre && pre !== from ? pre : null) : sug.editor;
  const chosen = preselect ? first : $('as-editors').querySelector('input:checked')?.value || null;
  // A swap keeps the other editor of the pair: they are not offered in the place being swapped.
  const partner = a.swap?.job?.partner || null;
  fill($('as-editors'), ...eligibleEditors(type).map((k) => h('label', { class: 'wrow as-editor', for: `as-e-${k}` },
    h('input', { type: 'radio', class: 'radio', name: 'as-editor', id: `as-e-${k}`, value: k, checked: chosen === k, disabled: k === from || k === partner, onchange: () => { fillEditor2(); syncReason(); } }),
    h('span', { class: 'wlabel' }, h('strong', {}, PEOPLE[k].name), pre === k ? h('span', { class: 'tag' }, 'מסומנת מראש') : null,
      sug?.editor === k && sug.why === 'load' ? h('span', { class: 'tag as-suggested', id: 'as-suggested' }, SUGGESTED_TAG) : null,
      sug?.editor === k && sug.why === 'continuity' ? h('span', { class: 'tag as-suggested', id: 'as-suggested' }, CONTINUITY_TAG) : null,
      inCard === k ? h('span', { class: 'tag' }, 'רשום בכרטיס') : null,
      k === from ? h('span', { class: 'tag' }, 'העורך הנוכחי') : null,
      k === partner ? h('span', { class: 'tag' }, a.swap.job.second ? 'העורך הראשי' : 'העורך הנוסף') : null,
      h('span', { class: 'muted small as-load' }, loadText(load[k]))))));
  if (preselect) pairOpen = false;
  fillEditor2();
  syncReason();
}
// "+ עורך/ת נוסף/ת" (the owner's request of 21.10.2026): a second editor beside the chosen
// one, and how the package's videos are split between them ("נדיה 8 · יריב 4"). Offered on
// the first assignment, once the database has the column.
let pairOpen = false;
const videosOf = (ctx) => Number(ctx?.deliverables?.videos) || 0;
function fillEditor2() {
  const a = asItem;
  const can = !a.swap && editor2Ready();
  const main = $('as-editors').querySelector('input:checked')?.value || null;
  $('as-editor2-add').hidden = !can || pairOpen || !main;
  $('as-editor2-wrap').hidden = !can || !pairOpen || !main;
  if ($('as-editor2-wrap').hidden) return;
  const keys = eligibleEditors(a.ctx.shoot_type).filter((k) => k !== main);
  const was = $('as-editor2').value;
  fill($('as-editor2'), ...keys.map((k) => h('option', { value: k }, PEOPLE[k].name)));
  $('as-editor2').value = keys.includes(was) ? was : keys[0];
  fillSplit();
}
// The two numbers, even by default (the main editor takes the odd one).
function fillSplit() {
  const main = $('as-editors').querySelector('input:checked')?.value;
  const second = $('as-editor2').value;
  const total = videosOf(asItem.ctx);
  $('as-split-h').textContent = total ? `חלוקת הסרטונים (${total} לפי החבילה)` : 'חלוקת הסרטונים (לא חובה: מספר הסרטונים לא הוזן)';
  $('as-split-1-name').textContent = PEOPLE[main].name;
  $('as-split-2-name').textContent = PEOPLE[second].name;
  const even = evenSplit(total, main, second);
  $('as-split-1').value = even ? String(even[main]) : '';
  $('as-split-2').value = even ? String(even[second]) : '';
}
// The split as typed: null when both are empty (only allowed without a count).
function splitValue(main, second) {
  const v = (id) => ($(id).value.trim() === '' ? null : Number($(id).value));
  const a = v('as-split-1');
  const b = v('as-split-2');
  return a === null && b === null ? null : { [main]: a, [second]: b };
}
$('as-editor2-add').addEventListener('click', () => { pairOpen = true; fillEditor2(); $('as-editor2').focus(); });
$('as-editor2-remove').addEventListener('click', () => { pairOpen = false; fillEditor2(); $('as-editor2-add').focus(); });
$('as-editor2').addEventListener('change', fillSplit);
for (const id of ['as-split-1', 'as-split-2']) $(id).addEventListener('input', () => { $('as-err').hidden = true; });
// A swap that restarts the clocks of a late job needs its reason too.
function swapChoice() {
  const sw = asItem?.swap;
  if (!sw) return { late: false, restart: false };
  return { late: swapClock(sw.job, new Date()).late, restart: $('as-clock-restart').checked };
}
// The editor's reason itself is optional (21.10.2026): only a late job counted again needs one.
function needsReason(editor) {
  return swapReasonNeeded({ editor, ...swapChoice() });
}
function syncReason() {
  const a = asItem;
  const editor = $('as-editors').querySelector('input:checked')?.value || null;
  const joint = $('as-joint').checked;
  const need = needsReason(editor);
  $('as-reason-label').textContent = need ? 'סיבה (חובה)' : 'סיבה (לא חובה)';
  $('as-reason').required = need;
  $('as-reason-hint').textContent = reasonHint({ shootType: a.ctx.shoot_type, joint }) || 'הסיבה נשמרת בהיסטוריה של הלקוח.';
}
$('as-joint').addEventListener('change', () => renderEditors(true));
for (const id of ['as-clock-restart', 'as-clock-keep']) $(id).addEventListener('change', syncReason);

// "החלפת עורך": the same dialog, for a job that already has an editor.
function openSwap(from, job) {
  const c = job.client;
  const s = stateOf(c).states.find((x) => x.proc.id === `${job.n ? `r${job.n}-` : ''}p22a`);
  if (!s) { toast('לא נמצא שיוך להחלפה. רעננו את העמוד.'); return; }
  openAssign({ key: `${c.id}:${s.proc.id}`, client: c, pre: job.pre, n: job.n, proc: s.proc, ctx: s.proc.ctx || c, state: s, dueAt: s.dueAt, swap: { from, job } });
}
async function saveSwap(a, editor, joint, reason) {
  const c = a.client;
  const { from, job } = a.swap;
  const now = new Date();
  const k = swapClock(job, now);
  const restart = $('as-clock-restart').checked;
  const assigned = `${a.pre}p22a.assigned`;
  const prev = checks[c.id]?.[assigned]?.at || null;
  const client = await updateClient(c.id, swapEditor(c, a.n, from, editor));
  clients = clients.map((x) => (x.id === c.id ? client : x));
  // Marking 22א again, as the first assignment does, starts the editing days over.
  if (restart) for (const row of await setChecksBulk(c.id, ['p22a.load', 'p22a.assigned'].map((x) => `${a.pre}${x}`), 'done')) (checks[c.id] ||= {})[row.item_key] = row;
  (checks[c.id] ||= {})[REASON_KEY(a.pre)] = await setCheck(c.id, REASON_KEY(a.pre), 'done',
    swapNote({ editor, from, reason, preselected: preselected(a.ctx.shoot_type, joint), joint, restart, late: k.late, prev }));
  // The new editor starts: a pause of the one before ends, and its tasks close (as Lior's reassignment does).
  if (job.paused) {
    const pause = `${a.pre}p22.pause`;
    try {
      await clearCheck(c.id, pause);
      delete checks[c.id][pause];
      for (const t of tasks.filter((x) => x.client_id === c.id && x.source === 'pause' && !x.done_at)) {
        const done = await setTaskDone(t.id, true);
        tasks = tasks.map((x) => (x.id === t.id ? done : x));
      }
    } catch { /* the swap is saved; the pause is closed in the card */ }
  }
  states.clear();
  const due = restart ? `מועדי העריכה נספרים מהיום: יעד ${formatWhen(k.restartDue, now)}.` : k.late ? 'המועדים לא השתנו: העריכה נשארת באיחור.' : 'המועדים לא השתנו.';
  return { client, text: `${c.name} עבר מ${PEOPLE[from].name} ל${PEOPLE[editor].name}. ${due}` };
}
$('as-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const a = asItem;
  const editor = $('as-editors').querySelector('input:checked')?.value || null;
  const joint = $('as-joint').checked && a.ctx.shoot_type === 'natali';
  const reason = $('as-reason').value.trim();
  const pair = !a.swap && !$('as-editor2-wrap').hidden;
  const editor2 = pair ? $('as-editor2').value || null : undefined;
  const split = pair && editor2 ? splitValue(editor, editor2) : pair ? null : undefined;
  if (pair && editor2) {
    const bad = splitProblem(split, videosOf(a.ctx), editor, editor2);
    if (bad) { showErr('as-err', bad); $('as-split-1').focus(); return; }
  }
  if (!editor) { showErr('as-err', a.swap ? 'בחרו את העורך החדש.' : 'בחרו עורך.'); $('as-editors').querySelector('input:not(:disabled)')?.focus(); return; }
  if (needsReason(editor) && !reason) {
    $('as-reason').setAttribute('aria-invalid', 'true');
    showErr('as-err', 'העריכה כבר באיחור. כדי לספור את המועדים מחדש כתבו למה.');
    $('as-reason').focus();
    return;
  }
  $('as-reason').removeAttribute('aria-invalid');
  $('as-submit').disabled = true;
  const c = a.client;
  if (a.swap) {
    let saved;
    try {
      saved = await saveSwap(a, editor, joint, reason);
    } catch (err) {
      showErr('as-err', `ההחלפה לא נשמרה. ${errorText(err)}`);
      $('as-submit').disabled = false;
      return;
    }
    $('as-submit').disabled = false;
    asDlg.close();
    toast(saved.text);
    // As after the first assignment: a ready WhatsApp to the editor with both dates and the link.
    offerHandoff({ client: saved.client, key: `${a.pre}p22a.assigned`, checks: () => checks[c.id], me });
    return;
  }
  let saved;
  try {
    saved = await saveAssign(a, editor, joint, reason, editor2, split);
  } catch (err) {
    showErr('as-err', `השיוך לא נשמר. ${errorText(err)}`);
    $('as-submit').disabled = false;
    return;
  }
  $('as-submit').disabled = false;
  asDlg.close();
  toast(`${c.name} שויך ל${PEOPLE[editor].name}${editor2 ? ` ול${PEOPLE[editor2].name}` : ''}.${saved.folder}`);
  // Until stage 4, a ready WhatsApp to the editor with both dates and the link.
  offerHandoff({ client: saved.client, key: `${a.pre}p22a.assigned`, checks: () => checks[c.id], me });
});

// The first assignment's write, the same for the dialog's "שיוך" and for the card's
// "שיוך ל<שם>": the editor in the card, 22א's "נבדק העומס" and "שויך", Irit's and Lior's
// items that close with it, the reason when he wrote one, and Ofir's folder task (24).
// Throws when the assignment itself was not saved. → { client, folder (a sentence for the toast) }
async function saveAssign(a, editor, joint, reason, editor2 = undefined, split = undefined) {
  const c = a.client;
  const client = await updateClient(c.id, withEditor(c, a.n, editor, editor2, split));
  clients = clients.map((x) => (x.id === c.id ? client : x));
  const keys = ['p22a.load', 'p22a.assigned'].map((k) => `${a.pre}${k}`);
  for (const row of await setChecksBulk(c.id, keys, 'done')) (checks[c.id] ||= {})[row.item_key] = row;
  // Irit's check that the client moved to editing closes by itself (section 4, 5א).
  const irit = `${a.pre}p22a.irit`;
  if (checks[c.id][irit]?.state !== 'done') checks[c.id][irit] = await setCheck(c.id, irit, 'done', 'נסגר לבד: השיוך נרשם במערכת');
  // Lior's "the drive came back" (22א) is what he confirmed when he closed the shoot day
  // (19, "הכונן חזר אליי"): it closes with the assignment, so 22א does not stay open on it.
  const drive = `${a.pre}p22a.drive`;
  if (checks[c.id][`${a.pre}p19.took`]?.state === 'done' && !['done', 'na'].includes(checks[c.id][drive]?.state)) checks[c.id][drive] = await setCheck(c.id, drive, 'done', AUTO_DRIVE_NOTE);
  // The reason is optional: kept when Ofir wrote one.
  if (reason) {
    checks[c.id][REASON_KEY(a.pre)] = await setCheck(c.id, REASON_KEY(a.pre), 'done', reasonNote({ editor, reason, preselected: preselected(a.ctx.shoot_type, joint), joint }));
  }
  // Ofir's folder task (24), due at the end of editing day 1 (once: a swap opens none).
  let folder = '';
  const title = folderTitle(a.n);
  if (checks[c.id][`${a.pre}p24.folder`]?.state !== 'done' && !tasks.some((t) => t.client_id === c.id && t.title === title && !t.done_at)) {
    try {
      const t = await addTask({ client_id: c.id, title, owner: 'ofir', due_on: folderDueOn(new Date()) });
      tasks = [t, ...tasks];
      folder = ` נפתחה לאופיר משימת תיקייה (24) עד ${formatWhen(endOfDayIL(dayFromKeyIL(t.due_on)))}.`;
    } catch { folder = ' משימת התיקייה (24) לא נפתחה: לפתוח אותה בכרטיס.'; }
  }
  states.clear();
  return { client, folder };
}

// ── Boot ────────────────────────────────────
function goToSection(hash) {
  const el = /^#[a-z]+-h$/.test(hash) ? document.getElementById(hash.slice(1)) : null;
  if (!el || !$('of-page').contains(el)) return;
  el.scrollIntoView({ block: 'start' });
  el.focus({ preventScroll: true });
}
window.addEventListener('hashchange', () => { if (!$('of-page').hidden) goToSection(location.hash); });
$('btn-refresh').addEventListener('click', () => load());
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('app').hidden && !busy()) load(); });
setInterval(() => {
  if ($('app').hidden || $('of-page').hidden) return;
  if (Date.now() - lastLoad > 5 * 60e3 && !busy()) { load(); return; }
  if (!document.hidden && !busy()) renderKeepingFocus();
}, 60e3);

// The kit (docs/ops.md, section 52): each section's heading and each card take an icon square.
dress($('app'), [['#qa-h', 'shield', 'purple', 'md'], ['#char-h', 'target', 'orange', 'md'], ['#assign-h', 'scissors', 'blue', 'md'], ['#load-h', 'chart', 'teal', 'md'],
  ['#approvals-h', 'file', 'blue'], ['#myq-h', 'question', 'purple'], ['#na-h', 'lock', 'navy'],
  ['#qa-list .of-head, #qa-fixing .of-head', 'video', 'purple', 'md'], ['#assign-list .of-head:not(.has-leaf)', 'scissors', 'blue', 'md'], ['#load-list .of-head', 'user', 'teal']]);

// The two dialogs' heads (their titles are rewritten on every opening).
dress($('dlg-qa'), [['.dlg-head h2', 'shield', 'purple', 'md']]);
dress($('dlg-assign'), [['.dlg-head h2', 'scissors', 'blue', 'md']]);

mountSession(async (staff) => {
  const [dir, v] = await Promise.all([loadDirectory(), viewerOf(staff.email)]);
  Object.assign(directory, dir);
  viewer = v;
  me = v.me;
  markFirstLanded();
  // Lior's and Ofir's screens, and the owners': not Irit's (canSeeOfficeQueues, 8.10.2026).
  if (!canSeeOfficeQueues(v)) { $('no-access').hidden = false; return; }
  $('of-page').hidden = false;
  $('head-actions').prepend(...officeLinks(v, 'qa.html'));
  // "חוזים חריגים לאישור": Ofir's first screen.
  mountApprovals($('approvals-card'), v, { mail: staff.email, toast });
  await load();
  // A link to one of the queues (from "המשימות שלי": qa.html#qa-h, #assign-h): the page opens on it.
  goToSection(location.hash);
  // A link from the pass over the clients: qa.html#assign-<client id>[-r<round>].
  const m = /^#assign-([\w-]+?)(?:-r(\d+))?$/.exec(location.hash);
  if (m && me !== 'lior') {
    const a = awaitingEditor({ clients, stateOf, checks }).find((x) => x.client.id === m[1] && String(x.n || '') === (m[2] || ''));
    if (a) openAssign(a);
  }
  // A link straight to one check (the "עכשיו" clock and the ring of Ofir's fast ladder):
  // qa.html#review-<client id>-<process id>. Not there any more (approved, returned): the queue.
  const r = /^#review-([\w-]+)-((?:r\d+-)?p\d+[a-z]?)$/.exec(location.hash);
  if (r) {
    const x = qaQueue({ clients, stateOf, checks, meetings: meetings(), now: new Date() }).find((q) => q.key === `${r[1]}:${r[2]}`);
    if (x && me !== 'lior') openQa(x); else goToSection('#qa-h');
  }
});
