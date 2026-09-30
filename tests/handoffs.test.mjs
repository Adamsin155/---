// Handoff buttons (app/handoffs.js): who is next at each handoff point, the
// WhatsApp message (client, what is needed, the due time in Israel time, a link
// to the card) and the wa.me link. `npm test` runs this file under UTC,
// America/New_York and Asia/Jerusalem: the messages must read the same.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROCESSES } from '../app/protocol.js';
import { clientState } from '../app/protocol-logic.js';
import {
  HANDOFFS, HANDOFF_MARK, handoffsFor, handoffsOf, handoffMessage, waLink, clientLink, whenText, describeMark, markKeyOf, stillStands,
} from '../app/handoffs.js';

const at = (s) => new Date(s);
const PAGE = 'https://app.astrateg.com/client.html';
const done = (when, note = null) => ({ state: 'done', at: when, note, by_email: 'x@astrateg.test' });
const all = (id, when, only = null) => Object.fromEntries(PROCESSES.find((p) => p.id === id).items
  .filter((i) => !i.optional && (!only || only.includes(i.key))).map((i) => [i.key, done(when)]));
const client = (o = {}) => ({
  id: 'c-1', name: 'מספרת רון', status: 'active', deal_at: '2026-10-13T09:00:00+03:00', char_at: '2026-10-19T10:00:00+03:00',
  characterizer: 'ofir', has_logo: true, shoot_type: 'dms', shoot_at: '2026-10-28T10:00:00+02:00', contract_end: '2027-10-01',
  editor: null, rounds: [], ...o,
});
const offer = (c, checks, key, now, opts = {}) => handoffsFor(c, checks, key, { now: at(now), ...opts });
const msg = (o, now) => handoffMessage(o, { page: PAGE, now: at(now) });
const people = (list) => list.map((o) => o.person);

test('every handoff point uses real protocol keys, and its record fits the database key rule', () => {
  const items = new Set(PROCESSES.flatMap((p) => p.items.map((i) => i.key)));
  const procs = new Set(PROCESSES.map((p) => p.id));
  const dbKey = /^(r[0-9]+\.)?p[0-9]+[ab]?\.[a-z0-9.]+$/; // protocol_checks_item_key_check
  for (const point of HANDOFFS) {
    assert.ok(/^p\d+[a-z]?$/.test(point.on) ? procs.has(point.on) : items.has(point.on), point.on);
    assert.ok(point.label && point.to.length, point.id);
    for (const t of point.to) {
      assert.ok(procs.has(t.proc), `${point.id} → ${t.proc}`);
      if (t.until) assert.ok(items.has(t.until), `${point.id}: until ${t.until}`);
      if (typeof t.person === 'function') assert.ok(t.who, `${point.id}: who that is, in words`);
      assert.match(t.text, /\{client\}/, `${point.id}: the message names the client`);
      assert.doesNotMatch(t.text, /\d{3}-?\d{7}|@/, 'no numbers or emails in the repository');
      for (const d of t.due) if (d.proc) assert.ok(procs.has(d.proc), d.proc);
      for (const pre of ['', 'r2.']) {
        const key = markKeyOf(pre, point, t);
        assert.match(key, dbKey);
        assert.match(key, HANDOFF_MARK);
        assert.ok(!items.has(key.replace(/^r\d+\./, '')), `${key} is not an item`);
      }
    }
  }
  // The points of the plan's reminder matrix, in protocol order.
  assert.deepEqual(HANDOFFS.map((p) => p.on), ['p05.access', 'p07.made', 'p19', 'p22a.assigned', 'p23.made', 'p23.ofir', 'p24.notify', 'p25.approved', 'p27.final', 'p29.filled']);
});

