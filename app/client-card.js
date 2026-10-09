// Client card: the client's protocol by phase, checked off by each person in
// their role, with links, package quantities, shoot rounds, tasks, the weekly
// call and a full history of who checked what and when.
import {
  PEOPLE, PROCESSES, SHOOT_TYPES, CLIENT_STATUS, LINKS, DELIVERABLES, CALL_TOPICS,
  STAFF_PEOPLE, editorsFor, NETWORKS, ESCALATIONS, BRIEF_FIELDS, BRIEF_REQUIRED, BRIEF_MUST, STATUS_FIELDS,
} from './protocol.js';
import {
  clientState, missingFields, isResolved, blockers, openItemsFor, byUrgency, CLAIM, WAIT,
  waitNote, parseWaitNote, bulkEligible, roundsOf, isBusinessDay, PAUSE, pauseOf, WAITED, endWaitNote, readWaited,
} from './protocol-logic.js';
import {
  loadClient, loadChecks, loadLog, loadTasks, setCheck, clearCheck, setChecksBulk, clearChecksBulk,
  addTask, setTaskDone, updateClient, loadDirectory, loadQuoteSummary, loadCalls,
  loadAccess, saveAccess, revealAccess, deleteAccess, loadAccessLog, canUseVault, loadStatusNotes, setPasswordGate, GATE_CANCELLED,
} from './protocol-data.js';
import {
  $, fill, h, toast, errorText, personChip, peopleChips, formatWhen, formatDay, formatStamp, who,
  statusBadge, dueText, progressBar, mountSession, store, directory, viewerOf, VIEWER_UNKNOWN, CLIENT_PROCS, officeMinutes, endWaitText,
} from './protocol-ui.js';
import { whatsappLink } from './quote-doc.js';
import { safeLink } from './gantt-logic.js';
import { googleCalendarUrl, downloadIcs } from './calendar.js';
import { offerHandoff, dropHandoff, handoffLine, ensurePhones } from './handoff-ui.js';
import { describeMark } from './handoffs.js';
import { markHistory } from './production.js';
import { canManageTeam, isOwnerView } from './team-rules.js';
import { activate as activateLanding } from './landing-data.js';
import { TZ, dayKeyIL, addDaysIL, inputValueIL, fromInputIL } from './tz.js';
import { clientHealth, station, timeline } from './health.js';
import { healthHead, timelineBlock, questionsBlock } from './health-ui.js';
import { loadHealthExtras, loadQuestions, noteDateChange } from './owner-data.js';
import { shootDayHint, confirmShootDay } from './availability-ui.js';
// Stage 3, part 2: Ofir's returns for fixes, the office's marks in the history, "התחלתי".
import { qaLine, startControl } from './office-ui.js';
import { describeOfficeMark, qaState, QA_KINDS } from './office-marks.js';
import { accessChecked, AUTO_ACCESS_NOTE } from './ilai-logic.js';
import { dayBeforeText, readFollowup, followupText } from './shoot-prep.js';
import { checkMark } from './mark-guards.js';
import { stationTitle } from './messages-logic.js';

// A note as a person reads it. What the system keeps as JSON (Irit's day-before check,
// a list of videos) is never printed raw: the day-before result gets its line, anything
// else machine-made is left out (its own block in the card shows it).
function noteWords(key, note) {
  const text = String(note || '');
  if (!/^\s*[[{]/.test(text)) return text;
  if (String(key || '').replace(/^r\d+\./, '') === 'p15.irit') { const t = dayBeforeText(text); if (t !== null) return t; }
  try { JSON.parse(text); return ''; } catch { return text; }
}
import { folderItemOf } from './qa-logic.js';
import { loadOfirMeetings } from './office-data.js';
import { intakeShortcut, mountClientIntake, describeIntakeMark, writesScripts } from './intake-ui.js';
import { canWriteScripts } from './scripts-data.js';
// Stage 4: the client's status page, approvals, surveys and WhatsApp consent.
import { mountClientStatus } from './status-link-ui.js';
// The client's logins form (6.10.2026): its link, inside the vault's block.
import { mountAccessLink } from './access-link-ui.js';
import { seesAccessLinks } from './access-data.js';
import { askVaultCode, mountVaultHint } from './vault-gate.js';
import { ACCESS_STATUS_LABEL, NEW_STATUS, accessGapQuestion } from './access-logic.js';
// Stage 5: the monthly cycle (a draft), and items newer than the client's protocol version.
import { mountClientMonth, worksCycle } from './month-ui.js';
import { freshText } from './protocol-versions.js';
// The client's files ("תיק לקוח"): materials, deliverables and the client's gallery link.
import { mountClientFiles } from './files-ui.js';
import { uploadStepOf } from './files-logic.js';
// The manager's features: the contract summary, and archiving (the owner and Ofir).
import { contractSummary, fileCounts } from './contract-summary.js';
import { loadDeliverableFiles, archiveClient } from './manager-data.js';
import { canArchive } from './manager-rules.js';
import { openedBySigning } from './client-open.js';
import { warm, taken } from './supa.js';
import { fixTaskOf, FIX_ITEM_LABEL } from './late-chain.js';

const id = new URLSearchParams(location.search).get('id');
let client = null;
let checks = {};
let tasks = [];
let log = [];
let calls = [];               // weekly-call log rows, newest first
const shownProcs = new Set(); // completed processes whose items the user opened
let quote = null;            // the signed agreement the client was opened from
let access = [];             // network logins (without passwords)
let vaultOk = false;         // may this user see and edit logins (editors may not)
let statusNote = null;       // Ofir's latest weekly summary
let statusNotes = null;      // all of them (null: not loaded), for the Thursday rule
let healthExtras = null;     // messages, history and date changes, for the colour (office only)
let tlAll = false;           // the timeline shows everything done, not only the latest
let questions = null;        // questions to the one responsible about this client (null: none or not loaded)
let ofirMeetings = null;     // Ofir's meetings today (times only), for "אופיר באפיון, בקרה עד…" (null: not known)
let delivFiles = null;     // deliverables uploaded as files (null: no such table, or not readable)
let viewerInfo = null;     // viewerOf(): for archiving
let myEmail = '';
let me = null;               // this user's person key (staff.person; null for the owner)
let scope = 'office';        // 'own': only my processes and items; 'office': may show the whole protocol
let viewerError = null;      // the signed-in person could not be looked up
let showAll = false;         // office: the whole protocol instead of only mine (an explicit choice)
let focusPerson = '';        // whole protocol: highlighted person ('' = everyone)
let onlyFocus = false;       // whole protocol: hide processes the person has nothing in
let resolved = new Map();    // item key -> { proc, item } with owners resolved, for the current render
let printing = false;
const openPhases = new Set();
const shownDone = new Set(); // phases whose completed processes the user expanded
const pending = new Set();

const baseKey = (key) => key.replace(/^r\d+\./, '');
const roundOfKey = (key) => Number(/^r(\d+)\./.exec(key)?.[1] || 1);
const ITEM_INDEX = new Map(PROCESSES.flatMap((p) => p.items.map((i) => [i.key, { proc: p, item: i }])));
const labelOf = (key) => ITEM_INDEX.get(baseKey(key))?.item.label || key;
const FIELD_NAMES = {
  characterizer: 'מי מבצע את האפיון', char_at: 'מועד פגישת האפיון', shoot_type: 'סוג יום הצילום',
  shoot_at: 'מועד יום הצילום', has_logo: 'האם יש ללקוח לוגו', editor: 'העורך המשויך',
};
const FIELD_INPUT = { characterizer: 'ed-characterizer', char_at: 'ed-char-at', shoot_type: 'ed-shoot-type', shoot_at: 'ed-shoot-at', has_logo: 'ed-logo', editor: 'ed-editor' };
// The link each process works with, shown inside the process.
// (The Gantt is in the system: 9 links to no outside address. 24: the videos' Drive folder.)
const PROC_LINK = { p02: 'whatsapp', p06: 'metricool', p10: 'meta', p12: 'scripts', p24: 'drive' };
// The package quantity each process works to (the protocol's wording says "by the package").
const PKG_QTY = { p12: 'videos', p18: 'videos', p22: 'videos', p23: 'graphics' };
// What this user sees. 'own' roles see only their processes and items, and none of
// the office's controls (client details, rounds, package counts, closing the client).
// Office users see theirs first and can show the whole protocol. The owner has no
// person and sees the whole protocol, highlighting anyone. Screens only: the
// database decides what each user may read or change.
const own = () => scope === 'own';
const mineOnly = () => !!me && !showAll;
const viewPerson = () => (mineOnly() ? me : focusPerson);
const hasPart = (proc, person) => proc.items.some((i) => i.owners.includes(person));
const canAddTask = () => scope === 'office'; // 'own' roles report through the exception and pause forms
const names = (keys) => keys.map((k) => PEOPLE[k]?.name || k).join(', ');

// The client's first rows, asked for while the session is being confirmed (app/supa.js warm).
const firstRows = () => Promise.all([loadClient(id), loadChecks(id), loadTasks({ clientId: id })]);
if (id) { warm('card', firstRows); warm('card-vault', () => canUseVault(id)); }
async function load() {
  if (!id) { $('state').textContent = 'לא נבחר לקוח.'; return; }
  if (!client) $('state').textContent = 'טוען…';
  try {
    const [c, ch, t] = await taken('card', firstRows);
    if (!c) { showMissing(); return; }
    $('state').classList.remove('no-access');
    client = c;
    checks = ch[id] || {};
    tasks = t;
    primeBlocks();
    // The agreement and the rest are asked for side by side (they do not depend on each other).
    [quote, access, statusNotes, healthExtras, questions, ofirMeetings, delivFiles] = await Promise.all([
      c.quote_id && (!quote || quote.id !== c.quote_id) ? loadQuoteSummary(c.quote_id) : quote,
      vaultOk ? loadAccess(id).catch(() => []) : [],
      own() ? null : loadStatusNotes({ clientId: id }).catch(() => null),
      own() ? null : loadHealthExtras(id, new Date(Date.now() - 30 * 864e5).toISOString()),
      loadQuestions({ clientId: id }).catch(() => null),
      loadOfirMeetings(new Date().toISOString()).catch(() => null),
      own() ? null : loadDeliverableFiles(id),
    ]);
    statusNote = statusNotes?.[0] || null;
  } catch (err) {
    $('state').textContent = errorText(err);
    return;
  }
  $('state').textContent = '';
  document.title = `${client.name} · כרטיס לקוח · astrateg`;
  renderKeepingFocus();
  drawn = true;
  loadHistory();
}

// The blocks that read their own rows (the characterization, the status page, the
// client's files, the monthly cycle) start reading as soon as the client is known, at
// the same time as the rest of the card and not after its first drawing. Each draws
// itself when the card does; one that answers later asks the card to draw again.
let primed = false;
let drawn = false;
function primeBlocks() {
  if (primed) return;
  primed = true;
  const later = () => { if (drawn) renderKeepingFocus(); };
  const who = viewerError ? undefined : me;
  mountClientIntake($('ik-slot'), { client, scope, toast, rerender: later, scripts: false, me: who });
  mountClientStatus($('st-slot'), { client, scope, me, toast });
  mountClientFiles($('fl-slot'), { client, me: who, myEmail, toast });
  mountClientMonth($('mc-slot'), { client, state: clientState(client, checks, new Date()), me, scope, office: worksCycle({ me, scope, error: viewerError }), rerender: later });
}

// No client came back. The database shows each person only the clients they work
// on, so for an 'own' role this is usually a client that is not theirs (or no longer
// is: the editing moved to someone else); for the office, a wrong or old link.
function showMissing() {
  client = null;
  $('app').hidden = true;
  const st = $('state');
  st.classList.add('no-access');
  document.title = own() ? 'אין גישה ללקוח · astrateg' : 'הלקוח לא נמצא · astrateg';
  fill(st, ...(own() ? [
    h('strong', {}, 'אין לך גישה ללקוח הזה.'),
    h('span', {}, 'כאן נפתחים רק לקוחות שיש לך בהם עבודה: עריכה ששויכה אליך, יום צילום קרוב או משימה שלך. אם צריך אותו, פנו לליאור.'),
    h('a', { class: 'btn', href: 'clients.html#mine' }, '→ המשימות שלי'),
  ] : [
    h('strong', {}, 'הלקוח לא נמצא.'),
    h('span', {}, 'ייתכן שהקישור שגוי או ישן, או שהלקוח הועבר לארכיון.'),
    h('a', { class: 'btn', href: 'clients.html#clients' }, '→ כל הלקוחות'),
  ]));
}

// The scripts page (scripts.html): Lior and the owner always; anyone else when Lior
// granted them this client (asked once per client).
let scriptsGrant = { id: null, ok: false };
function scriptsOk() {
  if (viewerError) return false;
  if (writesScripts(me, scope)) return true;
  if (scriptsGrant.id !== client.id) {
    const cid = client.id;
    scriptsGrant = { id: cid, ok: false };
    canWriteScripts(cid).then((ok) => { if (ok && scriptsGrant.id === cid) { scriptsGrant.ok = true; renderKeepingFocus(); } });
  }
  return scriptsGrant.ok;
}

function render() {
  const s = clientState(client, checks, new Date());
  resolved = new Map(s.states.flatMap((x) => x.proc.items.map((i) => [i.key, { proc: x.proc, item: i }])));
  if (!openPhases.size) {
    const tp = s.states.find((x) => x.proc.id === location.hash.slice(1));
    // A link to someone else's process (from the office screens) shows the whole protocol.
    if (tp && mineOnly() && !own() && !hasPart(tp.proc, me)) showAll = true;
    const shown = mineOnly() ? s.states.filter((x) => hasPart(x.proc, me)) : s.states;
    // In "mine" the current phase is where my open work is.
    const cur = mineOnly() ? s.phases.find((ph) => shown.some((x) => x.proc.phase === ph.key && !x.complete && !x.proc.recurring))?.key : null;
    openPhases.add(cur || s.current);
    for (const x of shown) if (x.status === 'overdue') openPhases.add(x.proc.phase);
    if (tp) openPhases.add(tp.proc.phase);
  }
  renderHead(s);
  mountClientIntake($('ik-slot'), { client, scope, toast, rerender: () => renderKeepingFocus(), scripts: scriptsOk(), me: viewerError ? undefined : me });
  mountClientStatus($('st-slot'), { client, scope, me, toast });
  mountClientFiles($('fl-slot'), { client, me: viewerError ? undefined : me, myEmail, toast });
  renderAccess();
  renderQa(s);
  renderViewbar();
  renderPhases(s);
  mountClientMonth($('mc-slot'), { client, state: s, me, scope, office: worksCycle({ me, scope, error: viewerError }), rerender: () => renderKeepingFocus() });
  renderTimeline(s);
  renderTasks();
}

// ── Ofir's quality control (stage 3, part 2) ──
// Work with Ofir now (until when: "אופיר באפיון, בקרה עד HH:MM" while he is in a
// meeting) or returned by him with the list to fix ("תוקן" each, or all). Above the
// processes, since the returned work's own process may already be folded as done.
// The office sees all of it; anyone else only what they fix.
function renderQa(s) {
  const box = $('qa-block');
  if (!box) return;
  const parts = [];
  for (const x of s.states) {
    const pid = x.proc.id.replace(/^r\d+-/, '');
    const kind = { p24: 'videos', p23: 'graphics' }[pid];
    if (!kind) continue;
    const pre = x.proc.keyBase.slice(0, -pid.length);
    const ctx = x.proc.ctx || client;
    const q = qaState(checks, pre, kind);
    if (q.stage !== 'ofir' && q.stage !== 'fixing') continue;
    if (own() && QA_KINDS[kind].fixer(ctx) !== me) continue;
    parts.push(h('div', { class: 'qa-part' },
      h('h3', { class: 'qa-part-h' }, `${QA_KINDS[kind].title}${ctx.round ? ` · סבב צילום ${ctx.round}` : ''}`),
      qaLine({ client, checks, kind, pre, ctx, me, viewer: { me, scope, error: viewerError }, meetings: ofirMeetings, onChange: () => { renderKeepingFocus(); loadHistory(); } })));
  }
  box.hidden = !parts.length || printing;
  fill(box, parts.length ? h('h2', { class: 'qa-block-h', id: 'qa-block-h' }, 'בקרת האיכות של אופיר') : null, ...parts);
}

// ── The colour, now and next, and the timeline (office only; section 6, screen 3) ──
function healthNow(s) {
  const now = new Date();
  const ex = {
    now, checks, tasks: tasks.filter((t) => !t.done_at), statusNotes,
    messages: healthExtras?.messages ?? null, log: healthExtras?.log ?? null, dateChanges: healthExtras?.dateChanges ?? null,
    access: vaultOk ? access.map((a) => ({ ...a, client_id: client.id })) : null,
  };
  return { health: clientHealth(client, s, ex), st: station(client, s, ex), now };
}
function renderTimeline(s) {
  const slot = $('tl-slot');
  if (!client) { fill(slot); return; }
  const now = new Date();
  fill(slot, own() ? null : timelineBlock(timeline(client, s, checks, now), {
    now, showAll: tlAll, link: goTo, onToggle: () => { tlAll = !tlAll; renderKeepingFocus('tl-toggle'); },
  }), questionsBlock(questions));
}

// Periodic and background refreshes must not move keyboard focus or scroll.
function renderKeepingFocus(focusId = document.activeElement?.id) {
  const y = window.scrollY;
  render();
  window.scrollTo({ top: y });
  const el = focusId && document.getElementById(focusId);
  if (el && !el.disabled) el.focus({ preventScroll: true });
  else if (focusId) document.getElementById(focusId.replace(/-(na|bulk)$/, ''))?.focus({ preventScroll: true });
}

// ── Calendar ────────────────────────────────
const cardUrl = () => location.href.replace(/#.*$/, '');
function charEvent() {
  const c = client;
  return {
    uid: `${c.id}-char@astrateg`, title: `פגישת אפיון · ${c.name}`, start: c.char_at, minutes: 120,
    location: c.address || '',
    details: [c.characterizer ? `מבצע האפיון: ${PEOPLE[c.characterizer].name}.` : null, c.phone ? `טלפון הלקוח: ${c.phone}.` : null, `כרטיס הלקוח: ${cardUrl()}`].filter(Boolean).join('\n'),
  };
}
// The team arrives an hour before the influencers (process 17); the shoot lasts 3 hours
// with Natali (process 20) and about 5.5 with Denis, Michel and Semion (process 21).
function shootEvent(n = 1) {
  const r = n === 1 ? { shoot_at: client.shoot_at, shoot_type: client.shoot_type } : roundsOf(client).find((x) => x.n === n) || {};
  const type = r.shoot_type || client.shoot_type;
  const arrive = new Date(r.shoot_at);
  const start = new Date(arrive.getTime() - 36e5);
  const minutes = 60 + (type === 'dms' ? 330 : 180);
  const hhmm = arrive.toLocaleTimeString('he-IL', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  return {
    uid: `${client.id}-shoot-${n}@astrateg`,
    title: `יום צילום${n > 1 ? ` ${n}` : ''} · ${client.name}${type ? ` · ${SHOOT_TYPES[type].name}` : ''}`,
    start, minutes, location: client.address || '',
    details: [`הגעת המשפיענים: ${hhmm}. הצוות מגיע שעה לפני.`, 'מנהל יום הצילום: ליאור.',
      client.links?.scripts ? `תסריטים: ${client.links.scripts}` : null, `כרטיס הלקוח: ${cardUrl()}`].filter(Boolean).join('\n'),
  };
}
function calendarMenu(kind, n = 1) {
  const has = kind === 'char' ? client.char_at : (n === 1 ? client.shoot_at : roundsOf(client).find((x) => x.n === n)?.shoot_at);
  if (!has) return null;
  const ev = () => (kind === 'char' ? charEvent() : shootEvent(n));
  const name = kind === 'char' ? 'פגישת האפיון' : 'יום הצילום';
  const p11 = n === 1 ? 'p11.calendar' : `r${n}.p11.calendar`;
  return h('details', { class: 'cal' },
    h('summary', { 'aria-label': `הוספת ${name} ליומן` }, 'הוספה ליומן'),
    h('div', { class: 'cal-menu' },
      client.address ? null : h('p', { class: 'hint' }, 'אין כתובת עסק בכרטיס, והאירוע ייווצר בלי מקום. ',
        own() ? null : h('button', { type: 'button', class: 'btn-text', onclick: () => openEdit('ed-address') }, 'הוספת כתובת')),
      h('a', { class: 'btn btn-sm btn-ghost', href: googleCalendarUrl(ev()), target: '_blank', rel: 'noopener' }, 'Google Calendar'),
      h('button', {
        type: 'button', class: 'btn btn-sm btn-ghost',
        onclick: () => {
          downloadIcs(kind === 'char' ? `אפיון-${client.name}` : `יום-צילום-${client.name}`, ev());
          if (kind !== 'shoot') return;
          const owners = clientState(client, checks).states.flatMap((x) => x.proc.items).find((it) => it.key === p11)?.owners || [];
          const mine = me && owners.includes(me) && !checks[p11];
          toast('קובץ היומן ירד. אחרי ששלחתם אותו לכולם, סמנו ״יום הצילום הוכנס ליומן של כולם״.',
            mine ? { label: 'סימון כבוצע', run: () => mark(p11, 'done', null) } : null);
        },
      }, 'קובץ יומן (‎.ics)')));
}

// Escape closes an open calendar menu and returns focus to its button.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const open = document.activeElement?.closest('details.cal[open]') || document.querySelector('details.cal[open]');
  if (!open) return;
  open.open = false;
  open.querySelector('summary').focus();
});

// ── Header ──────────────────────────────────
function fact(k, v, extra = null) {
  return h('div', { class: 'fact' }, h('dt', {}, k), h('dd', {}, v || h('span', { class: 'muted' }, 'לא הוזן'), extra));
}

function nextFor(s) {
  const open = openItemsFor(viewPerson() || null, client, checks, s).sort(byUrgency);
  return open.find((x) => x.status !== 'client') || open[0] || null;
}

// With nothing of mine to check now: my next process and what it waits for, or a plain "nothing".
function nothingNext(s) {
  const x = client.status === 'cancelled' ? null : s.states.find((y) => !y.complete && !y.proc.recurring && hasPart(y.proc, me));
  if (!x) return h('p', { class: 'cc-next is-none' }, h('span', { class: 'k' }, 'הצעד הבא שלך'), h('span', {}, 'אין כרגע משהו פתוח אצלך בלקוח הזה.'));
  const why = dueText(x, new Date()) || 'ממתין לפריטים קודמים בפרוטוקול';
  return h('a', { class: 'cc-next s-waiting', href: `#${x.proc.id}`, onclick: (e) => { e.preventDefault(); goTo(x.proc.id); } },
    h('span', { class: 'k' }, 'התהליך הבא שלך'), h('span', {}, `${x.proc.num} · ${x.proc.title}`), h('span', { class: 'muted' }, why));
}

// A client from the old system that was not taken in yet: said once, at the top.
function landingNote() {
  const c = client;
  if (c.landing !== true || c.status === 'cancelled' || c.status === 'ended') return null;
  return h('div', { class: 'auto-note land-note', role: 'note', id: 'land-note' },
    h('p', {}, h('span', { class: 'tag tag-landing' }, 'בקליטה'), ' הלקוח הגיע מהמערכת הישנה ועוד לא הופעל: אין עליו שעונים, איחורים או התראות. מה שיישאר פתוח יקבל מועד חדש ביום ההפעלה.'),
    h('div', { class: 'auto-acts' },
      me ? h('a', { class: 'btn btn-sm', href: 'landing.html' }, 'לקליטת הלקוחות הקיימים') : null,
      isOwnerView(viewerInfo) ? h('button', {
        type: 'button', class: 'btn btn-sm btn-primary', id: 'land-activate',
        onclick: async (e) => {
          if (!confirm(`להפעיל את ${c.name}? מה שפתוח יקבל מועד חדש מעכשיו, וההתראות יחזרו.`)) return;
          e.currentTarget.disabled = true;
          try { await activateLanding([c.id]); toast('הלקוח הופעל. המועדים נספרים מעכשיו.'); await load(); } catch (err) { toast(errorText(err)); e.currentTarget.disabled = false; }
        },
      }, 'מפעילים את הלקוח') : null));
}

function autoBanner() {
  const c = client;
  if (own() || !openedBySigning(c, checks) || c.verified_at || c.status === 'cancelled') return null;
  return h('div', { class: 'auto-note', role: 'note' },
    h('p', {}, 'הלקוח נפתח אוטומטית כשנחתם הסכם ', quote?.number ? h('bdi', { class: 'num', dir: 'ltr' }, quote.number) : 'חתום',
      `${quote?.signed_at ? ` ב־${formatStamp(quote.signed_at)}` : ''}. מההסכם מולאו: חבילה, משפיענים, כמויות, סוג יום צילום וסיום חוזה. כדאי לעבור עליהם.`),
    h('div', { class: 'auto-acts' },
      h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: () => saveClient({ verified_at: new Date().toISOString() }, 'הפרטים אושרו.') }, 'הפרטים נכונים'),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => openEdit() }, 'עריכת פרטים'),
      h('button', { type: 'button', class: 'btn-text danger', onclick: () => openCancel() }, 'ההסכם בוטל')));
}

