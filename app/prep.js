// "לפני יום צילום ובקשות לקוחות" (prep.html, ?id=<client> for one client): Irit's
// part before the shoot day and her client requests (docs/plan/system-plan.md,
// section 3, Irit; stations 3–4; decision 15). The logic is in shoot-prep.js:
//   - the coordinator (11): a separate approval for the client, the influencers,
//     Lior and Eli; "closed" only with all four and the calendar; Natali's makeup
//     artist and ride (11ב);
//   - the blockers (14), computed from what the system knows, each with "עברתי"
//     (for today) or "דווח לליאור" (an exception at once, shown here until closed);
//     topics that are clear close their process-14 item by themselves;
//   - the day-before check (15) from the business day before the shoot (reminded at
//     11:15; a Sunday shoot: Thursday): what the system knows is filled in, she
//     answers the rest, and every failed item goes to Lior at once;
//   - a client's request (her section 17): one tap opens a task with an owner and a
//     due day, with a ready "we got it" message; when that task is done, the database
//     opens "לעדכן את הלקוח" for her, shown here with a ready message.
import { PEOPLE, STAFF_PEOPLE, SHOOT_TYPES } from './protocol.js';
import { clientState, parseDate } from './protocol-logic.js';
import {
  loadClients, loadChecks, loadTasks, setCheck, clearCheck, setChecksBulk, setTaskDone, updateClient, loadDirectory,
} from './protocol-data.js';
import {
  $, fill, h, toast, errorText, mountSession, viewerOf, VIEWER_UNKNOWN, directory, who, formatStamp, formatWhen, formatDay,
} from './protocol-ui.js';
import { noteDateChange } from './owner-data.js';
import {
  shootContexts, coordinatorOf, shootPrep, topicsToClose, TOPIC_NOTE, TOPICS, seenToday, seenNote, SEEN, reportedOf, blockerTask,
  dayBefore, dayBeforeResult, dayBeforeNote, dayBeforeTask, DAY_BEFORE_KEY, requestTask, requestDue, requestProblems, ackMessage,
  tellMessage, requestOf, REQUEST, TELL,
} from './shoot-prep.js';
import { MISSING_TITLE, missingMessage } from './characterization.js';
import { materialsOf, waLink, dayText } from './messages-logic.js';
import { loadRequestTasks, insertTask, loadAccessStatuses } from './intake-data.js';
import { googleCalendarUrl } from './calendar.js';
import { inputValueIL, fromInputIL, dayKeyIL, dayFromKeyIL } from './tz.js';
// The photographer's monthly availability (docs/ops.md, section 39): the line next to the date, and the reason for a day he did not mark free.
import { mountAvailability, shootDayHint, confirmShootDay, photographerNote } from './availability-ui.js';

const only = new URLSearchParams(location.search).get('id');
let clients = [];
let checks = {};
let tasks = [];          // open tasks of every client
let requests = [];       // request and "tell" tasks, open or finished lately
let access = [];         // broken or missing logins
let me = null;
let busy = false;
const answers = new Map();   // day-before answers being given, by `${client}:${pre}`
const shootDraft = new Map(); // a shoot date being typed, by client
const eliNotes = new Map();   // what the photographer handed over for a shoot's day, by its moment (never his approval itself)
let lastAck = null;           // the request just opened: its ready "we got it" message
let reqDraft = { client: only || '', text: '', owner: '', due: '', urgent: false };
let reqErrors = {};

const clean = (v) => String(v ?? '').trim();
const live = (c) => c.status === 'active' || c.status === 'ending';
const clientOf = (cid) => clients.find((c) => c.id === cid) || null;
const cardUrl = (cid, hash = '') => `client.html?id=${encodeURIComponent(cid)}${hash}`;
const safeId = (s) => String(s).replace(/[^\w-]/g, '_');

// ── Loading ───────────────────────────────
async function load() {
  $('state').textContent = clients.length ? '' : 'טוען…';
  try {
    [clients, checks, tasks] = await Promise.all([loadClients(), loadChecks(), loadTasks({ openOnly: true })]);
  } catch (err) { $('state').textContent = errorText(err); return; }
  [requests, access] = await Promise.all([loadRequestTasks().catch(() => []), loadAccessStatuses()]);
  $('state').textContent = '';
  render();
  closeClearTopics();
  primeEliNotes();
}

