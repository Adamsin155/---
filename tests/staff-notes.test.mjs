// "הערה מיוחדת" for one employee (Lior and the owner, 9.11.2026; docs/ops.md, section 114):
// who writes, what is valid, what the person sees, and the one push of the rule `staffNote`
// (once per note, never twice, never after it was deleted; also outside the sending hours).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WRITERS, canWriteNotes, NOTE_PEOPLE, validateNote, NOTE_MAX, notesFor, notesByPerson, noteTitle, noteText, noteUrl, freshNote, PUSH_MAX,
} from '../app/staff-notes-logic.js';
import { computeReminders, planDelivery } from '../app/reminder-engine.js';
import { RULE_BY_ID, STAFF_NOTE } from '../app/reminder-rules.js';
import { TEAM_PEOPLE } from '../app/protocol.js';
import { dateIL } from '../app/tz.js';

const IL = (y, m, d, h = 0, mi = 0) => dateIL(y, m, d, h, mi, 0);
const MIN = 6e4;
const STAFF = [
  { email: 'owner@x', person: null }, { email: 'irit@x', person: 'irit' }, { email: 'lior@x', person: 'lior' }, { email: 'ofir@x', person: 'ofir' },
  { email: 'ilai@x', person: 'ilai' }, { email: 'nadia@x', person: 'nadia' }, { email: 'stav@x', person: 'stav' },
];
const world = (staffNotes = []) => ({ clients: [], checks: {}, tasks: [], access: [], reviews: [], statusNotes: [], messages: [], subscriptions: [], staff: STAFF, deals: [], approvals: [], staffNotes });
const note = (o = {}) => ({
  id: '22222222-2222-4222-8222-222222222222', person: 'ilai', body: 'לא לגעת בלקוח מסעדת בוכרה', created_by: 'lior',
  created_at: IL(2026, 11, 9, 10, 15).toISOString(), deleted_at: null, ...o,
});
const VIEW = {
  owner: { me: null, scope: 'office', error: null }, irit: { me: 'irit', scope: 'office', error: null }, lior: { me: 'lior', scope: 'office', error: null },
  ofir: { me: 'ofir', scope: 'office', error: null }, ilai: { me: 'ilai', scope: 'own', error: null }, nadia: { me: 'nadia', scope: 'own', error: null },
  stav: { me: 'stav', scope: 'sales', error: null }, unknown: { me: null, scope: 'own', error: new Error('x') }, legacy: { me: null, scope: 'own', error: null },
};
// Every minute from `from` to `to`, as the server's tick: the notes' rule only.
function run(w, from, to, log = new Set()) {
  const sent = [];
  for (let t = from.getTime(); t <= to.getTime(); t += MIN) {
    const now = new Date(t);
    for (const r of computeReminders({ ...w, now, log })) { log.add(r.key); if (r.rule === STAFF_NOTE) sent.push({ ...r, now }); }
  }
  return sent;
}

test('who writes: the owners, Irit, Lior and Ofir; nobody else', () => {
  assert.deepEqual(WRITERS, ['owner', 'irit', 'lior', 'ofir']);
  for (const k of ['owner', 'irit', 'lior', 'ofir']) assert.equal(canWriteNotes(VIEW[k]), true, k);
  for (const k of ['ilai', 'nadia', 'stav', 'unknown', 'legacy']) assert.equal(canWriteNotes(VIEW[k]), false, k);
  assert.equal(canWriteNotes(null), false);
});

test('to whom: everyone on the team, in its order (not the owners)', () => {
  assert.deepEqual(NOTE_PEOPLE().map((p) => p.key), TEAM_PEOPLE().map((p) => p.key));
  assert.ok(!NOTE_PEOPLE().some((p) => p.key === 'owner' || p.key === 'editor'));
});

test('a note needs a person on the team and a text of 1 to 1000 characters (trimmed)', () => {
  assert.deepEqual(validateNote({ person: 'ilai', body: '  לא לגעת בלקוח מסעדת בוכרה \n' }), { ok: true, errors: {}, row: { person: 'ilai', body: 'לא לגעת בלקוח מסעדת בוכרה' } });
  assert.equal(validateNote({ person: '', body: 'x' }).errors.person, 'בוחרים למי ההערה.');
  assert.equal(validateNote({ person: 'nobody', body: 'x' }).ok, false);
  assert.equal(validateNote({ person: 'owner', body: 'x' }).ok, false);
  assert.equal(validateNote({ person: 'ilai', body: '   ' }).errors.body, 'כותבים את ההערה.');
  assert.equal(validateNote({ person: 'ilai', body: 'א'.repeat(NOTE_MAX) }).ok, true);
  assert.equal(validateNote({ person: 'ilai', body: 'א'.repeat(NOTE_MAX + 1) }).errors.body, `עד ${NOTE_MAX} תווים.`);
});

