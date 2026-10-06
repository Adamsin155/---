// End-to-end check of the client messages page (messages.html) against an
// in-memory fake of Supabase, with the browser's clock fixed on Tuesday
// 13.10.2026 at 10:00 in Israel, so the day's queue is the same on any day.
// Run: npx http-server -p 8080 -s . &  then  node tests/messages-e2e.mjs [outDir]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { importKeys } from '../app/client-open.js';
import { applicableProcesses } from '../app/protocol-logic.js';
import { DEFAULT_TEMPLATES } from '../app/messages-logic.js';
import { dayKeyIL } from '../app/tz.js';
import { withClientColumns } from './fake-clients.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
const NOW = new Date('2026-10-13T10:00:00+03:00'); // Tuesday
const t0 = Date.now();
const serverNow = () => new Date(NOW.getTime() + (Date.now() - t0)); // the database's clock, on the same day
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const EXP = 4102444800; // 2100: the session never needs refreshing under the fixed clock

// ── People ────────────────────────────────
const people = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', yariv: 'yariv' };
const users = new Map(Object.keys(people).map((k) => [`${k}@astrateg.test`, { id: randomUUID(), email: `${k}@astrateg.test`, aud: 'authenticated', role: 'authenticated' }]));
const staff = Object.entries(people).map(([k, person]) => ({ email: `${k}@astrateg.test`, person, vault: person !== 'yariv' }));
const jwtFor = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp: EXP })}.sig`;
const userOf = (headers) => {
  const token = /^Bearer (.+)$/.exec(headers.authorization || '')?.[1];
  return [...users.values()].find((u) => jwtFor(u) === token) || null;
};
// can_message_clients(): the owner, Irit, Lior and Ofir.
const office = (u) => { const s = u && staff.find((r) => r.email === u.email); return !!s && (s.person === null || ['irit', 'lior', 'ofir'].includes(s.person)); };

// ── Clients ───────────────────────────────
const client = (id, fields) => ({
  id, name: '', business: null, address: null, phone: null, package_name: null, shoot_type: 'dms', characterizer: 'ofir',
  has_logo: true, editor_name: null, editor: null, deal_at: '2026-10-01T09:00:00+03:00', char_at: null, shoot_at: null,
  contract_end: null, status: 'active', notes: null, quote_id: null, created_at: '2026-10-01T09:00:00+03:00',
  created_by_email: 'irit@astrateg.test', links: {}, deliverables: {}, rounds: [], verified_at: null, verified_by: null, closed_reason: null,
  ...fields,
});
const A = client('aaaaaaaa-0000-4000-8000-000000000001', { name: 'פיצה נאפולי', phone: '050-1234567', deal_at: '2026-10-13T09:00:00+03:00' });
const B = client('bbbbbbbb-0000-4000-8000-000000000002', { name: 'מספרת רון', business: 'רון עיצוב שיער', address: 'הרצל 10, תל אביב', char_at: '2026-10-05T10:00:00+03:00', shoot_at: '2026-10-14T11:00:00+03:00' });
const C = client('cccccccc-0000-4000-8000-000000000003', { name: 'קפה גולן', phone: '052-7654321', char_at: '2026-08-20T10:00:00+03:00', shoot_at: '2026-09-01T11:00:00+03:00' });
const D = client('dddddddd-0000-4000-8000-000000000004', { name: 'סטודיו דנה', phone: '053-1111111', deal_at: '2026-10-12T09:00:00+03:00' });
const E = client('eeeeeeee-0000-4000-8000-000000000005', { name: 'גן אירועים', status: 'ended' });
const F = client('ffffffff-0000-4000-8000-000000000006', { name: 'מאפיית שי', phone: '054-1112233', char_at: '2026-09-28T10:00:00+03:00', shoot_at: '2026-10-06T11:00:00+03:00' });

const imported = (c, station) => importKeys(station).map((k) => ({ client_id: c.id, item_key: k, state: 'done', note: 'ייבוא', by_email: 'irit@astrateg.test', at: '2026-10-01T09:00:00+03:00' }));
const check = (c, key, at) => ({ client_id: c.id, item_key: key, state: 'done', note: null, by_email: 'irit@astrateg.test', at });
const db = {
  staff,
  clients: [A, B, C, D, E, F],
  protocol_checks: [
    check(A, 'p02.opened', '2026-10-13T09:10:00+03:00'),
    ...imported(B, 'shoot'),
    ...imported(C, 'ongoing'),
    check(D, 'p02.opened', '2026-10-12T09:10:00+03:00'),
    ...imported(F, 'post'),
  ],
  client_messages: [
    { id: randomUUID(), client_id: D.id, kind: 'milestone', template_key: 'welcome', ref: 'welcome', body: 'היי סטודיו דנה, ברוכים הבאים!', sent_by_email: 'irit@astrateg.test', sent_at: new Date('2026-10-12T10:00:00+03:00').toISOString() },
    { id: randomUUID(), client_id: D.id, kind: 'daily', template_key: 'daily.join', ref: null, body: 'היי סטודיו דנה, בוקר טוב.', sent_by_email: 'lior@astrateg.test', sent_at: new Date('2026-10-13T08:30:00+03:00').toISOString() },
  ],
  // As the migration seeds them.
  message_templates: DEFAULT_TEMPLATES.map(({ key, title, body, kind, station }) => ({ key, title, body, kind, station, updated_by: 'system', updated_at: '2026-09-30T10:00:00Z' })),
  client_tasks: [], office_reviews: [], client_status_notes: [], protocol_log: [], quotes: [],
};
const requests = [];
let failNextSend = false; // the next record fails as if the connection dropped

function applyFilters(rows, params) {
  let out = rows;
  for (const [k, v] of params) {
    if (['select', 'order', 'offset', 'limit', 'on_conflict', 'columns'].includes(k)) continue;
    if (v.startsWith('eq.')) out = out.filter((r) => String(r[k]) === v.slice(3));
    else if (v.startsWith('neq.')) out = out.filter((r) => String(r[k]) !== v.slice(4));
    else if (v === 'is.null') out = out.filter((r) => r[k] === null || r[k] === undefined);
    else if (v.startsWith('gte.')) out = out.filter((r) => String(r[k]) >= v.slice(4));
    else if (v.startsWith('in.(')) { const set = v.slice(4, -1).split(',').map((x) => x.replace(/^"|"$/g, '')); out = out.filter((r) => set.includes(String(r[k]))); }
  }
  const order = params.get('order');
  if (order) {
    const [col, dir] = order.split(',')[0].split('.');
    out = [...out].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (dir === 'desc' ? -1 : 1));
  }
  return out;
}

// public.clients as the database answers it since 20260930210000_hardening.sql (tests/fake-clients.mjs).
const CLIENT_SHAPE = { clients: () => db.clients, staff: () => db.staff };
async function fakeSupabase(route) {
  const req = route.request();
  const url = new URL(req.url());
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  const headers = req.headers();
  const json = (status, data) => route.fulfill({
    status, contentType: 'application/json', body: JSON.stringify(data),
    headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' },
  });
  if (req.method() === 'OPTIONS') return json(200, {});
  const p = url.pathname;
  const me = userOf(headers);
  if (p === '/auth/v1/token') {
    const u = users.get(String(body.email || '').toLowerCase());
    if (!u || body.password !== 'correct-horse') return json(400, { error: 'invalid_grant', msg: 'Invalid login credentials', code: 'invalid_credentials' });
    return json(200, { access_token: jwtFor(u), token_type: 'bearer', expires_in: 3600, expires_at: EXP, refresh_token: `r-${u.id}`, user: u });
  }
  if (p === '/auth/v1/user') return me ? json(200, me) : json(401, { msg: 'invalid JWT' });
  if (p === '/auth/v1/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  if (p === '/rest/v1/rpc/is_staff') return json(200, !!me && staff.some((r) => r.email === me.email));
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m || !db[m[1]]) return json(404, { message: 'not found' });
  if (!me) return json(401, { message: 'permission denied' });
  const table = m[1];
  requests.push({ by: me.email, method: req.method(), table });
  const guarded = table === 'client_messages' || table === 'message_templates';
  const single = (headers.accept || '').includes('vnd.pgrst.object');
  const reply = (rows) => (single ? (rows.length ? json(200, rows[0]) : json(406, { message: 'no rows' })) : json(200, rows));
  if (req.method() === 'GET') {
    let rows = guarded && !office(me) ? [] : applyFilters(db[table], url.searchParams);
    const off = Number(url.searchParams.get('offset') || 0);
    const lim = Number(url.searchParams.get('limit') || 1e9);
    rows = rows.slice(off, off + lim);
    return reply(rows);
  }
  if (req.method() === 'POST' && table === 'client_messages') {
    if (!office(me)) return json(403, { code: '42501', message: 'new row violates row-level security policy for table "client_messages"' });
    if (failNextSend) { failNextSend = false; return json(503, { message: 'Failed to fetch' }); }
    const at = serverNow();
    // client_messages_one_per_day: one per client per Israel day.
    if (db.client_messages.some((x) => x.client_id === body.client_id && dayKeyIL(x.sent_at) === dayKeyIL(at))) {
      return json(409, { code: '23505', message: 'duplicate key value violates unique constraint "client_messages_one_per_day"' });
    }
    const row = { id: randomUUID(), client_id: body.client_id, kind: body.kind, template_key: body.template_key, ref: body.ref ?? null, body: body.body, sent_by_email: me.email, sent_at: at.toISOString() };
    db.client_messages.push(row);
    return reply([row]);
  }
  if (req.method() === 'POST' && table === 'protocol_checks') {
    // An upsert on (client_id, item_key); the database stamps who and when.
    const rows = (Array.isArray(body) ? body : [body]).map((b) => {
      const row = { client_id: b.client_id, item_key: b.item_key, state: b.state, note: b.note ?? null, by_email: me.email, at: serverNow().toISOString() };
      const i = db.protocol_checks.findIndex((x) => x.client_id === b.client_id && x.item_key === b.item_key);
      if (i >= 0) db.protocol_checks[i] = row; else db.protocol_checks.push(row);
      return row;
    });
    return reply(rows);
  }
  if (req.method() === 'DELETE' && table === 'client_messages') {
    // "sender undoes a fresh record": the office, their own record, within 5 minutes.
    const gone = applyFilters(db.client_messages, url.searchParams)
      .filter((r) => office(me) && r.sent_by_email === me.email && serverNow() - new Date(r.sent_at) < 5 * 60e3);
    db.client_messages = db.client_messages.filter((r) => !gone.includes(r));
    return reply(gone);
  }
  if (req.method() === 'DELETE' && table === 'protocol_checks') {
    const gone = applyFilters(db.protocol_checks, url.searchParams);
    db.protocol_checks = db.protocol_checks.filter((r) => !gone.includes(r));
    return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  }
  if (req.method() === 'POST' && table === 'message_templates') {
    if (!office(me)) return json(403, { code: '42501', message: 'new row violates row-level security policy for table "message_templates"' });
    const i = db.message_templates.findIndex((x) => x.key === body.key);
    const row = { ...(db.message_templates[i] || {}), title: body.title, body: body.body, key: body.key, kind: db.message_templates[i]?.kind ?? body.kind, station: db.message_templates[i]?.station ?? body.station, updated_by: me.email, updated_at: serverNow().toISOString() };
    if (i >= 0) db.message_templates[i] = row; else db.message_templates.push(row);
    return reply([row]);
  }
  return json(405, { message: 'not allowed in this fake' });
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
async function newContext(viewport = { width: 1280, height: 900 }, now = NOW) {
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport });
  await ctx.clock.setFixedTime(now);
  await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', withClientColumns(fakeSupabase, CLIENT_SHAPE));
  await ctx.route('https://wa.me/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>wa</title>' }));
  return ctx;
}
async function newPage(ctx) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
  page.on('dialog', (d) => d.accept());
  return page;
}
async function signIn(page, path, email) {
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', email);
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForSelector('#app:not([hidden])');
}
const shot = async (page, name) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); };
const text = (page, sel) => page.locator(sel).innerText();
const toastHas = (page, s) => page.waitForFunction((x) => document.querySelector('#toast.on')?.textContent.includes(x), s);
const activeId = (page) => page.evaluate(() => document.activeElement?.id || '');
const checkOf = (c, key) => db.protocol_checks.find((x) => x.client_id === c.id && x.item_key === key) || null;
const cardIds = (page) => page.locator('#msg-queue > li').evaluateAll((els) => els.map((e) => e.id.replace(/^msg-/, '')));
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const waText = (href) => decodeURIComponent(href.split('?text=')[1]);
// Clicks a WhatsApp link and returns the address the new tab opened.
async function sendVia(page, ctx, sel) {
  const [tab] = await Promise.all([ctx.waitForEvent('page'), page.click(sel)]);
  await tab.waitForLoadState();
  const url = tab.url();
  await tab.close();
  return url;
}
// Waits (up to 3 s) for something the page does after a response.
async function waitFor(fn) {
  for (let i = 0; i < 60; i += 1) { if (fn()) return; await new Promise((r) => setTimeout(r, 50)); }
  assert.fail('timed out');
}
let passed = 0;
async function step(name, fn) {
  try { await fn(); } catch (err) {
    console.error(`not ok - ${name}\n  page errors: ${JSON.stringify(errors)}\n  last requests: ${JSON.stringify(requests.slice(-4))}`);
    throw err;
  }
  passed += 1;
  console.log(`ok - ${name}`);
}

// ── Irit ──────────────────────────────────
const iritCtx = await newContext();
const irit = await newPage(iritCtx);
// Lior has the page open from before Irit sends (for the one-per-day check).
const liorCtx = await newContext();
const lior = await newPage(liorCtx);

await step('Irit sees today\'s queue: the most important first, closed clients out, those done today last', async () => {
  await signIn(irit, 'messages.html', 'irit@astrateg.test');
  await irit.waitForSelector('#msg-queue > li');
  assert.equal(await irit.locator('#no-access').isHidden(), true);
  assert.deepEqual(await cardIds(irit), [F.id, A.id, B.id, C.id, D.id]);
  assert.equal(await text(irit, '#msg-summary'), 'יום ג׳ 13.10 · 4 הודעות לשליחה · לקוח אחד כבר קיבל הודעה היום');
  assert.match(await text(irit, `#msg-${F.id}`), /הודעה על עיכוב[\s\S]*הבטחנו את סגירת הסרטונים עד יום ג׳ 13\.10/);
  assert.match(await text(irit, `#msg-${A.id}`), /אבן דרך[\s\S]*הקבוצה נפתחה היום/);
  assert.match(await irit.inputValue(`#msg-text-${A.id}`), /^היי פיצה נאפולי, ברוכים הבאים לאסטרטג![\s\S]*ליאור: מנהל הלקוח/);
  assert.match(await text(irit, `#msg-${B.id}`), /יום הצילום מחר, יום ד׳ 14\.10 ב־11:00/);
  assert.match(await irit.inputValue(`#msg-text-${B.id}`), /איפה: הרצל 10, תל אביב/);
  assert.match(await text(irit, `#msg-${C.id}`), /הודעה יומית · תחנה: שוטף/);
  assert.match(await text(irit, `#msg-${D.id}`), /כבר נשלח היום[\s\S]*08:30 · ליאור/);
  assert.equal(await irit.locator(`#msg-send-${D.id}`).count(), 0, 'no sending twice in a day');
  assert.equal(await irit.locator(`#msg-undo-${D.id}`).count(), 0, 'only the sender may undo, and only a fresh record');
  assert.equal(await text(irit, `#msg-note-${A.id}`), 'השליחה פותחת צ׳אט עם הטלפון שבכרטיס. להודעה בקבוצת הלקוח: ״שליחה לקבוצה״.');
  assert.equal(await irit.locator(`#msg-${E.id}`).count(), 0, 'an ended client is not in the queue');
  // The other options of the day stay one choice away.
  assert.deepEqual(await irit.locator(`#msg-opt-${A.id} option`).allInnerTexts(), ['אבן דרך: ברוכים הבאים', 'הודעה יומית: הצטרפות']);
  // The history of a client.
  await irit.click(`#msg-hist-${D.id} summary`);
  assert.match(await text(irit, `#msg-hist-${D.id}`), /מה נשלח עד היום \(2\)[\s\S]*ליאור · הודעה יומית: הצטרפות[\s\S]*בוקר טוב[\s\S]*עירית · ברוכים הבאים/);
  await shot(irit, 'messages-01-queue');

  await signIn(lior, 'messages.html', 'lior@astrateg.test');
  await lior.waitForSelector(`#msg-send-${A.id}`);
});

