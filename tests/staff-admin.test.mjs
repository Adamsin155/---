// Team accounts: the staff-admin function's rules (who may do what, which pages a
// link may open, what the list returns) and the team screen's plain helpers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PERSONS, TEAM_MANAGERS, LINK_PAGES, ERR, normEmail, roleOf, bearer, allowedRedirect, allowedOrigin, corsHeaders,
  planUpsert, planRemove, planLink, linkTypeFor, buildLoginLink, summarize, linkErrorCode,
} from '../supabase/functions/staff-admin/rules.js';
import * as teamRules from '../app/team-rules.js';
import { STAFF_PEOPLE } from '../app/protocol.js';

const OWNER = 'owner@astrateg.test';
const row = (email, person, vault = false) => ({ email, person, vault });

test('the function knows the same people and managers as the app', () => {
  assert.deepEqual(PERSONS, STAFF_PEOPLE().map((p) => p.key));
  assert.deepEqual(TEAM_MANAGERS, teamRules.TEAM_MANAGERS);
  const src = readFileSync(new URL('../supabase/migrations/20260929230000_photographer.sql', import.meta.url), 'utf8');
  for (const p of PERSONS) assert.match(src, new RegExp(`'${p}'`), `${p} allowed by staff_person_check`);
});

test('emails are trimmed and lower-cased; anything else is refused', () => {
  assert.equal(normEmail('  Nadia@Astrateg.TEST '), 'nadia@astrateg.test');
  for (const bad of ['', null, undefined, 'nadia', 'a@b', 'a b@c.de', `${'x'.repeat(250)}@a.co`]) assert.equal(normEmail(bad), null, String(bad));
});

test('roles: the owner row has no person; only Irit and Lior manage besides the owner', () => {
  assert.equal(roleOf(row(OWNER, null)), 'owner');
  assert.equal(roleOf(row('i@a.test', 'irit')), 'manager');
  assert.equal(roleOf(row('l@a.test', 'lior')), 'manager');
  for (const p of ['ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli', 'editor']) assert.equal(roleOf(row('x@a.test', p)), null, p);
  assert.equal(roleOf(null), null);
});

test('the bearer token is read from the Authorization header only', () => {
  assert.equal(bearer('Bearer abc.def.ghi'), 'abc.def.ghi');
  assert.equal(bearer('bearer  xyz'), 'xyz');
  assert.equal(bearer(''), null);
  assert.equal(bearer('Basic abc'), null);
  assert.equal(bearer(null), null);
});

test('links open only the office clients page (any port on localhost)', () => {
  for (const ok of LINK_PAGES) assert.equal(allowedRedirect(ok), ok);
  assert.equal(allowedRedirect('http://localhost:8092/clients.html'), 'http://localhost:8092/clients.html');
  assert.equal(allowedRedirect('http://localhost/clients.html'), 'http://localhost/clients.html');
  for (const bad of [
    'https://evil.example/clients.html', 'https://adamsin155.github.io/---/quotes.html', 'https://adamsin155.github.io/clients.html',
    'http://app.astrateg.com/clients.html', 'https://app.astrateg.com/clients.html?x=1', 'https://app.astrateg.com/clients.html#a',
    'https://user:pw@app.astrateg.com/clients.html', 'http://localhost:8092/team.html', 'http://127.0.0.1:8092/clients.html',
    'https://localhost/clients.html', 'https://app.astrateg.com.evil.example/clients.html', 'javascript:alert(1)', '', null,
  ]) assert.equal(allowedRedirect(bad), null, String(bad));
});

test('CORS answers the site origins only', () => {
  assert.equal(allowedOrigin('https://adamsin155.github.io'), 'https://adamsin155.github.io');
  assert.equal(allowedOrigin('https://app.astrateg.com'), 'https://app.astrateg.com');
  assert.equal(allowedOrigin('http://localhost:8092'), 'http://localhost:8092');
  for (const bad of ['https://evil.example', 'http://localhost:8092/x', 'null', '', undefined]) assert.equal(allowedOrigin(bad), null, String(bad));
  const h = corsHeaders('https://app.astrateg.com', 'authorization, x-client-info, apikey, content-type');
  assert.equal(h['Access-Control-Allow-Origin'], 'https://app.astrateg.com');
  assert.equal(h.Vary, 'Origin');
  assert.equal(corsHeaders('https://evil.example')['Access-Control-Allow-Origin'], undefined);
  assert.equal(corsHeaders('https://app.astrateg.com', 'x\r\nSet-Cookie: a')['Access-Control-Allow-Headers'], 'authorization, x-client-info, apikey, content-type');
});