test('the person sees their own live notes, the oldest first; the writers see them by person', () => {
  const rows = [
    note({ id: 'a', created_at: IL(2026, 11, 9, 11).toISOString(), body: 'שנייה' }),
    note({ id: 'b', created_at: IL(2026, 11, 9, 9).toISOString(), body: 'ראשונה' }),
    note({ id: 'c', deleted_at: IL(2026, 11, 9, 12).toISOString(), body: 'נמחקה' }),
    note({ id: 'd', person: 'nadia', body: 'לנדיה' }),
    note({ id: 'e', person: 'irit', body: 'לעירית', created_by: 'owner' }),
  ];
  assert.deepEqual(notesFor(rows, 'ilai').map((n) => n.id), ['b', 'a']);
  assert.deepEqual(notesFor(rows, 'nadia').map((n) => n.id), ['d']);
  assert.deepEqual(notesFor(rows, 'ofir'), []);
  assert.deepEqual(notesFor(rows, null), []);
  const groups = notesByPerson(rows);
  const order = TEAM_PEOPLE().map((p) => p.key);
  assert.deepEqual(groups.map((g) => g.person), ['irit', 'ilai', 'nadia'].sort((x, y) => order.indexOf(x) - order.indexOf(y)));
  assert.deepEqual(groups.find((g) => g.person === 'ilai').notes.map((n) => n.id), ['a', 'b'], 'newest first, the deleted one gone');
});

test('the push: the writer in the title, the note in the body (cut on one line), to the person\'s first screen', () => {
  assert.equal(noteTitle(note()), 'הערה מיוחדת מליאור');
  assert.equal(noteTitle(note({ created_by: 'owner' })), 'הערה מיוחדת מהבעלים');
  assert.equal(noteText('שורה\n  ושורה'), 'שורה ושורה');
  const long = noteText('א'.repeat(400));
  assert.equal(long.length, PUSH_MAX);
  assert.ok(long.endsWith('…'));
  assert.equal(noteUrl('ilai'), 'clients.html#mine');
  assert.equal(noteUrl('stav'), 'deal.html');
});

test('one ring per note, at once, to its person; never a second time', () => {
  const w = world([note()]);
  const sent = run(w, IL(2026, 11, 9, 10, 15), IL(2026, 11, 9, 18, 0));
  assert.equal(sent.length, 1);
  const [r] = sent;
  assert.equal(r.person, 'ilai');
  assert.equal(r.level, 'ring');
  assert.equal(+r.now, +IL(2026, 11, 9, 10, 15), 'the minute it was written');
  assert.equal(r.title, 'הערה מיוחדת מליאור');
  assert.equal(r.body, 'לא לגעת בלקוח מסעדת בוכרה');
  assert.equal(r.url, 'clients.html#mine');
  assert.equal(r.key, `${STAFF_NOTE}:-:22222222-2222-4222-8222-222222222222:now@ilai`);
  // To the phone now (planDelivery): a push.
  const [plan] = planDelivery({ reminders: [r], now: r.now });
  assert.deepEqual([plan.channel, plan.status], ['push', 'sent']);
});

test('two notes ring once each; a note to someone else rings only them', () => {
  const w = world([note(), note({ id: '33333333-3333-4333-8333-333333333333', person: 'nadia', body: 'לבדוק את הכתוביות' })]);
  const sent = run(w, IL(2026, 11, 9, 10, 15), IL(2026, 11, 9, 11, 0));
  assert.deepEqual(sent.map((r) => r.person).sort(), ['ilai', 'nadia']);
});

test('a note deleted before the tick never rings; one deleted after its ring does not ring again', () => {
  assert.deepEqual(run(world([note({ deleted_at: IL(2026, 11, 9, 10, 15).toISOString() })]), IL(2026, 11, 9, 10, 15), IL(2026, 11, 9, 12, 0)), []);
  const log = new Set();
  assert.equal(run(world([note()]), IL(2026, 11, 9, 10, 15), IL(2026, 11, 9, 10, 20), log).length, 1);
  assert.deepEqual(run(world([note({ deleted_at: IL(2026, 11, 9, 10, 30).toISOString() })]), IL(2026, 11, 9, 10, 30), IL(2026, 11, 9, 12, 0), log), []);
});

test('written in the evening or on Friday: pushed at once (the rule keeps its own hours)', () => {
  for (const at of [IL(2026, 11, 9, 21, 40), IL(2026, 11, 13, 11, 0)]) {
    const sent = run(world([note({ created_at: at.toISOString() })]), at, new Date(+at + 30 * MIN));
    assert.equal(sent.length, 1);
    const [plan] = planDelivery({ reminders: [sent[0]], now: sent[0].now });
    assert.deepEqual([plan.channel, plan.status], ['push', 'sent'], String(at));
  }
});

test('an old note (loaded after a long gap) does not ring: it is already on the person\'s screens', () => {
  const now = IL(2026, 11, 10, 10, 0);
  assert.equal(freshNote(note(), now), false);
  assert.deepEqual(computeReminders({ ...world([note()]), now, log: new Set() }).filter((r) => r.rule === STAFF_NOTE), []);
  assert.equal(freshNote(note({ created_at: new Date(+now + MIN).toISOString() }), now), false, 'not before it was written');
});

test('nobody outside the team is rung (an unknown person key)', () => {
  assert.deepEqual(run(world([note({ person: 'ghost' })]), IL(2026, 11, 9, 10, 15), IL(2026, 11, 9, 10, 20)), []);
  assert.ok(RULE_BY_ID.get(STAFF_NOTE));
});