await step('a message with a place left to fill does not go out; filled in, it opens WhatsApp, is recorded and the next client is focused', async () => {
  const before = db.client_messages.length;
  const pages = iritCtx.pages().length;
  await irit.click(`#msg-send-${F.id}`);
  await irit.waitForSelector(`#msg-err-${F.id}:not([hidden])`);
  assert.match(await text(irit, `#msg-err-${F.id}`), /יש בהודעה מקומות שעוד לא מולאו: \[מועד חדש\]/);
  assert.equal(await activeId(irit), `msg-text-${F.id}`);
  assert.equal(await irit.evaluate((id) => { const t = document.getElementById(id); return t.value.slice(t.selectionStart, t.selectionEnd); }, `msg-text-${F.id}`), '[מועד חדש]');
  assert.equal(await irit.getAttribute(`#msg-text-${F.id}`, 'aria-invalid'), 'true');
  await irit.waitForTimeout(200);
  assert.equal(iritCtx.pages().length, pages, 'no WhatsApp tab');
  assert.equal(db.client_messages.length, before, 'nothing recorded');

  await irit.keyboard.type('יום ד׳ 14.10');
  assert.equal(await irit.locator(`#msg-err-${F.id}`).isHidden(), true, 'the error clears once it is filled');
  const typed = await irit.inputValue(`#msg-text-${F.id}`);
  assert.match(typed, /זה יהיה מוכן עד יום ד׳ 14\.10\./);
  const url = await sendVia(irit, iritCtx, `#msg-send-${F.id}`);
  assert.ok(url.startsWith('https://wa.me/972541112233?text='), url.slice(0, 40));
  assert.equal(waText(url), typed.trim());
  await irit.waitForSelector(`#msg-${F.id}.is-sent`);
  const row = db.client_messages.at(-1);
  assert.deepEqual([row.client_id, row.kind, row.template_key, row.ref, row.body, row.sent_by_email], [F.id, 'delay', 'delay', 'p27', typed.trim(), 'irit@astrateg.test']);
  await toastHas(irit, 'נרשם: נשלחה הודעה למאפיית שי');
  // The next client's card is focused, not its text (no keyboard over it on a phone).
  assert.equal(await activeId(irit), `msg-${A.id}`, 'the next client is focused');
  assert.equal(await irit.locator(`#msg-${A.id}`).getAttribute('aria-labelledby'), `msg-h-${A.id}`);
  assert.equal(checkOf(F, 'p27.notes'), null, 'a delay notice checks nothing in the protocol');
});

