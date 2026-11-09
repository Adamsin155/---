// The editor's hand-off to Ofir by itself (docs/ops.md, section 121; app/editor-auto.js): once
// every live item of 22 and the items of 24 but "העורך עדכן את אופיר" are marked, the system writes
// p24.notify once, and everything downstream runs as if the editor had pressed it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientState, IMPORT_NOTE } from '../app/protocol-logic.js';
import { editorReadyKeys, editorReadyPlans, AUTO_NOTE, NOTIFY } from '../app/editor-auto.js';
import { qaQueue } from '../app/qa-logic.js';
import { editingCases, editorState } from '../app/production.js';
import { computeReminders } from '../app/reminder-engine.js';
import { handoffsFor } from '../app/handoffs.js';
import { dateIL } from '../app/tz.js';

const IL = (y, m, d, h = 0, mi = 0) => dateIL(y, m, d, h, mi);
const now = IL(2026, 11, 9, 12); // Monday
const at = IL(2026, 11, 9, 10);
const done = (when = at, note = null) => ({ state: 'done', at: when.toISOString(), note, by_email: 'nadia@x' });
const base = {
  id: 'c1', name: 'דנה', business: 'קפה דנה', status: 'active', shoot_type: 'dms', characterizer: 'ofir', has_logo: true,
  deal_at: IL(2026, 10, 1, 10).toISOString(), char_at: IL(2026, 10, 3, 10).toISOString(), shoot_at: IL(2026, 11, 3, 10).toISOString(),
  contract_end: '2027-10-01', editor: 'nadia', rounds: [],
};
const procOf = (c, cs, id) => clientState(c, cs, now).states.find((s) => s.proc.id === id).proc;
// Every live item of 22, and 24's folder and Drive (pre: '' or 'r2.'; pid: '' or 'r2-').
function editedAll(c, cs = {}, pid = '', pre = '') {
  const out = { ...cs, [`${pre}p22a.assigned`]: done(IL(2026, 11, 4, 10)) };
  for (const i of procOf(c, out, `${pid}p22`).items) out[i.key] = done();
  out[`${pre}p24.folder`] = done();
  out[`${pre}p24.drive`] = done(at, 'https://drive.google.com/drive/folders/x');
  return out;
}
const keys = (c, cs) => editorReadyKeys(c, cs, clientState(c, cs, now));

test('complete → p24.notify once; written → never again', () => {
  const cs = editedAll(base);
  assert.deepEqual(keys(base, cs), [NOTIFY]);
  const after = { ...cs, [NOTIFY]: { ...done(now, AUTO_NOTE), by_email: '' } };
  assert.deepEqual(keys(base, after), []);
  // A "לא רלוונטי" on it is a mark too: never written over.
  assert.deepEqual(keys(base, { ...cs, [NOTIFY]: { state: 'na', at: now.toISOString(), note: 'x' } }), []);
  // 24 is complete with it, and 25 starts.
  const st = clientState(base, after, now);
  assert.equal(st.states.find((s) => s.proc.id === 'p24').complete, true);
  const plans = editorReadyPlans([base], Object.entries(cs).map(([k, v]) => ({ client_id: base.id, item_key: k, ...v })), (x, y) => clientState(x, y, now));
  assert.deepEqual(plans.map((p) => p.marks), [[{ item_key: NOTIFY, state: 'done', note: AUTO_NOTE }]]);
});

test('partial → nothing: one item of 22 open, the folder or the Drive open, or Dropbox when the card has its link', () => {
  const cs = editedAll(base);
  for (const k of ['p22.self.spelling', 'p22.self.sound', 'p22.received', 'p24.folder', 'p24.drive']) {
    const less = { ...cs };
    delete less[k];
    assert.deepEqual(keys(base, less), [], k);
  }
  // "לא רלוונטי" counts as resolved.
  assert.deepEqual(keys(base, { ...cs, 'p22.check.logo': { state: 'na', at: at.toISOString(), note: 'אין' } }), [NOTIFY]);
  const withDropbox = { ...base, links: { dropbox: 'https://www.dropbox.com/x' } };
  assert.deepEqual(keys(withDropbox, cs), [], 'Dropbox needed');
  assert.deepEqual(keys(withDropbox, { ...cs, 'p24.dropbox': done() }), [NOTIFY]);
  assert.deepEqual(keys(base, cs), [NOTIFY], 'no Dropbox link: not needed');
});