test('upsert: the owner may do anything but change their own role', () => {
  const owner = { role: 'owner', callerEmail: OWNER };
  assert.deepEqual(planUpsert({ ...owner, existing: null, input: { email: 'Eli@A.test', person: 'eli' } }),
    { ok: true, insert: true, row: { email: 'eli@a.test', person: 'eli', vault: false } });
  assert.deepEqual(planUpsert({ ...owner, existing: row('n@a.test', 'nadia'), input: { email: 'n@a.test', vault: true } }),
    { ok: true, insert: false, row: { email: 'n@a.test', person: 'nadia', vault: true } });
  assert.equal(planUpsert({ ...owner, existing: null, input: { email: 'x@a.test', person: 'lior', vault: true } }).ok, true);
  assert.equal(planUpsert({ ...owner, existing: null, input: { email: 'second@a.test', person: null } }).ok, true);
  assert.equal(planUpsert({ ...owner, existing: row(OWNER, null), input: { email: OWNER, vault: false } }).ok, true);
  assert.equal(planUpsert({ ...owner, existing: row(OWNER, null), input: { email: OWNER, person: 'irit' } }).error, ERR.ownRole);
  assert.equal(planUpsert({ ...owner, existing: null, input: { email: 'x@a.test', person: 'shirel' } }).error, ERR.badPerson);
  assert.equal(planUpsert({ ...owner, existing: null, input: { email: 'x@a.test', person: 'editor' } }).error, ERR.badPerson);
  assert.equal(planUpsert({ ...owner, existing: null, input: { email: 'x@a.test' } }).error, ERR.badPerson);
  assert.equal(planUpsert({ ...owner, existing: null, input: { email: 'nope', person: 'eli' } }).error, ERR.badEmail);
  assert.equal(planUpsert({ ...owner, existing: null, input: { email: 'x@a.test', person: 'eli', vault: 'yes' } }).error, ERR.badRequest);
});

test('upsert: Irit and Lior add staff without the vault, and never touch the owner or a manager', () => {
  const irit = { role: 'manager', callerEmail: 'irit@a.test' };
  assert.deepEqual(planUpsert({ ...irit, existing: null, input: { email: 'eli@a.test', person: 'eli' } }),
    { ok: true, insert: true, row: { email: 'eli@a.test', person: 'eli', vault: false } });
  // Editing a staff row keeps its vault flag.
  assert.deepEqual(planUpsert({ ...irit, existing: row('n@a.test', 'nadia', true), input: { email: 'n@a.test', person: 'yariv' } }).row,
    { email: 'n@a.test', person: 'yariv', vault: true });
  const refused = [
    [{ existing: null, input: { email: 'x@a.test', person: 'eli', vault: false } }, ERR.ownerOnly],
    [{ existing: row('n@a.test', 'nadia'), input: { email: 'n@a.test', vault: true } }, ERR.ownerOnly],
    [{ existing: row(OWNER, null), input: { email: OWNER, person: null } }, ERR.ownerOnly],
    [{ existing: row('l@a.test', 'lior'), input: { email: 'l@a.test', person: 'lior' } }, ERR.ownerOnly],
    [{ existing: null, input: { email: 'x@a.test', person: null } }, ERR.ownerOnly],
    [{ existing: null, input: { email: 'x@a.test', person: 'lior' } }, ERR.ownerOnly],
    [{ existing: row('n@a.test', 'nadia'), input: { email: 'n@a.test', person: 'irit' } }, ERR.ownerOnly],
    [{ existing: null, input: { email: 'x@a.test', person: 'nadia' }, personTaken: true }, ERR.personTaken],
  ];
  for (const [args, error] of refused) assert.equal(planUpsert({ ...irit, ...args }).error, error, JSON.stringify(args));
  assert.equal(planUpsert({ role: null, callerEmail: 'n@a.test', existing: null, input: { email: 'x@a.test', person: 'eli' } }).error, ERR.notAllowed);
});

