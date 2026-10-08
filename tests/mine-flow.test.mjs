// "המשימות שלי" shows everything that waits for a person, whichever page it is done on
// (docs/ops.md, section 46): the counted lines of app/mine-flow.js, against the office of
// tests/flow-world.mjs. Each queue with N waiting gives one line with the right number
// and the right page; an empty queue gives none; a line never leads to a page its reader
// may not open; a client in landing is counted apart, with no clock; and every line with
// a clock names a reminder rule that exists.
// Runs under three time zones (npm test): nothing here depends on the machine's zone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PEOPLE } from '../app/protocol.js';
import { clientState } from '../app/protocol-logic.js';
import { flowLines, flowNeeds, LANDING_WORDS } from '../app/mine-flow.js';
import { menuOf } from '../app/shell-rules.js';
import { RULE_BY_ID } from '../app/reminder-rules.js';
import { qaQueue, awaitingEditor } from '../app/qa-logic.js';
import { ofirMeetings } from '../app/office-marks.js';
import { pausedSinceYesterday } from '../app/decisions-logic.js';
import { NOW, flowWorld, COUNTS, cid } from './flow-world.mjs';

const OFFICE = ['irit', 'lior', 'ofir'];
const viewerOf = (me) => ({ me, scope: OFFICE.includes(me) ? 'office' : 'own', error: null });
const TEAM = Object.keys(PEOPLE).filter((p) => p !== 'editor' && !PEOPLE[p].sales);

// The inputs of the home screen for one person, from the rows of a world.
function inputs(db, me, { now = NOW, extra = null } = {}) {
  const checks = {};
  for (const r of db.protocol_checks) (checks[r.client_id] ||= {})[r.item_key] = r;
  const states = new Map();
  const stateOf = (c) => states.get(c.id) || states.set(c.id, clientState(c, checks[c.id] || {}, now)).get(c.id);
  const all = { access: db.client_access, requests: db.change_requests, messages: db.client_messages, availability: { months: db.photographer_months }, liorShoot: false };
  const asked = Object.fromEntries(flowNeeds(viewerOf(me), now).map((k) => [k, all[k]]));
  return { viewer: viewerOf(me), clients: db.clients, checks, stateOf, tasks: db.client_tasks.filter((t) => !t.done_at), reviews: db.office_reviews, extra: { ...asked, ...extra }, now };
}
const linesOf = (db, me, opts) => flowLines(inputs(db, me, opts));
const byId = (lines) => Object.fromEntries(lines.map((l) => [l.id, l]));

test('each queue with work gives one counted line, in its group, to its page', () => {
  const db = flowWorld();
  const ofir = byId(linesOf(db, 'ofir'));
  assert.deepEqual(Object.keys(ofir).sort(), ['landing-assign', 'landing-qa']);
  assert.equal(ofir['landing-assign'].n, COUNTS.assign.landing);
  assert.equal(ofir['landing-assign'].text, `3 לקוחות מחכים לשיוך עורך · ${LANDING_WORDS}`);
  assert.equal(ofir['landing-assign'].href, 'qa.html#assign-h');
  assert.equal(ofir['landing-qa'].n, COUNTS.qa.landing);
  assert.equal(ofir['landing-qa'].href, 'qa.html#qa-h');

  const lior = byId(linesOf(db, 'lior'));
  assert.deepEqual(Object.keys(lior).sort(), ['access', 'availability-missing', 'campaigns', 'changes', 'landing-assign', 'landing-shoot', 'paused', 'urgent-back']);
  assert.deepEqual([lior['urgent-back'].n, lior['urgent-back'].bucket, lior['urgent-back'].href], [COUNTS.urgentBack, 'urgent', 'decisions.html#ur-h']);
  assert.deepEqual([lior.paused.n, lior.paused.bucket, lior.paused.href], [COUNTS.paused, 'today', 'decisions.html#pz-h']);
  assert.deepEqual([lior.access.n, lior.access.href], [COUNTS.broken, 'decisions.html#ac-h']);
  assert.deepEqual([lior.changes.n, lior.changes.href], [COUNTS.changes, 'decisions.html#cq-h']);
  assert.deepEqual([lior.campaigns.n, lior.campaigns.bucket, lior.campaigns.href], [1, 'today', 'decisions.html#cp-h']); // Tuesday: today
  assert.deepEqual([lior['availability-missing'].bucket, lior['availability-missing'].href], ['overdue', 'prep.html#availability']);
  assert.equal(lior['availability-missing'].text, 'אלי עוד לא מסר זמינות לנובמבר');
  assert.equal(lior['landing-shoot'].href, 'shoot.html');

  const irit = byId(linesOf(db, 'irit'));
  assert.deepEqual(Object.keys(irit).sort(), ['availability-missing', 'landing-shoot', 'messages']);
  assert.equal(irit.messages.n, COUNTS.messages.clock);
  assert.equal(irit.messages.text, `22 לקוחות עוד לא קיבלו הודעה היום (ועוד ${COUNTS.messages.landing} בקליטה)`);
  assert.deepEqual([irit.messages.bucket, irit.messages.href], ['today', 'messages.html']);
  assert.deepEqual([irit['landing-shoot'].n, irit['landing-shoot'].href], [COUNTS.shootSoon.landing, 'prep.html']);

  // The editors: what Ofir returned is theirs now; an editing in landing has no clock.
  const anna = byId(linesOf(db, 'anna'));
  assert.deepEqual(Object.keys(anna), ['fixes']);
  assert.deepEqual([anna.fixes.n, anna.fixes.bucket, anna.fixes.href], [1, 'today', `editor.html#c-${cid(16)}`]);
  const yariv = byId(linesOf(db, 'yariv'));
  assert.deepEqual(Object.keys(yariv), ['landing-editing']);
  assert.deepEqual([yariv['landing-editing'].n, yariv['landing-editing'].href], [COUNTS.editing.landing, 'editor.html']);
  assert.equal(yariv['landing-editing'].text, `לקוח אחד בעריכה אצלך · ${LANDING_WORDS}`);

  const eli = byId(linesOf(db, 'eli'));
  assert.deepEqual(Object.keys(eli), ['availability']);
  assert.deepEqual([eli.availability.bucket, eli.availability.href], ['overdue', 'shoot.html#availability']); // the 20th: after the 15th

  // Nothing of theirs is worked on another page without being an item of the list.
  for (const me of ['ilai', 'nadia', 'nirel']) assert.deepEqual(linesOf(db, me), [], me);
});

