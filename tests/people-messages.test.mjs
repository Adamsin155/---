// What one person tells another reaches the phone (the owner's rule of 7.10.2026,
// repeated on 8.10.2026; docs/ops.md, section 45), at fixed Israel times (npm test runs
// this under UTC, New York and Jerusalem). For each message: who gets it, that it goes
// out once, that whoever did the action is not told, and that it stops when taken back.
//   - a question to the responsible person and its answer (the hole the owner found:
//     it reached Irit only inside the app), withdrawn, at night, about a client in landing;
//   - a change request and its decision; a decision on an exception; moved editing
//     deadlines; the client's approval on the status page; a field deal sent or cancelled;
//   - work that passes to someone else (an editor swap, a task moved): the new person
//     is told although the work started long ago, and the one before hears it passed on;
//   - one tick of the server (supabase/functions/reminders/tick.js): the row in the
//     log, the push, and the notification of a withdrawn question marked read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildEnv, candidates, computeReminders, planDelivery, planHandover, handoverPrefixes, pushPayload, pushTag } from '../app/reminder-engine.js';
import { RULES, RULE_BY_ID, nextSendMoment, inSendHours, VOID_WHEN_GONE, FACTS, stepOfKey } from '../app/reminder-rules.js';
import { PROCESSES } from '../app/protocol.js';
import { IMPORT_NOTE } from '../app/protocol-logic.js';
import { DECISION_KEY } from '../app/office-marks.js';
import { runTick } from '../supabase/functions/reminders/tick.js';
import { dateIL, partsIL } from '../app/tz.js';

const IL = (y, m, d, h = 0, mi = 0) => dateIL(y, m, d, h, mi);
const MIN = 6e4;
const hhmm = (d) => { const p = partsIL(d); return `${p.day}.${p.month} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`; };
const STAFF = [
  { email: 'owner@x', person: null }, { email: 'irit@x', person: 'irit' }, { email: 'lior@x', person: 'lior' }, { email: 'ofir@x', person: 'ofir' },
  { email: 'ilai@x', person: 'ilai' }, { email: 'nadia@x', person: 'nadia' }, { email: 'yariv@x', person: 'yariv' }, { email: 'eli@x', person: 'eli' }, { email: 'stav@x', person: 'stav' },
];
const world = (o = {}) => ({ clients: [], checks: {}, tasks: [], access: [], reviews: [], statusNotes: [], messages: [], subscriptions: [], staff: STAFF, deals: [], approvals: [], staffTasks: [], ...o });
const OURS = new Set(['question', 'questionAnswered', 'changeRequest', 'changeDecided', 'exceptionDecided', 'pauseDecided', 'clientApproved', 'dealSent', 'dealCancelled']);
// Every minute from `from` to `to`, as the server's tick: what is due and not in the log yet.
function run(w, from, to, log = new Set(), keep = (r) => OURS.has(r.rule)) {
  const sent = [];
  for (let t = from.getTime(); t <= to.getTime(); t += MIN) {
    const now = new Date(t);
    const w1 = typeof w === 'function' ? w(now) : w;
    for (const r of computeReminders({ ...w1, now, log })) { log.add(r.key); if (keep(r)) sent.push({ ...r, now }); }
  }
  return sent;
}
const QID = '22222222-2222-4222-8222-222222222222';
// Thursday 8.10.2026, 14:03: the owner asks Irit about a late item of "קפה דנה".
const question = (o = {}) => ({
  id: QID, client_id: 'c9', client_name: 'קפה דנה · דנה', to_person: 'irit', about: 'late:p07', context: 'באיחור: 9 הגרפיקות הראשונות', question: 'מה המצב, ומתי זה ייסגר?',
  asked_by: 'owner@x', asked_at: IL(2026, 10, 8, 14, 3).toISOString(), answer: null, answered_by: null, answered_at: null, ...o,
});

test('the sending hours open again: a message written at night, on the weekend or after an erev chag noon is due when they next open', () => {
  const at = (d) => hhmm(nextSendMoment(d));
  assert.equal(at(IL(2026, 10, 8, 14, 3)), '8.10 14:03'); // inside them: at once
  assert.equal(at(IL(2026, 10, 8, 8, 29)), '8.10 08:30');
  assert.equal(at(IL(2026, 10, 7, 22)), '8.10 08:30'); // Wednesday night → Thursday
  assert.equal(at(IL(2026, 10, 8, 19)), '11.10 08:30'); // Thursday 19:00 → Sunday
  assert.equal(at(IL(2026, 10, 9, 11)), '11.10 08:30'); // Friday
  assert.equal(at(IL(2026, 10, 10, 23, 59)), '11.10 08:30'); // Saturday night
  for (const d of [IL(2026, 10, 7, 22), IL(2026, 10, 9, 11), IL(2026, 9, 20, 14), IL(2026, 9, 21, 10)]) assert.equal(inSendHours(nextSendMoment(d)), true, hhmm(d));
});

