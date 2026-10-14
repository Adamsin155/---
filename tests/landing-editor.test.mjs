// The real editor of an old client already in editing, recorded on the intake screen while
// the client is in landing (the owner, 14.10.2026; docs/ops.md, the bullets of that day):
//   - who may set it, which editors are offered, the name the owner's sheet wrote in the notes;
//   - once set, Ofir's screen no longer offers the client for assignment, the editor has it
//     on editor.html, and the suggestion counts it in that editor's load; cleared, all back;
//   - activated, its 22א is imported history: the rule `editing` ("לקוח חדש בעריכה אצלך")
//     and Ofir's fast ladder never see an assignment, so nothing rings for the editor.
// Runs under three time zones (npm test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { clientState, IMPORT_NOTE } from '../app/protocol-logic.js';
import { importKeys } from '../app/client-open.js';
import { canSetEditor, editorFromNotes, editorSlots, withLandingEditors, intakeItems, waitingPeople } from '../app/landing-logic.js';
import { awaitingEditor, editorLoad, suggestAssignment } from '../app/qa-logic.js';
import { editingCases } from '../app/production.js';
import { fastCases } from '../app/fast-ladder.js';
import { computeReminders, buildEnv } from '../app/reminder-engine.js';
import { RULES } from '../app/reminder-rules.js';

const IMPORTED = '2026-10-13T10:00:00Z';
const NOW = new Date('2026-10-14T08:00:00Z'); // Wednesday, 11:00 in Israel
const v = (me, scope = 'office') => ({ me, scope, error: null });
const client = (over = {}) => ({
  id: 'c1', name: 'מאיה', business: 'סטודיו מאיה', status: 'active', shoot_type: 'dms', characterizer: 'ofir', has_logo: true,
  deal_at: '2026-06-01T07:00:00Z', char_at: '2026-06-10T08:00:00Z', shoot_at: '2026-10-05T06:00:00Z', contract_end: '2027-06-01',
  editor: null, rounds: [], deliverables: { videos: 12, graphics: 20, shoot_days: 1 }, protocol_version: 7,
  created_by_email: 'system', quote_id: null, created_at: IMPORTED, landing: true, landed_at: null,
  notes: 'לקוח ותיק\nהעורך: יריב', ...over,
});
// The import put it at "עריכה ובקרה": everything before is history, 22א is open.
const imported = () => Object.fromEntries(importKeys('post', { shootSet: true }).map((k) => [k, { state: 'done', note: IMPORT_NOTE, at: IMPORTED, by_email: '' }]));
// What public.landing_set_editor writes: the four answers of 22א, and the editor in the card.
const setMarks = (choice = 'done', pre = '') => Object.fromEntries(['p22a.load', 'p22a.assigned', 'p22a.irit', 'p22a.drive']
  .map((k) => [`${pre}${k}`, { choice, person: 'irit', by_email: 'irit@x', at: '2026-10-14T07:59:00Z' }]));
const qaView = (clients, checksBy, marksBy) => {
  const checks = withLandingEditors(clients, checksBy, marksBy);
  const stateOf = (c) => clientState(c, checks[c.id] || {}, NOW);
  return { checks, stateOf, waiting: awaitingEditor({ clients, stateOf, checks }), load: editorLoad({ clients, stateOf, checks, now: NOW }) };
};

test('who may record it: the office that fixes a station (Irit, Lior, Ofir) and the owners; nobody else', () => {
  for (const who of ['irit', 'lior', 'ofir']) assert.equal(canSetEditor(v(who)), true, who);
  assert.equal(canSetEditor(v(null)), true, 'an owner');
  for (const who of ['ilai', 'nadia', 'yariv', 'anna', 'nirel', 'eli', 'stav', 'amos']) assert.equal(canSetEditor(v(who, who === 'stav' || who === 'amos' ? 'sales' : 'own')), false, who);
  // The office scope with somebody else's person (should never happen) is still not enough.
  assert.equal(canSetEditor(v('ilai')), false);
  assert.equal(canSetEditor({ me: 'irit', scope: 'office', error: new Error('x') }), false);
  assert.equal(canSetEditor(null), false);
});

test('the name in the notes: only an editor the dialog offers for that shoot', () => {
  const dms = ['nadia', 'yariv', 'anna'];
  assert.equal(editorFromNotes('העורך: יריב', dms), 'yariv');
  assert.equal(editorFromNotes('משהו\nהעורך:אנה\nעוד', dms), 'anna');
  assert.equal(editorFromNotes('העורך: אנה כהן', dms), 'anna');
  assert.equal(editorFromNotes('העורך: ניראל', dms), null, 'Nirel only for Natali');
  assert.equal(editorFromNotes('העורך: ניראל', [...dms, 'nirel']), 'nirel');
  assert.equal(editorFromNotes('העורך: דני', dms), null);
  assert.equal(editorFromNotes('', dms), null);
  assert.equal(editorFromNotes(null, dms), null);
});

