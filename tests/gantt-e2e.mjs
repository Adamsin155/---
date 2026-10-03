// End-to-end check of the content Gantt (gantt.html) against an in-memory fake of
// Supabase. The browser's clock is fixed on Thursday 12.11.2026 at 10:00 in Israel.
//  - Ilai opens the Gantt of a client signed 15.3.2026 for a year: nothing yet, so he
//    creates it from the template; the calendar opens on November 2026 (month 8),
//    with the year at a glance, the legend and the stats.
//  - He marks a video as posted with its link and one of the client's files
//    (public.client_files, the shared contract), drags another video to a new day
//    (kept as "moved by hand"), and adds an entry of his own.
//  - "עדכון מהתבנית" after the package grew: new videos are added, the moved date
//    stays unless that is confirmed.
//  - The client's read-only link: created, opened without signing in, with no
//    internal entry or note; a bad token says so. The print view of a month.
//  - The editor of the client reads only; an editor without the client does not see it.
//  - Links from the client card and from Ilai's process 29 in "מה עליי".
//  - A 360px phone: the list by default, the grid with dots, no sideways scrolling.
// Run: npx http-server -p 8080 -s . &  then  node tests/gantt-e2e.mjs [outDir]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { dateIL } from '../app/tz.js';
import { generatePlan } from '../app/gantt-logic.js';
import { importKeys } from '../app/client-open.js';
import { withClientColumns } from './fake-clients.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
const NOW = new Date('2026-11-12T10:00:00+02:00'); // Thursday
const t0 = Date.now();
const serverNow = () => new Date(NOW.getTime() + (Date.now() - t0)).toISOString();
const todayIL = '2026-11-12';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const EXP = 4102444800;
const IL = (y, m, d, h = 10, mi = 0) => dateIL(y, m, d, h, mi).toISOString();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// ── People ────────────────────────────────
const people = { owner: null, irit: 'irit', ilai: 'ilai', nadia: 'nadia', anna: 'anna' };
const users = new Map(Object.keys(people).map((k) => [`${k}@astrateg.test`, { id: randomUUID(), email: `${k}@astrateg.test`, aud: 'authenticated', role: 'authenticated' }]));
const staff = Object.entries(people).map(([k, person]) => ({ email: `${k}@astrateg.test`, person, vault: false, phone: null }));
const jwtFor = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp: EXP })}.sig`;
const userOf = (headers) => {
  const token = /^Bearer (.+)$/.exec(headers.authorization || '')?.[1];
  return [...users.values()].find((u) => jwtFor(u) === token) || null;
};
const personOf = (u) => staff.find((x) => x.email === u?.email)?.person;
const isOffice = (u) => { const p = personOf(u); return p === null || ['irit', 'lior', 'ofir', 'ilai'].includes(p); };

// ── Clients ───────────────────────────────
const client = (fields) => ({
  id: randomUUID(), name: '', business: null, address: null, phone: '050-0000000', package_name: 'Social + TV all in one · סמיון, מישל ודניס', shoot_type: 'dms', characterizer: 'ofir',
  has_logo: true, editor_name: null, editor: 'nadia', deal_at: IL(2026, 3, 15), char_at: IL(2026, 3, 16), shoot_at: IL(2026, 3, 25),
  contract_end: '2027-03-15', status: 'active', notes: 'הערה של המשרד', quote_id: null, created_at: '2026-09-29T18:00:00Z',
  created_by_email: 'irit@astrateg.test', links: {}, deliverables: { videos: 42, graphics: 42, shoot_days: 2, collabs: 3, stories: 3, ch14: 1, monthly: 0 },
  rounds: [], verified_at: null, verified_by: null, closed_reason: null, protocol_version: 5,
  ...fields,
});
const A = client({ name: 'מספרת רון', business: 'מספרת רון בע״מ' });
const B = client({ name: 'קפה נדיה', editor: 'yariv' });
const checks = [];
const done = (c, key, at) => checks.push({ client_id: c.id, item_key: key, state: 'done', note: 'ייבוא', by_email: 'irit@astrateg.test', at });
for (const k of importKeys('publish')) done(A, k, IL(2026, 4, 10, 9));

const files = [
  { id: randomUUID(), client_id: A.id, kind: 'deliverable_video', label: 'סרטון 29 · רילס תספורת', storage_path: `${A.id}/v29.mp4`, mime: 'video/mp4', size_bytes: 1000, posted_on: null, link: 'https://www.instagram.com/reel/ron29', uploaded_by: 'ilai@astrateg.test', created_at: '2026-11-01T10:00:00Z', deleted_at: null },
  { id: randomUUID(), client_id: A.id, kind: 'deliverable_graphic', label: 'גרפיקה מבצע חורף', storage_path: `${A.id}/g1.png`, mime: 'image/png', size_bytes: 1000, posted_on: null, link: null, uploaded_by: 'ilai@astrateg.test', created_at: '2026-11-01T10:00:00Z', deleted_at: null },
  { id: randomUUID(), client_id: A.id, kind: 'logo', label: 'לוגו', storage_path: `${A.id}/logo.png`, mime: 'image/png', size_bytes: 1, posted_on: null, link: null, uploaded_by: 'irit@astrateg.test', created_at: '2026-03-20T10:00:00Z', deleted_at: null },
];

const db = {
  staff,
  clients: [A, B],
  protocol_checks: checks,
  protocol_log: [],
  client_tasks: [],
  office_reviews: [],
  client_status_notes: [],
  client_messages: [],
  client_access: [],
  client_access_log: [],
  client_date_changes: [],
  client_questions: [],
  client_month_marks: [],
  client_gantt: [],
  client_gantt_links: [],
  client_files: files,
};
const tokens = new Map(); // token -> link id

// ── Fake PostgREST ─────────────────────────
const unq = (s) => s.replace(/^"(.*)"$/, '$1');
function match(r, k, v) {
  if (v.startsWith('eq.')) return String(r[k]) === unq(v.slice(3));
  if (v.startsWith('neq.')) return String(r[k]) !== unq(v.slice(4));
  if (v.startsWith('gte.')) return String(r[k] ?? '') >= unq(v.slice(4));
  if (v.startsWith('in.(')) return new Set(v.slice(4, -1).split(',').map(unq)).has(String(r[k]));
  if (v === 'is.null') return r[k] === null || r[k] === undefined;
  if (v === 'not.is.null') return r[k] !== null && r[k] !== undefined;
  return true;
}
function applyFilters(rows, params) {
  let out = rows;
  for (const [k, v] of params) {
    if (['select', 'order', 'offset', 'limit', 'on_conflict', 'columns'].includes(k)) continue;
    out = out.filter((r) => match(r, k, v));
  }
  return out;
}
const sees = (u, clientId) => isOffice(u) || db.clients.some((c) => c.id === clientId && c.editor === personOf(u));
// The database's rules for a Gantt row (client_gantt_rules, protocol_stamp).
function ganttRow(row, me, now) {
  const r = { state: 'planned', posted_on: null, file_id: null, link: null, note: null, edited: false, internal: false, num: null, month: null, time_il: null, template_version: 1, ...row };
  r.internal = !!r.internal || ['plan', 'renewal'].includes(r.kind);
  r.posted_on = r.state === 'posted' ? r.posted_on || todayIL : null;
  if (r.time_il && r.time_il.length === 5) r.time_il = `${r.time_il}:00`;
  r.by_email = me.email;
  r.at = now;
  return r;
}
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
  const now = serverNow();
  if (p === '/auth/v1/token') {
    const u = users.get(String(body.email || '').toLowerCase());
    if (!u || body.password !== 'correct-horse') return json(400, { error: 'invalid_grant', msg: 'Invalid login credentials', code: 'invalid_credentials' });
    return json(200, { access_token: jwtFor(u), token_type: 'bearer', expires_in: 3600, expires_at: EXP, refresh_token: `r-${u.id}`, user: u });
  }
  if (p === '/auth/v1/user') return me ? json(200, me) : json(401, { msg: 'invalid JWT' });
  if (p === '/auth/v1/logout') return route.fulfill({ status: 204 });
  // Storage: a signed link to a file of a client one sees, and the file itself.
  if (p.startsWith('/storage/v1/object/sign/client-files/')) {
    if (req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'image/png', body: PNG, headers: cors });
    const path = decodeURIComponent(p.slice('/storage/v1/object/sign/client-files/'.length));
    const f = files.find((x) => x.storage_path === path);
    if (!me || !f || !sees(me, f.client_id)) return json(400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
    return json(200, { signedURL: `/object/sign/client-files/${encodeURIComponent(path)}?token=t` });
  }
  if (p === '/rest/v1/rpc/is_staff') return json(200, !!me && staff.some((r) => r.email === me.email));
  if (p === '/rest/v1/rpc/gantt_link_create') {
    if (!me || !isOffice(me)) return json(403, { code: '42501', message: 'not allowed' });
    for (const l of db.client_gantt_links) if (l.client_id === body.p_client && !l.revoked_at) { l.revoked_at = now; l.revoked_by = me.email; }
    const token = randomBytes(32).toString('base64url');
    const link = { id: randomUUID(), client_id: body.p_client, created_at: now, created_by: me.email, expires_at: new Date(Date.parse(now) + 400 * 864e5).toISOString(), revoked_at: null, revoked_by: null };
    db.client_gantt_links.push(link);
    tokens.set(token, link.id);
    return json(200, { id: link.id, token, expiresAt: link.expires_at });
  }
  if (p === '/rest/v1/rpc/gantt_link_token') {
    if (!me || !isOffice(me)) return json(403, { code: '42501', message: 'not allowed' });
    const l = db.client_gantt_links.find((x) => x.id === body.p_id && !x.revoked_at);
    return json(200, l ? [...tokens].find(([, id]) => id === l.id)?.[0] || null : null);
  }
  if (p === '/rest/v1/rpc/gantt_link_revoke') {
    if (!me || !isOffice(me)) return json(403, { code: '42501', message: 'not allowed' });
    const l = db.client_gantt_links.find((x) => x.id === body.p_id);
    if (l) { l.revoked_at = now; l.revoked_by = me.email; }
    return json(200, null);
  }
  if (p === '/rest/v1/rpc/get_gantt') {
    // As public.get_gantt: no internal entry, no note, no file path.
    const id = tokens.get(body.p_token);
    const l = db.client_gantt_links.find((x) => x.id === id);
    if (!l) return json(200, { state: 'invalid' });
    if (l.revoked_at) return json(200, { state: 'revoked' });
    const c = db.clients.find((x) => x.id === l.client_id);
    const fileOf = (fid) => files.find((f) => f.id === fid && f.client_id === c.id);
    const entries = db.client_gantt.filter((g) => g.client_id === c.id && !g.internal && !['plan', 'renewal'].includes(g.kind))
      .sort((a, b) => `${a.day}${a.time_il || '99'}${a.key}`.localeCompare(`${b.day}${b.time_il || '99'}${b.key}`))
      .map((g) => ({ key: g.key, kind: g.kind, title: g.title, day: g.day, time: g.time_il ? g.time_il.slice(0, 5) : null, num: g.num, state: g.state, postedOn: g.posted_on, link: g.link || fileOf(g.file_id)?.link || null }));
    return json(200, { state: 'ok', preview: !!me, expiresAt: l.expires_at, client: { business: c.business || c.name, dealAt: c.deal_at, contractEnd: c.contract_end }, entries });
  }
  if (p.startsWith('/rest/v1/rpc/')) return json(404, { code: 'PGRST202', message: 'not found' });
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m || !db[m[1]]) return json(404, { code: '42P01', message: 'relation does not exist' });
  if (!me) return json(401, { message: 'permission denied' });
  const table = m[1];
  const single = (headers.accept || '').includes('vnd.pgrst.object');
  const reply = (rows) => (single ? (rows.length ? json(200, rows[0]) : json(406, { message: 'no rows' })) : json(200, rows));
  const denied = () => json(403, { code: '42501', message: `new row violates row-level security policy for table "${table}"` });
  if (req.method() === 'GET') {
    let rows = applyFilters(db[table], url.searchParams);
    if (['client_gantt', 'client_files'].includes(table)) rows = rows.filter((r) => sees(me, r.client_id));
    if (table === 'client_gantt_links' && !isOffice(me)) rows = [];
    if (table === 'clients') rows = rows.filter((r) => sees(me, r.id));
    if (table === 'client_gantt') rows = [...rows].sort((a, b) => a.day.localeCompare(b.day) || a.key.localeCompare(b.key));
    const off = Number(url.searchParams.get('offset') || 0);
    const lim = Number(url.searchParams.get('limit') || 1e9);
    return reply(rows.slice(off, off + lim));
  }
  if (table === 'client_gantt' && !isOffice(me)) return req.method() === 'DELETE' || req.method() === 'PATCH' ? reply([]) : denied();
  if (req.method() === 'POST') {
    const out = [];
    for (const r of Array.isArray(body) ? body : [body]) {
      if (table === 'client_gantt') {
        const i = db.client_gantt.findIndex((x) => x.client_id === r.client_id && x.key === r.key);
        if (i >= 0 && !url.searchParams.has('on_conflict')) return json(409, { code: '23505', message: 'duplicate key' });
        const row = ganttRow(i >= 0 ? { ...db.client_gantt[i], ...r } : { id: randomUUID(), created_at: now, ...r }, me, now);
        if (i >= 0) db.client_gantt[i] = row; else db.client_gantt.push(row);
        out.push(row);
      } else {
        const row = { ...r, by_email: me.email, at: now };
        db[table].push(row);
        out.push(row);
      }
    }
    return reply(out);
  }
  if (req.method() === 'DELETE') {
    const rows = applyFilters(db[table], url.searchParams);
    db[table] = db[table].filter((r) => !rows.includes(r));
    return route.fulfill({ status: 204, headers: cors });
  }
  if (req.method() === 'PATCH') {
    const rows = applyFilters(db[table], url.searchParams);
    const out = [];
    for (const r of rows) {
      const row = table === 'client_gantt' ? ganttRow({ ...r, ...body }, me, now) : Object.assign(r, body);
      if (table === 'client_gantt') db.client_gantt[db.client_gantt.indexOf(r)] = row;
      out.push(row);
    }
    return reply(out);
  }
  return json(405, { message: `unexpected ${req.method()} on ${table}` });
}

// ── Browser ────────────────────────────────
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
async function newContext(viewport = { width: 1360, height: 960 }) {
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport });
  await ctx.clock.install({ time: NOW });
  await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', withClientColumns(fakeSupabase, CLIENT_SHAPE));
  return ctx;
}
async function newPage(ctx) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (msgx) => { if (msgx.type() === 'error' && !/Failed to load resource/.test(msgx.text())) errors.push(msgx.text()); });
  page.on('dialog', (d) => d.accept());
  open.add(page);
  page.on('close', () => open.delete(page));
  return page;
}
async function signIn(page, path, email) {
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', email);
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
}
const shot = async (page, name, fullPage = true) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage }); };
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const toastHas = (page, t) => page.waitForFunction((x) => document.querySelector('#toast.on')?.textContent.includes(x), t);
const smallTargets = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(`${s} button, ${s} a.btn, ${s} summary`)]
  .filter((el) => el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden').map((el) => [el.textContent.trim().slice(0, 30), Math.round(el.getBoundingClientRect().height)])
  .filter(([, hgt]) => hgt < 44), sel);
let passed = 0;
const open = new Set();
async function step(name, fn) {
  try {
    await fn();
  } catch (err) {
    // A failure leaves a picture of every page still open, when there is an out dir.
    if (OUT) for (const [i, pg] of [...open].entries()) await pg.screenshot({ path: `${OUT}/failed-${i}.png`, fullPage: true }).catch(() => {});
    console.log(`not ok - ${name}\n# toast: ${await [...open].at(-1)?.evaluate(() => document.getElementById('toast')?.textContent).catch(() => '')}`);
    throw err;
  }
  passed += 1;
  console.log(`ok - ${name}`);
}
const gantt = (c) => db.client_gantt.filter((r) => r.client_id === c.id);
const row = (c, key) => gantt(c).find((r) => r.key === key);