test('a question rings the person asked, at once and once: who asks, about what, the question, and where it is answered', () => {
  const w = world({ questions: [question()] });
  const sent = run(w, IL(2026, 10, 8, 14), IL(2026, 10, 8, 18));
  assert.deepEqual(sent.map((r) => [r.rule, r.person, r.level, hhmm(r.now)]), [['question', 'irit', 'ring', '8.10 14:03']]);
  const [r] = sent;
  assert.equal(r.key, `question:c9:${QID}:ask@irit`);
  assert.equal(r.title, 'שאלה מהבעלים: קפה דנה · דנה');
  assert.equal(r.body, '״מה המצב, ומתי זה ייסגר?״ · על: באיחור: 9 הגרפיקות הראשונות · עונים ב״המשימות שלי״, בראש העמוד.');
  assert.equal(r.url, 'clients.html#mine');
  // It is a push of its own, with a banner of its own.
  const [p] = planDelivery({ reminders: [r], now: r.now });
  assert.deepEqual([p.channel, p.status, p.reason], ['push', 'sent', null]);
  assert.equal(pushTag(r.key), `question:c9:${QID}`);
  assert.equal(JSON.parse(pushPayload({ id: 1, ...r })).title, 'שאלה מהבעלים: קפה דנה · דנה');
});

test('a client in landing is not loaded by the rules, and a question about it still rings: it is a person\'s message, as a task given on the spot is', () => {
  // The reminders function loads no client in landing (clients: none here); the name comes with the question.
  const sent = run(world({ questions: [question()] }), IL(2026, 10, 8, 14), IL(2026, 10, 8, 14, 10));
  assert.deepEqual(sent.map((r) => [r.person, r.title, r.clientId]), [['irit', 'שאלה מהבעלים: קפה דנה · דנה', 'c9']]);
  // About the office (no client), and from someone on the team.
  const office = run(world({ questions: [question({ client_id: null, client_name: null, asked_by: 'lior@x', to_person: 'ofir', context: null })] }), IL(2026, 10, 8, 14), IL(2026, 10, 8, 14, 10));
  assert.deepEqual(office.map((r) => [r.person, r.title, r.key]), [['ofir', 'שאלה מליאור: המשרד', `question:-:${QID}:ask@ofir`]]);
  assert.equal(office[0].body, '״מה המצב, ומתי זה ייסגר?״ · עונים ב״המשימות שלי״, בראש העמוד.');
});

test('a withdrawn question sends nothing more; one withdrawn before it was due sends nothing at all', () => {
  // Asked at 14:03 and taken back at 14:05: the ring of 14:03 went out, and nothing after it.
  const w = (now) => world({ questions: now < IL(2026, 10, 8, 14, 5) ? [question()] : [] });
  assert.deepEqual(run(w, IL(2026, 10, 8, 14), IL(2026, 10, 9, 12)).map((r) => [r.rule, hhmm(r.now)]), [['question', '8.10 14:03']]);
  // Asked at 22:00 (outside the sending hours) and taken back at 22:03: nobody hears of it.
  const night = (now) => world({ questions: now < IL(2026, 10, 7, 22, 3) ? [question({ asked_at: IL(2026, 10, 7, 22).toISOString() })] : [] });
  assert.deepEqual(run(night, IL(2026, 10, 7, 21, 55), IL(2026, 10, 8, 12)), []);
});

test('a question asked at night waits for the morning and goes out by itself at 08:30, not as a line of the digest', () => {
  const w = world({ questions: [question({ asked_at: IL(2026, 10, 8, 22, 10).toISOString() })] }); // Thursday night
  const sent = run(w, IL(2026, 10, 8, 22), IL(2026, 10, 11, 10));
  assert.deepEqual(sent.map((r) => [r.rule, r.person, hhmm(r.now)]), [['question', 'irit', '11.10 08:30']]); // Sunday
  const [p] = planDelivery({ reminders: [sent[0]], now: sent[0].now });
  assert.deepEqual([p.channel, p.status], ['push', 'sent']);
});

