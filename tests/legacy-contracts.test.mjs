// The old system's documents in the new one (the owner's requests of 25.10 and 27.10.2026):
// what the card's list and the document's page say (app/legacy-contract-logic.js), and the
// import (scripts/legacy-contracts-import.mjs) against a stand-in for the database. The
// database side is tests/sql/legacy-contracts.test.mjs; the browser side is a step of
// tests/office-flows-e2e.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  typeLabel, statusLabel, legacyRows, legacySum, stampLine, moneyText, toNumber, isSignaturePng, listOf, packageCounts,
  paymentFacts, termFacts, signersOf, historyLines, extraFacts, sketchesOf, dayText, hashStamp,
} from '../app/legacy-contract-logic.js';
import { importAll, plan } from '../scripts/legacy-contracts-import.mjs';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

test('the type in words: a contract when empty or unknown, a termination, an addendum', () => {
  assert.deepEqual(['contract', '', undefined, null, 'termination', 'addendum', 'x'].map(typeLabel), ['חוזה', 'חוזה', 'חוזה', 'חוזה', 'סיום התקשרות', 'נספח', 'חוזה']);
});

test('dates in Israel time on any device; sums as written, in shekels', () => {
  // 22:30 UTC on 1.3 is already 2.3 in Israel.
  assert.equal(dayText('2025-03-01T22:30:00Z'), '2.3.2025');
  assert.equal(dayText(Date.parse('2025-03-01T22:30:00Z')), '2.3.2025');
  assert.equal(dayText(Date.parse('2025-03-01T22:30:00Z') / 1000), '2.3.2025');
  assert.equal(dayText('לא תאריך'), null);
  assert.equal(dayText(null), null);
  assert.deepEqual([toNumber(60000), toNumber('5,000'), toNumber('₪ 1200.5'), toNumber('לא ידוע'), toNumber(null)], [60000, 5000, 1200.5, null, null]);
  assert.equal(moneyText(60000), '₪60,000');
  assert.equal(moneyText('1,250.5'), '₪1,250.5');
  assert.equal(moneyText(''), null);
});

test('the card\'s list: newest signed first, the row\'s words and its link; the count', () => {
  const rows = legacyRows([
    { id: 7, doc_type: 'contract', doc_number: 'AST-7', signer_name: 'רון', signed_at: '2024-01-10T10:00:00Z', total_amount: '48000' },
    { id: 9, doc_type: 'termination', doc_number: null, signer_name: null, signed_at: '2025-05-01T10:00:00Z', total_amount: null },
    { id: 8, doc_type: 'addendum', doc_number: 'AST-8', signer_name: 'רון', signed_at: null, total_amount: 1500 },
  ]);
  assert.deepEqual(rows.map((r) => [r.id, r.type, r.number, r.signed, r.signer, r.total, r.href, r.status, r.statusText]), [
    [9, 'סיום התקשרות', null, '1.5.2025', null, null, 'legacy-contract.html?id=9', 'signed', 'נחתם'],
    [7, 'חוזה', 'AST-7', '10.1.2024', 'רון', '₪48,000', 'legacy-contract.html?id=7', 'signed', 'נחתם'],
    [8, 'נספח', 'AST-8', null, 'רון', '₪1,500', 'legacy-contract.html?id=8', 'signed', 'נחתם'],
  ]);
  // The states of 27.10.2026: waiting and a price offer have no signing day, after the signed ones.
  const more = legacyRows([
    { id: 20, doc_type: 'contract', status: 'quote', signed_at: null, total_amount: 9000 },
    { id: 21, doc_type: 'contract', status: 'pending', signed_at: '2025-01-01T10:00:00Z' },
    { id: 7, doc_type: 'contract', status: 'signed', signed_at: '2024-01-10T10:00:00Z' },
  ]);
  assert.deepEqual(more.map((r) => [r.id, r.status, r.statusText, r.signed]), [
    [7, 'signed', 'נחתם', '10.1.2024'], [21, 'pending', 'ממתין לחתימה (במערכת הישנה)', null], [20, 'quote', 'הצעת מחיר', null]]);
  assert.deepEqual(['signed', 'pending', 'quote', null, 'x'].map(statusLabel), ['נחתם', 'ממתין לחתימה (במערכת הישנה)', 'הצעת מחיר', 'נחתם', 'נחתם']);
  assert.deepEqual([legacySum(1), legacySum(3)], ['מסמך אחד', '3 מסמכים']);
});