test('upsert: adding an email already on the list never moves that person into another role', () => {
  const irit = { role: 'manager', callerEmail: 'irit@a.test' };
  const owner = { role: 'owner', callerEmail: OWNER };
  // Irit types Nirel's email into Ofir's empty row; the owner types Irit's.
  assert.deepEqual(planUpsert({ ...irit, existing: row('nirel@a.test', 'nirel'), input: { email: 'nirel@a.test', person: 'ofir', mode: 'add' } }),
    { ok: false, status: 409, error: ERR.emailTaken });
  assert.deepEqual(planUpsert({ ...owner, existing: row('irit@a.test', 'irit', true), input: { email: 'Irit@a.test', person: 'ofir', mode: 'add' } }),
    { ok: false, status: 409, error: ERR.emailTaken });
  assert.equal(planUpsert({ ...owner, existing: row(OWNER, null, true), input: { email: OWNER, person: 'ofir', mode: 'add' } }).error, ERR.emailTaken);
  assert.equal(planUpsert({ ...irit, existing: row(OWNER, null, true), input: { email: OWNER, person: 'ofir', mode: 'add' } }).error, ERR.emailTaken);
  // A new email is added as before.
  assert.deepEqual(planUpsert({ ...irit, existing: null, input: { email: 'eli@a.test', person: 'eli', mode: 'add' } }),
    { ok: true, insert: true, row: { email: 'eli@a.test', person: 'eli', vault: false } });
  assert.equal(planUpsert({ ...owner, existing: null, input: { email: 'eli@a.test', person: 'eli', mode: 'add' } }).ok, true);
  assert.equal(planUpsert({ ...owner, existing: null, input: { email: 'eli@a.test', person: 'eli', mode: 'edit' } }).error, ERR.badRequest);
  // A manager's edit may not give a role that another row already has.
  assert.equal(planUpsert({ ...irit, existing: row('n@a.test', 'nadia'), input: { email: 'n@a.test', person: 'yariv' }, personTaken: true }).error, ERR.personTaken);
  assert.equal(planUpsert({ ...irit, existing: row('n@a.test', 'nadia'), input: { email: 'n@a.test', person: 'nadia' }, personTaken: true }).ok, true);
});

test('upsert: only the owner adds an email that already has a login (a manager could then make a link into it)', () => {
  const input = { email: 'books@a.test', person: 'eli', mode: 'add' };
  assert.deepEqual(planUpsert({ role: 'manager', callerEmail: 'irit@a.test', existing: null, input, hasLogin: true }),
    { ok: false, status: 409, error: ERR.hasLogin });
  assert.equal(planUpsert({ role: 'manager', callerEmail: 'irit@a.test', existing: null, input, hasLogin: false }).ok, true);
  assert.equal(planUpsert({ role: 'owner', callerEmail: OWNER, existing: null, input, hasLogin: true }).ok, true);
});

test('remove: owner only, never their own row', () => {
  assert.equal(planRemove({ role: 'owner', callerEmail: OWNER, existing: row('n@a.test', 'nadia') }).ok, true);
  assert.equal(planRemove({ role: 'owner', callerEmail: OWNER, existing: row(OWNER, null) }).error, ERR.cannotRemoveSelf);
  assert.equal(planRemove({ role: 'owner', callerEmail: OWNER, existing: null }).error, ERR.notFound);
  assert.equal(planRemove({ role: 'manager', callerEmail: 'i@a.test', existing: row('n@a.test', 'nadia') }).error, ERR.ownerOnly);
});

