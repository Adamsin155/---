// Two places where a client was silently lost (docs/ops.md, section 47; found by the
// full-flow simulation, docs/design/full-flow/report.md, findings 1.1, 1.2 and 3.1):
//   A. process 3 could be ticked with no meeting date, and then nobody had anything;
//   B. a contract that was sent and not signed was on nobody's list and never nagged.
// Fixed Israel times; npm test runs this under UTC, New York and Jerusalem.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeReminders, personWork, buildEnv } from '../app/reminder-engine.js';
import { RULE_BY_ID, MEETING_DATE } from '../app/reminder-rules.js';
import { PROCESSES } from '../app/protocol.js';
import { clientState, openItemsFor, fieldGap, IMPORT_NOTE } from '../app/protocol-logic.js';
import { importKeys } from '../app/client-open.js';
import { flowLines, flowNeeds } from '../app/mine-flow.js';
import { controlTopics } from '../app/control-topics.js';
import { menuOf } from '../app/shell-rules.js';
import {
  UNSIGNED, UNSIGNED_URL, waitsForSignature, expiredUnsigned, sentForSignatureAt, unsignedList, unsignedLine, unsignedTimes,
} from '../app/unsigned-logic.js';
import { dateIL, partsIL } from '../app/tz.js';

const IL = (y, m, d, h = 0, mi = 0) => dateIL(y, m, d, h, mi);
const hhmm = (d) => { const p = partsIL(d); return `${p.day}.${p.month} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`; };
const STAFF = [
  { email: 'owner@x', person: null }, { email: 'irit@x', person: 'irit' }, { email: 'lior@x', person: 'lior' },
  { email: 'ofir@x', person: 'ofir' }, { email: 'ilai@x', person: 'ilai' }, { email: 'stav@x', person: 'stav' }, { email: 'amos@x', person: 'amos' },
];
let seq = 0;
const world = () => ({ clients: [], checks: {}, tasks: [], access: [], reviews: [], statusNotes: [], messages: [], subscriptions: [], staff: STAFF, deals: [], approvals: [], unsigned: [] });
// A client the signing trigger just opened: Sunday 11.10.2026 09:36, no meeting date.
const SIGNED = IL(2026, 10, 11, 9, 36);
function client(w, o = {}) {
  seq += 1;
  const c = {
    id: `s${seq}`, name: 'רונית דקל', business: 'מאפיית הדקל', status: 'active', shoot_type: 'dms', characterizer: 'ofir', char_at: null, has_logo: true,
    rounds: [], contract_end: '2027-10-11', deal_at: SIGNED.toISOString(), created_by_email: 'system', landing: false, landed_at: null, ...o,
  };
  w.clients.push(c);
  return c;
}
const mark = (w, c, key, at, note = null, state = 'done') => { (w.checks[c.id] ||= {})[key] = { client_id: c.id, item_key: key, state, note, at: at.toISOString(), by_email: 'irit@x' }; };
const marks = (w, c, keys, at, note = null) => keys.forEach((k) => mark(w, c, k, at, note));
const itemsOf = (id) => PROCESSES.find((p) => p.id === id).items.filter((i) => !i.optional).map((i) => i.key);
const due = (w, now, log = []) => computeReminders({ ...w, now, log });
const of = (list, rule, step = null, person = null) => list.filter((r) => r.rule === rule && (!step || r.step === step) && (!person || r.person === person));
const p03 = (w, c, now) => clientState(c, w.checks[c.id] || {}, now).states.find((s) => s.proc.id === 'p03');
const mine = (w, c, person, now) => openItemsFor(person, c, w.checks[c.id] || {}, clientState(c, w.checks[c.id] || {}, now), now).filter((e) => e.proc.id === 'p03');
// What the experiment did: the deal's items, the group, and the three items of 3 the list showed.
function tickedWithoutDate(w, c) {
  marks(w, c, itemsOf('p01'), SIGNED);
  marks(w, c, itemsOf('p02'), IL(2026, 10, 11, 9, 39));
  marks(w, c, ['p03.who', 'p03.available', 'p03.calendar'], IL(2026, 10, 11, 9, 40));
}

// ── A. Process 3 and the meeting date ───────

