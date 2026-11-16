// The gfx-auto function's run (supabase/functions/gfx-auto/run.js; docs/ops.md, section 138) with a
// fake database, a fake Drive and a fake Claude: stages 1 and 2 close and count, stage 3 sends the new
// images once, closes on "all fixed", keeps "missing" for the assignee's notice, and stays in its caps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runGfx } from '../supabase/functions/gfx-auto/run.js';

const NOW = new Date('2026-11-17T09:25:00Z');
const task = (id, body, extra = {}) => ({ id, status: 'open', assignee: 'ilai', client_id: `c-${id}`, body, created_at: '2026-11-04T07:12:00Z', gfx_base: 0, ...extra });

function fakeStore({ tasks, drive = [], gantt = [], checks = [], links = {} }) {
  const log = { closed: [], progress: [], saved: [] };
  return {
    log,
    async openTasks() { return tasks; },
    async drive(ids) { return drive.filter((r) => ids.includes(r.client_id)); },
    async gantt(ids) { return gantt.filter((r) => ids.includes(r.client_id)); },
    async close(id, note, n) { log.closed.push({ id, note, n }); return true; },
    async progress(id, n) { log.progress.push({ id, n }); },
    async drives(ids) { return new Map(ids.map((id) => [id, links[id] ?? 'https://drive.google.com/drive/folders/FOLDER_abcdefghij'])); },
    async checks(ids) { return checks.filter((c) => ids.includes(c.task_id)); },
    async checksSince(iso) { return [...checks, ...log.saved].filter((c) => (c.created_at || NOW.toISOString()) >= iso).length; },
    async saveCheck(row) { log.saved.push(row); },
  };
}
const img = (id, day = '2026-11-15', path = 'גרפיקות', mimeType = 'image/png', size = 1000) => ({ id, name: `${id}.png`, mimeType, createdTime: `${day}T10:00:00Z`, size, path });
function fakeAi(files, answer) {
  const calls = { list: 0, download: [], ask: [] };
  return {
    calls,
    async list() { calls.list += 1; return { files }; },
    async download(id) { calls.download.push(id); return new Uint8Array([1, 2, 3]); },
    async ask(req) { calls.ask.push(req); if (answer instanceof Error) throw answer; return { stop_reason: 'end_turn', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: JSON.stringify(answer) }] }; },
    Errors: {},
  };
}

test('stage 1 and 2: closes what shows, writes progress, leaves the rest; no AI without it', async () => {
  const store = fakeStore({
    tasks: [
      task('a', 'יוסי הדגמה- להכין גרפיקות'),
      task('b', 'מוסך הדגמה- להכין עוד גרפיקות'),
      task('c', 'משימה', { gfx_kind: 'make', gfx_count: 10, gfx_done: 1 }),
      task('d', 'לתקן גרפיקות לפי ההערות'),
      task('e', 'להתקשר ללקוח'),
      task('f', 'להכין גרפיקות', { assignee: 'nadia' }),
      task('g', 'לתזמן גרפיקות', { gfx_count: 2, gfx_kind: 'schedule', gfx_done: 0 }),
    ],
    drive: [
      { client_id: 'c-a', day: '2026-11-15', folder: 'גרפיקות', kind: 'graphic', files: 9 },
      { client_id: 'c-c', day: '2026-11-05', folder: 'גרפיקות', kind: 'graphic', files: 4 },
      { client_id: 'c-d', day: '2026-11-15', folder: 'גרפיקות', kind: 'graphic', files: 3 },
      { client_id: 'c-g', day: '2026-11-15', folder: 'גרפיקות', kind: 'graphic', files: 3 },
    ],
    gantt: [
      { client_id: 'c-b', kind: 'graphic', state: 'posted', live_at: null, created_at: '2026-10-20T11:45:00Z' },
      { client_id: 'c-g', kind: 'graphic', state: 'scheduled', live_at: '2026-11-10T11:45:00Z', created_at: '2026-10-20T11:45:00Z' },
    ],
  });
  const stats = await runGfx({ store, now: NOW });
  assert.deepEqual(store.log.closed, [{ id: 'a', note: 'נסגר אוטומטית: עלו 9 גרפיקות בדרייב ב־15.11', n: 9 }]);
  assert.deepEqual(store.log.progress, [{ id: 'c', n: 4 }, { id: 'g', n: 1 }]);
  assert.deepEqual([stats.tasks, stats.closed, stats.progress, stats.fix, stats.ai], [5, 1, 2, 1, 'off']);
  assert.deepEqual(store.log.saved, []);
});

test('stage 3: new images once; all fixed closes; the files are kept as checked', async () => {
  const fix = task('d', 'ממתקים הדגמה-לתקן גרפיקות: צבעים חיים כמו הלוגו, להוסיף את קוקה קולה');
  const drive = [{ client_id: 'c-d', day: '2026-11-15', folder: 'גרפיקות', kind: 'graphic', files: 5 }];
  const files = [img('new1'), img('new2', '2026-11-16'), img('old', '2026-11-01'), img('cover', '2026-11-15', 'היילייטס'),
    img('psd', '2026-11-15', 'גרפיקות', 'image/vnd.adobe.photoshop'), img('big', '2026-11-15', 'גרפיקות', 'image/png', 9e6), img('seen'),
    img('vid', '2026-11-15', 'גרפיקות', 'video/mp4')];
  const store = fakeStore({ tasks: [fix], drive, checks: [{ task_id: 'd', created_at: '2026-11-15T09:00:00Z', files: ['seen'], status: 'unclear' }] });
  const ai = fakeAi(files, { notes: [{ note: 'צבעים חיים', verdict: 'done', why: 'כן' }, { note: 'קוקה קולה', verdict: 'done', why: 'הלוגו מופיע' }] });
  const stats = await runGfx({ store, now: NOW, ai });
  assert.deepEqual(ai.calls.download, ['new2', 'new1'], 'the newest first; not old, a cover, a psd, a big one, one checked before, or a video');
  assert.equal(ai.calls.ask.length, 1);
  assert.deepEqual(ai.calls.ask[0].messages[0].content.map((c) => c.type), ['image', 'image', 'text']);
  assert.match(ai.calls.ask[0].messages[0].content[2].text, /קוקה קולה/);
  assert.deepEqual(store.log.saved.map((s) => [s.task_id, s.files, s.status]), [['d', ['new2', 'new1'], 'done']]);
  assert.deepEqual(store.log.closed, [{ id: 'd', note: 'נסגר אוטומטית: ה־AI בדק 2 גרפיקות מול ההערות', n: null }]);
  assert.deepEqual([stats.checked, stats.aiClosed], [1, 1]);
});

