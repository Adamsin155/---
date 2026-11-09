// End-to-end check of "הערה מיוחדת" for one employee in the browser (Lior and the owner,
// 9.11.2026; docs/ops.md, section 114), against an in-memory fake of Supabase that answers
// as the database does (tests/sql/staff-notes.test.mjs holds the real rules; the one push:
// tests/staff-notes.test.mjs):
//   - Lior, on a 390px phone (Chromium), writes a note to Ilai in "המשימות שלי"
//     ("הערות מיוחדות לעובדים"): the text typed key by key, with deleting, as a person does;
//   - the same typing on an iPhone 13 (WebKit), a second note: two notes stack;
//   - Ilai opens two different pages (phone and wide screen, Chromium and WebKit): the notes
//     are at the top of each, who wrote them and when, with no way to remove them;
//     he has no writers' card;
//   - Lior deletes one: gone for Ilai; the other one too: the box is gone;
//   - before the migration nothing shows and nothing breaks.
// Run: npx http-server -p 5545 -s -c-1 . &  then
//      BASE_URL=http://localhost:5545/ node tests/staff-notes-e2e.mjs [outDir]
import { chromium, webkit, devices } from 'playwright';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { withClientColumns } from './fake-clients.mjs';
import { WRITERS, NOTE_MAX } from '../app/staff-notes-logic.js';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
if (OUT) mkdirSync(OUT, { recursive: true });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
// Monday 9.11.2026, 10:00 in Jerusalem.
const NOW = new Date('2026-11-09T08:00:00Z');
const skew = NOW.getTime() - Date.now();
const serverNow = () => new Date(Date.now() + skew).toISOString();
const minutesAgo = (n) => new Date(NOW - n * 6e4).toISOString();

