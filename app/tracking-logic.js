// "מעקב לקוחות" (tracking.html; the owner's request of 9.11.2026, for Irit): one row per client in
// work, with who edits it and three counts against the package: the videos edited, the graphics
// up on the networks and the shoot days that took place. Pure, no DOM (tests/tracking.test.mjs);
// the page is app/tracking.js. Read-only: nothing here is marked or saved, and no money is read.
//
// Where each number comes from (docs/ops.md, section 121):
//   videos     the editors' own counter, "נערכו 7/25" (public.editor_progress, per client, shoot
//              round and editor; app/edit-count.js), summed over the client's shoots. A shoot whose
//              editing is finished (its "כל הסרטונים הועלו לדרייב", p24.drive, is done) counts at
//              least its part of the package, so a client edited before the counter existed
//              (1.11.2026) is not shown as 0. Out of: deliverables.videos.
//              A monthly client (deliverables.videos_month) is shown for this Israel month:
//              public.editor_progress_month, out of the month's number ("החודש").
//   graphics   the protocol's own marks: "9 הגרפיקות שאושרו הועלו לרשתות" (7ב, p07b.posted) is 9,
//              "יתרת הגרפיקות שאושרו הועלו לרשתות או תוזמנו" (23ב, p23b.posted) is all of them; or the
//              content Gantt's graphic rows marked "עלה" (posted), when they are more. Out of:
//              deliverables.graphics. (The Gantt alone would say 0 for everyone: on 9.11.2026 no
//              graphic row of it was "עלה", while 81 clients had 7ב and 30 had 23ב.)
//   shoot days the shoot-day table's own count (app/shoot-table.js shootHistory): a shoot day took
//              place once its date is behind today, or a mark says so. Out of: deliverables.shoot_days
//              + photo_days. With the last one that took place and the next one set.
import { PEOPLE, editorsOf, shareOf } from './protocol.js';
import { roundsOf, roundContext, isMonthlyRound, clientLabel } from './protocol-logic.js';
import { videosPerDay } from './production.js';
import { isMonthly, monthKey, monthTargetOf } from './edit-count.js';
import { shootHistory } from './shoot-table.js';
import { partsIL } from './tz.js';

// The clients in work: active, or in their last month ("ending"); also those still in landing
// (a client in landing is a client for every list; docs/ops.md, section 41). Not the ended ones.
export const inWork = (c) => c?.status === 'active' || c?.status === 'ending';

const whole = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const isDone = (checks, key) => checks?.[key]?.state === 'done';

// The client's shoots, the first one (its own) and every shoot round; a monthly editing round is
// not a shoot (app/monthly-rounds.js).
export function shootsOf(client) {
  return [{ ctx: client, pre: '', n: 1 },
    ...roundsOf(client).filter((r) => !isMonthlyRound(r)).map((r) => ({ ctx: roundContext(client, r), pre: `r${r.n}.`, n: Number(r.n) }))];
}

// Who edits now: the editors of the latest shoot (or monthly round) that has one, "נדיה + יריב";
// '' when nobody was assigned yet.
export function editorText(client) {
  const all = [client, ...roundsOf(client).map((r) => roundContext(client, r))];
  const last = [...all].reverse().find((x) => editorsOf(x).length);
  return last ? editorsOf(last).map((e) => PEOPLE[e]?.name || e).join(' + ') : '';
}

// One shoot's part of the package: the two editors' split when there is one, else the package's
// videos over its shoot days (as the editor's card says).
function shootPart(ctx) {
  const eds = editorsOf(ctx);
  const s = eds.length === 2 ? shareOf(ctx, eds[0]) : null;
  return s ? s.total : videosPerDay(ctx);
}