// The content Gantt of the client (gantt.html): in the system, next to the outside links.
const ganttChip = () => h('li', {}, h('a', { class: 'chip gantt-chip', href: `gantt.html?id=${encodeURIComponent(client.id)}`, id: 'cc-gantt' }, 'גאנט התוכן'));

function linksRow() {
  // Only an https:// address becomes a link (safeLink): a stored value of any other
  // kind (an old import, a write that went around the form) is shown as missing.
  const links = Object.fromEntries(LINKS.map((l) => [l.key, safeLink(client.links?.[l.key])]));
  const set = LINKS.filter((l) => links[l.key]);
  // 'own': the links to work with, nothing to edit.
  if (own()) {
    return h('nav', { class: 'cc-links', 'aria-label': 'קישורים של הלקוח' },
      h('span', { class: 'me-label' }, 'קישורים:'),
      h('ul', { class: 'chips-row' }, ganttChip(), ...set.map((l) => h('li', {}, h('a', { class: 'chip link-chip', href: links[l.key], target: '_blank', rel: 'noopener' },
        l.label, h('span', { class: 'sr-only' }, ' (נפתח בחלון חדש)'))))));
  }
  const missing = LINKS.filter((l) => !links[l.key] && checks[l.after]?.state === 'done');
  return h('nav', { class: 'cc-links', 'aria-label': 'קישורים של הלקוח' },
    h('span', { class: 'me-label' }, 'קישורים:'),
    h('ul', { class: 'chips-row' }, ganttChip(),
        ...set.map((l) => h('li', {}, h('a', { class: 'chip link-chip', href: links[l.key], target: '_blank', rel: 'noopener' },
          l.label, h('span', { class: 'sr-only' }, ' (נפתח בחלון חדש)')))),
        ...missing.map((l) => h('li', {}, h('button', { type: 'button', class: 'chip chip-missing', onclick: () => openEdit(`ed-link-${l.key}`) }, `חסר: ${l.label}`)))),
    h('button', { type: 'button', class: 'btn-text', onclick: () => openEdit(`ed-link-${LINKS[0].key}`) }, set.length ? 'עריכת קישורים' : 'הוספת קישורים'));
}

// Ofir's latest weekly summary of where the client stands.
function statusNoteBlock() {
  const n = statusNote;
  if (!n || own()) return null;
  const parts = STATUS_FIELDS.map(([k, l]) => (n[k] ? [h('dt', {}, l), h('dd', {}, n[k])] : null)).filter(Boolean).flat();
  return h('section', { class: 'status-note', 'aria-label': 'סיכום מצב שבועי' },
    h('div', { class: 'deliv-head' }, h('h2', {}, 'סיכום מצב שבועי'),
      h('span', { class: 'hint' }, `${who(n.by_email)} · ${formatStamp(n.at)}`)),
    h('dl', { class: 'call-sum' }, ...parts,
      n.owner ? h('dt', {}, 'אחראי') : null, n.owner ? h('dd', {}, PEOPLE[n.owner]?.name || n.owner) : null,
      n.due_on ? h('dt', {}, 'מועד יעד') : null, n.due_on ? h('dd', {}, formatDay(n.due_on)) : null));
}

