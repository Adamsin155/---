// Sign-in links and signing out (app/supa.js, app/payouts/client.js), security audit
// of 6.10.2026 (docs/ops.md, section 36): a pair of tokens in the address is taken
// only as a reset link, a link never replaces the account that is signed in on the
// device without asking, and signing out clears the drafts kept in the browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseAuthLink, tokenEmail, linkQuestion, clearDeviceDrafts, DRAFT_PREFIXES, SESSION_DRAFTS } from '../app/supa.js';
import * as payouts from '../app/payouts/client.js';
import { DRAFT_KEY as CHAR_DRAFT } from '../app/characterization.js';
import { draftKey as scriptDraft } from '../app/scripts-logic.js';
import { QUOTE_DRAFT_KEY } from '../app/renewals.js';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (email) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', email, role: 'authenticated' })}.sig`;
const src = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('a pair of tokens is a link only as a reset link; the personal links keep their two types', () => {
  const pair = (type) => `#access_token=${jwt('a@x.co')}&refresh_token=r&expires_in=3600&token_type=bearer${type === null ? '' : `&type=${type}`}`;
  assert.deepEqual(parseAuthLink(pair('recovery')), { type: 'recovery', accessToken: jwt('a@x.co'), refreshToken: 'r' });
  for (const type of ['magiclink', 'signup', 'invite', 'email_change', 'RECOVERY', '', null]) {
    assert.deepEqual(parseAuthLink(pair(type)), { expired: true }, String(type));
  }
  assert.deepEqual(parseAuthLink(`#access_token=${jwt('a@x.co')}&type=recovery`), { expired: true }, 'no refresh token');
  for (const type of ['invite', 'recovery']) assert.deepEqual(parseAuthLink(`#type=${type}&token_hash=abc`), { type, tokenHash: 'abc' });
  assert.deepEqual(parseAuthLink('#type=magiclink&token_hash=abc'), { expired: true });
  assert.deepEqual(parseAuthLink('#error=access_denied&error_code=otp_expired'), { expired: true });
  for (const none of ['', '#', '#mine', '#t=abc', null, undefined]) assert.equal(parseAuthLink(none), null, String(none));
  // The pages that land from a link ask before using it, and never sign in without a password step.
  assert.match(src('app/set-password.js'), /if \(link\.expired \|\| !LINK_TYPES\.includes\(link\.type\)\) return 'expired';\n  if \(!\(await mayUseLink\(link\)\)\) return 'kept';/);
  assert.doesNotMatch(src('app/set-password.js'), /'signed-in'/);
  assert.match(src('app/supa.js'), /if \(!\(await mayUseLink\(link\)\)\) return 'kept';\n  return \(await verifyLink\(link\)\) \? 'expired' : 'recovery';/);
});

test('whose link it is: the email in the token, in Hebrew too; nothing on a broken token', () => {
  assert.equal(tokenEmail(jwt('Ofir@Astrateg.Test')), 'ofir@astrateg.test');
  assert.equal(tokenEmail(`${b64({})}.${b64({ email: 'דנה@דוגמה.co.il' })}.s`), 'דנה@דוגמה.co.il');
  for (const bad of ['', null, undefined, 'abc', 'a.b.c', `${b64({})}.${b64({ sub: 'x' })}.s`, `${b64({})}.${b64({ email: 5 })}.s`]) assert.equal(tokenEmail(bad), null, String(bad));
  assert.equal(payouts.tokenEmail(jwt('Ofir@Astrateg.Test')), 'ofir@astrateg.test');
});