// { done, of, month } — `of` null when the package has no number; `month` true for a monthly client.
//   progress: rows of public.editor_progress { client_id, editor, round, edited } (null: not readable);
//   months: rows of public.editor_progress_month of this month (null: not readable).
export function videosOf(client, checks = {}, progress = [], months = [], now = new Date()) {
  if (isMonthly(client)) {
    const key = monthKey(now);
    const of = monthTargetOf(client, key);
    let done = (months || []).filter((r) => r.client_id === client.id && r.month === key).reduce((t, r) => t + (Number(r.edited) || 0), 0);
    const round = roundsOf(client).find((r) => isMonthlyRound(r) && r.month === key);
    if (round && isDone(checks, `r${round.n}.p24.drive`) && of) done = Math.max(done, of);
    return { done, of, month: true };
  }
  const of = whole(client?.deliverables?.videos);
  let typed = 0;
  let finished = 0;
  for (const { ctx, pre, n } of shootsOf(client)) {
    const eds = editorsOf(ctx);
    const count = (progress || []).filter((r) => r.client_id === client.id && (Number(r.round) || 1) === n && eds.includes(r.editor))
      .reduce((t, r) => t + (Number(r.edited) || 0), 0);
    typed += count;
    finished += isDone(checks, `${pre}p24.drive`) ? Math.max(count, shootPart(ctx) || 0) : count;
  }
  // What the editors typed always shows as it is; the finished shoots never add more than the package.
  const done = of ? Math.max(typed, Math.min(of, finished)) : finished;
  return { done, of, month: false };
}

// The graphics are made once per package (7 and 23 are not shoot-round processes).
export const FIRST_GRAPHICS = 9;
// { done, of }. posted: how many of the client's Gantt graphic rows are "עלה".
export function graphicsOf(client, checks = {}, posted = 0) {
  const of = whole(client?.deliverables?.graphics);
  let marks = 0;
  if (isDone(checks, 'p23b.posted')) marks = of ?? FIRST_GRAPHICS;
  else if (isDone(checks, 'p07b.posted')) marks = of ? Math.min(FIRST_GRAPHICS, of) : FIRST_GRAPHICS;
  const gantt = Number(posted) || 0;
  return { done: Math.max(marks, of ? Math.min(gantt, of) : gantt), of };
}

// { done, of, last, next } — last: the latest shoot day that took place (a Date, or null);
// next: the nearest one set from today on (or null).
export function shootDaysOf(client, checks = {}, now = new Date()) {
  const h = shootHistory(client, checks, now);
  return { done: h.held, of: h.agreed || null, last: h.last, next: h.next };
}

// Whether a count is complete: a known number, reached.
export const complete = (x) => !!x?.of && x.done >= x.of;
// "7 / 25", or the bare count when the package has no number ("—" when there is nothing at all).
export const ratioText = (x) => (x?.of ? `${x.done} / ${x.of}` : x?.done ? String(x.done) : '—');
// "10.10", an Israel day.
export const dayMonth = (d) => { const p = partsIL(d); return `${p.day}.${p.month}`; };
// The shoot days' dates: ["אחרון: 10.10", "הבא: 20.11"]; "הבא: טרם נקבע" only while days remain.
export function shootDates(s) {
  const out = [];
  if (s.last) out.push(`אחרון: ${dayMonth(s.last)}`);
  if (s.next) out.push(`הבא: ${dayMonth(s.next)}`);
  else if (s.of && s.done < s.of) out.push('הבא: טרם נקבע');
  return out;
}

// One row per client in work, by the client's name.
//   data: { checks: { clientId: { itemKey: row } }, progress, months, posted: { clientId: n } }
export function trackingRows(clients, { checks = {}, progress = [], months = [], posted = {} } = {}, now = new Date()) {
  return (clients || []).filter(inWork).map((c) => {
    const cs = checks[c.id] || {};
    return {
      id: c.id,
      label: clientLabel(c),
      editor: editorText(c),
      videos: videosOf(c, cs, progress, months, now),
      graphics: graphicsOf(c, cs, posted[c.id] || 0),
      shoots: shootDaysOf(c, cs, now),
    };
  }).sort((a, b) => a.label.localeCompare(b.label, 'he'));
}

// The search: the client's name (the business or the contact), any part of it, ignoring spaces
// at the ends and the case of Latin letters.
const plain = (s) => String(s || '').toLocaleLowerCase('he').replace(/\s+/g, ' ').trim();
export const searchTracking = (rows, q) => { const t = plain(q); return t ? rows.filter((r) => plain(r.label).includes(t)) : rows; };
// "12 לקוחות" / "לקוח אחד".
export const clientsWord = (n) => (n === 1 ? 'לקוח אחד' : `${n} לקוחות`);