// ── Access vault ────────────────────────────
// The vault's statuses in words, with 'new': a login the client filled in the form
// (app/access-logic.js) that nobody checked yet.
const STATUS_LABEL = ACCESS_STATUS_LABEL;
const networkName = (k) => NETWORKS.find(([n]) => n === k)?.[1] || k;
// The logins themselves: only for whoever may use this client's vault
// (can_use_client_vault in the database). The link to the client's logins form, at
// the top of the block: for the office (the owner, Irit, Lior and Ofir manage it),
// also without the vault flag.
function renderAccess() {
  // Without the vault flag the block is there only for the link (and only once the
  // form exists in the database and there is something to show).
  const show = () => {
    const linked = !!$('al-slot').firstChild;
    $('access').hidden = !vaultOk && !linked;
    $('access-novault').hidden = vaultOk || !linked;
  };
  mountAccessLink($('al-slot'), {
    client, viewer: { me, scope, error: viewerError }, toast, onDraw: show,
    onFilled: () => { load().then(refreshAccess); },
  });
  for (const k of ['access-add', 'access-list', 'access-log-box']) $(k).hidden = !vaultOk;
  show();
  if (!vaultOk) return;
  fill($('access-list'), ...(access.length ? access.map((a) => h('li', { class: `access-row a-${a.status}` },
    h('div', { class: 'access-main' },
      // 'other' is shown by its own name (LinkedIn, the site…), as the client or the office wrote it.
      h('strong', {}, a.network === 'other' && a.label ? a.label : networkName(a.network)), a.label && a.network !== 'other' ? h('span', { class: 'muted' }, ` · ${a.label}`) : null,
      h('div', { class: 'imeta' },
        a.username ? h('span', { dir: 'ltr', class: 'num' }, a.username) : h('span', { class: 'muted' }, 'אין שם משתמש'),
        h('span', { class: `tag${a.status === 'ok' ? '' : ' tag-warn'}` }, STATUS_LABEL[a.status]),
        h('span', { class: 'by' }, `עודכן · ${who(a.updated_by)} · ${formatStamp(a.updated_at)}`),
        a.note ? h('span', { class: 'inote' }, a.note) : null),
      h('div', { class: 'secret', id: `sec-${a.id}` })),
    h('div', { class: 'access-acts' },
      a.has_secret ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => reveal(a) }, 'הצגת סיסמה') : h('span', { class: 'muted' }, 'אין סיסמה'),
      h('button', { type: 'button', class: 'btn-text', onclick: () => openAccess(a) }, 'עריכה'),
      h('button', { type: 'button', class: 'btn-text danger', onclick: () => removeAccess(a) }, 'מחיקה'))))
    : [h('li', { class: 'empty' }, 'עוד לא הוכנסו גישות. כל גישה תקינה נכנסת לכאן מיד, לא נשארת בוואטסאפ.')]));
}
async function refreshAccess() {
  if (!vaultOk) return;
  try { access = await loadAccess(id); } catch { /* keep the old list */ }
  renderAccess();
  await autoAccessCheck();
  await refreshAccessLog();
}
// Process 6: once every login in the vault has a status set after the access came
// in, the check is done by itself (Ilai, system-plan section 3; app/ilai-logic.js).
async function autoAccessCheck() {
  const got = checks['p05.access'];
  if (checks['p06.verified'] || got?.state !== 'done' || !accessChecked(access, got.at)) return;
  if (await mark('p06.verified', 'done', null, AUTO_ACCESS_NOTE)) toast('כל הרשתות בכספת קיבלו סטטוס: בדיקת הגישות (6) סומנה.');
}
// Only the log: re-rendering the list would wipe a password being shown.
async function refreshAccessLog() {
  try {
    const rows = await loadAccessLog(id);
    const verb = { create: 'הוסיף/ה', update: 'עדכן/ה', reveal: 'צפה/תה בסיסמה של', delete: 'מחק/ה' };
    fill($('access-log'), ...(rows.length ? rows.map((r) => h('li', {}, h('span', { class: 'num muted' }, formatStamp(r.at)), ' ',
      h('strong', {}, who(r.by_email)), ` ${verb[r.action]} ${networkName(r.network)}`)) : [h('li', { class: 'empty' }, 'אין עדיין פעולות.')]));
  } catch { /* the log is informational */ }
}
const revealTimers = {};
// A copied password does not stay on the clipboard: 30 seconds later it is written
// over (best effort: a browser lets a page write the clipboard only while it is in
// front, and never read it, so this cannot tell whether something else was copied since).
let clipTimer = null;
async function copySecret(pw) {
  try { await navigator.clipboard.writeText(pw); } catch { toast('ההעתקה לא הצליחה.'); return; }
  toast('הסיסמה הועתקה. היא תימחק מהלוח בעוד 30 שניות.');
  clearTimeout(clipTimer);
  clipTimer = setTimeout(clearClipboard, 30e3);
}
async function clearClipboard() {
  clipTimer = null;
  try { await navigator.clipboard.writeText(''); } catch { /* the page is not in front: nothing more to do */ }
}
async function reveal(a) {
  const box = $(`sec-${a.id}`);
  try {
    const pw = await revealAccess(a.id);
    fill(box, h('span', { class: 'num', dir: 'ltr' }, pw || '—'),
      h('button', { type: 'button', class: 'btn-text', onclick: () => copySecret(pw || '') }, 'העתקה'),
      h('span', { class: 'hint' }, 'הצפייה נרשמה. הסיסמה תוסתר בעוד 30 שניות, וגם תימחק מהלוח אם הועתקה.'));
    toast('הסיסמה מוצגת ליד הרשת. הצפייה נרשמה.');
    clearTimeout(revealTimers[a.id]);
    revealTimers[a.id] = setTimeout(() => { const b = document.getElementById(`sec-${a.id}`); if (b) fill(b); }, 30e3);
    refreshAccessLog();
  } catch (err) {
    if (err?.message === GATE_CANCELLED) return; // the code's dialog was closed
    // The unlock ended between the check and the reveal: the next press asks for the code.
    toast(/vault locked/.test(String(err?.message || '')) ? 'הכספת ננעלה. לחצו שוב על ״הצגת סיסמה״ והקלידו את הקוד.' : `לא ניתן להציג את הסיסמה. ${errorText(err)}`);
  }
}
// "קוד הכספת" (app/vault-gate.js): every reveal asks for it through the one gate of
// protocol-data.js. When the unlock ends, the passwords shown here are hidden.
setPasswordGate(askVaultCode);
const hideSecrets = () => { for (const b of document.querySelectorAll('#access-list .secret')) fill(b); };
// Leaving the page takes a shown password off it, so that "back" (the browser's
// page cache) cannot bring it up again; a copied one leaves the clipboard right away.
window.addEventListener('pagehide', () => { hideSecrets(); if (clipTimer) { clearTimeout(clipTimer); clearClipboard(); } });
async function removeAccess(a) {
  if (!confirm(`למחוק את הגישה ל־${networkName(a.network)}? הסיסמה תימחק מהכספת.`)) return;
  try { await deleteAccess(a.id); toast('הגישה נמחקה.'); refreshAccess(); } catch (err) { toast(errorText(err)); }
}

// ── Package quantities and shoot rounds ─────
const saveTimers = {};
function bump(key, delta) {
  const d = client.deliverables || {};
  const done = { ...(d.done || {}) };
  const before = done[key] || 0;
  const next = Math.max(0, before + delta);
  if (next === before) return;
  done[key] = next;
  client = { ...client, deliverables: { ...d, done } };
  renderKeepingFocus();
  clearTimeout(saveTimers[key]);
  const status = document.getElementById(`deliv-${key}-s`);
  if (status) status.textContent = 'שומר…';
  const original = saveTimers[`${key}-from`] ?? before;
  saveTimers[`${key}-from`] = original;
  saveTimers[key] = setTimeout(async () => {
    delete saveTimers[`${key}-from`];
    delete saveTimers[key];
    try {
      client = await updateClient(id, { deliverables: client.deliverables });
    } catch (err) {
      const back = { ...(client.deliverables.done || {}), [key]: original };
      client = { ...client, deliverables: { ...client.deliverables, done: back } };
      toast(`הכמות לא נשמרה ולכן חזרה ל־${original}. ${errorText(err)}`);
    }
    renderKeepingFocus();
  }, 800);
}

function roundsSummary(s) {
  const total = client.deliverables?.shoot_days;
  const rounds = [{ n: 1, shoot_at: client.shoot_at }, ...roundsOf(client)];
  const parts = rounds.map((r) => {
    const phase = r.n === 1 ? null : s.phases.find((p) => p.key === `round-${r.n}`);
    const done = r.n === 1 ? ['prep', 'eve', 'shoot', 'post', 'publish'].every((k) => s.phases.find((p) => p.key === k)?.complete !== false)
      : phase?.complete;
    return `סבב ${r.n}${done ? ' הושלם' : r.shoot_at ? ` ב־${formatDay(r.shoot_at)}` : ' · טרם נקבע'}`;
  });
  return h('div', { class: 'deliv-row' },
    h('span', { class: 'deliv-k' }, 'ימי צילום'),
    h('span', {}, parts.join(' · '), total ? h('span', { class: 'num muted' }, ` · ${rounds.length} מתוך ${total}`) : null),
    h('button', { type: 'button', class: 'btn btn-sm', onclick: () => openRound() }, 'הוספת סבב צילום'));
}

function deliverablesBlock(s) {
  const d = client.deliverables || {};
  const rows = DELIVERABLES.filter((x) => (d[x.key] || 0) > 0);
  const hasAny = rows.length || d.shoot_days !== undefined;
  return h('section', { class: 'deliv', 'aria-labelledby': 'deliv-h' },
    h('div', { class: 'deliv-head' }, h('h2', { id: 'deliv-h' }, 'מה כלול בחבילה'), h('span', { class: 'hint' }, 'נספר כשהלקוח קיבל ואישר.')),
    hasAny ? null : h('p', { class: 'muted' }, 'הכמויות בחבילה לא הוזנו. ',
      h('button', { type: 'button', class: 'btn-text', onclick: () => openEdit('ed-deliv-videos') }, 'הזנת כמויות')),
    ...rows.map((x) => {
      const total = d[x.key];
      const done = d.done?.[x.key] || 0;
      const over = done > total ? ` (${done - total} מעבר לחבילה)` : '';
      return h('div', { class: 'deliv-row' },
        h('span', { class: 'deliv-k' }, x.label),
        h('span', { class: 'deliv-v', id: `deliv-${x.key}-v`, 'aria-live': 'polite' }, `נמסרו ${done} מתוך ${total}${over}`),
        progressBar(Math.min(done, total), total, `${x.label} שנמסרו`),
        h('span', { class: 'deliv-btns' },
          h('button', { type: 'button', class: 'step', id: `deliv-${x.key}-minus`, 'aria-label': `הפחתת ${x.one} שנמסר`, disabled: done === 0, onclick: () => bump(x.key, -1) }, '−'),
          h('button', { type: 'button', class: 'step', id: `deliv-${x.key}-plus`, 'aria-label': `הוספת ${x.one} שנמסר`, onclick: () => bump(x.key, 1) }, '+')),
        h('span', { class: 'hint', id: `deliv-${x.key}-s` }));
    }),
    roundsSummary(s),
    d.updated_at ? h('p', { class: 'hint' }, `עודכן · ${who(d.updated_by)} · ${formatStamp(d.updated_at)}`) : null);
}

function renderHead(s) {
  const c = client;
  const phone = c.phone ? h('span', {},
    h('a', { href: `tel:${c.phone.replace(/[^\d+]/g, '')}`, dir: 'ltr' }, c.phone), ' · ',
    h('a', { href: whatsappLink(c.phone, ''), target: '_blank', rel: 'noopener' }, 'WhatsApp')) : null;
  const charBy = c.characterizer ? PEOPLE[c.characterizer].name : null;
  const next = nextFor(s);
  const nextLabel = next?.status === 'client'
    ? `ממתין ללקוח (${next.proc.num} · ${next.proc.title})`
    : next ? `${next.proc.num} · ${next.proc.title}` : null;
  const vp = viewPerson();
  // 'own': progress of my processes only; the office sees the client's.
  const counted = s.states.filter((x) => !x.proc.recurring && x.proc.phase !== 'renewal' && (!own() || hasPart(x.proc, me)));
  const prog = own()
    ? { done: counted.filter((x) => x.complete).length, total: counted.length, label: 'התהליכים שלי שהושלמו', overdue: counted.filter((x) => x.status === 'overdue').length, waiting: counted.filter((x) => x.status === 'client').length }
    : { done: s.procsDone, total: s.procsTotal, label: 'תהליכים שהושלמו', overdue: s.overdue, waiting: s.waitingOnClient };
  const shootFact = fact('יום צילום', [c.shoot_type ? SHOOT_TYPES[c.shoot_type].name : null, c.shoot_at ? formatStamp(c.shoot_at) : null].filter(Boolean).join(' · ') || null, calendarMenu('shoot'));
  const editorFact = fact('עורך', c.editor ? PEOPLE[c.editor]?.name : c.editor_name);
  fill($('cc-head'),
    landingNote(),
    autoBanner(),
    c.status === 'cancelled' ? h('div', { class: 'auto-note', role: 'note' }, h('p', {}, `ההסכם בוטל${c.closed_reason ? `: ${c.closed_reason}` : '.'}`)) : null,
    h('div', { class: 'cc-top' },
      h('div', {},
        // The station, as the "עכשיו" line below and the status page name it (not the protocol's phase).
        h('div', { class: 'kicker' }, c.status === 'active' ? `שלב נוכחי: ${stationTitle(c, s, new Date())}` : CLIENT_STATUS[c.status]),
        h('h1', {}, c.name),
        h('p', { class: 'muted' }, [c.business, c.package_name].filter(Boolean).join(' · ') || ' ')),
      h('div', { class: 'head-actions' },
        h('button', { type: 'button', class: 'btn btn-sm btn-ghost', id: 'btn-escalate', onclick: () => openEscalate() }, 'דיווח חריגה לליאור'),
        h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => window.print() }, 'הדפסה'),
        own() ? null : h('button', { type: 'button', class: 'btn btn-sm', id: 'btn-edit', onclick: () => openEdit() }, 'עריכת פרטים'),
        canArchive(viewerInfo) ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost btn-danger', id: 'btn-archive', onclick: () => archiveThis() }, 'העברה לארכיון') : null)),
    // Office: the colour and why, now (station, who, until when), next (and what the client owes).
    own() || c.status === 'cancelled' || c.status === 'ended' ? null : (() => { const x = healthNow(s); return healthHead(x.health, x.st, x.now); })(),
    h('div', { class: 'cc-progress' },
      h('span', {}, prog.label),
      h('strong', { class: 'num', dir: 'ltr' }, `${prog.done}/${prog.total}`),
      progressBar(prog.done, prog.total, prog.label),
      prog.overdue ? statusBadge('overdue', null) : null,
      prog.overdue ? h('span', { class: 'num' }, `${prog.overdue} תהליכים`) : null,
      prog.waiting ? statusBadge('client', null) : null,
      prog.waiting ? h('span', { class: 'num' }, `${prog.waiting} תהליכים`) : null),
    next ? h('a', { class: `cc-next s-${next.status}`, href: `#${next.proc.id}`, onclick: (e) => { e.preventDefault(); goTo(next.proc.id); } },
      h('span', { class: 'k' }, vp === me && me ? 'הצעד הבא שלך' : vp ? `הצעד הבא אצל ${PEOPLE[vp].name}` : 'הצעד הבא'),
      h('span', {}, nextLabel),
      next.status === 'client' ? null : statusBadge(next.status, next.dueAt, new Date()))
      : mineOnly() ? nothingNext(s) : null,
    // 'own': only the details that serve the work (where, when, who edits).
    own() ? h('dl', { class: 'facts cc-facts' }, fact('כתובת העסק', c.address), shootFact, editorFact)
      : h('dl', { class: 'facts cc-facts' },
        fact('טלפון', phone),
        fact('כתובת העסק', c.address),
        fact('פרטי העסקה התקבלו', c.deal_at ? formatStamp(c.deal_at) : null),
        fact('פגישת אפיון', c.char_at ? `${formatStamp(c.char_at)}${charBy ? ` · ${charBy}` : ''}` : charBy, calendarMenu('char')),
        shootFact,
        fact('לוגו', c.has_logo === true ? 'יש' : c.has_logo === false ? 'אין, עילאי מכין' : null),
        editorFact,
        fact('סיום החוזה', c.contract_end ? formatDay(c.contract_end) : null)),
    own() ? null : contractBlock(s),
    statusNoteBlock(),
    linksRow(),
    own() ? null : deliverablesBlock(s),
    c.notes ? h('p', { class: 'cc-notes' }, c.notes) : null,
  );
  fill($('cc-sticky'),
    h('span', { class: 'sticky-name' }, c.name),
    h('strong', { class: 'num', dir: 'ltr' }, `${prog.done}/${prog.total}`),
    progressBar(prog.done, prog.total, prog.label),
    prog.overdue ? statusBadge('overdue', null) : null);
}

// ── The contract summary (app/contract-summary.js) ──
// What the signed agreement grants against what was done, from what the team marks,
// the counter below and the files uploaded as deliverables. The office's (no prices).
function contractBlock(s) {
  const now = new Date();
  const sum = contractSummary(client, s, checks, { files: delivFiles ? fileCounts(delivFiles, client.id) : null, now });
  const when = [sum.month?.text, client.contract_end ? `סיום החוזה ${formatDay(client.contract_end)}` : null].filter(Boolean).join(' · ');
  const renewal = sum.renewal ? (sum.renewal.state === 'later' ? `חלון החידוש ${sum.renewal.text}` : sum.renewal.text) : null;
  return h('section', { class: 'cs', id: 'contract-summary', 'aria-labelledby': 'cs-h' },
    h('div', { class: 'cs-head' }, h('h2', { id: 'cs-h' }, 'סיכום החוזה'),
      when ? h('span', { class: 'cs-when' }, when) : null,
      renewal ? h('span', { class: 'cs-when' }, h('span', { class: sum.renewal.state === 'open' ? 'is-open' : null }, renewal)) : null),
    sum.empty ? h('p', { class: 'muted' }, 'בכרטיס לא הוזן מה כלול בחוזה. ',
      h('button', { type: 'button', class: 'btn-text', onclick: () => openEdit('ed-deliv-videos') }, 'הזנת כמויות'))
      : h('ul', { class: 'cs-items' }, ...sum.items.map((x) => h('li', { class: `cs-item${x.over ? ' is-over' : ''}`, id: `cs-${x.key}` },
        h('span', { class: 'cs-n num', dir: 'ltr' }, String(x.done), h('small', {}, `/${x.total}`)),
        h('span', { class: 'cs-t' }, x.text),
        progressBar(Math.min(x.done, x.total), x.total, `${x.short} שבוצעו`)))),
    sum.flags.length ? h('p', { class: 'cs-flags' }, `כלול גם: ${sum.flags.join(' · ')}`) : null,
    sum.empty ? null : h('p', { class: 'hint' }, `בוצע: הגבוה מבין מה שסומן בפרוטוקול, המונה ״נמסרו״ בכרטיס${delivFiles ? ' והקבצים שהועלו' : ''}.`));
}

