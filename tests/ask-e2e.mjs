// "שאלו את המערכת" and "משיכת קישורים מהדרייב" in the browser (the owner, 29.10.2026; docs/ops.md,
// section 74), against an in-memory fake of Supabase whose ask function answers like the real one
// (the real app/ask-logic.js decides who asks; the model is faked) and whose drive function lists
// a fake Drive folder:
//   - the owner, Lior and Ofir have "שאלו את המערכת" in the menu and the page; Irit, Ilai and an
//     editor have neither (the page says "אין לך גישה");
//   - Lior types a question key by key (and deletes a word), sends it: the busy bubble, then the
//     answer; a chip with "<לקוח>" selects the slot for the name; the AI not configured says so;
//   - Ilai in a client's Gantt presses "משיכת קישורים מהדרייב": the empty items get their links,
//     the one with a link keeps it, and the summary says "קושרו", "כבר היה קישור", "לא שובצו";
//   - Chromium at 1280 and 390, and an iPhone 13 (WebKit): nothing scrolls sideways, 44px targets.
// Run: npx http-server -p 8393 -s -c-1 . &  then
//      BASE_URL=http://localhost:8393/ node tests/ask-e2e.mjs [outDir]
import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import { withClientColumns } from './fake-clients.mjs';
import { mayAsk, cleanQuestion } from '../app/ask-logic.js';

const BASE = process.env.BASE_URL || 'http://localhost:8393/';
const OUT = process.argv[2] || null;
if (OUT) mkdirSync(OUT, { recursive: true });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
// Thursday 12.11.2026, 10:00 in Jerusalem.
const NOW = new Date('2026-11-12T08:00:00Z');
const skew = NOW.getTime() - Date.now();
const serverNow = () => new Date(Date.now() + skew).toISOString();

