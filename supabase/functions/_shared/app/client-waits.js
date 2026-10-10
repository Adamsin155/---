// generated — edit app/ instead. Source: app/client-waits.js. Regenerate: node scripts/sync-functions.mjs
// An approval that still waits on the client (protocol v10; docs/ops.md, section 58).
// Work was sent to the client for approval (the first 9 graphics: 7; the rest of the
// graphics: 23; the videos: 26, approved in 27) and the client neither approved nor
// asked for a fix. The "client did not answer" clock (app/clocks.js) rings Irit once,
// minutes after the sending; from the next day on she is reminded every working morning
// (the rules `clientWaitsLine` and `clientWaits` in app/reminder-rules.js) until the
// client answers. It is her reminder and nobody's lateness (docs/ops.md, section 48: work
// that waits on the client is not counted for anybody in the owners' table).
// One answer for those rules, for the owners' end-of-day table (how many wait, and the
// longest wait) and for the tests. Pure: no DOM, no network, Israel time.
//
// Waiting, since the last sending, until one of:
//   - the client approved (the approval's mark; the status page writes the same key);
//   - the client asked for a fix: on the status page, or recorded by the office ("הלקוח
//     ביקש תיקון", the same task), or, for the videos, notes the office wrote down
//     (p27.notes). Sent again after the fix: a new wait, from the new sending;
//   - the process was marked "ממתין ללקוח" after the sending (that mark has its own
//     date to check again).
// "הלקוח ענה" and "התקשרתי" stop the one ring of the minutes, not this: the approval is
// still missing. Not for a client in landing, and imported history is not a sending.
import { ANSWER_CLOCKS, fixAnswered } from './clocks.js';
import { clientLabel, inLanding, IMPORT_NOTE, waitOf } from './protocol-logic.js';
import { daysBetweenIL } from './tz.js';

// Whose reminder it is, and when: each a one-line change.
export const CLIENT_WAITS = {
  who: 'irit',
  lineAt: '08:30',  // a line in her morning digest, every working day
  ringAt: '10:00',  // one ring a day, with every client that still waits
  listMax: 6,       // clients named in the grouped ring; the rest is "ועוד N"
};

const baseId = (id) => String(id).replace(/^r\d+-/, '');
const live = (c) => c?.status === 'active' || c?.status === 'ending';
const settled = (c) => !!c && (c.state === 'done' || c.state === 'na');

// Every approval that waits on a client at `now`, the longest wait first:
//   [{ cid, client, name, procId (the process of the sending), what, approval (the key
//      that waits), sentAt, days (calendar days since the sending) }]
// `tasks`: public.client_tasks, the open ones and those finished lately (a fix that was
// asked for and already made is still an answer to that sending).
export function waitingApprovals({ clients = [], checksOf = () => ({}), stateOf, tasks = [], now = new Date() }) {
  const out = [];
  for (const c of clients) {
    if (!live(c) || inLanding(c)) continue;
    const checks = checksOf(c) || {};
    for (const s of stateOf(c).states) {
      const spec = ANSWER_CLOCKS[baseId(s.proc.id)];
      if (!spec) continue;
      const kb = s.proc.keyBase || s.proc.id;
      const pre = kb.slice(0, kb.length - baseId(s.proc.id).length);
      const sent = checks[`${kb}.sent`];
      if (!sent || sent.state !== 'done' || !sent.at || sent.note === IMPORT_NOTE) continue;
      const sentAt = new Date(sent.at);
      const approval = `${pre}${spec.approval}`;
      if (settled(checks[approval])) continue;
      const since = (key) => { const x = checks[key]; return !!x && x.state === 'done' && new Date(x.at) >= sentAt; };
      if ((spec.notes && since(`${pre}${spec.notes}`)) || fixAnswered(tasks, c.id, approval, sentAt)) continue;
      const wait = waitOf(s.proc, checks);
      if (wait && new Date(wait.at) >= sentAt) continue;
      out.push({
        cid: c.id, client: c, name: clientLabel(c), procId: s.proc.id, what: `${spec.what}${pre ? ` (סבב ${pre.slice(1, -1)})` : ''}`,
        approval, sentAt, days: Math.max(0, daysBetweenIL(sentAt, now)),
      });
    }
  }
  return out.sort((a, b) => a.sentAt - b.sentAt);
}

// "מחכה יום", "מחכה יומיים", "מחכה 5 ימים".
export const waitDays = (n) => (n <= 1 ? 'יום' : n === 2 ? 'יומיים' : `${n} ימים`);
// The one line said about a waiting approval: "הלקוח עוד לא אישר: <מה> · <לקוח> · מחכה N ימים".
export const waitLine = (x) => `הלקוח עוד לא אישר: ${x.what} · ${x.name} · מחכה ${waitDays(x.days)}`;
