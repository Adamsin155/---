// The shoot-day table (owner.html#shoots, "טבלת ימי צילום"; the owner's request,
// 6.10.2026): every active client in one row, ordered by its LAST shoot day that took
// place, the oldest first, so the client that was shot longest ago is on top. Clients
// that were never shot come in their own group below, by the deal date, oldest first.
// Read-only: nothing here is marked or saved. Pure, no DOM (tests/shoot-table.test.mjs);
// the page is app/owner.js.
//
// Where a shoot day lives (no table of its own): the first one is clients.shoot_at, and
// every further one is an entry of clients.rounds, { n, shoot_at, … } (a shoot round,
// app/protocol-logic.js roundContext). A shoot day TOOK PLACE when its process 19
// ("סיום יום צילום": p19.*, or r<n>.p19.* for round n) is complete, exactly as the
// contract summary counts "ימי צילום" (app/contract-summary.js). A client brought in
// mid-way from the old CRM carries the same thing: its past shoot dates in shoot_at and
// rounds[].shoot_at, and those p19 items checked with the note "ייבוא" (the import by
// station does it for every station after "יום צילום").
import { PEOPLE, SHOOT_TYPES } from './protocol.js';
import { clientState, parseDate, isImported, inLanding } from './protocol-logic.js';
import { shootContexts } from './health.js';
import { sortRows, filterRows, dayText } from './manager-table.js';
import { dayKeyIL, daysBetweenIL } from './tz.js';

const count = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0);

// The shoot days of one client, from the fields that already hold them.
//   checks: this client's checks by item key; state: clientState(client, checks, now), when the caller has it.
// Returns:
//   done     the dates of the shoot days that took place, oldest first
//   last     the latest of them (null: never shot, or shot with no date on record)
//   next     the nearest shoot day set from today on that is not closed yet (null: none set)
//   agreed   how many shoot days the contract grants (deliverables.shoot_days + photo_days)
//   held     how many took place: the closed ones (also without a date), or the card's
//            counter "נמסרו" when it is higher (deliverables.done.shoot_days), as the contract summary
//   unclosed dates that passed while their shoot day was never closed (process 19 open)
export function shootHistory(client, checks = {}, now = new Date(), state = null) {
  const st = state || clientState(client, checks, now);
  const byId = new Map(st.states.map((s) => [s.proc.id, s]));
  const today = dayKeyIL(now);
  const done = [];
  const unclosed = [];
  let undated = 0;
  let next = null;
  for (const x of shootContexts(client)) {
    const at = parseDate(x.ctx.shoot_at);
    const p19 = byId.get(`${x.pid}p19`);
    if (p19?.complete) {
      // Its date is the shoot's own; closed with no date (or a date still ahead), the day
      // it was closed on, unless the closing itself is imported history (no real moment).
      const when = at && dayKeyIL(at) <= today ? at : isImported(p19.proc, checks) ? null : p19.completedAt || null;
      if (when) done.push(when); else undated += 1;
    } else if (at && dayKeyIL(at) >= today) {
      if (!next || at < next) next = at;
    } else if (at && !inLanding(client)) unclosed.push(at); // in landing a past shoot day is not "not closed"
  }
  done.sort((a, b) => a - b);
  unclosed.sort((a, b) => a - b);
  const d = client?.deliverables || {};
  return {
    done, last: done.at(-1) || null, next, unclosed,
    agreed: count(d.shoot_days) + count(d.photo_days),
    held: Math.max(done.length + undated, count(d.done?.shoot_days)),
  };
}

// "לפני 12 ימים" / "בעוד 3 ימים", in Israel days.
export function agoText(n) {
  return n <= 0 ? 'היום' : n === 1 ? 'אתמול' : n === 2 ? 'לפני יומיים' : `לפני ${n} ימים`;
}
export function aheadText(n) {
  return n <= 0 ? 'היום' : n === 1 ? 'מחר' : n === 2 ? 'בעוד יומיים' : `בעוד ${n} ימים`;
}