await step('Irit edits the welcome and sends it: the link carries the edited text to the client\'s number', async () => {
  const extra = '\nנשמח לראות אתכם בפגישה!';
  await irit.keyboard.press('Tab'); // from the card into it: the client's name, then the choice of message, then the text
  await irit.keyboard.press('Tab');
  await irit.keyboard.press('Tab');
  assert.equal(await activeId(irit), `msg-text-${A.id}`);
  await irit.keyboard.press('Control+End');
  await irit.keyboard.type(extra);
  const edited = await irit.inputValue(`#msg-text-${A.id}`);
  assert.ok(edited.endsWith('נשמח לראות אתכם בפגישה!'));
  const href = await irit.getAttribute(`#msg-send-${A.id}`, 'href');
  assert.ok(href.startsWith('https://wa.me/972501234567?text='), href.slice(0, 40));
  assert.equal(waText(href), edited.trim());
  assert.equal(waText(await irit.getAttribute(`#msg-group-${A.id}`, 'href')), edited.trim());
  assert.ok((await irit.getAttribute(`#msg-group-${A.id}`, 'href')).startsWith('https://wa.me/?text='));
  const url = await sendVia(irit, iritCtx, `#msg-send-${A.id}`);
  assert.equal(url, href);
  await irit.waitForSelector(`#msg-${A.id}.is-sent`);
  const row = db.client_messages.at(-1);
  assert.deepEqual([row.client_id, row.kind, row.template_key, row.ref, row.body], [A.id, 'milestone', 'welcome', 'welcome', edited.trim()]);
  assert.equal(await activeId(irit), `msg-${B.id}`);
  assert.match(await text(irit, `#msg-${A.id}`), /כבר נשלח היום[\s\S]*עירית · ברוכים הבאים/);
  // The welcome is process 2's intro message: it is checked in the protocol.
  await waitFor(() => checkOf(A, 'p02.intro'));
  assert.deepEqual([checkOf(A, 'p02.intro').state, checkOf(A, 'p02.intro').note, checkOf(A, 'p02.intro').by_email], ['done', 'נשלחה ממרכז ההודעות', 'irit@astrateg.test']);
});

