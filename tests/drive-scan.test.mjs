// The Drive counts by day (docs/ops.md, section 83): what a file counts as by its folder, the rows
// of a listing in Israel's days, a file that is gone, the batch of each run, and the listing that
// asks only for what is new and still walks the old folders.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileClass, makeDrive, FOLDER_MIME } from '../supabase/functions/_shared/drive.js';
import { dayRows, mergeRows, runScan, BATCH } from '../supabase/functions/drive-scan/scan.js';

const VIDEO = 'video/mp4';
const IMAGE = 'image/png';

test('what a file counts as: the folder names the office really uses', () => {
  for (const p of ['סרטונים מוכנים', 'מוכנים', 'סופי', 'גלם יום 1/סופי', 'סרטונים עם סגיר', 'מתוקן כתוביות', 'סרטונים', '']) assert.equal(fileClass(VIDEO, p), 'video', p);
  for (const p of ['חומר גלם', 'גלם מצלמה', 'מצלמה', 'יום צילום 3', 'בירולים ', 'רחפן', 'גלם יום 1/סרטונים', 'חומר גלם /ראיונות']) assert.equal(fileClass(VIDEO, p), 'raw', p);
  for (const p of ['גרפיקות', 'גרפיקות ', 'היילייטים']) assert.equal(fileClass(IMAGE, p), 'graphic', p);
  assert.equal(fileClass('application/pdf', 'גרפיקות'), 'graphic');
  for (const p of ['תמונות', 'גלם יום 1/תמונות ', 'יום צילום 2']) assert.equal(fileClass(IMAGE, p), 'raw', p);
  assert.equal(fileClass(IMAGE, ''), 'other');
  assert.equal(fileClass('application/pdf', 'תסריטים'), 'other');
});

test('the rows: per Israel day, folder and kind; a folder itself is not a file', () => {
  const rows = dayRows([
    { mimeType: VIDEO, path: 'מוכנים', createdTime: '2026-10-29T22:30:00Z' }, // 00:30 on the 30th in Israel
    { mimeType: VIDEO, path: 'מוכנים', createdTime: '2026-10-30T08:00:00Z' },
    { mimeType: IMAGE, path: 'גרפיקות ', createdTime: '2026-10-30T08:00:00Z' },
    { mimeType: FOLDER_MIME, path: '', createdTime: '2026-10-30T08:00:00Z' },
    { mimeType: VIDEO, path: 'מוכנים', createdTime: null },
  ]);
  assert.deepEqual(rows, [
    { day: '2026-10-30', folder: 'מוכנים', kind: 'video', files: 2 },
    { day: '2026-10-30', folder: 'גרפיקות', kind: 'graphic', files: 1 },
  ]);
});

test('what was counted and is gone goes to 0, never out of the table', () => {
  const fresh = [{ day: '2026-10-30', folder: 'מוכנים', kind: 'video', files: 2 }];
  const before = [{ day: '2026-10-30', folder: 'מוכנים', kind: 'video' }, { day: '2026-10-29', folder: 'גרפיקות', kind: 'graphic' }];
  assert.deepEqual(mergeRows('c1', fresh, before), [
    { client_id: 'c1', day: '2026-10-30', folder: 'מוכנים', kind: 'video', files: 2 },
    { client_id: 'c1', day: '2026-10-29', folder: 'גרפיקות', kind: 'graphic', files: 0 },
  ]);
});

const FOLDER = 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp';
function fakeStore(targets) {
  const saved = []; const states = [];
  return { saved, states, targets: async () => targets, before: async () => [], save: async (r) => saved.push(...r), state: async (s) => states.push(s) };
}

test('a run: the clients counted longest ago, never counted first; a failure is written and does not stop the rest', async () => {
  const targets = Array.from({ length: BATCH + 3 }, (_, i) => ({ id: `c${i}`, links: { drive: FOLDER }, scanned_at: `2026-10-${10 + i}T00:00:00Z` }));
  targets.push({ id: 'new', links: { drive: FOLDER }, scanned_at: null }, { id: 'bad', links: { drive: 'https://example.com/x' }, scanned_at: null });
  const store = fakeStore(targets);
  const asked = [];
  let calls = 0;
  const drive = { list: async (id, opts) => {
    asked.push(opts);
    calls += 1;
    if (calls === 2) throw Object.assign(new Error('x'), { code: 'no_access' });
    return { files: [{ mimeType: VIDEO, path: 'מוכנים', createdTime: '2026-10-30T08:00:00Z' }], truncated: false };
  } };
  const stats = await runScan({ store, drive, now: new Date('2026-10-30T10:00:00Z') });
  assert.equal(store.states.length, BATCH);
  assert.deepEqual(store.states.slice(0, 2).map((s) => s.client_id).sort(), ['bad', 'new']);
  assert.equal(store.states.find((s) => s.client_id === 'bad').error, 'not_a_folder');
  assert.equal(store.states.filter((s) => s.error === 'no_access').length, 1);
  assert.equal(stats.failed, 2);
  assert.equal(stats.clients, BATCH - 2);
  assert.equal(stats.files, BATCH - 2);
  // Thirty days back, from the start of the day in Israel.
  assert.equal(asked[0].since, '2026-09-29T21:00:00.000Z');
});

test('out of time: the run stops taking clients, the next one goes on', async () => {
  const store = fakeStore([{ id: 'a', links: { drive: FOLDER } }, { id: 'b', links: { drive: FOLDER } }]);
  let t = 0;
  const stats = await runScan({ store, drive: { list: async () => { t += 100; return { files: [], truncated: false }; } }, clock: () => t, budgetMs: 50 });
  assert.equal(stats.clients, 1);
  assert.deepEqual(store.saved, []);
});

test('the listing with `since`: Google is asked for new files and every folder, and goes one level deeper', async () => {
  const urls = [];
  const fetch = async (url) => {
    if (String(url).includes('oauth2')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }));
    const q = new URL(url).searchParams.get('q');
    urls.push(q);
    const parent = /'([^']+)' in parents/.exec(q)[1];
    const next = { root: 'l1', l1: 'l2', l2: 'l3' }[parent];
    return new Response(JSON.stringify({ files: next ? [{ id: next, name: next, mimeType: FOLDER_MIME }] : [{ id: 'f', name: 'x', mimeType: VIDEO, createdTime: '2026-10-30T08:00:00Z' }] }));
  };
  const { generateKeyPairSync } = await import('node:crypto');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const sa = { email: 'robot@x', key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const { files } = await makeDrive(sa, { fetch }).list('root', { since: '2026-09-29T21:00:00.000Z', maxDepth: 3, maxFiles: 5000 });
  assert.ok(urls[0].includes(`(mimeType = '${FOLDER_MIME}' or createdTime > '2026-09-29T21:00:00.000Z')`));
  assert.equal(files.find((f) => f.mimeType === VIDEO).path, 'l1/l2/l3');
});
