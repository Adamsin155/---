// Ofir's first screen (qa.html; system-plan section 3, "אופיר"): the quality-
// control queue (videos, 25, and the rest of the graphics, 23), each with how long
// it has waited against the one-hour target (stopped while he is in a
// characterization, decision 11); "אישור" or "החזרה לתיקון" with the issues, a due
// time and a round counter. Below it today's characterizations, the shoots waiting
// for an editor with the assignment (22א: Nirel preselected for Natali, a reason
// for anyone else; a joint day always with a reason), and each editor's load.
// The quality-control dialog shows the files being checked (the round's videos, or
// the rest of the graphics) from the client's files, playable in place.
// The logic: app/qa-logic.js and app/office-marks.js.
import { PEOPLE, SHOOT_TYPES, EDITORS } from './protocol.js';
import { clientState, clientLabel } from './protocol-logic.js';
import {
  loadClients, loadChecks, loadTasks, setCheck, clearCheck, setChecksBulk, clearChecksBulk, updateClient, loadDirectory,
} from './protocol-data.js';
import {
  $, fill, h, toast, errorText, personChip, formatWhen, formatStamp, mountSession, directory, viewerOf, officeMinutes,
} from './protocol-ui.js';
import {
  qaQueue, qaFixing, charsToday, awaitingEditor, editorLoad, loadText, dayText, preselected, reasonNeeded, reasonHint,
  eligibleEditors, jointFromSelection, reasonNote, QA_TARGET_MINUTES,
} from './qa-logic.js';
import {
  QA_KINDS, qaState, returnKey, returnNote, fixDue, ofirMeetings, meetingNow, REASON_KEY, ISSUE_MAX, ISSUE_TEXT_MAX, ISSUE_REF_MAX,
} from './office-marks.js';
import { withEditor } from './decisions-logic.js';
import { liorShoot } from './reminder-engine.js';
import { loadSelections } from './office-data.js';
import { offerHandoff } from './handoff-ui.js';
import { refreshQuestions } from './questions-ui.js';
import { officeLinks, markFirstLanded, navLink } from './office-ui.js';
import { mountApprovals } from './approvals-ui.js';
import { inputValueIL, fromInputIL, TZ } from './tz.js';
import { mountWorkFiles, forgetFiles } from './files-ui.js';
import { videoWindow, graphicsWindow } from './files-logic.js';

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
const meetings = () => ofirMeetings(clients.filter((c) => c.status === 'active' || c.status === 'ending'), checksOf);

