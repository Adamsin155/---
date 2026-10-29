// The client's Google Drive folder, read-only (docs/ops.md, section 74): the folder's id from the
// card's link, the robot account's signed request for a token, the listing (pages, subfolders, a
// folder not shared), the drive function's gate, and "משיכת קישורים מהדרייב" in the Gantt: the
// date at the start of a file's name and the match to the Gantt's items (never over a link).
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import {
  folderIdOf, serviceAccountOf, signedAssertion, makeDrive, summarize, kindOf, SCOPE, TOKEN_URL, MAX_FILES,
} from '../supabase/functions/_shared/drive.js';
import { makeHandler } from '../supabase/functions/drive/handler.js';
import { dateOfName, fileType, matchFiles, linkable } from '../app/drive-links.js';
import { fakeClient } from './fake-pgrest.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
const SA = { client_email: 'robot@astrateg-drive.iam.gserviceaccount.com', private_key: PEM, type: 'service_account' };

test('the folder id from what the office pastes', () => {
  assert.equal(folderIdOf('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?usp=sharing'), '1AbCdEfGhIjKlMnOp');
  assert.equal(folderIdOf('https://drive.google.com/drive/u/1/folders/1AbCdEfGhIjKlMnOp'), '1AbCdEfGhIjKlMnOp');
  assert.equal(folderIdOf('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp'), '1AbCdEfGhIjKlMnOp');
  assert.equal(folderIdOf(' 1AbCdEfGhIjKlMnOp '), '1AbCdEfGhIjKlMnOp');
  assert.equal(folderIdOf('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view'), null, 'a file, not a folder');
  assert.equal(folderIdOf('https://evil.test/drive/folders/1AbCdEfGhIjKlMnOp'), null);
  assert.equal(folderIdOf('http://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp'), null);
  assert.equal(folderIdOf(''), null);
  assert.equal(folderIdOf(null), null);
});

test('the secret: a service account\'s JSON key, or nothing', () => {
  assert.deepEqual(serviceAccountOf(JSON.stringify(SA)), { email: SA.client_email, key: PEM });
  assert.equal(serviceAccountOf(''), null);
  assert.equal(serviceAccountOf('{oops'), null);
  assert.equal(serviceAccountOf(JSON.stringify({ client_email: 'a@b' })), null);
});

test('the signed request for a token: RS256, read-only metadata scope, one hour', async () => {
  const jwt = await signedAssertion({ email: SA.client_email, key: PEM }, { now: Date.parse('2026-11-12T08:00:00Z') });
  const [h, c, s] = jwt.split('.');
  const json = (x) => JSON.parse(Buffer.from(x, 'base64url').toString());
  assert.deepEqual(json(h), { alg: 'RS256', typ: 'JWT' });
  const claims = json(c);
  assert.equal(claims.iss, SA.client_email);
  assert.equal(claims.scope, SCOPE);
  assert.equal(SCOPE, 'https://www.googleapis.com/auth/drive.metadata.readonly');
  assert.equal(claims.aud, TOKEN_URL);
  assert.equal(claims.exp - claims.iat, 3600);
  const v = createVerify('RSA-SHA256');
  v.update(`${h}.${c}`);
  assert.ok(v.verify(publicKey, Buffer.from(s, 'base64url')), 'Google can check it with the public key');
  // A key pasted with literal "\n" (as a one-line secret) works too.
  const flat = PEM.replace(/\n/g, '\\n');
  assert.ok((await signedAssertion({ email: SA.client_email, key: flat })).split('.').length === 3);
});

// Google, faked: the token endpoint and files.list over a small tree.
function fakeGoogle(tree, { tokenStatus = 200 } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push(u.origin + u.pathname);
    if (url === TOKEN_URL) {
      assert.match(String(init.body), /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer/);
      return new Response(JSON.stringify(tokenStatus === 200 ? { access_token: 'ya29.x', expires_in: 3600 } : { error: 'invalid_grant' }), { status: tokenStatus });
    }
    assert.equal(init.headers.Authorization, 'Bearer ya29.x');
    const parent = /'([^']+)' in parents/.exec(u.searchParams.get('q'))[1];
    assert.equal(u.searchParams.get('supportsAllDrives'), 'true');
    if (!(parent in tree)) return new Response('{}', { status: 404 });
    const all = tree[parent];
    const start = Number(u.searchParams.get('pageToken') || 0);
    const page = all.slice(start, start + 2);
    return new Response(JSON.stringify({ files: page, ...(start + 2 < all.length ? { nextPageToken: String(start + 2) } : {}) }), { status: 200 });
  };
  return { fetch, calls };
}
const vid = (id, name, at) => ({ id, name, mimeType: 'video/mp4', createdTime: at, webViewLink: `https://drive.google.com/file/d/${id}/view` });

