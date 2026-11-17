// "מעקב לקוחות" (tracking.html; the owner's request of 9.11.2026, for Irit): one row per client in
// work, with who edits it and three counts against the package: the videos edited, the graphics
// up on the networks and the shoot days that took place. Pure, no DOM (tests/tracking.test.mjs);
// the page is app/tracking.js. Read-only: nothing here is marked or saved, and no money is read.
//
// Where each number comes from (docs/ops.md, sections 122 and 140):
//   videos     the same number as "נערכו" on the client's card (app/client-card.js; the owner,
//              17.11.2026: "צריך שזה יהיה מסונכן עם התיק לקוח"): the larger of
//                - the editors' own counter, "נערכו 7/25" (public.editor_progress, per client, shoot
//                  round and editor; app/edit-count.js), summed over the client's shoots, and
//                - the edited videos that came into the client's Drive folder since the deal day
//                  (public.drive_daily, kind 'video': the drive-scan function's count; footage is
//                  'raw' and does not count), never above the package.
//              Out of: deliverables.videos. A monthly client (deliverables.videos_month) is shown for
//              this Israel month: public.editor_progress_month and this month's Drive videos, out of
//              the month's number ("החודש"). Until 17.11.2026 a shoot whose "כל הסרטונים הועלו
//              לדרייב" (p24.drive) was marked counted its whole part: 49 of 105 clients showed more
//              than the Drive held. The mark no longer counts; it is taken only once the Drive has
//              the videos (app/drive-guard-logic.js).
//              A number fixed by hand (app/tracking-fix-logic.js) stands on both screens alike
//              (sharedVideos).
//   graphics   the protocol's own marks: "9 הגרפיקות שאושרו הועלו לרשתות" (7ב, p07b.posted) is 9,
//              "יתרת הגרפיקות שאושרו הועלו לרשתות או תוזמנו" (23ב, p23b.posted) is all of them; or the
//              content Gantt's graphic rows marked "עלה" (posted), or the graphics in the client's
//              Drive since the deal day (public.drive_daily, kind 'graphic', the highlight covers
//              left out), whichever is more. Out of: deliverables.graphics. (The Gantt alone would
//              say 0 for everyone: on 9.11.2026 no graphic row of it was "עלה", while 81 clients
//              had 7ב and 30 had 23ב.)
//   shoot days the shoot-day table's own count (app/shoot-table.js shootHistory): a shoot day took
//              place once its date is behind today, or a mark says so. Out of: deliverables.shoot_days
//              + photo_days. With the last one that took place and the next one set.
import { PEOPLE, editorsOf, shareOf } from './protocol.js';
import { roundsOf, roundContext, clientLabel } from './protocol-logic.js';
import { isMonthly, monthKey, monthTargetOf, editTarget } from './edit-count.js';
import { shootHistory } from './shoot-table.js';
import { partsIL } from './tz.js';
import { fixOf, applyCount, applyShootCount } from './tracking-fix-logic.js';
import { shootsOf, shootPart, dealDayOf } from './package-parts.js';

export { shootsOf, shootPart, dealDayOf };

// The clients in work: active, or in their last month ("ending"); also those still in landing
// (a client in landing is a client for every list; docs/ops.md, section 41). Not the ended ones.
export const inWork = (c) => c?.status === 'active' || c?.status === 'ending';

const whole = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const isDone = (checks, key) => checks?.[key]?.state === 'done';

// Who edits now: the editors of the latest shoot (or monthly round) that has one, "נדיה + יריב";
// '' when nobody was assigned yet.
export function editorText(client) {
  const all = [client, ...roundsOf(client).map((r) => roundContext(client, r))];
  const last = [...all].reverse().find((x) => editorsOf(x).length);
  return last ? editorsOf(last).map((e) => PEOPLE[e]?.name || e).join(' + ') : '';
}

// How many files of a kind ('video', 'graphic') came into the client's Drive from the deal day on;
// `month` ('YYYY-MM'): only that Israel month. drive: rows of public.drive_daily { client_id, day,
// folder, kind, files } (null: not readable, which counts as nothing). The highlight covers (their
// folder says "היילייט") are Ofir's work, not the package's graphics (as app/gfx-auto-logic.js).
const HIGHLIGHTS = /היילייט/u;
export function driveCountOf(client, drive, kind, { month = null } = {}) {
  const from = dealDayOf(client);
  let n = 0;
  for (const r of drive || []) {
    if (r?.client_id !== client?.id || r.kind !== kind) continue;
    if (kind === 'graphic' && HIGHLIGHTS.test(String(r.folder || ''))) continue;
    const d = String(r.day || '').slice(0, 10);
    if ((from && d < from) || (month && d.slice(0, 7) !== month)) continue;
    n += Number(r.files) || 0;
  }
  return n;
}

