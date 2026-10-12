// The office of tests/roles-world.mjs at the size of the live one, for tests/perf-local.mjs
// (docs/ops.md, section 59): the 22 clients of the small world, and more of the same kind
// (spread over the 8 stations, older deals, an editor each) until there are `total`, with
// the tasks, the status page links and today's reminders that such an office has. The
// small world shows no long task of a second; the live office (39 imported clients and
// the new ones) does. Nothing here is lighter than the live office on purpose: every
// added client is active and out of landing, so each one is counted, dated and listed.
import { importKeys } from '../app/client-open.js';
import { buildWorld, emailOf } from './roles-world.mjs';

const id = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NAMES = ['אורי', 'דנה', 'יעל', 'משה', 'רינת', 'אסף', 'גלית', 'נדב', 'שרון', 'עידו', 'מירב', 'תומר', 'ליאורה', 'אבנר', 'הילה', 'זיו', 'ענבל', 'יואב', 'סיון', 'אריאל', 'רותם', 'נעמה', 'איתי', 'מורן', 'עדי', 'ברק', 'שני', 'אלעד', 'טליה', 'רן'];
const TRADES = ['מסעדה', 'מכון כושר', 'מרפאת שיניים', 'חנות פרחים', 'נגרייה', 'סטודיו ליוגה', 'משרד עו״ד', 'גן ילדים', 'מספרה', 'חנות אופנה', 'מאפייה', 'סוכנות רכב', 'קייטרינג', 'אופטיקה', 'וטרינר'];
// Where the added clients stand: most of an office's clients are past the shoot day.
const STATIONS = ['join', 'char', 'content', 'shoot', 'post', 'post', 'publish', 'publish', 'ongoing', 'ongoing', 'ongoing', 'renewal'];
const EDITORS = ['nadia', 'yariv', 'nirel', 'anna'];
const iso = (d) => `${d.toISOString().slice(0, 19)}+00:00`;

export function buildBigWorld(total = Number(process.env.CLIENTS || 45)) {
  const w = buildWorld();
  const base = new Date('2026-10-20T07:00:00Z'); // the clock of the suites (roles-world.mjs NOW)
  const day = (n, hour = 7) => new Date(base.getTime() + n * 864e5 + (hour - 7) * 36e5);
  const active = () => w.clients.filter((c) => c.status === 'active').length;
  for (let i = 0; active() < total; i += 1) {
    const n = 101 + i;
    const station = STATIONS[i % STATIONS.length];
    const s = STATIONS.indexOf(station);
    // The deal is older the further the client stands; the meeting and the shoot day follow it.
    const dealAt = day(-(4 + s * 9 + (i % 5)), 6);
    const past = (k) => ['join', 'char', 'content', 'shoot', 'post', 'publish', 'ongoing', 'renewal'].indexOf(station) > k;
    const c = {
      ...w.clients[3], id: id(n), name: `${NAMES[i % NAMES.length]} ${['כהן', 'לוי', 'מזרחי', 'פרץ', 'ביטון', 'דהן', 'אברהם'][i % 7]}`, business: `${TRADES[i % TRADES.length]} ${NAMES[(i * 7 + 3) % NAMES.length]}`,
      phone: `05${i % 10}-55500${String(n).slice(-2)}`, has_logo: i % 6 !== 0, editor: past(3) ? EDITORS[i % EDITORS.length] : null,
      shoot_type: i % 3 === 0 ? 'natali' : 'dms', package_name: i % 3 === 0 ? 'Social all in one · נטלי דדון' : 'Social + TV all in one · סמיון, מישל ודניס',
      deal_at: iso(dealAt), created_at: iso(dealAt),
      char_at: past(0) ? iso(day(-(1 + s * 8 + (i % 4)), 8)) : null,
      // The shoot day: behind the client from the editing on, and for half of those before it, a few days ahead.
      shoot_at: past(3) ? iso(day(-(2 + (s - 3) * 7 + (i % 6)), 8)) : (station !== 'join' && i % 2 === 0 ? iso(day(2 + (i % 9), 8)) : null),
      contract_end: station === 'renewal' ? '2026-11-20' : '2027-09-01',
    };
    w.clients.push(c);
    const at = iso(day(-(2 + (i % 4))));
    for (const k of importKeys(station)) w.protocol_checks.push({ client_id: c.id, item_key: k, state: 'done', note: 'ייבוא', by_email: emailOf('irit'), at });
    // A third of them hold an open task, some past its day.
    if (i % 3 === 0) {
      const owner = ['irit', 'lior', 'ofir', 'ilai', EDITORS[i % 4]][i % 5];
      w.client_tasks.push({
        id: `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`, client_id: c.id, title: ['לחזור ללקוח על הלוגו', 'לבדוק את הגישה לפייסבוק', 'להחליף כותרת בגרפיקה 4', 'לתאם שיחת עדכון'][i % 4], owner,
        due_on: day(i % 2 ? -1 : 1).toISOString().slice(0, 10), done_at: null, created_at: iso(day(-2)), created_by_email: emailOf('irit'), source: null, urgent: false, started_at: null,
      });
    }
  }
  // Today's reminders, as a late morning has them (the bell): about twenty a person.
  let rid = 1;
  w.reminder_log = [];
  for (const person of ['owner', 'irit', 'lior', 'ofir', 'ilai', 'nadia']) {
    for (let i = 0; i < 22; i += 1) {
      const c = w.clients[(i * 3) % w.clients.length];
      w.reminder_log.push({
        id: rid, key: `perf:${person}:${i}`, rule: 'late', level: i % 4 === 0 ? 'ring' : 'note', channel: 'push', status: 'sent', reason: null, person,
        title: `${i % 2 ? 'באיחור' : 'להיום'}: ${c.business}`, body: `תהליך ${1 + (i % 30)} מחכה לך. היעד היה היום ב־${String(8 + (i % 9)).padStart(2, '0')}:00.`,
        url: `client.html?id=${c.id}`, ref: null, client_id: c.id, created_at: iso(new Date(base.getTime() - (i + 1) * 6 * 60e3)), sent_at: iso(new Date(base.getTime() - (i + 1) * 6 * 60e3)), read_at: i > 7 ? iso(base) : null,
      });
      rid += 1;
    }
  }
  w.protocol_log = w.protocol_checks.slice(-600).map((c, i) => ({ id: i + 1, client_id: c.client_id, item_key: c.item_key, action: c.state, note: c.note, by_email: c.by_email, at: c.at }));
  return w;
}
