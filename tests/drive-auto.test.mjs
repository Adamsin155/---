// What the clients' Drive folders show is done, marked by the system (docs/ops.md, section 141;
// app/drive-auto-logic.js): 24's folder and videos, 7's first nine graphics, 23's graphics, the
// Gantt's empty links; and the Drive scan that writes them (supabase/functions/drive-scan/scan.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientState } from '../app/protocol-logic.js';
import { driveMarks, ganttFills, countDaily, NOTES, RAW_STEP, AUTO_PREFIX } from '../app/drive-auto-logic.js';
import { neededFor } from '../app/drive-guard-logic.js';
import { editorReadyKeys } from '../app/editor-auto.js';
import { fastCases } from '../app/fast-ladder.js';
import { runScan, runBackfill, autoStep } from '../supabase/functions/drive-scan/scan.js';
import { dateIL } from '../app/tz.js';

const IL = (y, m, d, h = 0, mi = 0) => dateIL(y, m, d, h, mi);
const now = IL(2026, 11, 17, 12); // Tuesday
const at = IL(2026, 11, 10, 10);
const done = (when = at, note = null) => ({ state: 'done', at: when.toISOString(), note, by_email: 'nadia@x' });
const base = {
  id: 'c1', name: 'דנה', business: 'קפה דנה', status: 'active', shoot_type: 'dms', characterizer: 'ofir', has_logo: true,
  deal_at: IL(2026, 10, 1, 10).toISOString(), char_at: IL(2026, 10, 3, 10).toISOString(), shoot_at: IL(2026, 11, 3, 10).toISOString(),
  contract_end: '2027-10-01', editor: 'nadia', rounds: [], deliverables: { videos: 12, graphics: 20, shoot_days: 1 },
};
const vids = (n, day = '2026-11-12', folder = 'סרטונים מוכנים') => ({ day, folder, kind: 'video', files: n });
const gfx = (n, day = '2026-10-05', folder = 'גרפיקות') => ({ day, folder, kind: 'graphic', files: n });
const assigned = (pre = '') => ({ [`${pre}p22a.assigned`]: done(IL(2026, 11, 4, 10)) });
const marks = (c, checks, daily, folderOk = true) => driveMarks({ client: c, checks, state: clientState(c, checks, now), daily, folderOk, now });
const keysOf = (ms) => ms.map((m) => m.item_key).sort();

test('the counts: only the kind, from the deal day, a month; highlights are not graphics', () => {
  const rows = [vids(3, '2026-09-30'), vids(4), { day: '2026-11-12', folder: 'גלם', kind: 'raw', files: 50 }, gfx(5), gfx(7, '2026-10-06', 'היילייטס')];
  assert.equal(countDaily(rows, 'video', { from: '2026-10-01' }), 4);
  assert.equal(countDaily(rows, 'video'), 7);
  assert.equal(countDaily(rows, 'video', { month: '2026-09' }), 3);
  assert.equal(countDaily(rows, 'graphic', { from: '2026-10-01' }), 5);
  assert.equal(RAW_STEP, null);
});

test('24: the folder once the shoot is with an editor; the videos once the Drive has the shoot\'s part', () => {
  // Before the assignment: nothing, even with a folder and every video.
  assert.deepEqual(marks(base, {}, [vids(12)]), []);
  // Assigned, the folder opened, 11 of 12: the folder only.
  const m11 = marks(base, assigned(), [vids(11)]);
  assert.deepEqual(keysOf(m11), ['p24.folder']);
  assert.equal(m11[0].note, NOTES.folder);
  assert.ok(m11[0].note.startsWith(AUTO_PREFIX));
  // 12 of 12: both; the note says the count.
  const m12 = marks(base, assigned(), [vids(11), vids(1, '2026-11-13', 'סופי')]);
  assert.deepEqual(keysOf(m12), ['p24.drive', 'p24.folder']);
  assert.equal(m12.find((m) => m.item_key === 'p24.drive').note, 'סומן אוטומטית: 12 סרטונים ערוכים בדרייב (צריך 12)');
  // Footage is not counted; videos from before the deal day are not counted.
  assert.deepEqual(keysOf(marks(base, assigned(), [vids(6), { day: '2026-11-12', folder: 'גלם', kind: 'raw', files: 30 }, vids(6, '2026-09-20')])), ['p24.folder']);
  // The folder did not open in this run: nothing of 24.
  assert.deepEqual(marks(base, assigned(), [vids(12)], false), []);
});