test('who is next at each point', () => {
  const c = client();
  const now = '2026-10-29T10:05:00+02:00';
  const when = '2026-10-29T10:00:00+02:00';
  const next = (key, extra = {}) => people(offer(c, { [key]: done(when), ...extra }, key, now));
  assert.deepEqual(next('p05.access'), ['ilai']);
  assert.deepEqual(next('p07.made'), ['irit']);
  assert.deepEqual(next('p23.made'), ['ofir']);
  assert.deepEqual(next('p23.ofir'), ['irit']);
  assert.deepEqual(next('p24.notify'), ['ofir']);
  assert.deepEqual(next('p25.approved'), ['irit', 'lior']);
  assert.deepEqual(next('p27.final'), ['ilai']);
  assert.deepEqual(next('p29.filled'), ['irit']);
  // The shoot day is done when process 19 is complete: Ofir assigns the editor,
  // or Lior when he took the assignment (process 22א is shared).
  const p19 = all('p19', when);
  assert.deepEqual(people(offer(c, p19, 'p19.took', now)), ['ofir']);
  assert.deepEqual(people(offer(c, p19, 'p19.all', now)), ['ofir'], 'whichever item completed it');
  assert.deepEqual(people(offer(c, { ...p19, 'p22a.claim': done(when, 'lior') }, 'p19.took', now)), ['lior']);
  const { 'p19.drive': _, ...partial } = p19;
  assert.deepEqual(offer(c, partial, 'p19.took', now), [], 'not before the whole day is closed');
});

test('the assigned editor: Natali\'s (Nirel), the DMS team\'s, and a second shoot round\'s own', () => {
  const when = '2026-10-07T15:00:00+03:00';
  const now = '2026-10-07T15:05:00+03:00';
  const natali = client({ shoot_type: 'natali', editor: 'nirel' });
  const [n] = offer(natali, { 'p22a.assigned': done(when) }, 'p22a.assigned', now);
  assert.deepEqual([n.person, n.name, n.toName, n.procId, n.markKey], ['nirel', 'ניראל', 'לניראל', 'p22', 'p22a.handoff.editor']);
  const [d] = offer(client({ shoot_type: 'dms', editor: 'yariv' }), { 'p22a.assigned': done(when) }, 'p22a.assigned', now);
  assert.equal(d.person, 'yariv');

  const rounds = [{ n: 2, shoot_type: 'dms', shoot_at: '2027-03-09T10:00:00+02:00', start_at: '2027-03-01T10:00:00+02:00', editor: 'anna' }];
  const r = client({ editor: 'nadia', rounds });
  const [r2] = offer(r, { 'r2.p22a.assigned': done('2027-03-10T15:00:00+02:00') }, 'r2.p22a.assigned', '2027-03-10T15:05:00+02:00');
  assert.deepEqual([r2.person, r2.procId, r2.markKey, r2.round], ['anna', 'r2-p22', 'r2.p22a.handoff.editor', 2]);
  assert.match(r2.text, /מספרת רון \(סבב צילום 2\)/);
  // No editor stored: the message still opens, without a name or a number.
  const [none] = offer(client(), { 'p22a.assigned': done(when) }, 'p22a.assigned', now);
  assert.deepEqual([none.person, none.known, none.toName], ['editor', false, 'לעורך המשויך']);
  assert.match(msg(none, now), /^היי,\n/);
});

test('the message: client, what is needed, the due time in Israel time, and the card link', () => {
  const c = client();
  const [o] = offer(c, { 'p05.access': done('2026-10-20T11:00:00+03:00') }, 'p05.access', '2026-10-20T11:01:00+03:00');
  assert.equal(msg(o, '2026-10-20T11:01:00+03:00'), [
    'היי עילאי,',
    'גישות התקבלו למספרת רון. יש לך 30 דק׳ לבדוק אותן מהכספת במערכת ולסדר את העמודים.',
    'יעד: היום 11:30',
    'כרטיס הלקוח: https://app.astrateg.com/client.html?id=c-1#p06',
  ].join('\n'));
  // Winter time (after 25.10), ten minutes before the office closes: the 30 minutes
  // run on the next working morning.
  const [w] = offer(c, { 'p05.access': done('2026-10-26T17:50:00+02:00') }, 'p05.access', '2026-10-26T17:51:00+02:00');
  assert.match(msg(w, '2026-10-26T17:51:00+02:00'), /\nיעד: יום ג׳ 27\.10 09:20\n/);
});