test('link: only for staff, the owner\'s only by the owner, only to an allowed page', () => {
  const page = LINK_PAGES[1];
  const irit = row('i@a.test', 'irit', true);
  assert.deepEqual(planLink({ role: 'manager', me: irit, target: row('n@a.test', 'nadia'), redirectTo: page }), { ok: true, page });
  assert.equal(planLink({ role: 'manager', me: irit, target: row('l@a.test', 'lior', true), redirectTo: page }).ok, true);
  assert.equal(planLink({ role: 'owner', target: row(OWNER, null), redirectTo: page }).ok, true);
  assert.equal(planLink({ role: 'manager', me: irit, target: row(OWNER, null), redirectTo: page }).error, ERR.ownerOnly);
  assert.equal(planLink({ role: 'owner', target: null, redirectTo: page }).error, ERR.notStaff);
  assert.equal(planLink({ role: 'owner', target: row('n@a.test', 'nadia'), redirectTo: 'https://evil.example/clients.html' }).error, ERR.badRedirect);
  assert.equal(planLink({ role: null, target: row('n@a.test', 'nadia'), redirectTo: page }).error, ERR.notAllowed);
});

test('link: a manager gets no link into more than the manager has (the vault, a payouts owner)', () => {
  const page = LINK_PAGES[0];
  const ofir = row('o@a.test', 'ofir', true);
  const nadia = row('n@a.test', 'nadia', false);
  const iritNoVault = row('i@a.test', 'irit', false);
  // The owner took Irit's vault away: she cannot get into Ofir's (or Lior's) account to read it.
  assert.deepEqual(planLink({ role: 'manager', me: iritNoVault, target: ofir, redirectTo: page }), { ok: false, status: 403, error: ERR.ownerOnly });
  assert.equal(planLink({ role: 'manager', me: iritNoVault, target: row('l@a.test', 'lior', true), redirectTo: page }).error, ERR.ownerOnly);
  assert.equal(planLink({ role: 'manager', target: ofir, redirectTo: page }).error, ERR.ownerOnly, 'no caller row: no vault');
  assert.equal(planLink({ role: 'manager', me: iritNoVault, target: nadia, redirectTo: page }).ok, true);
  assert.equal(planLink({ role: 'manager', me: row('i@a.test', 'irit', true), target: ofir, redirectTo: page }).ok, true);
  assert.equal(planLink({ role: 'owner', me: row(OWNER, null, false), target: ofir, redirectTo: page }).ok, true);
  // A payouts owner's login, whatever its staff row says.
  assert.equal(planLink({ role: 'manager', me: row('i@a.test', 'irit', true), target: nadia, redirectTo: page, targetIsPayoutOwner: true }).error, ERR.ownerOnly);
  assert.equal(planLink({ role: 'owner', target: nadia, redirectTo: page, targetIsPayoutOwner: true }).ok, true);
});

test('first link invites; later ones reset the password; the link carries only the token hash, in the fragment', () => {
  assert.equal(linkTypeFor(null), 'invite');
  assert.equal(linkTypeFor({ id: 'u1' }), 'recovery');
  const link = buildLoginLink(LINK_PAGES[0], 'invite', 'abc123');
  assert.equal(link, 'https://adamsin155.github.io/---/clients.html#type=invite&token_hash=abc123');
  const u = new URL(link);
  assert.equal(u.search, '');
  assert.equal(new URLSearchParams(u.hash.slice(1)).get('token_hash'), 'abc123');
});

test('the list never carries tokens or user metadata', () => {
  const authUser = {
    id: 'u1', email: 'n@a.test', email_confirmed_at: '2026-09-29T08:00:00Z', last_sign_in_at: '2026-09-29T09:00:00Z',
    invited_at: '2026-09-28T08:00:00Z', confirmation_token: 'SECRET', recovery_token: 'SECRET', user_metadata: { a: 'SECRET' },
    app_metadata: { provider: 'email' }, identities: [{ id: 'SECRET' }], phone: '050',
  };
  const out = summarize({ email: 'n@a.test', person: 'nadia', vault: true, created_at: '2026-09-01' }, authUser, { at: '2026-09-29T10:00:00Z', by_email: 'i@a.test' });
  assert.deepEqual(out, {
    email: 'n@a.test', person: 'nadia', vault: true, created_at: '2026-09-01', has_login: true, confirmed: true,
    last_sign_in_at: '2026-09-29T09:00:00Z', invited_at: '2026-09-28T08:00:00Z', last_link_at: '2026-09-29T10:00:00Z', last_link_by: 'i@a.test',
  });
  assert.doesNotMatch(JSON.stringify(out), /SECRET|050/);
  assert.deepEqual(summarize({ email: 'x@a.test', person: null, vault: false }), {
    email: 'x@a.test', person: null, vault: false, created_at: null, has_login: false, confirmed: false,
    last_sign_in_at: null, invited_at: null, last_link_at: null, last_link_by: null,
  });
});