test('24: never over a mark: a person\'s done or "לא רלוונטי" stays, and the other is still written', () => {
  const cs = { ...assigned(), 'p24.drive': { state: 'na', at: at.toISOString(), note: 'x', by_email: 'nadia@x' } };
  assert.deepEqual(keysOf(marks(base, cs, [vids(12)])), ['p24.folder']);
  const both = { ...cs, 'p24.folder': done() };
  assert.deepEqual(marks(base, both, [vids(12)]), []);
});

test('24: the number needed is the check of a person\'s mark (drive-guard-logic neededFor): two editors, rounds, monthly', () => {
  // Two editors with a split: its total.
  const two = { ...base, editor2: 'yariv', editor_split: { nadia: 4, yariv: 3 } };
  assert.equal(neededFor(two, 'p24.drive', now).needed, 7);
  assert.deepEqual(keysOf(marks(two, assigned(), [vids(7)])), ['p24.drive', 'p24.folder']);
  // Two shoot days: round 1 is half; round 2 needs both halves, never above the package.
  const days2 = { ...base, deliverables: { ...base.deliverables, shoot_days: 2 }, rounds: [{ n: 2, shoot_type: 'dms', shoot_at: IL(2026, 11, 10, 10).toISOString(), editor: 'nadia' }] };
  const cs = { ...assigned(), ...assigned('r2.') };
  assert.deepEqual(keysOf(marks(days2, cs, [vids(6)])), ['p24.drive', 'p24.folder', 'r2.p24.folder']);
  assert.deepEqual(keysOf(marks(days2, cs, [vids(12)])), ['p24.drive', 'p24.folder', 'r2.p24.drive', 'r2.p24.folder']);
  // A package with no number of videos: never marked (the system does not guess).
  const none = { ...base, deliverables: { graphics: 20 } };
  assert.deepEqual(keysOf(marks(none, assigned(), [vids(40)])), ['p24.folder']);
});

test('24: a monthly round counts its own month only', () => {
  const monthly = { ...base, deliverables: { videos_month: 8, graphics: 20 }, rounds: [{ n: 2, monthly: true, month: '2026-11', editor: 'nadia' }] };
  const cs = { ...assigned(), ...assigned('r2.') };
  const st = clientState(monthly, cs, now);
  assert.ok(st.states.some((s) => s.proc.id === 'r2-p24'));
  assert.ok(!keysOf(marks(monthly, cs, [vids(8, '2026-10-20')])).includes('r2.p24.drive'));
  assert.ok(keysOf(marks(monthly, cs, [vids(8, '2026-11-10')])).includes('r2.p24.drive'));
});

test('24 then the editor\'s hand-off: once 22 is all marked, editor-auto writes p24.notify as after a person\'s mark', () => {
  const procOf = (cs, id) => clientState(base, cs, now).states.find((s) => s.proc.id === id).proc;
  const cs = { ...assigned() };
  for (const i of procOf(cs, 'p22').items) cs[i.key] = done();
  const written = Object.fromEntries(marks(base, cs, [vids(12)]).map((m) => [m.item_key, { state: m.state, note: m.note, at: now.toISOString(), by_email: '' }]));
  const after = { ...cs, ...written };
  assert.deepEqual(editorReadyKeys(base, after, clientState(base, after, now)), ['p24.notify']);
});