test('the listing: every page, the subfolders, a folder not shared', async () => {
  const tree = {
    root: [vid('a', '15.11 רילס.mp4', '2026-11-10T10:00:00Z'), { id: 'sub', name: 'נובמבר', mimeType: 'application/vnd.google-apps.folder' }, vid('b', 'b.mp4', '2026-11-01T10:00:00Z')],
    sub: [vid('c', '16.11 טיזר.mp4', '2026-11-11T10:00:00Z'), { id: 'gone', name: 'ישן', mimeType: 'application/vnd.google-apps.folder' }],
  };
  const g = fakeGoogle(tree);
  const drive = makeDrive({ email: SA.client_email, key: PEM }, { fetch: g.fetch });
  const { files, truncated } = await drive.list('root');
  assert.equal(truncated, false);
  assert.deepEqual(files.map((f) => [f.name, f.path]), [['15.11 רילס.mp4', ''], ['נובמבר', ''], ['b.mp4', ''], ['16.11 טיזר.mp4', 'נובמבר'], ['ישן', 'נובמבר']]);
  assert.equal(g.calls.filter((c) => c === TOKEN_URL).length, 1, 'one token for the whole listing');
  const s = summarize(files);
  assert.deepEqual(s.counts, { video: 3, image: 0, doc: 0, other: 0, folder: 2 });
  assert.equal(s.files[0].name, '16.11 טיזר.mp4', 'newest first');
  // Each subfolder's counts, for "are there graphics?" when the newest files are videos (29.10.2026).
  assert.deepEqual(s.folders, { 'נובמבר': { video: 1, image: 0, doc: 0, other: 0 } });
  assert.equal(kindOf('application/vnd.google-apps.document'), 'doc');
  await assert.rejects(drive.list('nope'), { code: 'no_access' });
  await assert.rejects(makeDrive({ email: SA.client_email, key: PEM }, { fetch: fakeGoogle(tree, { tokenStatus: 400 }).fetch }).list('root'), { code: 'auth' });
  // A huge folder stops at MAX_FILES.
  const big = { root: Array.from({ length: MAX_FILES + 5 }, (_, i) => vid(`v${i}`, `${i}.mp4`, '2026-11-01T00:00:00Z')) };
  const many = await makeDrive({ email: SA.client_email, key: PEM }, { fetch: fakeGoogle(big).fetch }).list('root');
  assert.equal(many.files.length, MAX_FILES);
  assert.equal(many.truncated, true);
});

// ── The drive function ─────────────────────────
const CLIENT = { id: '11111111-1111-4111-8111-111111111111', links: { drive: 'https://drive.google.com/drive/folders/root0000000' } };
function driveRig({ edit = true, sa = JSON.stringify(SA), client = CLIENT } = {}) {
  const tree = { root0000000: [vid('a', '15.11 רילס.mp4', '2026-11-10T10:00:00Z')] };
  const handle = makeHandler({
    env: (n) => ({ SUPABASE_URL: 'https://x', SUPABASE_ANON_KEY: 'anon', GOOGLE_DRIVE_SERVICE_ACCOUNT: sa })[n],
    createClient: () => fakeClient({ clients: client ? [client] : [] }, { rpc: { can_edit_gantt: edit } }),
    fetch: fakeGoogle(tree).fetch,
  });
  return (body) => handle(new Request('https://x/functions/v1/drive', { method: 'POST', headers: { Authorization: 'Bearer t', origin: 'https://app.astrateg.tech' }, body: JSON.stringify(body) }));
}
test('the drive function: Gantt editors only, a client they read, the robot set', async () => {
  const ok = await driveRig()({ client_id: CLIENT.id });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://app.astrateg.tech');
  const body = await ok.json();
  assert.deepEqual(body.files.map((f) => f.name), ['15.11 רילס.mp4']);
  assert.ok(body.files[0].link.startsWith('https://drive.google.com/'));
  assert.equal((await driveRig({ edit: false })({ client_id: CLIENT.id })).status, 403);
  assert.equal((await driveRig()({ client_id: 'x' })).status, 400);
  assert.equal((await driveRig({ client: null })({ client_id: CLIENT.id })).status, 404, 'a client the caller cannot read');
  assert.equal((await (await driveRig({ client: { ...CLIENT, links: {} } })({ client_id: CLIENT.id })).json()).error, 'no_folder');
  assert.equal((await (await driveRig({ sa: '' })({ client_id: CLIENT.id })).json()).error, 'drive_not_connected');
});