await step('a record made by mistake is undone by its sender: back in the queue with the text as sent, and the intro unchecked', async () => {
  const before = db.client_messages.length;
  const sentBody = db.client_messages.at(-1).body;
  assert.match(await text(irit, `#msg-${A.id}`), /לא נשלח בפועל בוואטסאפ\?/);
  await shot(irit, 'messages-01b-undo');
  await irit.click(`#msg-undo-${A.id}`);
  await irit.waitForSelector(`#msg-send-${A.id}`);
  await toastHas(irit, 'הרישום בוטל: ההודעה לפיצה נאפולי חזרה לתור');
  assert.equal(db.client_messages.length, before - 1);
  assert.ok(!db.client_messages.some((m) => m.client_id === A.id && dayKeyIL(m.sent_at) === dayKeyIL(serverNow())));
  await waitFor(() => !checkOf(A, 'p02.intro'));
  assert.equal(await irit.inputValue(`#msg-text-${A.id}`), sentBody);
  assert.equal(await activeId(irit), `msg-${A.id}`);
  // Sent again for real.
  const url = await sendVia(irit, iritCtx, `#msg-send-${A.id}`);
  assert.equal(waText(url), sentBody);
  await irit.waitForSelector(`#msg-${A.id}.is-sent`);
  assert.equal(db.client_messages.length, before);
  await waitFor(() => checkOf(A, 'p02.intro'));
  assert.equal(await activeId(irit), `msg-${B.id}`);
});