// ── Archive (the owner and Ofir; the database checks) ──
async function archiveThis() {
  const name = client.business || client.name;
  if (!confirm(`להעביר את ${name} לארכיון?\nהלקוח ייעלם מכל הרשימות, הדפים והקישורים שלו (גם דף המצב ללקוח) לא ייפתחו, והכספת שלו תיסגר. אפשר לשחזר אותו מהארכיון במבט המנהל.`)) return;
  try {
    await archiveClient(client.id);
  } catch (err) {
    toast(`ההעברה לארכיון לא נשמרה. ${errorText(err)}`);
    return;
  }
  location.href = 'owner.html#archive';
}

function goTo(procId) {
  const st = clientState(client, checks).states.find((x) => x.proc.id === procId);
  // Someone else's process (from the history) needs the whole protocol; 'own' views link only to their own.
  if (st && mineOnly() && !own() && !hasPart(st.proc, me)) showAll = true;
  if (st) { openPhases.add(st.proc.phase); shownDone.add(st.proc.phase); render(); }
  const el = document.getElementById(procId);
  el?.scrollIntoView({ block: 'start' });
  el?.querySelector('.cbx:not(:disabled)')?.focus({ preventScroll: true });
}

// ── What is shown ──────────────────────────
// 'own': always only mine. Office: mine by default, the whole protocol on request
// (remembered in this browser), where one person can be highlighted. The owner
// sees the whole protocol and can highlight anyone ("view as").
function renderViewbar() {
  const acts = h('div', { class: 'viewbar-acts' },
    h('button', { type: 'button', class: 'btn-text', onclick: () => { for (const p of clientState(client, checks).phases) { openPhases.add(p.key); shownDone.add(p.key); } render(); } }, 'פתיחת הכול'),
    h('button', { type: 'button', class: 'btn-text', onclick: () => { openPhases.clear(); openPhases.add('__none'); shownDone.clear(); render(); } }, 'קיפול'));
  const toggle = me && !own() ? h('button', {
    type: 'button', class: 'btn btn-sm btn-ghost view-toggle', id: 'view-toggle',
    onclick: () => { showAll = !showAll; store.set('card.all', showAll ? '1' : ''); renderKeepingFocus('view-toggle'); },
  }, showAll ? 'רק התהליכים שלי' : 'הצגת כל הפרוטוקול') : null;
  if (own() && !me) {
    fill($('viewbar'), h('p', { class: 'err', role: 'alert' }, viewerError ? VIEWER_UNKNOWN : 'לא הוגדר לך תפקיד בפרוטוקול. פנו למנהל המערכת.'));
    return;
  }
  if (mineOnly()) {
    fill($('viewbar'), h('p', { class: 'view-note' }, h('span', { class: 'me-label' }, 'מוצג:'), ' ',
      own() ? 'רק התהליכים והפריטים שלך בלקוח הזה.' : 'רק התהליכים והפריטים שלך.'), toggle, acts);
    return;
  }
  const opts = [['', 'כל הצוות'], ...STAFF_PEOPLE().map((p) => [p.key, p.key === me ? `${p.name} (אני)` : p.name])];
  const choose = (k) => { focusPerson = k; store.set('focus', k); render(); };
  fill($('viewbar'),
    h('div', { class: 'chips-row wide-only', role: 'group', 'aria-label': 'הדגשה לפי עובד' },
      h('span', { class: 'me-label' }, 'הצגה לפי עובד:'),
      ...opts.map(([k, label]) => h('button', {
        type: 'button', class: 'chip', 'aria-pressed': String(focusPerson === k), onclick: () => choose(k),
      }, label))),
    h('label', { class: 'narrow-only person-select' }, h('span', {}, 'הצגה לפי:'),
      h('select', { class: 'input', onchange: (e) => choose(e.currentTarget.value) },
        ...opts.map(([k, label]) => h('option', { value: k, selected: focusPerson === k }, label)))),
    focusPerson ? h('label', { class: 'only' },
      h('input', { type: 'checkbox', checked: onlyFocus, onchange: (e) => { onlyFocus = e.currentTarget.checked; render(); } }),
      ` רק התהליכים של ${PEOPLE[focusPerson].name}`) : null,
    toggle,
    acts,
  );
}

// ── Phases and processes ────────────────────
function roundHeader(ph) {
  const r = roundsOf(client).find((x) => x.n === ph.round);
  if (!r) return null;
  const has = Object.keys(checks).some((k) => k.startsWith(`r${r.n}.`));
  return h('div', { class: 'round-head' },
    h('span', {}, [r.shoot_type ? SHOOT_TYPES[r.shoot_type].name : null, r.shoot_at ? `יום צילום ${formatStamp(r.shoot_at)}` : 'מועד יום הצילום טרם נקבע'].filter(Boolean).join(' · ')),
    own() ? null : h('button', { type: 'button', class: 'btn-text', onclick: () => openRound(r.n) }, 'עריכת הסבב'),
    calendarMenu('shoot', r.n),
    has || own() ? null : h('button', { type: 'button', class: 'btn-text danger', onclick: () => deleteRound(r.n) }, 'מחיקת הסבב'));
}

function renderPhases(s) {
  const now = new Date();
  if (own() && !me) { fill($('phases')); return; }
  // Whose processes are listed: mine, or (whole protocol) the highlighted person's when asked.
  const only = mineOnly() ? me : onlyFocus && focusPerson ? focusPerson : null;
  const phases = s.phases.map((ph, idx) => {
    const list = ph.states.filter((x) => !only || hasPart(x.proc, only));
    if (!list.length) return null;
    // "Mine": the phase's counts are of my processes.
    const counted = list.filter((x) => !x.proc.recurring);
    const meta = mineOnly()
      ? { late: list.filter((x) => x.status === 'overdue').length, done: counted.filter((x) => x.complete).length, total: counted.length, complete: counted.length > 0 && counted.every((x) => x.complete) }
      : { late: ph.states.filter((x) => x.status === 'overdue').length, done: ph.procsDone, total: ph.procsTotal, complete: ph.complete };
    const late = meta.late;
    const done = list.filter((x) => x.complete);
    // (A recurring process, the daily follow-up or the weekly call, is never "complete": it does not fold the done ones away.)
    const showDone = printing || shownDone.has(ph.key) || done.length === counted.length;
    const missing = missingFields(ph.round ? { needs: [] } : ph, client);
    const det = h('details', { class: `phase${ph.key === s.current ? ' is-current' : ''}${ph.round ? ' is-round' : ''}`, open: printing || openPhases.has(ph.key) },
      h('summary', {},
        h('span', { class: 'ph-idx num' }, String(idx + 1)),
        h('span', { class: 'ph-title' }, h('h2', {}, ph.title), ph.key === s.current ? h('span', { class: 'ph-now' }, 'פתוח עכשיו') : null),
        h('span', { class: 'ph-meta' },
          late ? statusBadge('overdue', null) : null,
          meta.complete ? h('span', { class: 'sbadge s-done' }, h('span', { class: 'sicon', 'aria-hidden': 'true' }), 'הושלם') : null,
          meta.total ? h('span', { class: 'num', dir: 'ltr' }, `${meta.done}/${meta.total}`) : null,
          meta.total ? progressBar(meta.done, meta.total, `${mineOnly() ? 'התהליכים שלי' : 'תהליכים'} שהושלמו בשלב ${ph.title}`) : null)),
      ph.round ? roundHeader(ph) : null,
      ph.note ? h('p', { class: 'ph-note' }, ph.note) : null,
      missing.length ? h('div', { class: 'need ph-need', role: 'note' },
        h('span', {}, `חלק מהתהליכים בשלב תלויים בפרטים שחסרים: ${missing.map((f) => FIELD_NAMES[f]).join(', ')}.`, own() ? ' המשרד משלים אותם.' : ''),
        own() ? null : h('button', { type: 'button', class: 'btn btn-sm', onclick: () => openEdit(FIELD_INPUT[missing[0]]) }, 'השלמת פרטים')) : null,
      h('div', { class: 'procs' },
        !showDone && done.length ? h('button', {
          type: 'button', class: 'done-row', 'aria-expanded': 'false', onclick: () => { shownDone.add(ph.key); redrawPhases(); },
        }, h('span', { class: 'sbadge s-done' }, h('span', { class: 'sicon', 'aria-hidden': 'true' })),
        `${done.length} תהליכים הושלמו (${done.map((x) => x.proc.num).join(', ')})`, h('span', { class: 'btn-text' }, 'הצגה')) : null,
        ...list.filter((x) => showDone || !x.complete).map((x) => procCard(x, now, s)),
        (ph.key === 'publish' || ph.round) && !own() ? h('div', { class: 'round-add' },
          h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => openRound() }, 'הוספת סבב צילום')) : null));
    det.addEventListener('toggle', () => {
      if (printing) return;
      openPhases.delete('__none');
      if (det.open) openPhases.add(ph.key); else openPhases.delete(ph.key);
    });
    return h('section', { class: 'phase-wrap', 'aria-label': ph.title }, det);
  });
  const none = mineOnly() && !phases.some(Boolean);
  fill($('phases'), ...phases, none ? h('p', { class: 'empty' }, own() ? 'אין לך תהליכים בלקוח הזה.'
    : 'אין לך תהליכים בלקוח הזה. ״הצגת כל הפרוטוקול״ מציג את כל התהליכים.') : null);
}

function claimLine(x) {
  const p = x.proc;
  if (p.owners.length < 2 || x.complete) return null;
  if (x.claim) {
    return h('span', { class: 'claim' }, `${PEOPLE[x.claim.person]?.name || x.claim.person} לקח/ה · ${formatStamp(x.claim.at)}`,
      x.claim.person === me ? h('button', { type: 'button', class: 'btn-text', onclick: () => setClaim(p, null) }, 'שחרור') : null);
  }
  return h('span', { class: 'claim' }, 'לא נלקח',
    me && p.owners.includes(me) ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => setClaim(p, me) }, 'אני על זה') : null);
}

async function setClaim(p, person) {
  const ok = await mark(CLAIM(p), person ? 'done' : null, null, person);
  if (ok) toast(person ? `לקחת את תהליך ${p.num}.` : 'התהליך שוחרר.');
}

function waitLine(x) {
  if (!x.wait) return null;
  const w = x.wait;
  return h('div', { class: 'wait-line', id: `${x.proc.id}-wait` },
    h('span', {}, `מאז ${formatStamp(w.at)} · ${who(w.by_email)}${w.reason ? ` · ״${w.reason}״` : ''}${w.recheck ? ` · לבדוק שוב: ${formatDay(w.recheck)}` : ''}`),
    h('button', { type: 'button', class: 'btn-text', onclick: () => openWait(x) }, 'עריכה'),
    h('button', { type: 'button', class: 'btn-text', onclick: () => endWait(x) }, 'סיום המתנה'));
}

// Ending a wait stops the client's clock: its office minutes are added to the
// process's waited time first, and the deadline moves on by them (decision 3).
async function endWait(x) {
  const w = x.wait;
  const tk = WAITED(x.proc);
  const prevWaited = checks[tk];
  const ended = endWaitNote(client, x.proc, checks);
  const setWaited = (note) => mark(tk, note === null ? null : 'done', null, note);
  if (!await setWaited(ended)) return;
  if (!await mark(WAIT(x.proc), null, null)) { await setWaited(prevWaited?.note ?? null); return; }
  toast(endWaitText(prevWaited?.note, ended), {
    label: 'ביטול',
    // The waited time goes back first, then the wait; if the wait cannot be
    // restored, the finished wait's minutes are kept (never counted twice or lost).
    run: async () => {
      if (!await setWaited(prevWaited?.note ?? null)) return;
      if (!await mark(WAIT(x.proc), 'done', null, waitNote(w.reason, w.recheck, w.at))) await setWaited(ended);
    },
  });
}

// Editing paused for another task: who, at what stage, what is left, and for what.
function pauseLine(x) {
  const p = pauseOf(x.proc, checks);
  // The assigned editor pauses (any editor while none is assigned); Lior and Ofir can too.
  const owners = x.proc.owners;
  const canPause = me && (owners.includes(me) || ['lior', 'ofir'].includes(me) || (owners.includes('editor') && PEOPLE[me]?.editor));
  if (!p) {
    return !x.complete && canPause ? h('button', { type: 'button', class: 'btn-text', onclick: () => openPause(x) }, 'עצירת העריכה למשימה אחרת') : null;
  }
  return h('div', { class: 'wait-line pause-line' },
    h('span', {}, `העריכה נעצרה · ${who(p.by_email)} · ${formatStamp(p.at)}${p.stage ? ` · שלב: ${p.stage}` : ''}${p.left ? ` · נשאר: ${p.left}` : ''}${p.why ? ` · בגלל: ${p.why}` : ''}`),
    h('button', { type: 'button', class: 'btn-text', onclick: () => resumeEditing(x) }, 'חזרה לעריכה'));
}

function bulkButton(x) {
  const items = bulkEligible(x, me, client, checks);
  if (items.length < 2) return null;
  const open = x.proc.items.filter((i) => !i.optional && !isResolved(i, checks[i.key]));
  const all = items.length === open.length;
  const label = all ? `סימון כל התהליך כבוצע (${items.length})` : `סימון כל הפריטים שלי כבוצעו (${items.length})`;
  return h('button', {
    type: 'button', class: 'btn btn-sm btn-ghost bulk-btn', id: `${x.proc.id}-bulk`,
    'aria-label': `סימון ${items.length} פריטים כבוצעו בתהליך ${x.proc.num} · ${x.proc.title}`,
    onclick: () => markBulk(x, items),
  }, label);
}

async function markBulk(x, items) {
  const keys = items.map((i) => i.key);
  const prev = Object.fromEntries(keys.map((k) => [k, checks[k]]));
  const note = 'בסימון כל התהליך';
  for (const k of keys) { pending.add(k); checks[k] = { state: 'done', note, at: new Date().toISOString(), by_email: myEmail }; }
  renderKeepingFocus(`${x.proc.id}-bulk`);
  try {
    const rows = await setChecksBulk(id, keys, 'done', note);
    for (const r of rows) checks[r.item_key] = r;
  } catch (err) {
    for (const k of keys) { if (prev[k]) checks[k] = prev[k]; else delete checks[k]; }
    for (const k of keys) pending.delete(k);
    renderKeepingFocus(`${x.proc.id}-bulk`);
    toast(`הסימון לא נשמר ולכן בוטל. אף פריט לא סומן. ${errorText(err)}`);
    return;
  }
  for (const k of keys) pending.delete(k);
  // A process completed this way no longer waits on the client (as with a single check).
  await endWaitIfComplete(keys[0]);
  render();
  offerHandoff({ client, keys, checks: () => checks, me, canTeam: canTeam(), onSent: afterHandoff });
  // Focus: the first item still open in this process; else the next open process in the phase; else the phase.
  const left = document.querySelector(`#${CSS.escape(x.proc.id)} .cbx:not(:checked):not(:disabled)`);
  const phaseEl = document.getElementById(x.proc.id)?.closest('details.phase')
    || [...document.querySelectorAll('details.phase')].find((d) => d.querySelector('.done-row'));
  const nextProc = phaseEl?.querySelector('.proc:not(.s-done) h3');
  (left || nextProc || phaseEl?.querySelector('summary'))?.focus?.();
  loadHistory();
  const stillOpen = x.proc.items.filter((i) => !i.optional && !checks[i.key]).map((i) => `״${i.label}״`);
  const where = `בתהליך ${x.proc.num} · ${x.proc.title}`;
  toast(stillOpen.length ? `סומנו ${keys.length} פריטים. ${stillOpen.join(', ')} נשאר פתוח לסימון נפרד.` : `סומנו ${keys.length} פריטים ${where}.`, {
    label: 'ביטול',
    run: async () => {
      try {
        await clearChecksBulk(id, keys);
        for (const k of keys) { delete checks[k]; dropHandoff(k); }
        renderKeepingFocus(`${x.proc.id}-bulk`);
        loadHistory();
        toast(`הסימון של ${keys.length} הפריטים בוטל.`);
      } catch (err) {
        toast(`הביטול לא נשמר. הפריטים נשארו מסומנים. ${errorText(err)}`);
      }
    },
  });
}

