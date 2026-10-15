// The calendar page (calendar.html, app/calendar-view.js; the owner's request of
// 15.10.2026): who sees which events (the office every meeting and shoot day, everyone
// else only their own, the field sales nothing), the weeks and months in Israel days
// (Sunday first, across the clock changes, in any zone of the machine), and the
// invitation: a Google Calendar template with the right guests, properly encoded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  seesCalendar, sendsInvites, calendarEvents, byDay, weekDays, weekStart, monthWeeks, rangeOf, shift, titleOf, addDays,
  dayOf, timeText, inviteFor, emailsOf, clientEmails, guestNames, KINDS,
} from '../app/calendar-view.js';
import { googleCalendarUrl, cleanGuests } from '../app/calendar.js';
import { buildWorld, NOW, emailOf, ROLES } from './roles-world.mjs';

const v = (me, scope = me ? (['irit', 'lior', 'ofir'].includes(me) ? 'office' : ['stav', 'amos'].includes(me) ? 'sales' : 'own') : 'office') => ({ me, scope, error: null });
const OWNER = v(null);
const cid = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const week = rangeOf('week', '2026-10-20');

// What the database would hand each person (RLS): the office every client; an editor hers.
const world = () => buildWorld();
const of = (viewer, db = world(), range = week) => calendarEvents({
  viewer, clients: viewer.scope === 'office' ? db.clients : db.clients.filter((c) => c.editor === viewer.me),
  checks: {}, tasks: db.client_tasks, now: NOW, from: range.from, until: range.until, site: 'https://app.astrateg.tech/',
});

test('who has the page, and who sends invitations', () => {
  for (const who of [OWNER, v('irit'), v('lior'), v('ofir')]) { assert.equal(seesCalendar(who), true); assert.equal(sendsInvites(who), true, who.me || 'owner'); }
  for (const who of ['ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli'].map((p) => v(p))) { assert.equal(seesCalendar(who), true, who.me); assert.equal(sendsInvites(who), false, who.me); }
  for (const who of ['stav', 'amos'].map((p) => v(p))) { assert.equal(seesCalendar(who), false, who.me); assert.equal(sendsInvites(who), false); }
  assert.equal(seesCalendar({ me: null, scope: 'own', error: new Error('x') }), false);
  assert.equal(seesCalendar({ me: null, scope: 'own', error: null }), false, 'an unidentified person is not assumed to be anyone');
  assert.equal(seesCalendar(null), false);
});

test('the office sees every meeting and shoot day of the week; an ended client is not there', () => {
  const evs = of(v('irit'));
  const meetings = evs.filter((e) => e.kind === 'char').map((e) => e.client).sort();
  const shoots = evs.filter((e) => e.kind === 'shoot').map((e) => e.client).sort();
  assert.deepEqual(meetings, [cid(5), cid(6)]);                       // 19.10 and 20.10
  assert.deepEqual(shoots, [cid(7), cid(10), cid(11), cid(16)].sort()); // 18.10 to 21.10
  // Her own task with a due day is there too; deadlines are not (they live on "המשימות שלי").
  assert.deepEqual(evs.filter((e) => e.kind === 'task').map((e) => e.client), [cid(13)]);
  assert.equal(evs.filter((e) => e.kind === 'due').length, 0);
  assert.ok(evs.every((e) => e.client !== cid(22)), 'the ended client');
  // No event twice (the owner's overview and her own feed share the shoot days).
  assert.equal(new Set(evs.map((e) => e.uid)).size, evs.length);
  // The owners and Ofir see the same meetings and shoot days.
  for (const who of [OWNER, v('ofir'), v('lior')]) {
    const e2 = of(who);
    assert.deepEqual(e2.filter((e) => e.kind === 'char' || e.kind === 'shoot').map((e) => e.uid).sort(), evs.filter((e) => e.kind === 'char' || e.kind === 'shoot').map((e) => e.uid).sort(), who.me || 'owner');
  }
  // Sorted by the moment.
  const t = evs.map((e) => (e.allDay ? Date.parse(`${e.allDay}T00:00:00+03:00`) : new Date(e.start).getTime()));
  assert.deepEqual(t, [...t].sort((a, b) => a - b));
});