test('not for a client past it, an ended one, one without an editor, or one whose marks are all from the import', () => {
  const cs = editedAll(base);
  assert.deepEqual(keys(base, { ...cs, 'p25.approved': done() }), [], 'Ofir already approved');
  assert.deepEqual(keys(base, { ...cs, 'p25.return.1': done(at, '{"v":1,"issues":[]}') }), [], 'a return');
  assert.deepEqual(keys(base, { ...cs, 'p26.sent': done() }), [], 'sent to the client');
  assert.deepEqual(keys({ ...base, status: 'ended' }, cs), []);
  assert.deepEqual(keys({ ...base, editor: null }, cs), []);
  const imported = Object.fromEntries(Object.entries(cs).map(([k, v]) => [k, { ...v, note: IMPORT_NOTE }]));
  assert.deepEqual(keys(base, imported), [], 'history from the old system');
  // A client in landing goes to Ofir's queue too (as when the editor presses it).
  assert.deepEqual(keys({ ...base, landing: true }, cs), [NOTIFY]);
});

test('two editors: the marks are one set for the shoot, so one editor\'s half is nothing; both done → once', () => {
  const two = { ...base, editor2: 'yariv', editor_split: { nadia: 6, yariv: 6 } };
  const cs = editedAll(two);
  const half = { ...cs };
  delete half['p22.self.complete']; // "כל כמות הסרטונים הושלמה": not yet, Yariv's share is open
  delete half['p24.drive'];
  assert.deepEqual(keys(two, half), []);
  assert.deepEqual(keys(two, cs), [NOTIFY]);
  // Each of them sees the job "אצל אופיר" once it is written.
  const after = { ...cs, [NOTIFY]: done(now, AUTO_NOTE) };
  const st = clientState(two, after, now);
  for (const e of ['nadia', 'yariv']) {
    const [job] = editingCases(two, after, e, st);
    assert.equal(editorState(job, after).key, 'qa', e);
  }
});

test('round 2: its own keys, its own editor; the client\'s own shoot is not touched', () => {
  const c = { ...base, rounds: [{ n: 2, shoot_at: IL(2026, 11, 5, 10).toISOString(), shoot_type: 'dms', editor: 'yariv' }] };
  // The client's own shoot is long with Ofir; round 2 is all marked.
  const first = { ...editedAll(c), [NOTIFY]: done(IL(2026, 11, 5, 9)), 'p25.approved': done() };
  const cs = editedAll(c, first, 'r2-', 'r2.');
  assert.deepEqual(keys(c, cs), ['r2.p24.notify']);
  const half = { ...cs };
  delete half['r2.p24.folder'];
  assert.deepEqual(keys(c, half), []);
  // Both at once: the client's shoot and the round.
  const both = editedAll(c, editedAll(c), 'r2-', 'r2.');
  assert.deepEqual(keys(c, both).sort(), ['p24.notify', 'r2.p24.notify']);
});

test('downstream: Ofir\'s queue, his and Irit\'s ring, the hand-off and the editor\'s reminders run as if pressed', () => {
  const cs = editedAll(base);
  const after = { ...cs, [NOTIFY]: { state: 'done', at: now.toISOString(), note: AUTO_NOTE, by_email: '' } };
  const stateOf = (c) => clientState(c, after, now);
  const q = qaQueue({ clients: [base], stateOf, checks: { c1: after }, now });
  assert.deepEqual(q.map((x) => [x.kind, +x.readyAt]), [['videos', +now]]);
  assert.equal(qaQueue({ clients: [base], stateOf: (c) => clientState(c, cs, now), checks: { c1: cs }, now }).length, 0, 'not before');
  // The ring "מוכן לבדיקה" to Ofir and Irit, once.
  const staff = [{ email: 'irit@x', person: 'irit' }, { email: 'ofir@x', person: 'ofir' }, { email: 'nadia@x', person: 'nadia' }, { email: 'owner@x', person: null }];
  const w = (checks) => ({ clients: [base], checks: { c1: checks }, tasks: [], access: [], reviews: [], statusNotes: [], messages: [], subscriptions: [], staff });
  const qa = (list) => list.filter((r) => r.rule === 'qa' && r.step === 'now');
  assert.equal(qa(computeReminders({ ...w(cs), now, log: [] })).length, 0);
  const got = qa(computeReminders({ ...w(after), now, log: [] }));
  assert.deepEqual(got.map((r) => r.person).sort(), ['irit', 'ofir']);
  assert.match(got[0].title, /^מוכן לבדיקה: /);
  assert.equal(qa(computeReminders({ ...w(after), now: IL(2026, 11, 9, 12, 1), log: new Set(got.map((r) => r.key)) })).length, 0, 'once');
  // The editor's own "day 2" reminders stop: the job is with Ofir.
  const editing = (checks) => computeReminders({ ...w(checks), now: IL(2026, 11, 6, 15, 30), log: [] }).filter((r) => r.rule === 'editing');
  assert.ok(editing(cs).length > 0, 'before: the editor is still reminded');
  assert.equal(editing(after).length, 0);
  // The WhatsApp hand-off "הסרטונים מוכנים לבקרה" to Ofir stands on the same key.
  const offers = handoffsFor(base, after, NOTIFY, { now });
  assert.equal(offers.length, 1);
  assert.equal(offers[0].markKey, 'p24.handoff.ofir');
});