// Under "אלי הצלם" in the coordinator: whether he marked that shoot's day free. Read once per date, then drawn.
async function primeEliNotes() {
  let fresh = false;
  for (const e of entries()) {
    const key = e.coord.shootAt?.toISOString();
    if (!key || eliNotes.has(key)) continue;
    eliNotes.set(key, await photographerNote(e.coord.shootAt, { me }));
    fresh = fresh || !!eliNotes.get(key);
  }
  if (fresh && !busy && !document.activeElement?.closest('form, .pp-form')) render();
}

// Shoots to prepare: live clients whose shoot-date process (11) started and is
// open, or whose shoot is ahead; the main shoot and each round.
function entries(now = new Date()) {
  const out = [];
  for (const c of clients) {
    if (!live(c) || (only && c.id !== only)) continue;
    const ch = checks[c.id] || {};
    const state = clientState(c, ch, now);
    const preps = shootPrep(c, ch, state, { tasks, access, now });
    for (const x of shootContexts(c)) {
      const p11 = state.states.find((s) => s.proc.id === `${x.pid}p11`);
      const shoot = parseDate(x.ctx.shoot_at);
      if (!p11 || !(p11.ready || p11.touched)) continue;
      if (p11.complete && !(shoot && shoot > now)) continue;
      const prep = preps.find((p) => p.n === x.n) || null;
      out.push({ c, x, state, prep, shoot, coord: coordinatorOf(c, ch, x), eve: dayBefore(c, ch, prep, x, now) });
    }
  }
  return out.sort((a, b) => (a.shoot?.getTime() ?? 0) - (b.shoot?.getTime() ?? 0));
}

// Clear topics close their item of process 14 by themselves (once, quietly).
let closing = false;
async function closeClearTopics() {
  if (closing) return;
  closing = true;
  const now = new Date();
  for (const e of entries(now)) {
    if (!e.prep) continue;
    const keys = topicsToClose(e.prep, checks[e.c.id] || {}, now);
    if (!keys.length) continue;
    try {
      const rows = await setChecksBulk(e.c.id, keys, 'done', TOPIC_NOTE);
      for (const r of rows) (checks[e.c.id] ||= {})[r.item_key] = r;
    } catch { /* the next visit tries again */ }
  }
  closing = false;
}

// ── Rendering ─────────────────────────────
function render(focusId = document.activeElement?.id) {
  const list = entries();
  const blockers = list.reduce((n, e) => n + (e.prep?.blockers.length || 0), 0);
  const open = list.filter((e) => !e.coord.fullyClosed).length;
  const summary = [only && clientOf(only) ? clientOf(only).name : null,
    list.length ? `${list.length === 1 ? 'יום צילום אחד' : `${list.length} ימי צילום`} בהכנה` : 'אין ימי צילום בהכנה',
    open ? `${open} עוד לא סגורים מול כולם` : null, blockers ? `${blockers === 1 ? 'חוסם אחד' : `${blockers} חוסמים`}` : null].filter(Boolean).join(' · ');
  if ($('pp-summary').textContent !== summary) $('pp-summary').textContent = summary;
  fill($('pp-filter'), only ? h('a', { class: 'btn btn-sm btn-ghost', href: 'prep.html' }, 'כל הלקוחות') : null,
    only ? h('a', { class: 'btn btn-sm btn-ghost', href: cardUrl(only) }, 'לכרטיס הלקוח') : null);
  fill($('pp-shoots'), ...(list.length ? list.map(shootCard) : [h('li', { class: 'pp-card' }, h('p', { class: 'muted' }, 'אין כרגע יום צילום שצריך לסגור או להכין.'))]));
  fill($('pp-requests'), requestsBlock());
  if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
}

