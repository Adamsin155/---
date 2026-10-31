// A deal goes to Irit and to Ofir, "הנחה חריגה", and the company number and the address
// (app/deal-logic.js, the rule `dealNew`; docs/ops.md, section 85; the owner, 31.10.2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateDeal, prefillFromDeal, dealSummary, dealDue, dealRingSlot, pendingDeals, holderText, takenText, submitText,
} from '../app/deal-logic.js';
import { validateSelection, normalizeSelection, computeTotals, exceptionOf } from '../app/pricing.js';
import { computeReminders } from '../app/reminder-engine.js';

const IL = (y, m, d, h = 0, min = 0) => new Date(Date.UTC(y, m - 1, d, h - 2, min));
const BASE = { business_name: 'פיצה רון', contact_name: 'רון', phone: '050-7654321' };
const PACKAGE = { ...BASE, tier: 'social', influencer: 'natali' };
const WORDS = { ...BASE, kind: 'free', text: 'בלי משפיען 4,900 בחודש' };
const world = () => ({ clients: [], checks: {}, tasks: [], access: [], reviews: [], statusNotes: [], messages: [], subscriptions: [], staff: [{ email: 'stav@x', person: 'stav' }, { email: 'irit@x', person: 'irit' }, { email: 'ofir@x', person: 'ofir' }], deals: [] });
const due = (w, now, log = []) => computeReminders({ ...w, now, log }).filter((r) => r.rule === 'dealNew');
const COMPANY = { company_id: '514729938', business_address: ' הרצל 1,  תל אביב ' };

test('the button says both', () => {
  assert.deepEqual([submitText('agreement'), submitText('quote'), submitText(null)], ['לעירית ולאופיר להכנת חוזה', 'לעירית ולאופיר להכנת הצעת מחיר', 'לעירית ולאופיר']);
});

test('an agreement requires the company number and the address; a price offer does not', () => {
  const bad = validateDeal({ ...WORDS, doc_type: 'agreement' });
  assert.equal(bad.ok, false);
  assert.match(bad.errors.company_id, /חובה/);
  assert.match(bad.errors.business_address, /חובה/);
  const good = validateDeal({ ...WORDS, ...COMPANY, doc_type: 'agreement' });
  assert.equal(good.ok, true);
  assert.deepEqual([good.row.company_id, good.row.business_address], ['514729938', 'הרצל 1, תל אביב']);
  const offer = validateDeal({ ...WORDS, doc_type: 'quote' });
  assert.equal(offer.ok, true);
  assert.ok(!('company_id' in offer.row) && !('business_address' in offer.row));
  // Given in an offer: kept, and still checked.
  assert.equal(validateDeal({ ...WORDS, ...COMPANY, doc_type: 'quote' }).row.company_id, '514729938');
  assert.match(validateDeal({ ...WORDS, company_id: 'abc', doc_type: 'quote' }).errors.company_id, /לא תקין/);
  // The package way too.
  assert.ok(validateDeal({ ...PACKAGE, doc_type: 'agreement' }).errors.company_id);
});

test('"הנחה חריגה": any amount up to the package\'s price, only when marked', () => {
  const plain = validateDeal({ ...PACKAGE, discount: 201 });
  assert.equal(plain.ok, false);
  assert.match(plain.errors.discount, /הנחה חריגה/);
  const ok = validateDeal({ ...PACKAGE, discount: 1500, special_discount: true });
  assert.equal(ok.ok, true);
  assert.deepEqual([ok.row.discount_agorot, ok.row.special_discount_agorot], [0, 150000]);
  assert.match(dealSummary(ok.row), /הנחה חריגה 1,500 ₪ לחודש/);
  // Not above the package's price, not a fraction, not below zero.
  assert.ok(validateDeal({ ...PACKAGE, discount: 1000000, special_discount: true }).errors.discount);
  assert.ok(validateDeal({ ...PACKAGE, discount: 12.5, special_discount: true }).errors.discount);
  assert.ok(validateDeal({ ...PACKAGE, discount: -1, special_discount: true }).errors.discount);
  // A regular discount stays in its column, with no mark.
  const small = validateDeal({ ...PACKAGE, discount: 150 });
  assert.deepEqual([small.row.discount_agorot, small.row.special_discount_agorot], [15000, undefined]);
  assert.match(dealSummary(small.row), /· הנחה 150 ₪ לחודש/);
  // A podcast's 800 ₪ is regular, though above the old column's limit (it failed there until now).
  const podcast = validateDeal({ ...PACKAGE, tier: 'podcast', discount: 800 });
  assert.equal(podcast.ok, true);
  assert.equal(podcast.row.special_discount_agorot, 80000);
  assert.match(dealSummary(podcast.row), /· הנחה 800 ₪ לחודש/);
});

