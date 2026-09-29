// End-to-end check of the handoff buttons (app/handoffs.js, app/handoff-ui.js):
// checking a handoff item in "מה עליי" or in the client card offers a ready
// WhatsApp message to the next person, with their number when the team page has
// it; opening WhatsApp is recorded in the card, never sent by the system.
// Against an in-memory fake of Supabase; the page clock is Tuesday 20.10.2026
// 11:00 in Jerusalem (the card is also opened on a phone set to New York time).
// Run: npx http-server -p 8080 -s . &  then  node tests/handoffs-e2e.mjs [outDir]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
const NOW = new Date('2026-10-20T08:00:00Z'); // Tuesday 11:00 in Jerusalem
const skew = NOW.getTime() - Date.now();      // the fake server follows the page clock
const serverNow = () => new Date(Date.now() + skew).toISOString();
const hoursAgo = (n) => new Date(NOW - n * 36e5).toISOString();

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const USER = { id: randomUUID(), email: 'ofir@astrateg.test', aud: 'authenticated', role: 'authenticated' };
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, email: USER.email, role: 'authenticated', exp: Math.floor(NOW / 1000) + 86400 })}.sig`;

// Fake numbers (the repository is public: nothing real here). Lior has none yet.
const db = {
  staff: [
    { email: USER.email, person: 'ofir', vault: false, phone: '972500000003' },
    { email: 'irit@astrateg.test', person: 'irit', vault: true, phone: '972500000001' },
    { email: 'ilai@astrateg.test', person: 'ilai', vault: false, phone: '972500000004' },
    { email: 'lior@astrateg.test', person: 'lior', vault: true, phone: null },
    { email: 'owner@astrateg.test', person: null, vault: true, phone: '972500000009' },
  ],
  quotes: [], clients: [], protocol_checks: [], protocol_log: [], client_tasks: [], office_reviews: [], client_status_notes: [], client_access: [],
};
const base = {
  business: null, phone: null, package_name: null, shoot_type: 'dms', characterizer: 'ofir', has_logo: true, editor_name: null, editor: null,
  shoot_at: null, contract_end: '2027-10-01', status: 'active', notes: null, quote_id: null, address: null,
  created_by_email: 'irit@astrateg.test', links: {}, deliverables: {}, rounds: [], verified_at: null, verified_by: null, closed_reason: null,
};
const client = (o) => { const c = { ...base, id: randomUUID(), created_at: o.deal_at, ...o }; db.clients.push(c); return c; };
const check = (c, key, when, by = USER.email) => {
  db.protocol_checks.push({ client_id: c.id, item_key: key, state: 'done', note: null, by_email: by, at: when });
  db.protocol_log.push({ id: db.protocol_log.length + 1, client_id: c.id, item_key: key, action: 'done', note: null, by_email: by, at: when });
};
const P4 = ['p04.address', 'p04.phone', 'p04.services', 'p04.audiences', 'p04.advantages', 'p04.goals', 'p04.offers', 'p04.content', 'p04.graphics', 'p04.campaigns', 'p04.special', 'p04.saved'];
// Characterized this morning: the access is Ofir's to hand to Ilai.
const ron = client({ name: 'מספרת רון', deal_at: hoursAgo(50), char_at: hoursAgo(2) });
for (const k of P4) check(ron, k, hoursAgo(1));
// Videos checked by Ofir, ready for his approval: Irit sends, Lior builds the campaign.
const pizza = client({ name: 'פיצה נאפולי', deal_at: hoursAgo(200), char_at: hoursAgo(190), shoot_at: hoursAgo(100) });
for (const k of ['editing', 'errors', 'clear', 'match', 'pro', 'fit']) check(pizza, `p25.q.${k}`, hoursAgo(1));
// A third client for the card.
const cafe = client({ name: 'קפה גליה', deal_at: hoursAgo(50), char_at: hoursAgo(2) });
for (const k of P4) check(cafe, k, hoursAgo(1));

const checksOf = (c) => db.protocol_checks.filter((x) => x.client_id === c.id);
const hasCheck = (c, key) => checksOf(c).some((x) => x.item_key === key && x.state === 'done');

function applyFilters(rows, params) {
  let out = rows;
  for (const [k, v] of params) {
    if (['select', 'order', 'offset', 'limit', 'on_conflict', 'columns'].includes(k)) continue;
    if (v.startsWith('eq.')) out = out.filter((r) => String(r[k]) === v.slice(3));
    else if (v.startsWith('neq.')) out = out.filter((r) => String(r[k]) !== v.slice(4));
    else if (v.startsWith('gte.')) out = out.filter((r) => String(r[k]) >= v.slice(4));
    else if (v.startsWith('in.(')) { const set = new Set(v.slice(4, -1).split(',').map((x) => x.replace(/^"|"$/g, ''))); out = out.filter((r) => set.has(String(r[k]))); }
    else if (v.startsWith('like.')) { const tail = v.slice(5).replace(/^%/, ''); out = out.filter((r) => String(r[k]).endsWith(tail)); }
    else if (v === 'is.null') out = out.filter((r) => r[k] === null || r[k] === undefined);
    else if (v === 'not.is.null') out = out.filter((r) => r[k] !== null && r[k] !== undefined);
  }
  return out;
}

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
  if (p === '/auth/v1/token') {
    if (body.password !== 'correct-horse') return json(400, { error: 'invalid_grant', msg: 'Invalid login credentials', code: 'invalid_credentials' });
    return json(200, { access_token: JWT, token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(NOW / 1000) + 86400, refresh_token: 'r', user: USER });
  }
  if (p === '/auth/v1/user') return json(200, USER);
  if (p === '/auth/v1/logout') return route.fulfill({ status: 204 });
  const authed = (headers.authorization || '').includes(JWT);
  if (p === '/rest/v1/rpc/is_staff') return json(200, authed);
  if (p === '/rest/v1/rpc/can_use_vault') return json(200, false);
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m || !db[m[1]]) return json(404, { message: 'not found' });
  if (!authed) return json(401, { message: 'permission denied' });
  const table = m[1];
  const single = (headers.accept || '').includes('vnd.pgrst.object');
  const reply = (rows) => (single ? (rows.length ? json(200, rows[0]) : json(406, { message: 'no rows' })) : json(200, rows));
  const now = serverNow();
  if (req.method() === 'GET') {
    let rows = applyFilters(db[table], url.searchParams);
    if (table === 'protocol_log') rows = [...rows].reverse();
    const off = Number(url.searchParams.get('offset') || 0);
    const lim = Number(url.searchParams.get('limit') || 1e9);
    return reply(rows.slice(off, off + lim));
  }
  if (req.method() === 'POST' && table === 'protocol_checks') {
    const out = [];
    for (const r of Array.isArray(body) ? body : [body]) {
      const row = { ...r, by_email: USER.email, at: now };
      const i = db.protocol_checks.findIndex((x) => x.client_id === r.client_id && x.item_key === r.item_key);
      if (i >= 0) db.protocol_checks[i] = row; else db.protocol_checks.push(row);
      db.protocol_log.push({ id: db.protocol_log.length + 1, client_id: r.client_id, item_key: r.item_key, action: r.state, note: r.note, by_email: USER.email, at: now });
      out.push(row);
    }
    return reply(out);
  }
  if (req.method() === 'DELETE' && table === 'protocol_checks') {
    const rows = applyFilters(db.protocol_checks, url.searchParams);
    db.protocol_checks = db.protocol_checks.filter((r) => !rows.includes(r));
    for (const r of rows) db.protocol_log.push({ id: db.protocol_log.length + 1, client_id: r.client_id, item_key: r.item_key, action: 'clear', note: null, by_email: USER.email, at: now });
    return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  }
  return json(405, { message: 'not in this fake' });
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
const opened = [];   // wa.me addresses that WhatsApp was asked to open
async function newPage({ timezoneId = 'Asia/Jerusalem', viewport = { width: 1280, height: 900 } } = {}) {
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId, viewport });
  await ctx.clock.install({ time: NOW });
  await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', fakeSupabase);
  // WhatsApp itself is never reached: the test only sees what it would have opened.
  await ctx.route('https://wa.me/**', (route) => { opened.push(route.request().url()); return route.fulfill({ status: 200, contentType: 'text/html', body: '<p>wa</p>' }); });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
  return page;
}
async function signIn(page, path) {
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', USER.email);
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForSelector('#app:not([hidden])');
}
const shot = async (page, name) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false }); };
const text = (page, sel) => page.locator(sel).innerText();
const toastHas = (page, s) => page.waitForFunction((x) => document.querySelector('#toast.on')?.textContent.includes(x), s);
const waText = (href) => decodeURIComponent(href.split('?text=')[1]);
const until = async (fn, what) => { for (let i = 0; i < 100; i += 1) { if (fn()) return; await new Promise((r) => setTimeout(r, 50)); } assert.fail(`timed out: ${what}`); };
let passed = 0;
async function step(name, fn) {
  try { await fn(); } catch (err) { console.error(`not ok - ${name}\n  page errors: ${JSON.stringify(errors)}`); throw err; }
  passed += 1;
  console.log(`ok - ${name}`);
}

// ── "מה עליי" ─────────────────────────────
const page = await newPage();
await step('checking the access item in "מה עליי" offers "לשלוח לעילאי" with a ready message', async () => {
  await signIn(page, 'clients.html');
  const cbx = `#w-${ron.id}-p05_access`;
  await page.waitForSelector(cbx);
  assert.equal(await page.locator('#handoff').isHidden(), true, 'nothing offered before a check');
  await page.click(cbx);
  await toastHas(page, 'סומן כבוצע');
  await page.waitForSelector('#handoff:not([hidden]) a.handoff-wa');
  assert.ok(hasCheck(ron, 'p05.access'));
  assert.match(await text(page, '#handoff'), /העברה הלאה · מספרת רון[\s\S]*גישות התקבלו · עילאי[\s\S]*יעד: היום 11:30/);
  const link = page.locator('#handoff a.handoff-wa');
  assert.equal((await link.innerText()).split('\n')[0].trim(), 'לשלוח לעילאי בוואטסאפ');
  const href = await link.getAttribute('href');
  assert.ok(href.startsWith('https://wa.me/972500000004?text='), href.slice(0, 40));
  assert.equal(waText(href), [
    'היי עילאי,',
    'גישות התקבלו למספרת רון. יש לך 30 דק׳ לבדוק אותן מהכספת במערכת ולסדר את העמודים.',
    'יעד: היום 11:30',
    `כרטיס הלקוח: ${BASE}client.html?id=${ron.id}#p06`,
  ].join('\n'));
  assert.equal(await link.getAttribute('target'), '_blank');
  assert.equal(await page.locator('#handoff .handoff-nophone').count(), 0);
  // The undo toast is still there, next to the prompt.
  assert.match(await text(page, '#toast'), /ביטול/);
  await page.waitForFunction(() => /אפשר לשלוח לעילאי בוואטסאפ/.test(document.getElementById('handoff-say')?.textContent || ''));
  await shot(page, 'handoff-01-mine');
});