test('stage 3: a note not fixed stays open and is kept as "missing"; nothing new: no call at all', async () => {
  const fix = task('d', 'לתקן גרפיקות לפי ההערות');
  const drive = [{ client_id: 'c-d', day: '2026-11-15', folder: 'גרפיקות', kind: 'graphic', files: 1 }];
  const store = fakeStore({ tasks: [fix], drive });
  const ai = fakeAi([img('n1')], { notes: [{ note: 'הטלפון', verdict: 'not_done', why: 'המספר הישן' }] });
  const stats = await runGfx({ store, now: NOW, ai });
  assert.deepEqual(store.log.closed, []);
  assert.equal(store.log.saved[0].status, 'missing');
  assert.equal(stats.missing, 1);
  // Nothing in the Drive's counts since the task: Google and Claude are not called.
  const quiet = fakeStore({ tasks: [fix], drive: [] });
  const ai2 = fakeAi([img('n1')], { notes: [] });
  await runGfx({ store: quiet, now: NOW, ai: ai2 });
  assert.deepEqual([ai2.calls.list, ai2.calls.ask.length], [0, 0]);
  // Only files checked before: no call.
  const seen = fakeStore({ tasks: [fix], drive, checks: [{ task_id: 'd', created_at: '2026-11-16T09:00:00Z', files: ['n1'], status: 'missing' }] });
  const ai3 = fakeAi([img('n1')], { notes: [] });
  await runGfx({ store: seen, now: NOW, ai: ai3 });
  assert.equal(ai3.calls.ask.length, 0);
});

test('stage 3: a failed call is kept as an error (the files are tried again later); the caps hold', async () => {
  const drive = (ids) => ids.map((id) => ({ client_id: `c-${id}`, day: '2026-11-15', folder: 'גרפיקות', kind: 'graphic', files: 1 }));
  const ids = ['p', 'q', 'r', 's', 't'];
  const store = fakeStore({ tasks: ids.map((id) => task(id, 'לתקן גרפיקות')), drive: drive(ids) });
  const ai = fakeAi([img('x')], Object.assign(new Error('boom'), { status: 500 }));
  const stats = await runGfx({ store, now: NOW, ai });
  assert.equal(stats.checked, 3, 'three checks in one run');
  assert.deepEqual(store.log.saved.map((s) => s.status), ['error', 'error', 'error']);
  // An error does not mark the files checked: the next run sends them again.
  const again = fakeStore({ tasks: [task('p', 'לתקן גרפיקות')], drive: drive(['p']), checks: [{ task_id: 'p', created_at: '2026-11-16T09:00:00Z', files: ['x'], status: 'error' }] });
  const ok = fakeAi([img('x')], { notes: [{ note: 'א', verdict: 'done', why: '' }] });
  await runGfx({ store: again, now: NOW, ai: ok });
  assert.deepEqual(ok.calls.download, ['x']);
  // Two checks of a task today already: not a third.
  const today = fakeStore({ tasks: [task('p', 'לתקן גרפיקות')], drive: drive(['p']), checks: [
    { task_id: 'p', created_at: '2026-11-17T06:00:00Z', files: ['a'], status: 'missing' }, { task_id: 'p', created_at: '2026-11-17T07:00:00Z', files: ['b'], status: 'missing' }] });
  const ai4 = fakeAi([img('x')], { notes: [] });
  await runGfx({ store: today, now: NOW, ai: ai4 });
  assert.equal(ai4.calls.ask.length, 0);
  // Twenty checks today in all: none.
  const full = fakeStore({ tasks: [task('p', 'לתקן גרפיקות')], drive: drive(['p']), checks: Array.from({ length: 20 }, (_, i) => ({ task_id: `z${i}`, created_at: '2026-11-17T06:00:00Z', files: [], status: 'done' })) });
  const ai5 = fakeAi([img('x')], { notes: [] });
  await runGfx({ store: full, now: NOW, ai: ai5 });
  assert.equal(ai5.calls.ask.length, 0);
});

test('stage 3 after "לפתוח מחדש": only images after the reopening', async () => {
  const fix = task('d', 'לתקן גרפיקות', { auto_reopened_at: '2026-11-16T08:00:00Z', auto_reopen_base: 0 });
  const store = fakeStore({ tasks: [fix], drive: [{ client_id: 'c-d', day: '2026-11-16', folder: 'גרפיקות', kind: 'graphic', files: 2 }] });
  const ai = fakeAi([img('before', '2026-11-15'), { ...img('after'), createdTime: '2026-11-16T09:00:00Z' }], { notes: [{ note: 'א', verdict: 'done', why: '' }] });
  await runGfx({ store, now: NOW, ai });
  assert.deepEqual(ai.calls.download, ['after']);
});