const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ilai: 'ilai', nadia: 'nadia' };
const users = new Map();
const staff = [];
for (const [k, person] of Object.entries(PEOPLE)) {
  const email = `${k}@astrateg.test`;
  users.set(email, { id: randomUUID(), email, aud: 'authenticated', role: 'authenticated', email_confirmed_at: minutesAgo(9000) });
  staff.push({ email, person, vault: false });
}
const OFFICE = new Set(['irit', 'lior', 'ofir', 'ilai', null]);
const EXP = Math.floor(NOW / 1000) + 3 * 3600;
const jwtFor = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp: EXP })}.sig`;
const sessionFor = (u) => ({ access_token: jwtFor(u), token_type: 'bearer', expires_in: 3 * 3600, expires_at: EXP, refresh_token: `r-${u.id}`, user: u });
const userOf = (headers) => {
  const token = /^Bearer (.+)$/.exec(headers.authorization || '')?.[1];
  return [...users.values()].find((u) => jwtFor(u) === token) || null;
};
const personOf = (u) => { const s = staff.find((x) => x.email === u?.email); return s ? s.person ?? 'owner' : null; };
const isOffice = (u) => !!u && staff.some((s) => s.email === u.email) && OFFICE.has(staff.find((s) => s.email === u.email).person);
const writes = (u) => WRITERS.includes(personOf(u));

const notes = [];
const calls = [];
let tableMissing = false;
// public.staff_notes row level security: the writers read all; anyone else their own live ones.
const reads = (n, me) => writes(me) || (!n.deleted_at && n.person === personOf(me));

const filtersOf = (url) => [...url.searchParams.entries()].filter(([k]) => !['select', 'order', 'limit', 'offset'].includes(k));
const matcher = (filters) => (row) => filters.every(([k, v]) => {
  if (v.startsWith('eq.')) return String(row[k]) === v.slice(3);
  if (v === 'is.null') return row[k] === null || row[k] === undefined;
  if (v.startsWith('in.')) return v.slice(4, -1).split(',').map((x) => x.replace(/^"|"$/g, '')).includes(String(row[k]));
  return true;
});
const answer = (req, json) => (rows) => ((req.headers().accept || '').includes('vnd.pgrst.object')
  ? (rows.length ? json(200, rows[0]) : json(406, { code: 'PGRST116', message: 'no rows' })) : json(200, rows));

function rpc(name, body, me, json) {
  if (name === 'is_staff') return json(200, !!me && staff.some((s) => s.email === me.email));
  if (name === 'is_office') return json(200, isOffice(me));
  if (name === 'staff_note_delete') {
    calls.push({ staff_note_delete: body, by: me?.email });
    if (tableMissing) return json(404, { code: 'PGRST202', message: 'function not found' });
    if (!writes(me)) return json(403, { code: '42501', message: 'not allowed' });
    const n = notes.find((x) => x.id === body.p_id);
    if (!n) return json(404, { code: 'P0002', message: 'note not found' });
    if (!n.deleted_at) Object.assign(n, { deleted_at: serverNow(), deleted_by_email: me.email });
    return json(200, n);
  }
  return json(200, []);
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
  if (p === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
    const u = [...users.values()].find((x) => `r-${x.id}` === body.refresh_token);
    return u ? json(200, sessionFor(u)) : json(400, { error: 'invalid_grant', msg: 'Invalid Refresh Token' });
  }
  if (p === '/auth/v1/token') {
    const u = users.get(String(body.email || '').toLowerCase());
    if (!u || body.password !== 'correct-horse') return json(400, { error: 'invalid_grant', msg: 'Invalid login credentials' });
    return json(200, sessionFor(u));
  }
  if (p === '/auth/v1/user') return me ? json(200, me) : json(401, { msg: 'invalid JWT' });
  if (p === '/auth/v1/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  if (p.startsWith('/rest/v1/rpc/')) return rpc(p.slice('/rest/v1/rpc/'.length), body || {}, me, json);
  if (!me) return json(401, { message: 'permission denied' });
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m) return json(404, { message: 'not found' });
  if (m[1] === 'staff_notes') {
    if (tableMissing) return json(404, { code: 'PGRST205', message: "Could not find the table 'public.staff_notes' in the schema cache" });
    if (req.method() === 'POST') {
      const row = Array.isArray(body) ? body[0] : body;
      calls.push({ insert: row, by: me.email });
      // Only (person, body) may be sent (the column grant); the writers only (the policy).
      if (Object.keys(row).some((k) => !['person', 'body'].includes(k))) return json(403, { code: '42501', message: 'permission denied for table staff_notes' });
      if (!writes(me)) return json(403, { code: '42501', message: 'new row violates row-level security policy for table "staff_notes"' });
      const text = String(row.body || '');
      if (!text.trim() || text.trim().length > NOTE_MAX) return json(400, { code: '23514', message: 'new row violates check constraint' });
      notes.push({ id: randomUUID(), person: row.person, body: text, created_by: personOf(me), created_by_email: me.email, created_at: serverNow(), deleted_at: null, deleted_by_email: null });
      return route.fulfill({ status: 201, headers: { 'access-control-allow-origin': '*' }, body: '' });
    }
    if (req.method() !== 'GET') { calls.push({ directWrite: req.method(), by: me.email }); return json(403, { code: '42501', message: 'permission denied for table staff_notes' }); }
    return answer(req, json)(notes.filter((n) => reads(n, me)).filter(matcher(filtersOf(url))).sort((a, b) => (a.created_at < b.created_at ? -1 : 1)));
  }
  if (m[1] === 'staff') {
    const eq = url.searchParams.get('email');
    return answer(req, json)(eq?.startsWith('eq.') ? staff.filter((s) => s.email === eq.slice(3)) : staff);
  }
  if (m[1] === 'clients') return json(200, []);
  return json(200, []);
}

const chrome = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const safari = await webkit.launch();
const errors = [];
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const WIDE = { viewport: { width: 1440, height: 900 } };
const IPHONE = { ...devices['iPhone 13'] };
async function newPage(browser = chrome, opts = WIDE) {
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', ...opts });
  await ctx.clock.install({ time: new Date(serverNow()) });
  await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', withClientColumns(fakeSupabase, { clients: () => [], staff: () => staff }));
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', (e) => errors.push(String(e)));
  watchCsp(page);
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
  page.on('dialog', (d) => d.accept());
  return page;
}
async function signIn(page, path, who) {
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', `${who}@astrateg.test`);
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await shown(page);
}
// The page is shown: built (no data-boot) and the sign-in door lifted (app/login-ui.js).
async function shown(page) {
  await page.locator('#app:not([hidden])').waitFor();
  await page.waitForFunction(() => !('door' in document.documentElement.dataset) && !('boot' in document.documentElement.dataset));
}
const CARD = '#staff-notes-card';
const BANNER = '#staff-notes-banner';
const shot = async (page, name, fullPage = false) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage }); };
const text = (page, sel) => page.locator(sel).first().innerText();
const texts = (page, sel) => page.locator(sel).allInnerTexts();
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
let passed = 0;
async function step(name, fn) {
  try { await fn(); } catch (err) {
    console.error(`not ok - ${name}\n  page errors: ${JSON.stringify(errors)}\n  last calls: ${JSON.stringify(calls.slice(-3)).slice(0, 900)}`);
    throw err;
  }
  passed += 1;
  console.log(`ok - ${name}`);
}

// Real typing into the note's box: key by key, then deleting with Backspace and typing again.
// Returns what the box holds and what the counter says.
async function typeNote(page, { first, cut, then }) {
  const box = page.locator('#sn-body');
  await box.click();
  await box.pressSequentially(first, { delay: 15 });
  assert.equal(await box.inputValue(), first, 'typed key by key');
  assert.equal(await text(page, '#sn-count'), `${first.length}/${NOTE_MAX}`);
  for (let i = 0; i < cut; i += 1) await page.keyboard.press('Backspace');
  const kept = first.slice(0, first.length - cut);
  assert.equal(await box.inputValue(), kept, 'deleted with Backspace');
  assert.equal(await text(page, '#sn-count'), `${kept.length}/${NOTE_MAX}`);
  await box.pressSequentially(then, { delay: 15 });
  assert.equal(await box.inputValue(), kept + then);
  return kept + then;
}

// Who sees the banner where: it is the first thing in <main>, it says who wrote each note, and
// there is nothing in it to press.
async function bannerOn(page, expected) {
  await page.locator(BANNER).waitFor();
  assert.equal(await page.evaluate(() => document.querySelector('main').firstElementChild?.id), 'staff-notes-banner');
  assert.deepEqual(await texts(page, `${BANNER} .sn-body`), expected.map((e) => e.body));
  const by = await texts(page, `${BANNER} .sn-by`);
  expected.forEach((e, i) => assert.match(by[i], new RegExp(`^מ${e.by} · היום \\d\\d:\\d\\d$`)));
  assert.equal(await text(page, `${BANNER} h2`), expected.length > 1 ? `הערות מיוחדות אליך (${expected.length})` : 'הערה מיוחדת אליך');
  assert.equal(await page.locator(`${BANNER} button, ${BANNER} a, ${BANNER} input`).count(), 0, 'nothing to dismiss');
  assert.ok(await page.locator(BANNER).isVisible());
  assert.ok(await noSideScroll(page), 'no sideways scroll');
}

const NOTE1 = 'לא לגעת בלקוח מסעדת בוכרה';
const NOTE2 = 'לפני כל פרסום לשאול את אופיר';
let exitCode = 0;
try {
  const lior = await newPage(chrome, PHONE);
  await signIn(lior, 'clients.html#mine', 'lior');

  await step('Lior (390px phone): "הערות מיוחדות לעובדים" under the "נודניק" card, nothing written yet', async () => {
    await lior.locator(`${CARD}:not([hidden])`).waitFor();
    const order = await lior.evaluate(() => [...document.querySelectorAll('#view-mine > *')].map((e) => e.id));
    assert.equal(order.indexOf('staff-notes-card'), order.indexOf('staff-tasks-card') + 1);
    assert.equal(await text(lior, '#sn-h'), 'הערות מיוחדות לעובדים');
    assert.match(await text(lior, CARD), /אין הערות פעילות\./);
    assert.doesNotMatch(await text(lior, CARD), /null|undefined/);
    assert.equal(await text(lior, '#sn-new'), 'הערה חדשה');
    assert.equal(await lior.locator(BANNER).count(), 0, 'no note to Lior: no banner');
    await shot(lior, '01-lior-phone-empty');
  });

  await step('the form: everyone on the team; an empty form is refused in words; typing key by key with deleting (Chromium)', async () => {
    await lior.click('#sn-new');
    await lior.locator('#sn-form').waitFor();
    assert.equal(await lior.evaluate(() => document.activeElement.id), 'sn-person');
    const options = await texts(lior, '#sn-person option');
    assert.equal(options[0], 'בחירת עובד/ת');
    assert.ok(options.includes('עילאי') && options.includes('נדיה') && !options.includes('הבעלים'));
    assert.equal(await lior.getAttribute('#sn-body', 'maxlength'), String(NOTE_MAX));
    const before = calls.length;
    await lior.click('#sn-send');
    assert.equal(await text(lior, '#sn-person-err'), 'בוחרים למי ההערה.');
    assert.equal(await text(lior, '#sn-body-err'), 'כותבים את ההערה.');
    assert.equal(calls.length, before, 'nothing was sent');
    await lior.selectOption('#sn-person', 'ilai');
    assert.ok(await lior.locator('#sn-person-err').isHidden());
    const typed = await typeNote(lior, { first: 'לא לגעת בלקוח מסעדת בוכרי', cut: 1, then: 'ה' });
    assert.equal(typed, NOTE1);
    assert.ok(await lior.locator('#sn-body-err').isHidden());
    assert.ok(await noSideScroll(lior));
    await shot(lior, '02-lior-phone-form');
  });

  await step('saving: only who and what are sent; the note is under "לעילאי" with "מחיקה"', async () => {
    await lior.click('#sn-send');
    await lior.locator(`${CARD} .sn-item`).waitFor();
    assert.deepEqual(calls.filter((c) => c.insert).at(-1).insert, { person: 'ilai', body: NOTE1 });
    assert.equal(notes.length, 1);
    assert.deepEqual([notes[0].person, notes[0].created_by], ['ilai', 'lior']);
    assert.equal(await lior.locator('#sn-form').count(), 0);
    assert.equal(await text(lior, `${CARD} .sn-to`), 'לעילאי');
    assert.match(await text(lior, `${CARD} .sn-item`), new RegExp(`${NOTE1}\\s*כתב/ה ליאור · היום 10:0\\d\\s*מחיקה`));
    assert.match(await text(lior, '#toast.on'), /ההערה נשמרה\. עילאי יקבל\/תקבל התראה אחת לטלפון/);
    const small = await lior.evaluate(() => [...document.querySelectorAll('#staff-notes-card button')].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 43.5).map((b) => b.textContent));
    assert.deepEqual(small, [], '44px targets');
    assert.ok(await noSideScroll(lior));
    await shot(lior, '03-lior-phone-saved', true);
  });

  await step('Lior on an iPhone 13 (WebKit): a second note, typed key by key with deleting', async () => {
    const ios = await newPage(safari, IPHONE);
    await signIn(ios, 'clients.html#mine', 'lior');
    await ios.locator(`${CARD} .sn-item`).waitFor();
    await ios.click('#sn-new');
    await ios.selectOption('#sn-person', 'ilai');
    const typed = await typeNote(ios, { first: 'לפני כל פרסום לשאול את עירית', cut: 5, then: 'אופיר' });
    assert.equal(typed, NOTE2);
    // The page does not zoom into the box (16px or more) and nothing scrolls sideways.
    assert.ok(await ios.evaluate(() => parseFloat(getComputedStyle(document.getElementById('sn-body')).fontSize) >= 16));
    await shot(ios, '04-lior-iphone-form');
    await ios.click('#sn-send');
    await ios.locator(`${CARD} .sn-item >> nth=1`).waitFor();
    assert.deepEqual(await texts(ios, `${CARD} .sn-item .st-body`), [NOTE2, NOTE1], 'newest first');
    assert.ok(await noSideScroll(ios));
    await shot(ios, '05-lior-iphone-two', true);
    await ios.context().close();
  });

  const expectBoth = [{ body: NOTE1, by: 'ליאור' }, { body: NOTE2, by: 'ליאור' }];
  await step('Ilai (390px phone): both notes at the top of "המשימות שלי" and of the Gantt; no writers\' card', async () => {
    const ilai = await newPage(chrome, PHONE);
    await signIn(ilai, 'clients.html#mine', 'ilai');
    await bannerOn(ilai, expectBoth);
    assert.ok(await ilai.locator(CARD).isHidden(), 'Ilai does not write notes');
    await shot(ilai, '06-ilai-phone-mine');
    await ilai.waitForLoadState('networkidle');
    await ilai.goto(`${BASE}gantt.html`);
    await shown(ilai);
    await bannerOn(ilai, expectBoth);
    await shot(ilai, '07-ilai-phone-gantt');
    await ilai.context().close();
  });

  await step('Ilai on a wide screen (Chromium) and on an iPhone 13 (WebKit), on two pages', async () => {
    const wide = await newPage(chrome, WIDE);
    await signIn(wide, 'calendar.html', 'ilai');
    await bannerOn(wide, expectBoth);
    await shot(wide, '08-ilai-wide-calendar');
    await wide.waitForLoadState('networkidle');
    await wide.goto(`${BASE}clients.html#mine`);
    await shown(wide);
    await bannerOn(wide, expectBoth);
    await shot(wide, '09-ilai-wide-mine');
    await wide.context().close();
    const ios = await newPage(safari, IPHONE);
    await signIn(ios, 'clients.html#mine', 'ilai');
    await bannerOn(ios, expectBoth);
    await shot(ios, '10-ilai-iphone-mine');
    await ios.context().close();
    // The second page in a context of its own: in this harness WebKit drops the fake session when a
    // page is left while supabase-js renews it (the request is cancelled; the same without this
    // feature), so the Gantt is opened with a sign-in of its own.
    const ios2 = await newPage(safari, IPHONE);
    await signIn(ios2, 'gantt.html', 'ilai');
    await bannerOn(ios2, expectBoth);
    await shot(ios2, '11-ilai-iphone-gantt');
    await ios2.context().close();
  });

  await step('Nadia has no note: no banner', async () => {
    const nadia = await newPage(chrome, PHONE);
    await signIn(nadia, 'clients.html#mine', 'nadia');
    await nadia.waitForLoadState('networkidle');
    assert.equal(await nadia.locator(BANNER).count(), 0);
    assert.ok(await nadia.locator(CARD).isHidden());
    await nadia.context().close();
  });

  await step('Lior on a wide screen sees both; he deletes the first: Ilai sees only the second', async () => {
    const wide = await newPage(chrome, WIDE);
    await signIn(wide, 'clients.html#mine', 'lior');
    await wide.locator(`${CARD} .sn-item >> nth=1`).waitFor();
    await shot(wide, '12-lior-wide-two');
    await wide.locator(`${CARD} .sn-item`, { hasText: NOTE1 }).locator('[data-act="delete"]').click();
    await wide.locator(`${CARD} .sn-item`, { hasText: NOTE1 }).waitFor({ state: 'detached' });
    assert.deepEqual(calls.filter((c) => c.staff_note_delete).map((c) => c.staff_note_delete.p_id), [notes[0].id]);
    assert.ok(notes[0].deleted_at);
    assert.deepEqual(await texts(wide, `${CARD} .sn-item .st-body`), [NOTE2]);
    await wide.context().close();
    const ilai = await newPage(chrome, PHONE);
    await signIn(ilai, 'clients.html#mine', 'ilai');
    await bannerOn(ilai, [{ body: NOTE2, by: 'ליאור' }]);
    await shot(ilai, '13-ilai-phone-one');
    // Lior deletes the other one (on his phone): the box is gone from Ilai's page when he comes back to it.
    await lior.reload();
    await lior.locator(`${CARD} .sn-item`).waitFor();
    await lior.locator(`${CARD} [data-act="delete"]`).click();
    await lior.locator(`${CARD} .sn-item`).waitFor({ state: 'detached' });
    assert.match(await text(lior, CARD), /אין הערות פעילות\./);
    await ilai.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await ilai.locator(BANNER).waitFor({ state: 'detached' });
    await ilai.waitForLoadState('networkidle');
    await ilai.goto(`${BASE}gantt.html`);
    await shown(ilai);
    await ilai.waitForLoadState('networkidle');
    assert.equal(await ilai.locator(BANNER).count(), 0);
    await ilai.context().close();
  });

  await step('before the migration: no banner, no card, the page is whole', async () => {
    tableMissing = true;
    notes.push({ id: randomUUID(), person: 'ilai', body: 'x', created_by: 'lior', created_at: serverNow(), deleted_at: null });
    const early = await newPage(chrome, PHONE);
    await signIn(early, 'clients.html#mine', 'lior');
    await early.locator('#mine-list').waitFor();
    await early.waitForLoadState('networkidle');
    assert.ok(await early.locator(CARD).isHidden());
    assert.equal(await early.locator(BANNER).count(), 0);
    await early.context().close();
    tableMissing = false;
  });

  assert.equal(calls.filter((c) => c.directWrite).length, 0, 'the pages never update or delete the table directly');
  assert.deepEqual(errors, [], 'no page errors');
  console.log(`\n${passed} steps passed`);
} catch (err) {
  console.error(err);
  exitCode = 1;
} finally {
  await chrome.close();
  await safari.close();
  noCspViolations();
}
process.exit(exitCode);