// The plan the template makes for Ron, to pick entries the steps use.
const plan = generatePlan(A).entries;
const novVideos = plan.filter((e) => e.kind === 'video' && e.day.startsWith('2026-11'));
const perDay = (d) => plan.filter((e) => e.day === d).length;
const posted = novVideos.find((e) => e.day < todayIL && perDay(e.day) <= 3);
const moved = novVideos.find((e) => e.day > todayIL && perDay(e.day) <= 3);
const target = '2026-11-26';
assert.ok(posted && moved, 'November has videos before and after the 12th');

// ── Ilai ──────────────────────────────────
const ictx = await newContext();
const ilai = await newPage(ictx);

await step('Ilai: no Gantt yet; the template\'s preview; he creates it, and it opens on November 2026 (month 8)', async () => {
  await signIn(ilai, `gantt.html?id=${A.id}`, 'ilai@astrateg.test');
  await ilai.waitForSelector('#gt-empty:not([hidden])');
  assert.match(await ilai.innerText('#ge-text'), new RegExp(`התבנית תיצור ${plan.length} פריטים, מהם \\d+ פרסומים, מ־25\\.3\\.2026 עד 15\\.3\\.2027`));
  assert.match(await ilai.innerText('#gt-sub'), /חוזה מ־15\.3\.2026 עד 15\.3\.2027 · חודש 8 מתוך 12/);
  await shot(ilai, 'gantt-01-empty');
  await ilai.click('#btn-create');
  await toastHas(ilai, `הגאנט נוצר: ${plan.length} פריטים`);
  assert.equal(gantt(A).length, plan.length);
  assert.equal(gantt(A).every((r) => r.by_email === 'ilai@astrateg.test' && r.edited === false), true);
  assert.equal(row(A, 'plan.9').internal, true);
  await ilai.waitForSelector('#gt-cal:not([hidden]) .gt-grid');
  assert.equal(await ilai.innerText('#gm-h'), 'נובמבר 2026');
  assert.equal(await ilai.innerText('#gm-pkg'), 'חודשים 8–9 בחבילה');
  assert.equal(await ilai.locator('#gm-pills .gt-pill').count(), 13);
  assert.equal(await ilai.locator('td.is-today').getAttribute('data-day'), todayIL);
  // The grid: Ron's November, the start of package month 9 on the 15th.
  assert.match(await ilai.innerText('td[data-day="2026-11-15"] .gt-pm'), /חודש 9/);
  const novCount = plan.filter((e) => e.day.startsWith('2026-11')).length;
  const chips = await ilai.locator('#gm-grid .gt-chip').count();
  const more = await ilai.locator('#gm-grid .gt-more').count();
  assert.ok(chips >= novCount - more * 3 && chips <= novCount, `${chips} chips of ${novCount}`);
  // Glance: a row per kind, 12 months, the current one marked.
  assert.equal(await ilai.locator('#gg-table thead th').count(), 13);
  assert.equal(await ilai.locator('#gg-table thead th.is-now').innerText(), '8\nאוק׳'); // month 8 starts 15.10
  assert.match(await ilai.innerText('#gg-table tbody'), /סרטונים[^]*גרפיקות/);
  // Stats: the posts of the year, none up yet, the ones past their time not marked.
  assert.match(await ilai.innerText('.st-posts'), /פרסומים בשנה\s*\d+/);
  assert.match(await ilai.innerText('.st-late'), /עברו ולא סומנו שעלו\s*[1-9]\d*/);
  assert.match(await ilai.innerText('#gt-legend'), /סרטון[^]*גרפיקה[^]*עלה/);
  await shot(ilai, 'gantt-02-month');
});