test('A: process 3 ticked without a meeting date stays open, late, and on Irit\'s list with what is missing', () => {
  const w = world();
  const c = client(w);
  tickedWithoutDate(w, c);
  const two = IL(2026, 10, 13, 12);
  const s = p03(w, c, two);
  assert.equal(s.complete, false);
  assert.deepEqual(s.gap.fields, ['char_at']);
  assert.equal(s.status, 'overdue');
  const entries = mine(w, c, 'irit', two);
  assert.deepEqual(entries.map((e) => [e.item.key, e.fields]), [['p03.scheduled', ['char_at']]]);
  assert.deepEqual(mine(w, c, 'ofir', two), [], 'not Ofir\'s work');
  // Her morning digest lists it with what is late (the same list the server reads).
  const env = buildEnv({ ...w, now: two });
  assert.ok(personWork(env, 'irit').overdue.some((x) => x.what === 'קביעת פגישת אפיון'));
  // Nobody was chosen either (the column's default is Ofir; an old row may have none): both are asked.
  c.characterizer = null;
  assert.deepEqual(p03(w, c, two).gap.fields, ['characterizer', 'char_at']);
});

test('A: a tick is not a date: "the meeting was set" marked with no date keeps the process open; the date closes it', () => {
  const w = world();
  const c = client(w);
  tickedWithoutDate(w, c);
  mark(w, c, 'p03.scheduled', IL(2026, 10, 11, 9, 41));
  const now = IL(2026, 10, 12, 11);
  assert.equal(p03(w, c, now).complete, false);
  assert.equal(p03(w, c, now).status, 'overdue');
  assert.equal(mine(w, c, 'irit', now).length, 1);
  c.char_at = IL(2026, 10, 14, 10).toISOString();
  assert.equal(p03(w, c, now).complete, true);
  assert.equal(p03(w, c, now).gap, null);
  assert.deepEqual(mine(w, c, 'irit', now), []);
  // With the date and without the tick it is an ordinary open item again.
  delete w.checks[c.id]['p03.scheduled'];
  assert.deepEqual(mine(w, c, 'irit', now).map((e) => [e.item.key, e.fields]), [['p03.scheduled', undefined]]);
});

test('A: a client in landing is asked for nothing, and imported history is never reopened', () => {
  const now = IL(2026, 10, 13, 12);
  // In landing (one of the 39 from the old system): no date, no marks, and still quiet.
  const w = world();
  const landing = client(w, { landing: true, deal_at: IL(2026, 3, 1, 10).toISOString() });
  assert.equal(p03(w, landing, now).gap, null);
  assert.deepEqual(openItemsFor('irit', landing, {}, clientState(landing, {}, now), now), []);
  // An existing active client brought in mid-way: its history is marked "ייבוא", it never had a date here.
  const old = client(w, { deal_at: IL(2026, 3, 1, 10).toISOString() });
  marks(w, old, importKeys('post'), IL(2026, 9, 1, 9), IMPORT_NOTE);
  assert.equal(p03(w, old, now).complete, true);
  assert.equal(p03(w, old, now).gap, null);
  assert.deepEqual(mine(w, old, 'irit', now), []);
  // Taken in from landing and activated: the same, counted from the activation.
  const taken = client(w, { deal_at: IL(2026, 3, 1, 10).toISOString(), landed_at: IL(2026, 10, 8, 10).toISOString() });
  marks(w, taken, importKeys('content'), IL(2026, 10, 8, 10), IMPORT_NOTE);
  assert.equal(p03(w, taken, now).gap, null);
  assert.deepEqual(mine(w, taken, 'irit', now), []);
  // A client whose characterization already took place (the meeting ended; real marks, the date was never typed).
  const met = client(w, { deal_at: IL(2026, 9, 1, 10).toISOString() });
  marks(w, met, [...itemsOf('p01'), ...itemsOf('p02'), ...itemsOf('p03')], IL(2026, 9, 1, 10, 3));
  mark(w, met, 'p04.ended', IL(2026, 9, 3, 12), '{}');
  assert.equal(p03(w, met, now).gap, null);
  assert.equal(p03(w, met, now).complete, true);
  // None of them rings anybody about a meeting date (the server does not even load a client in landing).
  const rows = due({ ...w, clients: w.clients.filter((c) => !c.landing) }, now);
  assert.deepEqual(of(rows, 'meetingDate').map((r) => r.key), []);
  assert.deepEqual(rows.filter((r) => /אפיון/.test(r.title) && r.rule === 'late').map((r) => r.key), []);
});