test('the answer goes to whoever asked, once; the one who answered is not told, and the question stops', () => {
  const answered = question({ answer: 'נסגר מחר עד 12:00', answered_by: 'irit@x', answered_at: IL(2026, 10, 8, 15, 20).toISOString() });
  const w = (now) => world({ questions: [now < IL(2026, 10, 8, 15, 20) ? question() : answered] });
  const sent = run(w, IL(2026, 10, 8, 14), IL(2026, 10, 9, 12));
  assert.deepEqual(sent.map((r) => [r.rule, r.person, r.level, hhmm(r.now)]), [['question', 'irit', 'ring', '8.10 14:03'], ['questionAnswered', 'owner', 'quiet', '8.10 15:20']]);
  const a = sent[1];
  assert.equal(a.title, 'עירית ענה/תה: קפה דנה · דנה');
  assert.equal(a.body, '״נסגר מחר עד 12:00״ · שאלת: ״מה המצב, ומתי זה ייסגר?״');
  assert.equal(a.url, 'owner.html');
  assert.deepEqual(planDelivery({ reminders: [a], now: a.now }).map((p) => [p.channel, p.status]), [['push', 'sent']]);
  // A question to oneself: nothing either way. An asker who is no longer on the team: the question still rings, the answer has nobody to go to.
  assert.deepEqual(run(world({ questions: [question({ asked_by: 'irit@x' })] }), IL(2026, 10, 8, 14), IL(2026, 10, 8, 15)), []);
  assert.deepEqual(run(world({ questions: [{ ...answered, asked_by: 'irit@x' }] }), IL(2026, 10, 8, 15), IL(2026, 10, 8, 16)), []);
  assert.deepEqual(run(world({ questions: [{ ...answered, asked_by: 'gone@x' }] }), IL(2026, 10, 8, 15), IL(2026, 10, 8, 16)), []);
  assert.deepEqual(run(world({ questions: [question({ asked_by: 'gone@x' })] }), IL(2026, 10, 8, 14), IL(2026, 10, 8, 15)).map((r) => r.title), ['שאלה: קפה דנה · דנה']);
});

test('a change request rings Lior, and his decision goes back to whoever asked; nobody is told of what they did themselves', () => {
  const cr = (o = {}) => ({
    id: 'cr1', client_id: null, client_name: null, problem: 'הלקוחות שולחים הערות בוואטסאפ פרטי', why: 'הערות הולכות לאיבוד', proposal: 'רק דרך דף המצב',
    created_by_email: 'ofir@x', created_at: IL(2026, 10, 8, 10).toISOString(), decision: null, decided_by_email: null, decided_at: null, ...o,
  });
  const decided = cr({ decision: 'מאושר, מיום ראשון', decided_by_email: 'lior@x', decided_at: IL(2026, 10, 8, 11, 30).toISOString() });
  const w = (now) => world({ changeRequests: [now < IL(2026, 10, 8, 11, 30) ? cr() : decided] });
  const sent = run(w, IL(2026, 10, 8, 9, 55), IL(2026, 10, 9, 12));
  assert.deepEqual(sent.map((r) => [r.rule, r.person, r.level, hhmm(r.now), r.url]), [
    ['changeRequest', 'lior', 'ring', '8.10 10:00', 'decisions.html'], ['changeDecided', 'ofir', 'quiet', '8.10 11:30', 'pass.html'],
  ]);
  assert.equal(sent[0].title, 'בקשת שינוי מאופיר');
  assert.equal(sent[0].body, 'הלקוחות שולחים הערות בוואטסאפ פרטי · ההצעה: רק דרך דף המצב · ההחלטה נכתבת ב״החלטות״.');
  assert.equal(sent[1].title, 'ליאור החליט/ה על בקשת השינוי שלך');
  assert.equal(sent[1].body, 'ההחלטה: מאושר, מיום ראשון · הבקשה: הלקוחות שולחים הערות בוואטסאפ פרטי');
  // About a client: its name. Lior's own request, and a decision by whoever asked: nobody.
  assert.equal(run(world({ changeRequests: [cr({ client_id: 'c9', client_name: 'קפה דנה' })] }), IL(2026, 10, 8, 10), IL(2026, 10, 8, 10, 5))[0].title, 'בקשת שינוי מאופיר: קפה דנה');
  assert.deepEqual(run(world({ changeRequests: [cr({ created_by_email: 'lior@x' })] }), IL(2026, 10, 8, 10), IL(2026, 10, 8, 11)), []);
  assert.deepEqual(run(world({ changeRequests: [{ ...decided, created_by_email: 'lior@x' }] }), IL(2026, 10, 8, 11), IL(2026, 10, 8, 12)), []);
});