test('the builder opens with all of it, and the server takes the exceptional discount as a custom contract', () => {
  const row = validateDeal({ ...PACKAGE, ...COMPANY, doc_type: 'agreement', discount: 1500, special_discount: true }).row;
  const pre = prefillFromDeal(row);
  assert.deepEqual([pre.client['c-companyid'], pre.client['c-address']], ['514729938', 'הרצל 1, תל אביב']);
  assert.equal(pre.selection.discount, 150000);
  assert.deepEqual(pre.selection.custom, {});
  // As the builder sends it (selectionToSend).
  const { custom, discount, ...rest } = pre.selection;
  const sent = normalizeSelection({ ...rest, discount: 0, custom: { discount } });
  validateSelection(sent);
  assert.equal(computeTotals(sent).discount, 150000);
  assert.ok(exceptionOf(sent).some((e) => e.kind === 'discount'), 'listed under what differs from the package');
  // A regular one opens as before, with no custom contract.
  const regular = prefillFromDeal(validateDeal({ ...PACKAGE, discount: 150 }).row);
  assert.equal(regular.selection.discount, 15000);
  assert.equal(regular.selection.custom ?? null, null);
  // Words: the details come along too.
  const words = prefillFromDeal({ ...validateDeal({ ...WORDS, ...COMPANY, doc_type: 'agreement' }).row, custom: { text: 'א' } });
  assert.equal(words.client['c-address'], 'הרצל 1, תל אביב');
});

test('the clock runs from the taking; while nobody took it, from the deal', () => {
  const created_at = IL(2026, 11, 2, 10).toISOString();
  assert.equal(+dealDue({ created_at }), +IL(2026, 11, 2, 10, 10));
  assert.equal(+dealDue({ created_at, taken_at: IL(2026, 11, 2, 10, 30).toISOString() }), +IL(2026, 11, 2, 10, 40));
});

test('the rings while nobody took it: at once, then every 10 office minutes, by the latest slot', () => {
  const d = { created_at: IL(2026, 11, 2, 10).toISOString() };
  assert.equal(dealRingSlot(d, IL(2026, 11, 2, 9)), null);
  assert.deepEqual([dealRingSlot(d, IL(2026, 11, 2, 10, 9)).id, dealRingSlot(d, IL(2026, 11, 2, 10, 10)).id, dealRingSlot(d, IL(2026, 11, 2, 10, 35)).id], ['now', 'again1', 'again3']);
  // At the end of the day: next morning, not at night.
  const late = { created_at: IL(2026, 11, 2, 17, 55).toISOString() };
  assert.equal(dealRingSlot(late, IL(2026, 11, 2, 23)).n, 0);
  assert.equal(dealRingSlot(late, IL(2026, 11, 3, 9, 5)).n, 1);
});

test('the other one sees "לקח" for a short while, then not; the owners and the holder always see it', () => {
  const now = IL(2026, 11, 2, 11);
  const row = (id, taken_by, minutes) => ({ id, status: 'pending', created_at: IL(2026, 11, 2, 10).toISOString(), taken_by, taken_at: taken_by ? new Date(+now - minutes * 60e3).toISOString() : null });
  const deals = [row('free', null), row('mine', 'irit', 30), row('fresh', 'ofir', 5), row('old', 'ofir', 30)];
  assert.deepEqual(pendingDeals(deals, { me: 'irit', now }).map((d) => d.id), ['free', 'mine', 'fresh']);
  assert.deepEqual(pendingDeals(deals, { me: 'ofir', now }).map((d) => d.id), ['free', 'fresh', 'old']);
  assert.deepEqual(pendingDeals(deals, { now }).map((d) => d.id), ['free', 'mine', 'fresh', 'old']);
  assert.equal(takenText('ofir'), 'אופיר לקח');
  assert.equal(takenText('irit'), 'עירית לקחה');
  assert.equal(holderText({ status: 'pending', taken_by: 'ofir' }), 'אצל אופיר');
  assert.equal(holderText({ status: 'sent', taken_by: 'ofir' }), '');
  assert.equal(holderText({ status: 'pending', taken_by: null }), '');
});

test('the rings: both, until one takes it; then only the holder, once, 10 minutes after taking', () => {
  const w = world();
  const d = { ...validateDeal(PACKAGE).row, id: 'd1', status: 'pending', created_by_email: 'stav@x', created_at: IL(2026, 11, 2, 10).toISOString() };
  w.deals.push(d);
  const first = due(w, IL(2026, 11, 2, 10));
  assert.deepEqual(first.map((r) => [r.step, r.person, r.level]).sort(), [['now', 'irit', 'ring'], ['now', 'ofir', 'ring']]);
  assert.equal(first[0].title, 'להכין חוזה ל־פיצה רון');
  assert.equal(first[0].url, 'clients.html#mine', 'the ring opens the card, where the button is');
  const again = due(w, IL(2026, 11, 2, 10, 20), first.map((r) => r.key));
  assert.deepEqual(again.map((r) => [r.step, r.person]).sort(), [['again2', 'irit'], ['again2', 'ofir']]);
  assert.match(again[0].title, /עוד אף אחד לא לקח/);
  // Ofir took it at 10:25: Irit hears nothing more; Ofir at 10:35, and it opens the builder.
  d.taken_by = 'ofir';
  d.taken_at = IL(2026, 11, 2, 10, 25).toISOString();
  assert.deepEqual(due(w, IL(2026, 11, 2, 10, 34)), []);
  const late = due(w, IL(2026, 11, 2, 10, 35));
  assert.deepEqual(late.map((r) => [r.step, r.person]), [['due', 'ofir']]);
  assert.equal(late[0].url, 'index.html?deal=d1');
  d.status = 'sent';
  assert.deepEqual(due(w, IL(2026, 11, 2, 10, 35)), []);
});