function shootCard(e) {
  const { c, x, coord, prep, eve } = e;
  const round = x.n > 1 ? ` · סבב ${x.n}` : '';
  const k = `${safeId(c.id)}-${x.n}`;
  const blocked = !!prep?.blockers.length;
  return h('li', { class: `pp-card${coord.fullyClosed && !blocked ? ' is-closed' : ''}${blocked ? ' has-block' : ''}`, id: `shoot-${k}` },
    h('div', { class: 'pp-head' },
      h('h2', {}, h('a', { href: cardUrl(c.id, `#${x.pid}p11`) }, c.name), round),
      h('span', { class: 'pp-when' }, [e.shoot ? `יום צילום ${formatStamp(e.shoot)}` : 'יום הצילום טרם נקבע', coord.shootType ? SHOOT_TYPES[coord.shootType]?.name : null].filter(Boolean).join(' · '))),
    coordinatorBlock(e, k),
    prep ? blockersBlock(e, k) : null,
    eve ? dayBeforeBlock(e, k) : null);
}

// ── 11: the coordinator ───────────────────
function coordinatorBlock(e, k) {
  const { c, x, coord } = e;
  const status = coord.closed
    ? (coord.nataliMissing.length ? `סגור מול כולם · חסר עוד לנטלי: ${coord.nataliMissing.join(' ו')}` : 'היום סגור: כולם אישרו והוא ביומן')
    : `עוד לא סגור · חסר: ${coord.missing.join(', ')}`;
  const party = (a, note = null) => h('li', { class: 'pp-party' },
    h('button', {
      type: 'button', class: 'btn', id: `pty-${k}-${a.key.replace(/\./g, '-')}`, 'aria-pressed': String(a.done), disabled: busy,
      onclick: (ev) => toggleCheck(c.id, a.key, !a.done, ev.currentTarget.id),
    }, h('span', {}, a.label, a.done && a.check ? h('small', {}, `אושר ${formatWhen(new Date(a.check.at))}`) : note ? h('small', {}, note) : null)));
  const edit = x.n === 1 && (!coord.shootAt || !coord.shootType);
  const dt = shootDraft.get(c.id) ?? (coord.shootAt ? inputValueIL(coord.shootAt) : '');
  const cal = coord.shootAt ? googleCalendarUrl({
    title: `יום צילום · ${c.name}${coord.shootType ? ` · ${SHOOT_TYPES[coord.shootType].name}` : ''}`,
    start: new Date(coord.shootAt.getTime() - 36e5), minutes: 60 + (coord.shootType === 'dms' ? 330 : 180), location: c.address || '',
    details: `הגעת המשפיענים: ${formatStamp(coord.shootAt)}. הצוות מגיע שעה לפני.`,
  }) : null;
  // Closed with everyone: one line, the approvals folded under it.
  const Wrap = coord.fullyClosed ? 'details' : 'section';
  return h(Wrap, { class: 'pp-sub', 'aria-labelledby': coord.fullyClosed ? null : `co-${k}` },
    coord.fullyClosed ? h('summary', { class: 'pp-sum' }, h('span', { id: `co-${k}` }, 'סגירת יום הצילום (11): '), h('span', { class: 'pp-status is-ok' }, status))
      : h('h3', { id: `co-${k}` }, 'סגירת יום הצילום (11)'),
    coord.fullyClosed ? null : h('p', { class: `pp-status ${coord.closed ? 'is-ok' : 'is-open'}`, role: 'status' }, status),
    edit ? h('div', { class: 'pp-form' },
      h('div', { class: 'row2' },
        h('div', { class: 'field' }, h('label', { for: `sh-type-${k}` }, 'עם מי מצלמים'),
          h('select', { class: 'input', id: `sh-type-${k}` },
            h('option', { value: '' }, 'טרם נקבע'),
            ...Object.values(SHOOT_TYPES).map((t) => h('option', { value: t.key, selected: coord.shootType === t.key }, t.name)))),
        h('div', { class: 'field' }, h('label', { for: `sh-at-${k}` }, 'הגעת המשפיענים'),
          shootAtField(c, k, dt))),
      h('button', { type: 'button', class: 'btn', id: `sh-save-${k}`, disabled: busy, onclick: () => saveShoot(c, k) }, 'שמירת המועד')) : null,
    h('ul', { class: 'pp-parties', 'aria-label': 'אישורים' },
      ...coord.approvals.map((a) => party(a, a.key === `${x.pre}p11.ok.photographer` ? eliNotes.get(coord.shootAt?.toISOString()) || null : null)), party(coord.contract)),
    h('div', { class: 'ik-row' },
      cal ? h('a', { class: 'btn btn-ghost', href: cal, target: '_blank', rel: 'noopener' }, 'Google Calendar', h('span', { class: 'sr-only' }, ' (נפתח בחלון חדש)')) : null,
      h('button', {
        type: 'button', class: 'btn', id: `cal-${k}`, 'aria-pressed': String(coord.calendar.done), disabled: busy || !coord.shootAt || !coord.shootType,
        onclick: (ev) => toggleCheck(c.id, coord.calendar.key, !coord.calendar.done, ev.currentTarget.id),
      }, coord.calendar.done ? '✓ ביומן של כולם' : 'הוכנס ליומן של כולם')),
    coord.natali.length ? h('div', { class: 'pp-sub' },
      h('h3', {}, 'נטלי: מאפרת והסעה (11ב, באחריות ליאור)'),
      h('ul', { class: 'pp-parties' }, ...coord.natali.map((a) => party(a, me === 'lior' ? null : 'סימון בשם ליאור נרשם בשמך')))) : null);
}
// The date with, under it, what the photographer handed over for the day being picked.
function shootAtField(c, k, dt) {
  const input = h('input', { class: 'input', id: `sh-at-${k}`, type: 'datetime-local', dir: 'ltr', value: dt, 'aria-describedby': `sh-at-${k}-avail`, oninput: (ev) => shootDraft.set(c.id, ev.currentTarget.value) });
  const hint = shootDayHint(input, { me, own: c.shoot_at });
  hint.id = `sh-at-${k}-avail`;
  if (dt) hint.refresh();
  return [input, hint];
}
async function saveShoot(c, k) {
  const type = $(`sh-type-${k}`).value || null;
  const at = fromInputIL($(`sh-at-${k}`).value);
  const fields = {};
  if (type) fields.shoot_type = type;
  if (at) fields.shoot_at = at.toISOString();
  if (!Object.keys(fields).length) { toast('לבחור עם מי מצלמים ומועד.'); return; }
  // Against the usual order (in the past, before the characterization, too soon after it): ask, with the reason.
  const asked = at ? await confirmShootDay({ shootAt: at, charAt: c.char_at, own: c.shoot_at, me }) : { ok: true, note: null };
  if (!asked.ok) { $(`sh-at-${k}`).focus(); return; }
  busy = true;
  try {
    const row = await updateClient(c.id, fields);
    if (asked.note) await noteDateChange(c.id, 'shoot_at', null, fields.shoot_at, asked.note);
    clients = clients.map((x) => (x.id === c.id ? row : x));
    shootDraft.delete(c.id);
    toast('המועד נשמר.');
  } catch (err) { toast(`לא נשמר. ${errorText(err)}`); }
  busy = false;
  render(`sh-save-${k}`);
  primeEliNotes();
}
async function toggleCheck(cid, key, on, focusId, note = null) {
  if (busy) return;
  busy = true;
  render(focusId);
  try {
    if (on) (checks[cid] ||= {})[key] = await setCheck(cid, key, 'done', note);
    else { await clearCheck(cid, key); delete checks[cid][key]; }
  } catch (err) { toast(`הסימון לא נשמר. ${errorText(err)}`); }
  busy = false;
  render(focusId);
}