await step('he marks a video as posted, with its link and the client\'s file; it shows a tick', async () => {
  await ilai.click(`#gm-grid .gt-chip[data-key="${posted.key}"]`);
  await ilai.waitForSelector('#entry-dlg[open]');
  assert.equal(await ilai.innerText('#ed-h'), posted.title);
  // The files offered fit a video: not the logo, not the graphic.
  const options = await ilai.locator('#ed-file option').allInnerTexts();
  assert.deepEqual(options, ['בלי קובץ', 'סרטון 29 · רילס תספורת']);
  await ilai.locator('label.gt-seg-opt:has(input[value="posted"])').click();
  await ilai.fill('#ed-posted', posted.day);
  await ilai.selectOption('#ed-file', files[0].id);
  await ilai.fill('#ed-link', 'http://not-secure.example');
  await ilai.click('#ed-save');
  assert.match(await ilai.innerText('#ed-err'), /https/);
  await ilai.fill('#ed-link', '');
  await ilai.fill('#ed-note', 'עלה עם שיר טרנדי');
  await shot(ilai, 'gantt-03-dialog', false);
  await ilai.click('#ed-save');
  await toastHas(ilai, `סומן שעלה: ${posted.title}`);
  const r = row(A, posted.key);
  assert.deepEqual([r.state, r.posted_on, r.file_id, r.link, r.note, r.edited], ['posted', posted.day, files[0].id, null, 'עלה עם שיר טרנדי', false]);
  await ilai.waitForSelector(`#gm-grid .gt-chip.s-posted[data-key="${posted.key}"] .gt-tick`);
  assert.match(await ilai.innerText('.st-up'), /עלו\s*1/);
});