test('A: the first day is the new deal\'s ladder; from the next business morning Irit rings every day until the date is set', () => {
  const w = world();
  const c = client(w);
  tickedWithoutDate(w, c);
  // The first day: `deal` (5 office minutes to Irit, 30 to Lior), which this rule does not double.
  const first = due(w, IL(2026, 10, 11, 10, 6));
  assert.equal(of(first, 'deal', 'due', 'irit')[0].body, 'עוד חסר: מועד אפיון.');
  assert.equal(of(first, 'deal', 'lior', 'lior').length, 1);
  assert.deepEqual(of(first, 'meetingDate').map((r) => r.step), []);
  // Monday: not before 10:00, then one ring; Lior's list has it from a business day after the deadline.
  assert.deepEqual(of(due(w, IL(2026, 10, 12, 9, 59)), 'meetingDate', null, 'irit'), []);
  const mon = due(w, IL(2026, 10, 12, 10));
  const ring = of(mon, 'meetingDate', 'd2026-10-12', 'irit');
  assert.equal(ring.length, 1);
  assert.deepEqual([ring[0].level, ring[0].title, hhmm(ring[0].at)], ['ring', 'עוד אין מועד לפגישת האפיון: מאפיית הדקל · רונית דקל', `12.10 ${MEETING_DATE.dailyAt}`]);
  const list = of(mon, 'meetingDate', 'list', 'lior');
  assert.deepEqual([list.length, list[0].level, list[0].list, hhmm(list[0].at)], [1, 'digest', true, '12.10 09:41']);
  // Tuesday: a new ring (its own key); the weekend: none.
  assert.equal(of(due(w, IL(2026, 10, 13, 10), mon.map((r) => r.key)), 'meetingDate', 'd2026-10-13', 'irit').length, 1);
  assert.deepEqual(of(due(w, IL(2026, 10, 16, 10)), 'meetingDate').filter((r) => /^d/.test(r.step)), []);
  // "ממתין ללקוח" on process 3 stops it; the date ends it.
  mark(w, c, 'p03.wait', IL(2026, 10, 13, 11), JSON.stringify({ reason: 'הלקוחה בחו״ל', recheck: '2026-10-18' }));
  assert.deepEqual(of(due(w, IL(2026, 10, 14, 10)), 'meetingDate'), []);
  delete w.checks[c.id]['p03.wait'];
  c.char_at = IL(2026, 10, 15, 10).toISOString();
  mark(w, c, 'p03.scheduled', IL(2026, 10, 14, 9));
  assert.deepEqual(of(due(w, IL(2026, 10, 14, 10)), 'meetingDate'), []);
});

test('A: a client activated out of landing with process 3 still open is rung from its own deadline', () => {
  const w = world();
  // Activated Thursday 8.10 10:00; whatever was already running is due by the end of the next business day.
  const c = client(w, { deal_at: IL(2026, 3, 1, 10).toISOString(), landed_at: IL(2026, 10, 8, 10).toISOString() });
  marks(w, c, [...itemsOf('p01'), ...itemsOf('p02')], IL(2026, 10, 8, 10), IMPORT_NOTE);
  const dueAt = p03(w, c, IL(2026, 10, 8, 11)).dueAt;
  assert.equal(hhmm(dueAt), '11.10 23:59');
  assert.deepEqual(of(due(w, IL(2026, 10, 11, 12)), 'meetingDate').map((r) => r.step), [], 'not before its deadline');
  const rows = due(w, IL(2026, 10, 12, 9, 30));
  assert.deepEqual(of(rows, 'deal'), [], 'the new deal\'s ladder is not for it');
  assert.deepEqual(of(rows, 'meetingDate').map((r) => `${r.step}@${r.person}:${r.level}`).sort(), ['due@irit:ring', 'lior@lior:ring']);
});

// ── B. A contract sent for signature and not signed ──

const SENT = IL(2026, 10, 11, 9, 11); // Sunday
let qn = 0;
function quote(o = {}) {
  qn += 1;
  const created = o.created_at || SENT.toISOString();
  return {
    id: `q${qn}`, number: `AST-2026-${String(qn).padStart(4, '0')}`, client_name: 'רונית דקל', business: 'מאפיית הדקל', status: 'sent', approval: 'none', approval_at: null,
    signable: 'true', valid: '72', created_at: created, created_by_email: 'irit@x', expires_at: new Date(Date.parse(created) + 72 * 36e5).toISOString(), seller_email: null, ...o,
  };
}