const PEOPLE = { owner: null, lior: 'lior', ofir: 'ofir', irit: 'irit', ilai: 'ilai', nadia: 'nadia' };
const OFFICE = new Set(['irit', 'lior', 'ofir', 'ilai']);
const users = new Map();
const staff = [];
for (const [k, person] of Object.entries(PEOPLE)) {
  const email = `${k}@astrateg.test`;
  users.set(email, { id: randomUUID(), email, aud: 'authenticated', role: 'authenticated', email_confirmed_at: NOW.toISOString() });
  staff.push({ email, person, vault: false, phone: null });
}
const EXP = Math.floor(NOW / 1000) + 3 * 3600;
const jwtFor = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp: EXP })}.sig`;
const sessionFor = (u) => ({ access_token: jwtFor(u), token_type: 'bearer', expires_in: 3 * 3600, expires_at: EXP, refresh_token: `r-${u.id}`, user: u });
const userOf = (headers) => {
  const token = /^Bearer (.+)$/.exec(headers.authorization || '')?.[1];
  return [...users.values()].find((u) => jwtFor(u) === token) || null;
};
const personOf = (u) => staff.find((s) => s.email === u?.email)?.person;
const isStaff = (u) => !!u && staff.some((s) => s.email === u.email);
const isOffice = (u) => isStaff(u) && (personOf(u) === null || OFFICE.has(personOf(u)));
const canEditGantt = (u) => isStaff(u) && (personOf(u) === null || ['ilai', 'irit'].includes(personOf(u)));

// One client, signed 15.3.2026 for a year, with its Drive folder and a November in the Gantt.
const CLIENT = {
  id: randomUUID(), name: 'רון כהן', business: 'מספרת רון', address: null, phone: '050-0000000', package_name: 'Social · נטלי', shoot_type: 'natali',
  characterizer: 'ofir', has_logo: true, editor_name: null, editor: 'nadia', editor2: null, deal_at: '2026-03-15T08:00:00Z', char_at: null,
  shoot_at: '2026-03-25T08:00:00Z', contract_end: '2027-03-15', status: 'active', notes: null, quote_id: null, created_at: '2026-03-15T08:00:00Z',
  created_by_email: 'irit@astrateg.test', links: { drive: 'https://drive.google.com/drive/folders/1RonFolder0000' },
  deliverables: { videos: 36, graphics: 36, shoot_days: 1 }, rounds: [], verified_at: null, verified_by: null, closed_reason: null, protocol_version: 11,
  metricool_blog_id: null, metricool_brand: null, metricool_none: false, archived_at: null, landing: false,
};
const g = (day, kind, title, extra = {}) => ({
  id: randomUUID(), client_id: CLIENT.id, key: `t.${kind}.${day}`, kind, title, day, time_il: null, month: 8, num: 1, internal: false, state: 'planned',
  posted_on: null, file_id: null, link: null, note: null, edited: false, template_version: 3, by_email: null, at: null, ...extra,
});
let gantt = [];
const resetGantt = () => {
  gantt = [
    g('2026-11-15', 'video', 'סרטון 1'),
    g('2026-11-15', 'graphic', 'גרפיקה 1'),
    g('2026-11-17', 'video', 'סרטון 2', { link: 'https://drive.google.com/file/d/already/view' }),
    g('2026-11-19', 'video', 'סרטון 3'),
    g('2026-11-25', 'video', 'סרטון 4'),
  ];
};
resetGantt();
const DRIVE_FILES = [
  { name: '15.11 רילס מבצע.mp4', mimeType: 'video/mp4', createdTime: '2026-11-10T10:00:00Z', link: 'https://drive.google.com/file/d/f1/view', path: '' },
  { name: '15.11 גרפיקה.png', mimeType: 'image/png', createdTime: '2026-11-10T10:00:00Z', link: 'https://drive.google.com/file/d/f2/view', path: 'גרפיקות' },
  { name: '17.11 גרסה חדשה.mp4', mimeType: 'video/mp4', createdTime: '2026-11-11T10:00:00Z', link: 'https://drive.google.com/file/d/f3/view', path: '' },
  { name: '19-11 טיזר.mov', mimeType: 'video/quicktime', createdTime: '2026-11-11T10:00:00Z', link: 'https://drive.google.com/file/d/f4/view', path: '' },
  { name: 'לוגו סופי.png', mimeType: 'image/png', createdTime: '2026-11-01T10:00:00Z', link: 'https://drive.google.com/file/d/f5/view', path: '' },
];

const calls = [];
let aiMode = 'ok';
// The ask function: the server's own rule (mayAsk), then a model answer.
async function askFn(body, me, json) {
  calls.push({ ask: body });
  if (!me) return json(401, { error: 'not_signed_in' });
  if (!mayAsk({ office: isOffice(me), person: personOf(me) ?? null })) return json(403, { error: 'not_allowed' });
  const q = cleanQuestion(body?.question);
  if (q.error) return json(400, { error: q.error });
  if (aiMode === 'not-configured') return json(503, { error: 'ai_not_configured' });
  await new Promise((r) => setTimeout(r, 400));
  if (/דרייב/.test(q.text)) return json(200, { answer: 'בתיקייה של מספרת רון יש 3 סרטונים ו־2 גרפיקות. האחרון: 19-11 טיזר.mov\nhttps://drive.google.com/file/d/f4/view', model: 'claude-sonnet-5-5', tools: ['drive_files'] });
  return json(200, { answer: 'יש 12 לקוחות פעילים: 10 פעילים ו־2 מסיימים התקשרות.', model: 'claude-sonnet-5-5', tools: ['find_clients'] });
}
function driveFn(body, me, json) {
  calls.push({ drive: body });
  if (!me) return json(401, { error: 'not_signed_in' });
  if (!canEditGantt(me)) return json(403, { error: 'not_allowed' });
  if (body?.client_id !== CLIENT.id) return json(404, { error: 'no_client' });
  return json(200, { files: DRIVE_FILES, truncated: false });
}

async function fakeSupabase(route) {
  const req = route.request();
  const url = new URL(req.url());
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  const json = (status, data) => route.fulfill({
    status, contentType: 'application/json', body: JSON.stringify(data),
    headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' },
  });
  if (req.method() === 'OPTIONS') return json(200, {});
  const p = url.pathname;
  const me = userOf(req.headers());
  if (p === '/auth/v1/token') {
    const u = users.get(String(body?.email || '').toLowerCase());
    if (!u || body.password !== 'correct-horse') return json(400, { error: 'invalid_grant', msg: 'Invalid login credentials' });
    return json(200, sessionFor(u));
  }
  if (p === '/auth/v1/user') return me ? json(200, me) : json(401, { msg: 'invalid JWT' });
  if (p === '/auth/v1/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  if (p === '/functions/v1/ask') return askFn(body, me, json);
  if (p === '/functions/v1/drive') return driveFn(body, me, json);
  if (p.startsWith('/rest/v1/rpc/')) {
    const name = p.slice('/rest/v1/rpc/'.length);
    if (name === 'is_staff') return json(200, isStaff(me));
    if (name === 'is_office') return json(200, isOffice(me));
    if (name === 'my_person') return json(200, personOf(me) ?? null);
    if (name === 'can_edit_gantt') return json(200, canEditGantt(me));
    if (name === 'metricool_settings') return json(200, null);
    return json(200, []);
  }
  if (!me) return json(401, { message: 'permission denied' });
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m) return json(404, { message: 'not found' });
  const one = (req.headers().accept || '').includes('vnd.pgrst.object');
  const many = (rows) => (one ? (rows.length ? json(200, rows[0]) : json(406, { code: 'PGRST116' })) : json(200, rows));
  const eq = (k) => url.searchParams.get(k)?.replace(/^eq\./, '');
  if (m[1] === 'staff') {
    const e = url.searchParams.get('email');
    return many(e?.startsWith('eq.') ? staff.filter((s) => s.email === e.slice(3)) : staff);
  }
  if (m[1] === 'clients') {
    const seen = isOffice(me) || (personOf(me) === CLIENT.editor);
    const id = eq('id');
    return many(seen && (!id || id === CLIENT.id) ? [CLIENT] : []);
  }
  if (m[1] === 'client_gantt') {
    if (req.method() === 'PATCH') {
      if (!canEditGantt(me)) return json(200, []);
      const id = eq('id');
      const onlyEmpty = /link\.is\.null/.test(url.searchParams.get('or') || '');
      const out = [];
      gantt = gantt.map((r) => {
        if (r.id !== id || (onlyEmpty && r.link)) return r;
        const nr = { ...r, ...body };
        out.push(nr);
        return nr;
      });
      calls.push({ patch: { id, body, onlyEmpty } });
      return many(out);
    }
    return many(eq('client_id') === CLIENT.id ? gantt : []);
  }
  return many([]);
}

const errors = [];
const watch = (page) => {
  page.setDefaultTimeout(9000);
  // WebKit reports a request cut short by leaving the page as "due to access control checks".
  page.on('pageerror', (e) => { if (!/due to access control checks/.test(String(e))) errors.push(String(e)); });
  watchCsp(page);
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource|due to access control checks/.test(msg.text())) errors.push(msg.text()); });
};
async function newPage(browser, options) {
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', ...options });
  await ctx.clock.install({ time: new Date(serverNow()) });
  await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', withClientColumns(fakeSupabase, { clients: () => [CLIENT], staff: () => staff }));
  const page = await ctx.newPage();
  watch(page);
  return { page, ctx };
}
// The Gantt of the client, signed in on the clients list first (as from the app's menu).
async function openGantt(page, who) {
  await signIn(page, who, 'clients.html');
  await page.waitForFunction(() => !document.getElementById('app')?.hidden);
  await page.goto(`${BASE}gantt.html?id=${CLIENT.id}&m=2026-11`);
}
async function signIn(page, who, at = 'ask.html') {
  await page.goto(`${BASE}${at}`);
  await page.fill('#lg-email', `${who}@astrateg.test`);
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
}
const shot = async (page, name) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); };
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const smallTargets = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((el) => el.offsetParent && el.getBoundingClientRect().height < 43.5)
  .map((el) => `${el.id || el.textContent.trim().slice(0, 20)}:${Math.round(el.getBoundingClientRect().height)}`), sel);
let passed = 0;
async function step(name, fn) {
  try { await fn(); } catch (err) {
    console.error(`not ok - ${name}\n  page errors: ${JSON.stringify(errors)}\n  last calls: ${JSON.stringify(calls.slice(-3)).slice(0, 900)}`);
    throw err;
  }
  passed += 1;
  console.log(`ok - ${name}`);
}

// The ask page for one person: { allowed } and, when allowed, the menu has the entry.
async function opensAsk(browser, who, options) {
  const { page, ctx } = await newPage(browser, options);
  await signIn(page, who);
  // Whoever may not ask is taken to their own home after signing in here (the page refused them);
  // opening ask.html again by its address says "אין לך גישה".
  await page.waitForFunction(() => (location.pathname.endsWith('ask.html') && !document.getElementById('app').hidden) || !location.pathname.endsWith('ask.html'));
  if (!page.url().includes('ask.html')) {
    await page.locator('#side-mine, .bar-link, #app').first().waitFor();
    await page.goto(`${BASE}ask.html`);
    await page.waitForFunction(() => document.getElementById('state').textContent.includes('אין לך גישה'));
  }
  const allowed = await page.locator('#ak-form').isVisible();
  // The shell's menu (the side list or the phone's bar and "עוד") has a link to ask.html.
  await page.waitForTimeout(300);
  const inMenu = await page.locator('a[href="ask.html"]:not(.navlink)').count();
  return { page, ctx, allowed, inMenu };
}

// The conversation on one browser/size: type key by key, delete, send; the answer; a chip.
async function converse(page, tag) {
  await page.locator('#ak-q').click();
  await page.keyboard.type('כמה לקוחות פעילים יש בערך', { delay: 12 });
  for (let i = 0; i < ' בערך'.length; i += 1) await page.keyboard.press('Backspace');
  await page.keyboard.type('?', { delay: 12 });
  assert.equal(await page.locator('#ak-q').inputValue(), 'כמה לקוחות פעילים יש?');
  await shot(page, `${tag}-typed`);
  await page.locator('#ak-send').click();
  await page.locator('.ak-a-bubble.is-wait').waitFor();
  assert.equal(await page.locator('#ak-send').isDisabled(), true);
  await shot(page, `${tag}-waiting`);
  await page.locator('.ak-a-bubble:not(.is-wait)').first().waitFor();
  assert.equal(await page.locator('.ak-q-bubble').first().innerText(), 'כמה לקוחות פעילים יש?');
  assert.match(await page.locator('.ak-a-bubble').first().innerText(), /12 לקוחות פעילים/);
  assert.equal(await page.locator('#ak-q').inputValue(), '');
  assert.deepEqual(calls.filter((c) => c.ask).at(-1).ask, { question: 'כמה לקוחות פעילים יש?', history: [] });
  // A chip with "<לקוח>": the words in the box, the slot selected for the name.
  await page.locator('.ak-chip', { hasText: 'מה עלה לדרייב' }).click();
  const sel = await page.evaluate(() => { const t = document.getElementById('ak-q'); return t.value.slice(t.selectionStart, t.selectionEnd); });
  assert.equal(sel, '<לקוח>');
  await page.keyboard.type('מספרת רון', { delay: 12 });
  assert.equal(await page.locator('#ak-q').inputValue(), 'מה עלה לדרייב של מספרת רון?');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.ak-a-bubble:not(.is-wait)').length === 2);
  const second = calls.filter((c) => c.ask).at(-1).ask;
  assert.equal(second.history.length, 1, 'the earlier turn goes with the next question');
  // The Drive link in the answer is a link.
  assert.equal(await page.locator('.ak-a-bubble a[href="https://drive.google.com/file/d/f4/view"]').count(), 1);
  assert.ok(await noSideScroll(page), `${tag}: sideways scroll`);
  assert.deepEqual(await smallTargets(page, '.ak-chip, #ak-send, #ak-q'), [], tag);
  await shot(page, `${tag}-answered`);
}

let exitCode = 0;
const chrome = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const safari = await webkit.launch();
try {
  await step('the owner, Lior and Ofir have the page and the menu entry; Irit, Ilai and an editor have neither', async () => {
    for (const who of ['owner', 'lior', 'ofir', 'irit', 'ilai', 'nadia']) {
      const { page, ctx, allowed, inMenu } = await opensAsk(chrome, who, { viewport: { width: 1280, height: 900 } });
      const should = ['owner', 'lior', 'ofir'].includes(who);
      assert.equal(allowed, should, `${who}: the page`);
      assert.equal(inMenu > 0, should, `${who}: the menu`);
      if (!should) assert.match(await page.locator('#state').innerText(), /אין לך גישה/);
      if (who === 'owner' || who === 'irit') await shot(page, `access-${who}-1280`);
      await ctx.close();
    }
  });

  await step('Lior at 1280 (Chromium): types key by key, deletes, asks; the answer; a chip with the client\'s slot', async () => {
    const { page, ctx } = await opensAsk(chrome, 'lior', { viewport: { width: 1280, height: 900 } });
    await shot(page, 'chromium-1280-empty');
    await converse(page, 'chromium-1280');
    await ctx.close();
  });

  await step('Ofir at 390 (Chromium phone)', async () => {
    const { page, ctx } = await opensAsk(chrome, 'ofir', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await shot(page, 'chromium-390-empty');
    await converse(page, 'chromium-390');
    await ctx.close();
  });

  await step('the owner on an iPhone 13 (WebKit), and at 1280 (WebKit)', async () => {
    const phone = await opensAsk(safari, 'owner', { ...devices['iPhone 13'] });
    await shot(phone.page, 'webkit-iphone13-empty');
    await converse(phone.page, 'webkit-iphone13');
    // 16px in the box: Safari does not zoom in on it.
    assert.equal(await phone.page.evaluate(() => getComputedStyle(document.getElementById('ak-q')).fontSize), '16px');
    await phone.ctx.close();
    const wide = await opensAsk(safari, 'owner', { viewport: { width: 1280, height: 900 } });
    await converse(wide.page, 'webkit-1280');
    await wide.ctx.close();
  });

  await step('the AI not configured: said in plain words, in the conversation', async () => {
    aiMode = 'not-configured';
    const { page, ctx } = await opensAsk(chrome, 'lior', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await page.locator('#ak-q').fill('כמה לקוחות?');
    await page.locator('#ak-send').click();
    await page.locator('.ak-a-bubble.is-error').waitFor();
    assert.match(await page.locator('.ak-a-bubble.is-error').innerText(), /החיבור ל־AI עוד לא הוגדר/);
    // An empty question is not sent.
    const n = calls.length;
    await page.locator('#ak-send').click();
    assert.equal(await page.locator('#ak-err').innerText(), 'כתבו שאלה ואז ״שאלו״.');
    assert.equal(calls.length, n);
    await shot(page, 'chromium-390-not-configured');
    aiMode = 'ok';
    await ctx.close();
  });

  // ── "משיכת קישורים מהדרייב" ──────────────
  const pull = async (browser, viewport, tag) => {
    resetGantt();
    const { page, ctx } = await newPage(browser, viewport);
    await openGantt(page, 'ilai');
    await page.locator('#btn-drive').waitFor();
    await shot(page, `${tag}-gantt-before`);
    await page.locator('#btn-drive').click();
    await page.locator('#gt-drive:not([hidden]) .gd-counts').waitFor();
    const counts = await page.locator('.gd-count').allInnerTexts();
    assert.deepEqual(counts.map((t) => t.replace(/\s+/g, ' ').trim()), ['3 קושרו', '1 כבר היה קישור', '1 לא שובצו']);
    const byTitle = Object.fromEntries(gantt.map((r) => [r.title, r.link]));
    assert.deepEqual(byTitle, {
      'סרטון 1': 'https://drive.google.com/file/d/f1/view',
      'גרפיקה 1': 'https://drive.google.com/file/d/f2/view',
      'סרטון 2': 'https://drive.google.com/file/d/already/view', // never replaced
      'סרטון 3': 'https://drive.google.com/file/d/f4/view',
      'סרטון 4': null,
    });
    assert.ok(calls.filter((c) => c.patch).slice(-3).every((c) => c.patch.onlyEmpty), 'each write only while the link is empty');
    assert.match(await page.locator('#gt-drive').innerText(), /לוגו סופי\.png/);
    assert.match(await page.locator('#gt-drive').innerText(), /אין תאריך בתחילת השם/);
    assert.ok(await noSideScroll(page), `${tag}: sideways scroll`);
    assert.deepEqual(await smallTargets(page, '#btn-drive, .gd-close, .gd-more > summary'), [], tag);
    await shot(page, `${tag}-gantt-after`);
    // A second pull links nothing new and replaces nothing.
    await page.locator('#btn-drive').click();
    await page.waitForFunction(() => document.querySelector('.gd-count')?.textContent.trim().startsWith('0'));
    assert.match((await page.locator('.gd-count').nth(1).innerText()).replace(/\s+/g, ' '), /^4 כבר היה קישור/);
    await ctx.close();
  };

  await step('Ilai pulls the links from the Drive: Chromium 1280', () => pull(chrome, { viewport: { width: 1280, height: 900 } }, 'chromium-1280'));
  await step('Ilai pulls the links from the Drive: Chromium 390', () => pull(chrome, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, 'chromium-390'));
  await step('Ilai pulls the links from the Drive: iPhone 13 (WebKit)', () => pull(safari, { ...devices['iPhone 13'] }, 'webkit-iphone13'));
  await step('Ilai pulls the links from the Drive: WebKit 1280', () => pull(safari, { viewport: { width: 1280, height: 900 } }, 'webkit-1280'));

  await step('Lior reads the Gantt: no Drive button (he does not change it)', async () => {
    const { page, ctx } = await newPage(chrome, { viewport: { width: 1280, height: 900 } });
    await openGantt(page, 'lior');
    await page.locator('#gt-title').waitFor();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#btn-drive').count(), 0);
    await ctx.close();
  });

  await step('no page error and no blocked resource', async () => {
    assert.deepEqual(errors, []);
    noCspViolations();
  });
} catch (err) {
  console.error(err);
  exitCode = 1;
} finally {
  await chrome.close();
  await safari.close();
}
console.log(`ask e2e: ${passed} steps passed`);
process.exit(exitCode);