const hideToast = (page) => page.evaluate(() => document.getElementById('toast').classList.remove('on'));
// Both days on screen first: a drag that has to scroll is dropped by the browser.
const bothInView = (page) => page.evaluate(() => document.querySelector('td[data-day="2026-11-22"]').scrollIntoView({ block: 'center' }));
await step('he drags another video to the 26th: the same time, that day, kept as moved by hand (with an undo)', async () => {
  await hideToast(ilai); // the last toast sits over the grid
  await bothInView(ilai);
  await ilai.dragAndDrop(`#gm-grid .gt-chip[data-key="${moved.key}"]`, `td[data-day="${target}"]`);
  await toastHas(ilai, `${moved.title} הוזז ל`);
  let r = row(A, moved.key);
  assert.deepEqual([r.day, r.time_il, r.edited], [target, '19:00:00', true]);
  await ilai.waitForSelector(`td[data-day="${target}"] .gt-chip[data-key="${moved.key}"]`);
  await ilai.click('#toast .toast-act');
  await toastHas(ilai, 'ההזזה בוטלה');
  r = row(A, moved.key);
  assert.deepEqual([r.day, r.edited], [moved.day, false]);
  await bothInView(ilai);
  await ilai.dragAndDrop(`#gm-grid .gt-chip[data-key="${moved.key}"]`, `td[data-day="${target}"]`);
  await toastHas(ilai, `${moved.title} הוזז ל`);
  assert.equal(row(A, moved.key).day, target);
});

