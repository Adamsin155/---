// Stages 4–6 merged (s4-status, s4-whatsapp, s5-cycle, s6-insights): what one
// branch did that another had to agree with. Protocol versions per client (stage 5)
// against the status page's approvals (stage 4) and the reminder ladders; one
// "late" never rung for an item the client started without.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dateIL } from '../app/tz.js';
import { PROCESSES, PROTOCOL_VERSION } from '../app/protocol.js';
import { applicableProcesses, clientState } from '../app/protocol-logic.js';
import { computeReminders, freshCase } from '../app/reminder-engine.js';
import { RULES } from '../app/reminder-rules.js';
import { itemSince, versionOf, LATEST } from '../app/protocol-versions.js';

const IL = (y, m, d, h = 0, mi = 0) => dateIL(y, m, d, h, mi);
const STAFF = [
  { email: 'owner@x', person: null }, { email: 'irit@x', person: 'irit' }, { email: 'lior@x', person: 'lior' },
  { email: 'ofir@x', person: 'ofir' }, { email: 'ilai@x', person: 'ilai' }, { email: 'nadia@x', person: 'nadia' },
];
const world = () => ({ clients: [], checks: {}, tasks: [], access: [], reviews: [], statusNotes: [], messages: [], subscriptions: [], staff: STAFF });
let seq = 0;
// A client of protocol version `v`: version 1 is read from when it was opened, so
// it is opened before version 2 reached the main branch (29.9, 13:27 UTC).
function client(w, v, o = {}) {
  seq += 1;
  const c = {
    id: `c${seq}`, name: `לקוח ${seq}`, status: 'active', shoot_type: 'dms', characterizer: 'ofir', has_logo: true, editor: 'nadia',
    rounds: [], contract_end: '2027-12-31', deal_at: IL(2026, 9, 1, 10).toISOString(), created_by_email: 'irit@x',
    created_at: '2026-09-01T07:00:00Z', protocol_version: v, shoot_at: IL(2026, 10, 18, 10).toISOString(), char_at: IL(2026, 10, 5, 10).toISOString(), ...o,
  };
  w.clients.push(c);
  return c;
}
const mark = (w, c, key, at, note = null) => { (w.checks[c.id] ||= {})[key] = { client_id: c.id, item_key: key, state: 'done', note, at: at.toISOString(), by_email: 'x@x' }; };
const itemsOf = (id) => PROCESSES.find((p) => p.id === id).items.filter((i) => !i.optional).map((i) => i.key);
const due = (w, now) => computeReminders({ ...w, now, log: [] });
const pick = (list, rule, step) => list.filter((r) => r.rule === rule && r.step === step);

// The editing is done and the final versions are in the Drive (as tests/office-flows.test.mjs).
function finals(w, v) {
  const c = client(w, v);
  for (const id of ['p01', 'p02', 'p03', 'p04', 'p05', 'p05b', 'p06', 'p07', 'p07a', 'p07b', 'p08', 'p08b', 'p09', 'p10', 'p11', 'p12a', 'p12', 'p13', 'p14', 'p15', 'p16', 'p17', 'p17b', 'p18', 'p18b', 'p19', 'p19b', 'p21', 'p22a']) {
    for (const k of itemsOf(id)) mark(w, c, k, IL(2026, 10, 18, 9), 'ייבוא');
  }
  mark(w, c, 'p27.final', IL(2026, 10, 22, 11));
  return c;
}

test('"קיבלתי" (p27.toilai): Ilai hears of the finals whatever the version; Lior\'s "late" list only for clients who started with it', () => {
  assert.equal(itemSince('p27.toilai'), 2);
  const w = world();
  const old = finals(w, 1);
  const cur = finals(w, PROTOCOL_VERSION);
  assert.equal(versionOf(old), 1);
  const at11 = due(w, IL(2026, 10, 22, 11));
  assert.deepEqual(pick(at11, 'finalReady', 'ilai').map((r) => r.clientId).sort(), [old.id, cur.id].sort());
  const at18 = due(w, IL(2026, 10, 22, 18));
  assert.deepEqual(pick(at18, 'finalReady', 'lior').map((r) => r.clientId), [cur.id]);
  // Not a "late" line on 27 from the general rule either.
  assert.equal(at18.filter((r) => r.rule === 'late' && r.key.includes(':p27@')).length, 0);
  // A version 2 client started with it: Lior hears.
  const w2 = world();
  const v2 = finals(w2, 2, {});
  v2.created_at = '2026-09-29T13:30:00Z';
  assert.equal(versionOf(v2), 2);
  assert.equal(pick(due(w2, IL(2026, 10, 22, 18)), 'finalReady', 'lior').length, 1);
});