await step('opening WhatsApp is recorded in the card, and nothing is sent by the system', async () => {
  const popup = page.context().waitForEvent('page');
  await page.click('#handoff a.handoff-wa');
  const wa = await popup;
  await until(() => hasCheck(ron, 'p05.handoff.ilai'), 'the handoff record');
  assert.ok(opened.at(-1).startsWith('https://wa.me/972500000004?text='));
  await wa.close();
  await page.waitForFunction(() => /נפתח\. לשלוח שוב לעילאי/.test(document.querySelector('#handoff a.handoff-wa')?.textContent || ''));
  assert.equal(db.protocol_log.filter((r) => r.item_key === 'p05.handoff.ilai').length, 1);
  await page.click('#handoff-close');
  await page.waitForSelector('#handoff', { state: 'hidden' });
});

await step('Ofir approves the videos: Irit (with her number) and Lior (none yet: a hint to add it)', async () => {
  await page.click(`#w-${pizza.id}-p25_approved`);
  await page.waitForSelector('#handoff:not([hidden]) .handoff-row + .handoff-row');
  const rows = page.locator('#handoff .handoff-row');
  assert.match(await rows.nth(0).innerText(), /אופיר אישר את הסרטונים · עירית[\s\S]*יעד: מיד[\s\S]*לשלוח לעירית בוואטסאפ/);
  assert.match(await rows.nth(1).innerText(), /ליאור[\s\S]*לשלוח לליאור בוואטסאפ/);
  const irit = await rows.nth(0).locator('a.handoff-wa').getAttribute('href');
  assert.ok(irit.startsWith('https://wa.me/972500000001?text='));
  assert.match(waText(irit), /^היי עירית,\nאופיר אישר את הסרטונים של פיצה נאפולי\. לשלוח אותם ללקוח לאישור\.\nיעד: מיד\n/);
  const lior = await rows.nth(1).locator('a.handoff-wa').getAttribute('href');
  assert.ok(lior.startsWith('https://wa.me/?text='), 'no number: WhatsApp asks whom to send to');
  assert.match(waText(lior), new RegExp(`^היי ליאור,\\n.*קמפיין\\.\\nיעד: סוף יום ד׳ 21\\.10\\nכרטיס הלקוח: .*client\\.html\\?id=${pizza.id}#p30$`));
  assert.match(await rows.nth(1).innerText(), /אין במערכת מספר וואטסאפ של ליאור[\s\S]*מוסיפים מספר בעמוד הצוות/);
  assert.equal(await rows.nth(1).locator('.handoff-nophone a').getAttribute('href'), 'team.html');
  await shot(page, 'handoff-02-two');
});