await step('he adds an entry of his own from a day: a custom key, moved by hand', async () => {
  await ilai.click('td[data-day="2026-11-24"] .gt-daynum');
  await ilai.waitForSelector('#gm-day:not([hidden])');
  await ilai.click('#gm-day button:has-text("הוספת פריט ביום הזה")');
  await ilai.waitForSelector('#entry-dlg[open]');
  assert.equal(await ilai.inputValue('#ed-day'), '2026-11-24');
  await ilai.selectOption('#ed-kindsel', 'graphic');
  await ilai.fill('#ed-title', 'גרפיקת בלאק פריידיי');
  await ilai.fill('#ed-time', '11:30');
  await ilai.click('#ed-save');
  await toastHas(ilai, 'נוסף: גרפיקת בלאק פריידיי');
  const r = gantt(A).find((x) => x.title === 'גרפיקת בלאק פריידיי');
  assert.match(r.key, /^custom\.\d+$/);
  assert.deepEqual([r.kind, r.day, r.time_il, r.edited, r.month], ['graphic', '2026-11-24', '11:30:00', true, 9]);
  await ilai.waitForSelector('#gm-day .gt-row:has-text("גרפיקת בלאק פריידיי")');
});

await step('"עדכון מהתבנית" after the package grew: 2 more videos, the moved date kept; confirmed, it goes back', async () => {
  A.deliverables = { ...A.deliverables, videos: 44 };
  await ilai.reload();
  await ilai.waitForSelector('#btn-regen');
  await ilai.click('#btn-regen');
  await ilai.waitForSelector('#regen-dlg[open]');
  const text = await ilai.innerText('#rg-body');
  assert.match(text, /יתווספו 2 פריטים/);
  assert.match(text, /פריט אחד הוזז ידנית, והוא|פריט אחד הוזז ידנית/);
  assert.match(text, /מה שעלה, קישורים, קבצים והערות לא משתנים/);
  await shot(ilai, 'gantt-04-regen', false);
  await ilai.click('#rg-go');
  await toastHas(ilai, 'הגאנט עודכן מהתבנית');
  assert.equal(gantt(A).filter((r) => r.kind === 'video').length, 44);
  assert.equal(row(A, moved.key).day === target || row(A, moved.key).edited, true, 'the moved date stays');
  assert.equal(row(A, posted.key).state, 'posted');
  assert.equal(gantt(A).some((r) => r.title === 'גרפיקת בלאק פריידיי'), true);
  const movedNow = row(A, moved.key);
  if (movedNow.edited) {
    await ilai.click('#btn-regen');
    await ilai.waitForSelector('#regen-dlg[open]');
    await ilai.check('#rg-overwrite');
    await ilai.click('#rg-go');
    await toastHas(ilai, 'הגאנט עודכן מהתבנית');
    const back = row(A, moved.key);
    const want = generatePlan(A).entries.find((e) => e.key === moved.key);
    assert.deepEqual([back.day, back.edited], [want.day, false]);
  }
  assert.equal(row(A, posted.key).note, 'עלה עם שיר טרנדי');
});

