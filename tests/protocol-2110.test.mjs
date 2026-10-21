// The owner's decisions of 21.10.2026 (after the staff training):
//   1. A process marked "ממתין ללקוח" rings the responsible employee every hour, inside the
//      working hours, until the wait is cleared (rule `waitNag`, app/reminder-rules.js).
//   2. Ofir connects the client to Metricool when he takes the accesses (protocol v12).
// Fixed Israel times; npm test runs this under UTC, New York and Jerusalem.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeReminders } from '../app/reminder-engine.js';
import { RULES, WAIT_NAG, WAIT_NAG_EVERY, waitSlot } from '../app/reminder-rules.js';
import { PROCESSES, PROTOCOL_VERSION } from '../app/protocol.js';
import { IMPORT_NOTE, clientState, openItemsFor } from '../app/protocol-logic.js';
import { PROTOCOL_HISTORY, itemSince } from '../app/protocol-versions.js';
import { charDay } from '../app/ilai-logic.js';
import { mayWrite } from '../scripts/protocol-writers.mjs';
import { importKeys } from '../app/client-open.js';
import { inboxRows } from '../app/push-logic.js';
import { dateIL, partsIL } from '../app/tz.js';

const IL = (y, m, d, h = 0, mi = 0) => dateIL(y, m, d, h, mi, 0);
const hhmm = (d) => { const p = partsIL(d); return `${p.day}.${p.month} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`; };
const STAFF = [
  { email: 'owner@x', person: null }, { email: 'irit@x', person: 'irit' }, { email: 'lior@x', person: 'lior' },
  { email: 'ofir@x', person: 'ofir' }, { email: 'ilai@x', person: 'ilai' }, { email: 'nirel@x', person: 'nirel' },
];
const world = () => ({ clients: [], checks: {}, tasks: [], access: [], reviews: [], statusNotes: [], messages: [], subscriptions: [], staff: STAFF, deals: [] });
let seq = 0;
const mark = (w, c, key, at, note = null, by = 'x@x', state = 'done') => { (w.checks[c.id] ||= {})[key] = { client_id: c.id, item_key: key, state, note, at: at.toISOString(), by_email: by }; };
const itemsOf = (id) => PROCESSES.find((p) => p.id === id).items.filter((i) => !i.optional).map((i) => i.key);
// A client the day after its characterization (Monday 5.10.2026): Ilai's 9 graphics (7) are open.
function afterMeeting(w, o = {}) {
  seq += 1;
  const c = {
    id: `c${seq}`, name: o.name || 'אלפא', status: 'active', shoot_type: 'dms', characterizer: 'ofir', has_logo: true, protocol_version: PROTOCOL_VERSION,
    rounds: [], contract_end: '2027-12-31', deal_at: IL(2026, 9, 1, 10).toISOString(), created_by_email: 'irit@x', char_at: IL(2026, 10, 5, 10).toISOString(), ...o,
  };
  w.clients.push(c);
  for (const k of importKeys('char')) mark(w, c, k, IL(2026, 9, 1, 9), IMPORT_NOTE);
  for (const k of itemsOf('p04')) mark(w, c, k, IL(2026, 10, 5, 12));
  for (const id of ['p05', 'p05b', 'p06', 'p08', 'p08b', 'p09', 'p10', 'p12a', 'p12']) for (const k of itemsOf(id)) mark(w, c, k, IL(2026, 10, 5, 12, 30));
  return c;
}
const waitNote = (reason) => JSON.stringify({ reason, recheck: '2026-10-07' });
function walk(w, from, to, log = []) {
  const rows = [];
  for (let t = new Date(from); t <= to; t = new Date(t.getTime() + 6e4)) {
    for (const r of computeReminders({ ...w, now: t, log })) {
      log.push({ key: r.key });
      if (r.rule === WAIT_NAG) rows.push({ ...r, at: hhmm(t) });
    }
  }
  return rows;
}