// ── Data ────────────────────────────────────
let inflight = null;
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
  states.clear();
  const natali = awaitingEditor({ clients, stateOf, checks }).filter((a) => a.ctx.shoot_type === 'natali').map((a) => a.client.quote_id);
  selections = await loadSelections(natali).catch(() => new Map());
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
  const queue = qaQueue({ clients, stateOf, checks, meetings: ms, now });
  const fixing = qaFixing({ clients, stateOf, checks });
  const chars = charsToday({ clients, stateOf, now });
  const waiting = awaitingEditor({ clients, stateOf, checks });
  const load = editorLoad({ clients, stateOf, checks, tasks, now });
  renderBanners(ms, now);
  fill($('of-jump'), h('ul', { class: 'chips-row' },
    ...[['qa-h', 'בקרה', queue.length], ['char-h', 'אפיונים', chars.length], ['assign-h', 'שיוך עורך', waiting.length], ['load-h', 'עומס', null]]
      .map(([id, label, n]) => h('li', {}, h('button', {
        type: 'button', class: 'chip', onclick: () => { const el = $(id); el.scrollIntoView({ block: 'start' }); el.focus({ preventScroll: true }); },
      }, label, n === null ? null : h('span', { class: 'n' }, String(n)))))));
  $('qa-n').textContent = String(queue.length);
  fill($('qa-list'), ...(queue.length ? queue.map((x) => qaCard(x, ms, now)) : [h('li', { class: 'empty' }, 'אין כרגע עבודה שמחכה לבקרה שלך.')]));
  fill($('qa-fixing'), fixing.length ? h('details', { class: 'of-fixing' },
    h('summary', {}, `הוחזרו לתיקון ועוד לא חזרו (${fixing.length})`),
    h('ul', { class: 'of-list' }, ...fixing.map((x) => h('li', { class: 'of-card' },
      h('div', { class: 'of-head' },
        h('a', { class: 'wclient', href: clientUrl(x.client.id, x.proc.id) }, clientLabel(x.client)),
        h('span', { class: 'wtitle' }, `${QA_KINDS[x.kind].title}${roundText(x.ctx)} · סבב ${x.open.n}`),
        personChip(x.who === 'editor' ? 'editor' : x.who)),
      h('p', { class: 'of-line' }, `${x.open.issues.length === 1 ? 'בעיה אחת' : `${x.open.issues.length} בעיות`} · תוקנו ${x.open.fixed.size}`,
        x.open.due ? h('span', { class: x.open.due < now ? 'late' : '' }, ` · עד ${formatWhen(x.open.due, now)}`) : null))))) : null);
  $('char-n').textContent = String(chars.length);
  fill($('char-list'), ...(chars.length ? chars.map((x) => charCard(x, now)) : [h('li', { class: 'empty' }, 'אין היום אפיונים שלך.')]));
  $('assign-n').textContent = String(waiting.length);
  fill($('assign-list'), ...(waiting.length ? waiting.map((a) => assignCard(a, load, now)) : [h('li', { class: 'empty' }, 'אין לקוחות שמחכים לשיוך עורך.')]));
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
  const pct = Math.min(100, Math.round((x.waited / QA_TARGET_MINUTES) * 100));
  const inMeeting = !!meetingNow(ms, now);
  return h('li', { class: `of-card${x.late ? ' is-late' : ''}`, 'data-key': x.key },
    h('div', { class: 'of-head' },
      h('a', { class: 'wclient', href: clientUrl(x.client.id, x.proc.id) }, clientLabel(x.client)),
      h('span', { class: 'wtitle' }, `${k.title}${roundText(x.ctx)}`),
      x.round > 1 ? h('span', { class: 'tag' }, `בדיקה ${x.round} · אחרי תיקון`) : null,
      x.late ? h('span', { class: 'sbadge s-overdue' }, h('span', { class: 'sicon', 'aria-hidden': 'true' }), 'עבר היעד') : null),
    h('p', { class: 'of-line' },
      `מחכה ${waitWords(x.waited)} מתוך שעה · בקרה עד ${formatWhen(x.dueAt, now)}`,
      inMeeting ? h('span', { class: 'muted' }, ' · השעון עצור בזמן האפיון') : null),
    h('span', { class: `of-meter${x.late ? ' is-late' : ''}`, role: 'img', 'aria-label': `זמן המתנה: ${x.waited} מתוך ${QA_TARGET_MINUTES} דקות` },
      h('span', { style: `inline-size:${pct}%` })),
    h('div', { class: 'of-acts' },
      h('button', {
        type: 'button', class: 'btn btn-primary btn-sm', id: `qa-open-${x.key.replace(/\W/g, '_')}`,
        'aria-label': `לבדיקה: ${x.client.name}, ${k.title}`, onclick: () => openQa(x),
      }, 'לבדיקה')));
}

function charCard(x, now) {
  const c = x.client;
  const nav = navLink(c.address);
  return h('li', { class: `of-card${x.done ? ' is-done' : ''}` },
    h('div', { class: 'of-head' },
      h('span', { class: 'of-time num' }, hm(x.at)),
      h('a', { class: 'wclient', href: clientUrl(c.id, 'p04') }, clientLabel(c)),
      x.done ? h('span', { class: 'sbadge s-done' }, h('span', { class: 'sicon', 'aria-hidden': 'true' }), 'הסתיים') : x.at <= now ? h('span', { class: 'tag' }, 'עכשיו') : null),
    h('p', { class: 'of-line' }, c.address ? `כתובת: ${c.address}` : 'אין כתובת בכרטיס', c.business ? ` · ${c.business}` : ''),
    h('div', { class: 'of-acts' },
      nav ? h('a', { class: 'btn btn-sm', href: nav, target: '_blank', rel: 'noopener' }, 'ניווט', h('span', { class: 'sr-only' }, ` ל${c.name} (נפתח בחלון חדש)`)) : null,
      c.phone ? h('a', { class: 'btn btn-sm', href: `tel:${String(c.phone).replace(/[^\d+]/g, '')}` }, 'התקשרות', h('span', { class: 'sr-only' }, ` ל${c.name}`)) : null,
      h('a', { class: 'btn btn-sm btn-ghost', href: clientUrl(c.id, 'p04') }, 'לכרטיס', h('span', { class: 'sr-only' }, ` של ${c.name}`))));
}

