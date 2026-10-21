// Two editors on one client (the owner's request of 21.10.2026): `editor` stays the main
// one, `editor2` is the optional second (also in a shoot round). The second one owns the
// editing processes with the main one, finds the client on the editor's page, gets the
// same notices, may mark the fixes, and is offered a WhatsApp of their own; the names
// read "נדיה + יריב"; with one editor nothing changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { editorsOf, isEditorOf, editorNames, evenSplit, splitProblem, shareOf } from '../app/protocol.js';
import { clientState, roundContext } from '../app/protocol-logic.js';
import { editingCases } from '../app/production.js';
import { editorLoad } from '../app/qa-logic.js';
import { withEditor, swapEditor } from '../app/decisions-logic.js';
import { handoffsFor } from '../app/handoffs.js';
import { buildEnv, candidates, planHandover } from '../app/reminder-engine.js';
import { mayFix } from '../app/office-ui.js';
import { QA_KINDS } from '../app/office-marks.js';
import { assignedTo } from '../app/files-logic.js';
import { canTake } from '../app/landing-logic.js';
import { visibleTo } from '../app/calendar-feed.js';

const at = (s) => new Date(s);
const done = (when, note = null) => ({ state: 'done', at: when, note, by_email: 'x@astrateg.test' });
const client = (o = {}) => ({
  id: 'c-1', name: 'מספרת רון', status: 'active', deal_at: '2026-10-13T09:00:00+03:00', char_at: '2026-10-19T10:00:00+03:00',
  characterizer: 'ofir', has_logo: true, shoot_type: 'dms', shoot_at: '2026-10-28T10:00:00+02:00', contract_end: '2027-10-01',
  editor: 'nadia', editor2: 'yariv', rounds: [], protocol_version: 10, ...o,
});
const ASSIGNED = '2026-10-29T10:00:00+02:00';
const checksOf = () => ({ 'p19.all': done('2026-10-28T16:00:00+02:00'), 'p22a.load': done(ASSIGNED), 'p22a.assigned': done(ASSIGNED) });

test('the pair: the main editor first, no repeats, never the placeholder; the names', () => {
  assert.deepEqual(editorsOf(client()), ['nadia', 'yariv']);
  assert.deepEqual(editorsOf(client({ editor2: null })), ['nadia']);
  assert.deepEqual(editorsOf(client({ editor2: 'nadia' })), ['nadia']);
  assert.deepEqual(editorsOf(client({ editor: null, editor2: null })), []);
  assert.equal(editorNames(client()), 'נדיה + יריב');
  assert.equal(editorNames(client({ editor2: null })), 'נדיה');
  assert.ok(isEditorOf(client(), 'yariv'));
  assert.ok(!isEditorOf(client(), 'anna'));
  // A round has its own pair; the client's second editor is not the round's.
  const r = roundContext(client(), { n: 2, editor: 'anna', editor2: null });
  assert.deepEqual(editorsOf(r), ['anna']);
  assert.deepEqual(editorsOf(roundContext(client(), { n: 2, editor: 'anna', editor2: 'nirel' })), ['anna', 'nirel']);
});

test('both own the editing processes; the rest of the protocol is as with one editor', () => {
  const st = clientState(client(), checksOf(), at('2026-10-29T11:00:00+02:00'));
  for (const id of ['p22', 'p24', 'p27']) assert.deepEqual(st.states.find((s) => s.proc.id === id).proc.owners, ['nadia', 'yariv'], id);
  const one = clientState(client({ editor2: null }), checksOf(), at('2026-10-29T11:00:00+02:00'));
  assert.deepEqual(one.states.find((s) => s.proc.id === 'p22').proc.owners, ['nadia']);
});

test('the editor\'s page: the job is on the page of each; another editor has none', () => {
  const c = client();
  const st = clientState(c, checksOf(), at('2026-10-29T11:00:00+02:00'));
  for (const who of ['nadia', 'yariv']) assert.equal(editingCases(c, checksOf(), who, st).length, 1, who);
  assert.equal(editingCases(c, checksOf(), 'anna', st).length, 0);
  // Everything else that asks "is this client theirs" agrees.
  assert.ok(assignedTo(c, 'yariv'));
  assert.ok(!assignedTo(c, 'anna'));
  assert.ok(canTake('yariv', c));
  assert.ok(visibleTo('yariv', c));
  assert.ok(!visibleTo('anna', c));
});