test('7: nine graphics since the deal day (or the package\'s, when fewer), after the characterization, then Ofir\'s check', () => {
  const char = { 'p04.ended': done(IL(2026, 10, 3, 12)) };
  const st = clientState(base, char, now).states.find((s) => s.proc.id === 'p07');
  assert.ok(st.startAt && st.startAt <= now, 'process 7 started');
  assert.deepEqual(marks(base, char, [gfx(8)]), []);
  const m = marks(base, char, [gfx(9)]);
  assert.deepEqual(keysOf(m), ['p07.made']);
  assert.equal(m[0].note, 'סומן אוטומטית: 9 גרפיקות בדרייב (צריך 9)');
  // A package of 6: six are enough.
  const six = { ...base, deliverables: { ...base.deliverables, graphics: 6 } };
  // (the shoot day passed, so 23 started too, and six are the whole package)
  assert.deepEqual(keysOf(marks(six, char, [gfx(6)])), ['p07.made', 'p23.made']);
  // Graphics before the deal day, or in the highlights folder, are not counted.
  assert.deepEqual(marks(base, char, [gfx(5, '2026-09-01'), gfx(4), gfx(9, '2026-10-05', 'היילייטס')]), []);
  // Written: Ofir's fast ladder takes it, as after Ilai's "מוכן לבדיקה".
  const after = { ...char, 'p07.made': { state: 'done', note: m[0].note, at: now.toISOString(), by_email: '' } };
  const cases = fastCases({ clients: [{ ...base, landed_at: IL(2026, 10, 1, 11).toISOString() }], checksOf: () => after, stateOf: (c) => clientState(c, after, now) });
  assert.ok(cases.some((x) => x.procId === 'p07'));
});

test('7: not before the process starts, not over history of it, not on a package with no graphics', () => {
  assert.deepEqual(marks({ ...base, char_at: null }, {}, [gfx(9)]).filter((m) => m.item_key === 'p07.made'), []);
  const char = { 'p04.ended': done(IL(2026, 10, 3, 12)) };
  // Ofir already approved, or Irit sent them, or 7ב: not touched (a client long past it).
  for (const k of ['p07.ofir', 'p07.sent', 'p07b.posted', 'p07.r.logo']) {
    assert.deepEqual(marks(base, { ...char, [k]: done() }, [gfx(9)]).filter((m) => m.item_key === 'p07.made'), [], k);
  }
  assert.deepEqual(marks({ ...base, deliverables: { videos: 12 } }, char, [gfx(30)]).filter((m) => /^p0[7]|^p23/.test(m.item_key)), []);
});

test('23: the package\'s graphics, after the shoot day and after 7\'s own mark', () => {
  const char = { 'p04.ended': done(IL(2026, 10, 3, 12)) };
  // 20 graphics, 7 not marked: both in one plan (7 first).
  assert.deepEqual(keysOf(marks(base, char, [gfx(20)])), ['p07.made', 'p23.made']);
  // 7 is with Ofir (marked by Ilai): 23 alone.
  const with7 = { ...char, 'p07.made': done() };
  assert.deepEqual(keysOf(marks(base, with7, [gfx(19)])), []);
  assert.deepEqual(keysOf(marks(base, with7, [gfx(12), gfx(8, '2026-11-05')])), ['p23.made']);
  // 7 cannot be marked (history of it, nothing on p07.made): 23 waits.
  assert.deepEqual(keysOf(marks(base, { ...char, 'p07.sent': done() }, [gfx(20)])), []);
  // Before the shoot day: 23 has not started.
  const later = { ...base, shoot_at: IL(2026, 11, 25, 10).toISOString() };
  assert.deepEqual(keysOf(marks(later, with7, [gfx(20)])), []);
  // A client not in work: nothing at all.
  assert.deepEqual(marks({ ...base, status: 'archived' }, { ...char, ...assigned() }, [gfx(20), vids(12)]), []);
});

test('the Gantt: the button\'s fills, never over a link, no new rows', () => {
  const rows = [
    { id: 'g1', kind: 'video', key: 'video.1', day: '2026-11-15', time_il: '18:00', num: 1, link: null },
    { id: 'g2', kind: 'video', key: 'video.2', day: '2026-11-16', time_il: '18:00', num: 2, link: 'https://drive.google.com/file/d/old/view' },
  ];
  const files = [
    { name: '15.11 רילס.mp4', mimeType: 'video/mp4', createdTime: '2026-11-14T10:00:00Z', link: 'https://drive.google.com/file/d/a/view', path: 'סרטונים' },
    { name: '16.11 רילס.mp4', mimeType: 'video/mp4', createdTime: '2026-11-14T10:00:00Z', link: 'https://drive.google.com/file/d/b/view', path: 'סרטונים' },
    { name: '30.11 רילס.mp4', mimeType: 'video/mp4', createdTime: '2026-11-14T10:00:00Z', link: 'https://drive.google.com/file/d/c/view', path: 'סרטונים' },
  ];
  assert.deepEqual(ganttFills(base, rows, files, now), [{ id: 'g1', link: 'https://drive.google.com/file/d/a/view', file: '15.11 רילס.mp4', day: '2026-11-15' }]);
  assert.deepEqual(ganttFills(base, [], files, now), []);
});