// One row per client.
//   entry: { client, state, station (or null) }, as app/owner.js builds them; checks: by client id.
export function shootRow(entry, { checks = {}, now = new Date() } = {}) {
  const c = entry.client;
  const hist = shootHistory(c, checks[c.id] || {}, now, entry.state);
  const st = entry.station;
  return {
    id: c.id,
    name: c.business || c.name || '',
    contact: c.business && c.name && c.name !== c.business ? c.name : '',
    shootType: c.shoot_type ? SHOOT_TYPES[c.shoot_type]?.name || '' : '',
    package: c.package_name || '',
    status: c.status,
    group: hist.held > 0 ? 'shot' : 'never',
    last: hist.last,
    lastDays: hist.last ? Math.max(0, daysBetweenIL(hist.last, now)) : null,
    held: hist.held,
    agreed: hist.agreed,
    next: hist.next,
    nextDays: hist.next ? Math.max(0, daysBetweenIL(now, hist.next)) : null,
    unclosed: hist.unclosed.at(-1) || null,
    dealAt: parseDate(c.deal_at),
    stationIndex: st ? st.index : null,
    station: st ? st.title : '',
    editorName: c.editor ? PEOPLE[c.editor]?.name || c.editor : c.editor_name || '',
  };
}

// "2 מתוך 3", or the bare count when the contract's number was not entered.
export const heldText = (r) => (r.agreed ? `${r.held} מתוך ${r.agreed}` : r.held ? String(r.held) : '');

// The columns, in order; `sort` is the value a click on the header sorts by.
export const SHOOT_COLUMNS = [
  { key: 'name', label: 'לקוח', sort: (r) => r.name },
  { key: 'type', label: 'משפיענים', sort: (r) => r.shootType || r.package },
  { key: 'last', label: 'יום צילום אחרון', sort: (r) => (r.last ? +r.last : null) },
  { key: 'held', label: 'בוצעו', num: true, sort: (r) => r.held },
  { key: 'next', label: 'יום הצילום הבא', sort: (r) => (r.next ? +r.next : null) },
  { key: 'station', label: 'תחנה', sort: (r) => r.stationIndex },
  { key: 'editor', label: 'עורך', sort: (r) => r.editorName },
];
export const DEFAULT_SORT = { key: 'last', dir: 'asc' };
export const NEVER_TITLE = 'טרם צולמו';

// The search: the business, the contact (and the editor, the station, the package).
export const searchRows = (rows, q) => filterRows(rows, { station: '', color: '', editor: '', status: 'all', q });

// What the table shows, in order: [{ key, title, rows }].
// By the last shoot day (the default): the clients that were shot, the oldest shoot
// first (a client shot with no date on record after the dated ones), and then
// "טרם צולמו", always by the deal date, oldest first. By any other column: one list.
export function shootGroups(rows, key = DEFAULT_SORT.key, dir = DEFAULT_SORT.dir) {
  if (key !== 'last') return [{ key: 'all', title: '', rows: sortRows(rows, key, dir, SHOOT_COLUMNS) }];
  const never = rows.filter((r) => r.group === 'never')
    .sort((a, b) => (a.dealAt ? +a.dealAt : Infinity) - (b.dealAt ? +b.dealAt : Infinity) || a.name.localeCompare(b.name, 'he'));
  return [
    { key: 'shot', title: '', rows: sortRows(rows.filter((r) => r.group === 'shot'), 'last', dir, SHOOT_COLUMNS) },
    { key: 'never', title: NEVER_TITLE, rows: never },
  ].filter((g) => g.rows.length);
}

// "12 לקוחות · 9 צולמו · 3 טרם צולמו"
export function countText(rows) {
  const never = rows.filter((r) => r.group === 'never').length;
  return `${rows.length === 1 ? 'לקוח אחד' : `${rows.length} לקוחות`} · ${rows.length - never} צולמו · ${never} טרם צולמו`;
}

export { dayText };