test('1. "ממתין ללקוח" rings whoever marked it every hour inside the working hours, until the wait is cleared', () => {
  assert.equal(WAIT_NAG_EVERY, 60);
  assert.ok(RULES.some((r) => r.id === WAIT_NAG));
  const w = world();
  const c = afterMeeting(w);
  // Tuesday 6.10 10:15: Ilai marks his graphics as waiting on the client.
  mark(w, c, 'p07.wait', IL(2026, 10, 6, 10, 15), waitNote('הלקוח צריך לשלוח לוגו באיכות גבוהה'), 'ilai@x');
  const log = [];
  const tue = walk(w, IL(2026, 10, 6, 10, 15), IL(2026, 10, 6, 23, 0), log);
  // The first an hour after the marking, then every hour until the sending hours end (19:00).
  assert.deepEqual(tue.map((r) => `${r.at} ${r.person}:${r.level}`), ['11:15', '12:15', '13:15', '14:15', '15:15', '16:15', '17:15', '18:15'].map((t) => `6.10 ${t} ilai:ring`));
  assert.equal(tue[0].title, 'אלפא עדיין ממתין ללקוח: הלקוח צריך לשלוח לוגו באיכות גבוהה · תזכיר/י ללקוח');
  assert.equal(tue[0].body, 'תהליך 7 · הכנת 9 גרפיקות ראשונות · ממתין מ־היום 10:15 · תזכורת כל שעה בשעות העבודה, עד שמסירים את ״ממתין ללקוח״.');
  assert.equal(tue[0].url, `client.html?id=${c.id}#p07`);
  assert.equal(new Set(tue.map((r) => r.key)).size, tue.length, 'each hour is its own slot');
  // Wednesday: from 08:30, every hour to 18:30. The date "לבדוק שוב" does not hold it.
  const wed = walk(w, IL(2026, 10, 7, 0, 0), IL(2026, 10, 7, 23, 59), log);
  assert.deepEqual(wed.map((r) => r.at), ['08:30', '09:30', '10:30', '11:30', '12:30', '13:30', '14:30', '15:30', '16:30', '17:30', '18:30'].map((t) => `7.10 ${t}`));
  assert.match(wed[0].body, /ממתין מ־אתמול 10:15/);
  // Friday and Saturday: nothing.
  assert.deepEqual(walk(w, IL(2026, 10, 9, 0, 0), IL(2026, 10, 10, 23, 59), log), []);
  // Sunday 11.10, 10:00: the wait is cleared. Nothing more.
  const sun = walk(w, IL(2026, 10, 11, 8, 0), IL(2026, 10, 11, 9, 59), log);
  assert.deepEqual(sun.map((r) => r.at), ['11.10 08:30', '11.10 09:30']);
  mark(w, c, 'p07.wait', IL(2026, 10, 11, 10), null, 'ilai@x', 'open');
  assert.deepEqual(walk(w, IL(2026, 10, 11, 10, 0), IL(2026, 10, 11, 19, 0), log), []);
  // Never to the client (no person but staff) and nothing to the owners.
  assert.ok([...tue, ...wed, ...sun].every((r) => r.person === 'ilai'));
});

test('1. who: the employee who marked the wait; the owner\'s mark goes to the process\'s owners; landing and a missed slot are never rung', () => {
  const w = world();
  const a = afterMeeting(w, { name: 'אלפא' });
  mark(w, a, 'p07.wait', IL(2026, 10, 6, 10), waitNote('חומרים'), 'irit@x');
  const b = afterMeeting(w, { name: 'בטא' });
  mark(w, b, 'p07.wait', IL(2026, 10, 6, 10), waitNote('חומרים'), 'owner@x');
  const l = afterMeeting(w, { name: 'קליטה', landing: true });
  mark(w, l, 'p07.wait', IL(2026, 10, 6, 10), waitNote('חומרים'), 'ilai@x');
  const at = (now) => computeReminders({ ...w, now, log: [] }).filter((r) => r.rule === WAIT_NAG).map((r) => `${r.clientId === a.id ? 'אלפא' : r.clientId === b.id ? 'בטא' : 'קליטה'}@${r.person}`).sort();
  assert.deepEqual(at(IL(2026, 10, 6, 11)), ['אלפא@irit', 'בטא@ilai']);
  // Between slots, nothing new; a slot the engine missed is not sent later (its id is the slot's).
  assert.deepEqual(at(IL(2026, 10, 6, 11, 30)), ['אלפא@irit', 'בטא@ilai'], 'the same slot (11:00), the log keeps it to one');
  assert.equal(waitSlot(IL(2026, 10, 6, 10), IL(2026, 10, 6, 11, 30)).id, '2026-10-06.1');
  assert.equal(waitSlot(IL(2026, 10, 6, 10), IL(2026, 10, 6, 10, 59)), null);
  assert.equal(waitSlot(IL(2026, 10, 6, 10), IL(2026, 10, 6, 19, 0)), null);
  assert.equal(waitSlot(IL(2026, 10, 6, 10), IL(2026, 10, 9, 10, 0)), null, 'Friday');
  // "התראות" shows one row for it, the latest.
  const rows = [
    { id: 1, rule: WAIT_NAG, key: `${WAIT_NAG}:${a.id}:p07:2026-10-06.1@irit`, created_at: IL(2026, 10, 6, 11).toISOString(), status: 'sent', level: 'ring', channel: 'push' },
    { id: 2, rule: WAIT_NAG, key: `${WAIT_NAG}:${a.id}:p07:2026-10-06.2@irit`, created_at: IL(2026, 10, 6, 12).toISOString(), status: 'sent', level: 'ring', channel: 'push' },
  ];
  assert.deepEqual(inboxRows(rows, IL(2026, 10, 6, 13)).map((r) => r.id), [2]);
});

