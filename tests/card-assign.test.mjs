// "שיוך עורך" from the client card (the owner, 29.10.2026; app/card-assign-logic.js):
//   - who sees the button: Ofir, Lior, Irit and the owners; nobody else, not on an error;
//   - which case: 'first' (22א open and its turn), 'record' (22א marked, no editor: the import),
//     'early' (22א's turn ahead), 'change' (an editor is written); none on a client not in work;
//   - the mark of a recorded editor keeps the clocks and says so.
// Runs under three time zones (npm test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { clientState, IMPORT_NOTE } from '../app/protocol-logic.js';
import { importKeys } from '../app/client-open.js';
import { canAssignFromCard, cardAssignMode, recordNote, CARD_ASSIGNERS } from '../app/card-assign-logic.js';
import { awaitingEditor } from '../app/qa-logic.js';
import { describeOfficeMark } from '../app/office-marks.js';

const IMPORTED = '2026-10-13T10:00:00Z';
const NOW = new Date('2026-10-14T08:00:00Z');
const v = (me, scope = 'office') => ({ me, scope, error: null });
const client = (over = {}) => ({
  id: 'c1', name: 'מאיה', business: 'סטודיו מאיה', status: 'active', shoot_type: 'dms', characterizer: 'ofir', has_logo: true,
  deal_at: '2026-06-01T07:00:00Z', char_at: '2026-06-10T08:00:00Z', shoot_at: '2026-10-05T06:00:00Z', contract_end: '2027-06-01',
  editor: null, rounds: [], deliverables: { videos: 12, graphics: 20, shoot_days: 1 }, protocol_version: 7,
  created_by_email: 'system', quote_id: null, created_at: IMPORTED, landing: false, landed_at: IMPORTED, ...over,
});
const marks = (station, extra = {}) => ({
  ...Object.fromEntries(importKeys(station, { shootSet: true }).map((k) => [k, { state: 'done', note: IMPORT_NOTE, at: IMPORTED, by_email: '' }])), ...extra,
});
const modeOf = (viewer, c, checks) => cardAssignMode({ viewer, client: c, checks, state: clientState(c, checks, NOW) });

test('who may assign from the card: Ofir, Lior, Irit and the owners', () => {
  assert.deepEqual(CARD_ASSIGNERS, ['ofir', 'lior', 'irit']);
  for (const who of ['ofir', 'lior', 'irit']) assert.equal(canAssignFromCard(v(who)), true, who);
  assert.equal(canAssignFromCard(v(null)), true, 'an owner');
  for (const who of ['ilai', 'nadia', 'yariv', 'anna', 'nirel', 'eli']) assert.equal(canAssignFromCard(v(who, 'own')), false, who);
  for (const who of ['stav', 'amos']) assert.equal(canAssignFromCard(v(who, 'sales')), false, who);
  assert.equal(canAssignFromCard(v('ilai')), false, 'office scope is not enough');
  assert.equal(canAssignFromCard(v(null, 'own')), false, 'no person outside the office');
  assert.equal(canAssignFromCard({ me: 'ofir', scope: 'office', error: new Error('x') }), false);
  assert.equal(canAssignFromCard(null), false);
});

test('the imported client: 22א marked by "system", no editor → "record" (the clocks stay); the same for every assigner', () => {
  // Imported at a later station (קליטה at publishing): everything before is marked, 22א included.
  const checks = marks('publish');
  assert.equal(checks['p22a.assigned']?.state, 'done');
  for (const who of ['ofir', 'lior', 'irit', null]) assert.equal(modeOf(v(who), client(), checks), 'record', String(who));
  for (const who of ['nadia', 'ilai']) assert.equal(modeOf(v(who, 'own'), client(), checks), null, who);
  // qa.html does not list it (22א is marked): the card is the only place to give it an editor.
  const c = client();
  assert.equal(awaitingEditor({ clients: [c], stateOf: (x) => clientState(x, checks, NOW), checks: { c1: checks } }).length, 0);
});

test('22א open and its turn came → "first", the same item qa.html offers', () => {
  const c = client();
  const checks = marks('post');
  assert.notEqual(checks['p22a.assigned']?.state, 'done');
  assert.equal(modeOf(v('ofir'), c, checks), 'first');
  assert.equal(modeOf(v('irit'), c, checks), 'first');
  const waiting = awaitingEditor({ clients: [c], stateOf: (x) => clientState(x, checks, NOW), checks: { c1: checks } });
  assert.deepEqual(waiting.map((a) => [a.client.id, a.n, a.pre]), [['c1', null, '']]);
});

test('before 22א\'s turn → "early"; an editor written → "change"; not in work → nothing', () => {
  const early = marks('char');
  assert.equal(modeOf(v('ofir'), client({ shoot_at: null }), early), 'early');
  assert.equal(modeOf(v('ofir'), client({ editor: 'nadia' }), marks('publish')), 'change');
  assert.equal(modeOf(v('lior'), client({ editor: 'nadia' }), marks('post')), 'change');
  for (const status of ['ended', 'cancelled', 'paused']) assert.equal(modeOf(v('ofir'), client({ status }), marks('publish')), null, status);
  assert.equal(modeOf(v('ofir'), client({ status: 'ending' }), marks('publish')), 'record');
  assert.equal(cardAssignMode({ viewer: v('ofir'), client: null, checks: {} }), null);
});

test('the mark of a recorded editor: the reason mark, the clocks unchanged, words for the history', () => {
  const n = JSON.parse(recordNote({ editor: 'nadia' }));
  assert.equal(n.editor, 'nadia');
  assert.equal(n.card, true);
  assert.equal(n.kept, true);
  assert.equal(n.from, null);
  assert.match(n.reason, /העורך נרשם מתוך תיק הלקוח: נדיה/);
  assert.match(n.reason, /המועדים לא השתנו/);
  const m = JSON.parse(recordNote({ editor: 'yariv', from: 'nadia', reason: '  עומס  ' }));
  assert.match(m.reason, /מנדיה ליריב · עומס · המועדים לא השתנו/);
  assert.equal(m.from, 'nadia');
  const words = describeOfficeMark('p22a.reason', 'done', recordNote({ editor: 'nadia' }));
  assert.match(words, /נדיה/);
  // Recording the editor alone leaves 22א's time, so the editing days are those of the import.
  const checks = marks('publish');
  const c = client({ editor: 'nadia' });
  const before = clientState(client(), checks, NOW).states.find((s) => s.proc.id === 'p22');
  const after = clientState(c, { ...checks, 'p22a.reason': { state: 'done', note: recordNote({ editor: 'nadia' }), at: NOW.toISOString() } }, NOW).states.find((s) => s.proc.id === 'p22');
  assert.equal(String(after.dueAt), String(before.dueAt));
});
