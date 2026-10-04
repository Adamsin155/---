// The scripts page's rules (app/scripts-logic.js): slots from the package, links,
// progress, the protocol offer for process 12, the phone draft and the autosave
// queue (with a fake clock: one write at a time, retries, conflicts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  videosOf, slotCount, slotsOf, progressOf, progressText, normalizeLink, parseLinks, linkName, p12Offer,
  draftKey, draftText, readDraft, draftWins, sameContent, createSaver, saveStateText, shareUrl, shareMessage, STATUS,
} from '../app/scripts-logic.js';
import { SPECS } from '../app/catalog.js';

test('slots: the package\'s video count, never fewer than the scripts already written', () => {
  assert.equal(videosOf({ deliverables: { videos: 25 } }), 25);
  assert.equal(videosOf({ videos: 42 }), 42);
  assert.equal(videosOf({ deliverables: {} }), null);
  assert.equal(videosOf({ videos: 'x' }), null);
  assert.equal(slotCount(20, []), 20);
  assert.equal(slotCount(20, [{ n: 3 }, { n: 22 }]), 22);
  assert.equal(slotCount(null, []), 0);
  assert.equal(slotCount(null, [], 1), 1);
  assert.equal(slotCount(500, []), 200);
  const slots = slotsOf([{ n: 2, title: 'פתיחה', body: 'x', links: null, status: 'ready', version: 3 }], 3);
  assert.deepEqual(slots.map((s) => [s.n, s.status, s.version]), [[1, 'draft', null], [2, 'ready', 3], [3, 'draft', null]]);
  assert.deepEqual(slots[1].links, []);
});

test('every package in the catalog opens its number of scripts (20–48)', () => {
  for (const [key, q] of Object.entries(SPECS)) {
    const n = slotCount(videosOf({ deliverables: { videos: q.videos } }), []);
    assert.ok(n >= 20 && n <= 48, `${key}: ${n}`);
  }
});

test('progress: ready and approved count as done; all ready offers the protocol marks', () => {
  const slots = slotsOf([{ n: 1, status: 'ready', body: 'a' }, { n: 2, status: 'approved', title: 'b' }, { n: 3, status: 'draft' }], 3);
  const p = progressOf(slots);
  assert.deepEqual([p.done, p.approved, p.written, p.allReady], [2, 1, 2, false]);
  assert.equal(progressText(p), 'מוכנים 2 מתוך 3 · אושרו 1');
  assert.equal(p12Offer({ slots }), null);
  const all = slotsOf([1, 2, 3].map((n) => ({ n, status: 'ready', body: 'x' })), 3);
  const offer = p12Offer({ slots: all, checks: {} });
  assert.deepEqual(offer.keys, ['p12.scripts', 'p12.numbered']);
  assert.deepEqual(offer.blockedBy, ['p12a.call'], 'the focus call (12א) comes first');
  const ok = p12Offer({ slots: all, checks: { 'p12a.call': { state: 'done' }, 'p12.numbered': { state: 'done' } } });
  assert.deepEqual([ok.keys, ok.blockedBy], [['p12.scripts'], []]);
  assert.equal(p12Offer({ slots: all, checks: { 'p12.scripts': { state: 'done' }, 'p12.numbered': { state: 'done' } } }), null);
  // A shoot round: its own keys.
  assert.deepEqual(p12Offer({ slots: all, round: 2 }).keys, ['r2.p12.scripts', 'r2.p12.numbered']);
  assert.deepEqual(Object.values(STATUS), ['טיוטה', 'מוכן', 'אושר']);
});

test('inspiration links: https addresses, typed short or pasted several at once', () => {
  assert.equal(normalizeLink('instagram.com/reel/abc'), 'https://instagram.com/reel/abc');
  assert.equal(normalizeLink(' https://www.tiktok.com/@x/video/1 '), 'https://www.tiktok.com/@x/video/1');
  assert.equal(normalizeLink('http://youtu.be/x'), 'http://youtu.be/x');
  for (const bad of ['javascript:alert(1)', 'ftp://x.com/a', 'https://user:pw@x.com', 'שלום', 'https://localhost', '', 'data:text/html,x']) {
    assert.equal(normalizeLink(bad), null, bad);
  }
  const r = parseLinks('https://a.com/1, b.com/2\nhttps://a.com/1 nonsense', ['https://b.com/2']);
  assert.deepEqual(r, { links: ['https://a.com/1'], bad: ['nonsense'] });
  assert.equal(linkName('https://www.instagram.com/reel/abc/'), 'instagram.com/reel/abc');
});