let shareLink = null;
await step('the client\'s link: created, copied again after a reload', async () => {
  await ilai.waitForSelector('#gs-create');
  await ilai.click('#gs-create');
  await toastHas(ilai, 'נוצר קישור ללקוח');
  shareLink = await ilai.inputValue('#gs-url');
  assert.match(shareLink, /gantt\.html\?t=[A-Za-z0-9_-]{43}$/);
  await ilai.reload();
  await ilai.waitForSelector('#gs-url');
  assert.equal(await ilai.inputValue('#gs-url'), shareLink);
  await shot(ilai, 'gantt-05-desktop-full');
});

await step('the list view and the year at a glance take you to a month', async () => {
  await ilai.click('#view-list');
  await ilai.waitForSelector('#gm-list:not([hidden]) .gt-aday');
  const first = ilai.locator(`#gm-list .gt-row[data-key="${posted.key}"]`);
  assert.match(await first.innerText(), /עלה/);
  assert.equal(await first.locator('a.gt-open').getAttribute('href'), 'https://www.instagram.com/reel/ron29');
  await ilai.click('#gg-table thead th:nth-child(3) .gg-month'); // month 2
  await ilai.waitForFunction(() => document.getElementById('gm-h').textContent === 'אפריל 2026');
  await ilai.click('#view-grid');
});