// ── A client with its marks ─────────────────
const itemsOf = (id) => PROCESSES.find((p) => p.id === id).items.filter((i) => !i.optional).map((i) => i.key);
const UPTO_SHOOT = ['p01', 'p02', 'p03', 'p04', 'p05', 'p05b', 'p06', 'p07', 'p07a', 'p07b', 'p08', 'p08b', 'p09', 'p10', 'p11', 'p12a', 'p12', 'p13', 'p14', 'p15', 'p16', 'p17', 'p17b', 'p18', 'p18b', 'p19', 'p19b', 'p21'];
const mark = (w, key, at, note = null) => { (w.checks.c1 ||= {})[key] = { client_id: 'c1', item_key: key, state: 'done', note, at: at.toISOString() }; };
// "קפה דנה", shot on 1.10.2026 and assigned to Nadia on Sunday 4.10 at 10:00.
function editing(o = {}) {
  const w = world({
    clients: [{
      id: 'c1', name: 'דנה', business: 'קפה דנה', status: 'active', shoot_type: 'dms', characterizer: 'ofir', has_logo: true, rounds: [], contract_end: '2027-12-31',
      deal_at: IL(2026, 9, 1, 10).toISOString(), created_at: IL(2026, 9, 1, 10).toISOString(), char_at: IL(2026, 9, 7, 10).toISOString(), shoot_at: IL(2026, 10, 1, 10).toISOString(), editor: 'nadia', ...o,
    }],
  });
  for (const id of UPTO_SHOOT) for (const k of itemsOf(id)) mark(w, k, IL(2026, 9, 1, 9), IMPORT_NOTE);
  for (const k of ['p22a.load', 'p22a.assigned']) mark(w, k, IL(2026, 10, 4, 10));
  return w;
}

test('Lior closed an exception with a decision: whoever reported it hears the decision, once; Lior does not', () => {
  const w = editing();
  const t = { id: 't1', client_id: 'c1', title: 'הלקוח רוצה להחליף משפיען', owner: 'lior', due_on: '2026-10-08', created_by_email: 'irit@x', created_at: IL(2026, 10, 8, 9).toISOString(), source: 'escalation', urgent: false, done_at: null };
  const d = { task_id: 't1', client_id: 'c1', reason: 'המשפיען לא זמין', decision: 'מחליפים לסמיון, בלי תוספת', next_task_id: 't2', by_email: 'lior@x', at: IL(2026, 10, 8, 13).toISOString() };
  const w1 = (now) => ({ ...w, tasks: [now < IL(2026, 10, 8, 13) ? t : { ...t, done_at: IL(2026, 10, 8, 13).toISOString() }], decisions: now < IL(2026, 10, 8, 13) ? [] : [d] });
  const sent = run(w1, IL(2026, 10, 8, 12, 50), IL(2026, 10, 8, 16));
  assert.deepEqual(sent.map((r) => [r.rule, r.person, r.level, hhmm(r.now)]), [['exceptionDecided', 'irit', 'quiet', '8.10 13:00']]);
  assert.equal(sent[0].title, 'ליאור החליט/ה על החריגה שדיווחת: קפה דנה · דנה');
  assert.equal(sent[0].body, 'ההחלטה: מחליפים לסמיון, בלי תוספת · הלקוח רוצה להחליף משפיען');
  assert.equal(sent[0].url, 'client.html?id=c1#tasks');
  // A decision saved while the exception is still open is not news yet; Lior's own report is not news to him.
  const at = IL(2026, 10, 8, 14);
  const of = (tasks, decisions) => computeReminders({ ...w, tasks, decisions, now: at }).filter((r) => r.rule === 'exceptionDecided');
  assert.deepEqual(of([t], [d]), []);
  assert.deepEqual(of([{ ...t, created_by_email: 'lior@x', done_at: at.toISOString() }], [d]), []);
  assert.deepEqual(of([{ ...t, done_at: at.toISOString() }], [{ ...d, decision: ' ' }]), []);
});

test('Lior moved the deadlines of a paused editing: the editor hears, once', () => {
  const w = editing();
  mark(w, DECISION_KEY(''), IL(2026, 10, 6, 11), JSON.stringify({ choice: 'move', days: 2, editor: null, proposal: 'yariv' }));
  const sent = run(w, IL(2026, 10, 6, 10, 55), IL(2026, 10, 6, 15));
  assert.deepEqual(sent.map((r) => [r.rule, r.person, r.level, hhmm(r.now), r.url]), [['pauseDecided', 'nadia', 'quiet', '6.10 11:00', 'editor.html#c-c1']]);
  assert.match(sent[0].title, /^מועדי העריכה הוזזו ב־2 ימי עסקים: קפה דנה · דנה$/);
  // Passing it to another editor is not this rule's message (the handover of `editing.assigned` tells both).
  const w2 = editing();
  mark(w2, DECISION_KEY(''), IL(2026, 10, 6, 11), JSON.stringify({ choice: 'reassign', days: 0, editor: 'yariv', proposal: 'yariv' }));
  assert.deepEqual(run(w2, IL(2026, 10, 6, 10, 55), IL(2026, 10, 6, 12)), []);
});

