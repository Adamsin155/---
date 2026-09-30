// End-to-end check of stage 6: the personal calendar card in "מה עליי"
// (app/calendar-card.js) with its feed, and the owner's insights page
// (insights.html, app/insights-page.js), against an in-memory fake of Supabase.
// The browser's clock is fixed on Tuesday 20.10.2026 at 10:00 in Israel.
//  - "היומן שלי": connect, the link shown once with copy (the clipboard holds it),
//    Apple and Google buttons; the feed at that link is Lior's own iCalendar (the
//    fake function runs app/calendar-feed.js and app/ics.js); "קישור חדש" replaces
//    it and the old link answers 404; "ניתוק" removes it. The database keeps only
//    the hash. The owner sees on the team screen who connected, never the link.
//  - Insights: the numbers on the page equal app/insights.js on the same fixture:
//    on time by role and person, returns by editor and round, the shoot to the
//    first delivery, requests against decision 29, "not relevant" with the item
//    suggested for removal, each shoot day from the scripts to the scheduling; the
//    month picker; satisfaction only once public.client_surveys exists (office-read).
//  - Access: the owner (with the payouts link) and Lior (read-only, no payouts
//    link); Irit, Ofir and an editor get "no access".
//  - A 360px phone: no sideways scrolling on either page.
// Run: a static server on the repository (or the build of scripts/build-pages.mjs),
// then  BASE_URL=http://localhost:8134/ node tests/insights-e2e.mjs [outDir]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomUUID, createHash, randomBytes } from 'node:crypto';
import { applicableProcesses } from '../app/protocol-logic.js';
import { computeInsights, pct, monthRange } from '../app/insights.js';
import { feedEvents, feedName, tokenFrom, feedUrl } from '../app/calendar-feed.js';
import { buildCalendar } from '../app/ics.js';
import { withClientColumns } from './fake-clients.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
const SUPA = 'https://czncjzziqrqtezpwxxpz.supabase.co';
const NOW = new Date('2026-10-20T10:00:00+03:00'); // Tuesday
const t0 = Date.now();
const serverNow = () => new Date(NOW.getTime() + (Date.now() - t0));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const EXP = 4102444800;