await step('a client without a phone: WhatsApp opens with no number; if the record fails, "סימון כנשלח" records it', async () => {
  assert.equal(await irit.locator(`#msg-group-${B.id}`).count(), 0);
  assert.match(await text(irit, `#msg-note-${B.id}`), /אין טלפון בכרטיס/);
  const before = db.client_messages.length;
  failNextSend = true;
  const url = await sendVia(irit, iritCtx, `#msg-send-${B.id}`);
  assert.ok(url.startsWith('https://wa.me/?text='), url.slice(0, 30));
  assert.match(waText(url), /^היי מספרת רון, מתכוננים ליום הצילום!/);
  await irit.waitForSelector(`#msg-mark-${B.id}`);
  assert.match(await text(irit, `#msg-err-${B.id}`), /וואטסאפ נפתח, אבל השליחה לא נרשמה[\s\S]*״סימון כנשלח״/);
  assert.equal(await activeId(irit), `msg-mark-${B.id}`);
  assert.equal(db.client_messages.length, before);
  await irit.click(`#msg-mark-${B.id}`);
  await irit.waitForSelector(`#msg-${B.id}.is-sent`);
  assert.equal(db.client_messages.at(-1).body, waText(url));
  assert.deepEqual([db.client_messages.at(-1).template_key, db.client_messages.at(-1).ref], ['eve', 'eve']);
  assert.equal(await activeId(irit), `msg-${C.id}`);
  // The day-before message is process 15's reminder to the client.
  await waitFor(() => checkOf(B, 'p15.client'));
  assert.equal(checkOf(B, 'p15.client').note, 'נשלחה ממרכז ההודעות');
});