// ── 14: blockers ──────────────────────────
function blockersBlock(e, k) {
  const { c, prep } = e;
  const now = new Date();
  const seen = seenToday(checks[c.id] || {}, prep.pre, now);
  const reported = reportedOf(tasks, c.id);
  const clear = prep.topics.filter((t) => t.clear).length;
  const row = (b) => {
    const rep = reported.get(b.id);
    const isSeen = seen.has(b.id);
    const bid = `blk-${k}-${safeId(b.id)}`;
    const seenBtn = isSeen ? h('span', { class: 'hint' }, 'עברת היום') : h('button', { type: 'button', class: 'btn btn-sm', id: `${bid}-seen`, disabled: busy, onclick: () => markSeen(c, prep, b, b.known ? `bl-${k}` : `${bid}-report`) }, 'עברתי');
    return h('li', { class: `pp-blocker${rep ? ' is-reported' : isSeen ? ' is-seen' : ''}`, id: bid },
      h('span', { class: 'pp-topic' }, `${TOPICS.find((t) => t.key === b.topic)?.label}${b.who ? ` · ${PEOPLE[b.who]?.name || b.who}` : ''}`),
      h('p', {}, b.text),
      rep ? h('p', { class: 'hint' }, `דווח לליאור ${formatStamp(rep.created_at)}${rep.urgent ? ' · דחוף' : ''}. נשאר כאן עד שהחריגה תיסגר.`)
        : b.known ? h('div', { class: 'pp-acts' }, seenBtn, h('span', { class: 'hint' }, 'כבר אצל ליאור כחריגה.'))
          : h('div', { class: 'pp-acts' }, seenBtn,
            h('button', { type: 'button', class: 'btn btn-sm btn-primary', id: `${bid}-report`, disabled: busy, onclick: () => report(c, prep, b, `${bid}-report`) }, 'דווח לליאור')));
  };
  return h('section', { class: 'pp-sub', 'aria-labelledby': `bl-${k}` },
    h('h3', { id: `bl-${k}`, tabindex: '-1' }, `חוסמי יום צילום (14)${prep.blockers.length ? ` · ${prep.blockers.length}` : ''}`),
    prep.blockers.length ? h('ul', { class: 'pp-blockers' }, ...prep.blockers.map(row))
      : h('p', { class: 'pp-clear' }, `אין חוסמים. ${clear} מתוך ${prep.topics.length} נושאים סגורים.`));
}
async function markSeen(c, prep, b, focusId) {
  await toggleCheck(c.id, SEEN(prep.pre), true, focusId, seenNote(checks[c.id] || {}, prep.pre, b.id));
}
async function report(c, prep, b, focusId) {
  if (busy) return;
  busy = true;
  try {
    tasks.push(await insertTask(blockerTask(c, prep, b)));
    toast('דווח לליאור. החוסם נשאר ברשימה עד שהחריגה תיסגר.');
  } catch (err) { toast(`הדיווח לא נשלח. ${errorText(err)}`); }
  busy = false;
  render(focusId);
}