test('the stamp line: the old system, the signing day, the first 12 of the document\'s hash', () => {
  const doc = { docHash: 'ABCDEF0123456789'.repeat(4) };
  assert.equal(stampLine({ signed_at: '2025-03-02T09:00:00Z', doc }), 'מסמך מהמערכת הישנה · נחתם 2.3.2025 · חותמת abcdef012345');
  assert.equal(stampLine({ doc: { signedAt: '2025-03-02T09:00:00Z' } }), 'מסמך מהמערכת הישנה · נחתם 2.3.2025');
  assert.equal(stampLine({ doc: { docHash: 'not-hex' } }), 'מסמך מהמערכת הישנה');
  assert.equal(stampLine({ status: 'pending', signed_at: null, doc }), 'מסמך מהמערכת הישנה · ממתין לחתימה, לא נחתם · חותמת abcdef012345');
  assert.equal(stampLine({ status: 'quote', doc: {} }), 'מסמך מהמערכת הישנה · הצעת מחיר, לא נחתמה');
  assert.equal(hashStamp('abc'), null);
});

test('only a PNG is drawn as a signature', () => {
  assert.equal(isSignaturePng(PNG), true);
  for (const s of ['data:image/svg+xml;base64,PHN2Zz4=', 'javascript:alert(1)', `${PNG}"><script>`, `data:image/png;base64,${'A'.repeat(400000)}`, null, 5]) assert.equal(isSignaturePng(s), false, String(s).slice(0, 30));
  const signers = signersOf({ signers: [{ name: 'א', signature: PNG, signedAt: '2025-03-02T09:00:00Z' }, { name: 'ב', signature: 'data:image/svg+xml;base64,x' }] });
  assert.deepEqual(signers.map((s) => [s.name, !!s.png]), [['א', true], ['ב', false]]);
  assert.match(signers[0].at, /2 במרץ 2025/);
  assert.match(signers[0].at, /11:00/);
  // No signers: the record's one signer, the row's columns first.
  assert.deepEqual(signersOf({ signerName: 'רון', signature: PNG }, { signer_name: 'רון כהן' }).map((s) => [s.name, !!s.png]), [['רון כהן', true]]);
  assert.deepEqual(signersOf({}), []);
  // Not signed: no signer is drawn, whatever the record holds.
  assert.deepEqual(signersOf({ signerName: 'רון', signature: PNG }, { status: 'pending' }), []);
});

test('the record\'s lists, counts, money and termination, as the old system kept them', () => {
  assert.deepEqual(listOf(['א', '', { title: 'ב', text: 'ג' }, { text: 'ד' }, { name: 'ה' }, null, 7]), [
    { title: null, text: 'א' }, { title: 'ב', text: 'ג' }, { title: null, text: 'ד' }, { title: 'ה', text: null }, { title: null, text: '7' }]);
  assert.deepEqual(listOf('שורה'), [{ title: null, text: 'שורה' }]);
  assert.deepEqual(packageCounts({ months: 12, shootDays: 1, contentTotal: '40', reels: 25, graphics: 0, influencers: 2 }),
    [[12, 'חודשים'], [1, 'ימי צילום'], [40, 'תכנים בסך הכול'], [25, 'סרטונים'], [2, 'משפיענים']]);
  assert.deepEqual(packageCounts({ months: 12, noMonths: true, influencers: 'שני משפיענים' }), []);
  assert.deepEqual(paymentFacts({ totalAmount: 60000, retainer: '5,000', setupNet: 1500, paymentMethod: 'הוראת קבע', checksCount: 12 }), [
    ['סכום כולל', '₪60,000'], ['ריטיינר חודשי', '₪5,000'], ['דמי הקמה', '₪1,500'], ['אמצעי תשלום', 'הוראת קבע'], ['מספר תשלומים / צ׳קים', '12']]);
  assert.deepEqual(termFacts({ endDate: '2025-09-30', reason: 'סגירת העסק', amount: 2000, notify: true, nested: { a: 1 } }), [
    ['תאריך סיום', '30 בספטמבר 2025'], ['סיבה', 'סגירת העסק'], ['סכום', '₪2,000'], ['notify', 'כן']]);
  assert.deepEqual(termFacts(null), []);
  const lines = historyLines([{ at: '2025-03-02T09:00:00Z', event: 'signed', name: 'רון' }, 'נשלח בוואטסאפ', {}]);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^2 במרץ 2025.*11:00 · נחתם · רון$/);
  assert.equal(lines[1], 'נשלח בוואטסאפ');
});

test('every other plain field is shown; nothing private and nothing drawn elsewhere', () => {
  const extras = extraFacts({ status: 'נחתם', atBusiness: true, extraSocial: 300, newField: 'ערך', flag: false, obj: { a: 1 }, signedIp: '1.2.3.4', phone: '050', hp: '5', notes: 'בכרטיס' });
  assert.deepEqual(extras, [['הצילום בבית העסק', 'כן'], ['רשתות נוספות', '₪300'], ['newField', 'ערך'], ['flag', 'לא']]);
});

