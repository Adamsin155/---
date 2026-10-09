// The screenshots of docs/ops.md section 52 (the shared kit on the office's screens),
// against tests/late-world.mjs (an invented office: no real client data), at 390px and 1280px.
// Run: npx http-server -p 8080 -s -c-1 . &  then
//      node docs/design/kit-office/shots.mjs <before|after> [screen,screen]
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { NOW, SUPA, emailOf, lateWorld, makeFlowFake, cid } from '../../../tests/late-world.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const TAG = process.argv[2] || 'after';
const ONLY = process.argv[3] ? process.argv[3].split(',') : null;
const OUT = fileURLToPath(new URL('.', import.meta.url));
const SIZES = [[390, { width: 390, height: 844 }, true], [1280, { width: 1280, height: 900 }, false]];

// name → [role, path, what to do before the picture]
export const SCREENS = {
  'shoot-lior': ['lior', 'shoot.html'],
  'shoot-eli': ['eli', 'shoot.html'],
  'shoot-irit': ['irit', 'shoot.html'],
  prep: ['irit', 'prep.html'],
  qa: ['ofir', 'qa.html'],
  decisions: ['lior', 'decisions.html'],
  pass: ['ofir', 'pass.html'],
  messages: ['irit', 'messages.html'],
  landing: ['irit', 'landing.html'],
  'editor-nadia': ['nadia', 'editor.html'],
  'editor-nirel': ['nirel', 'editor.html'],
  intake: ['ofir', `intake.html?id=${cid(7)}`],
  scripts: ['lior', `scripts.html?id=${cid(7)}`],
  gantt: ['ilai', `gantt.html?id=${cid(12)}`, async (page, settle) => { const b = page.getByRole('button', { name: 'יצירת הגאנט מהתבנית' }); if (await b.count()) { await b.click(); await settle(page); } }],
  'gantt-index': ['ilai', 'gantt.html'],
  year: ['lior', 'year.html'],
  insights: ['lior', 'insights.html'],
  team: ['owner', 'team.html'],
  'clients-irit': ['irit', 'clients.html#clients'],
  'clients-nadia': ['nadia', 'clients.html#clients'],
  control: ['irit', 'clients.html#control'],
  'performance-nadia': ['nadia', 'clients.html#performance'],
  'performance-irit': ['irit', 'clients.html#performance'],
  'teamwork-owner': ['owner', 'clients.html#mine'],
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(600); };
for (const [name, [role, path, more]] of Object.entries(SCREENS)) {
  if (ONLY && !ONLY.some((o) => name === o || name.startsWith(`${o}-`))) continue;
  for (const [w, viewport, phone] of SIZES) {
    const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport, isMobile: phone, hasTouch: phone, deviceScaleFactor: 1 });
    await ctx.clock.install({ time: NOW });
    await ctx.route(`${SUPA}/**`, makeFlowFake(lateWorld()).route);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
    await page.goto(`${BASE}${path}`);
    await page.fill('#lg-email', emailOf(role));
    await page.fill('#lg-pass', 'correct-horse');
    await page.click('#lg-submit');
    await page.waitForSelector('#app:not([hidden])', { timeout: 8000 }).catch(() => {});
    await settle(page);
    if (more) await more(page, settle);
    const m = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, hscroll: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
    await page.screenshot({ path: `${OUT}${TAG}-${name}-${w}.png`, fullPage: true, clip: { x: 0, y: 0, width: w, height: Math.min(m.h, phone ? 3600 : 2600) } });
    console.log(`${name} ${w}: h=${m.h} hscroll=${m.hscroll}${errors.length ? ` ERRORS ${errors.join(' | ')}` : ''}`);
    await ctx.close();
  }
}
await browser.close();