test('the client approved on the status page: Irit hears (and Lior, for the scripts), and the editor when the videos are approved', () => {
  const page = 'אושר בדף המצב על ידי דנה';
  // The scripts, approved on the page on Tuesday evening: both hear on Wednesday at 08:30.
  const w = editing();
  for (const id of ['p12', 'p13']) for (const k of itemsOf(id)) delete w.checks.c1[k];
  mark(w, 'p13.approved', IL(2026, 10, 6, 21), page);
  const sent = run(w, IL(2026, 10, 6, 20, 55), IL(2026, 10, 7, 10));
  assert.deepEqual(sent.map((r) => [r.rule, r.person, r.level, hhmm(r.now)]).sort(), [['clientApproved', 'irit', 'quiet', '7.10 08:30'], ['clientApproved', 'lior', 'quiet', '7.10 08:30']]);
  assert.equal(sent[0].title, 'הלקוח אישר בדף המצב: התסריטים · קפה דנה · דנה');
  assert.equal(sent[0].body, `${page}.`);
  // Marked by the office itself (Lior at the Zoom, Irit by phone): whoever marked it knows, nobody is told.
  const hand = editing();
  mark(hand, 'p13.approved', IL(2026, 10, 6, 12), null);
  assert.deepEqual(run(hand, IL(2026, 10, 6, 11, 55), IL(2026, 10, 6, 13)), []);
  // The videos: Irit (the page), and the editor, who waits for notes that will not come.
  const v = editing();
  mark(v, 'p27.approved', IL(2026, 10, 7, 12), page);
  assert.deepEqual(run(v, IL(2026, 10, 7, 11, 55), IL(2026, 10, 7, 13)).map((r) => [r.person, r.title, r.url]).sort(), [
    ['irit', 'הלקוח אישר בדף המצב: הסרטונים · קפה דנה · דנה', 'client.html?id=c1#p27'],
    ['nadia', 'הלקוח אישר את הסרטונים: קפה דנה · דנה', 'editor.html#c-c1'],
  ]);
  // Marked by Irit: the editor still hears; Irit does not. With the final versions already in the Drive: nobody.
  const byIrit = editing();
  mark(byIrit, 'p27.approved', IL(2026, 10, 7, 12), null);
  assert.deepEqual(run(byIrit, IL(2026, 10, 7, 11, 55), IL(2026, 10, 7, 13)).map((r) => r.person), ['nadia']);
  mark(byIrit, 'p27.final', IL(2026, 10, 7, 11));
  assert.deepEqual(run(byIrit, IL(2026, 10, 7, 11, 55), IL(2026, 10, 7, 13)), []);
  // History taken in with the client is not an event.
  const old = editing();
  mark(old, 'p27.approved', IL(2026, 10, 7, 12), IMPORT_NOTE);
  assert.deepEqual(run(old, IL(2026, 10, 7, 11, 55), IL(2026, 10, 7, 13)), []);
});