test('a link is used without a question only when nobody is signed in, or it is the same account', () => {
  const mine = { type: 'recovery', accessToken: jwt('yariv@astrateg.test'), refreshToken: 'r' };
  const other = { type: 'recovery', accessToken: jwt('ofir@astrateg.test'), refreshToken: 'r' };
  const personal = { type: 'invite', tokenHash: 'abc' };
  for (const link of [mine, other, personal]) assert.equal(linkQuestion(link, null), null, 'nobody signed in');
  assert.equal(linkQuestion(mine, 'Yariv@astrateg.test'), null, 'the same account');
  assert.equal(linkQuestion({ expired: true }, 'yariv@astrateg.test'), null);
  const q = linkQuestion(other, 'yariv@astrateg.test');
  assert.equal(q, 'הקישור שייך לחשבון אחר (ofir@astrateg.test).\nבמכשיר הזה מחובר כרגע yariv@astrateg.test.\n\nאישור: לעבור לחשבון של הקישור.\nביטול: להישאר בחשבון המחובר (הקישור לא ינוצל).');
  // A personal link (its account is known only once it is spent), and a token that cannot be read: asked.
  assert.match(linkQuestion(personal, 'yariv@astrateg.test'), /^זה קישור כניסה אישי, והוא עשוי להיות של חשבון אחר\.\nבמכשיר הזה מחובר כרגע yariv@astrateg\.test\./);
  assert.match(linkQuestion({ type: 'recovery', accessToken: 'garbage', refreshToken: 'r' }, 'yariv@astrateg.test'), /^זה קישור כניסה אישי/);
  // The payouts app (its own client) asks the same.
  assert.equal(payouts.linkQuestion(jwt('ofir@astrateg.test'), 'yariv@astrateg.test'), q);
  assert.equal(payouts.linkQuestion(jwt('yariv@astrateg.test'), 'yariv@astrateg.test'), null);
  assert.equal(payouts.linkQuestion(jwt('ofir@astrateg.test'), null), null);
  assert.match(src('app/payouts/client.js'), /if \(question && !ask\(question\)\) return 'kept';\n  const \{ error \} = await supabase\.auth\.setSession/);
});

test('signing out clears the drafts kept in the browser, and keeps the preferences', () => {
  const storage = (init) => {
    const m = new Map(Object.entries(init));
    return { get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, removeItem: (k) => m.delete(k), getItem: (k) => m.get(k) ?? null, keys: () => [...m.keys()].sort() };
  };
  // The keys as the screens write them (protocol-ui.js `store` adds "astrateg.").
  const drafts = [`astrateg.${CHAR_DRAFT('c1')}`, 'astrateg.brief.c1.1', `astrateg.${scriptDraft('c1', 1, 3)}`];
  for (const k of drafts) assert.ok(DRAFT_PREFIXES.some((p) => k.startsWith(p)), k);
  assert.deepEqual(SESSION_DRAFTS, [QUOTE_DRAFT_KEY]);
  assert.match(src('app/builder.js'), /const DRAFT_KEY = 'astrateg-draft';/);
  const local = storage({ ...Object.fromEntries(drafts.map((k) => [k, 'x'])), 'astrateg.mode': 'manager', 'astrateg.messages.station': 'all', 'sb-czncjzziqrqtezpwxxpz-auth-token': '{}', 'status.name': 'דנה' });
  const session = storage({ 'astrateg-draft': '{"state":{}}', 'astrateg.tabSeen': '1' });
  clearDeviceDrafts(local, session);
  assert.deepEqual(local.keys(), ['astrateg.messages.station', 'astrateg.mode', 'sb-czncjzziqrqtezpwxxpz-auth-token', 'status.name']);
  assert.deepEqual(session.keys(), ['astrateg.tabSeen']);
  // No storage at all (private mode): nothing throws.
  clearDeviceDrafts(null, null);
  clearDeviceDrafts({ get length() { throw new Error('denied'); } }, { removeItem() { throw new Error('denied'); } });
  // Both sign-out buttons go through it, and through the push device's removal.
  assert.match(src('app/protocol-ui.js'), /\$\('btn-logout'\)\.addEventListener\('click', async \(\) => \{ resetMode\(\); forgetPlace\(\); await signOutHere\(\); location\.reload\(\); \}\);/);
  assert.match(src('app/dashboard.js'), /\$\('btn-logout'\)\.addEventListener\('click', async \(\) => \{ resetMode\(\); forgetPlace\(\); await signOutHere\(\); await boot\(\); \}\);/);
  const supa = src('app/supa.js');
  assert.match(supa, /supabase\.rpc\('push_unsubscribe', \{ p_endpoint: sub\.endpoint \}\)/);
  assert.ok(supa.indexOf('forgetPushDevice().catch') < supa.indexOf('await supabase.auth.signOut();'), 'the device is removed while the session still exists');
});
