// The create-quote function's gate (supabase/functions/create-quote/http.js): which
// sites may call it from a browser, and that every kind of quote is for the office
// only. Security audit of 6.10.2026 (docs/ops.md, section 36): the function used to
// answer any origin, and to ask only "is this a staff login" for a regular quote, so
// an editor could create an agreement, sign it signed-out and so open a client row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SITE_ORIGINS, allowedOrigin, corsHeaders, callerIsOffice } from '../supabase/functions/create-quote/http.js';
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
  assert.ok(gate < SRC.indexOf("createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)"), 'and before the service client exists');
  // The builder shows its Hebrew message for the refusal (explainError in app/supa.js).
  assert.match(SRC, /json\(403, \{ error: 'not staff: /);
});