await step('the print view: the month on one page, every chip, without the page around it', async () => {
  await ilai.click('#gm-pills .gt-pill[aria-label="נובמבר 2026"]');
  await ilai.emulateMedia({ media: 'print' });
  await ilai.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  assert.equal(await ilai.isVisible('.gt-print-head'), true);
  assert.equal(await ilai.isVisible('.gt-hero'), false);
  assert.equal(await ilai.locator('#gm-grid .gt-more').count(), 0);
  await shot(ilai, 'gantt-06-print');
  await ilai.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await ilai.emulateMedia({ media: 'screen' });
});
await ictx.close();

// ── The client ────────────────────────────
await step('the client opens the link without signing in: dates, what went up and its link; nothing internal', async () => {
  const cctx = await newContext();
  const page = await newPage(cctx);
  await page.goto(shareLink);
  await page.waitForSelector('#gt-cal:not([hidden]) .gt-grid');
  assert.equal(await page.isVisible('#staff-nav'), false);
  assert.equal(await page.isVisible('#login-block'), false);
  assert.match(await page.innerText('#gt-title'), /גאנט התוכן · מספרת רון בע״מ/);
  const all = await page.innerText('body');
  for (const secret of ['תכנון חודש', 'שיחת חידוש', 'עלה עם שיר טרנדי', 'הערה של המשרד', 'עדכון מהתבנית', 'הוספת פריט', 'עברו ולא סומנו']) assert.ok(!all.includes(secret), secret);
  assert.equal(await page.locator('#btn-regen, #btn-add, #gt-share:not([hidden])').count(), 0);
  await page.click(`#gm-grid .gt-chip[data-key="${posted.key}"]`);
  await page.waitForSelector('#entry-dlg[open]');
  assert.equal(await page.getAttribute('#entry-dlg a.gt-open-big', 'href'), 'https://www.instagram.com/reel/ron29');
  assert.equal(await page.locator('#entry-dlg input, #entry-dlg select').count(), 0);
  await page.click('#ed-close');
  await shot(page, 'gantt-07-client-desktop');
  await cctx.close();
  // On a phone.
  const pctx = await newContext({ width: 360, height: 780 });
  const ph = await newPage(pctx);
  await ph.goto(shareLink);
  await ph.waitForSelector('#gm-list:not([hidden]) .gt-aday');
  assert.equal(await noHScroll(ph), true);
  await shot(ph, 'gantt-08-client-360');
  await ph.goto(`${BASE}gantt.html?t=not-a-token`);
  await ph.waitForSelector('#closed:not([hidden])');
  assert.match(await ph.innerText('#closed'), /הקישור לא תקין/);
  await pctx.close();
});