await step('undoing the check leaves nothing to hand off', async () => {
  await page.click('#toast .toast-act');
  await toastHas(page, 'הסימון בוטל');
  assert.equal(hasCheck(pizza, 'p25.approved'), false);
  const before = opened.length;
  await page.click('#handoff .handoff-row >> nth=0 >> a.handoff-wa');
  await toastHas(page, 'אין מה להעביר');
  await page.waitForSelector('#handoff', { state: 'hidden' });
  assert.equal(hasCheck(pizza, 'p25.handoff.irit'), false, 'nothing recorded');
  await page.waitForTimeout(200);
  assert.equal(opened.length, before, 'WhatsApp was not opened');
});

// ── The client card, on a phone set to New York time ──
const card = await newPage({ timezoneId: 'America/New_York', viewport: { width: 360, height: 780 } });
await step('in the card: the prompt and the "העברות" line, on Israel time on any device', async () => {
  await signIn(card, `client.html?id=${cafe.id}`);
  await card.waitForSelector('#i-p05-access');
  assert.equal(await card.locator('#p05 .handoff-line').count(), 0, 'no line before the handoff');
  await card.click('label[for="i-p05-access"]');
  await card.waitForSelector('#handoff:not([hidden]) a.handoff-wa');
  // 04:00 in New York is 11:00 in the office: the due time is the office's.
  assert.match(await text(card, '#handoff'), /יעד: היום 11:30/);
  const href = await card.getAttribute('#handoff a.handoff-wa', 'href');
  assert.ok(href.startsWith('https://wa.me/972500000004?text='));
  assert.match(waText(href), new RegExp(`\\nיעד: היום 11:30\\nכרטיס הלקוח: ${BASE.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}client\\.html\\?id=${cafe.id}#p06$`));
  await card.waitForSelector('#p05 .handoff-line');
  assert.match(await text(card, '#p05 .handoff-line'), /העברות:[\s\S]*גישות התקבלו → עילאי[\s\S]*וואטסאפ עוד לא נפתח[\s\S]*לשלוח לעילאי בוואטסאפ/);
  assert.equal(await card.getAttribute('#hl-p05-handoff-ilai', 'href'), href);
  assert.ok(await card.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), 'no sideways scrolling at 360px');
  const box = await card.locator('#handoff a.handoff-wa').boundingBox();
  assert.ok(box.height >= 44, `touch target ${box.height}px`);
  await shot(card, 'handoff-03-card-phone');
});