await step('filter by station', async () => {
  await irit.click('#msg-st-ongoing');
  assert.deepEqual(await cardIds(irit), [C.id]);
  assert.equal(await irit.getAttribute('#msg-st-ongoing', 'aria-pressed'), 'true');
  await irit.click('#msg-st-all');
  assert.equal((await cardIds(irit)).length, 5);
});

await step('the templates editor: an unknown placeholder is refused; a saved template is stamped and used at once', async () => {
  await irit.click('#btn-templates');
  await irit.waitForSelector('#dlg-templates[open]');
  await irit.selectOption('#tpl-key', 'daily.ongoing');
  assert.match(await irit.inputValue('#tpl-text'), /ממשיכים לעלות לפי הגאנט/);
  assert.match(await text(irit, '#tpl-meta'), /הנוסח המקורי/);
  await irit.fill('#tpl-text', 'היי {לקוח}, השבוע עולים {שעה} תכנים חדשים.');
  await irit.click('#tpl-save');
  assert.match(await text(irit, '#tpl-err'), /המערכת לא ממלאת בנוסח הזה את \{שעה\}/);
  assert.equal(db.message_templates.find((t) => t.key === 'daily.ongoing').updated_by, 'system');
  await irit.fill('#tpl-text', 'היי {לקוח}, השבוע עולים אצלכם תכנים חדשים לפי הגאנט.');
  await irit.click('#tpl-save');
  await toastHas(irit, 'הנוסח נשמר');
  const row = db.message_templates.find((t) => t.key === 'daily.ongoing');
  assert.deepEqual([row.body, row.updated_by], ['היי {לקוח}, השבוע עולים אצלכם תכנים חדשים לפי הגאנט.', 'irit@astrateg.test']);
  assert.match(await text(irit, '#tpl-meta'), /עודכן לאחרונה היום|עודכן לאחרונה .*עירית/);
  await irit.click('#dlg-templates [data-close]');
  assert.equal(await irit.locator('#dlg-templates[open]').count(), 0);
  assert.equal(await irit.inputValue(`#msg-text-${C.id}`), 'היי קפה גולן, השבוע עולים אצלכם תכנים חדשים לפי הגאנט.');
});

await step('the last message goes to the group; the queue says everything went out', async () => {
  const url = await sendVia(irit, iritCtx, `#msg-group-${C.id}`);
  assert.equal(url, `https://wa.me/?text=${encodeURIComponent('היי קפה גולן, השבוע עולים אצלכם תכנים חדשים לפי הגאנט.')}`);
  await irit.waitForSelector(`#msg-${C.id}.is-sent`);
  assert.deepEqual([db.client_messages.at(-1).kind, db.client_messages.at(-1).template_key], ['daily', 'daily.ongoing']);
  assert.equal(await text(irit, '#msg-empty'), 'כל ההודעות של היום נשלחו. יפה!');
  assert.equal(await activeId(irit), 'msg-empty');
  assert.equal(await text(irit, '#msg-summary'), 'יום ג׳ 13.10 · אין עוד הודעות לשליחה · 5 לקוחות כבר קיבלו הודעה היום');
  await shot(irit, 'messages-02-all-sent');
});