test('B: which contracts wait for a signature: sent agreements only, never one a manager still holds', () => {
  const now = IL(2026, 10, 12, 16);
  assert.equal(waitsForSignature(quote(), now), true);
  assert.equal(waitsForSignature(quote({ status: 'signed' }), now), false);
  assert.equal(waitsForSignature(quote({ status: 'cancelled' }), now), false);
  assert.equal(waitsForSignature(quote({ signable: 'false' }), now), false, 'a quote to look at has no signing step');
  assert.equal(waitsForSignature(quote({ approval: 'pending', expires_at: null }), now), false, 'waiting for a manager is not waiting for the client');
  assert.equal(waitsForSignature(quote({ approval: 'rejected', expires_at: null }), now), false);
  // Past its validity the client cannot sign any more: not "waiting", and said once.
  const late = IL(2026, 10, 14, 10);
  assert.equal(waitsForSignature(quote(), late), false);
  assert.equal(expiredUnsigned(quote(), late), true);
  assert.equal(expiredUnsigned(quote({ status: 'signed' }), late), false);
  // An approved exceptional contract is with the client from the approval, a corrected version from its new window.
  const approved = quote({ approval: 'approved', approval_at: IL(2026, 10, 12, 11).toISOString(), expires_at: IL(2026, 10, 15, 11).toISOString() });
  assert.equal(hhmm(sentForSignatureAt(approved)), '12.10 11:00');
  assert.equal(hhmm(sentForSignatureAt(quote({ created_at: IL(2026, 10, 1, 9).toISOString(), expires_at: IL(2026, 10, 15, 9).toISOString() }))), '12.10 09:00');
  // The moments: a business day, two, and never on a weekend.
  const t = unsignedTimes(quote());
  assert.deepEqual([hhmm(t.ring), hhmm(t.manager), hhmm(t.seller)], ['12.10 09:11', '13.10 09:11', '12.10 09:11']);
  assert.equal(hhmm(unsignedTimes(quote({ created_at: IL(2026, 10, 8, 17).toISOString() })).ring), '11.10 17:00'); // Thursday → Sunday
  assert.equal(hhmm(unsignedTimes(quote({ created_at: IL(2026, 10, 9, 22).toISOString() })).ring), '12.10 09:00'); // Friday night → Monday morning
});

test('B: Irit has one counted line with how many wait and since when; it leads to the list of sent quotes', () => {
  const now = IL(2026, 10, 12, 16);
  const viewer = (me) => ({ me, scope: ['irit', 'lior', 'ofir'].includes(me) ? 'office' : 'own', error: null });
  const rows = [
    quote(), // from a field deal
    quote({ business: 'קפה דנה', client_name: 'דנה', created_at: IL(2026, 10, 12, 10).toISOString(), created_by_email: 'lior@x' }), // built directly by Lior
    quote({ status: 'signed' }), quote({ status: 'cancelled' }), quote({ approval: 'pending', expires_at: null }), quote({ signable: 'false' }),
  ];
  assert.ok(flowNeeds(viewer('irit'), now).includes('unsigned'));
  for (const p of ['lior', 'ofir', 'ilai', 'stav']) assert.equal(flowNeeds(viewer(p), now).includes('unsigned'), false, p);
  const line = (me, unsigned) => flowLines({ viewer: viewer(me), clients: [], checks: {}, stateOf: () => ({ states: [] }), extra: { unsigned }, now }).find((l) => l.id === 'unsigned');
  const two = line('irit', rows);
  assert.deepEqual([two.n, two.bucket, two.href, two.cta, two.rule], [2, 'today', UNSIGNED_URL, 'למעקב', 'unsigned']);
  assert.equal(two.text, '2 הסכמים מחכים לחתימת הלקוח (הוותיק נשלח אתמול)');
  assert.equal(line('irit', [rows[0]]).text, 'ההסכם של מאפיית הדקל מחכה לחתימה (נשלח אתמול)');
  assert.equal(line('irit', rows.slice(2)), undefined, 'nothing waits: no line');
  assert.equal(line('irit', null), undefined, 'the rows could not be read: no line, nothing breaks');
  assert.equal(line('lior', rows), undefined, 'the list of sent quotes is not his page');
  // The page it leads to is one she may open, and the rule that nags exists.
  assert.ok(menuOf(viewer('irit')).some((m) => m.href === UNSIGNED_URL.split('#')[0]));
  assert.ok(RULE_BY_ID.has(two.rule));
  assert.equal(unsignedLine(rows, now).n, unsignedList(rows, now).length);
  // The owners see them in the daily control's "חתימות": a contract of a deal once, a direct one too.
  const topics = controlTopics({ clients: [], checks: {}, stateOf: () => ({ states: [] }), deals: [{ id: 'd1', status: 'sent', business_name: 'מאפיית הדקל', quote_id: rows[0].id, sent_at: SENT.toISOString(), created_at: SENT.toISOString() }], unsigned: rows, now });
  const sig = topics.find((t) => t.key === 'signatures').items;
  assert.deepEqual(sig.map((x) => [x.id, x.title, x.href]), [['deal:d1', 'מאפיית הדקל', 'quotes.html'], [`quote:${rows[1].id}`, 'קפה דנה', UNSIGNED_URL]]);
});

