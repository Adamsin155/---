// The owner's decision of 6.10.2026 (protocol version 7), at fixed Israel times (npm
// test runs this under UTC, New York and Jerusalem): once the Highlights are prepared
// (process 8 complete) a 30-minute office clock opens for uploading them to the
// client's pages (process 8ב, Ofir, item p08b.posted). Ofir is told quietly when it
// starts and rings when the 30 minutes pass without the mark; Lior hears of the
// lateness quietly; a client that started before version 7 is never late on it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeReminders, planDelivery } from '../app/reminder-engine.js';
import { LATE_RUNG, LATE_WATCHERS } from '../app/reminder-rules.js';
import { clocksFor } from '../app/clocks.js';
import { PROCESSES, STATIONS, PROTOCOL_VERSION, WORK_HOURS } from '../app/protocol.js';
import { clientState, openItemsFor, onOfficeTime, IMPORT_NOTE, clientLabel } from '../app/protocol-logic.js';
import { itemSince, PROTOCOL_HISTORY } from '../app/protocol-versions.js';
import { templateFor } from '../app/wa-templates.js';
import { importKeys } from '../app/client-open.js';
import { dateIL } from '../app/tz.js';

const IL = (y, m, d, h = 0, mi = 0) => dateIL(y, m, d, h, mi);
const STAFF = [
  { email: 'owner@x', person: null }, { email: 'irit@x', person: 'irit' }, { email: 'lior@x', person: 'lior' },
  { email: 'ofir@x', person: 'ofir' }, { email: 'ilai@x', person: 'ilai' },
];
let seq = 0;
const world = () => ({ clients: [], checks: {}, tasks: [], access: [], reviews: [], statusNotes: [], messages: [], subscriptions: [], staff: STAFF, deals: [] });
function client(w, o = {}) {
  seq += 1;
  const c = {
    id: `h${seq}`, name: o.name || `לקוח ${seq}`, status: 'active', shoot_type: 'dms', characterizer: 'ofir', has_logo: true,
    rounds: [], contract_end: '2027-12-31', deal_at: IL(2026, 9, 1, 10).toISOString(), created_by_email: 'irit@x',
    char_at: IL(2026, 10, 5, 10).toISOString(), protocol_version: PROTOCOL_VERSION, ...o,
  };
  w.clients.push(c);
  return c;
}
const mark = (w, c, key, at, note = null) => { (w.checks[c.id] ||= {})[key] = { client_id: c.id, item_key: key, state: 'done', note, at: at.toISOString(), by_email: 'ofir@x' }; };
const marks = (w, c, keys, at, note = null) => keys.forEach((k) => mark(w, c, k, at, note));
const itemsOf = (id) => PROCESSES.find((p) => p.id === id).items.filter((i) => !i.optional).map((i) => i.key);
const due = (w, now, log = []) => computeReminders({ ...w, now, log });
const of = (list, rule, person = null) => list.filter((r) => r.rule === rule && (!person || r.person === person));
const P8B = (r) => r.key.includes(':p08b@');
// A client in the characterization station: everything up to it is imported history,
// the meeting ended at 11:00, and process 8 and 8ב are open.
function inChar(w, o = {}) {
  const c = client(w, o);
  marks(w, c, importKeys('char'), IL(2026, 9, 1, 9), IMPORT_NOTE);
  for (const k of [...itemsOf('p08'), ...itemsOf('p08b')]) delete w.checks[c.id][k];
  return c;
}
const state = (w, c, now) => clientState(c, w.checks[c.id], now).states.find((s) => s.proc.id === 'p08b');

