// Notifications on this device (app/push-logic.js) and the site's service worker
// (sw.js, run here in a sandbox): iPhone first installs to the home screen (iOS
// 16.4+), then a button asks; the list of today's reminders; a push is always shown
// and a tap opens a page of this site only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { platformOf, pushState, keyBytes, sameKey, inboxRows, unreadCount, deliveryText } from '../app/push-logic.js';
import { VAPID_PUBLIC_KEY } from '../app/push-config.js';
import { dateIL } from '../app/tz.js';

const IPHONE_17 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const IPHONE_16_3 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';

test('iPhone: update below 16.4, install to the home screen first, then a button', () => {
  assert.deepEqual(platformOf({ userAgent: IPHONE_17 }), { ios: true, iosVersion: [17, 4], standalone: false });
  assert.equal(platformOf({ userAgent: IPAD, maxTouchPoints: 5 }).ios, true);
  assert.equal(platformOf({ userAgent: IPAD, maxTouchPoints: 0 }).ios, false); // a Mac
  const iphone = (ua, standalone, extra = {}) => pushState({ ...platformOf({ userAgent: ua, standalone }), hasPush: standalone, ...extra });
  assert.equal(iphone(IPHONE_16_3, false), 'ios-update');
  assert.equal(iphone(IPHONE_17, false), 'ios-install');
  assert.equal(iphone(IPHONE_17, true), 'ready');
  assert.equal(iphone(IPHONE_17, true, { permission: 'granted', subscribed: true }), 'confirm');
  assert.equal(iphone(IPHONE_17, true, { permission: 'granted', subscribed: true, confirmed: true }), 'on');
});

test('other devices: ready, blocked, unsupported', () => {
  const p = platformOf({ userAgent: ANDROID });
  assert.equal(p.ios, false);
  assert.equal(pushState({ ...p, hasPush: true }), 'ready');
  assert.equal(pushState({ ...p, hasPush: true, permission: 'denied' }), 'blocked');
  assert.equal(pushState({ ...p, hasPush: true, permission: 'granted' }), 'ready'); // allowed but not connected yet
  assert.equal(pushState({ ...p, hasPush: false }), 'unsupported');
});

test('the VAPID key as bytes, and whether a subscription was made with it', () => {
  const bytes = keyBytes(VAPID_PUBLIC_KEY);
  assert.equal(bytes.length, 65);
  assert.equal(sameKey(bytes.buffer, VAPID_PUBLIC_KEY), true);
  assert.equal(sameKey(new Uint8Array(65).buffer, VAPID_PUBLIC_KEY), false);
  assert.equal(sameKey(null, VAPID_PUBLIC_KEY), false);
});

test('the list: today (Israel day), newest first, without suppressed steps or queued digest lines', () => {
  const now = dateIL(2026, 10, 5, 12);
  const at = (h, mi = 0) => dateIL(2026, 10, 5, h, mi).toISOString();
  const rows = [
    { id: 1, created_at: at(0, 30), level: 'ring', channel: 'push', status: 'sent', read_at: null },
    { id: 2, created_at: at(11), level: 'quiet', channel: 'app', status: 'sent', read_at: at(11, 5) },
    { id: 3, created_at: at(11, 30), level: 'ring', channel: 'push', status: 'suppressed' },
    { id: 4, created_at: at(10), level: 'digest', channel: 'digest', status: 'queued' },
    { id: 5, created_at: dateIL(2026, 10, 4, 23, 59).toISOString(), level: 'ring', channel: 'push', status: 'sent' },
    { id: 6, created_at: at(8, 30), level: 'digest', channel: 'push', status: 'sent', read_at: null },
  ];
  const list = inboxRows(rows, now);
  assert.deepEqual(list.map((r) => r.id), [2, 6, 1]);
  assert.equal(unreadCount(list), 2);
  assert.equal(deliveryText({ status: 'queued', reason: 'quiet_hours' }), 'יגיע לטלפון בתקציר הבא');
  assert.equal(deliveryText({ status: 'pending', channel: 'push', level: 'ring' }), 'נשלח עכשיו לטלפון');
  assert.equal(deliveryText({ status: 'queued', reason: 'shoot_mode' }), 'יגיע בסיכום אחרי יום הצילום');
  assert.equal(deliveryText({ status: 'sent', channel: 'app', reason: 'no_device' }), 'בתוך המערכת (אין טלפון מחובר)');
  assert.equal(deliveryText({ status: 'failed' }), 'לא נשלח לטלפון: תקלה. מופיע כאן.');
  // 7.10.2026, "אין הודעות שקטות": an update is pushed like a ring, a lateness note in a
  // batch, a digest line in its digest; nothing new says "בלי צליל".
  assert.equal(deliveryText({ status: 'sent', channel: 'push', level: 'quiet' }), 'נשלח לטלפון');
  assert.equal(deliveryText({ status: 'queued', channel: 'digest', level: 'quiet', reason: 'batch' }), 'יישלח לטלפון בתוך חצי שעה, יחד עם שאר האיחורים');
  assert.equal(deliveryText({ status: 'sent', channel: 'digest', level: 'quiet', reason: 'batch' }), 'נשלח לטלפון, בהודעה אחת עם שאר האיחורים');
  assert.equal(deliveryText({ status: 'sent', channel: 'digest', level: 'ring', reason: 'digest' }), 'נשלח לטלפון בתוך תקציר');
  assert.equal(deliveryText({ status: 'sent', channel: 'app', level: 'board' }), 'בלוח הבעלים, ובטלפון בתקציר של 18:00');
  assert.equal(deliveryText({ status: 'queued', channel: 'digest', level: 'board', reason: 'owner_digest' }), 'יגיע לטלפון בתקציר הבא');
  assert.equal(deliveryText({ status: 'sent', channel: 'app', level: 'quiet' }), 'בתוך המערכת'); // a row from before the rule
  // A batch of lateness notes: each note is a row, the batch's own row is not shown or counted.
  const batch = [
    { id: 20, created_at: at(10), rule: 'late', key: 'late:c1:p12@x:ofir@ofir', level: 'quiet', channel: 'digest', status: 'sent', reason: 'batch', read_at: null },
    { id: 21, created_at: at(10, 1), rule: 'late', key: 'late:c2:p12@x:ofir@ofir', level: 'quiet', channel: 'digest', status: 'sent', reason: 'batch', read_at: null },
    { id: 22, created_at: at(10, 1), rule: 'digest', key: 'digest:late:ofir:2026-10-05:21', level: 'digest', channel: 'push', status: 'sent', reason: 'late', read_at: null },
    { id: 23, created_at: at(11), rule: 'late', key: 'late:c3:p12@x:ofir@ofir', level: 'quiet', channel: 'digest', status: 'queued', reason: 'batch', read_at: null },
  ];
  // The same for a burst (many pushes of one minute sent as one).
  batch.push({ id: 24, created_at: at(11, 30), rule: 'digest', key: 'digest:burst:ofir:2026-10-05:30', level: 'digest', channel: 'push', status: 'sent', reason: 'burst', read_at: null });
  assert.deepEqual(inboxRows(batch, now).map((r) => r.id), [23, 21, 20]);
  assert.equal(unreadCount(inboxRows(batch, now)), 3);
});

