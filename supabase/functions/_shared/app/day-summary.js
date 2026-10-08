// generated — edit app/ instead. Source: app/day-summary.js. Regenerate: node scripts/sync-functions.mjs
// The owners' end-of-day table (the owner's request of 8.10.2026; docs/ops.md, section
// 48): every working day at 19:00, how many items are late and what was not done, per
// employee. One computation for the page (owner.html#eod, owners only), for the push
// that announces it (planDigests in app/reminder-engine.js) and, later, for a WhatsApp
// text (waText; nothing is sent on WhatsApp now). Pure: no DOM, no network, Israel
// time. No money in it, and no client in landing (app/late-chain.js leaves them out).
import { lateItems, chainOf, lateWords } from './late-chain.js';
import { PEOPLE } from './protocol.js';
import { clientLabel, inLanding, pauseOf, endOfBusinessDay } from './protocol-logic.js';
import { dayKeyIL, dayFromKeyIL, endOfDayIL } from './tz.js';

// The numbers: each is a one-line change.
export const EOD = {
  at: '19:00',      // the end of the sending window (Sunday–Thursday)
  erevAt: '13:00',  // on erev chag the window ends here
  url: 'owner.html#eod',
  pushPeople: 6,    // people named in the push; the rest is "ועוד N"
};
const nameOf = (p) => PEOPLE[p]?.name || p;
const count = (n, one, many) => (n === 1 ? one : `${n} ${many}`);

// → { day, rows: [{ person, name, late, today, longestAt, longest }], totals: { late,
//     today, people, longestAt, longest }, items: [{ kind: 'late' | 'today', cid, name,
//     what, who: [person], dueAt, how, procId, taskId }], waiting: [{ cid, name, what }],
//     empty }
// `late`: what is past its deadline now and held by someone in the office. `today`:
// what was due today and is still open (a deadline at the end of the day, a task for
// today). An item two people hold counts for each of them and once in the totals.
// `waiting`: late on paper, but it is the client's turn; counted for nobody.
export function daySummary({ clients = [], checksOf = () => ({}), stateOf, tasks = [], personOf = () => null, now = new Date() }) {
  const live = clients.filter((c) => !inLanding(c) && (c.status === 'active' || c.status === 'ending'));
  const all = lateItems({ clients: live, checksOf, stateOf, tasks, personOf, now });
  const items = [];
  const waiting = [];
  for (const x of all) {
    if (x.clientTurn) { waiting.push({ cid: x.cid, name: x.name, what: x.what }); continue; }
    if (!x.holders.length) continue; // it waits for work that is itself late, and counted there
    // Due at the close of this very day (18:00) and still open: "of today, not done", as
    // it was while the end of a business day was midnight. It is late from tomorrow on.
    if (x.kind === 'proc' && dayKeyIL(x.dueAt) === dayKeyIL(now) && x.dueAt.getTime() === endOfBusinessDay(x.dueAt).getTime()) {
      items.push({ kind: 'today', cid: x.cid, name: x.name, what: x.what, who: x.holders, dueAt: x.dueAt, how: 'היעד היום', procId: x.procId, taskId: null });
      continue;
    }
    items.push({ kind: 'late', cid: x.cid, name: x.name, what: x.what, who: x.holders, dueAt: x.dueAt, how: lateWords(x.dueAt, now), procId: x.procId, taskId: x.task?.id || null });
  }
  const todayKey = dayKeyIL(now);
  for (const c of live) {
    const checks = checksOf(c);
    const st = stateOf(c).states;
    for (const s of st) {
      if (s.status !== 'today' || s.proc.recurring || pauseOf(s.proc, checks)) continue;
      const chain = chainOf(s, c, checks, st, tasks, now);
      if (chain.clientTurn || !chain.holders.length) continue;
      items.push({ kind: 'today', cid: c.id, name: clientLabel(c), what: `${s.proc.num} · ${s.proc.title}`, who: chain.holders, dueAt: s.dueAt, how: 'היעד היום', procId: s.proc.id, taskId: null });
    }
  }
  const liveIds = new Set(live.map((c) => c.id));
  const labels = new Map(live.map((c) => [c.id, clientLabel(c)]));
  for (const t of tasks) {
    if (t.done_at || t.due_on !== todayKey || !liveIds.has(t.client_id) || !t.owner || t.owner === 'editor') continue;
    items.push({ kind: 'today', cid: t.client_id, name: labels.get(t.client_id), what: t.title, who: [t.owner], dueAt: endOfDayIL(dayFromKeyIL(t.due_on)), how: 'היעד היום', procId: null, taskId: t.id });
  }
  // Worst first: what is late (the longest first), then what was for today.
  items.sort((a, b) => (a.kind === b.kind ? a.dueAt - b.dueAt : a.kind === 'late' ? -1 : 1));
  const by = new Map();
  for (const x of items) {
    for (const p of x.who) {
      if (!by.has(p)) by.set(p, { person: p, name: nameOf(p), late: 0, today: 0, longestAt: null, longest: '' });
      const r = by.get(p);
      r[x.kind] += 1;
      if (x.kind === 'late' && (!r.longestAt || x.dueAt < r.longestAt)) { r.longestAt = x.dueAt; r.longest = x.how; }
    }
  }
  const rows = [...by.values()].sort((a, b) => b.late - a.late || (a.longestAt || Infinity) - (b.longestAt || Infinity) || b.today - a.today || a.name.localeCompare(b.name, 'he'));
  const late = items.filter((x) => x.kind === 'late');
  const first = late[0] || null;
  const totals = {
    late: late.length, today: items.length - late.length, people: rows.filter((r) => r.late).length,
    longestAt: first?.dueAt || null, longest: first?.how || '',
  };
  return { day: todayKey, rows, totals, items, waiting, empty: !items.length };
}