function assignCard(a, load, now) {
  const type = a.ctx.shoot_type;
  const joint = jointFromSelection(selections.get(a.client.quote_id));
  const pre = preselected(type, joint);
  return h('li', { class: 'of-card', 'data-key': a.key },
    h('div', { class: 'of-head' },
      h('a', { class: 'wclient', href: clientUrl(a.client.id, a.proc.id) }, clientLabel(a.client)),
      h('span', { class: 'wtitle' }, `${SHOOT_TYPES[type]?.name || 'סוג יום הצילום לא נקבע'}${roundText(a.ctx)}`),
      a.state.status === 'overdue' ? h('span', { class: 'sbadge s-overdue' }, h('span', { class: 'sicon', 'aria-hidden': 'true' }), 'באיחור') : null),
    h('p', { class: 'of-line' }, a.ctx.shoot_at ? `הצילום: ${formatStamp(a.ctx.shoot_at)}` : '',
      joint ? ' · יום משותף לנטלי ולסמיון' : pre ? ` · ${PEOPLE[pre].name} מסומנת מראש (${loadText(load[pre])})` : ''),
    h('div', { class: 'of-acts' },
      h('button', { type: 'button', class: 'btn btn-primary btn-sm', id: `as-open-${a.key.replace(/\W/g, '_')}`, 'aria-label': `שיוך עורך: ${a.client.name}${roundText(a.ctx)}`, onclick: () => openAssign(a) }, 'שיוך עורך')));
}

