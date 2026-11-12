// The sales CRM's AI brief asks here for our videos of the same field (supabase/functions/sales-samples):
// the key gate, the client list (name and business only), the finished videos of chosen clients.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { makeHandler, sameKey, finishedVideos, pageHandle } from '../supabase/functions/sales-samples/handler.js';
import { TOKEN_URL } from '../supabase/functions/_shared/drive.js';
import { fakeClient } from './fake-pgrest.mjs';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = JSON.stringify({ client_email: 'robot@x.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
const KEY = 'k'.repeat(48);
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const CLIENTS = [
  { id: A, name: 'מוסך הצפון', business: 'מוסך', phone: '0500000000', notes: 'סוד', links: { drive: 'https://drive.google.com/drive/folders/FolderA123456' }, archived_at: null },
  { id: B, name: 'מספרת דנה', business: null, links: { drive: 'https://drive.google.com/drive/folders/FolderB123456' }, archived_at: null },
  { id: C, name: 'ארכיון', business: 'מוסך', links: { drive: 'https://drive.google.com/drive/folders/FolderC123456' }, archived_at: '2026-10-01' },
  { id: 'no-folder', name: 'בלי דרייב', business: 'מסעדה', links: {}, archived_at: null },
];
const FILES = {
  FolderA123456: [
    { id: 'f1', name: 'old.mp4', mimeType: 'video/mp4', createdTime: '2026-09-01T00:00:00Z', webViewLink: 'https://drive/old' },
    { id: 'f2', name: 'new.mp4', mimeType: 'video/mp4', createdTime: '2026-10-01T00:00:00Z', webViewLink: 'https://drive/new' },
    { id: 'f3', name: 'logo.png', mimeType: 'image/png', createdTime: '2026-10-02T00:00:00Z', webViewLink: 'https://drive/logo' },
    { id: 'raw', name: 'גלם יום 1', mimeType: 'application/vnd.google-apps.folder', createdTime: '2026-10-03T00:00:00Z' },
  ],
  raw: [{ id: 'f4', name: 'clip.mov', mimeType: 'video/quicktime', createdTime: '2026-10-04T00:00:00Z', webViewLink: 'https://drive/raw' }],
};
function driveFetch() {
  return async (url) => {
    if (url === TOKEN_URL) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }));
    const q = new URL(url).searchParams.get('q');
    const id = /'([^']+)' in parents/.exec(q)[1];
    if (!FILES[id]) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify({ files: FILES[id] }));
  };
}
const env = (over = {}) => (n) => ({ SUPABASE_URL: 'http://db', SUPABASE_SERVICE_ROLE_KEY: 'srv', CRM_SAMPLES_KEY: KEY, GOOGLE_DRIVE_SERVICE_ACCOUNT: SA, ...over })[n];
const post = (body, key = KEY) => new Request('http://x/sales-samples', { method: 'POST', headers: key ? { 'x-crm-key': key } : {}, body: JSON.stringify(body) });
function handler(over) {
  const db = fakeClient({ clients: CLIENTS });
  return { db, handle: makeHandler({ env: env(over), createClient: () => db, fetch: driveFetch() }) };
}

test('the key: equal, long enough, nothing else', () => {
  assert.equal(sameKey(KEY, KEY), true);
  assert.equal(sameKey(`${KEY}x`, KEY), false);
  assert.equal(sameKey('short', 'short'), false);
  assert.equal(sameKey(null, KEY), false);
});

test('no secret, no key or a wrong key: nothing is read', async () => {
  let r = await handler({ CRM_SAMPLES_KEY: '' }).handle(post({}));
  assert.equal(r.status, 503);
  const h = handler();
  r = await h.handle(post({}, null));
  assert.equal(r.status, 401);
  r = await h.handle(post({}, 'x'.repeat(48)));
  assert.equal(r.status, 401);
  assert.equal(h.db.reads.length, 0);
  r = await h.handle(new Request('http://x', { method: 'GET' }));
  assert.equal(r.status, 405);
});

test('the list: clients with a Drive folder, not archived, name and business only', async () => {
  const r = await handler().handle(post({}));
  assert.equal(r.status, 200);
  const { clients } = await r.json();
  assert.deepEqual(clients, [{ id: A, name: 'מוסך הצפון', business: 'מוסך' }, { id: B, name: 'מספרת דנה', business: null }]);
  assert.ok(!JSON.stringify(clients).includes('0500000000') && !JSON.stringify(clients).includes('סוד'));
});