test('a field deal: the seller hears that the contract was sent, or that the deal was cancelled, once; not when he did it himself', () => {
  const deal = (o = {}) => ({ id: 'd1', created_at: IL(2026, 10, 8, 9).toISOString(), created_by_email: 'stav@x', seller: 'stav', business_name: 'פיצה רון', status: 'pending', quote_id: null, sent_at: null, signed_at: null, cancelled_at: null, status_by_email: null, ...o });
  const sentDeal = deal({ status: 'sent', quote_id: 'q1', sent_at: IL(2026, 10, 8, 9, 8).toISOString(), status_by_email: 'irit@x' });
  const mine = (list) => list.filter((r) => r.rule === 'dealSent' || r.rule === 'dealCancelled');
  const s = mine(run(world({ deals: [sentDeal] }), IL(2026, 10, 8, 9), IL(2026, 10, 8, 12)));
  assert.deepEqual(s.map((r) => [r.rule, r.person, r.level, r.title, hhmm(r.now), r.url]), [['dealSent', 'stav', 'quiet', 'החוזה של פיצה רון נשלח ללקוח', '8.10 09:08', 'deal.html']]);
  const c = mine(run(world({ deals: [deal({ status: 'cancelled', cancelled_at: IL(2026, 10, 8, 10).toISOString(), status_by_email: 'irit@x' })] }), IL(2026, 10, 8, 9), IL(2026, 10, 8, 12)));
  assert.deepEqual(c.map((r) => [r.rule, r.person, r.title, r.body]), [['dealCancelled', 'stav', 'העסקה של פיצה רון סומנה ״בוטל״', 'סימן/ה: עירית.']]);
  // An exceptional contract a manager approved: `contractDecided` already told him it is on its way.
  assert.deepEqual(mine(run(world({ deals: [sentDeal], approvals: [{ id: 'q1', approval: 'approved', status: 'sent', approval_at: IL(2026, 10, 8, 9, 8).toISOString(), approval_by: 'ofir', created_by_email: 'irit@x', version: 1 }] }), IL(2026, 10, 8, 9), IL(2026, 10, 8, 10))), []);
  // His own doing, a deal of the owner's, a cancellation with no moment (before the migration): nobody.
  assert.deepEqual(mine(run(world({ deals: [{ ...sentDeal, status_by_email: 'stav@x' }] }), IL(2026, 10, 8, 9), IL(2026, 10, 8, 10))), []);
  assert.deepEqual(mine(run(world({ deals: [{ ...sentDeal, created_by_email: 'owner@x' }] }), IL(2026, 10, 8, 9), IL(2026, 10, 8, 10))), []);
  assert.deepEqual(mine(run(world({ deals: [deal({ status: 'cancelled', status_by_email: 'irit@x' })] }), IL(2026, 10, 8, 9), IL(2026, 10, 8, 10))), []);
});

// ── Work that passes to someone else ────────
test('an editor swap days after the assignment: the new editor is told now (it used to be recorded as stale), and the one before hears it passed on', () => {
  const now = IL(2026, 10, 8, 11); // Thursday; assigned on Sunday
  const w = editing({ editor: 'yariv' });
  const fresh = computeReminders({ ...w, now }).filter((r) => r.rule === 'editing' && r.step === 'assigned');
  assert.deepEqual(fresh.map((r) => [r.key, r.person]), [['editing:c1:p22:assigned@yariv', 'yariv']]);
  assert.deepEqual(handoverPrefixes(fresh), ['editing:c1:p22:assigned']);
  // Before: its moment is Sunday 10:00, four days ago, so it was never sent.
  assert.deepEqual(planDelivery({ reminders: fresh, now }).map((r) => [r.status, r.reason]), [['suppressed', 'stale']]);
  // Nadia was told of this very step on Sunday: it is a handover.
  const siblings = [{ id: 41, key: 'editing:c1:p22:assigned@nadia', person: 'nadia' }];
  const passed = planHandover({ reminders: fresh, siblings, now });
  assert.deepEqual(passed.map((r) => [r.key, r.person, r.level, r.title, r.url, +r.at === +now]), [
    ['editing:c1:p22:assigned@yariv', 'yariv', 'ring', 'לקוח חדש בעריכה אצלך: קפה דנה · דנה', 'editor.html#c-c1', true],
    ['editing:c1:p22#41:off@nadia', 'nadia', 'quiet', 'העריכה של קפה דנה · דנה עברה ליריב', 'editor.html', true],
  ]);
  assert.deepEqual(planDelivery({ reminders: passed, now }).map((r) => [r.person, r.channel, r.status]), [['yariv', 'push', 'sent'], ['nadia', 'push', 'sent']]);
  // What Nadia is told is a fact: a line of it that waits for the morning is not dropped.
  assert.ok(FACTS.has(stepOfKey(passed[1].key)));
  // A first assignment (nobody was told before) is not a handover: an engine that was down does not ring days late.
  assert.deepEqual(planHandover({ reminders: fresh, siblings: [], now }), fresh);
  assert.deepEqual(planHandover({ reminders: fresh, siblings: [{ id: 40, key: 'editing:c1:p22:assigned@yariv', person: 'yariv' }], now }), fresh);
  // Back and forth: the latest one before is the one told, and each handover has its own key.
  const twice = planHandover({ reminders: fresh, siblings: [...siblings, { id: 57, key: 'editing:c1:p22:assigned@anna', person: 'anna' }], now });
  assert.deepEqual(twice.map((r) => r.key), ['editing:c1:p22:assigned@yariv', 'editing:c1:p22#57:off@anna']);
});