// The service worker in a sandbox: `self`, the registration and the clients are fakes.
function worker({ windows = [] } = {}) {
  const listeners = {};
  const shown = [];
  const opened = [];
  const focused = [];
  const self = {
    location: new URL('https://app.astrateg.tech/sw.js'),
    registration: { scope: 'https://app.astrateg.tech/', showNotification: async (title, opts) => { shown.push({ title, ...opts }); } },
    clients: {
      matchAll: async () => windows.map((url) => ({ url, focus: async () => { focused.push(url); } })),
      openWindow: async (url) => { opened.push(url); },
    },
    skipWaiting: () => {},
    addEventListener: (type, fn) => { listeners[type] = fn; },
  };
  vm.runInNewContext(readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), { self, URL, String, JSON });
  const fire = async (type, event) => {
    let done = Promise.resolve();
    listeners[type]({ ...event, waitUntil: (p) => { done = p; } });
    await done;
  };
  return { fire, shown, opened, focused, listeners };
}

test('sw.js: a push is always shown, with the page it is about (this site only)', async () => {
  const w = worker();
  assert.deepEqual(Object.keys(w.listeners).sort(), ['install', 'notificationclick', 'push']); // no fetch handler, no cache
  const data = (o) => ({ data: { json: () => o, text: () => JSON.stringify(o) } });
  await w.fire('push', data({ title: 'הלקוח לא ענה: קפה', body: 'להתקשר', url: 'client.html?id=1#p07', tag: 'answer:1' }));
  assert.equal(w.shown[0].title, 'הלקוח לא ענה: קפה');
  assert.equal(w.shown[0].body, 'להתקשר');
  assert.equal(w.shown[0].tag, 'answer:1');
  assert.equal(w.shown[0].dir, 'rtl');
  assert.equal(w.shown[0].data.href, 'https://app.astrateg.tech/client.html?id=1#p07');
  await w.fire('push', data({ title: 'x', url: 'https://evil.example/phish' }));
  assert.equal(w.shown[1].data.href, 'https://app.astrateg.tech/clients.html#mine');
  // Not JSON, or no data at all: still a notification (iOS requires one per push).
  await w.fire('push', { data: { json: () => { throw new Error('bad'); }, text: () => 'שלום' } });
  assert.deepEqual([w.shown[2].title, w.shown[2].body], ['אסטרטג', 'שלום']);
  await w.fire('push', {});
  assert.equal(w.shown[3].title, 'אסטרטג');
});

test('sw.js: a tap focuses the window already on the page, or opens it; never another site', async () => {
  const href = 'https://app.astrateg.tech/client.html?id=1#p07';
  const note = (h) => ({ notification: { data: { href: h }, close: () => {} } });
  const a = worker({ windows: [href] });
  await a.fire('notificationclick', note(href));
  assert.deepEqual([a.focused, a.opened], [[href], []]);
  const b = worker({ windows: ['https://app.astrateg.tech/clients.html'] });
  await b.fire('notificationclick', note(href));
  assert.deepEqual(b.opened, [href]);
  const c = worker();
  await c.fire('notificationclick', note('https://evil.example/'));
  assert.deepEqual(c.opened, []);
});
