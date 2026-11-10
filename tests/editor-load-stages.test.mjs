// The editors' load by stage (the owner, 10.11.2026; docs/ops.md, section 125): "בעריכה" is only
// what the editor still edits (assigned, not handed to Ofir yet); the fixes (Ofir's return, or the
// client's notes) count again as "בתיקונים"; what is finished and waits for Ofir or the client is
// apart ("ממתינים ללקוח") and never in the load the suggestion reads; once Irit marked "הלקוח אישר
// את הסרטונים" (p27.approved) the job left the editor: not in the load, not on the editor's page,
// and p27.fixes / p27.final are no longer asked of the editor (`passedIf`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROCESSES } from '../app/protocol.js';
import { clientState, openItemsFor, finalsMark } from '../app/protocol-logic.js';
import { editorLoad, jobStage, loadText, workText, waitingText, rankEditors, proposeEditor } from '../app/qa-logic.js';
import { editingCases, editorState } from '../app/production.js';
import { returnKey, returnNote, fixedKey } from '../app/office-marks.js';
import { ilaiWork } from '../app/ilai-logic.js';

const NOW = new Date('2026-11-10T11:00:00+02:00');
const ASSIGNED = '2026-11-03T10:00:00+02:00';
const done = (at, note = null) => ({ state: 'done', at, note, by_email: 'x@astrateg.test' });
let seq = 0;
const client = (o = {}) => ({
  id: `c-${++seq}`, name: `לקוח ${seq}`, status: 'active', deal_at: '2026-10-13T09:00:00+03:00', char_at: '2026-10-19T10:00:00+03:00',
  characterizer: 'ofir', has_logo: true, shoot_type: 'dms', shoot_at: '2026-11-02T10:00:00+02:00', contract_end: '2027-10-01',
  editor: 'yariv', editor2: null, rounds: [], protocol_version: 13, ...o,
});
// Everything before the editing is done; the editor assigned (22א) on ASSIGNED.
const BEFORE = PROCESSES.filter((p) => !['p22', 'p23', 'p23b', 'p24', 'p25', 'p26', 'p27', 'p28', 'p29', 'p29b', 'p30', 'p31', 'p32', 'p33', 'p34', 'p35'].includes(p.id) && !p.round)
  .flatMap((p) => p.items.map((i) => i.key));
const assigned = (pre = '') => ({ [`${pre}p22a.load`]: done(ASSIGNED), [`${pre}p22a.assigned`]: done(ASSIGNED), [`${pre}p22.received`]: done(ASSIGNED) });
const base = () => ({ ...Object.fromEntries(BEFORE.map((k) => [k, done('2026-11-02T18:00:00+02:00')])), ...assigned() });
const handed = (pre = '') => ({ [`${pre}p22.edited`]: done('2026-11-05T12:00:00+02:00'), [`${pre}p24.drive`]: done('2026-11-05T12:00:00+02:00'), [`${pre}p24.notify`]: done('2026-11-05T12:00:00+02:00') });
const qaOk = (pre = '') => ({ [`${pre}p25.approved`]: done('2026-11-05T13:00:00+02:00') });
const sent = (pre = '') => ({ [`${pre}p26.sent`]: done('2026-11-05T13:30:00+02:00') });

function loadOf(clients, checks) {
  const stateOf = (c) => clientState(c, checks[c.id] || {}, NOW);
  return editorLoad({ clients, stateOf, checks, now: NOW });
}
const stagesOf = (l) => [l.jobs.map((j) => j.stage), l.waiting.map((j) => j.waitsFor)];

test('assigned and not handed to Ofir: "בעריכה", in the load', () => {
  const c = client();
  const load = loadOf([c], { [c.id]: base() });
  assert.deepEqual(stagesOf(load.yariv), [['editing'], []]);
  assert.equal(loadText(load.yariv), 'לקוח אחד בעריכה');
});