// After WhatsApp was opened for a handoff: the "העברות" line and the history show it.
const afterHandoff = () => { renderKeepingFocus(); loadHistory(); };
// A missing WhatsApp number: the team page (where it is added) is linked only for those who can open it.
const canTeam = () => canManageTeam({ me, scope, error: viewerError });

// A block opened or folded inside the protocol: only the protocol is drawn again, not
// the whole card (the head, the files, the vault and the rest did not change).
function redrawPhases(focusId = null) {
  const y = window.scrollY;
  renderPhases(clientState(client, checks, new Date()));
  window.scrollTo({ top: y });
  if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
}

function procCard(x, now, s) {
  const p = x.proc;
  const pid = p.id.replace(/^r\d+-/, '');
  // Highlighting a person applies to the whole protocol; in "mine" everything shown is mine.
  const hl = mineOnly() ? '' : focusPerson;
  const mine = hl && hasPart(p, hl);
  const dim = hl && !mine && x.status !== 'overdue';
  // "Mine": only my items; the others' are summed up in one line.
  const items = mineOnly() ? p.items.filter((i) => i.owners.includes(me)) : p.items;
  const hidden = p.items.filter((i) => !items.includes(i));
  const req = items.filter((i) => !i.optional);
  const count = mineOnly() ? { resolved: req.filter((i) => isResolved(i, checks[i.key])).length, required: req.length } : x;
  const ctx = p.ctx || client;
  const missing = missingFields(p, ctx);
  const guidance = p.guidance ? (ctx.shoot_type ? [p.guidance[ctx.shoot_type]] : Object.values(p.guidance)) : [];
  const compact = x.complete && !printing && !shownProcs.has(p.id);
  const link = PROC_LINK[pid] && safeLink(client.links?.[PROC_LINK[pid]]);
  const linkDef = LINKS.find((l) => l.key === PROC_LINK[pid]);
  const pkgQty = PKG_QTY[pid] ? client.deliverables?.[PKG_QTY[pid]] : null;
  const pkgUnit = DELIVERABLES.find((d) => d.key === PKG_QTY[pid])?.label;
  // 'own' roles mark a wait only where the client is part of their work.
  const canWait = !x.complete && !p.recurring && (own() ? CLIENT_PROCS.has(pid) : x.ready || CLIENT_PROCS.has(pid));
  // Handoffs out of this process: who the work went to, and a WhatsApp button.
  const handoffs = printing ? null : handoffLine({ client, checks: () => checks, state: s, x, me, canTeam: canTeam(), onSent: afterHandoff });
  return h('article', { class: `proc s-${x.status}${mine ? ' is-mine' : ''}${dim ? ' is-dim' : ''}`, id: p.id, 'aria-labelledby': `${p.id}-h`, 'aria-describedby': x.wait ? `${p.id}-wait` : null },
    h('header', { class: 'proc-head' },
      h('span', { class: 'pnum num' }, p.num),
      h('div', { class: 'proc-title' },
        h('h3', { id: `${p.id}-h`, tabindex: '-1' }, p.title),
        h('div', { class: 'proc-meta' },
          peopleChips(x.claim ? [x.claim.person] : p.owners),
          compact ? null : h('span', { class: 'sla' }, p.sla),
          dueText(x, now) ? h('span', { class: 'due num' }, dueText(x, now)) : null,
          pkgQty && !compact ? h('span', { class: 'muted pkg-qty' }, `בחבילה של הלקוח: ${pkgQty} ${pkgUnit}`) : null,
          claimLine(x))),
      h('div', { class: 'proc-status' },
        statusBadge(x.status, x.dueAt, now),
        p.recurring || compact ? null : h('span', { class: 'num muted', dir: 'ltr' }, `${count.resolved}/${count.required}`),
        x.complete && !printing ? h('button', {
          type: 'button', class: 'btn-text', 'aria-expanded': String(!compact), id: `${p.id}-items`,
          onclick: () => { if (compact) shownProcs.add(p.id); else shownProcs.delete(p.id); redrawPhases(`${p.id}-items`); },
        }, compact ? 'הצגת הפריטים' : 'הסתרת הפריטים') : null,
        canWait && !x.wait ? h('button', { type: 'button', class: 'btn-text wait-btn', onclick: () => openWait(x) }, 'ממתין ללקוח') : null)),
    compact ? handoffs : null,
    compact ? null : [
      waitLine(x),
      pid === 'p22' || pid === 'p27' ? pauseLine(x) : null,
      p.ownerNote ? h('p', { class: 'proc-note' }, p.ownerNote) : null,
      missing.length ? h('div', { class: 'need', role: 'note' },
        h('span', {}, `חסר בפרטי הלקוח: ${missing.map((f) => FIELD_NAMES[f]).join(', ')}.`, own() ? ' המשרד משלים אותם.' : ''),
        own() ? null : h('button', { type: 'button', class: 'btn btn-sm', onclick: () => (p.ctx ? openRound(p.ctx.round) : openEdit(FIELD_INPUT[missing[0]])) }, 'השלמת פרטים')) : null,
      p.what ? h('p', { class: 'proc-what' }, p.what) : null,
      link ? h('a', { class: 'plink', href: link, target: '_blank', rel: 'noopener' }, `פתיחת ${linkDef.label}`) : null,
      printing ? null : intakeShortcut(p.id, client.id, { checks, scope, complete: x.complete, me }),
      ...guidance.map((g) => h('p', { class: 'proc-guide' }, g)),
      p.rule ? h('p', { class: 'proc-rule' }, h('strong', {}, 'חובה: '), p.rule) : null,
      h('ul', { class: 'items' }, ...items.map((i) => itemRow(p, i))),
      handoffs,
      hidden.length ? h('p', { class: 'others-note' },
        `ועוד ${hidden.length === 1 ? 'פריט אחד' : `${hidden.length} פריטים`} בתהליך הזה אצל ${names([...new Set(hidden.flatMap((i) => i.owners))].filter((o) => o !== me))}.`) : null,
      bulkButton(x),
    ],
  );
}

function itemRow(p, i) {
  const c = checks[i.key];
  const state = c && isResolved(i, c) ? c.state : null;
  const cid = `i-${i.key.replace(/\./g, '-')}`;
  const busy = pending.has(i.key);
  const block = state ? null : blockers(i, p.ctx || client, checks);
  // Outside the office, a mark that hands finished files on is pressed on the page
  // where the files go up (the editor's page, Ilai's cards): its lock is seen there.
  const via = state || !own() ? null : uploadStepOf(i.key, me, client.id);
  const ownOwners = i.owners.join() !== p.owners.join();
  const mine = !mineOnly() && focusPerson && i.owners.includes(focusPerson);
  const meta = [];
  if (c && (!i.recurring)) {
    const verb = c.state === 'na' ? (i.optional ? 'לא נדרש' : 'סומן לא רלוונטי') : 'בוצע';
    meta.push(h('span', { class: 'by' }, `${verb} · ${who(c.by_email)} · ${formatStamp(c.at)}`));
    const note = noteWords(i.key, c.note);
    if (note) meta.push(h('span', { class: 'inote' }, c.state === 'na' ? `סיבה: ${note}` : note));
  }
  if (block) {
    // "Waiting for": items above in this process, others' items, items of other processes.
    // In "mine" the others' items are not shown, so they are named with who holds them.
    const ref = (k) => resolved.get(k) || { proc: ITEM_INDEX.get(baseKey(k))?.proc, item: { owners: [] } };
    const by = (keys) => names([...new Set(keys.flatMap((k) => ref(k).item.owners))].filter((o) => o !== me));
    const shown = (k) => !mineOnly() || ref(k).item.owners.includes(me);
    const inProc = block.items.filter((k) => ref(k).proc?.id === p.id);
    const here = inProc.filter(shown);
    const held = inProc.filter((k) => !shown(k));
    const there = block.items.filter((k) => !inProc.includes(k)).map((k) => {
      const who_ = mineOnly() ? by([k]) : '';
      return `${labelOf(k)} (תהליך ${ref(k).proc?.num}${who_ ? ` · ${who_}` : ''})`;
    });
    const why = [
      ...(here.length > 2 ? [`${here.length} בדיקות למעלה`] : here.map(labelOf)),
      ...(held.length > 2 ? [`${held.length} בדיקות של ${by(held)}`] : held.map((k) => `${labelOf(k)} (${by([k])})`)),
      ...there,
    ];
    const text = [
      why.length ? `ממתין ל: ${why.join(', ')}` : null,
      block.fields.length ? `צריך להזין קודם: ${block.fields.map((f) => FIELD_NAMES[f]).join(', ')}` : null,
    ].filter(Boolean).join(' · ');
    meta.push(h('span', { class: 'blocked', id: `${cid}-b` }, text));
  }
  if (via) meta.push(h('span', { class: 'blocked', id: `${cid}-u` }, via.text, ' ', h('a', { href: via.href }, 'לעמוד')));
  if (i.optional && !c) meta.push(h('span', { class: 'tag' }, 'אם רלוונטי'));
  if (i.fresh && !state) meta.push(h('span', { class: 'tag tag-fresh' }, freshText(i.fresh)));
  if (ownOwners) meta.push(peopleChips(i.owners));

  if (i.recurring === 'daily') return followRow(i, c, mine);
  if (i.recurring) return callRow(p, i, state, c, busy, mine);

  const calendar = baseKey(i.key) === 'p11.calendar' && !state ? calendarMenu('shoot', roundOfKey(i.key)) : null;
  const naLabel = state === 'na' ? 'החזרה לפתוח' : i.optional ? 'לא נדרש' : 'לא רלוונטי';
  return h('li', { class: `item fin-row${state === 'done' ? ' is-done' : ''}${state === 'na' ? ' is-na' : ''}${mine ? ' is-mine' : ''}${busy ? ' is-busy' : ''}${block ? ' is-blocked' : ''}` },
    h('label', { class: 'irow', for: cid },
      h('input', {
        type: 'checkbox', id: cid, class: 'cbx fin', 'data-word': i.word || null, checked: state === 'done', disabled: busy || state === 'na' || !!block || !!via,
        'aria-describedby': meta.length ? `${cid}-m` : null,
        onchange: (e) => mark(i.key, e.currentTarget.checked ? 'done' : null, cid),
      }),
      h('span', { class: 'ibody' },
        h('span', { class: 'ilabel' }, state !== 'done' && fixTaskOf(tasks, client.id, i.key) ? FIX_ITEM_LABEL
          // Process 5 (protocol v8): open, it asks what the system cannot know; "אין עוד" answers.
          : !state && !block && baseKey(i.key) === 'p05.allnets' ? accessGapQuestion(checks['p05.access']) : i.label, state === 'na' ? h('span', { class: 'tag' }, i.optional ? 'לא נדרש' : 'לא רלוונטי') : null),
        meta.length ? h('span', { class: 'imeta', id: `${cid}-m` }, ...meta) : null)),
    calendar,
    state === 'done' || via || (baseKey(i.key) === 'p13.approved' && state !== 'na') ? null : h('button', {
      type: 'button', class: `btn-text na-btn${i.optional ? ' is-opt' : ''}`, disabled: busy, id: `${cid}-na`,
      'aria-label': `${naLabel}: ${i.label}`,
      onclick: () => {
        if (state === 'na') return mark(i.key, null, `${cid}-na`);
        if (i.optional) return mark(i.key, 'na', `${cid}-na`);
        return openNa(i, `${cid}-na`);
      },
    }, naLabel));
}

// Optimistic: the screen changes at once and rolls back if the save fails.
async function mark(key, state, focusId, note = null) {
  if (pending.has(key)) return false;
  // A mark the system looks into first (protocol v8; app/mark-guards.js): refused, in
  // one sentence, only when it knows there is nothing behind it.
  if (state === 'done') {
    const verdict = await checkMark(id, key);
    // (The call's own dialog saves through here with its summary as the note: that is the mark itself.)
    if (verdict?.via === 'call' && note === null) { renderKeepingFocus(focusId); openCall(key); return false; }
    if (verdict?.refuse) { renderKeepingFocus(focusId); toast(verdict.refuse); return false; }
  }
  const prev = checks[key];
  pending.add(key);
  if (state) checks[key] = { state, note, at: new Date().toISOString(), by_email: myEmail };
  else delete checks[key];
  renderKeepingFocus(focusId);
  try {
    if (state) checks[key] = await setCheck(id, key, state, note);
    else await clearCheck(id, key);
    pending.delete(key);
    await endWaitIfComplete(key);
    renderKeepingFocus(focusId);
    loadHistory();
    // The folder item (24) closes Ofir's folder task with it.
    if (state === 'done' && /^(r\d+\.)?p24\.folder$/.test(key)) {
      for (const t of tasks.filter((x) => !x.done_at && folderItemOf(x) === key)) {
        try { const done = await setTaskDone(t.id, true); tasks = tasks.map((x) => (x.id === t.id ? done : x)); renderTasks(); } catch { /* the task stays */ }
      }
    }
    // A handoff item: offer the ready WhatsApp message to the next person.
    if (state === 'done') offerHandoff({ client, key, checks: () => checks, me, canTeam: canTeam(), onSent: afterHandoff });
    else dropHandoff(key);
    return true;
  } catch (err) {
    pending.delete(key);
    if (prev) checks[key] = prev; else delete checks[key];
    renderKeepingFocus(focusId);
    toast(`הסימון לא נשמר ולכן בוטל. ${errorText(err)}`);
    return false;
  }
}

// A process that is complete no longer waits on the client: the wait mark is
// removed (and logged), and its office minutes until completion are kept.
async function endWaitIfComplete(key) {
  if (/\.(claim|wait|waited|pause)$/.test(key)) return;
  const st = clientState(client, checks).states.find((x) => x.proc.items.some((i) => i.key === key));
  if (!st?.complete) return;
  const wk = WAIT(st.proc);
  const tk = WAITED(st.proc);
  if (!checks[wk]) return;
  const prevWaited = checks[tk];
  try { checks[tk] = await setCheck(id, tk, 'done', endWaitNote(client, st.proc, checks)); } catch { return; /* the wait stays and counts until completion */ }
  try {
    await clearCheck(id, wk);
    delete checks[wk];
  } catch {
    // The wait stays and still counts until completion, so the added minutes go back.
    try {
      if (prevWaited) checks[tk] = await setCheck(id, tk, prevWaited.state, prevWaited.note);
      else { await clearCheck(id, tk); delete checks[tk]; }
    } catch { /* best effort */ }
  }
}

async function saveClient(fields, done) {
  try {
    client = await updateClient(id, fields);
    render();
    if (done) toast(done);
    return true;
  } catch (err) {
    toast(`${errorText(err)}`);
    return false;
  }
}

// ── Dialogs ─────────────────────────────────
const dialogs = [];
function dialog(dlgId, onClose) {
  const d = $(dlgId);
  dialogs.push(d);
  d.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === d) d.close(); });
  if (onClose) d.addEventListener('close', onClose);
  return d;
}
const showErr = (elId, msg) => { $(elId).textContent = msg; $(elId).hidden = false; };

