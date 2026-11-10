// The owner's decision of 6.10.2026 (protocol version 7), at fixed Israel times (npm
// test runs this under UTC, New York and Jerusalem): once the Highlights are prepared
// (process 8 complete) a 30-minute office clock opens for uploading them to the
// client's pages (process 8ב, Ofir, item p08b.posted). Ofir is told quietly when it
// starts and rings when the 30 minutes pass without the mark; Lior hears of the
// lateness quietly; a client that started before version 7 is never late on it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeReminders, planDelivery, candidates, buildEnv } from '../app/reminder-engine.js';
import { LATE_RUNG, LATE_WATCHERS, lateRungOf } from '../app/reminder-rules.js';
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
// What only Lior's "החלטות" reads (the rule `late` since 5.11.2026, docs/ops.md, section 100): never sent.
const onScreen = (w, now) => candidates(buildEnv({ ...w, now })).filter((r) => r.screen);
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
  assert.deepEqual([p.num, p.title, p.phase], ['8ב', 'העלאת ה־Highlights לרשתות', 'parallel']);
  // Since 1.11.2026 the client's characterizer's: Ofir or Noam, Noam when none was set, Ofir when Lior ran the meeting.
  assert.deepEqual(['ofir', 'noam', null, 'lior'].map((characterizer) => p.owners({ characterizer })), [['ofir'], ['noam'], ['noam'], ['ofir']]);
  assert.deepEqual(p.items.map((x) => [x.key, x.label, !!x.optional]), [['p08b.posted', 'ה־Highlights הועלו לעמודי הלקוח ברשתות', false]]);
  assert.equal(p.what, 'אחרי שה־Highlights מוכנים, מבצע האפיון (נעם או אופיר) מעלה אותם לעמודי הלקוח ומסמן. חצי שעה מרגע שהוכנו.');
  assert.deepEqual([p.start, p.due], [{ from: 'p08' }, { from: 'p08', minutes: 30 }]);
  assert.equal(onOfficeTime(p.due), true, '30 office minutes');
  const char = STATIONS.find((s) => s.key === 'char').procs;
  assert.equal(char[char.indexOf('p08') + 1], 'p08b');
  assert.equal(PROTOCOL_VERSION, 14); // 14 since 10.11.2026 (the editors' marks, docs/ops.md section 123); 13 since 9.11.2026 (docs/ops.md section 119); 12 since 3.11.2026 (Lior's four things, tests/protocol-versions.test.mjs); 11 since 21.10.2026 (Ofir connects to Metricool); this feature itself did not move it
  assert.equal(itemSince('p08b.posted'), 7);
  assert.deepEqual(PROTOCOL_HISTORY.find((v) => v.version === 7).items, ['p08b.posted']);
});

// Protocol v14 (the owner, 10.11.2026; Ofir: "לאחד"): 8 and 8ב are one mark in 8, "ה־Highlights הוכנו
// והועלו לרשתות" (p08.ok). 8ב left (`retired: 14`): no clock of its own, no note, no ring, no lateness.
// The tests of its 30-minute clock (the clock, office time, the reminders, imported history, clients
// from before v7) were removed with it; the definition above stays, as the history of its marks.
test('v14: 8ב left; one mark in 8 (p08.ok), passed by the old three; nothing of 8ב rings', () => {
  const p8b = PROCESSES.find((p) => p.id === 'p08b');
  assert.equal(p8b.retired, 14);
  const p8 = PROCESSES.find((p) => p.id === 'p08');
  assert.deepEqual(p8.items.filter((i) => !i.retired).map((i) => [i.key, i.label]), [['p08.ok', 'ה־Highlights הוכנו והועלו לרשתות']]);
  const w = world();
  const c = inChar(w);
  const now = IL(2026, 10, 5, 12);
  assert.equal(state(w, c, now), undefined, '8ב applies to nobody');
  assert.deepEqual(openItemsFor('ofir', c, w.checks[c.id], clientState(c, w.checks[c.id], now), now).filter((o) => /^p08/.test(o.item.key)).map((o) => o.item.key), ['p08.ok']);
  // The old two of 8 done: 8 stays open until the upload too (p08b.posted, or the one mark).
  marks(w, c, ['p08.done', 'p08.saved'], IL(2026, 10, 5, 12));
  const s8 = (at) => clientState(c, w.checks[c.id], at).states.find((s) => s.proc.id === 'p08');
  assert.equal(s8(IL(2026, 10, 5, 12, 5)).complete, false);
  for (const at of [IL(2026, 10, 5, 12, 5), IL(2026, 10, 5, 13, 30), IL(2026, 10, 6, 9, 30)]) assert.equal(of(due(w, at), 'highlightsUpload').length, 0);
  mark(w, c, 'p08b.posted', IL(2026, 10, 5, 12, 20));
  assert.equal(s8(IL(2026, 10, 5, 12, 25)).complete, true, 'all three old marks: done');
  delete w.checks[c.id]['p08b.posted'];
  mark(w, c, 'p08.ok', IL(2026, 10, 5, 12, 30));
  assert.equal(s8(IL(2026, 10, 5, 12, 35)).complete, true, 'the one mark: done');
});
