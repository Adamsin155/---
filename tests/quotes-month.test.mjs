// "הצעות שנשלחו" by month, and which contract files uploaded by hand take part (app/quotes-month.js;
// docs/ops.md, section 117). Run: node --test tests/quotes-month.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MANUAL_FROM, fromCutoff, monthKeyIL, rowMonth, signedMonth, monthLabel, inMonthWords, monthChoices, rowsOfMonth,
  hasAmounts, sortManual, freshFailures, RETRY_AFTER_MS,
} from '../app/quotes-month.js';
import { keepableRow, formFromRead } from '../app/contract-read-logic.js';

test('the cutoff is midnight of 1.11.2026 in Israel', () => {
  assert.equal(new Date(MANUAL_FROM).toISOString(), '2026-10-31T22:00:00.000Z');
  assert.equal(fromCutoff('2026-10-31T21:59:59Z'), false, '23:59 on 31.10 in Israel');
  assert.equal(fromCutoff('2026-10-31T22:00:00Z'), true, '00:00 on 1.11 in Israel');
  assert.equal(fromCutoff('2026-10-27T10:00:00+02:00'), false, 'the bulk import of 27.10');
  assert.equal(fromCutoff('2026-11-04T09:00:00+02:00'), true);
  assert.equal(fromCutoff(null), false);
  assert.equal(fromCutoff('not a date'), false);
});

test('months are Israel months', () => {
  assert.equal(monthKeyIL('2026-10-31T22:30:00Z'), '2026-11', 'already 1.11 in Israel');
  assert.equal(monthKeyIL('2026-10-31T21:30:00Z'), '2026-10');
  assert.equal(monthKeyIL(null), null);
  assert.equal(monthLabel('2026-11'), 'נובמבר 2026');
  assert.equal(monthLabel('2027-01'), 'ינואר 2027');
  assert.equal(monthLabel('x'), '');
  assert.equal(inMonthWords('2026-10'), 'באוקטובר');
});

test('a row belongs to the month it was created; a manual contract to the month its file was uploaded', () => {
  assert.equal(rowMonth({ created_at: '2026-11-02T10:00:00+02:00', signed_at: '2026-12-01T10:00:00+02:00' }), '2026-11');
  // A quote made in October and signed in November: listed in October, its sum in November's "נחתם".
  const q = { status: 'signed', created_at: '2026-10-28T10:00:00+02:00', signed_at: '2026-11-02T10:00:00+02:00' };
  assert.deepEqual([rowMonth(q), signedMonth(q)], ['2026-10', '2026-11']);
  // A contract signed on paper on 12.10 and uploaded on 4.11: November, in the list and in the sum.
  const m = { manual: 'x', status: 'signed', created_at: '2026-11-04T09:00:00+02:00', signed_at: '2026-10-12' };
  assert.deepEqual([rowMonth(m), signedMonth(m)], ['2026-11', '2026-11']);
});

test('the months to choose: those with rows and this month, newest first; a month\'s rows', () => {
  const rows = [
    { id: 1, created_at: '2026-10-03T10:00:00+03:00' },
    { id: 2, created_at: '2026-09-20T10:00:00+03:00' },
    { id: 3, created_at: '2026-10-30T10:00:00+02:00' },
  ];
  const now = new Date('2026-11-09T12:00:00+02:00');
  assert.deepEqual(monthChoices(rows, now), ['2026-11', '2026-10', '2026-09']);
  assert.deepEqual(monthChoices([], now), ['2026-11'], 'an empty list still has this month');
  assert.deepEqual(rowsOfMonth(rows, '2026-10').map((r) => r.id), [1, 3]);
  assert.deepEqual(rowsOfMonth(rows, '2026-11'), []);
});

const file = (id, at, client = 'c1') => ({ id, client_id: client, created_at: at, storage_path: `${client}/material_other/${id}.pdf` });
const row = (fileId, extra = {}) => ({ id: `m-${fileId}`, client_id: 'c1', file_id: fileId, monthly_net_agorot: 390000, term_months: 12, created_at: '2026-11-09T10:00:00+02:00', ...extra });