const capped = (n, of) => (of ? Math.min(n, of) : n);

// { done, of, month, typed, drive } — `of` null when the package has no number; `month` true for a
// monthly client; `typed`: what the editors typed; `drive`: the edited videos in the Drive.
//   progress: rows of public.editor_progress { client_id, editor, round, edited } (null: not readable);
//   months: rows of public.editor_progress_month of this month (null: not readable);
//   drive: rows of public.drive_daily (null: not readable).
export function videosOf(client, { progress = [], months = [], drive = [] } = {}, now = new Date()) {
  if (isMonthly(client)) {
    const key = monthKey(now);
    const of = monthTargetOf(client, key);
    const typed = (months || []).filter((r) => r.client_id === client.id && r.month === key).reduce((t, r) => t + (Number(r.edited) || 0), 0);
    const inDrive = driveCountOf(client, drive, 'video', { month: key });
    return { done: Math.max(typed, capped(inDrive, of)), of, month: true, typed, drive: inDrive };
  }
  const of = whole(client?.deliverables?.videos);
  let typed = 0;
  for (const { ctx, n } of shootsOf(client)) {
    const eds = editorsOf(ctx);
    typed += (progress || []).filter((r) => r.client_id === client.id && (Number(r.round) || 1) === n && eds.includes(r.editor))
      .reduce((t, r) => t + (Number(r.edited) || 0), 0);
  }
  // What the editors typed always shows as it is; the Drive never adds more than the package.
  const inDrive = driveCountOf(client, drive, 'video');
  return { done: Math.max(typed, capped(inDrive, of)), of, month: false, typed, drive: inDrive };
}

// The one videos number of the tracking row and of the client card's "נערכו": the count, with a
// number fixed by hand on it (app/tracking-fix-logic.js applyCount: `fix` says who and when).
export function sharedVideos(client, data = {}, now = new Date()) {
  return applyCount(videosOf(client, data, now), fixOf(client, 'videos'), { month: isMonthly(client) ? monthKey(now) : null });
}

