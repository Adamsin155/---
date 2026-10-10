// The "now" bar at the top of "my work" (clients.html): the clocks of
// app/clocks.js as live countdowns. It is drawn with the list; between those
// renders `updateNowBar` changes only the countdown texts, once a second, so
// nothing else is rebuilt and focus never moves. "The client answered" is there
// from the sending (a small button: the client may answer within the minutes);
// when that clock runs out the row turns red in place and the button grows,
// next to "call" (a tel: link).
// A row of Ofir's fast ladder (kind 'fast', protocol v9) counts its minutes ("נשארו
// 7:12"), then the extra ones ("באיחור · עוד 4:10"), then says "באיחור · ליאור עודכן",
// and carries one button straight to the place the work is done in.
import { h, fill, formatWhen, lateBy, peopleChips } from './protocol-ui.js';
import { clockTime, clockDigits } from './clocks.js';
import { clientLabel } from './protocol-logic.js';
import { PEOPLE, FAST_LADDER } from './protocol.js';

export const clockDomId = (id) => String(id).replace(/[^\w-]/g, '_');
const round = (proc) => /^r(\d+)-/.exec(proc.id)?.[1] || null;
const numOf = (proc) => (round(proc) ? `${proc.num} (סבב ${round(proc)})` : proc.num);
const cardUrl = (c) => `client.html?id=${encodeURIComponent(c.client.id)}#${c.proc.id}`;
const telHref = (phone) => `tel:${String(phone).replace(/[^\d+]/g, '')}`;
// "a, b וc"
const listHe = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ו${xs.at(-1)}`);

// Clocks of one client that end together share a row (the new deal's three:
// "contract, group and characterization date"). Each "did not answer" keeps its
// own row, with its own buttons.
export function clockRows(clocks) {
  const rows = [];
  for (const c of clocks) {
    const row = c.kind !== 'answer' && rows.find((r) => r.kind === c.kind && r.client.id === c.client.id && +r.deadline === +c.deadline);
    if (row) row.clocks.push(c);
    else rows.push({ ...c, clocks: [c] });
  }
  // The same moment: shown in office time only when every clock of the row runs on it.
  return rows.map((r) => ({ ...r, office: r.clocks.every((c) => c.office), people: [...new Set(r.clocks.flatMap((c) => c.people))] }));
}

export const rowRef = (row) => (row.clocks.length > 1 ? `תהליכים ${row.clocks.map((c) => numOf(c.proc)).join(', ')}` : `תהליך ${numOf(row.proc)}`);
// What the row is about, in one line.
export function rowWhat(row, t) {
  const what = listHe(row.clocks.map((c) => c.what));
  if (row.kind === 'fast') return row.fast.kind === 'assign' ? 'לשייך עורך' : `לבדוק ולאשר: ${what}${row.fast.round > 1 ? ' (אחרי תיקון)' : ''}`;
  if (row.kind === 'deal') return `עסקה חדשה: ${what}`;
  if (row.kind === 'answer') return t.state === 'expired' ? `הלקוח לא ענה: ${what}` : `נשלח ללקוח: ${what}`;
  return what;
}
function rowMeta(row, t, now) {
  if (row.kind === 'answer') {
    const sent = `${rowRef(row)} · נשלח ${formatWhen(row.sentAt, now)}`;
    return t.state === 'expired' ? `${sent} · עברו ${row.minutes} דקות בלי תשובה` : `${sent} · אם אין תשובה עד ${formatWhen(row.deadline, now)}, מתקשרים`;
  }
  if (row.kind === 'fast') return `${rowRef(row)} · הגיע ${formatWhen(row.fast.t0, now)} · יעד ${formatWhen(row.deadline, now)}`;
  return `${rowRef(row)} · יעד ${formatWhen(row.deadline, now)}`;
}
// What is said (and notified) when a row's time runs out.
export function ranOutText(row) {
  if (row.kind === 'answer') {
    return { title: `הלקוח לא ענה: ${clientLabel(row.client)}`, body: `${listHe(row.clocks.map((c) => c.what))} (${rowRef(row)}). עברו ${row.minutes} דקות בלי תשובה: להתקשר.` };
  }
  return { title: `נגמר הזמן: ${clientLabel(row.client)}`, body: `${rowWhat(row, { state: 'expired' })} (${rowRef(row)}).` };
}
const managerName = () => PEOPLE[FAST_LADDER.manager]?.name || '';
// The fast ladder's three phases (app/fast-ladder.js): the label, and the digits or the words under it.
const fastLabel = (t, now) => (t.phase === 'run' ? (t.paused ? `עצור עד ${formatWhen(t.resumeAt, now)}` : 'נשארו') : t.phase === 'late' ? 'באיחור · עוד' : 'באיחור');
const fastLeft = (t) => (t.phase === 'run' ? clockDigits(t.remaining) : t.phase === 'late' ? clockDigits(t.more) : `${managerName()} עודכן`);
const stateLabel = (t, now) => (t.phase ? fastLabel(t, now) : t.state === 'expired' ? 'נגמר לפני' : t.paused ? `עצור עד ${formatWhen(t.resumeAt, now)}` : 'נשארו');
const leftText = (row, t, now) => (t.phase ? fastLeft(t) : t.state === 'expired' ? lateBy(row.deadline, now) : clockDigits(t.remaining));
// The one action of a fast row: Ofir's screen, opened on this very check or assignment.
function fastAct(row) {
  const sid = clockDomId(row.id);
  return h('div', { class: 'now-acts now-fast-acts' },
    h('a', { class: 'btn btn-sm k-btn-navy now-go', id: `now-go-${sid}`, href: row.url, 'aria-describedby': `now-a-${sid}` }, row.fast.kind === 'assign' ? 'שיוך עורך' : 'לבדיקה'));
}

// "Call": the client's number, as a link and in text.
function callAct(row) {
  const sid = clockDomId(row.id);
  return row.phone
    ? h('a', { class: 'btn btn-primary now-call', id: `now-call-${sid}`, href: telHref(row.phone), 'aria-describedby': `now-a-${sid}` },
      'להתקשר', h('bdi', { class: 'num', dir: 'ltr' }, row.phone))
    : h('p', { class: 'now-nophone' }, 'אין מספר טלפון בכרטיס הלקוח. ', h('a', { href: cardUrl(row) }, 'לכרטיס הלקוח'));
}

// While the clock runs: "the client answered" alone, small. Once it ran out:
// big, with "call" next to it.
function answerActs(row, onAnswered, expired) {
  const sid = clockDomId(row.id);
  return h('div', { class: 'now-acts' },
    h('button', {
      type: 'button', class: `btn now-answered${expired ? '' : ' btn-sm'}`, id: `now-ans-${sid}`, 'aria-describedby': `now-a-${sid} now-w-${sid}`,
      onclick: (ev) => onAnswered(row, ev.currentTarget),
    }, 'הלקוח ענה'),
    expired ? callAct(row) : null);
}

function rowItem(row, now, everyone, onAnswered) {
  const t = clockTime(row, now);
  const sid = clockDomId(row.id);
  return h('li', { class: `now-clock k-${row.kind}${t.paused ? ' is-paused' : ''}`, 'data-clock': row.id, 'data-state': t.state, 'data-phase': t.phase || null },
    // A timer is not a live region: the seconds are never read out, only on demand.
    h('div', { class: 'now-time', role: 'timer' },
      h('span', { class: 'now-state' }, stateLabel(t, now)), ' ',
      h('span', { class: 'now-left num' }, leftText(row, t, now))),
    h('div', { class: 'now-body' },
      h('a', { class: 'now-client', id: `now-a-${sid}`, href: cardUrl(row) }, clientLabel(row.client)),
      h('span', { class: 'now-what', id: `now-w-${sid}` }, rowWhat(row, t)),
      h('span', { class: 'now-meta' }, rowMeta(row, t, now)),
      everyone ? peopleChips(row.people) : null),
    row.kind === 'answer' ? answerActs(row, onAnswered, t.state === 'expired') : row.kind === 'fast' ? fastAct(row) : null);
}

// The whole bar; hidden when there is no clock. `everyone`: the owner's view,
// with the people of each clock.
export function renderNowBar(el, clocks, { now = new Date(), everyone = false, onAnswered }) {
  const rows = clockRows(clocks);
  el.hidden = !rows.length;
  if (!rows.length) { fill(el); return; }
  fill(el,
    h('div', { class: 'now-head' },
      h('h2', { class: 'now-h', id: 'now-h', tabindex: '-1' }, 'עכשיו', h('span', { class: 'n' }, String(rows.length))),
      h('p', { class: 'now-hint' }, `${everyone ? 'השעונים שרצים עכשיו אצל הצוות.' : 'השעונים שרצים עכשיו אצלך.'} התראה כשהזמן נגמר מגיעה רק כשהעמוד הזה פתוח.`)),
    h('ul', { class: 'now-list' }, ...rows.map((r) => rowItem(r, now, everyone, onAnswered))));
}

const setText = (el, text) => { if (el && el.textContent !== text) el.textContent = text; };

// Once a second: the countdowns, and a row whose time ran out turns red in place.
// Its "the client answered" button stays the same element (it may have focus).
export function updateNowBar(el, clocks, { now = new Date(), onAnswered }) {
  const rows = new Map(clockRows(clocks).map((r) => [r.id, r]));
  for (const li of el.querySelectorAll('.now-clock')) {
    const row = rows.get(li.dataset.clock);
    if (!row) continue;
    const t = clockTime(row, now);
    setText(li.querySelector('.now-state'), stateLabel(t, now));
    setText(li.querySelector('.now-left'), leftText(row, t, now));
    li.classList.toggle('is-paused', t.paused);
    if (t.phase && li.dataset.phase !== t.phase) li.dataset.phase = t.phase;
    if (li.dataset.state === t.state) continue;
    li.dataset.state = t.state;
    setText(li.querySelector('.now-what'), rowWhat(row, t));
    setText(li.querySelector('.now-meta'), rowMeta(row, t, now));
    if (row.kind !== 'answer' || t.state !== 'expired') continue;
    const acts = li.querySelector('.now-acts');
    if (!acts) { li.append(answerActs(row, onAnswered, true)); continue; }
    acts.querySelector('.now-answered')?.classList.remove('btn-sm');
    if (!acts.querySelector('.now-call, .now-nophone')) acts.append(callAct(row));
  }
}