test('rate limits have their own code', () => {
  assert.equal(linkErrorCode({ status: 429, message: 'x' }), ERR.tooSoon);
  assert.equal(linkErrorCode({ message: 'For security purposes, you can only request this after 30 seconds.' }), ERR.tooSoon);
  assert.equal(linkErrorCode({ message: 'boom' }), ERR.linkFailed);
});

test('the function is deployable on its own and does not log links or tokens', () => {
  const src = readFileSync(new URL('../supabase/functions/staff-admin/index.ts', import.meta.url), 'utf8');
  const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ['./rules.js', 'npm:@supabase/supabase-js@2']);
  assert.match(src, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(src, /auth\.getUser\(token\)/);
  // The function hands the rules what they check (a manager's own vault, a payouts
  // owner's login, an email that already has a login).
  assert.match(src, /planLink\(\{ role, me, target, redirectTo: body\.redirectTo, targetIsPayoutOwner \}\)/);
  assert.match(src, /from\('payout_owners'\)/);
  assert.match(src, /planUpsert\(\{ role, callerEmail, existing, input: body, personTaken, hasLogin \}\)/);
  const logs = [...src.matchAll(/console\.\w+\(([^;]*)\);/g)];
  assert.ok(logs.length >= 2);
  for (const m of logs) {
    const args = m[1].replace(/'[^']*'/g, "''").replace(/body\.action/g, '');
    assert.doesNotMatch(args, /\b(link|token|hashed|data|body|req|user|email)\b/, m[0]);
  }
  const rules = readFileSync(new URL('../supabase/functions/staff-admin/rules.js', import.meta.url), 'utf8');
  assert.doesNotMatch(rules, /Deno\.|^import /m);
  const config = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  assert.match(config, /\[functions\.staff-admin\]\s*\nverify_jwt = false/);
});

test('team screen: who may open it', () => {
  const { canManageTeam, isOwnerView } = teamRules;
  assert.equal(canManageTeam({ me: null, scope: 'office', error: null }), true);  // the owner
  assert.equal(isOwnerView({ me: null, scope: 'office', error: null }), true);
  assert.equal(canManageTeam({ me: 'irit', scope: 'office', error: null }), true);
  assert.equal(canManageTeam({ me: 'lior', scope: 'office', error: null }), true);
  assert.equal(canManageTeam({ me: 'ofir', scope: 'office', error: null }), false);
  assert.equal(canManageTeam({ me: 'nadia', scope: 'own', error: null }), false);
  assert.equal(canManageTeam({ me: null, scope: 'own', error: null }), false);           // 'editor' or unknown
  assert.equal(canManageTeam({ me: null, scope: 'own', error: new Error('x') }), false); // lookup failed
  assert.equal(canManageTeam(null), false);
});

test('team screen: login state and the WhatsApp message', () => {
  const { loginState, linkMessage } = teamRules;
  assert.equal(loginState(null), 'none');
  assert.equal(loginState({ has_login: false }), 'none');
  assert.equal(loginState({ has_login: true, last_sign_in_at: null }), 'pending');
  assert.equal(loginState({ has_login: true, last_sign_in_at: '2026-09-29T09:00:00Z' }), 'active');
  const link = 'https://app.astrateg.com/clients.html#type=invite&token_hash=abc';
  const invite = linkMessage({ name: 'אלי', link, type: 'invite' });
  assert.match(invite, /^היי אלי,/);
  assert.match(invite, /בוחרים סיסמה/);
  assert.match(invite, /שעה/);
  assert.ok(invite.endsWith(link), 'the link comes last, on its own line');
  assert.match(linkMessage({ name: '', link, type: 'recovery' }), /^היי,\n.*סיסמה חדשה/);
});