await step('keyboard: Escape closes the prompt and focus goes back to the checkbox', async () => {
  await card.focus('#i-p05-access');
  await card.focus('#handoff a.handoff-wa');
  await card.keyboard.press('Escape');
  await card.waitForSelector('#handoff', { state: 'hidden' });
  assert.equal(await card.evaluate(() => document.activeElement?.id), 'i-p05-access');
});

await step('the line records who opened WhatsApp; the history says so', async () => {
  const popup = card.context().waitForEvent('page');
  await card.click('#hl-p05-handoff-ilai');
  await (await popup).close();
  await until(() => hasCheck(cafe, 'p05.handoff.ilai'), 'the handoff record');
  await card.waitForFunction(() => /וואטסאפ נפתח · אופיר/.test(document.querySelector('#p05 .handoff-line')?.textContent || ''));
  assert.match(await text(card, '#p05 .handoff-line'), /לשלוח שוב לעילאי/);
  await card.waitForFunction(() => /פתח\/ה וואטסאפ להעברה: גישות התקבלו → עילאי/.test(document.querySelector('#hist-list')?.textContent || ''));
});

await step('unchecking the item takes the prompt away', async () => {
  const settled = (on) => card.waitForFunction((x) => document.querySelector('#i-p05-access')?.checked === x && !document.querySelector('.is-busy'), on);
  await card.click('label[for="i-p05-access"]');
  await settled(false);
  await card.click('label[for="i-p05-access"]');
  await settled(true);
  await card.waitForSelector('#handoff:not([hidden])');
  assert.match(await text(card, '#handoff'), /נפתח\. לשלוח שוב לעילאי/, 'already opened once: says so');
  await card.click('label[for="i-p05-access"]');
  await settled(false);
  await card.waitForSelector('#handoff', { state: 'hidden' });
  assert.equal(hasCheck(cafe, 'p05.access'), false);
  assert.equal(await card.locator('#p05 .handoff-line').count(), 1, 'the record of the handoff stays in the card');
});

await browser.close();
assert.deepEqual(errors, []);
console.log(`handoffs-e2e: ${passed} passed`);