test('8ב in the protocol: right after 8, Ofir\'s, in "אפיון", one new key, version 7', () => {
  const i = PROCESSES.findIndex((p) => p.id === 'p08b');
  const p = PROCESSES[i];
  assert.equal(PROCESSES[i - 1].id, 'p08');
  assert.deepEqual([p.num, p.title, p.phase, p.owners], ['8ב', 'העלאת ה־Highlights לרשתות', 'parallel', ['ofir']]);
  assert.deepEqual(p.items.map((x) => [x.key, x.label, !!x.optional]), [['p08b.posted', 'ה־Highlights הועלו לעמודי הלקוח ברשתות', false]]);
  assert.equal(p.what, 'אחרי שה־Highlights מוכנים, אופיר מעלה אותם לעמודי הלקוח ומסמן. חצי שעה מרגע שהוכנו.');
  assert.deepEqual([p.start, p.due], [{ from: 'p08' }, { from: 'p08', minutes: 30 }]);
  assert.equal(onOfficeTime(p.due), true, '30 office minutes');
  const char = STATIONS.find((s) => s.key === 'char').procs;
  assert.equal(char[char.indexOf('p08') + 1], 'p08b');
  assert.equal(PROTOCOL_VERSION, 8); // 8 since 8.10.2026 (docs/ops.md, section 49); this feature itself did not move it
  assert.equal(itemSince('p08b.posted'), 7);
  assert.deepEqual(PROTOCOL_HISTORY.find((v) => v.version === 7).items, ['p08b.posted']);
});

test('the clock: it starts when process 8 is complete (both items) and is due 30 office minutes later', () => {
  const w = world();
  const c = inChar(w);
  // Nothing yet: not Ofir's work, no clock.
  let now = IL(2026, 10, 5, 12, 55);
  assert.equal(state(w, c, now).startAt, null);
  assert.ok(!openItemsFor('ofir', c, w.checks[c.id], clientState(c, w.checks[c.id], now), now).some((e) => e.item.key === 'p08b.posted'));
  // Prepared, not saved yet: still nothing.
  mark(w, c, 'p08.done', IL(2026, 10, 5, 12, 50));
  assert.equal(state(w, c, now).startAt, null);
  // Saved at 13:00: process 8 is complete, 8ב starts and is due at 13:30.
  mark(w, c, 'p08.saved', IL(2026, 10, 5, 13));
  now = IL(2026, 10, 5, 13, 5);
  const s = state(w, c, now);
  assert.equal(+s.startAt, +IL(2026, 10, 5, 13));
  assert.equal(+s.dueAt, +IL(2026, 10, 5, 13, 30));
  assert.equal(s.ready, true);
  // In "המשימות שלי" of Ofir, and of nobody else.
  const cs = clientState(c, w.checks[c.id], now);
  assert.deepEqual(openItemsFor('ofir', c, w.checks[c.id], cs, now).filter((e) => e.proc.id === 'p08b').map((e) => e.item.key), ['p08b.posted']);
  for (const who of ['ilai', 'irit', 'lior']) assert.ok(!openItemsFor(who, c, w.checks[c.id], cs, now).some((e) => e.proc.id === 'p08b'), who);
  // In his "עכשיו" bar: a running office clock, 25 minutes left; red once it ran out.
  const clocks = clocksFor('ofir', [c], w.checks, { now }).filter((k) => k.proc.id === 'p08b');
  assert.equal(clocks.length, 1);
  assert.deepEqual([clocks[0].kind, clocks[0].office, clocks[0].state, clocks[0].remaining, clocks[0].what], ['soon', true, 'running', 25 * 6e4, 'העלאת ה־Highlights לרשתות']);
  assert.equal(+clocks[0].deadline, +IL(2026, 10, 5, 13, 30));
  assert.deepEqual(clocks[0].people, ['ofir']);
  assert.equal(clocksFor('ilai', [c], w.checks, { now }).filter((k) => k.proc.id === 'p08b').length, 0);
  assert.equal(clocksFor('ofir', [c], w.checks, { now: IL(2026, 10, 5, 13, 40) }).find((k) => k.proc.id === 'p08b').state, 'expired');
  assert.equal(state(w, c, IL(2026, 10, 5, 13, 31)).status, 'overdue');
  // Marked: done, no clock.
  mark(w, c, 'p08b.posted', IL(2026, 10, 5, 13, 20));
  assert.equal(state(w, c, IL(2026, 10, 5, 13, 40)).status, 'done');
  assert.equal(clocksFor('ofir', [c], w.checks, { now: IL(2026, 10, 5, 13, 25) }).filter((k) => k.proc.id === 'p08b').length, 0);
});