test('an archived (not returned) or cancelled client, and a client in landing', () => {
  const db = world();
  db.clients.find((c) => c.id === cid(7)).status = 'cancelled';
  const c10 = db.clients.find((c) => c.id === cid(10));
  c10.landing = true;
  const evs = of(v('irit'), db);
  assert.ok(!evs.some((e) => e.client === cid(7)), 'cancelled');
  assert.ok(evs.some((e) => e.client === cid(10) && e.kind === 'shoot'), 'in landing: its dates are real, it is shown');
});

test('an editor sees only her own work; Eli his shoot days; Ilai his; the sales nothing', () => {
  const nadia = of(v('nadia'));
  assert.ok(nadia.length > 0);
  assert.ok(nadia.every((e) => [cid(12), cid(13), cid(19)].includes(e.client)), 'only her clients');
  assert.ok(nadia.every((e) => e.kind === 'due' || e.kind === 'task'), 'no meeting or shoot day of anyone');
  assert.ok(nadia.some((e) => e.kind === 'task' && e.client === cid(12)));
  const db = world();
  const eli = calendarEvents({ viewer: v('eli'), clients: db.clients.filter((c) => c.shoot_at), checks: {}, tasks: db.client_tasks, now: NOW, from: week.from, until: week.until });
  assert.deepEqual(eli.filter((e) => e.kind === 'shoot').map((e) => e.client).sort(), [cid(7), cid(10), cid(11), cid(16)].sort());
  assert.ok(eli.every((e) => e.kind !== 'char'));
  assert.deepEqual(of(v('stav')), []);
});

test('a range far from today still has its events (the page is not the feed\'s window)', () => {
  const db = world();
  db.clients.find((c) => c.id === cid(8)).shoot_at = '2027-06-15T10:00:00+03:00'; // eight months ahead
  const june = rangeOf('month', '2027-06-01');
  const evs = of(v('irit'), db, june);
  assert.deepEqual(evs.filter((e) => e.kind === 'shoot').map((e) => e.client), [cid(8)]);
  assert.equal(dayOf(evs.find((e) => e.kind === 'shoot')), '2027-06-15');
});