// "Not relevant" needs a reason for required items.
let naTarget = null;
const naDlg = dialog('dlg-na', () => { if (naTarget) document.getElementById(naTarget.focusId)?.focus(); });
function openNa(item, focusId) {
  naTarget = { item, focusId };
  $('na-form').reset();
  $('na-err').hidden = true;
  $('na-item').textContent = item.label;
  naDlg.showModal();
  $('na-reason').focus();
}
$('na-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const reason = $('na-reason').value.trim();
  if (!reason) { showErr('na-err', 'כתבו בקצרה למה הפריט לא רלוונטי ללקוח הזה.'); $('na-reason').focus(); return; }
  $('na-submit').disabled = true;
  const ok = await mark(naTarget.item.key, 'na', naTarget.focusId, reason);
  $('na-submit').disabled = false;
  if (ok) naDlg.close();
});

// Waiting on the client: a reason is required, a recheck date is optional.
let waitTarget = null;
const waitDlg = dialog('dlg-wait');
function nextBusinessDayIso() {
  let d = new Date();
  do d = addDaysIL(d, 1); while (!isBusinessDay(d));
  return dayKeyIL(d);
}
function openWait(x) {
  waitTarget = x;
  $('wait-form').reset();
  $('wait-err').hidden = true;
  $('wait-ctx').textContent = `${client.name} · תהליך ${x.proc.num} · ${x.proc.title}`;
  $('wait-reason').value = x.wait?.reason || '';
  $('wait-recheck').value = x.wait?.recheck || nextBusinessDayIso();
  waitDlg.showModal();
  $('wait-reason').focus();
}
$('wait-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const reason = $('wait-reason').value.trim();
  if (!reason) { showErr('wait-err', 'כתבו בקצרה למה ממתינים, כדי שמי שבודק יידע מה לבקש מהלקוח.'); $('wait-reason').focus(); return; }
  $('wait-submit').disabled = true;
  const key = WAIT(waitTarget.proc);
  const hadWait = !!checks[key];
  const ok = await mark(key, 'done', null, waitNote(reason, $('wait-recheck').value || null, waitTarget.wait?.at || null));
  $('wait-submit').disabled = false;
  if (!ok) return;
  waitDlg.close();
  const x = waitTarget;
  document.querySelector(`#${CSS.escape(x.proc.id)}-wait button:last-child`)?.focus();
  toast(`תהליך ${x.proc.num} סומן כממתין ללקוח.`, hadWait ? null : { label: 'ביטול', run: () => mark(key, null, null) });
});

// The weekly call: nine topics from process 31 and tasks that came up.
const callDlg = dialog('dlg-call');
let callKey = null;
let callRows = 0;
const callNote = (c) => {
  try { const v = JSON.parse(c?.note || ''); if (v && v.topics) return v; } catch { /* plain text */ }
  return c?.note ? { text: c.note } : null;
};
// Leads and ad spend: optional numbers of the weekly call (Lior's campaigns).
const callNumbers = (v) => [
  Number.isFinite(v?.leads) ? [h('dt', {}, 'לידים'), h('dd', {}, String(v.leads))] : null,
  Number.isFinite(v?.spend) ? [h('dt', {}, 'הוצאה על פרסום'), h('dd', {}, `${v.spend.toLocaleString('he-IL')} ₪`)] : null,
];
function callSummary(v) {
  if (!v) return null;
  if (v.text) return h('dl', { class: 'call-sum' }, h('dt', {}, 'סיכום'), h('dd', {}, v.text));
  return h('dl', { class: 'call-sum' }, ...callNumbers(v), ...CALL_TOPICS.filter(([k]) => v.topics?.[k]).flatMap(([k, l]) => [h('dt', {}, l), h('dd', {}, v.topics[k])]));
}
// The optional numbers as typed: whole and not negative, or left out.
function readCallNumber(elId) {
  const raw = $(elId).value.trim();
  if (!raw) return { ok: true, value: undefined };
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? { ok: true, value: n } : { ok: false };
}
const pastCalls = (key) => calls.filter((r) => r.item_key === key).map((r) => ({ ...r, v: callNote(r) }));
function callTasks(call) {
  if (!call) return [];
  const t0 = new Date(call.at).getTime();
  return tasks.filter((t) => t.source === 'p31' && Math.abs(new Date(t.created_at).getTime() - t0) < 15 * 6e4);
}
// 14 (protocol v8): the daily follow-up before the shoot day. Answered on "לפני יום
// צילום", one row per client; here it is the latest answer and the way there.
function followRow(i, c, mine) {
  const a = readFollowup(c);
  const today = !!a && a.day === dayKeyIL(new Date());
  return h('li', { class: `item recurring${today ? ' is-done' : ''}${mine ? ' is-mine' : ''}` },
    h('span', { class: `rmark${today ? ' on' : ''}`, 'aria-hidden': 'true' }),
    h('div', { class: 'ibody' },
      h('span', { class: 'ilabel' }, i.label),
      h('div', { class: 'imeta' }, a
        ? h('span', { class: 'by' }, `${today ? 'היום' : formatStamp(a.at)}: ${followupText(a)} · ${who(a.by_email)}`)
        : h('span', { class: 'muted' }, 'עוד לא נענה'))),
    own() ? null : h('a', { class: 'btn btn-sm', href: `prep.html?id=${encodeURIComponent(client.id)}#followup` }, 'למעקב'));
}
function callRow(p, i, state, c, busy, mine) {
  const calls = pastCalls(i.key);
  const last = callNote(c);
  const when = last?.at || c?.at;
  return h('li', { class: `item recurring${state ? ' is-done' : ''}${mine ? ' is-mine' : ''}` },
    h('span', { class: `rmark${state ? ' on' : ''}`, 'aria-hidden': 'true' }),
    h('div', { class: 'ibody' },
      h('span', { class: 'ilabel' }, i.label),
      h('div', { class: 'imeta' },
        c ? h('span', { class: 'by' }, `שיחה אחרונה: ${formatStamp(when)} · ${who(c.by_email)}`) : h('span', { class: 'muted' }, 'עוד לא תועדה שיחה')),
      last ? h('details', { class: 'call-show' }, h('summary', {}, 'הצגת הסיכום'), callSummary(last)) : null,
      calls.length > 1 ? h('details', { class: 'call-show' }, h('summary', {}, `שיחות קודמות (${calls.length - 1})`),
        h('ul', { class: 'call-list' }, ...calls.slice(1).map((r) => h('li', {},
          h('details', {}, h('summary', {}, `${formatStamp(r.v?.at || r.at)} · ${who(r.by_email)} · ${callTasks(r).length} משימות`), callSummary(r.v)))))) : null),
    h('button', { type: 'button', class: 'btn btn-sm', disabled: busy, onclick: () => openCall(i.key) }, 'תיעוד שיחה'));
}
function addCallTask(focus = true) {
  callRows += 1;
  const n = callRows;
  const row = h('div', { class: 'call-task', id: `ct-${n}` },
    h('div', { class: 'field grow' }, h('label', { for: `ct-${n}-t` }, 'מה צריך לעשות'), h('input', { class: 'input', id: `ct-${n}-t`, autocomplete: 'off' })),
    h('div', { class: 'field' }, h('label', { for: `ct-${n}-o` }, 'מי מבצע'),
      h('select', { class: 'input', id: `ct-${n}-o` }, h('option', { value: '' }, 'בחירה…'), ...STAFF_PEOPLE().map((pp) => h('option', { value: pp.key }, pp.name)))),
    h('div', { class: 'field' }, h('label', { for: `ct-${n}-d` }, 'עד תאריך'), h('input', { class: 'input', id: `ct-${n}-d`, type: 'date', dir: 'ltr' })),
    h('button', {
      type: 'button', class: 'btn-text', 'aria-label': `הסרת המשימה ${n}`,
      onclick: () => {
        const prev = row.previousElementSibling;
        row.remove();
        updateCallSubmit();
        (prev?.querySelector('input') || $('call-add-task')).focus();
      },
    }, 'הסרה'));
  row.addEventListener('input', updateCallSubmit);
  $('call-tasks').append(row);
  updateCallSubmit();
  if (focus) $(`ct-${n}-t`).focus();
}
// The topic fields have their own ids: the topic "לידים" and the number "לידים מאז השיחה
// הקודמת" (call-leads) were one id, so the topic's text was read from the number field.
const callTopicId = (k) => `call-topic-${k}`;
function callTaskRows() {
  return [...$('call-tasks').querySelectorAll('.call-task')].map((r) => {
    const [t, o, d] = r.querySelectorAll('input, select');
    return { row: r, t, o, title: t.value.trim(), owner: o.value, due: d.value || null };
  }).filter((x) => x.title || x.owner);
}
function updateCallSubmit() {
  const n = callTaskRows().length;
  $('call-submit').textContent = n ? `שמירת השיחה ו־${n} משימות` : 'שמירת השיחה';
}
$('call-add-task').addEventListener('click', () => addCallTask());
let callSavedFor = null; // a call already saved while some of its tasks failed
let callTaskOwners = [];  // tasks saved for this call so far, across attempts
const tasksPhrase = (owners) => (owners.length === 1 ? `ונפתחה משימה אחת (${owners[0]})` : `ונפתחו ${owners.length} משימות (${owners.join(', ')})`);
// Closing with tasks that failed to save loses them: ask first.
callDlg.addEventListener('cancel', (e) => {
  if (callSavedFor && callTaskRows().length && !confirm('יש משימות שלא נשמרו. לסגור בכל זאת? הן לא יישמרו.')) e.preventDefault();
});
function openCall(key) {
  callKey = key;
  callSavedFor = null;
  callTaskOwners = [];
  $('call-form').reset();
  $('call-err').hidden = true;
  $('call-h').textContent = `תיעוד שיחה שבועית · ${client.name}`;
  $('call-at').value = inputValueIL(new Date());
  fill($('call-topics'), ...CALL_TOPICS.map(([k, l]) => h('div', { class: 'field' },
    h('label', { for: callTopicId(k) }, l), h('textarea', { class: 'input', id: callTopicId(k), rows: '1', maxlength: '500' }))));
  for (const el of $('call-topics').querySelectorAll('input, textarea')) el.disabled = false;
  fill($('call-tasks'));
  callRows = 0;
  updateCallSubmit();
  const prev = pastCalls(key)[0];
  fill($('call-prev'), prev ? h('details', { class: 'call-prev' },
    h('summary', {}, `מהשיחה הקודמת (${formatStamp(prev.v?.at || prev.at)} · ${who(prev.by_email)})`),
    prev.v?.topics ? h('dl', { class: 'call-sum' }, ...callNumbers(prev.v), ...[['upcoming', 'תכנים עתידיים'], ['requests', 'בקשות חדשות'], ['improve', 'דברים שצריך לשפר']]
      .filter(([k]) => prev.v.topics[k]).flatMap(([k, l]) => [h('dt', {}, l), h('dd', {}, prev.v.topics[k])])) : callSummary(prev.v),
    (() => {
      const ts = callTasks(prev);
      return ts.length ? h('ul', { class: 'call-list' }, ...ts.map((t) => h('li', {}, `${t.title} · `,
        t.done_at ? 'בוצע' : `פתוח · ${PEOPLE[t.owner]?.name || t.owner}${t.due_on ? ` · עד ${formatDay(t.due_on)}` : ''}`))) : null;
    })()) : null);
  callDlg.showModal();
  $(callTopicId('campaigns')).focus();
}
$('call-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('call-err').hidden = true;
  const topics = Object.fromEntries(CALL_TOPICS.map(([k]) => [k, $(callTopicId(k)).value.trim()]).filter(([, v]) => v));
  const leads = readCallNumber('call-leads');
  const spend = readCallNumber('call-spend');
  if (!leads.ok || !spend.ok) { showErr('call-err', 'לידים והוצאה על פרסום: מספר שלם, בלי מינוס. אפשר להשאיר ריק.'); $(leads.ok ? 'call-spend' : 'call-leads').focus(); return; }
  if (!callSavedFor && !Object.keys(topics).length) { showErr('call-err', 'לא נכתב דבר בסיכום. כתבו לפחות נושא אחד שעלה בשיחה.'); $(callTopicId('campaigns')).focus(); return; }
  const rows = callTaskRows();
  for (const r of rows) {
    r.t.removeAttribute('aria-invalid'); r.o.removeAttribute('aria-invalid');
    if (r.title && !r.owner) { r.o.setAttribute('aria-invalid', 'true'); showErr('call-err', `בחרו מי מבצע את המשימה ״${r.title}״.`); r.o.focus(); return; }
    if (!r.title && r.owner) { r.t.setAttribute('aria-invalid', 'true'); showErr('call-err', 'כתבו מה צריך לעשות, או הסירו את השורה.'); r.t.focus(); return; }
    if (r.title && BRIEF_REQUIRED.has(r.owner)) {
      r.o.setAttribute('aria-invalid', 'true');
      showErr('call-err', `משימה ל${PEOPLE[r.owner].name} צריכה בריף מלא. שמרו את השיחה בלי השורה הזו, ופתחו את המשימה בטופס ״משימות״ שבכרטיס.`);
      r.o.focus();
      return;
    }
  }
  $('call-submit').disabled = true;
  if (!callSavedFor) {
    const at = (fromInputIL($('call-at').value) || new Date()).toISOString();
    const ok = await mark(callKey, 'done', null, JSON.stringify({ v: 1, at, topics, leads: leads.value, spend: spend.value }));
    if (!ok) { showErr('call-err', 'השיחה לא נשמרה. הטקסט נשאר כאן. בדקו את החיבור ונסו שוב.'); $('call-submit').disabled = false; return; }
    callSavedFor = callKey;
  }
  const failed = [];
  for (const r of rows) {
    try {
      const t = await addTask({ client_id: id, title: r.title, owner: r.owner, due_on: r.due, source: 'p31' });
      tasks = [t, ...tasks];
      callTaskOwners.push(PEOPLE[r.owner].name);
      r.row.remove();
    } catch { failed.push(r); }
  }
  $('call-submit').disabled = false;
  renderTasks();
  render();
  if (failed.length) {
    for (const el of $('call-topics').querySelectorAll('textarea')) el.disabled = true;
    showErr('call-err', `השיחה נשמרה, אבל ${failed.length === 1 ? 'משימה אחת לא נשמרה' : `${failed.length} משימות לא נשמרו`}. נסו לשמור שוב.`);
    updateCallSubmit();
    return;
  }
  // Irit checks after every weekly call that everything is documented and every task has an owner.
  try {
    const t = await addTask({ client_id: id, title: 'לוודא שהשיחה השבועית מתועדת ושלכל משימה שעלתה יש אחראי', owner: 'irit', due_on: nextBusinessDayIso(), source: 'followup' });
    tasks = [t, ...tasks];
    renderTasks();
  } catch { /* the call itself is saved */ }
  callSavedFor = null;
  callDlg.close();
  toast(callTaskOwners.length ? `השיחה תועדה, ${tasksPhrase(callTaskOwners)}.` : 'השיחה תועדה.');
});