test('office time: Highlights ready 10 minutes before closing are due 20 minutes into the next working morning', () => {
  const w = world();
  const c = inChar(w);
  marks(w, c, itemsOf('p08'), IL(2026, 10, 5, WORK_HOURS.end - 1, 50));
  assert.equal(+state(w, c, IL(2026, 10, 5, 17, 55)).dueAt, +IL(2026, 10, 6, WORK_HOURS.start, 20));
  // The clock stops at night: before the office opens, 20 office minutes are left; then it runs.
  const k = clocksFor('ofir', [c], w.checks, { now: IL(2026, 10, 6, 8, 40) }).find((x) => x.proc.id === 'p08b');
  assert.deepEqual([k.paused, k.remaining, +k.resumeAt], [true, 20 * 6e4, +IL(2026, 10, 6, 9)]);
  const m = clocksFor('ofir', [c], w.checks, { now: IL(2026, 10, 6, 9, 5) }).find((x) => x.proc.id === 'p08b');
  assert.deepEqual([m.paused, m.remaining], [false, 15 * 6e4]);
  // The ring waits for the office clock too: not at 18:20 real time, at 09:20.
  const w2 = { ...w };
  assert.equal(due(w2, IL(2026, 10, 5, 18, 30)).filter((r) => r.rule === 'highlightsUpload' && r.step === 'due').length, 0);
  assert.equal(due(w2, IL(2026, 10, 6, 9, 20)).filter((r) => r.rule === 'highlightsUpload' && r.step === 'due').length, 1);
});

test('the reminders: a quiet note to Ofir when it starts, a ring when 30 office minutes pass, Lior told of the lateness', () => {
  const w = world();
  const c = inChar(w, { name: 'רון כהן', business: 'פיצה רון' });
  assert.equal(due(w, IL(2026, 10, 5, 12, 59)).filter((r) => r.rule === 'highlightsUpload').length, 0);
  marks(w, c, itemsOf('p08'), IL(2026, 10, 5, 13));
  // 13:00: the quiet note, and nothing else about 8ב.
  const start = due(w, IL(2026, 10, 5, 13));
  const note = of(start, 'highlightsUpload');
  assert.deepEqual(note.map((r) => [r.step, r.person, r.level]), [['now', 'ofir', 'quiet']]);
  assert.equal(note[0].title, `ה־Highlights מוכנים: להעלות לרשתות תוך 30 דקות · ${clientLabel(c)}`);
  assert.match(note[0].title, /פיצה רון/, 'the business first (clientLabel)');
  assert.match(note[0].body, /יעד היום 13:30/);
  assert.equal(note[0].ref, 'p08b');
  // Since 7.10.2026 ("אין הודעות שקטות") the update goes to his phone too; it is still not counted as a ring.
  assert.equal(planDelivery({ reminders: note, now: IL(2026, 10, 5, 13) })[0].channel, 'push');
  // 13:29: not yet. 13:30: the ring, a protocol clock (the daily cap it was exempt from is gone: it rings whatever went out before).
  assert.equal(of(due(w, IL(2026, 10, 5, 13, 29)), 'highlightsUpload').filter((r) => r.step === 'due').length, 0);
  const ring = of(due(w, IL(2026, 10, 5, 13, 30)), 'highlightsUpload').filter((r) => r.step === 'due');
  assert.deepEqual(ring.map((r) => [r.person, r.level, r.exempt]), [['ofir', 'ring', 'clock']]);
  assert.equal(ring[0].title, `ה־Highlights של ${clientLabel(c)} עוד לא הועלו לרשתות`);
  const full = Array.from({ length: 12 }, (_, n) => ({ key: `x${n}`, person: 'ofir', level: 'ring', channel: 'push', status: 'sent', exempt: null, sent_at: IL(2026, 10, 5, 10).toISOString() }));
  assert.deepEqual(planDelivery({ reminders: ring, now: IL(2026, 10, 5, 13, 30), log: full }).map((r) => [r.channel, r.status]), [['push', 'sent']]);
  assert.equal(templateFor({ rule: 'highlightsUpload', key: ring[0].key, person: 'ofir' }), 'late');
  // The general lateness rule, after its 15-minute grace: Lior, quietly. Ofir already rang for this deadline.
  assert.equal(due(w, IL(2026, 10, 5, 13, 44)).filter((r) => r.rule === 'late' && P8B(r)).length, 0);
  const late = due(w, IL(2026, 10, 5, 13, 46)).filter((r) => r.rule === 'late' && P8B(r));
  assert.deepEqual(late.map((r) => [r.person, r.level]), [['lior', 'quiet']]);
  assert.match(late[0].title, /^באיחור: .*פיצה רון.* · 8ב · העלאת ה־Highlights לרשתות · אופיר$/);
  assert.deepEqual(LATE_RUNG, { p08b: 'ofir' });
  assert.ok(LATE_WATCHERS.includes('ofir'));
  // Whenever the engine runs (even catching up, with an empty log): Ofir never gets two
  // messages about this upload for the same minute.
  for (const now of [IL(2026, 10, 5, 13, 30), IL(2026, 10, 5, 13, 46), IL(2026, 10, 5, 16)]) {
    const mine = due(w, now).filter((r) => r.person === 'ofir' && (r.rule === 'highlightsUpload' || P8B(r)));
    const minutes = mine.map((r) => Math.floor(r.at / 6e4));
    assert.equal(new Set(minutes).size, minutes.length, JSON.stringify(mine.map((r) => r.key)));
    assert.deepEqual(mine.map((r) => r.step).sort(), ['due', 'now']);
  }
  // Every other late process still reaches both watchers (process 8 itself, when late).
  const w2 = world();
  const c2 = inChar(w2);
  mark(w2, c2, 'p04.ended', IL(2026, 10, 5, 11), '{}');
  const late8 = due(w2, IL(2026, 10, 5, 13, 20)).filter((r) => r.rule === 'late' && r.key.includes(':p08@'));
  assert.deepEqual(late8.map((r) => r.person).sort(), ['lior', 'ofir']);
  // Marked in time: nothing more.
  mark(w, c, 'p08b.posted', IL(2026, 10, 5, 13, 20));
  const after = due(w, IL(2026, 10, 5, 13, 46), start);
  assert.equal(after.filter((r) => r.rule === 'highlightsUpload' || P8B(r)).length, 0);
});