test('sketches: pictures drawn in the page only, and their words', () => {
  const s = sketchesOf(['data:image/jpeg;base64,AAAA', 'https://example.com/x.png', 'data:text/html;base64,PHA+', { src: PNG }, { title: 'סקיצה', text: 'לוגו' }]);
  assert.deepEqual(s.pics, ['data:image/jpeg;base64,AAAA', PNG]);
  assert.deepEqual(s.words, ['https://example.com/x.png', 'סקיצה: לוגו']);
});

// ── The import ──
const fakeSupabase = (fail = new Set()) => {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (fail.has(args.p_doc.id)) return { data: null, error: { message: 'no such client' } };
      return { data: { id: args.p_doc.id }, error: null };
    },
  };
};
const OLD = [
  { id: 1, clientId: 10, clientName: 'רון', status: 'נחתם', docType: '', signedIp: '1.2.3.4', signedUserAgent: 'UA', phone: '050', hp: '51', signature: PNG },
  { id: 2, clientId: 11, clientName: 'גיל', status: 'נשלח' },
  { id: 6, clientId: 10, clientName: 'רון', status: 'ממתין לחתימה', signature: PNG },
  { id: 7, clientId: 12, clientName: 'דנה', status: ' הצעת מחיר ' },
  { id: 8, clientId: 99, clientName: 'לא קיים', status: 'הצעת מחיר' },
  { id: 3, clientId: 99, clientName: 'לא קיים', status: 'נחתם' },
  { id: 4, clientId: 10, clientName: 'רון', status: 'נחתם', docType: 'termination' },
  { id: 5, clientId: 12, clientName: 'דנה', status: 'נחתם', docType: 'addendum' },
];
const UUIDS = { 10: 'u-10', 12: 'u-12' };

test('importAll: signed, waiting and price offers, each with its client; no client is skipped; another state is listed; a failure is reported; nothing private is sent', async () => {
  const sb = fakeSupabase(new Set([5]));
  const r = await importAll(sb, OLD, (id) => UUIDS[id] || null);
  assert.deepEqual(r, { ok: [1, 6, 7, 4], skipped: [{ id: 8, clientId: 99, clientName: 'לא קיים' }, { id: 3, clientId: 99, clientName: 'לא קיים' }],
    other: [{ id: 2, status: 'נשלח' }], failed: [{ id: 5, error: 'no such client' }] });
  assert.deepEqual(sb.calls.map(([n, a]) => [n, a.p_client, a.p_doc.id, a.p_doc.status]), [['legacy_contract_import', 'u-10', 1, 'נחתם'], ['legacy_contract_import', 'u-10', 6, 'ממתין לחתימה'],
    ['legacy_contract_import', 'u-12', 7, 'הצעת מחיר'], ['legacy_contract_import', 'u-10', 4, 'נחתם'], ['legacy_contract_import', 'u-12', 5, 'נחתם']]);
  const sent = sb.calls[0][1].p_doc;
  for (const k of ['signedIp', 'signedUserAgent', 'phone', 'hp']) assert.ok(!(k in sent), k);
  assert.equal(sent.signature, PNG);
  assert.equal(OLD[0].signedIp, '1.2.3.4', 'the file read is left as it was');
  // An async mapper, and one that throws, are both fine.
  const r2 = await importAll(fakeSupabase(), OLD, async (id) => { if (id === 12) throw new Error('x'); return UUIDS[id]; });
  assert.deepEqual([r2.ok, r2.skipped.map((s) => s.id)], [[1, 6, 4], [7, 8, 3, 5]]);
  assert.deepEqual(await importAll(fakeSupabase(), null, () => 'u'), { ok: [], skipped: [], other: [], failed: [] });
});

test('plan: what would be imported, with no session', async () => {
  assert.deepEqual(await plan(OLD, (id) => UUIDS[id] || null), {
    total: 7, statuses: { signed: 4, pending: 1, quote: 2 }, other: [{ id: 2, status: 'נשלח' }], withClient: 5,
    skipped: [{ id: 8, clientId: 99, clientName: 'לא קיים' }, { id: 3, clientId: 99, clientName: 'לא קיים' }], types: { contract: 5, termination: 1, addendum: 1 } });
});

test('importAll stands alone (it runs inside a page from its own text)', () => {
  const src = importAll.toString();
  assert.doesNotMatch(src, /\bimport\b|\brequire\(|process\.|PRIVATE_KEYS/);
  // The file is not published (scripts/ never is) and writes nothing when run without a session.
  assert.match(readFileSync(new URL('../scripts/legacy-contracts-import.mjs', import.meta.url), 'utf8'), /Nothing was written/);
});