test('the numbers are the numbers of the pages themselves', () => {
  const db = flowWorld();
  const x = inputs(db, 'ofir');
  const live = db.clients.filter((c) => c.status === 'active' || c.status === 'ending');
  const queue = qaQueue({ clients: live, stateOf: x.stateOf, checks: x.checks, meetings: ofirMeetings(live, (c) => x.checks[c.id] || {}), now: NOW });
  const waiting = awaitingEditor({ clients: live, stateOf: x.stateOf, checks: x.checks });
  assert.equal(queue.length, COUNTS.qa.clock + COUNTS.qa.landing);
  assert.equal(queue.filter((q) => q.landing).length, byId(linesOf(db, 'ofir'))['landing-qa'].n);
  assert.equal(waiting.length, COUNTS.assign.clock + COUNTS.assign.landing);
  assert.equal(waiting.filter((a) => a.client.landing).length, byId(linesOf(db, 'ofir'))['landing-assign'].n);
  assert.equal(pausedSinceYesterday({ clients: live, stateOf: x.stateOf, checks: x.checks, now: NOW }).length, byId(linesOf(db, 'lior')).paused.n);
});

test('an empty queue gives no line', () => {
  const db = flowWorld({ landing: false, queues: false });
  // The day's messages went out, the campaigns were checked, the month was handed in.
  db.client_messages = db.clients.map((c) => ({ client_id: c.id, kind: 'daily', sent_at: '2026-10-20T09:00:00+03:00' }));
  db.office_reviews = [{ day: '2026-10-20', kind: 'campaigns', by_email: 'lior@astrateg.test', at: '2026-10-20T09:00:00+03:00' }];
  db.photographer_months = [{ person: 'eli', month: '2026-11-01' }];
  for (const me of TEAM) assert.deepEqual(linesOf(db, me), [], me);
  // And each one alone comes back when its own queue fills again.
  db.client_messages.shift();
  assert.deepEqual(linesOf(db, 'irit').map((l) => [l.id, l.n, l.text]), [['messages', 1, 'לקוח אחד עוד לא קיבל הודעה היום']]);
  db.office_reviews = [];
  assert.deepEqual(linesOf(db, 'lior').map((l) => l.id), ['campaigns']);
  assert.deepEqual(linesOf(db, 'lior', { now: new Date('2026-10-21T10:00:00+03:00') }).map((l) => [l.id, l.bucket]), [['campaigns', 'overdue']]); // Wednesday: late
});

test('rows that could not be read give no line, and nothing breaks', () => {
  const db = flowWorld();
  const none = { access: null, requests: null, messages: null, availability: null, liorShoot: null };
  assert.deepEqual(linesOf(db, 'lior', { extra: none }).map((l) => l.id).sort(), ['landing-assign', 'landing-shoot', 'paused', 'urgent-back', 'campaigns'].sort());
  assert.deepEqual(flowLines({ ...inputs(db, 'lior', { extra: none }), reviews: null }).map((l) => l.id).sort(), ['landing-assign', 'landing-shoot', 'paused', 'urgent-back'].sort());
  assert.deepEqual(linesOf(db, 'irit', { extra: none }).map((l) => l.id), ['landing-shoot']);
  assert.deepEqual(linesOf(db, 'eli', { extra: none }), []);
  // The owners, a field agent and somebody the app could not identify: no lines.
  assert.deepEqual(flowLines({ ...inputs(db, 'ofir'), viewer: { me: null, scope: 'office', error: null } }), []);
  assert.deepEqual(flowLines({ ...inputs(db, 'ofir'), viewer: { me: 'stav', scope: 'own', error: null } }), []);
  assert.deepEqual(flowLines({ ...inputs(db, 'ofir'), viewer: { me: 'ofir', scope: 'office', error: new Error('x') } }), []);
});

