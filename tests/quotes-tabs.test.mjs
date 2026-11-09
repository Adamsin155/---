// "הצעות שנשלחו": three tabs and nothing else (the owner, 9.11.2026; docs/ops.md, section 118):
// ממתין לחתימה, נחתם, פג תוקף (only one the client opened). Run: node --test tests/quotes-tabs.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUOTE_TABS, quoteTab, tabOfHash, waitsForSignature, UNSIGNED_FILTER } from '../app/unsigned-logic.js';
import { monthChoices } from '../app/quotes-month.js';
import { DOC_TYPES } from '../app/catalog.js';

const now = new Date('2026-11-09T10:00:00+02:00');
const later = '2026-11-12T10:00:00+02:00';
const past = '2026-11-08T10:00:00+02:00';
// As the list reads them: signable and valid as the text PostgREST returns.
const q = (x = {}) => ({ id: 'q', status: 'sent', signable: 'true', valid: '168', created_at: '2026-11-05T10:00:00+02:00', expires_at: later, approval: 'none', ...x });

test('the three tabs, in this order, with these words', () => {
  assert.deepEqual(QUOTE_TABS.map((t) => t.key), [UNSIGNED_FILTER, 'signed', 'expired']);
  assert.deepEqual(QUOTE_TABS.map((t) => t.label), ['ממתין לחתימה', 'נחתם', 'פג תוקף']);
});

test('which tab a row is in', () => {
  // Waits: exactly the count of "המשימות שלי" (waitsForSignature), opened or not.
  assert.equal(quoteTab(q(), now), UNSIGNED_FILTER);
  assert.equal(quoteTab(q({ first_viewed_at: past }), now), UNSIGNED_FILTER);
  assert.equal(waitsForSignature(q(), now), true);
  // Signed: a quote, an old system's contract, a contract uploaded by hand.
  assert.equal(quoteTab(q({ status: 'signed', signed_at: past }), now), 'signed');
  assert.equal(quoteTab({ legacy: 7, status: 'signed', signable: 'true', created_at: past }, now), 'signed');
  assert.equal(quoteTab({ manual: 'm1', status: 'signed', signable: 'true', created_at: past }, now), 'signed');
  // Expired: only one the client opened (option א); never opened, it is not listed.
  assert.equal(quoteTab(q({ expires_at: past, first_viewed_at: '2026-11-06T10:00:00+02:00' }), now), 'expired');
  assert.equal(quoteTab(q({ expires_at: past }), now), null);
});

test('everything else is not listed at all', () => {
  assert.equal(quoteTab(q({ status: 'cancelled' }), now), null, 'cancelled');
  assert.equal(quoteTab(q({ signable: 'false' }), now), null, 'view-only, not seen');
  assert.equal(quoteTab(q({ signable: 'false', first_viewed_at: past }), now), null, 'view-only, seen');
  assert.equal(quoteTab(q({ signable: 'false', expires_at: past, first_viewed_at: past }), now), null, 'view-only, expired');
  assert.equal(quoteTab(q({ approval: 'rejected' }), now), null, 'turned down by a manager');
  assert.equal(quoteTab(q({ approval: 'rejected', expires_at: past, first_viewed_at: past }), now), null, 'turned down, expired');
  assert.equal(quoteTab(q({ approval: 'pending' }), now), null, 'still marked pending');
  assert.equal(quoteTab(null, now), null);
});

test('the tab the page opens on', () => {
  assert.equal(tabOfHash(''), UNSIGNED_FILTER);
  assert.equal(tabOfHash('#sign'), UNSIGNED_FILTER);
  assert.equal(tabOfHash('#signed'), 'signed');
  assert.equal(tabOfHash('#expired'), 'expired');
  assert.equal(tabOfHash('#cancelled'), UNSIGNED_FILTER, 'an old tab');
  assert.equal(tabOfHash('#all'), UNSIGNED_FILTER, 'an old tab');
});

test('the months to choose: only months with listed rows, and this month', () => {
  const rows = [q(), q({ status: 'cancelled', created_at: '2026-09-10T10:00:00+03:00' }), q({ status: 'signed', created_at: '2026-10-10T10:00:00+03:00' })];
  const listed = rows.filter((r) => quoteTab(r, now));
  assert.deepEqual(monthChoices(listed, now), ['2026-11', '2026-10']);
});

test('a new link is valid for a week', () => {
  assert.equal(DOC_TYPES.agreement.validHours, 168);
  assert.equal(DOC_TYPES.quote.validHours, 168);
});