// The graphics are made once per package (7 and 23 are not shoot-round processes).
export const FIRST_GRAPHICS = 9;
// { done, of }. posted: how many of the client's Gantt graphic rows are "עלה"; drive: rows of
// public.drive_daily (the client's graphics in the Drive since the deal day).
export function graphicsOf(client, checks = {}, posted = 0, drive = []) {
  const of = whole(client?.deliverables?.graphics);
  let marks = 0;
  if (isDone(checks, 'p23b.posted')) marks = of ?? FIRST_GRAPHICS;
  else if (isDone(checks, 'p07b.posted')) marks = of ? Math.min(FIRST_GRAPHICS, of) : FIRST_GRAPHICS;
  const gantt = Number(posted) || 0;
  return { done: Math.max(marks, capped(gantt, of), capped(driveCountOf(client, drive, 'graphic'), of)), of };
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
//   data: { checks: { clientId: { itemKey: row } }, progress, months, posted: { clientId: n }, drive }
export function trackingRows(clients, { checks = {}, progress = [], months = [], posted = {}, drive = [] } = {}, now = new Date()) {
  return (clients || []).filter(inWork).map((c) => {
    const cs = checks[c.id] || {};
    // A number fixed by hand stands in place of the count (app/tracking-fix-logic.js).
    return {
      id: c.id,
      label: clientLabel(c),
      editor: editorText(c),
      videos: sharedVideos(c, { progress, months, drive }, now),
      graphics: applyCount(graphicsOf(c, cs, posted[c.id] || 0, drive), fixOf(c, 'graphics')),
      shoots: applyShootCount(shootDaysOf(c, cs, now), fixOf(c, 'shoots')),
      editors: editorsOfClient(c),
    };
  }).sort((a, b) => a.label.localeCompare(b.label, 'he'));
}

// The search: the client's name (the business or the contact), any part of it, ignoring spaces
// at the ends and the case of Latin letters.
const plain = (s) => String(s || '').toLocaleLowerCase('he').replace(/\s+/g, ' ').trim();
export const searchTracking = (rows, q) => { const t = plain(q); return t ? rows.filter((r) => plain(r.label).includes(t)) : rows; };
// "12 לקוחות" / "לקוח אחד".
export const clientsWord = (n) => (n === 1 ? 'לקוח אחד' : `${n} לקוחות`);

// ── The totals above the table, and the filter by person (the owner, 17.11.2026) ──
// "סרטונים נערכו X מתוך Y" and "גרפיקות הועלו X מתוך Y": the sums of the rows as they are shown (a
// number fixed by hand included; a monthly client: this month's). Counted:
//   videos    a client once its first shoot day took place (the shoot-day column says 1 or more);
//   graphics  every client in work (from the signing: graphics are sometimes made before the shoot).
// A client whose package has no number (`of` null) is left out of both sums, so X never counts
// what Y does not. The filter: "כולם"; an editor (only the clients they edit; the videos are theirs,
// below); "עילאי" (the graphic designer: every client, the graphics only).
export const DESIGNER = 'ilai';

// Everyone who edits the client: its own shoot's editors and every round's.
export function editorsOfClient(client) {
  const all = [client, ...roundsOf(client).map((r) => roundContext(client, r))];
  return [...new Set(all.flatMap((x) => editorsOf(x)))];
}

// The choices of the filter: { key, label } — '' is "כולם", then the editors of the clients in
// work by name, then Ilai.
export function personChoices(clients) {
  const eds = [...new Set((clients || []).filter(inWork).flatMap(editorsOfClient))]
    .sort((a, b) => (PEOPLE[a]?.name || a).localeCompare(PEOPLE[b]?.name || b, 'he'));
  return [{ key: '', label: 'כולם' }, ...eds.map((e) => ({ key: e, label: PEOPLE[e]?.name || e })), { key: DESIGNER, label: `${PEOPLE[DESIGNER]?.name || 'עילאי'} (גרפיקה)` }];
}
// The rows the table shows for a person ('' / Ilai: all of them).
export const rowsForPerson = (rows, person) => (!person || person === DESIGNER ? rows : rows.filter((r) => (r.editors || []).includes(person)));

// One editor's own videos of a client: { done, of }. The only editor of the client: the row's own
// number (the Drive and a fix by hand with it). With another editor (a second editor, or another
// round's): what this editor typed, against their part (the split, else the shoot's part); the
// Drive is not split between them.
export function editorVideos(client, person, row, { progress = [], months = [] } = {}, now = new Date()) {
  const eds = editorsOfClient(client);
  if (!eds.includes(person)) return { done: 0, of: 0 };
  if (eds.length === 1) return { done: row.done, of: row.of };
  if (isMonthly(client)) {
    const key = monthKey(now);
    const done = (months || []).filter((r) => r.client_id === client.id && r.month === key && r.editor === person).reduce((t, r) => t + (Number(r.edited) || 0), 0);
    return { done, of: shareOf(client, person)?.mine ?? monthTargetOf(client, key) };
  }
  let done = 0;
  let of = 0;
  for (const { ctx, n } of shootsOf(client)) {
    if (!editorsOf(ctx).includes(person)) continue;
    done += (progress || []).filter((r) => r.client_id === client.id && (Number(r.round) || 1) === n && r.editor === person).reduce((t, r) => t + (Number(r.edited) || 0), 0);
    of += editTarget(ctx, person) || 0;
  }
  return { done, of: of || null };
}

// The totals: { videos: { done, of, clients } | null, graphics: … | null } — null for a total the
// filter does not show (an editor: the videos only; Ilai: the graphics only).
//   rows: trackingRows(...); clients: the same clients; data: the same data.
export function trackingTotals(rows, clients, data = {}, person = '', now = new Date()) {
  const byId = new Map((clients || []).map((c) => [c.id, c]));
  const sum = () => ({ done: 0, of: 0, clients: 0 });
  const add = (t, x) => { if (!x?.of) return; t.done += Number(x.done) || 0; t.of += x.of; t.clients += 1; };
  const videos = person === DESIGNER ? null : sum();
  const graphics = person && person !== DESIGNER ? null : sum();
  for (const r of rowsForPerson(rows, person)) {
    if (videos && (r.shoots?.done || 0) >= 1) {
      const c = byId.get(r.id);
      add(videos, person && c ? editorVideos(c, person, r.videos, data, now) : r.videos);
    }
    if (graphics) add(graphics, r.graphics);
  }
  return { videos, graphics };
}
// "31 מתוך 48".
export const totalText = (t) => `${t.done} מתוך ${t.of}`;