// Access vault dialog.
const accDlg = dialog('dlg-access', () => { $('acc-password').value = ''; });
let accEditing = null;
fill($('acc-network'), ...NETWORKS.map(([k, l]) => h('option', { value: k }, l)));
function syncAccTask() {
  const st = $('acc-status').value;
  $('acc-task-wrap').hidden = st === 'ok' || st === NEW_STATUS || accEditing?.status === st;
  $('acc-task-text').textContent = st === 'broken' ? 'לפתוח משימה לליאור: לשחזר את הגישה עם הלקוח' : 'לפתוח משימה לעילאי: לפתוח את הרשת ללקוח';
}
$('acc-status').addEventListener('change', syncAccTask);
function openAccess(a = null) {
  accEditing = a;
  $('acc-form').reset();
  $('acc-err').hidden = true;
  $('acc-h').textContent = a ? `גישה: ${networkName(a.network)}` : 'גישה חדשה לרשת';
  // "התקבל מהלקוח, עוד לא נבדק" is never chosen by hand: it stays only while a login
  // that came from the client's form is being edited without checking it.
  const fromClient = a?.status === NEW_STATUS;
  $('acc-status-new').hidden = !fromClient;
  $('acc-status-new').disabled = !fromClient;
  if (a) {
    $('acc-network').value = a.network; $('acc-status').value = a.status; $('acc-label').value = a.label || '';
    $('acc-username').value = a.username || ''; $('acc-note').value = a.note || '';
  }
  syncAccTask();
  accDlg.showModal();
  $('acc-network').focus();
}
$('access-add').addEventListener('click', () => openAccess());
$('acc-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const st = $('acc-status').value;
  const a = {
    id: accEditing?.id, network: $('acc-network').value, status: st, label: $('acc-label').value.trim(),
    username: $('acc-username').value.trim(), password: $('acc-password').value, note: $('acc-note').value.trim(),
  };
  if (st === 'ok' && !a.username) { showErr('acc-err', 'לגישה תקינה צריך שם משתמש.'); $('acc-username').focus(); return; }
  $('acc-submit').disabled = true;
  try {
    await saveAccess(id, a);
    $('acc-password').value = '';
    if (st !== 'ok' && accEditing?.status !== st && $('acc-task').checked) {
      const owner = st === 'broken' ? 'lior' : 'ilai';
      const title = st === 'broken' ? `לשחזר עם הלקוח את הגישה ל־${networkName(a.network)} ולהכניס לכספת` : `לפתוח ללקוח ${networkName(a.network)} ולהכניס את הגישה לכספת`;
      const t = await addTask({ client_id: id, title, owner, urgent: true });
      tasks = [t, ...tasks];
      renderTasks();
    }
    accDlg.close();
    toast('הגישה נשמרה בכספת.');
    refreshAccess();
  } catch (err) {
    showErr('acc-err', `הגישה לא נשמרה. ${errorText(err)}`);
  }
  $('acc-submit').disabled = false;
});

// Escalation to Lior: a task for him, urgent by default.
const escDlg = dialog('dlg-escalate');
fill($('esc-reason'), ...ESCALATIONS.map((r) => h('option', { value: r }, r)));
function openEscalate(procId = '') {
  $('esc-form').reset();
  $('esc-err').hidden = true;
  const open = clientState(client, checks).states.filter((x) => !x.complete && !x.proc.recurring && (!own() || hasPart(x.proc, me)));
  fill($('esc-proc'), h('option', { value: '' }, 'כללי'), ...open.map((x) => h('option', { value: x.proc.id }, `${x.proc.num} · ${x.proc.title}`)));
  $('esc-proc').value = procId;
  escDlg.showModal();
  $('esc-reason').focus();
}
$('esc-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const details = $('esc-details').value.trim();
  if (!details) { showErr('esc-err', 'כתבו בקצרה מה קרה, כדי שליאור יוכל להחליט.'); $('esc-details').focus(); return; }
  const procText = $('esc-proc').selectedOptions[0]?.textContent;
  const title = `${$('esc-reason').value}${$('esc-proc').value ? ` (תהליך ${procText})` : ''}: ${details}`.slice(0, 500);
  $('esc-submit').disabled = true;
  try {
    const t = await addTask({ client_id: id, title, owner: 'lior', urgent: $('esc-urgent').checked, source: 'escalation' });
    tasks = [t, ...tasks];
    renderTasks();
    escDlg.close();
    toast('הדיווח נשלח לליאור ומופיע אצלו ב״המשימות שלי״.');
  } catch (err) {
    showErr('esc-err', `הדיווח לא נשמר. ${errorText(err)}`);
  }
  $('esc-submit').disabled = false;
});

// Pausing the editing for another task: Lior and Ofir are told.
const pauseDlg = dialog('dlg-pause');
let pauseTarget = null;
function openPause(x) {
  pauseTarget = x;
  $('pause-form').reset();
  $('pause-err').hidden = true;
  pauseDlg.showModal();
  $('pause-stage').focus();
}
$('pause-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = { stage: $('pause-stage').value.trim(), left: $('pause-left').value.trim(), why: $('pause-why').value.trim() };
  if (!v.stage || !v.left) { showErr('pause-err', 'כתבו באיזה שלב העריכה ומה נשאר, כדי שליאור ואופיר יוכלו להיערך.'); (v.stage ? $('pause-left') : $('pause-stage')).focus(); return; }
  $('pause-submit').disabled = true;
  const ok = await mark(PAUSE(pauseTarget.proc), 'done', null, JSON.stringify(v));
  if (ok) {
    const who_ = PEOPLE[me]?.name || 'העורך';
    const title = `${who_} עצר/ה את העריכה של ${client.name}: שלב ${v.stage}, נשאר ${v.left}${v.why ? `, בגלל ${v.why}` : ''}`.slice(0, 500);
    const told = [];
    for (const owner of ['lior', 'ofir']) {
      try { tasks = [await addTask({ client_id: id, title, owner, source: 'pause' }), ...tasks]; told.push(owner); } catch { /* reported below */ }
    }
    renderTasks();
    pauseDlg.close();
    const missed = ['lior', 'ofir'].filter((o) => !told.includes(o)).map((o) => PEOPLE[o].name);
    toast(missed.length
      ? `העריכה סומנה כעצורה, אבל העדכון ל${missed.join(' ול')} לא נשמר. עדכנו אותם ישירות.`
      : 'העריכה סומנה כעצורה, וליאור ואופיר עודכנו.');
  }
  $('pause-submit').disabled = false;
});
async function resumeEditing(x) {
  const ok = await mark(PAUSE(x.proc), null, null);
  if (ok) toast('העריכה חזרה לפעילות.');
}

// Cancelling a client opened from an agreement: closed with a reason, never deleted.
const cancelDlg = dialog('dlg-cancel');
function openCancel() {
  $('cancel-form').reset();
  $('cancel-err').hidden = true;
  cancelDlg.showModal();
  $('cancel-reason').focus();
}
$('cancel-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const reason = $('cancel-reason').value.trim();
  if (!reason) { showErr('cancel-err', 'כתבו בקצרה למה ההסכם בוטל.'); $('cancel-reason').focus(); return; }
  $('cancel-submit').disabled = true;
  const ok = await saveClient({ status: 'cancelled', closed_reason: reason }, 'הלקוח נסגר. ההיסטוריה שלו נשמרה.');
  $('cancel-submit').disabled = false;
  if (ok) cancelDlg.close();
});

// Extra shoot rounds. Numbers are never reused: a round's items are keyed by its number.
const nextRoundNumber = () => Math.max(1, ...roundsOf(client).map((r) => r.n)) + 1;
const roundDlg = dialog('dlg-round');
let roundEditing = null;
// The photographer's monthly availability (docs/ops.md, section 39): under each shoot date being picked, whether he marked that day free.
const shootAtHint = shootDayHint($('ed-shoot-at'), { me: () => me, own: () => client?.shoot_at });
$('ed-shoot-at').after(shootAtHint);
const roundAtHint = shootDayHint($('round-at'), { me: () => me, own: () => (roundEditing ? roundsOf(client).find((r) => r.n === roundEditing)?.shoot_at : null) });
$('round-at').after(roundAtHint);
function openRound(n = null) {
  roundEditing = n;
  const rounds = roundsOf(client);
  const r = n ? rounds.find((x) => x.n === n) : null;
  const nextN = n || nextRoundNumber();
  const total = client.deliverables?.shoot_days;
  $('round-form').reset();
  $('round-err').hidden = true;
  $('round-h').textContent = `סבב צילום ${nextN}`;
  $('round-type').value = r?.shoot_type || client.shoot_type || 'natali';
  fillEditors('round-editor', $('round-type').value, r?.editor);
  $('round-at').value = inputValueIL(r?.shoot_at);
  roundAtHint.refresh();
  $('round-note').hidden = !!n;
  const over = !n && total !== undefined && nextN > total;
  $('round-extra-wrap').hidden = !over;
  $('round-extra-text').textContent = `בחבילה של הלקוח כלולים ${total} ימי צילום, וזה יהיה הסבב ה־${nextN}. נרכש יום צילום נוסף`;
  $('round-submit').textContent = n ? 'שמירת הסבב' : 'הוספת הסבב';
  roundDlg.showModal();
  $('round-type').focus();
}
$('round-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!$('round-extra-wrap').hidden && !$('round-extra').checked) {
    showErr('round-err', 'סמנו שנרכש יום צילום נוסף, או בטלו את הוספת הסבב.');
    $('round-extra').focus();
    return;
  }
  if (!editorFits($('round-editor').value, $('round-type').value)) {
    showErr('round-err', `${PEOPLE[$('round-editor').value]?.name || 'העורך'} עורכת רק ימי צילום של נטלי דדון. בחרו עורך אחר.`);
    $('round-editor').focus();
    return;
  }
  const rounds = roundsOf(client);
  const at = fromInputIL($('round-at').value)?.toISOString() || null;
  const next = roundEditing
    ? rounds.map((r) => (r.n === roundEditing ? { ...r, shoot_type: $('round-type').value, shoot_at: at, editor: $('round-editor').value || null } : r))
    : [...rounds, { n: nextRoundNumber(), shoot_type: $('round-type').value, shoot_at: at, editor: $('round-editor').value || null, start_at: new Date().toISOString() }];
  const before = roundEditing ? rounds.find((r) => r.n === roundEditing)?.shoot_at : null;
  const asked = at && +new Date(at) !== +new Date(before || 0) ? await confirmShootDay({ shootAt: at, own: before, me }) : { ok: true, note: null };
  if (!asked.ok) { $('round-at').focus(); return; }
  $('round-submit').disabled = true;
  try {
    client = await updateClient(id, { rounds: next });
    roundDlg.close();
    const n = roundEditing || next.at(-1).n;
    if (asked.note) await noteDateChange(id, 'round_shoot_at', n, at, asked.note);
    openPhases.add(`round-${n}`);
    render();
    if (!roundEditing) {
      toast(`נוסף סבב צילום ${n}. תהליך 11 (קביעת יום צילום) פתוח אצל עירית.`);
      document.getElementById(`r${n}-p11`)?.scrollIntoView({ block: 'start' });
    } else toast('הסבב נשמר.');
  } catch (err) {
    showErr('round-err', `הסבב לא נוסף. ${errorText(err)}`);
  }
  $('round-submit').disabled = false;
});
async function deleteRound(n) {
  if (!confirm(`למחוק את סבב צילום ${n}? אין בו סימונים.`)) return;
  const rest = roundsOf(client).filter((r) => r.n !== n);
  if (await saveClient({ rounds: rest }, `סבב צילום ${n} נמחק.`)) openPhases.delete(`round-${n}`);
}

// ── Tasks ───────────────────────────────────
fill($('task-owner'), ...STAFF_PEOPLE().map((p) => h('option', { value: p.key }, p.name)));
// A brief for the task. Required for Nirel: she does not work out alone what the client wants.
fill($('task-brief'), ...BRIEF_FIELDS.map(([k, l]) => h('div', { class: 'field' },
  h('label', { for: `tb-${k}` }, l), h('textarea', { class: 'input', id: `tb-${k}`, rows: '2', maxlength: '500' }))));
function syncBrief() {
  const need = BRIEF_REQUIRED.has($('task-owner').value);
  $('task-brief-sum').textContent = need ? `בריף למשימה (חובה אצל ${PEOPLE[$('task-owner').value].name})` : 'בריף למשימה (לא חובה)';
  if (need) $('task-brief-box').open = true;
}
$('task-owner').addEventListener('change', syncBrief);
function renderTasks() {
  // 'own': only the tasks given to me; the section is gone when there are none.
  const list = own() ? tasks.filter((t) => t.owner === me) : tasks;
  $('tasks').hidden = own() && !list.length;
  $('task-form').hidden = !canAddTask();
  const open = list.filter((t) => !t.done_at);
  const done = list.filter((t) => t.done_at).slice(0, 20);
  const today = dayKeyIL(new Date());
  const row = (t) => {
    const tid = `t-${t.id}`;
    const late = !t.done_at && t.due_on && t.due_on < today;
    return h('li', { class: `item fin-row${t.done_at ? ' is-done' : ''}` },
      h('label', { class: 'irow', for: tid },
        h('input', { type: 'checkbox', id: tid, class: 'cbx fin', checked: !!t.done_at, onchange: (e) => toggleTask(t, e.currentTarget) }),
        h('span', { class: 'ibody' },
          h('span', { class: 'ilabel' }, t.title),
          h('span', { class: 'imeta' },
            personChip(t.owner),
            t.urgent && !t.done_at ? h('span', { class: 'tag tag-urgent' }, '⚡ דחוף') : null,
            t.source === 'p31' ? h('span', { class: 'tag' }, 'מהשיחה השבועית') : null,
            t.source === 'escalation' ? h('span', { class: 'tag tag-warn' }, 'חריגה לליאור') : null,
            t.source === 'pause' ? h('span', { class: 'tag' }, 'עריכה נעצרה') : null,
            t.source === 'followup' ? h('span', { class: 'tag' }, 'אחרי השיחה השבועית') : null,
            t.source === 'status' ? h('span', { class: 'tag' }, 'מסיכום המצב') : null,
            t.due_on ? h('span', { class: `num${late ? ' late' : ''}` }, `${late ? 'באיחור · ' : ''}עד ${formatDay(t.due_on)}`) : null,
            t.done_at ? h('span', { class: 'by' }, `בוצע · ${who(t.done_by_email)} · ${formatStamp(t.done_at)}`) : h('span', { class: 'by' }, `נפתח ע״י ${who(t.created_by_email)} · ${formatStamp(t.created_at)}`)))),
      t.brief ? h('details', { class: 'call-show task-brief-show' }, h('summary', {}, 'בריף'),
        h('dl', { class: 'call-sum' }, ...BRIEF_FIELDS.filter(([k]) => t.brief[k]).flatMap(([k, l]) => [h('dt', {}, l), h('dd', {}, t.brief[k])]))) : null,
      // An urgent task: "התחלתי" within 30 office minutes, or it goes back to Lior (decision 9).
      t.urgent && !t.done_at ? startControl(t, me, () => renderTasks()) : null);
  };
  open.sort((a, b) => Number(b.urgent) - Number(a.urgent));
  if (!list.length) fill($('task-list'), h('li', { class: 'empty' }, 'אין משימות פתוחות.'));
  else fill($('task-list'), ...open.map(row), ...done.map(row));
}
async function toggleTask(t, input) {
  input.disabled = true;
  try {
    const row = await setTaskDone(t.id, input.checked);
    tasks = tasks.map((x) => (x.id === t.id ? row : x));
    // Ofir's folder task (24) is the item "יש תיקייה מסודרת": done together.
    const folder = input.checked ? folderItemOf(t) : null;
    if (folder && checks[folder]?.state !== 'done') await mark(folder, 'done', null);
    renderTasks();
    document.getElementById(`t-${t.id}`)?.focus();
  } catch (err) {
    input.checked = !input.checked;
    input.disabled = false;
    toast(`המשימה לא עודכנה. ${errorText(err)}`);
  }
}
$('task-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = $('task-title').value.trim();
  $('task-title').setAttribute('aria-invalid', String(!title));
  if (!title) { $('task-title').focus(); toast('כתבו מה צריך לעשות.'); return; }
  const brief = Object.fromEntries(BRIEF_FIELDS.map(([k]) => [k, $(`tb-${k}`).value.trim()]).filter(([, v]) => v));
  const owner = $('task-owner').value;
  if (BRIEF_REQUIRED.has(owner)) {
    const miss = BRIEF_MUST.find((k) => !brief[k]);
    if (miss) {
      $('task-brief-box').open = true;
      $(`tb-${miss}`).focus();
      toast(`למשימה אצל ${PEOPLE[owner].name} צריך בריף: מה הבעיה, מה לשנות, מה נשאר כמו שהוא ומה התוצאה הרצויה.`);
      return;
    }
    if (!$('task-due').value) { $('task-due').focus(); toast(`למשימה אצל ${PEOPLE[owner].name} צריך לקבוע עד מתי.`); return; }
  }
  $('task-submit').disabled = true;
  try {
    const row = await addTask({
      client_id: id, title, owner, due_on: $('task-due').value || null,
      urgent: $('task-urgent').checked, brief: Object.keys(brief).length ? brief : null,
    });
    tasks = [row, ...tasks];
    $('task-title').value = '';
    $('task-due').value = '';
    $('task-urgent').checked = false;
    for (const [k] of BRIEF_FIELDS) $(`tb-${k}`).value = '';
    $('task-brief-box').open = false;
    renderTasks();
    toast(`המשימה נוספה אצל ${PEOPLE[row.owner].name}.`);
  } catch (err) {
    toast(`המשימה לא נשמרה. ${errorText(err)}`);
  }
  $('task-submit').disabled = false;
  $('task-title').focus();
});