test('a case is fresh when its rule says so, or when its whole process is newer than the client', () => {
  assert.equal(freshCase({}, { proc: { items: [{ key: 'a', fresh: 2 }, { key: 'b', fresh: 2 }, { key: 'c', optional: true }] } }), true);
  assert.equal(freshCase({}, { proc: { items: [{ key: 'a', fresh: 2 }, { key: 'b' }] } }), false);
  assert.equal(freshCase({}, { proc: { items: [] } }), false);
  assert.equal(freshCase({}, {}), false); // task and cycle cases have no process
  assert.equal(freshCase({ fresh: () => true }, {}), true);
  // Whole processes that came later: 12א and 22א (version 2), 17ב–19ב (version 4), 7ב and 23ב (version 6), 8ב (version 7), 5ב, 7א and the daily 14 (version 8).
  const procs = applicableProcesses({ id: 'x', shoot_type: 'dms', rounds: [], protocol_version: 1, created_at: '2026-09-01T07:00:00Z' });
  const whole = procs.filter((p) => freshCase({}, { proc: p })).map((p) => p.id);
  assert.deepEqual(whole, ['p05b', 'p07a', 'p07b', 'p08b', 'p12a', 'p14', 'p17b', 'p18b', 'p19b', 'p22a', 'p23b']);
  const v5 = applicableProcesses({ id: 'x', shoot_type: 'dms', rounds: [], protocol_version: 5 });
  assert.deepEqual(v5.filter((p) => freshCase({}, { proc: p })).map((p) => p.id), ['p05b', 'p07a', 'p07b', 'p08b', 'p14', 'p23b']);
  // Only finalReady names its item; the rule list has no other `fresh`.
  assert.deepEqual(RULES.filter((r) => typeof r.fresh === 'function').map((r) => r.id), ['finalReady']);
});

test('the status page\'s approvals work for a client of any version and never mark an item the client started without', () => {
  // What approve_item / request_fix write (supabase/migrations/20260930170000_client_status.sql).
  const APPROVE = ['p07.approved', 'p13.approved', 'p27.approved'];
  const READY = ['p07.sent', 'p12.scripts', 'p12.docs', 'p23.sent', 'p26.sent'];
  for (let v = 1; v <= LATEST; v += 1) {
    const procs = applicableProcesses({ id: 'x', shoot_type: 'dms', rounds: [], protocol_version: v, created_at: '2026-09-01T07:00:00Z' });
    const items = new Map(procs.flatMap((p) => p.items.map((i) => [i.key, i])));
    for (const k of [...APPROVE, ...READY]) {
      assert.ok(items.has(k), `${k} in version ${v}`);
      assert.ok(!items.get(k).fresh, `${k} is not new for version ${v}`);
    }
    // "Numbered" came with version 2: the database does not wait for it before (status_items).
    assert.equal(!!items.get('p12.numbered').fresh, v < 2, `p12.numbered, version ${v}`);
    // The videos' notes (a fix request) are optional: marking them never makes anything late or complete.
    assert.equal(items.get('p27.notes').optional, true);
    // p23.approved was the page's own mark on the rest of the graphics; since version 6 it is
    // also an optional item Irit can mark (the same key): new for older clients, never late.
    assert.equal(items.get('p23.approved').optional, true);
    assert.equal(!!items.get('p23.approved').fresh, v < 6, `p23.approved, version ${v}`);
  }
  const sql = readFileSync(new URL('../supabase/migrations/20260930170000_client_status.sql', import.meta.url), 'utf8');
  assert.match(sql, new RegExp(`c\\.protocol_version < ${itemSince('p12.numbered')} or count\\(\\*\\) filter \\(where s\\.item_key = pre \\|\\| 'p12\\.numbered'\\) = 1`));
  // A version 1 client approving the videos through the page: 27 is not late for it, and
  // the fresh items stay open work (Ilai's "קיבלתי"), not done by the approval.
  const w = world();
  const c = finals(w, 1);
  mark(w, c, 'p26.sent', IL(2026, 10, 21, 10));
  mark(w, c, 'p27.notes', IL(2026, 10, 21, 12), JSON.stringify({ text: 'לקצר', via: 'status' }));
  mark(w, c, 'p27.approved', IL(2026, 10, 23, 10), 'אושר בדף המצב על ידי דנה');
  const s = clientState(c, w.checks[c.id], IL(2026, 11, 20, 10)).states.find((x) => x.proc.id === 'p27');
  assert.equal(s.late, false);
  assert.equal(s.complete, false);
  assert.equal(s.proc.items.find((i) => i.key === 'p27.toilai').fresh, 2);
});