test('the block: a client in landing at editing, 22א ready and not really marked; the dialog\'s editors', () => {
  const c = client();
  const [slot, ...more] = editorSlots(c, imported(), {}, NOW);
  assert.deepEqual(more, []);
  assert.deepEqual(slot, { n: null, pre: '', procId: 'p22a', editors: ['nadia', 'yariv', 'anna'], editor: null, notes: 'yariv' });
  assert.deepEqual(editorSlots(client({ shoot_type: 'natali' }), imported(), {}, NOW)[0].editors, ['nadia', 'yariv', 'anna', 'nirel']);
  // Not in landing, not at editing yet, or already really assigned: no block.
  assert.deepEqual(editorSlots(client({ landing: false, landed_at: IMPORTED }), imported(), {}, NOW), []);
  const early = Object.fromEntries(importKeys('char').map((k) => [k, { state: 'done', note: IMPORT_NOTE, at: IMPORTED }]));
  assert.deepEqual(editorSlots(client({ shoot_at: null }), early, {}, NOW), []);
  assert.deepEqual(editorSlots(client(), { ...imported(), 'p22a.assigned': { state: 'done', at: IMPORTED } }, {}, NOW), []);
  // A shoot round of Natali's: its own slot, its own keys and list.
  const r = client({ rounds: [{ n: 2, shoot_type: 'natali', shoot_at: '2026-10-08T06:00:00Z', editor: null }] });
  const rk = { ...imported(), 'p22a.assigned': { state: 'done', note: IMPORT_NOTE, at: IMPORTED }, 'p22a.load': { state: 'done', note: IMPORT_NOTE, at: IMPORTED },
    ...Object.fromEntries(clientState(r, imported(), NOW).states.find((s) => s.proc.id === 'r2-p19').proc.items.map((i) => [i.key, { state: 'done', note: IMPORT_NOTE, at: IMPORTED }])) };
  const rs = editorSlots(r, rk, {}, NOW);
  assert.deepEqual(rs.map((s) => [s.n, s.pre, s.procId, s.editors.includes('nirel')]), [[2, 'r2.', 'r2-p22a', true]]);
  assert.equal(editorSlots({ ...r, rounds: [{ ...r.rounds[0], editor: 'nirel' }] }, rk, setMarks('done', 'r2.'), NOW)[0].editor, 'nirel');
});

test('set: Ofir is no longer offered the client, the load counts it, the editor has it on her screen; cleared, all back', () => {
  const other = client({ id: 'c2', name: 'רון', business: 'מוסך רון', notes: null });
  const checksBy = { c1: imported(), c2: imported() };
  // Before: both wait for Ofir, and the suggestion is the same for both (nobody has load).
  const before = qaView([client(), other], checksBy, {});
  assert.deepEqual(before.waiting.map((a) => a.client.id).sort(), ['c1', 'c2']);
  const sugOf = (view, c) => suggestAssignment({ client: c, shootType: 'dms', load: view.load, checks: view.checks[c.id], now: NOW }).editor;
  assert.equal(sugOf(before, other), 'nadia');
  // Irit records Nadia on c1 (the RPC: the answers and the editor).
  const set = client({ editor: 'nadia' });
  const after = qaView([set, other], checksBy, { c1: setMarks() });
  assert.deepEqual(after.waiting.map((a) => a.client.id), ['c2'], 'c1 is not offered for assignment');
  assert.deepEqual(after.load.nadia.jobs.map((j) => [j.client.id, j.landing]), [['c1', true]]);
  assert.equal(sugOf(after, other), 'yariv', 'Nadia has a client now: the suggestion moves on');
  assert.deepEqual(editorSlots(set, imported(), setMarks(), NOW)[0].editor, 'nadia');
  // Her screen (editor.html): the job, with no day counted while in landing.
  const jobs = editingCases(set, after.checks.c1, 'nadia', after.stateOf(set));
  assert.deepEqual(jobs.map((j) => [j.client.id, j.assignedAt]), [['c1', null]]);
  assert.deepEqual(editingCases(set, after.checks.c1, 'anna', after.stateOf(set)), []);
  // The real checks are untouched: only the screens' view has the answers.
  assert.equal(checksBy.c1['p22a.assigned'], undefined);
  // She now has items to go over there (the editing's), so the client waits for her too.
  assert.ok(intakeItems('nadia', set, imported(), setMarks(), NOW).length > 0);
  assert.ok(waitingPeople(set, imported(), setMarks(), {}, NOW).includes('nadia'));
  // Cleared ("עוד לא ידוע"): the answers are open, the editor is gone. Back to waiting.
  const cleared = qaView([client(), other], checksBy, { c1: setMarks('open') });
  assert.deepEqual(cleared.waiting.map((a) => a.client.id).sort(), ['c1', 'c2']);
  assert.equal(cleared.load.nadia.jobs.length, 0);
  assert.equal(editorSlots(client(), imported(), setMarks('open'), NOW)[0].editor, null);
  assert.deepEqual(editingCases(client(), cleared.checks.c1, 'nadia', cleared.stateOf(client())), []);
  // An answer of another kind is not taken in by Ofir's view: only 22א's.
  const other2 = withLandingEditors([client()], { c1: imported() }, { c1: { 'p23.made': { choice: 'done', at: IMPORTED } } });
  assert.equal(other2.c1['p23.made'], undefined);
});