// ── History ─────────────────────────────────
const ACTION = { done: 'סימן/ה כבוצע', na: 'סימן/ה לא רלוונטי', clear: 'ביטל/ה סימון' };
function historyText(r) {
  const round = roundOfKey(r.item_key);
  const pre = round > 1 ? `סבב ${round} · ` : '';
  const base = baseKey(r.item_key);
  const intake = describeIntakeMark(base, r);
  if (intake) return `${pre}${intake}`;
  const handed = describeMark(base, r.note);
  if (handed) return r.action === 'clear' ? `ביטל/ה רישום העברה: ${pre}${handed}` : `פתח/ה וואטסאפ להעברה: ${pre}${handed}`;
  const office = describeOfficeMark(base, r.action, r.note);
  if (office) return `${pre}${office}`;
  // The production pages' marks (app/production.js): the editor's states, the shoot day.
  const prod = markHistory(base, r);
  if (prod) return `${pre}${prod}`;
  const mk = /^(p\d+[ab]?)\.(claim|wait|waited|pause|answered)$/.exec(base);
  if (mk) {
    const num = PROCESSES.find((p) => p.id === mk[1])?.num;
    if (mk[2] === 'claim') return `${r.action === 'clear' ? 'שחרר/ה' : 'לקח/ה'} את תהליך ${pre}${num}`;
    // From the "now" bar: the client answered after the sending (app/clocks.js).
    if (mk[2] === 'answered') return r.action === 'clear' ? `ביטל/ה את הסימון שהלקוח ענה (תהליך ${pre}${num})` : `סימן/ה שהלקוח ענה (תהליך ${pre}${num})`;
    if (mk[2] === 'waited') {
      if (r.action === 'clear') return `איפס/ה את זמן ההמתנה ללקוח בתהליך ${pre}${num}`;
      const { min, ext } = readWaited(r.note);
      const moved = ext === min ? 'היעד הוארך בהתאם'
        : ext ? `היעד הוארך ב־${officeMinutes(ext)}: המתנה שהתחילה אחרי היעד לא מאריכה אותו` : 'היעד לא הוארך: ההמתנה התחילה אחרי היעד';
      return `זמן ההמתנה ללקוח בתהליך ${pre}${num} עד כה: ${officeMinutes(min)} בשעות המשרד. ${moved}`;
    }
    if (mk[2] === 'pause') return r.action === 'clear' ? `חזר/ה לעריכה (${pre}${num})` : `עצר/ה את העריכה (${pre}${num})`;
    return r.action === 'clear' ? `סיים/ה המתנה ללקוח בתהליך ${pre}${num}`
      : `סימן/ה ממתין ללקוח בתהליך ${pre}${num}: ${parseWaitNote(r.note).reason}`;
  }
  if (base === 'p31.call' && r.action === 'done') return `תיעד/ה שיחה שבועית`;
  return null;
}
async function loadHistory() {
  if (own()) return; // 'own' views show neither the history nor the weekly call
  try { [log, calls] = await Promise.all([loadLog(id), loadCalls(id)]); } catch { return; }
  fill($('hist-list'), ...(log.length ? log.map((r) => {
    const special = historyText(r);
    const ref = ITEM_INDEX.get(baseKey(r.item_key));
    const round = roundOfKey(r.item_key);
    const procId = round > 1 ? `r${round}-${ref?.proc.id}` : ref?.proc.id;
    return h('li', {},
      h('span', { class: 'num muted' }, formatStamp(r.at)), ' ',
      h('strong', {}, who(r.by_email)), ` ${special || `${ACTION[r.action]}: `}`,
      !special && ref ? h('a', { href: `#${procId}`, onclick: (e) => { e.preventDefault(); goTo(procId); } }, `${round > 1 ? `סבב ${round} · ` : ''}${ref.proc.num} · ${ref.item.label}`) : null,
      !special && !ref ? r.item_key : null,
      r.note && !special && r.note !== 'בסימון כל התהליך' && noteWords(r.item_key, r.note) ? h('div', { class: 'inote' }, noteWords(r.item_key, r.note)) : null);
  }) : [h('li', { class: 'empty' }, 'עוד לא סומן דבר.')]));
  // The last call summary may have changed.
  if (!pending.size) renderKeepingFocus();
}

// ── Edit client ─────────────────────────────
const edDlg = dialog('dlg-edit');
// The date fields are Israel time on every device.
const toLocal = (v) => inputValueIL(v);
const fromLocal = (v) => fromInputIL(v)?.toISOString() || null;
const DELIV_FIELDS = [...DELIVERABLES.map((x) => [x.key, x.label]), ['shoot_days', 'ימי צילום']];
fill($('ed-deliv'), ...DELIV_FIELDS.map(([k, l]) => h('div', { class: 'field' },
  h('label', { for: `ed-deliv-${k}` }, l), h('input', { class: 'input', id: `ed-deliv-${k}`, type: 'number', min: '0', max: '999', inputmode: 'numeric', dir: 'ltr' }))));
fill($('ed-links'), ...LINKS.map((l) => h('div', { class: 'field' },
  h('label', { for: `ed-link-${l.key}` }, l.label),
  h('input', { class: 'input', id: `ed-link-${l.key}`, type: 'url', inputmode: 'url', dir: 'ltr', placeholder: l.hint ? `https://${l.hint}/…` : l.placeholder || 'https://', 'aria-describedby': `ed-link-${l.key}-h` }),
  h('div', { class: 'hint', id: `ed-link-${l.key}-h` }))));

function openEdit(focusId = 'ed-name') {
  const c = client;
  $('ed-err').hidden = true;
  $('ed-name').value = c.name || '';
  $('ed-business').value = c.business || '';
  $('ed-address').value = c.address || '';
  $('ed-phone').value = c.phone || '';
  $('ed-package').value = c.package_name || '';
  $('ed-deal').value = toLocal(c.deal_at);
  $('ed-status').value = c.status;
  $('ed-char-at').value = toLocal(c.char_at);
  $('ed-characterizer').value = c.characterizer || '';
  $('ed-logo').value = c.has_logo === null || c.has_logo === undefined ? '' : String(c.has_logo);
  $('ed-shoot-type').value = c.shoot_type || '';
  $('ed-shoot-at').value = toLocal(c.shoot_at);
  shootAtHint.refresh();
  fillEditors('ed-editor', c.shoot_type, c.editor);
  $('ed-contract-end').value = c.contract_end || '';
  $('ed-notes').value = c.notes || '';
  for (const [k] of DELIV_FIELDS) $(`ed-deliv-${k}`).value = c.deliverables?.[k] ?? '';
  for (const l of LINKS) { $(`ed-link-${l.key}`).value = c.links?.[l.key] || ''; $(`ed-link-${l.key}-h`).textContent = ''; $(`ed-link-${l.key}`).removeAttribute('aria-invalid'); }
  edDlg.showModal();
  $(focusId).focus();
}

// Editors a shoot type allows (Nirel edits only Natali's clients). A stored
// editor the type no longer allows stays listed and marked, so saving never
// drops it silently; the save refuses it instead.
function fillEditors(selId, shootType, current) {
  const keys = editorsFor(shootType);
  const extra = current && !keys.includes(current) ? [current] : [];
  fill($(selId), h('option', { value: '' }, 'טרם שויך'),
    ...keys.map((k) => h('option', { value: k }, `${PEOPLE[k].name}${k === 'nirel' ? ' (נטלי בלבד)' : ''}`)),
    ...extra.map((k) => h('option', { value: k }, `${PEOPLE[k]?.name || k} (לא מתאים לסוג יום הצילום)`)));
  $(selId).value = current || '';
}
const editorFits = (editor, shootType) => !editor || editorsFor(shootType).includes(editor);
$('ed-shoot-type').addEventListener('change', () => fillEditors('ed-editor', $('ed-shoot-type').value || null, $('ed-editor').value || null));
$('round-type').addEventListener('change', () => fillEditors('round-editor', $('round-type').value, $('round-editor').value || null));

// Links only: a password, token or code in the address is refused.
const SECRET = /\/\/[^/?#@\s]+:[^/?#@\s]*@|[?&#;]([a-z_]*(password|passwd|pass|pwd|token|secret|apikey|api_key|key|auth|sig|signature)|code)=/i;
function readLinks() {
  const out = {};
  for (const l of LINKS) {
    const input = $(`ed-link-${l.key}`);
    const v = input.value.trim();
    const hint = $(`ed-link-${l.key}-h`);
    input.removeAttribute('aria-invalid');
    hint.textContent = '';
    if (!v) continue;
    if (!safeLink(v)) { input.setAttribute('aria-invalid', 'true'); return { error: 'זה לא נראה כמו קישור. העתיקו את הכתובת המלאה, שמתחילה ב־https://', input }; }
    if (SECRET.test(v)) { input.setAttribute('aria-invalid', 'true'); return { error: 'אפשר לשמור כאן רק קישור. סיסמאות וקודי גישה לא נשמרים במערכת.', input }; }
    const domain = l.hint ? l.hint.split('/')[0].split('.').slice(-2).join('.') : '';
    if (domain && !v.toLowerCase().includes(domain)) hint.textContent = `הקישור לא נראה כמו קישור של ${l.label}. נשמר בכל זאת.`;
    out[l.key] = v;
  }
  return { links: out };
}

$('ed-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('ed-name').value.trim();
  const fail = (msg, el) => { showErr('ed-err', msg); el?.focus(); };
  if (!name) return fail('חסר שם לקוח.', $('ed-name'));
  // Ending a client closes its work only after process 35 is done.
  const status = $('ed-status').value;
  const p35 = PROCESSES.find((p) => p.id === 'p35').items.map((i) => i.key);
  if (status === 'ended' && client.status !== 'ended' && !p35.every((k) => checks[k])) {
    return fail('לפני שמסמנים ״הסתיים״ צריך לסגור את תהליך 35 (עצירת קמפיינים, הסרת גישות וסגירת חיבורים). בחרו ״מסיים התקשרות״ כדי שהתהליך יופיע.', $('ed-status'));
  }
  const { links, error, input } = readLinks();
  if (error) return fail(error, input);
  if (!editorFits($('ed-editor').value, $('ed-shoot-type').value || null)) {
    return fail(`${PEOPLE[$('ed-editor').value]?.name || 'העורך'} עורכת רק לקוחות של נטלי דדון. בחרו עורך אחר.`, $('ed-editor'));
  }
  const deliverables = { ...(client.deliverables || {}) };
  for (const [k] of DELIV_FIELDS) {
    const v = $(`ed-deliv-${k}`).value;
    if (v === '') delete deliverables[k]; else deliverables[k] = Math.max(0, Math.round(Number(v)));
  }
  const val = (i) => $(i).value.trim() || null;
  // A shoot day set against the usual order: ask, with the reason; the answer is kept in the date-change history.
  const newShoot = fromLocal($('ed-shoot-at').value);
  const shootMoved = !!newShoot && +new Date(newShoot) !== +new Date(client.shoot_at || 0);
  const asked = shootMoved ? await confirmShootDay({ shootAt: newShoot, charAt: fromLocal($('ed-char-at').value), own: client.shoot_at, me }) : { ok: true, note: null };
  if (!asked.ok) { $('ed-shoot-at').focus(); return; }
  $('ed-submit').disabled = true;
  try {
    client = await updateClient(id, {
      name, business: val('ed-business'), address: val('ed-address'), phone: val('ed-phone'), package_name: val('ed-package'),
      deal_at: fromLocal($('ed-deal').value) || client.deal_at, status,
      char_at: fromLocal($('ed-char-at').value), characterizer: val('ed-characterizer'),
      has_logo: $('ed-logo').value === '' ? null : $('ed-logo').value === 'true',
      shoot_type: val('ed-shoot-type'), shoot_at: fromLocal($('ed-shoot-at').value), editor: val('ed-editor'),
      contract_end: val('ed-contract-end'), notes: val('ed-notes'), links, deliverables,
    });
    if (asked.note) await noteDateChange(id, 'shoot_at', null, newShoot, asked.note);
    edDlg.close();
    render();
    toast('הפרטים נשמרו.');
  } catch (err) {
    fail(errorText(err));
  }
  $('ed-submit').disabled = false;
});

// Print the whole protocol, with every phase and item.
window.addEventListener('beforeprint', () => { if (client) { printing = true; render(); } });
window.addEventListener('afterprint', () => { if (client) { printing = false; render(); } });

// No refresh while something is being saved or typed in a dialog.
const busy = () => pending.size || Object.keys(saveTimers).length || dialogs.some((d) => d.open)
  || !!document.querySelector('#app details:not(.phase)[open]');
document.addEventListener('visibilitychange', () => { if (!document.hidden && client && !busy()) load(); });
setInterval(() => { if (!document.hidden && client && !busy()) renderKeepingFocus(); }, 60e3);

// The parts of the page that depend on who is looking, set once after sign-in.
function applyScope() {
  document.documentElement.dataset.scope = scope;
  if (!own()) return;
  const back = document.querySelector('#app > a.back');
  if (back) { back.href = 'clients.html#mine'; back.textContent = '→ המשימות שלי'; }
  $('history').hidden = true;
  $('tasks-h').textContent = 'המשימות שלי';
  const sub = document.querySelector('#tasks .side-head p');
  if (sub) sub.textContent = 'משימות שנפתחו לך בלקוח הזה.';
  // My work first; the vault (when mine to use) after it.
  $('phases').after($('access'));
  $('access').after($('fl-slot'));
}

mountSession(async (staff) => {
  myEmail = staff.email;
  // The vault of this client: the vault flag and, outside the office, a client assigned to me.
  const [dir, viewer, vault] = await Promise.all([loadDirectory(), viewerOf(staff.email), taken('card-vault', () => canUseVault(id))]);
  Object.assign(directory, dir);
  ({ me, scope } = viewer);
  viewerInfo = viewer;
  viewerError = viewer.error;
  vaultOk = vault;
  // Mine by default; the whole protocol only when an office user chose it (or for the owner).
  showAll = !me || (!own() && store.get('card.all') === '1');
  const saved = store.get('focus');
  focusPerson = saved !== null && !own() ? saved : me || '';
  if (focusPerson && !PEOPLE[focusPerson]) focusPerson = '';
  applyScope();
  await load();
  refreshAccess();
  if (vaultOk) mountVaultHint($('vault-open'), { locked: hideSecrets });
  // The team's WhatsApp numbers, for the handoff buttons in the card.
  ensurePhones().then(() => { if (client && !busy()) renderKeepingFocus(); });
  const target = location.hash && document.getElementById(location.hash.slice(1));
  if (target) target.scrollIntoView({ block: 'start' });
  // "תיעוד שיחה" pressed on "המשימות שלי" (the weekly call's row): its dialog opens here.
  const call = new URLSearchParams(location.search).get('call');
  if (client && call && /^(r\d+\.)?p31\.call$/.test(call) && !own() && !busy()) openCall(call);
});