// ── The date at the start of a name ────────────
test('the date at the start of a file\'s name', () => {
  assert.deepEqual(dateOfName('15.11 רילס מבצע.mp4'), { day: 15, month: 11, year: null });
  assert.deepEqual(dateOfName('15.11.26 רילס.mp4'), { day: 15, month: 11, year: 2026 });
  assert.deepEqual(dateOfName('15/11/2026 רילס.mp4'), { day: 15, month: 11, year: 2026 });
  assert.deepEqual(dateOfName('15-11 רילס'), { day: 15, month: 11, year: null });
  assert.deepEqual(dateOfName('3.1 גרפיקה.png'), { day: 3, month: 1, year: null });
  assert.deepEqual(dateOfName('03.01_גרפיקה.png'), { day: 3, month: 1, year: null });
  assert.deepEqual(dateOfName(' 5 . 12 סטורי'), { day: 5, month: 12, year: null });
  assert.equal(dateOfName('רילס 15.11.mp4'), null, 'the date must come first');
  assert.equal(dateOfName('31.11 רילס'), null, 'no such day');
  assert.equal(dateOfName('15.13 רילס'), null);
  assert.equal(dateOfName('2026.mp4'), null);
  assert.equal(dateOfName('15.112 x'), null);
  assert.deepEqual(dateOfName('29.2 x'), { day: 29, month: 2, year: null });
  assert.equal(fileType({ mimeType: 'video/quicktime' }), 'video');
  assert.equal(fileType({ mimeType: 'application/octet-stream', name: 'a.MOV' }), 'video');
  assert.equal(fileType({ mimeType: 'image/png' }), 'image');
  assert.equal(fileType({ mimeType: 'application/pdf' }), 'other');
});

// ── The match ──────────────────────────────────
const row = (id, day, kind, extra = {}) => ({ id, day, kind, time_il: null, num: 0, link: null, ...extra });
const file = (name, mimeType = 'video/mp4', createdTime = '2026-11-10T10:00:00Z') => ({ name, mimeType, createdTime, link: `https://drive.google.com/file/d/${encodeURIComponent(name)}/view` });

test('the match: by date, by type, by order; never over a link; the rest listed', () => {
  const rows = [
    row('v15', '2026-11-15', 'video'),
    row('g15', '2026-11-15', 'graphic'),
    row('v16a', '2026-11-16', 'video', { time_il: '18:00' }),
    row('v16b', '2026-11-16', 'video', { time_il: '12:00' }),
    row('v17', '2026-11-17', 'video', { link: 'https://drive.google.com/file/d/old/view' }),
    row('s18', '2026-11-18', 'shoot'), // a shoot day takes no link
    row('v20', '2026-11-20', 'video'),
    row('v30', '2026-11-30', 'video'),
  ];
  const plan = matchFiles(rows, [
    file('15.11 גרפיקה.png', 'image/png'),
    file('15.11 רילס.mp4'),
    file('16.11 ב.mp4'),
    file('16.11 א.mp4'),
    file('16.11 ג.mp4'),           // a third video for two items
    file('17.11 חדש.mp4'),          // its item already has a link: never replaced
    file('18.11 יום צילום.mp4'),    // only a shoot day that date
    file('לוגו.png', 'image/png'),  // no date
    { name: 'נובמבר', mimeType: 'application/vnd.google-apps.folder' },
  ], { upTo: '2026-11-19' });
  const fills = Object.fromEntries(plan.fills.map((f) => [f.id, f.file]));
  assert.deepEqual(fills, { v15: '15.11 רילס.mp4', g15: '15.11 גרפיקה.png', v16b: '16.11 א.mp4', v16a: '16.11 ב.mp4' });
  assert.equal(fills.v17, undefined, 'the link already there stays');
  assert.equal(plan.already, 1);
  assert.deepEqual(plan.unplaced.map((u) => u.name).sort(), ['16.11 ג.mp4', '18.11 יום צילום.mp4', 'לוגו.png'].sort());
  assert.ok(plan.unplaced.find((u) => u.name === 'לוגו.png').why.includes('אין תאריך'));
  // Items still empty in the month the folder speaks of, up to the day given.
  assert.deepEqual(plan.empty.map((r) => r.id), []);
  assert.deepEqual(matchFiles(rows, [file('15.11 רילס.mp4')], { upTo: '2026-11-30' }).empty.map((r) => r.id), ['g15', 'v16b', 'v16a', 'v20', 'v30']);
  assert.ok(!linkable(rows[5]));
});

test('the match: the file\'s own link already in the Gantt counts as "כבר היה קישור"; Dec→Jan', () => {
  const f = file('17.11 חדש.mp4');
  const plan = matchFiles([row('v17', '2026-11-17', 'video', { link: f.link })], [f]);
  assert.equal(plan.already, 1);
  assert.equal(plan.fills.length, 0);
  // A Gantt from December into January: "3.1" is January of the next year, "28.12" this one.
  const rows = [row('d28', '2026-12-28', 'video'), row('j3', '2027-01-03', 'video'), row('j3old', '2026-01-03', 'video')];
  const p = matchFiles(rows, [file('28.12 a.mp4', 'video/mp4', '2026-12-27T10:00:00Z'), file('3.1 b.mp4', 'video/mp4', '2027-01-02T10:00:00Z')]);
  assert.deepEqual(p.fills.map((x) => [x.id, x.day]), [['d28', '2026-12-28'], ['j3', '2027-01-03']]);
  // A year in the name wins.
  const y = matchFiles(rows, [file('3.1.26 b.mp4', 'video/mp4', '2027-01-02T10:00:00Z')]);
  assert.deepEqual(y.fills.map((x) => x.id), ['j3old']);
  // No item on the date.
  assert.match(matchFiles(rows, [file('4.1 x.mp4')]).unplaced[0].why, /אין פריט בגאנט ב־4\.1/);
});
