// "פגישה חדשה" on the calendar page (app/new-meeting-logic.js; the owner, 21.10.2026):
// who has it, finding a client, what is missing, and the Google invitation of each kind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addsMeetings, searchClients, checkMeeting, meetingInvite, MEET_PEOPLE } from '../app/new-meeting-logic.js';

const C = [
  { id: 'c1', name: 'אבי לוי', business: 'פיצה נאפולי', status: 'active', characterizer: 'ofir', shoot_type: 'dms', address: 'הרצל 1' },
  { id: 'c2', name: 'מיכל שחר', business: 'קליניקת שחר', status: 'active', characterizer: null, shoot_type: 'natali', address: '' },
  { id: 'c3', name: 'דנה', business: 'פיצה רומא', status: 'ended' },
  { id: 'c4', name: 'גיל', business: 'פיצה של גיל', status: 'active', archived_at: '2026-10-01' },
];
const EMAILS = { ofir: 'ofir@astrateg.test', lior: 'lior@astrateg.test', eli: 'eli@astrateg.test' };
const AT = new Date('2026-10-22T08:00:00.000Z'); // Thursday 11:00 in Israel

test('who: the owners, Irit, Lior and Ofir; not Ilai, an editor, sales or an unknown viewer', () => {
  for (const me of [null, 'irit', 'lior', 'ofir']) assert.equal(addsMeetings({ scope: 'office', me }), true, String(me));
  assert.equal(addsMeetings({ scope: 'office', me: 'ilai' }), false);
  assert.equal(addsMeetings({ scope: 'editor', me: 'nadia' }), false);
  assert.equal(addsMeetings({ scope: 'sales', me: 'stav' }), false);
  assert.equal(addsMeetings({ error: 'x' }), false);
  assert.equal(addsMeetings(null), false);
  assert.deepEqual(MEET_PEOPLE, ['ofir', 'lior']);
});

test('finding a client: every word typed starts a word of the business or the name; open clients only', () => {
  assert.deepEqual(searchClients(C, 'פיצה').map((c) => c.id), ['c1']);
  assert.deepEqual(searchClients(C, 'נאפ').map((c) => c.id), ['c1']);
  assert.deepEqual(searchClients(C, 'שחר מיכ').map((c) => c.id), ['c2']);
  assert.deepEqual(searchClients(C, '  '), []);
  assert.deepEqual(searchClients(C, 'רומא'), [], 'an ended client');
  assert.deepEqual(searchClients(C, 'גיל'), [], 'an archived client');
});

test('what is missing', () => {
  assert.equal(checkMeeting({ kind: 'char', client: C[0], at: AT, person: 'ofir' }), null);
  assert.equal(checkMeeting({ kind: 'char', client: null, at: AT, person: 'ofir' }), 'בוחרים לקוח.');
  assert.equal(checkMeeting({ kind: 'char', client: C[0], at: null, person: 'ofir' }), 'בוחרים יום ושעה לפגישה.');
  assert.equal(checkMeeting({ kind: 'char', client: C[0], at: AT, person: 'irit' }), 'בוחרים מי מבצע את האפיון.');
  assert.equal(checkMeeting({ kind: 'shoot', client: C[0], at: AT, type: null }), 'בוחרים עם מי מצלמים.');
  assert.equal(checkMeeting({ kind: 'shoot', client: C[0], at: null, type: 'dms' }), 'בוחרים יום ושעה ליום הצילום.');
  assert.equal(checkMeeting({ kind: 'other', client: null, at: AT, title: ' ' }), 'כותבים במה מדובר.');
  assert.equal(checkMeeting({ kind: 'other', client: null, at: AT, title: 'שיחת היכרות' }), null, 'no client is needed');
  assert.equal(checkMeeting({ kind: 'x' }), 'בוחרים איזו פגישה.');
});

test('the invitations: a meeting with the characterizer, a shoot day an hour before the influencers, another meeting', () => {
  const char = meetingInvite({ kind: 'char', client: C[1], at: AT, person: 'lior', emails: EMAILS, clientEmail: 'Michal@Example.com', site: 'https://app/' });
  const q = new URL(char.url).searchParams;
  assert.equal(q.get('text'), 'פגישת אפיון · קליניקת שחר');
  assert.equal(q.get('dates'), '20261022T080000Z/20261022T100000Z');
  assert.equal(q.get('add'), 'michal@example.com,lior@astrateg.test');
  assert.deepEqual(char.people, ['lior']);
  const shoot = new URL(meetingInvite({ kind: 'shoot', client: C[0], at: AT, type: 'natali', emails: EMAILS, site: 'https://app/' }).url).searchParams;
  assert.equal(shoot.get('text'), 'יום צילום · פיצה נאפולי');
  assert.ok(shoot.get('dates').startsWith('20261022T070000Z/'), 'the team an hour before');
  assert.equal(shoot.get('add'), 'lior@astrateg.test,eli@astrateg.test');
  assert.match(shoot.get('details'), /הגעת המשפיענים: 11:00/);
  const other = meetingInvite({ kind: 'other', client: C[0], at: AT, title: ' שיחת היכרות ', clientEmail: 'avi@example.com', site: 'https://app/' });
  const o = new URL(other.url).searchParams;
  assert.equal(o.get('text'), 'שיחת היכרות · פיצה נאפולי');
  assert.equal(o.get('dates'), '20261022T080000Z/20261022T090000Z');
  assert.equal(o.get('add'), 'avi@example.com');
  assert.equal(o.get('location'), 'הרצל 1');
  assert.match(o.get('details'), /client\.html\?id=c1/);
  const bare = new URL(meetingInvite({ kind: 'other', at: AT, title: 'ישיבת צוות' }).url).searchParams;
  assert.equal(bare.get('text'), 'ישיבת צוות');
  assert.equal(bare.get('add'), null);
});
