// The create-quote function's gate (supabase/functions/create-quote/http.js): which
// sites may call it from a browser, and that every kind of quote is for the office
// only. Security audit of 6.10.2026 (docs/ops.md, section 36): the function used to
// answer any origin, and to ask only "is this a staff login" for a regular quote, so
// an editor could create an agreement, sign it signed-out and so open a client row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SITE_ORIGINS, allowedOrigin, corsHeaders, callerIsOffice, editsQuote, callerMayEditQuote, QUOTE_EDIT_KEYS } from '../supabase/functions/create-quote/http.js';
import { validateSelection, normalizeSelection, buildQuoteModel, emptySelection, computeTotals } from '../app/pricing.js';
import * as staffAdmin from '../supabase/functions/staff-admin/rules.js';

const SRC = readFileSync(new URL('../supabase/functions/create-quote/index.ts', import.meta.url), 'utf8');

test('CORS: the office\'s own site (and localhost) only, never "*"', () => {
  assert.deepEqual(SITE_ORIGINS, staffAdmin.SITE_ORIGINS, 'the same allow-list as the other functions');
  for (const origin of [...SITE_ORIGINS, 'http://localhost:8080', 'http://localhost']) {
    assert.equal(corsHeaders(origin)['Access-Control-Allow-Origin'], origin, origin);
  }
  for (const origin of ['https://evil.example', 'https://adamsin155.github.io.evil.example', 'https://localhost', 'http://localhost.evil.example',
    'http://127.0.0.1:8080', 'null', '', null, undefined, '*']) {
    assert.equal('Access-Control-Allow-Origin' in corsHeaders(origin), false, String(origin));
    assert.equal(allowedOrigin(origin), null, String(origin));
  }
  assert.equal(corsHeaders('https://app.astrateg.tech').Vary, 'Origin');
  assert.doesNotMatch(SRC, /Allow-Origin/, 'index.ts sets no origin header of its own');
  assert.doesNotMatch(SRC, /['"]\*['"]/);
  assert.match(SRC, /const CORS = corsHeaders\(req\.headers\.get\('origin'\)\);/);
});

test('every quote is for the office: is_office decides, a staff login alone is not enough', async () => {
  const asked = [];
  const rpcOf = (answers) => async (fn) => { asked.push(fn); return answers[fn] ?? { data: null, error: { message: 'no such function' } }; };
  // An editor, Eli, a sales agent: is_staff is true and is_office is false.
  assert.equal(await callerIsOffice(rpcOf({ is_staff: { data: true, error: null }, is_office: { data: false, error: null } })), false);
  assert.equal(await callerIsOffice(rpcOf({ is_office: { data: true, error: null } })), true);
  // An error, or anything but a plain true, is a no.
  assert.equal(await callerIsOffice(rpcOf({ is_office: { data: true, error: { message: 'x' } } })), false);
  assert.equal(await callerIsOffice(rpcOf({ is_office: { data: 'true', error: null } })), false);
  assert.equal(await callerIsOffice(rpcOf({})), false);
  assert.deepEqual([...new Set(asked)], ['is_office']);
  // The function asks before it reads the request, for regular quotes too, and no
  // longer asks is_staff at all.
  assert.doesNotMatch(SRC, /rpc\('is_staff'\)/);
  const gate = SRC.indexOf('callerIsOffice((fn: string) => userClient.rpc(fn))');
  assert.ok(gate > 0 && gate < SRC.indexOf('await req.json()'), 'the gate comes before the body is read');
  assert.ok(gate < SRC.indexOf('createClient(url, serviceKey())'), 'and before the service client exists'); // the project's secret key (21.10.2026)
  // The builder shows its Hebrew message for the refusal (explainError in app/supa.js).
  assert.match(SRC, /json\(403, \{ error: 'not staff: /);
});

// "שינויים להצעה הזו" (the owner, 9.11.2026; docs/ops.md, section 123): the package's monthly price and
// its name as the document shows it, for one quote. The managers only (public.is_manager(): the owners
// Adam and Idan, Irit, Ofir, Lior); anyone else is refused. The values are checked by the engine and the
// totals are always computed on the server.
test('the price and the package name of one quote: the managers only, checked and recomputed', async () => {
  assert.deepEqual(QUOTE_EDIT_KEYS, ['price', 'packageName']);
  const base = { ...emptySelection(), tier: 'social', influencer: 'niro' };
  assert.equal(editsQuote(base), false);
  assert.equal(editsQuote({ ...base, custom: { termMonths: 6 } }), false);
  assert.equal(editsQuote({ ...base, custom: { price: 0 } }), true);
  assert.equal(editsQuote({ ...base, custom: { packageName: 'ALL IN ONE' } }), true);
  // Who: is_manager, and only a plain true.
  const rpcOf = (answers) => async (fn) => answers[fn] ?? { data: null, error: { message: 'no such function' } };
  assert.equal(await callerMayEditQuote(rpcOf({ is_manager: { data: true, error: null } })), true);
  for (const no of [{ data: false, error: null }, { data: true, error: { message: 'x' } }, { data: 'true', error: null }, undefined]) {
    assert.equal(await callerMayEditQuote(rpcOf(no ? { is_manager: no } : {})), false);
  }
  assert.equal(await callerMayEditQuote(async () => { throw new Error('down'); }), false);
  // The function asks after reading the selection, before anything is saved, with its own refusal.
  const ask = SRC.indexOf('editsQuote(selection) && !(await callerMayEditQuote((fn: string) => userClient.rpc(fn)))');
  assert.ok(ask > SRC.indexOf('cleanSelection(body.selection)') && ask < SRC.indexOf('createClient(url, serviceKey())'));
  assert.match(SRC, /json\(403, \{ error: 'not allowed: only the managers change the price or the package name' \}\)/);

  // The values: what the engine (the same file the function deploys) accepts and refuses.
  const ok = (custom) => validateSelection({ ...base, custom });
  ok({ price: 0 });
  ok({ price: 10000000 });
  ok({ packageName: 'ALL IN ONE' });
  ok({ packageName: 'א'.repeat(60) });
  for (const bad of [{ price: -100 }, { price: 10000100 }, { price: 1.5 }, { price: '4200' }, { packageName: 'א'.repeat(61) },
    { packageName: '<b>x</b>' }, { packageName: 'a{b}' }, { packageName: 'x\u0007' }, { packageName: 7 }, { packageName: { a: 1 } }]) {
    assert.throws(() => ok(bad), undefined, JSON.stringify(bad));
  }
  // A regular discount bigger than a lowered price is refused (the total would go under zero).
  assert.throws(() => validateSelection({ ...base, discount: 20000, custom: { price: 10000 } }), /discount is more than the monthly price/);
  // The catalog's own name and a blank name are dropped: no change, a regular quote.
  assert.equal(normalizeSelection({ ...base, custom: { packageName: '  Social all in one ' } }).custom, undefined);
  assert.equal(normalizeSelection({ ...base, custom: { packageName: '   ' } }).custom, undefined);
  // The totals follow the price typed, whatever the browser says; the catalog is unchanged.
  const sel = normalizeSelection({ ...base, paid: ['photographer'], custom: { price: 420000, packageName: ' ALL  IN ONE ' } });
  assert.deepEqual(sel.custom, { price: 420000, packageName: 'ALL IN ONE' });
  const m = buildQuoteModel(sel, {});
  assert.equal(m.package.monthly, 420000);
  assert.equal(m.totals.monthlyNet, 420000 + 200000);
  assert.deepEqual(m.totals, computeTotals(sel));
  assert.equal(m.package.tierName, 'Social all in one');
  assert.equal(m.package.shownName, 'ALL IN ONE');
  assert.equal(buildQuoteModel(base, {}).package.monthly, 390000);
});
