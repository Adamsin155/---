// Ilai's one line about Metricool in "המשימות שלי" (the owner, 20.10.2026): "N פרסומים
// נכשלו · N לקוחות בלי שום דבר מתוזמן לשבוע הבא", to the Gantt index (gantt.html), where
// each is worked. Only the clients connected to a brand (clients.metricool_blog_id) and
// in work count: a client with no brand is the Gantt page's own list of the unconnected.
//   failed        posts of the Gantt in state 'error' (the publishing failed), from
//                 FAILED_DAYS back until the end of next week;
//   nothing ahead connected clients with no post scheduled ('scheduled', its time still
//                 ahead) in next week (Israel's week, Sunday to Saturday).
// Pure; app/mine-flow-data.js `loadMetricoolProblems` reads the rows.
import { GANTT_KINDS } from './gantt-template.js';
import { addDays, weekOf, entryStatus } from './gantt-logic.js';
import { dayKeyIL } from './tz.js';

export const FAILED_DAYS = 14;
// The Gantt index opened on each problem (its filter chips read these hashes).
export const FAILED_URL = 'gantt.html#failed';
export const NOTHING_AHEAD_URL = 'gantt.html#nothing-ahead';
export const NOT_CONNECTED_URL = 'gantt.html#not-connected';

const inWork = (c) => c.status === 'active' || c.status === 'ending';
const isPost = (r) => !!GANTT_KINDS[r.kind]?.post && r.state !== 'skipped';
// The days the rows are read for: { from, to, next } (next: next week's { from, to }).
export function problemWindow(now = new Date()) {
  const today = dayKeyIL(now);
  const next = weekOf(addDays(weekOf(today).from, 7));
  return { from: addDays(today, -FAILED_DAYS), to: next.to, next: { from: next.from, to: next.to } };
}

// clients: rows with { id, status, metricool_blog_id }; rows: client_gantt rows of the window.
// { failed, failedClients, nothingAhead, connected } (numbers).
export function metricoolProblems({ clients = [], rows = [], now = new Date() }) {
  const win = problemWindow(now);
  const connected = new Set(clients.filter((c) => inWork(c) && c.metricool_blog_id).map((c) => c.id));
  const mine = rows.filter((r) => connected.has(r.client_id) && isPost(r));
  const failed = mine.filter((r) => r.state === 'error' && r.day >= win.from && r.day <= win.to);
  const ahead = new Set(mine.filter((r) => r.day >= win.next.from && r.day <= win.next.to && entryStatus(r, now) === 'scheduled').map((r) => r.client_id));
  return {
    failed: failed.length,
    failedClients: new Set(failed.map((r) => r.client_id)).size,
    nothingAhead: [...connected].filter((id) => !ahead.has(id)).length,
    connected: connected.size,
    // In work, with no brand and not marked "no brand needed": the Gantt index lists them (#not-connected).
    // Ofir's line since v11 (connecting is his step); Ilai's two lines are the two above.
    notConnected: clients.filter((c) => inWork(c) && !c.metricool_blog_id && !c.metricool_none && !c.archived_at).length,
  };
}

// The line's words, or null when there is nothing to say.
export function problemsText(p) {
  if (!p || (!p.failed && !p.nothingAhead)) return null;
  return [
    p.failed ? (p.failed === 1 ? 'פרסום אחד נכשל' : `${p.failed} פרסומים נכשלו`) : null,
    p.nothingAhead ? (p.nothingAhead === 1 ? 'לקוח אחד בלי שום דבר מתוזמן לשבוע הבא' : `${p.nothingAhead} לקוחות בלי שום דבר מתוזמן לשבוע הבא`) : null,
  ].filter(Boolean).join(' · ');
}