test('imported history is not an event: no note, no ring, no clock for Highlights that were ready long ago', () => {
  const w = world();
  const c = client(w);
  marks(w, c, importKeys('content'), IL(2026, 9, 1, 9), IMPORT_NOTE); // the client was imported past "אפיון"
  assert.equal(w.checks[c.id]['p08b.posted'].note, IMPORT_NOTE, 'importing a client past the station closes 8ב too');
  const now = IL(2026, 10, 5, 13);
  assert.equal(state(w, c, now).status, 'done');
  assert.equal(due(w, now).filter((r) => r.rule === 'highlightsUpload' || P8B(r)).length, 0);
  assert.equal(clocksFor('ofir', [c], w.checks, { now }).filter((k) => k.proc.id === 'p08b').length, 0);
  // As the migration leaves an existing client: process 8 done by hand long ago, 8ב imported.
  const w2 = world();
  const old = inChar(w2, { protocol_version: 6 });
  marks(w2, old, itemsOf('p08'), IL(2026, 9, 20, 12));
  mark(w2, old, 'p08b.posted', IL(2026, 10, 9, 10), IMPORT_NOTE);
  assert.equal(state(w2, old, now).status, 'done');
  assert.equal(due(w2, now).filter((r) => r.rule === 'highlightsUpload' || P8B(r)).length, 0);
});

test('a client that started before version 7: the upload is work with a clock, never late, never a lateness ring', () => {
  const w = world();
  const c = inChar(w, { protocol_version: 6 });
  marks(w, c, itemsOf('p08'), IL(2026, 10, 5, 13));
  const now = IL(2026, 10, 5, 16);
  const s = state(w, c, now);
  assert.equal(s.proc.items[0].fresh, 7);
  assert.equal(+s.dueAt, +IL(2026, 10, 5, 13, 30));
  assert.equal(s.late, false);
  assert.notEqual(s.status, 'overdue');
  // Still his work, with the clock in the bar and the quiet note.
  assert.ok(openItemsFor('ofir', c, w.checks[c.id], clientState(c, w.checks[c.id], now), now).some((e) => e.item.key === 'p08b.posted'));
  assert.equal(clocksFor('ofir', [c], w.checks, { now: IL(2026, 10, 5, 13, 10) }).filter((k) => k.proc.id === 'p08b').length, 1);
  const all = due(w, now);
  assert.deepEqual(of(all, 'highlightsUpload').map((r) => [r.step, r.person, r.level]), [['now', 'ofir', 'quiet']]);
  assert.equal(all.filter((r) => r.rule === 'late' && P8B(r)).length, 0);
});
