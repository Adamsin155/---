// The Metricool line of the client card (the owner, 20.10.2026): who sees it, who
// connects, and its words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { seesMetricool, connectsMetricool, metricoolWords } from '../app/card-metricool.js';

test('the office and Ilai see the line; the editors and the photographer do not', () => {
  assert.equal(seesMetricool({ me: null, scope: 'office' }), true); // the owner
  for (const me of ['irit', 'lior', 'ofir']) assert.equal(seesMetricool({ me, scope: 'office' }), true, me);
  assert.equal(seesMetricool({ me: 'ilai', scope: 'own' }), true);
  for (const me of ['nadia', 'yariv', 'eli']) assert.equal(seesMetricool({ me, scope: 'own' }), false, me);
  assert.equal(seesMetricool({ me: 'irit', scope: 'office', error: 'x' }), false);
});

test('only Ilai and the owner are offered the way to connect', () => {
  assert.equal(connectsMetricool({ me: 'ilai', scope: 'own' }), true);
  assert.equal(connectsMetricool({ me: null, scope: 'office' }), true);
  for (const me of ['irit', 'lior', 'ofir']) assert.equal(connectsMetricool({ me, scope: 'office' }), false, me);
  assert.equal(connectsMetricool({ me: null, scope: 'own' }), false); // a person the protocol does not know
});

test('the words: connected, not connected, marked without a brand, and the failed posts', () => {
  assert.equal(metricoolWords({ brand: undefined }), null); // before the migration: no line
  assert.deepEqual(metricoolWords({ brand: { blogId: '12', brand: 'וולף פילאטיס' } }), { text: 'מחובר ל־וולף פילאטיס', tone: 'ok', failed: null, connect: false });
  assert.deepEqual(metricoolWords({ brand: { blogId: null, brand: null } }), { text: 'לא מחובר', tone: 'warn', failed: null, connect: true });
  assert.equal(metricoolWords({ brand: { blogId: null }, none: true }).text, 'סומן שאין ללקוח מותג');
  assert.equal(metricoolWords({ brand: { blogId: null }, none: true }).connect, false);
  assert.equal(metricoolWords({ brand: { blogId: '1', brand: 'x' }, failed: 1 }).failed, 'פרסום אחד נכשל');
  const three = metricoolWords({ brand: { blogId: '1', brand: 'x' }, failed: 3 });
  assert.equal(three.failed, '3 פרסומים נכשלו');
  assert.equal(three.tone, 'warn');
});