test('the phone draft wins only when it holds unsaved typing', () => {
  const row = { title: 'א', body: 'ב', links: [], status: 'draft', at: '2026-10-13T08:00:00Z' };
  assert.equal(draftKey('c1', 1, 4), 'scripts.c1.1.4');
  const later = readDraft(draftText({ ...row, body: 'ב ועוד' }, new Date('2026-10-13T08:05:00Z')));
  assert.equal(draftWins(later, row), true);
  assert.equal(draftWins(readDraft(draftText(row, new Date('2026-10-13T09:00:00Z'))), row), false, 'the same text');
  const older = readDraft(draftText({ ...row, body: 'ישן' }, new Date('2026-10-13T07:00:00Z')));
  assert.equal(draftWins(older, row), false, 'saved after the draft');
  assert.equal(draftWins(later, null), true);
  assert.equal(readDraft('not json'), null);
  assert.equal(readDraft('{"title":"x"}'), null);
  assert.equal(sameContent({ title: 'a', body: '', links: ['https://x.com'] }, { title: 'a', body: '', links: ['https://x.com'], status: 'draft' }), true);
});

// A clock the test moves by hand.
function fakeTimers() {
  let now = 0;
  let id = 0;
  const due = new Map();
  return {
    setTimeout(fn, ms) { id += 1; due.set(id, { at: now + ms, fn }); return id; },
    clearTimeout(t) { due.delete(t); },
    async advance(ms) {
      now += ms;
      for (;;) {
        const next = [...due.entries()].filter(([, v]) => v.at <= now).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        due.delete(next[0]);
        await next[1].fn();
        await new Promise((r) => setImmediate(r));
      }
    },
    get pending() { return due.size; },
  };
}
const tick = () => new Promise((r) => setImmediate(r));

test('autosave: one write after the typing stops, typing during a write is written right after', async () => {
  const timers = fakeTimers();
  const states = [];
  const writes = [];
  let release;
  let text = 'a';
  const saver = createSaver({
    timers, delay: 1000, onState: (s) => states.push(s),
    write: () => { writes.push(text); return new Promise((r) => { release = r; }); },
  });
  saver.touch(); text = 'ab'; saver.touch();
  await timers.advance(999);
  assert.equal(writes.length, 0);
  await timers.advance(1);
  assert.deepEqual(writes, ['ab']);
  text = 'abc'; saver.touch();
  await timers.advance(1000); // still writing: waits for it
  assert.deepEqual(writes, ['ab']);
  release(); await tick(); await tick();
  assert.deepEqual(writes, ['ab', 'abc']);
  release(); await tick(); await tick();
  assert.equal(states.at(-1), 'saved');
  assert.equal(saver.dirty, false);
});

test('autosave: a failed write is retried with growing waits, and at once on flush (back online)', async () => {
  const timers = fakeTimers();
  const states = [];
  let fail = 3;
  let writes = 0;
  const saver = createSaver({ timers, delay: 500, onState: (s) => states.push(s), write: async () => { writes += 1; if (fail-- > 0) throw new Error('Failed to fetch'); } });
  saver.touch();
  await timers.advance(500);
  assert.equal(writes, 1);
  assert.equal(states.at(-1), 'offline');
  await timers.advance(2999);
  assert.equal(writes, 1);
  await timers.advance(1);
  assert.equal(writes, 2, 'after 3 seconds');
  await timers.advance(10000);
  assert.equal(writes, 3, 'after 10 more');
  assert.equal(saver.dirty, true);
  await saver.flush(); // the 'online' event
  assert.equal(writes, 4);
  assert.equal(states.at(-1), 'saved');
  assert.equal(timers.pending, 0);
});

test('autosave: a conflict or a refusal stops the queue until the page decides', async () => {
  const timers = fakeTimers();
  const states = [];
  let err = Object.assign(new Error('newer'), { conflict: true });
  const saver = createSaver({ timers, delay: 10, onState: (s) => states.push(s), write: async () => { if (err) throw err; } });
  saver.touch();
  await timers.advance(10);
  assert.equal(states.at(-1), 'conflict');
  await timers.advance(60000);
  assert.equal(states.filter((s) => s === 'saving').length, 1, 'no retry on a conflict');
  err = null;
  await saver.flush();
  assert.equal(states.at(-1), 'saved');
  err = Object.assign(new Error('rls'), { fatal: true });
  saver.touch();
  await timers.advance(10);
  assert.equal(states.at(-1), 'error');
  assert.equal(saveStateText('saved', '11:40'), 'נשמר · 11:40');
  assert.match(saveStateText('offline'), /נשמר בטלפון/);
});

test('the share link and its message', () => {
  const url = shareUrl('https://app.astrateg.tech/scripts.html?id=1', 'A'.repeat(43));
  assert.equal(url, `https://app.astrateg.tech/scripts-view.html?t=${'A'.repeat(43)}`);
  const msg = shareMessage({ name: 'דנה', business: 'קפה דנה' }, url);
  assert.ok(msg.includes('קפה דנה') && msg.includes(url));
});