test('B: Irit rings after a business day and then daily in her digest, Lior after two, the seller once; nothing carries a price', () => {
  const w = world();
  const q = quote({ seller_email: 'stav@x' });
  w.unsigned.push(q);
  // The day it was sent: nothing yet.
  assert.deepEqual(of(due(w, IL(2026, 10, 11, 18, 5)), 'unsigned'), []);
  assert.deepEqual(of(due(w, IL(2026, 10, 12, 9, 10)), 'unsigned'), []);
  // Her ring is a ring: one that would fall in the window the morning digest swallows (09:00 to 09:30) rings right after it.
  assert.deepEqual(of(due(w, IL(2026, 10, 12, 9, 11)), 'unsigned').map((r) => r.step), ['seller']);
  const mon = due(w, IL(2026, 10, 12, 9, 31));
  assert.deepEqual(of(mon, 'unsigned').map((r) => `${r.step}@${r.person}:${r.level}`).sort(), ['irit@irit:ring', 'seller@stav:quiet']);
  const ring = of(mon, 'unsigned', 'irit')[0];
  assert.equal(ring.title, 'ההסכם עוד לא נחתם: מאפיית הדקל');
  assert.equal(ring.url, UNSIGNED_URL);
  assert.equal(of(mon, 'unsigned', 'seller')[0].title, 'הלקוח עוד לא חתם: מאפיית הדקל');
  assert.equal(of(mon, 'unsigned', 'seller')[0].url, 'deal.html');
  // Tuesday: a line in her morning digest, and Lior's list two business days after the sending.
  const known = mon.map((r) => r.key);
  const tue = due(w, IL(2026, 10, 13, 9, 11), known);
  assert.deepEqual(of(tue, 'unsigned').map((r) => `${r.step}@${r.person}:${r.level}`).sort(), ['d2026-10-13@irit:digest', 'manager@lior:digest']);
  assert.equal(hhmm(of(tue, 'unsigned', 'd2026-10-13')[0].at), `13.10 ${UNSIGNED.dailyAt}`);
  assert.equal(of(tue, 'unsigned', 'manager')[0].title, 'הסכם לא נחתם 2 ימי עסקים: מאפיית הדקל');
  assert.equal(of(tue, 'unsigned', 'seller').length, 0, 'the seller is told once');
  // No amounts and no shekel sign to anybody (docs/ops.md, section 35).
  for (const r of [...mon, ...tue].filter((x) => x.rule === 'unsigned')) assert.doesNotMatch(`${r.title} ${r.body}`, /₪|ש״ח|\d{3,}/, r.key);
  // Signed (the row is no longer 'sent'), cancelled, or held by a manager: silence.
  for (const change of [{ status: 'signed' }, { status: 'cancelled' }, { approval: 'pending', expires_at: null }]) {
    const x = world();
    x.unsigned.push({ ...q, ...change });
    assert.deepEqual(of(due(x, IL(2026, 10, 13, 9, 11)), 'unsigned'), [], JSON.stringify(change));
  }
  // A contract Irit built directly has no seller: only she and Lior hear.
  const direct = world();
  direct.unsigned.push(quote({ created_by_email: 'owner@x' }));
  assert.deepEqual(of(due(direct, IL(2026, 10, 12, 9, 31)), 'unsigned').map((r) => r.person), ['irit']);
  // A seller who is not a field agent (the owner sold it himself) is not written to.
  const own = world();
  own.unsigned.push(quote({ seller_email: 'owner@x' }));
  assert.deepEqual(of(due(own, IL(2026, 10, 12, 9, 31)), 'unsigned').map((r) => r.person), ['irit']);
});

test('B: when the validity runs out unsigned, Irit rings once more and the daily lines stop', () => {
  const w = world();
  w.unsigned.push(quote()); // valid until Wednesday 14.10 09:11
  const wed = due(w, IL(2026, 10, 14, 9, 11));
  assert.deepEqual(of(wed, 'unsigned').map((r) => `${r.step}@${r.person}:${r.level}`), ['expired@irit:ring']);
  assert.equal(of(wed, 'unsigned')[0].title, 'פג תוקף ההסכם בלי חתימה: מאפיית הדקל');
  // The steps of before the expiry are not sent after it, even when the engine was down then.
  assert.deepEqual(of(due(w, IL(2026, 10, 14, 12)), 'unsigned').map((r) => r.step), ['expired']);
});