await step('one message per client per day: Lior\'s older screen is told, and shows what went out', async () => {
  const before = db.client_messages.length;
  await sendVia(lior, liorCtx, `#msg-send-${A.id}`);
  await toastHas(lior, 'לפיצה נאפולי כבר נרשמה היום הודעה');
  await lior.waitForSelector(`#msg-${A.id}.is-sent`);
  assert.match(await text(lior, `#msg-${A.id}`), /כבר נשלח היום[\s\S]*עירית/);
  assert.equal(db.client_messages.length, before);
});

// ── Other people ──────────────────────────
await step('an editor gets "no access", asks nothing of the messages tables, and has no link on clients.html', async () => {
  const ctx = await newContext();
  const page = await newPage(ctx);
  const before = requests.length;
  await signIn(page, 'messages.html', 'yariv@astrateg.test');
  await page.waitForSelector('#no-access:not([hidden])');
  assert.match(await text(page, '#no-access'), /אין לך גישה לעמוד הזה/);
  assert.equal(await page.locator('#msg-page').isHidden(), true);
  assert.ok(!requests.slice(before).some((r) => r.table === 'client_messages' || r.table === 'message_templates'));
  await page.goto(`${BASE}clients.html#mine`); // an editor's first screen is editor.html
  await page.waitForSelector('#app:not([hidden])');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#nav-messages').isHidden(), true);
  assert.equal(await page.locator('#cta-messages').isHidden(), true);
  await page.waitForSelector('#side-list .side-link');
  assert.equal(await page.locator('#side-messages').count(), 0);
  await ctx.close();
});

await step('Ofir sees "no access" on the page; the owner works in it; Irit has the link on clients.html', async () => {
  const ctx = await newContext();
  const ofir = await newPage(ctx);
  await signIn(ofir, 'messages.html', 'ofir@astrateg.test');
  await ofir.waitForSelector('#no-access:not([hidden])');
  await ctx.close();
  const octx = await newContext();
  const owner = await newPage(octx);
  await signIn(owner, 'messages.html', 'owner@astrateg.test');
  await owner.waitForSelector('#msg-queue > li');
  await owner.waitForSelector('#side-team');
  await octx.close();
  await irit.goto(`${BASE}clients.html`);
  await irit.waitForSelector('#app:not([hidden])');
  await irit.waitForFunction(() => !document.getElementById('nav-messages').hidden);
  assert.equal(await irit.getAttribute('#nav-messages', 'href'), 'messages.html');
  assert.equal(await irit.getAttribute('#cta-messages', 'href'), 'messages.html');
  // The way in is the app menu; the head's own link is not shown twice.
  await irit.waitForSelector('#side-messages');
  assert.equal(await irit.getAttribute('#side-messages', 'href'), 'messages.html');
  assert.equal(await irit.locator('#cta-messages').isVisible(), false);
});

await step('on a 360px phone (the next day, a new queue): it fits, no sideways scrolling, 44px buttons', async () => {
  const ctx = await newContext({ width: 360, height: 740 }, new Date('2026-10-14T10:00:00+03:00'));
  const page = await newPage(ctx);
  await signIn(page, 'messages.html', 'lior@astrateg.test');
  await page.waitForSelector('#msg-queue > li');
  assert.equal(await page.locator('#msg-queue > li.is-sent').count(), 0, 'yesterday\'s messages do not count today');
  assert.equal(await page.locator('#msg-queue .msg-send').count(), 5);
  assert.equal(await text(page, '#msg-summary'), 'יום ד׳ 14.10 · 5 הודעות לשליחה · עוד לא נשלחו הודעות היום');
  // The promised date passed yesterday: editing's message without a date, nothing to fill.
  assert.equal(await page.inputValue(`#msg-text-${F.id}`), 'היי מאפיית שי, הסרטונים שלכם בעריכה ואנחנו על זה. נעדכן אתכם ברגע שהם מוכנים.');
  assert.ok(await noHScroll(page), 'no sideways scroll');
  const heights = await page.locator('.msg-acts .btn, .msg-acts .btn-text, .msg-filters .chip, .msg-pick .input').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  assert.ok(heights.length > 10 && heights.every((x) => x >= 44), JSON.stringify(heights));
  await page.click(`#msg-hist-${D.id} summary`);
  await page.click('#btn-templates');
  await page.waitForSelector('#dlg-templates[open]');
  assert.ok(await noHScroll(page));
  await shot(page, 'messages-03-phone-templates');
  await page.click('#dlg-templates [data-close]');
  await shot(page, 'messages-04-phone');
  await page.goto(`${BASE}clients.html`);
  await page.waitForSelector('#app:not([hidden])');
  await page.waitForFunction(() => !document.getElementById('nav-messages').hidden);
  // On a phone the bottom bar holds three screens, and "עוד" opens the rest.
  assert.equal(await page.locator('#nav-messages').isVisible(), false);
  assert.equal(await page.locator('#side-messages').isVisible(), false);
  await page.click('#side-more');
  assert.equal(await page.locator('#side-messages').isVisible(), true);
  assert.ok((await page.locator('#side-messages').boundingBox()).height >= 44);
  assert.ok(await noHScroll(page), 'clients.html with the link, no sideways scroll');
  await shot(page, 'messages-05-phone-clients');
  await page.click('#side-messages');
  await page.waitForSelector('#msg-queue > li');
  await ctx.close();
});