test('the load: the job counts for each editor, with whom', () => {
  const c = client();
  const checks = { [c.id]: checksOf() };
  const load = editorLoad({ clients: [c], stateOf: (x) => clientState(x, checks[x.id], at('2026-10-29T11:00:00+02:00')), checks, now: at('2026-10-29T11:00:00+02:00') });
  assert.equal(load.nadia.jobs.length, 1);
  assert.equal(load.yariv.jobs.length, 1);
  assert.equal(load.anna.jobs.length, 0);
  assert.deepEqual([load.nadia.jobs[0].second, load.nadia.jobs[0].partner], [false, 'yariv']);
  assert.deepEqual([load.yariv.jobs[0].second, load.yariv.jobs[0].partner], [true, 'nadia']);
});

test('writing the pair: the second stays unless given; it is never the main one; a swap takes its own place', () => {
  assert.deepEqual(withEditor(client(), null, 'anna'), { editor: 'anna', editor2: 'yariv', editor_split: null });
  assert.deepEqual(withEditor(client(), null, 'yariv'), { editor: 'yariv', editor2: null, editor_split: null });
  assert.deepEqual(withEditor(client(), null, 'anna', null), { editor: 'anna', editor2: null, editor_split: null });
  assert.deepEqual(withEditor(client({ editor2: null }), null, 'nadia', 'anna', { nadia: 7, anna: 5 }), { editor: 'nadia', editor2: 'anna', editor_split: { nadia: 7, anna: 5 } });
  // The same pair kept (a note, a swap of nothing): its split stays.
  assert.deepEqual(withEditor(client({ editor_split: { nadia: 8, yariv: 4 } }), null, 'nadia'), { editor: 'nadia', editor2: 'yariv', editor_split: { nadia: 8, yariv: 4 } });
  // A row read before the column existed gets no editor2 at all, unless one is chosen.
  assert.deepEqual(withEditor({ editor: 'nadia' }, null, 'anna'), { editor: 'anna' });
  // A round.
  const r = client({ rounds: [{ n: 2, editor: 'anna', editor2: 'nirel' }] });
  assert.deepEqual(withEditor(r, 2, 'nadia').rounds, [{ n: 2, editor: 'nadia', editor2: 'nirel', editor_split: null }]);
  // Swapping the second editor keeps the main one; swapping the main one keeps the second.
  assert.deepEqual(swapEditor(client(), null, 'yariv', 'anna'), { editor: 'nadia', editor2: 'anna', editor_split: null });
  assert.deepEqual(swapEditor(client(), null, 'nadia', 'anna'), { editor: 'anna', editor2: 'yariv', editor_split: null });
  assert.deepEqual(swapEditor(r, 2, 'nirel', 'yariv').rounds, [{ n: 2, editor: 'anna', editor2: 'yariv', editor_split: null }]);
});

test('the WhatsApp after the assignment: one for each editor; none for a second that is not there', () => {
  const now = at('2026-10-29T10:05:00+02:00');
  const people = (c) => handoffsFor(c, checksOf(), 'p22a.assigned', { now }).map((o) => o.person);
  assert.deepEqual(people(client()), ['nadia', 'yariv']);
  assert.deepEqual(people(client({ editor2: null })), ['nadia']);
});