test("2. version 11: 'כל הרשתות חוברו ל־Metricool' is Ofir's, right after he took the accesses; Ilai no longer has it", () => {
  assert.equal(PROTOCOL_VERSION, 11);
  const v11 = PROTOCOL_HISTORY.at(-1);
  assert.equal(v11.version, 11);
  assert.equal(v11.items, undefined, 'nothing added: the same key, another owner');
  assert.match(v11.changes.join(' '), /אופיר.*Metricool/);
  assert.match(v11.changes.join(' '), /ממתין ללקוח.*בכל שעה/);
  assert.equal(itemSince('p06.metricool'), 1);
  const p06 = PROCESSES.find((p) => p.id === 'p06');
  assert.deepEqual(p06.items.find((i) => i.key === 'p06.metricool').owners, ['ofir']);
  assert.deepEqual(p06.owners, ['ilai'], "the rest of 6 stays Ilai's");
  // Ofir took the accesses at the characterization (Monday 5.10 12:30): the item is on his list, not on Ilai's.
  const w = world();
  const c = afterMeeting(w, { name: 'גמא' });
  for (const k of [...itemsOf('p06')]) delete w.checks[c.id][k];
  const now = IL(2026, 10, 5, 12, 40);
  const st = clientState(c, w.checks[c.id], now);
  const open = (who) => openItemsFor(who, c, w.checks[c.id], st, now).map((e) => e.item.key);
  assert.ok(open('ofir').includes('p06.metricool'));
  assert.ok(!open('ilai').includes('p06.metricool'));
  assert.ok(open('ilai').includes('p06.verified'));
  // Its deadline is 6's: 30 minutes from the accesses.
  assert.equal(hhmm(st.states.find((s) => s.proc.id === 'p06').dueAt), '5.10 13:00');
  // Who may write it: the office (Ofir among them); Ilai no more.
  assert.equal(mayWrite({ person: 'ofir', client: c, key: 'p06.metricool' }), true);
  assert.equal(mayWrite({ person: 'ilai', client: c, key: 'p06.metricool' }), false);
  assert.equal(mayWrite({ person: 'ilai', client: c, key: 'p06.name' }), true);
});

test("2. Ilai's characterization card: the page setup is done without Metricool, which is only said", () => {
  const w = world();
  const c = afterMeeting(w, { name: 'דלתא' });
  for (const k of [...itemsOf('p06'), ...itemsOf('p07'), ...itemsOf('p09')]) delete w.checks[c.id][k];
  for (const k of ['p06.name', 'p06.bio', 'p06.details', 'p06.phone', 'p06.address', 'p06.look']) mark(w, c, k, IL(2026, 10, 5, 12, 20));
  const now = IL(2026, 10, 5, 12, 30);
  const [card] = charDay({ clients: [c], stateOf: (x) => clientState(x, w.checks[x.id], now), checks: w.checks, now });
  assert.equal(card.lines.find((l) => l.key === 'page').done, true);
});