// ── Nadia, Anna ───────────────────────────
await step('the client\'s editor reads the Gantt and nothing more; an editor without the client has no access', async () => {
  const nctx = await newContext();
  const nadia = await newPage(nctx);
  await signIn(nadia, `gantt.html?id=${A.id}`, 'nadia@astrateg.test');
  await nadia.waitForSelector('#gt-cal:not([hidden]) .gt-grid');
  assert.equal(await nadia.locator('#btn-regen, #btn-add').count(), 0);
  assert.equal(await nadia.isVisible('#gt-share'), false);
  assert.equal(await nadia.locator('.gt-chip[draggable="true"]').count(), 0);
  await nadia.click(`#gm-grid .gt-chip[data-key="${posted.key}"]`);
  await nadia.waitForSelector('#entry-dlg[open]');
  assert.equal(await nadia.locator('#entry-dlg input').count(), 0);
  assert.match(await nadia.innerText('#entry-dlg'), /עלה עם שיר טרנדי/); // the team sees the internal note
  await nctx.close();
  const actx = await newContext();
  const anna = await newPage(actx);
  await signIn(anna, `gantt.html?id=${A.id}`, 'anna@astrateg.test');
  await anna.waitForSelector('#no-access:not([hidden])');
  await actx.close();
});

// ── The links to the page ─────────────────
await step('the client card links to the Gantt, and so do processes 9, 28 and 29', async () => {
  const octx = await newContext();
  const irit = await newPage(octx);
  await signIn(irit, `client.html?id=${A.id}`, 'irit@astrateg.test');
  await irit.waitForSelector('#cc-gantt');
  assert.equal(await irit.getAttribute('#cc-gantt', 'href'), `gantt.html?id=${A.id}`);
  assert.equal(await irit.getAttribute('#p29 a.gantt-go', 'href'), `gantt.html?id=${A.id}`);
  await irit.click('#cc-gantt');
  await irit.waitForSelector('#gt-cal:not([hidden])');
  await octx.close();
  // Ilai's "הגאנט מלא" card in "מה עליי" (process 29).
  const ictx2 = await newContext();
  const il = await newPage(ictx2);
  await signIn(il, 'clients.html#mine', 'ilai@astrateg.test');
  await il.waitForSelector(`.il-card[data-key^="il-gantt:${A.id}"] a.gantt-go`);
  assert.equal(await il.getAttribute(`.il-card[data-key^="il-gantt:${A.id}"] a.gantt-go`, 'href'), `gantt.html?id=${A.id}`);
  await shot(il, 'gantt-12-ilai-mine', false);
  await ictx2.close();
});

// ── Phones ────────────────────────────────
await step('a 360px phone: the list first, the grid with dots, a tapped day below; no sideways scrolling, 44px targets', async () => {
  const pctx = await newContext({ width: 360, height: 780 });
  const ph = await newPage(pctx);
  await signIn(ph, `gantt.html?id=${A.id}`, 'ilai@astrateg.test');
  await ph.waitForSelector('#gm-list:not([hidden]) .gt-aday');
  assert.equal(await noHScroll(ph), true);
  assert.deepEqual(await smallTargets(ph, '#gm-list'), []);
  assert.deepEqual(await smallTargets(ph, '.gt-monthbar'), []);
  assert.deepEqual(await smallTargets(ph, '#gt-actions'), []);
  await shot(ph, 'gantt-09-phone-list');
  await ph.click('#view-grid');
  await ph.waitForSelector('#gm-grid:not([hidden]) .gt-dot');
  assert.equal(await noHScroll(ph), true);
  assert.equal(await ph.isVisible('#gm-grid .gt-chip'), false);
  await ph.click(`td[data-day="${posted.day}"] .gt-daynum`);
  await ph.waitForSelector(`#gm-day .gt-row[data-key="${posted.key}"]`);
  await shot(ph, 'gantt-10-phone-grid');
  await ph.click(`#gm-day .gt-row[data-key="${posted.key}"] .gt-row-main`);
  await ph.waitForSelector('#entry-dlg[open]');
  assert.equal(await noHScroll(ph), true);
  await shot(ph, 'gantt-11-phone-dialog', false);
  await pctx.close();
});

await browser.close();
assert.deepEqual(errors, [], `browser errors: ${errors.join('\n')}`);
console.log(`\n${passed} passed`);
