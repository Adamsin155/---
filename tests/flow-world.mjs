// The office of tests/roles-world.mjs with work waiting in every queue that is done on a
// page other than "המשימות שלי" (docs/ops.md, section 46), and five clients that came from
// the old system and are still in landing. The clock is the same Tuesday, 20.10.2026,
// 10:00 in Israel. Names are invented.
//   - Ofir (qa.html): one round of videos waits for his check and one client waits for an
//     editor, both with a clock; in landing, one more check and three more assignments;
//   - Lior (decisions.html): editing paused since yesterday, a broken login, an open
//     change request from Ofir, an urgent task nobody started, the weekly campaign check;
//   - Irit and Lior (messages.html): the day's messages to the clients; (prep.html) the
//     photographer's free dates for November, not handed in after the 15th;
//   - Eli (shoot.html): the same free dates, his to hand in;
//   - a client in landing with a shoot day next week (prep.html, shoot.html).
import { NOW, SUPA, ROLES, emailOf, buildWorld, makeFake } from './roles-world.mjs';
import { importKeys } from '../app/client-open.js';

export { NOW, SUPA, ROLES, emailOf };
export const cid = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };

// What each queue holds in this world (the suites count against these).
export const COUNTS = {
  assign: { clock: 1, landing: 3 },
  qa: { clock: 1, landing: 1 },
  paused: 1, broken: 1, changes: 1, urgentBack: 1,
};

export function flowWorld({ landing = true, queues = true } = {}) {
  const db = buildWorld();
  const base = db.clients[11]; // "חן קוסמטיקה": a client in editing, every column filled
  const add = (n, station, fields, at = '2026-10-16T09:00:00+03:00') => {
    const c = { ...base, id: cid(n), editor: null, rounds: [], links: {}, landing: false, landed_at: null, landed_by: null, landing_slot: null, ...fields };
    db.clients.push(c);
    for (const k of importKeys(station)) db.protocol_checks.push({ client_id: c.id, item_key: k, state: 'done', note: 'ייבוא', by_email: emailOf('irit'), at });
    return c;
  };
  const mark = (n, key, at, note = null, by = 'nadia') => db.protocol_checks.push({ client_id: cid(n), item_key: key, state: 'done', note, by_email: emailOf(by), at });
  for (const c of db.clients) Object.assign(c, { landing: false, landed_at: null, landed_by: null, landing_slot: null, ...c });
  db.client_landing_marks = [];
  db.client_landing_done = [];
  db.quotes = [];
  db.change_requests = [];
  db.client_access = [];
  db.client_messages = [];
  db.message_templates = [];
  db.office_reviews = [];
  db.photographer_months = [];
  db.photographer_changes = [];

  if (queues) {
    // Ofir: a shoot of last Thursday waits for an editor (22א), with its clock.
    add(23, 'post', { name: 'נטע שלום', business: 'שלום דפוס', char_at: '2026-09-30T10:00:00+03:00', shoot_at: '2026-10-15T10:00:00+03:00', deal_at: '2026-09-27T09:00:00+03:00' });
    // Ofir: Nadia marked "מוכן לבדיקה" twenty minutes ago (25).
    mark(12, 'p24.notify', '2026-10-20T09:40:00+03:00');
    // Lior: Yariv paused an editing yesterday morning and it is still paused.
    mark(14, 'p22.pause', '2026-10-19T09:30:00+03:00', JSON.stringify({ reason: 'משימה דחופה אחרת' }), 'yariv');
    // Lior: a login that does not work.
    db.client_access.push({ id: 'a0000000-0000-4000-8000-000000000001', client_id: cid(17), network: 'instagram', label: null, username: 'wolf.pilates', status: 'broken', note: 'הסיסמה לא עובדת', updated_by: emailOf('ilai'), updated_at: '2026-10-19T14:00:00+03:00' });
    // Lior: Ofir asked for a change.
    db.change_requests.push({ id: 'b0000000-0000-4000-8000-000000000001', client_id: null, problem: 'אין מי שמאשר תסריטים כשליאור ביום צילום', why: 'שני לקוחות חיכו יומיים', proposal: 'אופיר מאשר במקומו באותו יום', created_by_email: emailOf('ofir'), created_at: '2026-10-19T16:00:00+03:00', decision: null, decided_by_email: null, decided_at: null });
    // Lior: an urgent task given to Ilai an hour ago, and no "התחלתי".
    db.client_tasks.push({ id: 'd0000000-0000-4000-8000-000000000021', client_id: cid(18), title: 'להחליף את הגרפיקה שעלתה עם טעות', owner: 'ilai', due_on: null, done_at: null,
      created_at: '2026-10-20T09:00:00+03:00', created_by_email: emailOf('irit'), source: null, urgent: true, started_at: null });
  }
  if (landing) {
    // From the old system, still in landing: three wait for an editor, one for Ofir's check,
    // and one shoots next week.
    const OLD = { landing: true, created_by_email: 'system', char_at: '2026-06-10T10:00:00+03:00', deal_at: '2026-06-01T09:00:00+03:00', contract_end: '2027-06-01' };
    add(31, 'post', { ...OLD, name: 'דנה קורן', business: 'קורן אדריכלות', shoot_at: '2026-06-25T10:00:00+03:00' }, '2026-10-06T09:00:00+03:00');
    add(32, 'post', { ...OLD, name: 'משה חדד', business: 'חדד מאפים', shoot_at: '2026-06-28T10:00:00+03:00' }, '2026-10-06T09:00:00+03:00');
    add(33, 'post', { ...OLD, name: 'יעל פרץ', business: 'פרץ יוגה', shoot_at: '2026-07-02T10:00:00+03:00', shoot_type: 'natali', package_name: 'Social all in one · נטלי דדון' }, '2026-10-06T09:00:00+03:00');
    add(34, 'post', { ...OLD, name: 'אבנר גולן', business: 'גולן מזגנים', editor: 'anna', shoot_at: '2026-07-05T10:00:00+03:00' }, '2026-10-06T09:00:00+03:00');
    for (const k of ['p22a.load', 'p22a.assigned', 'p22a.irit']) mark(34, k, '2026-10-07T09:00:00+03:00', null, 'ofir');
    mark(34, 'p24.notify', '2026-10-12T15:00:00+03:00', null, 'anna');
    add(35, 'content', { ...OLD, name: 'רותי אלון', business: 'אלון צמחים', shoot_at: '2026-10-26T10:00:00+03:00' }, '2026-10-06T09:00:00+03:00');
  }
  return db;
}

// The fake of the roles world, and the few functions it does not answer: the days a shoot
// day sits on (the photographer's free dates), and the landing's taking in.
export function makeFlowFake(db, opts) {
  const fake = makeFake(db, opts);
  const route = async (r) => {
    const req = r.request();
    const p = new URL(req.url()).pathname;
    const json = (data) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data), headers: CORS });
    if (req.method() !== 'OPTIONS' && p === '/rest/v1/rpc/photographer_taken') return json([]);
    return fake.route(r);
  };
  return { ...fake, route };
}
