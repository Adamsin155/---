// qa.html "עומס עורכים" by stage (the owner, 10.11.2026; docs/ops.md, section 125), Ofir signed in,
// against the office of tests/flow-world.mjs (Tuesday 20.10.2026, 10:00 in Israel; invented names):
//   - each editor's line: "N לקוחות בעריכה · M בתיקונים" (the load), and the finished ones apart,
//     muted, "N ממתינים ללקוח"; a client the client approved is not there at all;
//   - opened: the jobs, then "ממתינים לאישור הלקוח: N" with its own clients and where each waits;
//   - the assignment dialog shows the same words, and suggests by editing + fixes only;
//   - 390 (Chromium phone), 1366, and WebKit as an iPhone 13; no sideways scrolling.
// Screenshots (SHOTS=1) go to SHOTS_OUT, never into the repository.
// Run: npx http-server -p 8419 -s -c-1 . &  then  BASE_URL=http://localhost:8419/ node tests/editor-load-stages-e2e.mjs
import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import { NOW, SUPA, emailOf, flowWorld, makeFlowFake, cid } from './flow-world.mjs';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import { importKeys } from '../app/client-open.js';
import { PROCESSES } from '../app/protocol.js';
import { returnKey, returnNote } from '../app/office-marks.js';

const BASE = process.env.BASE_URL || 'http://localhost:8419/';
const SHOTS = process.env.SHOTS === '1' && !!process.env.SHOTS_OUT;
const OUT = `${String(process.env.SHOTS_OUT || '').replace(/[\\/]+$/, '')}/`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(400); };
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();
const itemsOf = (...ids) => PROCESSES.filter((p) => ids.includes(p.id)).flatMap((p) => p.items.filter((i) => !i.optional).map((i) => i.key));
const IMPORTED_AT = '2026-10-12T09:00:00+03:00';

// Yariv: 2 editing, Ofir's fixes, the client's fixes, 3 finished (with Ofir, with the client, final
// versions), 1 approved by the client. Nadia: 1 editing, 2 with the client. Nirel: 1 with Ofir. Anna: none.
const PLAN = [
  ['yariv', 'עסק עריכה 1', []], ['yariv', 'עסק עריכה 2', []],
  ['yariv', 'עסק תיקון אופיר', ['handed', 'return']], ['yariv', 'עסק תיקון לקוח', ['handed', 'qa', 'sent', 'notes']],
  ['yariv', 'עסק אצל אופיר', ['handed']], ['yariv', 'עסק אצל הלקוח', ['handed', 'qa', 'sent']],
  ['yariv', 'עסק גרסאות סופיות', ['handed', 'qa', 'sent', 'notes', 'fixes', 'final']], ['yariv', 'עסק שאושר', ['handed', 'qa', 'sent', 'notes', 'approved']],
  ['nadia', 'עסק נדיה עריכה', []], ['nadia', 'עסק נדיה ללקוח 1', ['handed', 'qa', 'sent']], ['nadia', 'עסק נדיה ללקוח 2', ['handed', 'qa', 'sent']],
  ['nirel', 'עסק ניראל אצל אופיר', ['handed']],
];
function office() {
  const db = flowWorld({ landing: false, queues: false });
  const base = db.clients.find((c) => c.id === cid(12));
  for (const t of ['protocol_checks', 'client_tasks', 'deal_requests', 'client_gantt', 'client_scripts', 'client_access_links', 'client_status_links', 'client_status_views', 'client_approvals', 'client_surveys', 'client_consents']) db[t] = [];
  const mark = (id, keys, when, note = null, by = 'irit') => { for (const k of [].concat(keys)) db.protocol_checks.push({ client_id: id, item_key: k, state: 'done', note, by_email: emailOf(by), at: when }); };
  db.clients = PLAN.map(([editor, business, steps], n) => {
    const id = cid(80 + n);
    const c = {
      ...base, id, name: business, business, editor, editor2: null, editor_split: null, rounds: [], links: {}, landing: false, landed_at: null, landed_by: null, landing_slot: null,
      protocol_version: 13, shoot_type: 'dms', characterizer: 'ofir', has_logo: true, deal_at: '2026-09-20T09:00:00+03:00', char_at: '2026-09-22T10:00:00+03:00',
      shoot_at: '2026-10-14T10:00:00+03:00', created_by_email: emailOf('irit'),
    };
    mark(id, importKeys('post').filter((k) => !/^p(22|23|23b|24|25|26|27)\./.test(k)), IMPORTED_AT, 'ייבוא');
    mark(id, itemsOf('p22a'), '2026-10-19T09:00:00+03:00', null, 'ofir');
    mark(id, 'p22.received', '2026-10-19T09:30:00+03:00', null, editor);
    const at = '2026-10-19T12:00:00+03:00';
    if (steps.includes('handed')) mark(id, ['p22.edited', 'p24.drive', 'p24.notify'], at, null, editor);
    if (steps.includes('return')) mark(id, returnKey('', 'videos', 1), '2026-10-19T13:00:00+03:00', returnNote([{ ref: '3', text: 'הסאונד נמוך' }], new Date('2026-10-20T18:00:00+03:00')), 'ofir');
    if (steps.includes('qa')) mark(id, 'p25.approved', '2026-10-19T13:00:00+03:00', null, 'ofir');
    if (steps.includes('sent')) mark(id, 'p26.sent', '2026-10-19T13:30:00+03:00');
    if (steps.includes('notes')) mark(id, 'p27.notes', '2026-10-19T16:00:00+03:00', 'לקצר את הפתיח');
    if (steps.includes('fixes')) mark(id, 'p27.fixes', '2026-10-19T17:00:00+03:00', null, editor);
    if (steps.includes('final')) mark(id, 'p27.final', '2026-10-19T17:00:00+03:00', null, editor);
    if (steps.includes('approved')) mark(id, 'p27.approved', '2026-10-20T09:00:00+03:00');
    return c;
  });
  return db;
}