function store({ client, checks = [], daily = [], gantt = [] }) {
  const s = { saved: [], states: [], added: [], filled: [] };
  return Object.assign(s, {
    targets: async () => [{ id: client.id, links: { drive: 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp' }, scanned_at: null }],
    before: async () => [],
    save: async (r) => s.saved.push(...r),
    state: async (x) => s.states.push(x),
    autoContext: async () => ({ client, checks, daily, gantt }),
    addMarks: async (id, ms) => { s.added.push(...ms); return ms.length; },
    fillLink: async (id, gid, link) => { s.filled.push({ gid, link }); return true; },
  });
}

test('the scan: after the counts, the marks and the fills, from the same listing; a failure there is not the scan\'s', async () => {
  const checks = Object.entries(assigned()).map(([item_key, v]) => ({ item_key, ...v }));
  const gantt = [{ id: 'g1', kind: 'video', key: 'video.1', day: '2026-11-15', time_il: '18:00', num: 1, link: null }];
  const st = store({ client: base, checks, daily: [vids(12)], gantt });
  const files = [{ name: '15.11 רילס.mp4', mimeType: 'video/mp4', createdTime: '2026-11-14T10:00:00Z', link: 'https://drive.google.com/file/d/a/view', path: 'סרטונים' }];
  let lists = 0;
  const stats = await runScan({ store: st, drive: { list: async () => { lists += 1; return { files, truncated: false }; } }, now });
  assert.equal(lists, 1);
  assert.deepEqual(keysOf(st.added), ['p24.drive', 'p24.folder']);
  assert.ok(st.added.every((m) => m.state === 'done' && m.note.startsWith(AUTO_PREFIX) && Object.keys(m).length === 3));
  assert.deepEqual(st.filled, [{ gid: 'g1', link: 'https://drive.google.com/file/d/a/view' }]);
  assert.equal(stats.marked, 2);
  assert.equal(stats.linked, 1);
  assert.equal(stats.clients, 1);
  // A failing read: counted apart, the client still counted as scanned.
  const bad = { ...store({ client: base }), autoContext: async () => { throw Object.assign(new Error('x'), { code: 'PGRST' }); } };
  const s2 = await runScan({ store: bad, drive: { list: async () => ({ files: [], truncated: false }) }, now });
  assert.equal(s2.clients, 1);
  assert.equal(s2.autoFailed, 1);
  assert.equal(bad.states[0].error, null);
  // An older store with no methods for the marks: the scan as before.
  const stats3 = { marked: 0, linked: 0, autoFailed: 0 };
  await autoStep({ store: { }, clientId: 'c1', files: [], now, stats: stats3 });
  assert.deepEqual(stats3, { marked: 0, linked: 0, autoFailed: 0 });
});

test('the back-scan never marks: it writes the counts only; the next daily pass marks from them', async () => {
  const checks = Object.entries(assigned()).map(([item_key, v]) => ({ item_key, ...v }));
  const st = store({ client: { ...base, deal_at: base.deal_at, created_at: base.deal_at }, checks, daily: [vids(12)] });
  const files = [{ name: '15.11 רילס.mp4', mimeType: 'video/mp4', createdTime: '2026-11-14T10:00:00Z', link: 'https://drive.google.com/file/d/a/view', path: 'סרטונים' }];
  const stats = await runBackfill({ store: st, drive: { list: async () => ({ files, truncated: false }) }, now });
  assert.equal(stats.clients, 1);
  assert.ok(st.saved.length > 0);
  assert.deepEqual(st.added, []);
  assert.deepEqual(st.filled, []);
});