// ── People ────────────────────────────────
const people = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', nadia: 'nadia' };
const users = new Map(Object.keys(people).map((k) => [`${k}@astrateg.test`, { id: randomUUID(), email: `${k}@astrateg.test`, aud: 'authenticated', role: 'authenticated', email_confirmed_at: '2026-09-01T00:00:00Z', last_sign_in_at: '2026-10-19T08:00:00Z' }]));
const staff = Object.entries(people).map(([k, person]) => ({ email: `${k}@astrateg.test`, person, vault: person !== 'nadia', phone: null, created_at: '2026-09-01T00:00:00Z' }));
const jwtFor = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp: EXP })}.sig`;
const userOf = (headers) => {
  const token = /^Bearer (.+)$/.exec(headers.authorization || '')?.[1];
  return [...users.values()].find((u) => jwtFor(u) === token) || null;
};
const personOf = (u) => { const r = staff.find((x) => x.email === u?.email); return r ? r.person : undefined; };
const isOwner = (u) => personOf(u) === null;

// ── The fixture (as in tests/insights.test.mjs) ──
const client = (id, fields) => ({
  id, name: '', business: null, address: null, phone: '050-7654321', package_name: null, shoot_type: 'dms', characterizer: 'ofir', has_logo: true,
  editor_name: null, editor: null, deal_at: '2026-09-01T09:00:00+03:00', char_at: '2026-09-02T10:00:00+03:00', shoot_at: null,
  contract_end: '2027-09-01', status: 'active', notes: null, quote_id: null, created_at: '2026-09-01T09:00:00+03:00', updated_at: '2026-10-19T09:00:00+03:00',
  created_by_email: 'irit@astrateg.test', links: {}, deliverables: {}, rounds: [], verified_at: null, verified_by: null, closed_reason: null, ...fields,
});
const A = client('aaaaaaaa-0000-4000-8000-000000000001', { name: 'מספרת רון', editor: 'nadia', shoot_at: '2026-10-04T10:00:00+03:00', address: 'הרצל 10, תל אביב' });
const B = client('bbbbbbbb-0000-4000-8000-000000000002', {
  name: 'קפה גליה', shoot_type: 'natali', editor: 'yariv', shoot_at: '2026-10-11T10:00:00+03:00',
  rounds: [{ n: 2, shoot_at: '2026-10-18T10:00:00+03:00', shoot_type: 'natali', editor: 'nadia' }],
});
const C = client('cccccccc-0000-4000-8000-000000000003', { name: 'חנות ישנה', shoot_at: '2026-10-05T10:00:00+03:00', editor: 'anna' });
// A new client: its shoot on Sunday 25.10, a Zoom tomorrow (Lior's calendar).
const E = client('eeeeeeee-0000-4000-8000-000000000005', { name: 'פיצה נאפולי', deal_at: '2026-10-14T09:00:00+03:00', char_at: '2026-10-15T10:00:00+03:00', shoot_at: '2026-10-25T11:00:00+02:00', address: 'יפו 5, ירושלים' });
const checks = [];
const log = [];
const mark = (c, key, at, { action = 'done', note = null, by = 'ofir@astrateg.test' } = {}) => {
  const iso = new Date(at).toISOString();
  log.push({ id: log.length + 1, client_id: c.id, item_key: key, action, note, by_email: by, at: iso });
  const i = checks.findIndex((x) => x.client_id === c.id && x.item_key === key);
  if (i >= 0) checks.splice(i, 1);
  if (action !== 'clear') checks.push({ client_id: c.id, item_key: key, state: action, note, by_email: by, at: iso });
};
const T = (d, h) => `2026-${d}T${h}:00+03:00`;
const doneAll = (c, ids, at) => {
  for (const p of applicableProcesses(c).filter((x) => ids.includes(x.id))) for (const i of p.items.filter((x) => !x.optional)) mark(c, i.key, at, { by: 'irit@astrateg.test' });
};
doneAll(A, ['p01'], '2026-09-01T09:03:00+03:00');
doneAll(B, ['p01'], '2026-09-01T11:00:00+03:00');
doneAll(E, ['p01', 'p02', 'p03'], T('10-14', '09:04'));
doneAll(C, ['p08'], T('10-06', '10:00'));
mark(A, 'p13.approved', T('10-01', '12:00'));
mark(A, 'p19.all', T('10-04', '18:00'));
mark(A, 'p24.notify', T('10-07', '12:00'));
mark(A, 'p25.return.1', T('10-07', '14:00'));
mark(A, 'p25.return.2', T('10-08', '11:00'));
mark(A, 'p25.approved', T('10-08', '15:00'));
mark(A, 'p26.sent', T('10-08', '16:00'));
mark(A, 'p27.approved', T('10-12', '12:00'));
mark(A, 'p28.scheduled', T('10-12', '15:00'));
mark(A, 'p23.return.1', T('10-06', '12:00'));
mark(B, 'p25.return.1', T('10-13', '12:00'));
mark(B, 'p25.approved', T('10-14', '10:00'));
mark(B, 'p26.sent', T('10-14', '11:00'));
mark(B, 'p27.approved', T('10-15', '12:00'));
mark(B, 'r2.p25.return.1', T('10-19', '12:00'));
mark(C, 'p26.sent', T('10-06', '09:00'), { note: 'ייבוא' });
mark(E, 'p13.zoomat', T('10-19', '12:00'), { note: new Date(T('10-21', '15:00')).toISOString(), by: 'lior@astrateg.test' });
// "Not relevant": Instagram in Meta (10) for 3 of 4 clients: suggested; the Gantt's day for 1 of 3.
for (const [c, action] of [[A, 'na'], [B, 'na'], [C, 'na'], [E, 'done']]) mark(c, 'p10.c.ig', T('10-09', '10:00'), { action, by: 'lior@astrateg.test' });
for (const [c, action] of [[A, 'na'], [B, 'done'], [C, 'done']]) mark(c, 'p09.c.day', T('10-09', '11:00'), { action, by: 'irit@astrateg.test' });
const requests = [
  { id: randomUUID(), client_id: A.id, owner: 'irit', title: 'לשנות את שעת הפרסום', due_on: '2026-10-13', done_at: T('10-13', '17:00'), created_at: T('10-12', '10:00'), source: 'request', urgent: false, brief: null, started_at: null, done_by_email: 'irit@astrateg.test', created_by_email: 'irit@astrateg.test' },
  { id: randomUUID(), client_id: B.id, owner: 'lior', title: 'להוסיף סרטון', due_on: '2026-10-15', done_at: T('10-19', '10:00'), created_at: T('10-14', '10:00'), source: 'request', urgent: false, brief: null, started_at: null, done_by_email: 'lior@astrateg.test', created_by_email: 'irit@astrateg.test' },
  { id: randomUUID(), client_id: A.id, owner: 'lior', title: 'דחוף: הקמפיין נעצר', due_on: '2026-10-15', done_at: T('10-15', '10:40'), created_at: T('10-15', '10:00'), source: 'request', urgent: true, brief: null, started_at: null, done_by_email: 'lior@astrateg.test', created_by_email: 'irit@astrateg.test' },
  { id: randomUUID(), client_id: E.id, owner: 'irit', title: 'לשלוח את הגאנט שוב', due_on: '2026-10-20', done_at: null, created_at: T('10-19', '09:30'), source: 'request', urgent: false, brief: null, started_at: null, done_by_email: null, created_by_email: 'irit@astrateg.test' },
];
const liorTask = { id: randomUUID(), client_id: E.id, owner: 'lior', title: 'להתקשר ללקוח על הלוקיישן', due_on: '2026-10-22', done_at: null, created_at: T('10-19', '10:00'), source: null, urgent: false, brief: null, started_at: null, done_by_email: null, created_by_email: 'irit@astrateg.test' };
// public.client_surveys as stage 4 keeps it (20260930170000_client_status.sql).
const survey = (id, c, kind, score, at, source = 'page') => ({
  id: randomUUID(), client_id: c.id, kind, score, respondent: 'לקוח', question: 'q', source, link_id: null, recorded_by: '', at, task_id: null,
});
const surveys = [
  survey(1, A, 'shoot', 5, T('10-05', '10:00')),
  survey(2, B, 'delivery', 2, T('10-16', '10:00'), 'office'),
  survey(3, C, 'nps', 9, T('10-17', '10:00')),
  survey(4, E, 'shoot', 4, T('09-20', '10:00')), // September: not this month
];
const SURVEY_COLUMNS = new Set(Object.keys(surveys[0]));

const db = {
  staff, clients: [A, B, C, E], protocol_checks: checks, protocol_log: log, client_tasks: [...requests, liorTask],
  office_reviews: [], client_status_notes: [], client_messages: [], client_access: [], client_date_changes: [], client_questions: [], quotes: [],
};

// ── The calendar feeds (public.calendar_feeds: the hash only) ──
const feeds = new Map(); // email -> { hash, created_at, last_fetch_at }
const sha = (t) => createHash('sha256').update(t).digest('hex');
function serveFeed(url) {
  const token = tokenFrom(url);
  const email = token && [...feeds.entries()].find(([, f]) => f.hash === sha(token))?.[0];
  if (!email) return { status: 404, body: 'not found' };
  feeds.get(email).last_fetch_at = serverNow().toISOString();
  const person = personOf({ email }) ?? 'owner';
  const byClient = {};
  for (const c of checks) (byClient[c.client_id] ||= {})[c.item_key] = c;
  const events = feedEvents({ person, clients: db.clients, checks: byClient, tasks: db.client_tasks.filter((t) => t.owner === person), now: serverNow() });
  return { status: 200, body: buildCalendar({ name: feedName(person), events, now: serverNow() }) };
}

// ── Fake PostgREST ─────────────────────────
function applyFilters(rows, params) {
  let out = rows;
  for (const [k, v] of params) {
    if (['select', 'order', 'offset', 'limit', 'on_conflict', 'columns', 'or'].includes(k)) continue;
    if (v.startsWith('eq.')) out = out.filter((r) => String(r[k]) === v.slice(3));
    else if (v.startsWith('neq.')) out = out.filter((r) => String(r[k]) !== v.slice(4));
    else if (v === 'is.null') out = out.filter((r) => r[k] === null || r[k] === undefined);
    else if (v.startsWith('gte.')) out = out.filter((r) => r[k] !== null && new Date(r[k]) >= new Date(v.slice(4)));
    else if (v.startsWith('in.(')) { const set = v.slice(4, -1).split(',').map((x) => x.replace(/^"|"$/g, '')); out = out.filter((r) => set.includes(String(r[k]))); }
  }
  return out;
}
const fnCalls = [];
// public.clients as the database answers it since 20260930210000_hardening.sql (tests/fake-clients.mjs).
const CLIENT_SHAPE = { clients: () => db.clients, staff: () => db.staff };
async function fakeSupabase(route) {
  const req = route.request();
  const url = new URL(req.url());
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  const headers = req.headers();
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  const json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data), headers: cors });
  if (req.method() === 'OPTIONS') return json(200, {});
  const p = url.pathname;
  const me = userOf(headers);
  if (p === '/functions/v1/calendar' || p.startsWith('/functions/v1/calendar/')) {
    const r = serveFeed(url.href);
    return route.fulfill({ status: r.status, body: r.body, headers: { ...cors, 'content-type': r.status === 200 ? 'text/calendar; charset=utf-8' : 'text/plain' } });
  }
  if (p === '/auth/v1/token') {
    const u = users.get(String(body.email || '').toLowerCase());
    if (!u || body.password !== 'correct-horse') return json(400, { error: 'invalid_grant', msg: 'Invalid login credentials', code: 'invalid_credentials' });
    return json(200, { access_token: jwtFor(u), token_type: 'bearer', expires_in: 3600, expires_at: EXP, refresh_token: `r-${u.id}`, user: u });
  }
  if (p === '/auth/v1/user') return me ? json(200, me) : json(401, { msg: 'invalid JWT' });
  if (p === '/functions/v1/staff-admin') {
    if (!me || !(isOwner(me) || ['irit', 'lior'].includes(personOf(me)))) return json(403, { error: 'not_allowed' });
    fnCalls.push(body.action);
    const self = staff.find((r) => r.email === me.email);
    return json(200, {
      caller: { email: me.email, person: self.person, owner: self.person === null, vault: !!self.vault },
      rows: staff.map((r) => ({ ...r, has_login: true, confirmed: true, last_sign_in_at: users.get(r.email).last_sign_in_at, invited_at: null, last_link_at: null, last_link_by: null })),
    });
  }
  const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(p)?.[1];
  if (rpc === 'is_staff') return json(200, !!me && staff.some((r) => r.email === me.email));
  if (rpc === 'can_use_vault') return json(200, !!me && !!staff.find((r) => r.email === me.email)?.vault);
  if (rpc && rpc.startsWith('calendar_')) {
    if (!me) return json(401, { message: 'permission denied' });
    const f = feeds.get(me.email);
    if (rpc === 'calendar_feed_status') return json(200, f ? [{ connected: true, created_at: f.created_at, last_fetch_at: f.last_fetch_at, fetch_count: 0 }] : []);
    if (rpc === 'calendar_feed_rotate') {
      const token = randomBytes(32).toString('hex');
      feeds.set(me.email, { hash: sha(token), created_at: serverNow().toISOString(), last_fetch_at: null });
      return json(200, token);
    }
    if (rpc === 'calendar_feed_revoke') return json(200, feeds.delete(me.email));
    if (rpc === 'calendar_feeds_team') {
      return json(200, isOwner(me) ? [...feeds.entries()].map(([email, x]) => ({ email, person: personOf({ email }), created_at: x.created_at, last_fetch_at: x.last_fetch_at })) : []);
    }
  }
  if (rpc) return json(404, { code: 'PGRST202', message: `Could not find the function public.${rpc}` });
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m || !db[m[1]]) return json(404, { code: 'PGRST205', message: `Could not find the table 'public.${m?.[1]}' in the schema cache` });
  if (!me) return json(401, { message: 'permission denied' });
  const table = m[1];
  const single = (headers.accept || '').includes('vnd.pgrst.object');
  if (req.method() !== 'GET') return json(405, { message: `unexpected ${req.method()} on ${table}` });
  let rows = applyFilters(db[table], url.searchParams);
  // Row level security, as the migrations have it: the office reads every client.
  const office = isOwner(me) || ['irit', 'lior', 'ofir'].includes(personOf(me));
  if (!office && ['clients', 'protocol_checks', 'protocol_log', 'client_tasks'].includes(table)) {
    const mine = new Set(db.clients.filter((c) => c.editor === personOf(me) || c.rounds.some((r) => r.editor === personOf(me))).map((c) => c.id));
    rows = rows.filter((r) => mine.has(table === 'clients' ? r.id : r.client_id));
  }
  if (table === 'client_messages' && !office) rows = [];
  // "office reads surveys": the owner, Irit, Lior, Ofir and Ilai; and only the table's own columns.
  if (table === 'client_surveys') {
    for (const col of (url.searchParams.get('select') || '*').split(',')) {
      if (col !== '*' && !SURVEY_COLUMNS.has(col.trim())) return json(400, { code: '42703', message: `column client_surveys.${col} does not exist` });
    }
    if (!office) rows = [];
  }
  const off = Number(url.searchParams.get('offset') || 0);
  const lim = Number(url.searchParams.get('limit') || 1e9);
  rows = rows.slice(off, off + lim);
  if (single) return rows.length ? json(200, rows[0]) : json(406, { message: 'no rows' });
  return json(200, rows);
}

// ── Browser ────────────────────────────────
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
async function newContext(viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport });
  await ctx.clock.install({ time: NOW });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
  await ctx.route(`${SUPA}/**`, withClientColumns(fakeSupabase, CLIENT_SHAPE));
  return ctx;
}
async function newPage(ctx) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (msgx) => { if (msgx.type() === 'error' && !/Failed to load resource/.test(msgx.text())) errors.push(msgx.text()); });
  page.on('dialog', (d) => d.accept());
  return page;
}
async function signIn(page, path, email) {
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', email);
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
}
const text = (page, sel) => page.locator(sel).innerText();
const shot = async (page, name) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); };
const shotOf = async (loc, name) => { if (OUT) await loc.screenshot({ path: `${OUT}/${name}.png` }); };
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const toastHas = (page, t) => page.waitForFunction((x) => document.querySelector('#toast.on')?.textContent.includes(x), t);
let passed = 0;
async function step(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}
const fetchIn = (page, url) => page.evaluate(async (u) => { const r = await fetch(u); return { status: r.status, type: r.headers.get('content-type'), body: await r.text() }; }, url);

// ── "היומן שלי" ─────────────────────────────
const lctx = await newContext({ width: 360, height: 780 });
const lior = await newPage(lctx);
let firstUrl = null;

await step('"היומן שלי" in "מה עליי": not connected, one button', async () => {
  await signIn(lior, 'clients.html#mine', 'lior@astrateg.test');
  await lior.waitForSelector('#cal-card:not([hidden]) #cal-make');
  assert.equal(await text(lior, '#cal-h'), 'היומן שלי');
  assert.match(await text(lior, '#cal-card'), /ימי הצילום, הפגישות והיעדים שלך/);
  assert.equal(await lior.locator('#cal-url').count(), 0);
  assert.ok(await noHScroll(lior), 'sideways scroll at 360px');
});

await step('connect: the link once, copy puts it on the clipboard, Apple and Google buttons; the feed is Lior\'s own', async () => {
  await lior.click('#cal-make');
  await lior.waitForSelector('#cal-url');
  await toastHas(lior, 'הקישור ליומן מוכן');
  firstUrl = await lior.inputValue('#cal-url');
  const token = tokenFrom(firstUrl);
  assert.ok(token, firstUrl);
  assert.equal(firstUrl, feedUrl(SUPA, token));
  // Only the hash is kept.
  assert.equal(feeds.get('lior@astrateg.test').hash, sha(token));
  assert.ok(!JSON.stringify([...feeds.values()]).includes(token));
  assert.equal(await lior.getAttribute('#cal-apple', 'href'), firstUrl.replace('https://', 'webcal://'));
  assert.equal(new URL(await lior.getAttribute('#cal-google', 'href')).searchParams.get('cid'), firstUrl.replace('https://', 'webcal://'));
  assert.equal(await lior.getAttribute('#cal-google', 'rel'), 'noopener noreferrer');
  await lior.click('#cal-copy');
  await toastHas(lior, 'הקישור הועתק');
  assert.equal(await lior.evaluate(() => navigator.clipboard.readText()), firstUrl);
  assert.match(await text(lior, '#cal-meta'), /מחובר מאז היום/);
  // Instructions for Google, Apple and Outlook, folded.
  await lior.click('.cal-how summary');
  assert.match(await text(lior, '.cal-how'), /Google Calendar[^]*Apple[^]*Outlook/);
  assert.ok(await noHScroll(lior), 'sideways scroll at 360px with the link');
  await shotOf(lior.locator('#cal-card'), 'insights-01-calendar-card');
  // What a calendar app gets at that link: Lior's shoot days, his Zoom and his task; never a client's phone.
  const feed = await fetchIn(lior, firstUrl);
  assert.equal(feed.status, 200);
  assert.match(feed.type, /^text\/calendar/);
  const ics = feed.body.replace(/\r\n /g, '');
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /X-WR-CALNAME:אסטרטג · ליאור/);
  assert.match(ics, /SUMMARY:יום צילום · פיצה נאפולי · דניס\\, מישל וסמיון\r\nLOCATION:יפו 5\\, ירושלים|LOCATION:יפו 5\\, ירושלים/);
  assert.match(ics, /SUMMARY:זום לאישור התסריטים · פיצה נאפולי/);
  assert.match(ics, /SUMMARY:משימה: להתקשר ללקוח על הלוקיישן · פיצה נאפולי/);
  assert.ok(!ics.includes('050-7654321'));
  assert.ok(!/SUMMARY:פגישת אפיון/.test(ics), 'Ofir\'s meeting in Lior\'s feed');
  for (const line of feed.body.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, line);
});

await step('"קישור חדש" replaces the link (the old one answers 404); the calendar\'s last read shows', async () => {
  await lior.reload();
  await lior.waitForSelector('#cal-card:not([hidden]) #cal-rotate');
  // After a reload the link is not shown again (only its hash exists); the card says when it was read.
  assert.equal(await lior.locator('#cal-url').count(), 0);
  assert.match(await text(lior, '#cal-meta'), /מחובר מאז היום[^]*היומן התעדכן לאחרונה היום/);
  await lior.click('#cal-rotate');
  await lior.waitForSelector('#cal-url');
  const second = await lior.inputValue('#cal-url');
  assert.notEqual(second, firstUrl);
  assert.equal((await fetchIn(lior, firstUrl)).status, 404);
  assert.equal((await fetchIn(lior, second)).status, 200);
  assert.equal(await lior.evaluate(() => document.activeElement?.id), 'cal-url');
});

await step('the owner sees on the team screen who connected, never the link', async () => {
  const octx = await newContext();
  const owner = await newPage(octx);
  await signIn(owner, 'team.html', 'owner@astrateg.test');
  await owner.waitForSelector('#row-lior .tm-cal');
  assert.match(await text(owner, '#row-lior .tm-cal'), /^יומן: מחובר · /);
  assert.equal(await text(owner, '#row-irit .tm-cal'), 'יומן: לא מחובר');
  const page = await owner.content();
  assert.ok(!page.includes(tokenFrom(await lior.inputValue('#cal-url'))));
  await octx.close();
  // Irit manages the team too, but the calendar line is the owner's.
  const ictx = await newContext();
  const irit = await newPage(ictx);
  await signIn(irit, 'team.html', 'irit@astrateg.test');
  await irit.waitForSelector('#row-lior');
  assert.equal(await irit.locator('.tm-cal').count(), 0);
  await ictx.close();
});

await step('"ניתוק": the link stops, the card is back to one button', async () => {
  const url = await lior.inputValue('#cal-url');
  await lior.click('#cal-revoke');
  await lior.waitForSelector('#cal-make');
  await toastHas(lior, 'היומן נותק');
  assert.equal(feeds.has('lior@astrateg.test'), false);
  assert.equal((await fetchIn(lior, url)).status, 404);
  assert.equal(await lior.evaluate(() => document.activeElement?.id), 'cal-make');
  await lctx.close();
});

// ── Insights ───────────────────────────────
const byClient = () => { const o = {}; for (const c of checks) (o[c.client_id] ||= {})[c.item_key] = c; return o; };
const expect = (month, withSurveys = false) => computeInsights({
  clients: db.clients, checks: byClient(), log, tasks: requests, surveys: withSurveys ? surveys : null, now: NOW, month,
});
const OCT = expect('2026-10');
const octx = await newContext();
const owner = await newPage(octx);

await step('the owner opens the insights: the month, four numbers, the payouts link', async () => {
  await signIn(owner, 'insights.html', 'owner@astrateg.test');
  await owner.waitForSelector('#in-page:not([hidden]) #st-ontime');
  assert.equal(await owner.inputValue('#in-month'), '2026-10');
  assert.equal(await owner.locator('#in-month option').count(), 12);
  assert.equal(await owner.isVisible('#link-payouts'), true);
  assert.equal(await owner.getAttribute('#link-payouts', 'href'), 'payouts/');
  assert.equal(await owner.isHidden('#in-ro'), true);
  const tile = (id) => owner.locator(`#${id} .v`).innerText();
  assert.equal(await tile('st-ontime'), pct(OCT.onTime.all.rate));
  assert.match(await text(owner, '#st-ontime .sub'), new RegExp(`^${OCT.onTime.all.onTime} מתוך ${OCT.onTime.all.done} תהליכים$`));
  assert.equal(await tile('st-returns'), '5');
  assert.equal(await text(owner, '#st-returns .sub'), 'סרטונים 4 · גרפיקות 1');
  assert.equal(await tile('st-delivery'), '3.5');
  assert.equal(await tile('st-requests'), '67%');
  assert.equal(await text(owner, '#st-requests .sub'), '2 מתוך 3');
  assert.equal(await owner.locator('#st-sat').count(), 0);
  await shot(owner, 'insights-02-owner');
});

await step('on time by role and by person, as app/insights.js counts them; the six months\' trend', async () => {
  for (const r of OCT.onTime.roles) {
    const want = r.done ? `${pct(r.rate)} · ${r.onTime} מתוך ${r.done}` : 'לא נסגרו תהליכים';
    assert.equal(await text(owner, `#role-${r.key} .bar-val`), want, r.key);
  }
  for (const p of OCT.onTime.people) {
    const want = p.done ? `${pct(p.rate)} · ${p.onTime} מתוך ${p.done}` : 'לא נסגרו תהליכים';
    assert.equal(await text(owner, `#person-${p.key} .bar-val`), want, p.key);
  }
  // The bar is decoration; the number is in the text.
  assert.equal(await owner.getAttribute('#person-irit .bar-track', 'aria-hidden'), 'true');
  assert.equal(await owner.locator('#in-trend thead th').count(), 7);
  assert.equal(await owner.locator('#in-trend tbody tr').count(), 7);
});

await step('returns by editor and round; the shoot to the first delivery; requests; "not relevant"; per shoot day', async () => {
  assert.equal(await text(owner, '#qa-nadia .bar-val'), '3 החזרות');
  assert.equal(await text(owner, '#qa-nadia .bar-sub'), 'החזרה ראשונה: 2 · שנייה: 1 · עברו בקרה: 1');
  assert.equal(await text(owner, '#qa-yariv .bar-val'), 'החזרה אחת');
  assert.equal(await text(owner, '#qa-graphics .bar-val'), 'החזרה אחת');
  assert.equal(await owner.locator('#qa-anna').count(), 0); // an imported delivery, no returns
  assert.match(await text(owner, '#dl-median'), /חציון עד מסירה ראשונה: 3\.5 ימי עסקים · 2 ימי צילום/);
  assert.match(await text(owner, '#dl-closed'), /1 מתוך 2/);
  assert.equal(await text(owner, `#dl-${A.id}-1 .bar-val`), '4 ימי עסקים');
  assert.equal(await text(owner, `#dl-${B.id}-1 .bar-val`), '3 ימי עסקים');
  assert.equal(await text(owner, '#rq-total dd'), '4');
  assert.equal(await text(owner, '#rq-ontime dd'), '2 מתוך 3 (67%)');
  assert.equal(await text(owner, '#rq-urgent dd'), '1 מתוך 1');
  assert.equal(await text(owner, '#rq-median dd'), '16 ש׳ בשעות משרד');
  assert.equal(await text(owner, '#rq-open dd'), '1');
  assert.equal(await text(owner, '#sat-none'), 'הסקרים ללקוחות עוד לא פעילים במערכת. כשיהיו, הציונים יופיעו כאן.');
  const na = owner.locator('#in-na > li');
  assert.equal(await na.count(), 2);
  assert.match(await na.nth(0).innerText(), /3 מתוך 4 \(75%\)[^]*להסרה בגרסה הבאה/);
  assert.equal(await na.nth(0).getAttribute('id'), 'na-p10-c-ig');
  assert.match(await na.nth(1).innerText(), /1 מתוך 3 \(33%\)/);
  assert.equal(await na.nth(1).locator('.na-flag').count(), 0);
  // Ron: all six stages; Galia's first round waits for the scheduling; her second round was shot.
  const ron = owner.locator(`#pipe-${A.id}-1`);
  assert.equal(await ron.locator('.pipe-st.is-done').count(), 6);
  assert.match(await ron.innerText(), /מהצילום ועד התזמון: 6 ימי עסקים/);
  const galia = owner.locator(`#pipe-${B.id}-1`);
  assert.equal(await galia.locator('.pipe-st.is-next').getAttribute('data-stage'), 'scheduled');
  assert.equal(await owner.locator(`#pipe-${B.id}-2 .pipe-st.is-next`).getAttribute('data-stage'), 'edited');
  assert.equal(await owner.locator('#in-pipe > li').count(), OCT.pipeline.length);
});

await step('the month picker: September\'s numbers', async () => {
  const SEP = expect('2026-09');
  await owner.selectOption('#in-month', '2026-09');
  await owner.waitForFunction((want) => document.querySelector('#st-ontime .sub')?.textContent === want,
    SEP.onTime.all.done ? `${SEP.onTime.all.onTime} מתוך ${SEP.onTime.all.done} תהליכים` : 'עוד לא נסגרו תהליכים');
  assert.equal(await text(owner, '#st-ontime .v'), pct(SEP.onTime.all.rate));
  assert.equal(await text(owner, '#st-returns .v'), '0');
  assert.match(await text(owner, '#in-qa'), /לא היו החזרות החודש/);
  assert.match(await text(owner, '#in-na'), /שום פריט לא סומן/);
  assert.equal(monthRange('2026-09').label, await owner.locator('#in-month option:checked').innerText());
  await owner.selectOption('#in-month', '2026-10');
  await owner.waitForSelector('#qa-nadia');
});

await step('satisfaction appears once the surveys table exists (public.client_surveys, this month only)', async () => {
  assert.match(await text(owner, '#in-sat'), /הסקרים ללקוחות עוד לא פעילים/);
  db.client_surveys = surveys;
  await owner.click('#btn-refresh');
  await owner.waitForSelector('#st-sat');
  const S = expect('2026-10', true).satisfaction;
  assert.equal(await text(owner, '#st-sat .v'), S.avg.toFixed(1));
  assert.equal(await text(owner, '#sat-avg dd'), '3.5 · 2 תשובות');
  assert.equal(await text(owner, '#sat-shoot dd'), '5.0 · תשובה אחת');
  assert.equal(await text(owner, '#sat-delivery dd'), '2.0 · תשובה אחת');
  assert.equal(await text(owner, '#sat-low dd'), '1');
  assert.equal(await text(owner, '#sat-nps dd'), '100 · תשובה אחת');
});

await step('a 360px phone: no sideways scrolling', async () => {
  await owner.setViewportSize({ width: 360, height: 780 });
  await owner.waitForTimeout(200);
  assert.ok(await noHScroll(owner), 'sideways scroll at 360px');
  await owner.click('.in-trend summary');
  assert.ok(await noHScroll(owner), 'the trend table scrolls the page sideways');
  await shot(owner, 'insights-03-phone');
  await octx.close();
});

await step('Lior reads it (no payouts link); Irit, Ofir and an editor have no access', async () => {
  const ctx = await newContext();
  const l = await newPage(ctx);
  await signIn(l, 'insights.html', 'lior@astrateg.test');
  await l.waitForSelector('#in-page:not([hidden]) #st-ontime');
  assert.equal(await l.isHidden('#link-payouts'), true);
  assert.equal(await l.isVisible('#in-ro'), true);
  // The office screens' row, as on clients.html: his, without the page itself.
  assert.deepEqual(await l.evaluate(() => [...document.querySelectorAll('#head-actions .office-link')].map((a) => a.id)), ['cta-qa', 'cta-decisions', 'cta-year']);
  assert.equal(await text(l, '#st-returns .v'), '5');
  // The surveys are office-read (RLS), and Lior is the office: he sees the scores too.
  await l.waitForSelector('#st-sat');
  assert.equal(await text(l, '#sat-avg dd'), '3.5 · 2 תשובות');
  await ctx.close();
  for (const who of ['irit', 'ofir', 'nadia']) {
    const c = await newContext();
    const page = await newPage(c);
    await signIn(page, 'insights.html', `${who}@astrateg.test`);
    await page.waitForSelector('#no-access:not([hidden])');
    assert.equal(await page.isHidden('#in-page'), true, who);
    assert.equal(await page.locator('.bar-row').count(), 0, who);
    await c.close();
  }
});

await step('the office links: the owner and Lior reach the insights, Irit does not', async () => {
  const ctx = await newContext();
  const o = await newPage(ctx);
  await signIn(o, 'owner.html', 'owner@astrateg.test');
  await o.waitForSelector('#ow-page:not([hidden])');
  assert.equal(await o.isHidden('#nav-insights'), false);
  await ctx.close();
  const c2 = await newContext();
  const i = await newPage(c2);
  await signIn(i, 'owner.html#all', 'irit@astrateg.test');
  await i.waitForSelector('#ow-page:not([hidden])');
  assert.equal(await i.isHidden('#nav-insights'), true);
  await c2.close();
});

await browser.close();
assert.deepEqual(errors, [], `page errors:\n${errors.join('\n')}`);
console.log(`\n${passed} steps passed`);