const STAFF = [
  { email: 'owner@x', person: null }, { email: 'irit@x', person: 'irit' }, { email: 'lior@x', person: 'lior' }, { email: 'ofir@x', person: 'ofir' },
  { email: 'ilai@x', person: 'ilai' }, { email: 'nadia@x', person: 'nadia' }, { email: 'yariv@x', person: 'yariv' }, { email: 'anna@x', person: 'anna' }, { email: 'eli@x', person: 'eli' },
];

test('activated: the 22א set this way is imported history; no ring and no editing ladder for the editor, then or later', () => {
  const ACT = new Date('2026-10-18T07:00:00Z'); // Sunday 18.10, 10:00 in Israel: the activation
  const c = client({ editor: 'nadia', landing: false, landed_at: ACT.toISOString(), landing_slot: 0 });
  // private.landing_release: the answers become protocol marks with the note 'ייבוא', stamped then.
  const rows = [...Object.entries(imported()), ...Object.keys(setMarks()).map((k) => [k, { state: 'done', note: IMPORT_NOTE, at: ACT.toISOString(), by_email: 'owner@x' }])]
    .map(([item_key, x]) => ({ client_id: c.id, item_key, ...x }));
  const checks = Object.fromEntries(rows.map((r) => [r.item_key, r]));
  const s = clientState(c, checks, ACT);
  assert.equal(s.states.find((x) => x.proc.id === 'p22a').complete, true);
  assert.deepEqual(awaitingEditor({ clients: [c], stateOf: () => s, checks: { c1: checks } }), []);
  assert.deepEqual(fastCases({ clients: [c], stateOf: (x) => clientState(x, checks, ACT), checksOf: () => checks }), []);
  const editing = RULES.find((r) => r.id === 'editing');
  for (const at of [ACT, new Date(ACT.getTime() + 60e3), new Date(ACT.getTime() + 3 * 3600e3), new Date('2026-10-21T13:00:00Z')]) {
    const env = buildEnv({ clients: [c], checks: rows, staff: STAFF, now: at });
    assert.deepEqual(editing.instances(env), [], `the rule "editing" sees no assignment at ${at.toISOString()}`);
    const got = computeReminders({ clients: [c], checks: rows, staff: STAFF, now: at, log: [] });
    assert.deepEqual(got.filter((r) => r.rule === 'editing' || r.rule === 'fast'), [], at.toISOString());
    assert.ok(!got.some((r) => /לקוח חדש בעריכה/.test(r.title)), at.toISOString());
  }
  // In the first hours nothing at all goes to her: her open work has a fresh deadline.
  for (const at of [ACT, new Date(ACT.getTime() + 3 * 3600e3)]) {
    assert.deepEqual(computeReminders({ clients: [c], checks: rows, staff: STAFF, now: at, log: [] }).filter((r) => r.person === 'nadia').map((r) => `${r.rule}:${r.step}`), [], at.toISOString());
  }
  // For contrast: the same client assigned by Ofir now (not imported) rings her at once.
  const real = rows.map((r) => (r.item_key === 'p22a.assigned' ? { ...r, note: null } : r));
  assert.ok(computeReminders({ clients: [c], checks: real, staff: STAFF, now: ACT, log: [] }).some((r) => r.rule === 'editing' && r.step === 'assigned' && r.person === 'nadia'));
});