test('handed to Ofir ("עדכנתי את אופיר" or 24 complete), approved by him, sent to the client: waiting, not in the load', () => {
  const c = client();
  const w = (cs) => loadOf([c], { [c.id]: cs }).yariv;
  assert.deepEqual(stagesOf(w({ ...base(), ...handed() })), [[], ['ofir']]);
  assert.deepEqual(stagesOf(w({ ...base(), ...handed(), ...qaOk() })), [[], ['irit']]);
  assert.deepEqual(stagesOf(w({ ...base(), ...handed(), ...qaOk(), ...sent() })), [[], ['client']]);
  const l = w({ ...base(), ...handed(), ...qaOk(), ...sent() });
  assert.equal(loadText(l), 'אין לקוחות בעריכה · אחד ממתין ללקוח');
  assert.equal(l.waiting[0].paused, null);
});

test('Ofir returned the videos: "בתיקונים" (his), with the return\'s due; fixed and back with him: waiting again', () => {
  const c = client();
  const due = new Date('2026-11-10T18:00:00+02:00');
  const cs = { ...base(), ...handed(), [returnKey('', 'videos', 1)]: done('2026-11-05T14:00:00+02:00', returnNote([{ ref: '2', text: 'סאונד' }], due)) };
  const l = loadOf([c], { [c.id]: cs }).yariv;
  assert.deepEqual(stagesOf(l), [['fixes'], []]);
  assert.equal(l.jobs[0].fixesBy, 'ofir');
  assert.equal(+l.jobs[0].dueAt, +due);
  const back = loadOf([c], { [c.id]: { ...cs, [fixedKey('', 'videos', 1)]: done('2026-11-06T10:00:00+02:00') } }).yariv;
  assert.deepEqual(stagesOf(back), [[], ['ofir']]);
});

test('the client\'s notes: "בתיקונים" (the client\'s) until the fixes; then waiting for the client again', () => {
  const c = client();
  const notes = { ...base(), ...handed(), ...qaOk(), ...sent(), 'p27.notes': done('2026-11-06T10:00:00+02:00', 'לקצר את הפתיח') };
  let l = loadOf([c], { [c.id]: notes }).yariv;
  assert.deepEqual(stagesOf(l), [['fixes'], []]);
  assert.equal(l.jobs[0].fixesBy, 'client');
  assert.ok(l.jobs[0].dueAt, 'the fix has a due (27\'s, from the notes)');
  l = loadOf([c], { [c.id]: { ...notes, 'p27.fixes': done('2026-11-06T15:00:00+02:00') } }).yariv;
  assert.deepEqual(stagesOf(l), [[], ['client']]);
  l = loadOf([c], { [c.id]: { ...notes, 'p27.final': done('2026-11-06T15:00:00+02:00') } }).yariv;
  assert.deepEqual(stagesOf(l), [[], ['final']]);
});

test('the client approved (p27.approved): the job left the editor everywhere; 27 asks nothing of the editor', () => {
  // Approved with the client's fixes still open on the editor (3 such live clients on 10.11.2026).
  const c = client();
  const cs = { ...base(), ...handed(), ...qaOk(), ...sent(), 'p27.notes': done('2026-11-06T10:00:00+02:00', 'x'), 'p27.approved': done('2026-11-07T10:00:00+02:00') };
  const l = loadOf([c], { [c.id]: cs }).yariv;
  assert.deepEqual(stagesOf(l), [[], []]);
  const st = clientState(c, cs, NOW);
  assert.equal(jobStage(cs, '', { p24: st.states.find((s) => s.proc.id === 'p24'), p27: st.states.find((s) => s.proc.id === 'p27') }), null);
  // The editor's page and "המשימות שלי": closed.
  const [job] = editingCases(c, cs, 'yariv', st);
  assert.equal(editorState(job, cs).key, 'done');
  // No item of 27 in the editor's list; p27.fixes and p27.final are history.
  assert.deepEqual(openItemsFor('yariv', c, cs, st, NOW).filter((x) => x.proc.id === 'p27').map((x) => x.item.key), []);
  const p27 = st.states.find((s) => s.proc.id === 'p27');
  for (const k of ['p27.fixes', 'p27.final']) assert.ok(p27.proc.items.find((i) => i.key === k).optional, k);
  // Ilai's "קיבלתי" waits for the approval (not for p27.final), and Ilai sees the job.
  assert.deepEqual(p27.proc.items.find((i) => i.key === 'p27.toilai').requires, ['p27.approved']);
  assert.deepEqual(openItemsFor('ilai', c, cs, st, NOW).filter((x) => x.proc.id === 'p27').map((x) => x.item.key), ['p27.toilai']);
  assert.equal(finalsMark(cs, '').at, '2026-11-07T10:00:00+02:00');
  assert.equal(ilaiWork({ clients: [c], stateOf: () => st, checks: { [c.id]: cs }, now: NOW }).finals.length, 1);
  // Without the approval nothing changes: the editor still owes p27.final.
  const { 'p27.approved': _a, ...open } = cs;
  assert.ok(!clientState(c, open, NOW).states.find((s) => s.proc.id === 'p27').proc.items.find((i) => i.key === 'p27.final').optional);
  assert.equal(finalsMark(open, ''), null);
});