// "היום: 6 באיחור אצל 3 עובדים, 4 לא בוצעו": the push says the numbers by itself.
export const EMPTY_DAY = 'היום הכול נסגר בזמן: אין איחורים ולא נשאר דבר פתוח מהיום. יום טוב לצוות.';
export function headline(sum) {
  if (sum.empty) return EMPTY_DAY;
  const { late, today, people } = sum.totals;
  const lateText = late ? `${late} באיחור אצל ${count(people, 'עובד אחד', 'עובדים')}` : 'אין איחורים';
  const todayText = today ? (today === 1 ? 'אחד מהיום לא בוצע' : `${today} מהיום לא בוצעו`) : 'כל מה שהיה להיום בוצע';
  return `היום: ${lateText}, ${todayText}`;
}
const rowText = (r) => `${r.name}: ${[r.late ? `${r.late} באיחור (הארוך: ${r.longest})` : null, r.today ? (r.today === 1 ? 'אחד מהיום לא בוצע' : `${r.today} מהיום לא בוצעו`) : null].filter(Boolean).join(', ')}`;
// The lines of the push under its title: the headline, then a line per employee.
export function pushLines(sum, max = EOD.pushPeople) {
  if (sum.empty) return [EMPTY_DAY];
  const rest = sum.rows.length - max;
  return [headline(sum), ...sum.rows.slice(0, max).map(rowText), ...(rest > 0 ? [`ועוד ${count(rest, 'עובד אחד', 'עובדים')} בטבלה`] : [])];
}
// The same day as one WhatsApp text, for when the channel is connected (not sent now).
export function waText(sum, { link = '' } = {}) {
  if (sum.empty) return ['סיכום היום', EMPTY_DAY].join('\n');
  return [
    'סיכום היום', headline(sum), '', ...sum.rows.map(rowText),
    ...(sum.items.length ? ['', ...sum.items.slice(0, 10).map((x) => `• ${x.name} · ${x.what} · ${x.who.map(nameOf).join(', ')} · ${x.kind === 'late' ? `באיחור ${x.how}` : 'היעד היום'}`)] : []),
    ...(sum.items.length > 10 ? [`ועוד ${sum.items.length - 10} בטבלה`] : []),
    ...(link ? ['', link] : []),
  ].join('\n');
}