test('the videos of chosen clients: finished, newest first; raw footage and images left out', async () => {
  const r = await handler().handle(post({ client_ids: [A, B, C] }));
  assert.equal(r.status, 200);
  const { samples } = await r.json();
  assert.deepEqual(samples, [
    { id: A, name: 'מוסך הצפון', business: 'מוסך', videos: [{ name: 'new.mp4', link: 'https://drive/new' }, { name: 'old.mp4', link: 'https://drive/old' }] },
    { id: B, name: 'מספרת דנה', business: null, videos: [] },
  ], 'B has a folder the robot cannot open; C is archived');
});

test('the ids: one to three uuids; the robot must be set', async () => {
  const h = handler();
  for (const ids of [[], [A, B, C, A.replace('1', '4')], ['x'], 'A']) assert.equal((await h.handle(post({ client_ids: ids }))).status, 400);
  assert.equal((await handler({ GOOGLE_DRIVE_SERVICE_ACCOUNT: '' }).handle(post({ client_ids: [A] }))).status, 503);
});

test('the showcase: posted videos with a link and page handles, never a password or a login', async () => {
  const GANTT = [
    { client_id: A, kind: 'video', title: 'רילס החלפת שמן', state: 'posted', posted_on: '2026-10-05', link: 'https://www.instagram.com/reel/AAA/', internal: false },
    { client_id: A, kind: 'custom', title: 'ישן', state: 'posted', posted_on: '2026-09-05', link: 'https://www.instagram.com/reel/OLD/', internal: false },
    { client_id: A, kind: 'graphic', title: 'גרפיקה', state: 'posted', posted_on: '2026-10-01', link: 'https://www.instagram.com/p/GRA/', internal: false },
    { client_id: A, kind: 'video', title: 'מתוכנן', state: 'planned', posted_on: null, link: 'https://www.instagram.com/reel/PLN/', internal: false },
    { client_id: A, kind: 'video', title: 'בלי קישור', state: 'posted', posted_on: '2026-10-06', link: null, internal: false },
    { client_id: A, kind: 'plan', title: 'תכנון', state: 'posted', posted_on: '2026-10-07', link: 'https://x.test/plan', internal: true },
    { client_id: C, kind: 'video', title: 'ארכיון', state: 'posted', posted_on: '2026-10-05', link: 'https://www.instagram.com/reel/ARC/', internal: false },
  ];
  const ACCESS = [
    { client_id: A, network: 'instagram', username: '@garage_north', secret_id: 'SECRET' },
    { client_id: A, network: 'facebook', username: 'owner@gmail.com', secret_id: 'SECRET' },
    { client_id: A, network: 'tiktok', username: '0501234567', secret_id: 'SECRET' },
    { client_id: B, network: 'tiktok', username: 'dana.hair', secret_id: 'SECRET' },
    { client_id: B, network: 'google', username: 'dana.hair', secret_id: 'SECRET' },
  ];
  const db = fakeClient({ clients: CLIENTS, client_gantt: GANTT, client_access: ACCESS });
  const r = await makeHandler({ env: env(), createClient: () => db, fetch: driveFetch() })(post({ showcase: true }));
  assert.equal(r.status, 200);
  const { clients } = await r.json();
  assert.deepEqual(clients, [
    { id: A, name: 'מוסך הצפון', business: 'מוסך', reels: [
      { title: 'רילס החלפת שמן', link: 'https://www.instagram.com/reel/AAA/', posted_on: '2026-10-05' },
      { title: 'ישן', link: 'https://www.instagram.com/reel/OLD/', posted_on: '2026-09-05' }],
    pages: [{ network: 'instagram', username: 'garage_north' }] },
    { id: B, name: 'מספרת דנה', business: null, reels: [], pages: [{ network: 'tiktok', username: 'dana.hair' }] },
  ]);
  const access = db.reads.find((x) => x.table === 'client_access');
  assert.ok(!access.cols.includes('secret'), 'the password is never read');
  assert.ok(!JSON.stringify(clients).includes('gmail') && !JSON.stringify(clients).includes('0501234567'));
});

test('pageHandle: a handle, not an e-mail or a phone', () => {
  assert.equal(pageHandle('@natali.dadon'), 'natali.dadon');
  assert.equal(pageHandle('a@b.com'), null);
  assert.equal(pageHandle('050-1234567'), null);
  assert.equal(pageHandle(''), null);
});

test('finishedVideos keeps three at most', () => {
  const many = Array.from({ length: 5 }, (_, i) => ({ name: `${i}.mp4`, mimeType: 'video/mp4', createdTime: `2026-10-0${i + 1}`, link: `l${i}`, path: '' }));
  assert.deepEqual(finishedVideos(many).map((v) => v.name), ['4.mp4', '3.mp4', '2.mp4']);
});