async function signedIn(db, { width = 390, device = null, engine = browser } = {}) {
  const fake = makeFlowFake(db);
  const phone = width < 600;
  const ctx = device
    ? await engine.newContext({ ...device, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' })
    : await engine.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: { width, height: 900 }, isMobile: phone, hasTouch: phone });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, fake.route);
  const page = await ctx.newPage();
  watchCsp(page);
  page.on('pageerror', (e) => errors.push(`${e}`));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
  await page.goto(`${BASE}qa.html#load-h`);
  await page.fill('#lg-email', emailOf('ofir'));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForSelector('#load-list .of-editor');
  await settle(page);
  if (SHOTS) await page.waitForTimeout(900);
  return { page, ctx };
}
const noOverflow = async (page) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'the page scrolls sideways');

let passed = 0;
async function step(name, fn) {
  try { await fn(); passed += 1; console.log(`ok - ${name}`); } catch (e) { console.log(`not ok - ${name}`); throw e; }
}

async function check(page, name) {
  const card = (who) => page.locator('#load-list .of-editor', { hasText: who }).first();
  const yariv = card('יריב');
  assert.equal(await text(yariv.locator('summary').first()), 'יריב 2 לקוחות בעריכה · 2 בתיקונים 3 ממתינים ללקוח');
  assert.equal(await text(card('נדיה').locator('summary').first()), 'נדיה לקוח אחד בעריכה 2 ממתינים ללקוח');
  assert.equal(await text(card('ניראל').locator('summary').first()), 'ניראל אין לקוחות בעריכה אחד ממתין ללקוח');
  assert.equal(await text(card('אנה')), 'אנה אין לקוחות בעריכה');
  // The waiting part is muted, apart from the load.
  assert.equal(await yariv.locator('.of-load-wait').count(), 1);
  // Opened: the jobs, then the waiting ones in their own fold.
  await page.evaluate(() => { for (const d of document.querySelectorAll('#load-list details')) d.open = true; });
  const jobs = await yariv.locator('.of-jobs:not(.of-jobs-wait) > li').allInnerTexts();
  assert.equal(jobs.length, 4);
  assert.ok(jobs.some((t) => /עסק תיקון אופיר[^]*תיקונים מאופיר/.test(t)), jobs.join('\n'));
  assert.ok(jobs.some((t) => /עסק תיקון לקוח[^]*תיקוני הלקוח/.test(t)), jobs.join('\n'));
  assert.equal(await text(yariv.locator('.of-wait-fold > summary')), 'ממתינים לאישור הלקוח: 3');
  const waits = (await yariv.locator('.of-jobs-wait > li').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));
  assert.equal(waits.length, 3);
  for (const [who, where] of [['עסק אצל אופיר', 'אצל אופיר לבקרה'], ['עסק אצל הלקוח', 'אצל הלקוח לאישור'], ['עסק גרסאות סופיות', 'הגרסאות הסופיות בדרייב']]) {
    assert.ok(waits.some((t) => t.includes(who) && t.includes(where)), `${who}: ${where}`);
  }
  // No deadline on a finished one (not the editor's to keep), and the approved client is nowhere.
  assert.ok(waits.every((t) => !/יעד/.test(t)));
  assert.doesNotMatch(await text(page.locator('#load-list')), /עסק שאושר/);
  await noOverflow(page);
  if (SHOTS) {
    await yariv.screenshot({ path: `${OUT}load-yariv-${name}.png` });
    await page.locator('#load-list').screenshot({ path: `${OUT}load-list-${name}.png` });
    await page.evaluate(() => { for (const d of document.querySelectorAll('#load-list details')) d.open = false; });
    await page.locator('#load-list').screenshot({ path: `${OUT}load-list-closed-${name}.png` });
  }
}

try {
  for (const width of [390, 1366]) {
    await step(`${width}px · Ofir: each editor's load by stage, the finished ones apart, the approved one gone`, async () => {
      const { page, ctx } = await signedIn(office(), { width });
      await check(page, String(width));
      await ctx.close();
    });
  }
  await step('WebKit (iPhone 13): the same lines', async () => {
    const wk = await webkit.launch();
    try {
      const { page, ctx } = await signedIn(office(), { device: devices['iPhone 13'], engine: wk });
      await check(page, 'webkit-iphone13');
      await ctx.close();
    } finally {
      await wk.close();
    }
  });
  noCspViolations();
  assert.deepEqual(errors, []);
  console.log(`\n${passed} steps passed.`);
} finally {
  await browser.close();
}