test('a task moved to someone else is told to them now; the steps that follow the holder are marked, and only they', () => {
  const marked = [];
  for (const rule of RULES) if (Array.isArray(rule.steps)) for (const s of rule.steps) if (s.handover) marked.push(`${rule.id}.${s.id}`);
  assert.deepEqual(marked.sort(), ['editing.assigned', 'task.created', 'urgent.now']);
  const w = editing();
  w.tasks = [{ id: 't7', client_id: 'c1', title: 'לחזור ללקוח על הכתוביות', owner: 'ilai', due_on: null, created_by_email: 'lior@x', created_at: IL(2026, 10, 5, 9).toISOString(), source: null, urgent: true, started_at: null, done_at: null }];
  const now = IL(2026, 10, 8, 11);
  const fresh = computeReminders({ ...w, now }).filter((r) => r.rule === 'urgent' && r.step === 'now');
  const passed = planHandover({ reminders: fresh, siblings: [{ id: 9, key: 'urgent:c1:t7:now@ofir', person: 'ofir' }], now });
  // The new owner rings now; a task has no message for the one before (he may be the one who moved it).
  assert.deepEqual(passed.map((r) => [r.key, r.person, +r.at === +now]), [['urgent:c1:t7:now@ilai', 'ilai', true]]);
  assert.deepEqual(planDelivery({ reminders: passed, now }).map((r) => [r.channel, r.status]), [['push', 'sent']]);
});

// ── One tick of the server ──────────────────
const KEY = `B${'A'.repeat(86)}`;
function fakeDb(input) {
  let clock = new Date();
  const db = {
    log: [], nextId: 1, input, asked: [],
    subs: STAFF.map((s, i) => ({ id: `s${i}`, email: s.email, endpoint: `https://push.test/${s.email}`, p256dh: KEY, auth: 'A'.repeat(22), fail_count: 0 })),
    at(now) { clock = now; return db; },
    async load() { return { ...world(), ...db.input, subscriptions: db.subs.map((s) => ({ ...s })), log: db.log.map((r) => ({ ...r })) }; },
    async known(keys) { const set = new Set(keys); return new Set(db.log.map((r) => r.key).filter((k) => set.has(k))); },
    async siblings(prefixes) { db.asked.push(...prefixes); return db.log.filter((r) => prefixes.some((p) => r.key.startsWith(`${p}@`))).map((r) => ({ id: r.id, key: r.key, person: r.person })); },
    async insertLog(rows) {
      const out = [];
      for (const r of rows) {
        if (db.log.some((x) => x.key === r.key)) continue;
        const row = { id: db.nextId++, created_at: clock.toISOString(), claimed_at: clock.toISOString(), attempts: 0, read_at: null, digest_key: null, ...r };
        db.log.push(row);
        out.push({ ...row });
      }
      return out;
    },
    async reclaim() { return []; },
    async updateLog(ids, patch) { for (const r of db.log) if (ids.includes(r.id)) Object.assign(r, patch); },
    async subscriptionOk() {}, async subscriptionFailed() {}, async removeSubscription() {},
  };
  return db;
}
function fakePush() {
  const sent = [];
  return { sent, push: async (sub, payload) => { sent.push({ to: sub.email, ...JSON.parse(payload) }); return { ok: true, status: 201 }; } };
}
const ofRule = (db, ...rules) => db.log.filter((r) => rules.includes(r.rule));

test('a tick: the question is a row in the log and a push on Irit\'s phone, once; the answer a push on the owner\'s', async () => {
  const db = fakeDb({ questions: [question()] });
  const { push, sent } = fakePush();
  const t0 = IL(2026, 10, 8, 14, 3);
  await runTick({ db: db.at(t0), push, now: t0 });
  await runTick({ db: db.at(new Date(+t0 + MIN)), push, now: new Date(+t0 + MIN) });
  assert.deepEqual(ofRule(db, 'question').map((r) => [r.key, r.person, r.level, r.channel, r.status, r.client_id, r.url]), [[`question:c9:${QID}:ask@irit`, 'irit', 'ring', 'push', 'sent', 'c9', 'clients.html#mine']]);
  const mine = sent.filter((s) => s.tag.startsWith('question'));
  assert.deepEqual(mine.map((s) => [s.to, s.title, s.url, s.level]), [['irit@x', 'שאלה מהבעלים: קפה דנה · דנה', 'clients.html#mine', 'ring']]);
  assert.match(mine[0].body, /^״מה המצב, ומתי זה ייסגר\?״/);
  // Irit answers: the owner's phone, once; her own notification of the question is marked read.
  db.input = { questions: [question({ answer: 'נסגר מחר', answered_by: 'irit@x', answered_at: IL(2026, 10, 8, 14, 20).toISOString() })] };
  for (const m of [20, 21]) { const t = IL(2026, 10, 8, 14, m); await runTick({ db: db.at(t), push, now: t }); }
  assert.deepEqual(sent.filter((s) => s.tag.startsWith('questionAnswered')).map((s) => [s.to, s.title]), [['owner@x', 'עירית ענה/תה: קפה דנה · דנה']]);
  assert.deepEqual(ofRule(db, 'question', 'questionAnswered').map((r) => [r.rule, r.person, r.status, !!r.read_at]), [['question', 'irit', 'sent', true], ['questionAnswered', 'owner', 'sent', false]]);
  assert.equal(sent.filter((s) => s.tag.startsWith('question')).length, 2);
});

