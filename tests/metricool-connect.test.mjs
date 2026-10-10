// "לקוחות שלא מחוברים ל-Metricool" (app/metricool-connect-logic.js; docs/ops.md, section
// 33): who has the card, which clients are in it and in what order, what leaves it
// (a brand, or "ללקוח אין מותג"), the select of one client (the suggestion by name, the
// brands other clients use), and the words. The migration's file is checked as the
// deploy tool reads it. `npm test` runs this under three time zones.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CONNECTORS, canConnect, showsCard, CONNECT_CAP, clientLabel, unconnected, withoutBrand, takenBy, brandChoices, optionText, sinceText, cardTitle, withoutTitle, ganttUrl, explainConnect,
} from '../app/metricool-connect-logic.js';
import { PROTOCOL_VERSION } from '../app/protocol.js';

const mk = (id, fields = {}) => ({
  id, name: `איש ${id}`, business: `עסק ${id}`, status: 'active', deal_at: '2026-06-01T09:00:00+03:00', archived_at: null,
  metricool_blog_id: null, metricool_brand: null, metricool_none: false, ...fields,
});
const ids = (list) => list.map((c) => c.id);

test('who has the card: Ilai and the owner, nobody else', () => {
  assert.deepEqual(CONNECTORS, ['owner', 'ilai']);
  const viewer = (me, scope = 'office') => ({ me, scope, error: null });
  assert.equal(canConnect(viewer('ilai')), true);
  assert.equal(canConnect(viewer(null)), true, 'the owner: an office login with no person');
  for (const me of ['irit', 'lior', 'ofir']) assert.equal(canConnect(viewer(me)), false, me);
  for (const me of ['nadia', 'nirel', 'eli', 'stav', 'amos']) assert.equal(canConnect(viewer(me, 'own')), false, me);
  assert.equal(canConnect(viewer(null, 'own')), false, 'a login with no role');
  assert.equal(canConnect({ me: 'ilai', scope: 'office', error: 'x' }), false, 'an unknown viewer');
  assert.equal(canConnect(null), false);
});

// 8.10.2026: connecting the clients is Ilai's task. The owners may connect too, but the
// card is not among their own tasks: only in the manager profile's "עבודת הצוות".
test('where the card is shown: always for Ilai; for the owners not in the personal profile', () => {
  const viewer = (me, scope = 'office') => ({ me, scope, error: null });
  for (const personal of [false, true]) assert.equal(showsCard(viewer('ilai'), personal), true, `Ilai, personal=${personal}`);
  assert.equal(showsCard(viewer(null), true), false, 'the owner, in "המשימות שלי"');
  assert.equal(showsCard(viewer(null), false), true, 'the owner, in the manager profile');
  assert.equal(showsCard(viewer(null)), true);
  for (const me of ['irit', 'lior', 'ofir']) for (const personal of [false, true]) assert.equal(showsCard(viewer(me), personal), false, me);
  for (const me of ['nadia', 'nirel', 'eli', 'stav', 'amos']) assert.equal(showsCard(viewer(me, 'own'), false), false, me);
  assert.equal(showsCard(null, false), false);
});

test('the list: active and ending clients with no brand, the oldest deal first', () => {
  const clients = [
    mk('new', { deal_at: '2026-09-20T09:00:00+03:00' }),
    mk('old', { deal_at: '2025-11-02T09:00:00+02:00' }),
    mk('mid', { deal_at: '2026-03-15T09:00:00+02:00', status: 'ending' }),
    mk('nodate', { deal_at: null }),
    mk('mapped', { deal_at: '2025-01-01T09:00:00+02:00', metricool_blog_id: '101', metricool_brand: 'A' }),
    mk('ended', { deal_at: '2025-01-01T09:00:00+02:00', status: 'ended' }),
    mk('cancelled', { deal_at: '2025-01-01T09:00:00+02:00', status: 'cancelled' }),
    mk('archived', { deal_at: '2025-01-01T09:00:00+02:00', archived_at: '2026-08-01T09:00:00+03:00' }),
    mk('none', { deal_at: '2025-01-01T09:00:00+02:00', metricool_none: true }),
  ];
  assert.deepEqual(ids(unconnected(clients)), ['old', 'mid', 'new', 'nodate']);
  assert.deepEqual(ids(unconnected([...clients].reverse())), ['old', 'mid', 'new', 'nodate'], 'whatever order they came in');
  assert.deepEqual(ids(withoutBrand(clients)), ['none']);
  assert.deepEqual(unconnected(null), []);
  assert.deepEqual(unconnected([]), []);
  // The same deal date: by the name, so the order never jumps between two reads.
  assert.deepEqual(ids(unconnected([mk('b', { business: 'בית' }), mk('a', { business: 'אבא' })])), ['a', 'b']);
});