function loadCard(l, now) {
  return h('li', { class: 'of-card of-editor' },
    h('div', { class: 'of-head' }, personChip(l.editor), l.editor === 'nirel' ? h('span', { class: 'tag' }, 'נטלי בלבד') : null,
      h('span', { class: 'of-line' }, loadText(l))),
    l.jobs.length ? h('ul', { class: 'of-jobs' }, ...l.jobs.map((j) => h('li', {},
      h('a', { href: clientUrl(j.client.id, `${j.pre ? j.pre.replace('.', '-') : ''}p22`) }, j.client.name, j.n ? ` · סבב ${j.n}` : ''),
      ` · ${j.day === null ? 'טרם שויך' : dayText(j.day, j.of)}`,
      j.stage === 'closing' ? ' · תיקונים וסגירה' : '',
      j.paused ? [' ', h('span', { class: 'tag tag-warn' }, 'עצורה')] : null,
      j.dueAt ? h('span', { class: `muted${j.dueAt < now ? ' late' : ''}` }, ` · יעד ${formatWhen(j.dueAt, now)}`) : null))) : null);
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
  $('qa-meta').textContent = `${k.title}${roundText(x.ctx)} · ${x.round > 1 ? `בדיקה ${x.round}, אחרי ${x.round - 1 === 1 ? 'סבב תיקונים אחד' : `${x.round - 1} סבבי תיקונים`}` : 'בדיקה ראשונה'} · מחכה ${waitWords(x.waited)} · בקרה עד ${formatWhen(x.dueAt, now)}`;
  const last = x.rounds.at(-1);
  fill($('qa-prev'), last ? h('details', { class: 'of-prev', open: true },
    h('summary', {}, `מה הוחזר בסבב ${last.n} (לבדוק שתוקן)`),
    h('ul', {}, ...last.issues.map((i) => h('li', {}, i.ref ? `${k.unit} ${i.ref}: ${i.text}` : i.text)))) : null);
  // The files being checked, as the editor or Ilai uploaded them: played or opened here.
  const videos = x.kind === 'videos';
  const cs = checksOf(x.client);
  forgetFiles(x.client.id);
  fill($('qa-files'), mountWorkFiles({
    client: x.client, kind: videos ? 'deliverable_video' : 'deliverable_graphic', me, readOnly: true, idp: 'qa-f', toast,
    window: videos ? videoWindow(x.client, cs, Number(/^r(\d+)\./.exec(x.pre)?.[1] || 1)) : graphicsWindow(cs, 'rest'),
    title: videos ? 'הסרטונים לבדיקה' : 'הגרפיקות לבדיקה',
    total: videos ? Number(x.ctx?.deliverables?.videos) || null : Math.max(0, (Number(x.client.deliverables?.graphics) || 0) - 9) || null,
  }));
  $('qa-checks-legend').textContent = `${k.checks.length} הבדיקות (${k.title})`;
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
  fill($('qa-checks'), ...k.checks.map((key) => {
    const full = `${x.pre}${key}`;
    const id = `qa-c-${key.replace(/\W/g, '_')}`;
    return h('label', { class: 'wrow', for: id },
      h('input', { type: 'checkbox', class: 'cbx', id, checked: cs[full]?.state === 'done', onchange: (e) => toggleCheck(full, e.currentTarget) }),
      h('span', { class: 'wlabel' }, labelOf(key)));
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
    $('qa-due').value = inputValueIL(fixDue(new Date()));
  }
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
function openAssign(a) {
  asItem = a;
  returnTo = document.activeElement?.id || null;
  const type = a.ctx.shoot_type;
  const joint = jointFromSelection(selections.get(a.client.quote_id));
  $('as-h').textContent = `שיוך עורך · ${a.client.name}${roundText(a.ctx)}`;
  $('as-meta').textContent = [SHOOT_TYPES[type]?.name, a.ctx.shoot_at ? `צולם ${formatStamp(a.ctx.shoot_at)}` : null, a.dueAt ? `לשייך עד ${formatWhen(a.dueAt)}` : 'לשייך עד 12:00 ביום העסקים שאחרי הצילום'].filter(Boolean).join(' · ');
  $('as-joint-wrap').hidden = type !== 'natali';
  $('as-joint').checked = joint;
  $('as-reason').value = '';
  $('as-err').hidden = true;
  renderEditors(true);
  asDlg.showModal();
  ($('as-editors').querySelector('input:checked') || $('as-editors').querySelector('input'))?.focus();
}
function renderEditors(preselect = false) {
  const a = asItem;
  const type = a.ctx.shoot_type;
  const joint = $('as-joint').checked;
  const load = editorLoad({ clients, stateOf, checks, tasks, now: new Date() });
  const chosen = preselect ? preselected(type, joint) : $('as-editors').querySelector('input:checked')?.value || null;
  const pre = preselected(type, joint);
  fill($('as-editors'), ...eligibleEditors(type).map((k) => h('label', { class: 'wrow as-editor', for: `as-e-${k}` },
    h('input', { type: 'radio', class: 'radio', name: 'as-editor', id: `as-e-${k}`, value: k, checked: chosen === k, onchange: syncReason }),
    h('span', { class: 'wlabel' }, h('strong', {}, PEOPLE[k].name), pre === k ? h('span', { class: 'tag' }, 'מסומנת מראש') : null,
      h('span', { class: 'muted small as-load' }, loadText(load[k]))))));
  syncReason();
}
function syncReason() {
  const a = asItem;
  const editor = $('as-editors').querySelector('input:checked')?.value || null;
  const joint = $('as-joint').checked;
  const need = reasonNeeded({ shootType: a.ctx.shoot_type, joint, editor });
  $('as-reason-label').textContent = need ? 'סיבה (חובה)' : 'סיבה (לא חובה)';
  $('as-reason').required = need;
  $('as-reason-hint').textContent = reasonHint({ shootType: a.ctx.shoot_type, joint }) || 'הסיבה נשמרת בהיסטוריה של הלקוח.';
}
$('as-joint').addEventListener('change', () => renderEditors(true));
$('as-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const a = asItem;
  const editor = $('as-editors').querySelector('input:checked')?.value || null;
  const joint = $('as-joint').checked && a.ctx.shoot_type === 'natali';
  const reason = $('as-reason').value.trim();
  if (!editor) { showErr('as-err', 'בחרו עורך.'); $('as-editors').querySelector('input')?.focus(); return; }
  if (reasonNeeded({ shootType: a.ctx.shoot_type, joint, editor }) && !reason) {
    $('as-reason').setAttribute('aria-invalid', 'true');
    showErr('as-err', joint ? 'ביום צילום משותף רושמים למה נבחר העורך.' : `ניראל מסומנת מראש בצילום של נטלי. כתבו למה ${PEOPLE[editor].name}.`);
    $('as-reason').focus();
    return;
  }
  $('as-reason').removeAttribute('aria-invalid');
  $('as-submit').disabled = true;
  const c = a.client;
  let client = c;
  try {
    client = await updateClient(c.id, withEditor(c, a.n, editor));
    clients = clients.map((x) => (x.id === c.id ? client : x));
    const keys = ['p22a.load', 'p22a.assigned'].map((k) => `${a.pre}${k}`);
    for (const row of await setChecksBulk(c.id, keys, 'done')) (checks[c.id] ||= {})[row.item_key] = row;
    // Irit's check that the client moved to editing closes by itself (section 4, 5א).
    const irit = `${a.pre}p22a.irit`;
    if (checks[c.id][irit]?.state !== 'done') checks[c.id][irit] = await setCheck(c.id, irit, 'done', 'נסגר לבד: השיוך נרשם במערכת');
    if (reason || reasonNeeded({ shootType: a.ctx.shoot_type, joint, editor })) {
      checks[c.id][REASON_KEY(a.pre)] = await setCheck(c.id, REASON_KEY(a.pre), 'done', reasonNote({ editor, reason, preselected: preselected(a.ctx.shoot_type, joint), joint }));
    }
  } catch (err) {
    showErr('as-err', `השיוך לא נשמר. ${errorText(err)}`);
    $('as-submit').disabled = false;
    return;
  }
  // (No folder task any more: the editor uploads the videos into the client's files.)
  $('as-submit').disabled = false;
  states.clear();
  asDlg.close();
  toast(`${c.name} שויך ל${PEOPLE[editor].name}.`);
  // Until stage 4, a ready WhatsApp to the editor with both dates and the link.
  offerHandoff({ client, key: `${a.pre}p22a.assigned`, checks: () => checks[c.id], me });
});

// ── Boot ────────────────────────────────────
$('btn-refresh').addEventListener('click', () => load());
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('app').hidden && !busy()) load(); });
setInterval(() => {
  if ($('app').hidden || $('of-page').hidden) return;
  if (Date.now() - lastLoad > 5 * 60e3 && !busy()) { load(); return; }
  if (!document.hidden && !busy()) renderKeepingFocus();
}, 60e3);

mountSession(async (staff) => {
  const [dir, v] = await Promise.all([loadDirectory(), viewerOf(staff.email)]);
  Object.assign(directory, dir);
  viewer = v;
  me = v.me;
  markFirstLanded();
  if (v.error || v.scope !== 'office') { $('no-access').hidden = false; return; }
  $('of-page').hidden = false;
  $('head-actions').prepend(...officeLinks(v, 'qa.html'));
  // "חוזים חריגים לאישור": Ofir's first screen.
  mountApprovals($('approvals-card'), v, { mail: staff.email, toast });
  await load();
  // A link from the pass over the clients: qa.html#assign-<client id>[-r<round>].
  const m = /^#assign-([\w-]+?)(?:-r(\d+))?$/.exec(location.hash);
  if (m) {
    const a = awaitingEditor({ clients, stateOf, checks }).find((x) => x.client.id === m[1] && String(x.n || '') === (m[2] || ''));
    if (a) openAssign(a);
  }
});