test('both editing deadlines go to the editor, counted in business days from the assignment', () => {
  const c = client({ shoot_type: 'natali', editor: 'nirel' });
  const [o] = offer(c, { 'p22a.assigned': done('2026-10-07T15:00:00+03:00') }, 'p22a.assigned', '2026-10-07T15:05:00+03:00');
  assert.equal(msg(o, '2026-10-07T15:05:00+03:00'), [
    'היי ניראל,',
    'הלקוח מספרת רון עובר לעריכה אצלך. הכונן, התסריטים והלוגו בכרטיס הלקוח.',
    'בדרייב ואצל אופיר לבקרה: סוף יום ב׳ 12.10',
    'סגירה, כולל תיקוני הלקוח: סוף יום ג׳ 13.10',
    'כרטיס הלקוח: https://app.astrateg.com/client.html?id=c-1#p22',
  ].join('\n'));
});

test('due times: next business day at 12:00, office hours, right away, already late, or the protocol\'s words', () => {
  const c = client();
  // A Thursday evening shoot: the editor is assigned by Sunday 12:00.
  const [s] = offer(c, all('p19', '2026-10-08T19:00:00+03:00'), 'p19.took', '2026-10-08T19:01:00+03:00');
  assert.match(msg(s, '2026-10-08T19:01:00+03:00'), /^היי אופיר,\nיום הצילום של מספרת רון הסתיים\. צריך לשייך עורך ולהעביר אליו את הכונן\.\nיעד: יום א׳ 11\.10 12:00\n.*#p22a$/);
  // Ofir checks the rest of the graphics within an office hour.
  const [g] = offer(c, { 'p23.made': done('2026-10-29T10:00:00+02:00') }, 'p23.made', '2026-10-29T10:00:00+02:00');
  assert.match(msg(g, '2026-10-29T10:00:00+02:00'), /\nיעד: היום 11:00\n/);
  const [ok] = offer(c, { 'p23.ofir': done('2026-10-29T10:00:00+02:00') }, 'p23.ofir', '2026-10-29T10:00:00+02:00');
  assert.match(msg(ok, '2026-10-29T10:00:00+02:00'), /\nיעד: מיד\n/);
  // Ready for review late on Thursday (before the folder is marked): the hour runs
  // on into Sunday, the next working day.
  const [qa] = offer(c, { 'p24.notify': done('2026-10-29T17:30:00+02:00') }, 'p24.notify', '2026-10-29T17:31:00+02:00');
  assert.match(msg(qa, '2026-10-29T17:31:00+02:00'), /\nיעד: יום א׳ 1\.11 09:30\n.*#p25$/);
  // Ofir approved on Thursday: Irit sends now, Lior's campaign by the end of Sunday.
  const [irit, lior] = offer(c, all('p25', '2026-10-29T10:00:00+02:00'), 'p25.approved', '2026-10-29T10:01:00+02:00');
  assert.match(msg(irit, '2026-10-29T10:01:00+02:00'), /^היי עירית,\nאופיר אישר את הסרטונים של מספרת רון\. לשלוח אותם ללקוח לאישור\.\nיעד: מיד\n.*#p26$/);
  assert.match(msg(lior, '2026-10-29T10:01:00+02:00'), /\nיעד: סוף יום א׳ 1\.11\n.*#p30$/);
  // Nine graphics after their deadline (two hours from the meeting's end): due now, and said so.
  const [late] = offer(c, { 'p07.made': done('2026-10-19T15:00:00+03:00') }, 'p07.made', '2026-10-19T15:01:00+03:00');
  assert.match(msg(late, '2026-10-19T15:01:00+03:00'), /\nיעד: מיד \(היעד היה היום 14:00\)\n/);
  const [early] = offer(c, { 'p07.made': done('2026-10-19T13:00:00+03:00') }, 'p07.made', '2026-10-19T13:01:00+03:00');
  assert.match(msg(early, '2026-10-19T13:01:00+03:00'), /\nיעד: היום 14:00\n/);
  // Final versions before the client approved: no clock yet, so the protocol's words.
  const [fin] = offer(c, { 'p27.final': done('2026-10-29T10:00:00+02:00') }, 'p27.final', '2026-10-29T10:01:00+02:00');
  assert.match(msg(fin, '2026-10-29T10:01:00+02:00'), /\nיעד: עד שעתיים מרגע שהתוכן מוכן ומאושר\n/);
  const approved = all('p27', '2026-10-29T10:00:00+02:00');
  const { 'p27.toilai': got, ...finals } = approved;
  // Approved too: Ilai's two hours start with his "קיבלתי" (p27.toilai closes 27), so still the words.
  const [fin2] = offer(c, finals, 'p27.final', '2026-10-29T10:01:00+02:00');
  assert.match(msg(fin2, '2026-10-29T10:01:00+02:00'), /\nיעד: עד שעתיים מרגע שהתוכן מוכן ומאושר\n/);
  // Ilai already marked "קיבלתי" (p27.toilai, protocol v5): nothing to send him.
  assert.deepEqual(offer(c, approved, 'p27.final', '2026-10-29T10:01:00+02:00'), []);
  assert.ok(got);
  const [gantt] = offer(c, { ...approved, 'p29.filled': done('2026-10-29T11:00:00+02:00') }, 'p29.filled', '2026-10-29T11:01:00+02:00');
  assert.match(msg(gantt, '2026-10-29T11:01:00+02:00'), /^היי עירית,\nהגאנט של מספרת רון מלא ותואם לתזמון\. לשלוח אותו ללקוח\.\nיעד: היום 12:00\n/);
});

test('nothing to offer: another item, an unchecked one, a mark, or a message to oneself', () => {
  const c = client();
  const when = '2026-10-29T10:00:00+02:00';
  assert.deepEqual(offer(c, { 'p05.logo': done(when) }, 'p05.logo', when), []);
  assert.deepEqual(offer(c, {}, 'p05.access', when), []);
  assert.deepEqual(offer(c, { 'p05.access': { state: 'na', at: when } }, 'p05.access', when), []);
  assert.deepEqual(offer(c, { ...all('p19', when), 'p19.claim': done(when, 'lior') }, 'p19.claim', when), []);
  assert.deepEqual(offer(c, { 'p05.handoff.ilai': done(when) }, 'p05.handoff.ilai', when), []);
  assert.deepEqual(offer(c, { 'p29.filled': done(when) }, 'p29.filled', when, { from: 'irit' }), []);
  assert.deepEqual(people(offer(c, { 'p25.approved': done(when) }, 'p25.approved', when, { from: 'lior' })), ['irit']);
  assert.deepEqual(offer(c, { 'p05.access': done(when) }, 'nonsense', when), []);
});

test('the card\'s "העברות" line: what went to whom, and whether WhatsApp was opened', () => {
  const c = client();
  const now = at('2026-10-20T12:00:00+03:00');
  const checks = { 'p05.access': done('2026-10-20T11:00:00+03:00') };
  const line = (ch, id) => { const s = clientState(c, ch, now); return handoffsOf(c, ch, s, s.states.find((x) => x.proc.id === id), now); };
  const [o] = line(checks, 'p05');
  assert.deepEqual([o.person, o.done, o.sent, o.triggerKey], ['ilai', true, null, 'p05.access']);
  assert.deepEqual(line(checks, 'p06'), []);
  const sent = { ...checks, 'p05.handoff.ilai': done('2026-10-20T11:02:00+03:00') };
  assert.equal(line(sent, 'p05')[0].sent.at, '2026-10-20T11:02:00+03:00');
  // A process trigger shows once the process is complete.
  assert.deepEqual(line(all('p19', '2026-10-08T19:00:00+03:00', ['p19.all', 'p19.testimonial']), 'p19'), []);
  const p19 = line(all('p19', '2026-10-08T19:00:00+03:00'), 'p19');
  assert.deepEqual(people(p19), ['ofir']);
  assert.match(p19[0].triggerKey, /^p19\./);
  assert.equal(describeMark('p05.handoff.ilai'), 'גישות התקבלו → עילאי');
  assert.equal(describeMark('r2.p22a.handoff.editor'), 'עורך שויך → העורך המשויך');
  assert.equal(describeMark('p25.handoff.lior'), 'אופיר אישר את הסרטונים → ליאור');
  assert.equal(describeMark('p05.access'), null);
});

test('the record names whom WhatsApp was opened for: Lior when he took 22א, the editor by name', () => {
  const c = client({ shoot_type: 'natali', editor: 'nirel' });
  const when = '2026-10-08T19:00:00+03:00';
  const byLior = { ...all('p19', when), 'p22a.claim': done(when, 'lior') };
  const [o] = offer(c, byLior, 'p19.took', '2026-10-08T19:01:00+03:00');
  // A neutral key (whoever assigns the editor); the person goes in the record's note.
  assert.deepEqual([o.person, o.name, o.markKey], ['lior', 'ליאור', 'p19.handoff.assigner']);
  assert.equal(describeMark(o.markKey, 'lior'), 'יום הצילום הסתיים → ליאור');
  assert.equal(describeMark(o.markKey, 'ofir'), 'יום הצילום הסתיים → אופיר');
  assert.equal(describeMark(o.markKey), 'יום הצילום הסתיים → מי שמשייך את העורך');
  assert.equal(describeMark('p22a.handoff.editor', 'nirel'), 'עורך שויך → ניראל');
  assert.equal(describeMark('p22a.handoff.editor', 'editor'), 'עורך שויך → העורך המשויך');
  // The card's line says whom it was opened for when the editor was changed since.
  const now = at('2026-10-09T10:00:00+03:00');
  const checks = { 'p22a.assigned': done(when), 'p22a.handoff.editor': done('2026-10-08T19:05:00+03:00', 'nirel') };
  const moved = client({ shoot_type: 'natali', editor: 'nadia' });
  const s = clientState(moved, checks, now);
  const [line] = handoffsOf(moved, checks, s, s.states.find((x) => x.proc.id === 'p22a'), now);
  assert.deepEqual([line.person, line.sentTo, line.live], ['nadia', 'ניראל', true]);
});

test('closed clients and finished work: nothing to hand over', () => {
  const when = '2026-10-20T11:00:00+03:00';
  const now = at('2026-10-21T12:00:00+03:00');
  const line = (c, ch, id) => { const s = clientState(c, ch, now); return handoffsOf(c, ch, s, s.states.find((x) => x.proc.id === id), now); };
  const finished = { ...all('p05', when), ...all('p06', when), ...all('p07', when) };
  // A cancelled or ended client: no prompt and no line (with nothing sent).
  for (const status of ['cancelled', 'ended']) {
    const c = client({ status });
    assert.deepEqual(offer(c, { 'p05.access': done(when) }, 'p05.access', when), [], status);
    assert.deepEqual(line(c, finished, 'p05'), [], status);
    assert.deepEqual(line(c, finished, 'p07'), [], status);
    // What was opened in WhatsApp stays as a record, without a button.
    const sent = { ...finished, 'p05.handoff.ilai': done(when, 'ilai') };
    assert.deepEqual(line(c, sent, 'p05').map((o) => [o.markKey, o.live]), [['p05.handoff.ilai', false]], status);
  }
  const c = client({ status: 'ending' });
  assert.deepEqual(people(offer(c, { 'p05.access': done(when) }, 'p05.access', when)), ['ilai'], 'a client in its last month is still in work');
  // The next person already did their part: Ilai checked the access (6), Irit sent
  // the graphics (7), the editor was assigned (22א), the gantt went out (29).
  const active = client();
  assert.deepEqual(line(active, finished, 'p05'), []);
  assert.deepEqual(line(active, { 'p05.access': done(when), 'p06.verified': done(when) }, 'p05'), []);
  assert.deepEqual(offer(active, { 'p05.access': done(when), 'p06.verified': done(when) }, 'p05.access', when), []);
  assert.deepEqual(line(active, { 'p07.made': done(when), 'p07.sent': done(when) }, 'p07'), []);
  const shoot = all('p19', when);
  assert.deepEqual(offer(active, { ...shoot, 'p22a.assigned': done(when) }, 'p19.took', when), []);
  assert.deepEqual(line(active, { 'p29.filled': done(when), 'p29.sent': done(when) }, 'p29'), []);
  const rounds = [{ n: 2, shoot_type: 'dms', shoot_at: '2027-03-09T10:00:00+02:00', start_at: '2027-03-01T10:00:00+02:00', editor: 'anna' }];
  const r = client({ rounds });
  assert.deepEqual(line(r, { 'r2.p29.filled': done(when) }, 'r2-p29').map((o) => o.markKey), ['r2.p29.handoff.irit']);
  assert.deepEqual(line(r, { 'r2.p29.filled': done(when), 'r2.p29.sent': done(when) }, 'r2-p29'), [], 'a round\'s own items');
  assert.deepEqual(line(r, { 'r2.p29.filled': done(when), 'p29.sent': done(when) }, 'r2-p29').length, 1, 'not the first round\'s');
  // Still open: the line offers it, with a button.
  assert.deepEqual(line(active, { 'p05.access': done(when) }, 'p05').map((o) => [o.person, o.live]), [['ilai', true]]);
  // Undone after WhatsApp was opened: the record stays, the button goes.
  assert.deepEqual(line(active, { 'p05.handoff.ilai': done(when, 'ilai') }, 'p05').map((o) => [o.done, o.live]), [[false, false]]);
});

test('an offer stands while its check does', () => {
  const when = '2026-10-29T10:00:00+02:00';
  const c = client();
  const checks = { 'p05.access': done(when) };
  const [o] = offer(c, checks, 'p05.access', when);
  assert.equal(stillStands(o, c, checks), true);
  assert.equal(stillStands(o, c, {}), false);
  assert.equal(stillStands(o, { ...c, status: 'cancelled' }, checks), false);
  assert.equal(stillStands(o, c, null), false);
  // A process trigger: while the process is complete (any of its items unchecked: no).
  const p19 = all('p19', when);
  const [s] = offer(c, p19, 'p19.took', when);
  assert.equal(stillStands(s, c, p19, at(when)), true);
  const { 'p19.all': _, ...partial } = p19;
  assert.equal(stillStands(s, c, partial, at(when)), false);
});

test('wa.me links: straight to the number when known, otherwise WhatsApp asks whom to send to', () => {
  const text = 'היי עילאי,\nגישות התקבלו & הכול טוב?';
  const direct = waLink('972501234567', text);
  assert.ok(direct.startsWith('https://wa.me/972501234567?text='));
  assert.equal(decodeURIComponent(direct.split('?text=')[1]), text);
  assert.ok(waLink('+972-50-123-4567', text).startsWith('https://wa.me/972501234567?text='));
  for (const none of [null, '', 'abc', '12']) assert.ok(waLink(none, text).startsWith('https://wa.me/?text='), String(none));
  assert.equal(clientLink(PAGE, 'a b', 'r2-p24'), 'https://app.astrateg.com/client.html?id=a%20b#r2-p24');
  assert.equal(clientLink(PAGE, 'c-1'), 'https://app.astrateg.com/client.html?id=c-1');
});

test('due times are written on the office clock, whatever the zone of the machine', () => {
  const now = at('2026-10-25T23:30:00+02:00'); // Sunday night, just after the move to winter time
  assert.equal(whenText(at('2026-10-25T23:59:00+02:00'), now), 'סוף היום');
  assert.equal(whenText(at('2026-10-26T00:30:00+02:00'), now), 'יום ב׳ 26.10 00:30');
  assert.equal(whenText(at('2026-10-24T22:30:00Z'), now), 'היום 01:30'); // still summer time: 01:30, the same Sunday
  assert.equal(whenText(at('2026-10-31T22:30:00Z'), now), 'יום א׳ 1.11 00:30'); // Saturday in UTC, Sunday in Israel
  assert.equal(whenText(at('2026-11-05T21:59:00Z'), now), 'סוף יום ה׳ 5.11');
});