// ── 15: the day-before check ──────────────
function dayBeforeBlock(e, k) {
  const { c, eve } = e;
  const akey = `${c.id}:${eve.pre}`;
  const given = answers.get(akey) || {};
  if (!eve.open && !eve.done) {
    return h('section', { class: 'pp-sub' }, h('h3', {}, 'בדיקת יום לפני (15)'),
      h('p', { class: 'hint' }, `נפתחת ב${dayText(eve.eve)}, עם תזכורת ב־11:15.`));
  }
  if (eve.done) {
    const failed = eve.items.filter((i) => eve.done.failed.includes(i.id)).map((i) => i.label);
    return h('section', { class: 'pp-sub' }, h('h3', {}, 'בדיקת יום לפני (15)'),
      h('p', { class: `pp-status ${failed.length ? 'is-open' : 'is-ok'}` },
        `בוצעה ${formatStamp(eve.done.at)} · ${who(eve.done.by_email)}${failed.length ? ` · נכשלו ועברו לליאור: ${failed.join(', ')}` : ' · הכול תקין'}`));
  }
  const item = (it) => {
    const nm = `db-${k}-${it.id}`;
    return h('li', { class: 'pp-check' },
      h('div', { class: 'pp-check-h' },
        h('strong', {}, it.label),
        it.auto === 'ok' ? h('span', { class: 'pp-sys is-ok' }, '✓ המערכת יודעת: בוצע') : it.auto === 'fail' ? h('span', { class: 'pp-sys is-fail' }, '✗ לא בוצע: יעבור לליאור') : null),
      it.why ? h('p', { class: 'hint' }, it.why) : null,
      it.auto ? null : h('fieldset', { class: 'ik-seg' }, h('legend', { class: 'sr-only' }, it.label),
        h('div', { class: 'ik-seg-opts' }, ...[['ok', 'תקין'], ['fail', 'נכשל']].map(([v, label]) => h('label', { class: 'ik-opt' },
          h('input', { type: 'radio', name: nm, id: `${nm}-${v}`, value: v, checked: given[it.id] === v, onchange: () => { answers.set(akey, { ...given, [it.id]: v }); render(`${nm}-${v}`); } }),
          h('span', {}, label))))));
  };
  const res = dayBeforeResult(eve, given);
  return h('section', { class: 'pp-sub', 'aria-labelledby': `db-${k}` },
    h('h3', { id: `db-${k}` }, `בדיקת יום לפני (15) · עד ${formatWhen(eve.at)}`),
    h('ul', { class: 'pp-checks' }, ...eve.items.map(item)),
    h('button', { type: 'button', class: 'btn btn-primary ik-big', id: `db-done-${k}`, disabled: busy || !res, 'aria-describedby': `db-done-${k}-d`, onclick: () => submitDayBefore(e, k) },
      res?.failed.length ? `סיום הבדיקה ושליחה לליאור (${res.failed.length})` : 'סיום הבדיקה'),
    h('p', { class: 'hint', id: `db-done-${k}-d` }, res ? 'כל פריט שנכשל עובר לליאור מיד, כחריגה דחופה.' : 'לענות קודם על מה שהמערכת לא יודעת.'));
}
async function submitDayBefore(e, k) {
  const { c, eve } = e;
  const res = dayBeforeResult(eve, answers.get(`${c.id}:${eve.pre}`) || {});
  if (!res || busy) return;
  busy = true;
  render();
  try {
    if (res.failed.length) tasks.push(await insertTask(dayBeforeTask(c, eve, res.failed)));
    (checks[c.id] ||= {})[DAY_BEFORE_KEY(eve.pre)] = await setCheck(c.id, DAY_BEFORE_KEY(eve.pre), 'done', dayBeforeNote(res));
    answers.delete(`${c.id}:${eve.pre}`);
    toast(res.failed.length ? 'הבדיקה נשמרה, והפריטים שנכשלו עברו לליאור.' : 'הבדיקה נשמרה: הכול תקין.');
  } catch (err) { toast(`לא נשמר. ${errorText(err)}`); }
  busy = false;
  render(`db-${k}`);
}