test('sortManual: the imported old contracts are left out, read or not', () => {
  const old = file('old', '2026-10-27T11:00:00+02:00');
  const r = sortManual({ rows: [row('old')], files: [], uploaded: { old } });
  assert.deepEqual(r, { listed: [], check: [], toRead: [] }, 'a row of an imported file (read in the card later) is not listed');
  // Only files since the cutoff are passed as live files; an older one passed anyway is still left out.
  assert.deepEqual(sortManual({ files: [old] }).toRead, []);
});

test('sortManual: a new file is read; a row with amounts is listed by its upload day; without amounts it is to check', () => {
  const a = file('a', '2026-11-04T09:00:00+02:00');
  const b = file('b', '2026-11-09T08:00:00+02:00');
  const c = file('c', '2026-11-09T09:00:00+02:00');
  const d = file('d', '2026-11-05T09:00:00+02:00');
  const r = sortManual({
    rows: [row('a'), row('b', { monthly_net_agorot: null })],
    files: [a, b, c, d],
    failed: new Set(['d']),
  });
  assert.deepEqual(r.listed.map((x) => [x.row.file_id, x.at]), [['a', a.created_at]], 'listed in the month of the upload, not of the reading (9.11)');
  assert.deepEqual(r.toRead.map((f) => f.id), ['c']);
  assert.deepEqual(r.check.map((x) => [x.fileId, !!x.row]), [['b', true], ['d', false]], 'the newest first');
});

test('sortManual: a row whose file is gone counts by the day it was kept', () => {
  const r = sortManual({ rows: [row('gone', { created_at: '2026-11-06T10:00:00+02:00' }), row('gone2', { created_at: '2026-10-20T10:00:00+03:00' })] });
  assert.deepEqual(r.listed.map((x) => x.row.file_id), ['gone']);
});

test('hasAmounts: a price and months', () => {
  assert.equal(hasAmounts({ monthly_net_agorot: 390000, term_months: 12 }), true);
  assert.equal(hasAmounts({ monthly_net_agorot: 390000, term_months: null }), false);
  assert.equal(hasAmounts({ monthly_net_agorot: null, term_months: 12 }), false);
});

test('freshFailures: a failed reading waits 12 hours before it is tried again', () => {
  const now = Date.parse('2026-11-09T12:00:00Z');
  const tried = { a: now - 1000, b: now - RETRY_AFTER_MS - 1, c: 'x' };
  assert.deepEqual([...freshFailures(tried, now)], ['a']);
  assert.deepEqual([...freshFailures(null, now)], []);
});

test('keepableRow: what is kept right after a reading (shared by the card and the list)', () => {
  const now = new Date('2026-11-09T12:00:00+02:00');
  const read = { business: 'מספרת אבי', company_id: '515151515', contact_name: 'אבי', package_id: 'social-choice', monthly_net: 3900, term_months: 12, signed_on: '2026-11-03' };
  const full = keepableRow(formFromRead(read), 'קפה', now);
  assert.deepEqual([full.business, full.monthly_net_agorot, full.term_months, full.signed_on], ['מספרת אבי', 390000, 12, '2026-11-03']);
  // A field that does not pass is left empty; without a business the client's name stands in.
  const bad = keepableRow(formFromRead({ ...read, business: '', company_id: '12', signed_on: '2030-01-01' }), 'קפה דנה', now);
  assert.deepEqual([bad.business, bad.company_id, bad.signed_on, bad.monthly_net_agorot], ['קפה דנה', null, null, 390000]);
  assert.equal(keepableRow(formFromRead({}), '', now).business, 'חוזה ידני');
  assert.deepEqual(formFromRead({ monthly_net: null, term_months: 0 }).monthly_net, '');
});