test('shoot rounds: each round on its own prefix; the client\'s approval of one round leaves the other', () => {
  const c = client({ rounds: [{ n: 2, shoot_type: 'dms', shoot_at: '2026-11-04T10:00:00+02:00', editor: 'anna', start_at: '2026-10-25T10:00:00+02:00' }] });
  const cs = { ...base(), ...handed(), ...qaOk(), ...sent(), 'p27.approved': done('2026-11-07T10:00:00+02:00'), ...assigned('r2.') };
  const load = loadOf([c], { [c.id]: cs });
  assert.deepEqual(stagesOf(load.yariv), [[], []]);
  assert.deepEqual(stagesOf(load.anna), [['editing'], []]);
  assert.equal(load.anna.jobs[0].pre, 'r2.');
  // Round 2 handed, then its client's notes: fixes on round 2 only.
  const cs2 = { ...cs, ...handed('r2.'), ...qaOk('r2.'), ...sent('r2.'), 'r2.p27.notes': done('2026-11-08T10:00:00+02:00', 'x') };
  assert.deepEqual(stagesOf(loadOf([c], { [c.id]: cs2 }).anna), [['fixes'], []]);
  const cs3 = { ...cs2, 'r2.p27.approved': done('2026-11-09T10:00:00+02:00') };
  assert.deepEqual(stagesOf(loadOf([c], { [c.id]: cs3 }).anna), [[], []]);
});

test('two editors: the same stage for each; the suggestion counts only editing and fixes', () => {
  const a = client({ editor: 'nadia', editor2: 'yariv' });
  const b = client({ editor: 'nadia' });
  const d = client({ editor: 'anna' });
  const e = client({ editor: 'anna' });
  const checks = {
    [a.id]: { ...base(), ...handed(), ...qaOk(), ...sent() }, // waiting, for both
    [b.id]: { ...base(), ...handed(), ...qaOk(), ...sent() }, // waiting
    [d.id]: base(), // editing
    [e.id]: { ...base(), ...handed(), ...qaOk(), ...sent(), 'p27.notes': done('2026-11-06T10:00:00+02:00', 'x') }, // fixes
  };
  const load = loadOf([a, b, d, e], checks);
  assert.deepEqual(stagesOf(load.nadia), [[], ['client', 'client']]);
  assert.deepEqual(stagesOf(load.yariv), [[], ['client']]);
  assert.equal(load.yariv.waiting[0].second, true);
  assert.deepEqual(load.anna.jobs.map((j) => j.stage).sort(), ['editing', 'fixes']);
  // Nadia holds two finished jobs and no editing: the least loaded (before 10.11.2026 she had 2).
  assert.equal(rankEditors(load, 'dms', [], NOW)[0].editor, 'nadia');
  assert.equal(proposeEditor(load, 'dms'), 'nadia');
  assert.equal(loadText(load.anna), 'לקוח אחד בעריכה · 1 בתיקונים');
  assert.equal(loadText(load.nadia), 'אין לקוחות בעריכה · 2 ממתינים ללקוח');
});

test('the words', () => {
  const j = (stage) => ({ stage });
  assert.equal(workText({ jobs: [] }), 'אין לקוחות בעריכה');
  assert.equal(workText({ jobs: [j('editing'), j('editing'), j('editing'), j('editing'), j('editing'), j('fixes'), j('fixes')] }), '5 לקוחות בעריכה · 2 בתיקונים');
  assert.equal(workText({ jobs: [j('fixes')] }), '1 בתיקונים');
  assert.equal(waitingText(0), null);
  assert.equal(waitingText(1), 'אחד ממתין ללקוח');
  assert.equal(waitingText(21), '21 ממתינים ללקוח');
});