test('a client leaves the list when it gets a brand or is marked "אין מותג", and comes back when the mark is undone', () => {
  const c = mk('x');
  const clients = [c, mk('y', { deal_at: '2026-07-01T09:00:00+03:00' })];
  assert.deepEqual(ids(unconnected(clients)), ['x', 'y']);
  c.metricool_blog_id = '55';
  assert.deepEqual(ids(unconnected(clients)), ['y']);
  assert.deepEqual(withoutBrand(clients), []);
  c.metricool_blog_id = null;
  c.metricool_none = true;
  assert.deepEqual(ids(unconnected(clients)), ['y']);
  assert.deepEqual(ids(withoutBrand(clients)), ['x']);
  c.metricool_none = false;
  assert.deepEqual(ids(unconnected(clients)), ['x', 'y']);
  // Before the mark's migration the column is not read at all: everyone with no brand is listed.
  const { metricool_none: _gone, ...early } = mk('early');
  assert.deepEqual(ids(unconnected([early])), ['early']);
  assert.deepEqual(withoutBrand([early]), []);
});

test('the select of one client: the suggestion by name is chosen in advance, a brand another client uses cannot be', () => {
  const brands = [{ id: '1', label: 'Cafe Dana', networks: [] }, { id: '2', label: 'פיצה רון', networks: ['instagram'] }, { id: '3', label: 'מספרת יעל', networks: [] }];
  const ron = mk('ron', { name: 'רון כהן', business: 'פיצה רון' });
  const yael = mk('yael', { name: 'יעל', business: 'מספרת יעל', metricool_blog_id: '3' });
  const other = mk('other', { name: 'משה', business: 'מוסך הצפון' });
  const clients = [ron, yael, other];
  assert.deepEqual(takenBy(clients, 'ron'), ['3']);
  assert.deepEqual(takenBy(clients, 'yael'), [], 'its own brand is not taken from itself');
  const forRon = brandChoices(ron, brands, takenBy(clients, 'ron'));
  assert.equal(forRon.pick, '2');
  assert.deepEqual(forRon.options.map((o) => [o.id, o.taken, o.suggested]), [['1', false, false], ['2', false, true], ['3', true, false]]);
  assert.deepEqual(forRon.options.map(optionText), ['Cafe Dana', 'פיצה רון (הצעה לפי השם)', 'מספרת יעל (מחובר ללקוח אחר)']);
  // No name close enough: nothing is chosen for him.
  assert.equal(brandChoices(other, brands, takenBy(clients, 'other')).pick, '');
  // The brand that fits by name is taken: it is not suggested.
  const twin = mk('twin', { name: 'יעל', business: 'מספרת יעל' });
  assert.equal(brandChoices(twin, brands, ['3']).pick, '');
  assert.deepEqual(brandChoices(ron, [], []), { options: [], pick: '' });
  assert.deepEqual(brandChoices(ron, null, []), { options: [], pick: '' });
});

test('the words', () => {
  assert.equal(cardTitle(52), 'לקוחות שלא מחוברים ל־Metricool (52)');
  assert.equal(withoutTitle(3), 'סומנו ״אין מותג״ (3)');
  assert.equal(clientLabel({ name: 'רון כהן', business: 'פיצה רון' }), 'פיצה רון · רון כהן');
  assert.equal(clientLabel({ name: 'קפה דנה', business: 'קפה דנה' }), 'קפה דנה');
  assert.equal(clientLabel({ name: 'רון כהן', business: null }), 'רון כהן');
  assert.equal(ganttUrl('a b'), 'gantt.html?id=a%20b');
  assert.equal(CONNECT_CAP, 8);
  // The day in Israel, whatever the machine's zone: 23:30 UTC on the 14th is the 15th there.
  assert.equal(sinceText('2026-03-14T23:30:00Z'), 'עסקה מ־15.3.2026');
  assert.equal(sinceText('2026-06-01T09:00:00+03:00'), 'עסקה מ־1.6.2026');
  assert.equal(sinceText(null), '');
  assert.equal(sinceText('not a date'), '');
  assert.equal(explainConnect({ message: 'brand_taken: this brand is connected to another client', code: 'P0001' }), 'המותג הזה כבר מחובר ללקוח אחר.');
  assert.equal(explainConnect({ message: 'connected: this client is connected to a brand' }), 'הלקוח כבר מחובר למותג. הרשימה רועננה.');
  assert.equal(explainConnect({ message: 'not allowed', code: '42501' }), 'רק עילאי והבעלים מחברים לקוח למותג.');
  assert.equal(explainConnect({ message: 'client not found' }), 'הלקוח לא נמצא. הרשימה רועננה.');
  assert.equal(explainConnect(new Error('boom')), 'לא נשמר. נסו שוב.');
});

test('the migration as the deploy tool reads it: nothing is removed, and it can run twice', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261012100000_metricool_none.sql', import.meta.url), 'utf8');
  for (const word of ['drop', 'delete', 'truncate']) assert.equal(new RegExp(`\\b${word}\\b`, 'i').test(sql), false, `the file has the word "${word}"`);
  assert.match(sql, /add column if not exists metricool_none /);
  assert.match(sql, /create or replace trigger clients_metricool_none_guard /);
  assert.equal((sql.match(/create or replace function /g) || []).length, 2);
  assert.equal(/create (table|policy|index|function|trigger) /i.test(sql.replace(/create or replace (function|trigger) /gi, '')), false, 'everything it creates can be created again');
});

test('the protocol did not change: the card is not a protocol item', () => {
  assert.equal(PROTOCOL_VERSION, 9); // 9 since 10.10.2026 (docs/ops.md, section 57); this feature itself did not move it
});