test('the notices: both editors hear "לקוח חדש בעריכה אצלך"; adding the second later tells the first nothing', () => {
  const c = client();
  const now = at('2026-10-29T10:01:00+02:00');
  const env = buildEnv({ clients: [c], checks: { [c.id]: checksOf() }, tasks: [], staff: [], now });
  const told = candidates(env).filter((r) => r.rule === 'editing' && r.step === 'assigned').map((r) => r.person).sort();
  assert.deepEqual(told, ['nadia', 'yariv']);
  // Nadia was told an hour ago (the log); Yariv is added now: he is told, she is not told "it passed on".
  const mine = candidates(env).filter((r) => r.rule === 'editing' && r.step === 'assigned' && r.person === 'yariv');
  const siblings = [{ id: 7, key: mine[0].key.replace('@yariv', '@nadia'), person: 'nadia' }];
  const plan = planHandover({ reminders: mine, siblings, now });
  assert.deepEqual(plan.map((r) => r.person), ['yariv']);
  // A real swap (Nadia off, Anna on) still tells Nadia.
  const swapped = client({ editor: 'anna', editor2: null });
  const env2 = buildEnv({ clients: [swapped], checks: { [c.id]: checksOf() }, tasks: [], staff: [], now });
  const anna = candidates(env2).filter((r) => r.rule === 'editing' && r.step === 'assigned');
  assert.deepEqual(planHandover({ reminders: anna, siblings, now }).map((r) => r.person), ['anna', 'nadia']);
});

test('the fixes Ofir returned: either editor may mark them', () => {
  const fixers = QA_KINDS.videos.fixers(client());
  assert.deepEqual(fixers, ['nadia', 'yariv']);
  assert.ok(mayFix(fixers, 'yariv', null));
  assert.ok(!mayFix(fixers, 'anna', null));
  assert.ok(mayFix('nadia', 'nadia', null), 'one fixer, as before');
  assert.ok(!mayFix(fixers, null, null));
});

test("the split of the videos: even by default (the main editor takes the odd one), adds up to the package; each editor's share", () => {
  assert.deepEqual(evenSplit(12, 'nadia', 'yariv'), { nadia: 6, yariv: 6 });
  assert.deepEqual(evenSplit(25, 'nadia', 'yariv'), { nadia: 13, yariv: 12 });
  assert.equal(evenSplit(0, 'nadia', 'yariv'), null);
  assert.equal(splitProblem({ nadia: 8, yariv: 4 }, 12, 'nadia', 'yariv'), null);
  assert.match(splitProblem({ nadia: 8, yariv: 5 }, 12, 'nadia', 'yariv'), /ביחד 13, ובחבילה 12/);
  assert.match(splitProblem({ nadia: 8, yariv: null }, 12, 'nadia', 'yariv'), /מספר שלם/);
  assert.match(splitProblem({ nadia: -1, yariv: 13 }, 12, 'nadia', 'yariv'), /מספר שלם/);
  assert.match(splitProblem(null, 12, 'nadia', 'yariv'), /מספר שלם/, 'with a count, the split is required');
  // No count in the package: optional, any whole numbers.
  assert.equal(splitProblem(null, 0, 'nadia', 'yariv'), null);
  assert.equal(splitProblem({ nadia: 3, yariv: 9 }, 0, 'nadia', 'yariv'), null);
  const c = client({ editor_split: { nadia: 8, yariv: 4 } });
  assert.deepEqual(shareOf(c, 'nadia'), { mine: 8, total: 12, other: 'yariv' });
  assert.deepEqual(shareOf(c, 'yariv'), { mine: 4, total: 12, other: 'nadia' });
  assert.equal(shareOf(c, 'anna'), null);
  assert.equal(shareOf(client({ editor2: null, editor_split: { nadia: 8 } }), 'nadia'), null, 'one editor: no share line');
  // A round keeps its own.
  assert.deepEqual(shareOf(roundContext(c, { n: 2, editor: 'anna', editor2: 'nirel', editor_split: { anna: 2, nirel: 1 } }), 'nirel'), { mine: 1, total: 3, other: 'anna' });
  assert.equal(shareOf(roundContext(c, { n: 2, editor: 'anna' }), 'nadia'), null);
});

test('how many scripts: the office\'s number beside the Google Docs link, else the system\'s count, else unknown', async () => {
  const { scriptsCountOf } = await import('../app/production.js');
  assert.equal(scriptsCountOf({ deliverables: { scripts: 12 } }, 3), 12);
  assert.equal(scriptsCountOf({ deliverables: { scripts: 0 } }, 3), 0);
  assert.equal(scriptsCountOf({ deliverables: {} }, 3), 3);
  assert.equal(scriptsCountOf({ deliverables: { videos: 10 } }, 0), null);
  assert.equal(scriptsCountOf({}), null);
});