await step('on a day the office is closed there is no queue', async () => {
  const ctx = await newContext(undefined, new Date('2026-10-16T10:00:00+03:00')); // Friday
  const page = await newPage(ctx);
  await signIn(page, 'messages.html', 'irit@astrateg.test');
  await page.waitForSelector('#msg-empty:not([hidden])');
  assert.match(await text(page, '#msg-empty'), /היום המשרד סגור/);
  assert.equal(await page.locator('#msg-queue > li').count(), 0);
  await ctx.close();
});

await step('a promise at risk but not due until tomorrow: the card says so, and the notice is one choice away', async () => {
  // Met on Sunday 11.10: the shoot day and the scripts are promised by Wednesday 14.10; the content call is done.
  // A client that started before protocol version 6: setting the shoot day is still a promise
  // to the client (since v6 it is Irit's own target, right after the group). 11 is open.
  const G = client('99999999-0000-4000-8000-000000000007', { name: 'מוסך אבי', phone: '050-7778888', deal_at: '2026-10-11T08:00:00+03:00', char_at: '2026-10-11T10:00:00+03:00', protocol_version: 5 });
  const call = applicableProcesses(G).find((p) => p.id === 'p12a').items.filter((i) => !i.optional).map((i) => check(G, i.key, '2026-10-12T12:00:00+03:00'));
  db.clients.push(G);
  db.protocol_checks.push(...imported(G, 'content').filter((r) => !/^p11b?\./.test(r.item_key)), ...call);
  // The station-change message already went out (it is a milestone of its own).
  db.client_messages.push({ id: 'st-g', client_id: G.id, kind: 'milestone', template_key: 'station_change', ref: 'station.content', body: 'x', sent_by_email: 'irit@astrateg.test', sent_at: '2026-10-12T13:00:00+03:00' });
  const ctx = await newContext();
  const page = await newPage(ctx);
  await signIn(page, 'messages.html', 'irit@astrateg.test');
  await page.waitForSelector(`#msg-${G.id}`);
  assert.match(await text(page, `#msg-${G.id} .msg-why`), /הודעה יומית · תחנה: תוכן ואישור/);
  assert.equal(await text(page, `#msg-${G.id} .msg-risk`), 'הבטחנו את קביעת יום הצילום עד יום ד׳ 14.10, וזה עוד לא הושלם. אם זה יתעכב, בוחרים ״הודעה על עיכוב״ ב״איזו הודעה״.');
  assert.deepEqual(await page.locator(`#msg-opt-${G.id} option`).allInnerTexts(),
    ['הודעה יומית: תוכן ואישור', 'הודעה על עיכוב: קביעת יום הצילום', 'הודעה על עיכוב: התסריטים ליום הצילום']);
  await page.selectOption(`#msg-opt-${G.id}`, { label: 'הודעה על עיכוב: קביעת יום הצילום' });
  assert.match(await page.inputValue(`#msg-text-${G.id}`), /^היי מוסך אבי, רצינו לעדכן מראש לגבי קביעת יום הצילום/);
  assert.match(await text(page, `#msg-${G.id} .msg-risk`), /^הבטחנו את התסריטים ליום הצילום עד יום ד׳ 14\.10/);
  await ctx.close();
});

await browser.close();
assert.deepEqual(errors, []);
console.log(`messages-e2e: ${passed} passed`);
