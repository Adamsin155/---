// The office of tests/flow-world.mjs (Tuesday 20.10.2026, 10:00 in Israel; invented
// names) with what docs/ops.md section 50 needs on top of it:
//   - a client whose characterization ended and whose shoot day has no date yet, so
//     "לפני יום צילום" shows the form with "שמירת המועד" and the approvals, and Irit's
//     card carries "קביעת יום צילום";
//   - work that waits for the client's answer past its deadline (nobody's lateness);
//   - a late task for an editor, and one of a client in landing (not counted).
import { NOW, SUPA, ROLES, emailOf, flowWorld, makeFlowFake, cid, COUNTS } from './flow-world.mjs';
import { PROCESSES } from '../app/protocol.js';

export { NOW, SUPA, ROLES, emailOf, makeFlowFake, cid, COUNTS };
export const NO_DATE = cid(61);   // the shoot day has no date
export const SENT = cid(62);      // the 9 graphics were sent to the client four days ago: the client's turn
const itemsOf = (...ids) => PROCESSES.filter((p) => ids.includes(p.id)).flatMap((p) => p.items.filter((i) => !i.optional).map((i) => i.key));

export function lateWorld(opts) {
  const db = flowWorld(opts);
  const base = db.clients.find((c) => c.id === cid(12));
  const mk = (id, fields) => {
    const c = { ...base, id, editor: null, rounds: [], links: {}, landing: false, landed_at: null, landed_by: null, landing_slot: null, protocol_version: 8,
      shoot_type: 'dms', characterizer: 'ofir', has_logo: true, shoot_at: null, created_by_email: emailOf('irit'), ...fields };
    db.clients.push(c);
    return c;
  };
  const mark = (id, keys, at, note = null, by = 'irit') => { for (const k of [].concat(keys)) db.protocol_checks.push({ client_id: id, item_key: k, state: 'done', note, by_email: emailOf(by), at }); };

  mk(NO_DATE, { name: 'רונית דקל', business: 'מאפיית הדקל', deal_at: '2026-10-19T09:00:00+03:00', char_at: '2026-10-20T08:00:00+03:00' });
  mark(NO_DATE, itemsOf('p01', 'p02', 'p03'), '2026-10-19T09:04:00+03:00');
  mark(NO_DATE, itemsOf('p04', 'p05', 'p05b', 'p06'), '2026-10-20T09:30:00+03:00', null, 'ofir');

  mk(SENT, { name: 'גל אשכנזי', business: 'סטודיו גל', deal_at: '2026-10-08T09:00:00+03:00', char_at: '2026-10-12T10:00:00+03:00', shoot_at: '2026-11-03T10:00:00+02:00' });
  mark(SENT, itemsOf('p01', 'p02', 'p03', 'p11', 'p04', 'p05', 'p05b', 'p06', 'p07a', 'p08', 'p08b', 'p09', 'p10'), '2026-10-12T12:30:00+03:00', null, 'ofir');
  mark(SENT, PROCESSES.find((p) => p.id === 'p07').items.filter((i) => !i.optional && i.key !== 'p07.approved').map((i) => i.key), '2026-10-14T11:00:00+03:00');

  // A plain task that is past its day: Nadia's (an editor), and one of a client still in landing.
  const task = (n, client, owner, title, due) => db.client_tasks.push({ id: `d0000000-0000-4000-8000-0000000000${n}`, client_id: client, title, owner, due_on: due, done_at: null,
    created_at: '2026-10-15T09:00:00+03:00', created_by_email: emailOf('irit'), source: null, urgent: false, started_at: null });
  task(71, cid(12), 'nadia', 'לשלוח ללקוח את קובץ הכתוביות', '2026-10-18');
  if (db.clients.some((c) => c.id === cid(31))) task(72, cid(31), 'irit', 'לברר עם הלקוח את שעות הפעילות', '2026-10-15');
  return db;
}