test('a login marked broken in the card comes with Lior\'s task: it is a card of the list, not counted twice', () => {
  const db = flowWorld();
  db.client_tasks.push({ id: 't-access', client_id: cid(17), title: 'לשחזר עם הלקוח את הגישה ל־Instagram ולהכניס לכספת', owner: 'lior', due_on: null, done_at: null, created_at: '2026-10-19T14:00:00+03:00', urgent: false, source: null });
  assert.equal(byId(linesOf(db, 'lior')).access, undefined);
});

test('Lior on a shoot day: the exceptions pass to Ofir, and his list says so', () => {
  const db = flowWorld();
  assert.equal(byId(linesOf(db, 'ofir')).exceptions, undefined);
  const line = byId(linesOf(db, 'ofir', { extra: { liorShoot: true } })).exceptions;
  assert.deepEqual([line.n, line.bucket, line.href, line.text], [1, 'escalation', 'decisions.html#ex-h', 'ליאור ביום צילום: חריגה אחת עוברת אליך']);
});

test('the photographer is asked for next month by its phase', () => {
  const db = flowWorld({ landing: false, queues: false });
  const at = (day) => byId(linesOf(db, 'eli', { now: new Date(`2026-10-${day}T10:00:00+03:00`) })).availability?.bucket;
  assert.equal(at('05'), 'later');
  assert.equal(at('12'), 'week');
  assert.equal(at('14'), 'tomorrow');
  assert.equal(at('15'), 'today');
  assert.equal(at('16'), 'overdue');
  // The managers hear of it from the 16th only.
  assert.equal(byId(linesOf(db, 'irit', { now: new Date('2026-10-15T10:00:00+03:00') }))['availability-missing'], undefined);
  assert.deepEqual(flowNeeds(viewerOf('irit'), new Date('2026-10-15T10:00:00+03:00')), ['messages']);
  assert.deepEqual(flowNeeds(viewerOf('irit'), NOW), ['messages', 'availability']);
});

test('a line never leads to a page its reader may not open, and each has one plain sentence', () => {
  const db = flowWorld();
  for (const me of TEAM) {
    const pages = new Set(menuOf(viewerOf(me)).map((it) => it.href.split('#')[0]));
    for (const l of linesOf(db, me, { extra: { liorShoot: true } })) {
      assert.ok(pages.has(l.href.split('#')[0]), `${me}: ${l.id} leads to ${l.href}`);
      assert.ok(l.n > 0 && l.text && l.cta, `${me}: ${l.id}`);
      assert.ok(l.text.length <= 70, `${me}: ${l.id} is long: ${l.text}`);
    }
  }
});

test('landing means no clock: its lines say so, sit apart, and name no reminder; every other line names a rule that exists', () => {
  const db = flowWorld();
  const seen = new Set();
  for (const me of TEAM) {
    for (const l of linesOf(db, me, { extra: { liorShoot: true } })) {
      seen.add(l.id);
      if (l.bucket === 'landing') {
        assert.ok(l.id.startsWith('landing-') && l.text.endsWith(LANDING_WORDS), `${me}: ${l.id}`);
        assert.equal(l.rule, null, `${me}: ${l.id}`);
      } else {
        assert.ok(!l.text.includes(LANDING_WORDS), `${me}: ${l.id}`);
        assert.ok(RULE_BY_ID.has(l.rule), `${me}: ${l.id} names the rule ${l.rule}`);
      }
    }
  }
  assert.deepEqual([...seen].sort(), ['access', 'availability', 'availability-missing', 'campaigns', 'changes', 'exceptions', 'fixes', 'landing-assign', 'landing-editing',
    'landing-qa', 'landing-shoot', 'messages', 'paused', 'urgent-back']);
  // A paused editing of a client in landing is counted apart from the ones with a clock.
  db.clients.find((c) => c.id === cid(14)).landing = true;
  const lior = byId(linesOf(db, 'lior'));
  assert.equal(lior.paused, undefined);
  assert.equal(lior['landing-paused'].text, `עריכה אחת עצורה ומחכה להחלטה שלך · ${LANDING_WORDS}`);
  // When every open client is in landing, the day's messages are one quiet line.
  for (const c of db.clients) c.landing = true;
  const irit = byId(linesOf(db, 'irit'));
  assert.equal(irit.messages, undefined);
  assert.equal(irit['landing-messages'].bucket, 'landing');
});