// ── Irit's section 17: client requests ────
const OWNERS = () => STAFF_PEOPLE();
function requestsBlock() {
  const now = new Date();
  const liveClients = clients.filter(live).sort((a, b) => a.name.localeCompare(b.name, 'he'));
  const visible = (t) => !only || t.client_id === only;
  const tells = requests.filter((t) => t.source === TELL && !t.done_at && visible(t));
  const openReq = requests.filter((t) => t.source === REQUEST && !t.done_at && visible(t));
  const missing = tasks.filter((t) => t.title.startsWith(MISSING_TITLE) && visible(t));
  if (!reqDraft.due) reqDraft.due = requestDue(now, reqDraft.urgent);
  const err = (k) => (reqErrors[k] ? h('p', { class: 'err', id: `rq-${k}-err` }, reqErrors[k]) : null);
  const inv = (k) => (reqErrors[k] ? { 'aria-invalid': 'true', 'aria-describedby': `rq-${k}-err` } : {});
  const ack = lastAck ? clientOf(lastAck.client_id) : null;
  return h('div', { class: 'ik-stack' },
    h('form', { class: 'pp-form', id: 'rq-form', novalidate: true, onsubmit: (ev) => { ev.preventDefault(); submitRequest(); } },
      h('div', { class: 'field' }, h('label', { for: 'rq-client' }, 'לקוח'),
        h('select', { class: 'input', id: 'rq-client', ...inv('client'), onchange: (ev) => { reqDraft.client = ev.currentTarget.value; } },
          h('option', { value: '' }, 'בחירת לקוח…'), ...liveClients.map((c) => h('option', { value: c.id, selected: reqDraft.client === c.id }, c.name))), err('client')),
      h('div', { class: 'field' }, h('label', { for: 'rq-text' }, 'מה הלקוח ביקש'),
        (() => { const t = h('textarea', { class: 'input ik-text', id: 'rq-text', rows: '2', lang: 'he', dir: 'auto', maxlength: '500', ...inv('text'), oninput: (ev) => { reqDraft.text = ev.currentTarget.value; } }); t.value = reqDraft.text; return t; })(), err('text')),
      h('div', { class: 'row2' },
        h('div', { class: 'field' }, h('label', { for: 'rq-owner' }, 'מי מטפל'),
          h('select', { class: 'input', id: 'rq-owner', ...inv('owner'), onchange: (ev) => { reqDraft.owner = ev.currentTarget.value; } },
            h('option', { value: '' }, 'בחירה…'), ...OWNERS().map((p) => h('option', { value: p.key, selected: reqDraft.owner === p.key }, p.name))), err('owner')),
        h('div', { class: 'field' }, h('label', { for: 'rq-due' }, 'עד מתי'),
          h('input', { class: 'input', id: 'rq-due', type: 'date', dir: 'ltr', value: reqDraft.due, oninput: (ev) => { reqDraft.due = ev.currentTarget.value; } }))),
      h('label', { class: 'ik-check' }, h('input', { type: 'checkbox', id: 'rq-urgent', checked: reqDraft.urgent, onchange: (ev) => { reqDraft.urgent = ev.currentTarget.checked; reqDraft.due = requestDue(new Date(), reqDraft.urgent); render('rq-urgent'); } }),
        h('span', {}, 'דחוף (טיפול תוך שעה; מי שמטפל לוחץ "התחלתי")')),
      h('button', { type: 'submit', class: 'btn btn-primary ik-big', id: 'rq-submit', disabled: busy }, 'פתיחת משימה')),
    lastAck && ack ? h('div', { class: 'pp-request', id: 'rq-ack', tabindex: '-1' },
      h('p', {}, h('strong', {}, `נפתחה משימה ל${PEOPLE[lastAck.owner]?.name || lastAck.owner}`), lastAck.due_on ? ` עד ${formatDay(lastAck.due_on)}` : '', '. אישור קבלה ללקוח:'),
      h('p', { class: 'pp-msg' }, ackMessage(ack, lastAck.title, lastAck.owner, lastAck.due_on)),
      h('div', { class: 'pp-acts' },
        h('a', { class: 'btn btn-primary', href: waLink(ack.phone, ackMessage(ack, lastAck.title, lastAck.owner, lastAck.due_on)), target: '_blank', rel: 'noopener', id: 'rq-ack-wa' }, 'שליחה בוואטסאפ', h('span', { class: 'sr-only' }, ' (נפתח בחלון חדש)')),
        h('button', { type: 'button', class: 'btn-text', onclick: () => { lastAck = null; render('rq-text'); } }, 'סגירה'))) : null,
    tells.length ? h('section', { 'aria-labelledby': 'tell-h' }, h('h3', { id: 'tell-h' }, `לעדכן את הלקוח (${tells.length})`),
      h('ul', { class: 'pp-requests' }, ...tells.map(tellRow))) : null,
    missing.length ? h('section', { 'aria-labelledby': 'miss-h' }, h('h3', { id: 'miss-h' }, `חומרים להשלים מהלקוח (${missing.length})`),
      h('ul', { class: 'pp-requests' }, ...missing.map(missingRow))) : null,
    h('section', { 'aria-labelledby': 'open-h' }, h('h3', { id: 'open-h' }, `בקשות בטיפול (${openReq.length})`),
      openReq.length ? h('ul', { class: 'pp-requests' }, ...openReq.map((t) => {
        const c = clientOf(t.client_id);
        const late = t.due_on && t.due_on < dayKeyIL(now);
        return h('li', { class: 'pp-request' },
          h('p', {}, h('a', { href: cardUrl(t.client_id, '#tasks') }, c?.name || 'לקוח'), ` · ${clean(t.title)}`),
          h('p', { class: 'hint' }, [`אצל ${PEOPLE[t.owner]?.name || t.owner}`, t.due_on ? `עד ${formatDay(t.due_on)}` : null, late ? 'באיחור' : null, t.urgent ? 'דחוף' : null,
            `נפתח ${formatStamp(t.created_at)}`].filter(Boolean).join(' · ')));
      })) : h('p', { class: 'muted' }, 'אין בקשות פתוחות.')));
}
function tellRow(t) {
  const c = clientOf(t.client_id);
  if (!c) return null;
  const text = tellMessage(c, requestOf(t));
  const rid = `tell-${safeId(t.id)}`;
  return h('li', { class: 'pp-request', id: rid },
    h('p', {}, h('strong', {}, c.name), ` · ${requestOf(t)}`),
    h('p', { class: 'hint' }, `טופל${t.brief?.done_by ? ` ע״י ${who(t.brief.done_by)}` : ''} · ${formatStamp(t.created_at)}`),
    h('p', { class: 'pp-msg' }, text),
    h('div', { class: 'pp-acts' },
      h('a', { class: 'btn', href: waLink(c.phone, text), target: '_blank', rel: 'noopener' }, 'שליחה בוואטסאפ', h('span', { class: 'sr-only' }, ' (נפתח בחלון חדש)')),
      h('button', { type: 'button', class: 'btn btn-primary', id: `${rid}-done`, disabled: busy, onclick: () => finishTask(t, 'עודכן. תודה!', `${rid}-done`) }, 'עדכנתי את הלקוח')));
}
function missingRow(t) {
  const c = clientOf(t.client_id);
  if (!c) return null;
  const m = materialsOf(checks[c.id] || {});
  const text = missingMessage(c, m.missing.length ? m.missing : [clean(t.title.slice(MISSING_TITLE.length + 1))], m.got, m.of);
  const rid = `miss-${safeId(t.id)}`;
  return h('li', { class: 'pp-request', id: rid },
    h('p', {}, h('a', { href: cardUrl(c.id, '#p05') }, c.name), ` · ${clean(t.title.slice(MISSING_TITLE.length + 1))}`),
    h('p', { class: 'pp-msg' }, text),
    h('div', { class: 'pp-acts' },
      h('a', { class: 'btn', href: waLink(c.phone, text), target: '_blank', rel: 'noopener' }, 'שליחה בוואטסאפ', h('span', { class: 'sr-only' }, ' (נפתח בחלון חדש)')),
      h('button', { type: 'button', class: 'btn btn-primary', id: `${rid}-done`, disabled: busy, onclick: () => finishTask(t, 'המשימה סומנה כבוצעה.', `${rid}-done`) }, 'הכול התקבל')));
}
async function finishTask(t, msg, focusId) {
  if (busy) return;
  busy = true;
  try {
    const row = await setTaskDone(t.id, true);
    requests = requests.map((x) => (x.id === t.id ? row : x));
    tasks = tasks.filter((x) => x.id !== t.id);
    toast(msg);
  } catch (err) { toast(`לא נשמר. ${errorText(err)}`); }
  busy = false;
  render(focusId);
}
async function submitRequest() {
  const c = clientOf(reqDraft.client);
  const problems = requestProblems({ client: c, text: reqDraft.text, owner: reqDraft.owner });
  reqErrors = problems;
  if (Object.keys(problems).length) {
    render();
    $(`rq-${['client', 'text', 'owner'].find((k2) => problems[k2])}`)?.focus();
    return;
  }
  if (busy) return;
  busy = true;
  render('rq-submit');
  try {
    const due = dayFromKeyIL(reqDraft.due) ? reqDraft.due : requestDue(new Date(), reqDraft.urgent);
    const row = await insertTask(requestTask({ client: c, text: reqDraft.text, owner: reqDraft.owner, dueOn: due, urgent: reqDraft.urgent }));
    requests = [row, ...requests];
    tasks.push(row);
    lastAck = row;
    reqDraft = { client: only || '', text: '', owner: '', due: '', urgent: false };
    toast(`נפתחה משימה ל${PEOPLE[row.owner]?.name || row.owner}.`);
  } catch (err) { toast(`המשימה לא נפתחה. ${errorText(err)}`); }
  busy = false;
  render('rq-ack');
}

// ── Start ─────────────────────────────────
$('btn-refresh').addEventListener('click', () => load());
mountSession(async (staff) => {
  const v = await viewerOf(staff.email);
  me = v.me;
  Object.assign(directory, await loadDirectory());
  if (v.error) { $('app').hidden = true; $('state').textContent = VIEWER_UNKNOWN; return; }
  if (v.scope !== 'office') {
    $('app').hidden = true;
    $('state').textContent = 'העמוד הזה של המשרד: עירית, ליאור ואופיר.';
    return;
  }
  await load();
  mountAvailability($('availability'), { me });
  if (location.hash === '#requests') { $('requests').scrollIntoView(); $('rq-text')?.focus({ preventScroll: true }); }
  setInterval(() => { if (!document.hidden && !busy && !document.activeElement?.closest('form')) load(); }, 120e3);
});