test('weeks start on Sunday in Israel; months are whole weeks', () => {
  assert.equal(weekStart('2026-10-20'), '2026-10-18');
  assert.equal(weekStart('2026-10-18'), '2026-10-18');
  assert.equal(weekStart('2026-10-24'), '2026-10-18');
  assert.deepEqual(weekDays('2026-10-20'), ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24']);
  const oct = monthWeeks('2026-10-20');
  assert.equal(oct.month, '2026-10');
  assert.deepEqual(oct.weeks.map((w) => w[0]), ['2026-09-27', '2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25']);
  assert.equal(oct.weeks.at(-1)[6], '2026-10-31');
  assert.equal(monthWeeks('2027-01-05').weeks.length, 6, 'January 2027 starts on a Friday and needs six rows');
  assert.equal(monthWeeks('2026-02-10').weeks.length, 4, 'February 2026 starts on a Sunday: four rows');
  assert.equal(shift('week', '2026-10-20', 1), '2026-10-27');
  assert.equal(shift('week', '2026-10-20', -1), '2026-10-13');
  assert.equal(shift('month', '2026-10-31', 1), '2026-11-01');
  assert.equal(shift('month', '2026-01-31', -1), '2025-12-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(titleOf('month', '2026-10-20'), 'אוקטובר 2026');
  assert.equal(titleOf('week', '2026-10-20'), '18–24 באוקטובר 2026');
  assert.equal(titleOf('week', '2026-09-29'), '27.9–3.10.2026');
  assert.equal(titleOf('week', '2026-12-30'), '27.12.2026–2.1.2027');
});

test('the clock changes: the week of 25.10.2026 (winter time) and of 26.3.2027 (summer time)', () => {
  // Israel goes back an hour on Sunday 25.10.2026 at 02:00.
  const w = rangeOf('week', '2026-10-27');
  assert.equal(w.first, '2026-10-25');
  assert.equal(w.from.toISOString(), '2026-10-24T21:00:00.000Z');  // midnight, summer time
  assert.equal(w.until.toISOString(), '2026-10-31T21:59:59.999Z'); // the end of Saturday, winter time
  assert.deepEqual(weekDays('2026-10-25'), ['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31']);
  // Forward on Friday 26.3.2027: seven distinct days still, and the month has every day once.
  assert.deepEqual(weekDays('2027-03-26'), ['2027-03-21', '2027-03-22', '2027-03-23', '2027-03-24', '2027-03-25', '2027-03-26', '2027-03-27']);
  const march = monthWeeks('2027-03-01').weeks.flat().filter((d) => d.startsWith('2027-03'));
  assert.equal(new Set(march).size, 31);
  // An event at 01:30 on the night of the change, and one at 23:30 on the Saturday, fall on their own Israel days.
  const db = world();
  db.clients.find((c) => c.id === cid(7)).char_at = '2026-10-25T01:30:00+03:00';
  db.clients.find((c) => c.id === cid(8)).char_at = '2026-10-31T23:30:00+02:00';
  const days = byDay(of(v('irit'), db, w));
  assert.ok(days['2026-10-25'].some((e) => e.kind === 'char' && e.client === cid(7)));
  assert.ok(days['2026-10-31'].some((e) => e.kind === 'char' && e.client === cid(8)));
  assert.equal(timeText(days['2026-10-31'].find((e) => e.client === cid(8))), '23:30 עד 01:30');
});

test('byDay: a whole day first, then by the hour', () => {
  const evs = [
    { uid: 'b', kind: 'char', start: new Date('2026-10-20T13:00:00+03:00'), minutes: 120 },
    { uid: 'a', kind: 'task', allDay: '2026-10-20' },
    { uid: 'c', kind: 'shoot', start: new Date('2026-10-20T09:00:00+03:00'), minutes: 240 },
  ];
  assert.deepEqual(byDay(evs)['2026-10-20'].map((e) => e.uid), ['a', 'c', 'b']);
  assert.equal(timeText(evs[1]), 'כל היום');
  assert.equal(timeText(evs[2]), '09:00 עד 13:00');
  assert.ok(KINDS.char && KINDS.shoot);
});

test('googleCalendarUrl: guests go in "add", once each, and only real emails', () => {
  const url = new URL(googleCalendarUrl({ title: 'פגישה', start: '2026-10-21T10:00:00+03:00', minutes: 60, guests: ['A@x.co.il', 'a@x.co.il', 'not an email', null, 'b@y.com,c@z.com', 'ofir@astrateg.test'] }));
  assert.equal(url.searchParams.get('add'), 'a@x.co.il,ofir@astrateg.test');
  assert.match(url.search, /add=a%40x\.co\.il%2Cofir%40astrateg\.test/);
  assert.equal(url.searchParams.get('dates'), '20261021T070000Z/20261021T080000Z');
  // With no guests nothing changes from before.
  assert.equal(new URL(googleCalendarUrl({ title: 'x', start: '2026-10-21T10:00:00+03:00' })).searchParams.has('add'), false);
  assert.deepEqual(cleanGuests([' X@Y.com ', 'x@y.com']), ['x@y.com']);
});

test('the invitation of a meeting: the client and the characterizer, the place, the card', () => {
  const db = world();
  const directory = Object.fromEntries(db.staff.filter((s) => s.person).map((s) => [s.email, s.person]));
  const emails = emailsOf(directory);
  assert.equal(emails.ofir, emailOf('ofir'));
  const evs = of(v('irit'), db);
  const meet = evs.find((e) => e.kind === 'char' && e.client === cid(6));
  const client = db.clients.find((c) => c.id === cid(6));
  const inv = inviteFor(meet, { client, emails, clientEmail: 'Shira@Example.co.il', site: 'https://app.astrateg.tech/' });
  const u = new URL(inv.url);
  assert.equal(u.origin + u.pathname, 'https://calendar.google.com/calendar/render');
  assert.equal(u.searchParams.get('action'), 'TEMPLATE');
  assert.equal(u.searchParams.get('text'), 'פגישת אפיון · שירה קונדיטוריה');
  assert.equal(u.searchParams.get('dates'), '20261020T100000Z/20261020T120000Z'); // 13:00 to 15:00 in Israel
  assert.equal(u.searchParams.get('location'), 'הרצל 10, תל אביב');
  assert.equal(u.searchParams.get('add'), `shira@example.co.il,${emailOf('ofir')}`);
  assert.match(u.searchParams.get('details'), /כרטיס הלקוח במערכת: https:\/\/app\.astrateg\.tech\/client\.html\?id=c0000000-0000-4000-8000-000000000006/);
  assert.match(u.searchParams.get('details'), /מבצע\/ת האפיון: אופיר/);
  assert.equal(guestNames(inv), 'הלקוח ואופיר');
  // Lior characterizes: he is the one invited.
  client.characterizer = 'lior';
  const byLior = inviteFor(meet, { client, emails, site: '' });
  assert.deepEqual(byLior.guests, [emailOf('lior')]);
  assert.equal(byLior.withClient, false);
  assert.equal(guestNames(byLior), 'ליאור');
  // No email for the client: the invitation goes to the staff alone, and says so.
  assert.equal(guestNames(inviteFor(meet, { client: { ...client, characterizer: 'ofir' }, emails })), 'אופיר');
});

test('the invitation of a shoot day: the client, Lior and Eli, from the team\'s arrival; none for a task or a deadline', () => {
  const db = world();
  const emails = emailsOf(Object.fromEntries(db.staff.filter((s) => s.person).map((s) => [s.email, s.person])));
  const evs = of(v('irit'), db);
  const shoot = evs.find((e) => e.kind === 'shoot' && e.client === cid(7)); // influencers at 10:00, dms
  const client = db.clients.find((c) => c.id === cid(7));
  const inv = inviteFor(shoot, { client, emails, clientEmail: 'omer@dayan.co.il' });
  const u = new URL(inv.url);
  assert.equal(u.searchParams.get('text'), 'יום צילום · דיין רהיטים');
  assert.equal(u.searchParams.get('dates'), '20261021T060000Z/20261021T123000Z'); // 09:00, 6.5 hours (dms)
  assert.equal(u.searchParams.get('add'), `omer@dayan.co.il,${emailOf('lior')},${emailOf('eli')}`);
  assert.match(u.searchParams.get('details'), /הגעת המשפיענים: 10:00/);
  assert.equal(guestNames(inv), 'הלקוח, ליאור ואלי');
  // A second round says its number.
  const round = inviteFor({ ...shoot, round: 2, shootType: 'natali' }, { client, emails });
  assert.equal(new URL(round.url).searchParams.get('text'), 'יום צילום 2 · דיין רהיטים');
  assert.equal(new URL(round.url).searchParams.get('dates'), '20261021T060000Z/20261021T100000Z'); // Natali: 4 hours
  // Only meetings and shoot days are invited to.
  for (const e of evs.filter((x) => x.kind !== 'char' && x.kind !== 'shoot')) assert.equal(inviteFor(e, { client, emails }), null, e.kind);
  assert.equal(inviteFor(shoot, { client: null, emails }), null);
});

test('the client\'s email comes from its agreement; none without one', () => {
  const clients = [{ id: 'a', quote_id: 'q1' }, { id: 'b', quote_id: 'q2' }, { id: 'c', quote_id: null }, { id: 'd', quote_id: 'q9' }];
  const facts = [{ id: 'q1', client: { email: ' Owner@Shop.co.il ' } }, { id: 'q2', client: { email: '' } }, { id: 'q9', client: null }];
  assert.deepEqual(clientEmails(clients, facts), { a: 'owner@shop.co.il' });
  assert.deepEqual(clientEmails(clients, null), {});
  assert.ok(Object.keys(ROLES).length);
});