test('a tick: a withdrawn question sends nothing more, and its notification is marked read', async () => {
  assert.deepEqual([...VOID_WHEN_GONE], ['question']);
  const db = fakeDb({ questions: [question()] });
  const { push, sent } = fakePush();
  const t0 = IL(2026, 10, 8, 14, 3);
  await runTick({ db: db.at(t0), push, now: t0 });
  assert.equal(ofRule(db, 'question')[0].read_at, null);
  db.input = { questions: [] }; // the owner pressed "ביטול": the row is gone
  for (const m of [5, 6, 7]) { const t = IL(2026, 10, 8, 14, m); await runTick({ db: db.at(t), push, now: t }); }
  assert.equal(sent.filter((s) => s.tag.startsWith('question')).length, 1);
  assert.deepEqual(ofRule(db, 'question', 'questionAnswered').map((r) => [r.rule, r.status, r.read_at]), [['question', 'sent', IL(2026, 10, 8, 14, 5).toISOString()]]);
});

test('a tick: an editor swap four days after the assignment pushes the new editor and the one before, once each', async () => {
  const w = editing();
  const db = fakeDb({ clients: w.clients, checks: w.checks });
  const { push, sent } = fakePush();
  const t0 = IL(2026, 10, 4, 10); // Sunday: assigned to Nadia
  await runTick({ db: db.at(t0), push, now: t0 });
  const told = (who) => sent.filter((s) => s.to === who && /^editing:c1:p22/.test(s.tag)).map((s) => s.title);
  assert.deepEqual(told('nadia@x'), ['לקוח חדש בעריכה אצלך: קפה דנה · דנה']);
  // Thursday 11:00: the job is late, and Ofir passes it to Yariv keeping the deadlines (22א is not marked again).
  db.input = { clients: [{ ...w.clients[0], editor: 'yariv' }], checks: w.checks };
  for (const m of [0, 1, 2]) { const t = IL(2026, 10, 8, 11, m); await runTick({ db: db.at(t), push, now: t }); }
  assert.deepEqual(told('yariv@x'), ['לקוח חדש בעריכה אצלך: קפה דנה · דנה']);
  assert.deepEqual(told('nadia@x'), ['לקוח חדש בעריכה אצלך: קפה דנה · דנה', 'העריכה של קפה דנה · דנה עברה ליריב']);
  assert.ok(db.asked.includes('editing:c1:p22:assigned'));
  const rows = db.log.filter((r) => /^editing:c1:p22(#\d+)?:(assigned|off)@/.test(r.key)).map((r) => [r.key.replace(/#\d+/, '#n'), r.level, r.channel, r.status]);
  assert.deepEqual(rows, [
    ['editing:c1:p22:assigned@nadia', 'ring', 'push', 'sent'], ['editing:c1:p22:assigned@yariv', 'ring', 'push', 'sent'], ['editing:c1:p22#n:off@nadia', 'quiet', 'push', 'sent'],
  ]);
});

test('the new rules are data like the others: one of each, every step with a level, and the server loads what they read', () => {
  for (const id of OURS) {
    assert.equal(RULES.filter((r) => r.id === id).length, 1, id);
    assert.equal(RULE_BY_ID.get(id).id, id);
    for (const s of RULE_BY_ID.get(id).steps) assert.ok(['ring', 'quiet'].includes(s.level), `${id}.${s.id}`);
  }
  const index = readFileSync(new URL('../supabase/functions/reminders/index.ts', import.meta.url), 'utf8');
  for (const t of ['client_questions', 'change_requests', 'task_decisions', 'cancelled_at', 'status_by_email', 'async siblings(']) assert.ok(index.includes(t), t);
  const env = buildEnv({ ...world({ questions: [question()] }), now: IL(2026, 10, 8, 14, 3) });
  assert.equal(candidates(env).filter((r) => r.rule === 'question').length, 1);
});
