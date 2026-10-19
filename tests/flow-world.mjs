// The office of tests/roles-world.mjs with work waiting in every queue that is done on a
// page other than "המשימות שלי" (docs/ops.md, section 46), and six clients that came from
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
import { PROCESSES } from '../app/protocol.js';
import { returnNote } from '../app/office-marks.js';

export { NOW, SUPA, ROLES, emailOf };
export const cid = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };

// What each queue holds in this world (the suites count against these).
export const COUNTS = {
  assign: { clock: 4, landing: 3 },   // with a clock: the new one, and three of the roles world that were never assigned
  qa: { clock: 1, landing: 1 },
  paused: 1, broken: 1, changes: 1, urgentBack: 1,
  messages: { clock: 22, landing: 6 }, // every open client: nobody was written to today
  landing: 6,                          // clients from the old system
  editing: { landing: 1 },             // Yariv's, in the middle of the editing
  shootSoon: { landing: 1 },           // shoots next week
  // The daily follow-up before the shoot day (14, protocol v8): the characterization is
  // behind them and the shoot day is not (three of them have no date yet). A client in
  // landing is not asked about, nor one that was imported past "תוכן ואישור" (its follow-up is history).
  followup: 5,
};
export const FOLLOWUP_CLIENTS = [4, 5, 7, 8, 9];
export { flowWorld } from '../app/demo/world.js';

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
