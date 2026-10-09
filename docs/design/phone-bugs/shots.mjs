// Screenshots for docs/ops.md, section 54 (the phone bugs of 9.10.2026), from the suites'
// fake office (invented names). The iPhone's insets are simulated (59 above, 34 below).
// Run: npx http-server -p 8093 -s -c-1 . &   then
//      BASE_URL=http://localhost:8093/ node docs/design/phone-bugs/shots.mjs before|after [name]
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { NOW, SUPA, emailOf, lateWorld, makeFlowFake, cid } from '../../../tests/late-world.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8093/';
const STAGE = process.argv[2] || 'after';
const ONLY = process.argv[3] || null;
const OUT = new URL('./', import.meta.url);
const PHONE = { width: 390, height: 844 };
const INSETS = { top: 59, bottom: 34, left: 0, right: 0 };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const file = (name) => fileURLToPath(new URL(`${STAGE}-${name}.png`, OUT));
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(600); };

async function open(role, path, { viewport = PHONE, insets = INSETS, db = lateWorld(), signIn = true } = {}) {
  const fake = makeFlowFake(db);
  const phone = viewport.width < 600;
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport, isMobile: phone, hasTouch: phone, reducedMotion: 'reduce' });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, fake.route);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  ! ${role} ${path}: ${e}`));
  if (insets && phone) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets }).catch((e) => console.log(`  (no inset override: ${e.message})`));
  }
  await page.goto(`${BASE}${path}`);
  if (signIn) {
    await page.fill('#lg-email', emailOf(role));
    await page.fill('#lg-pass', 'correct-horse');
    await page.click('#lg-submit');
    await page.waitForSelector('#login-block', { state: 'hidden' }).catch(() => {});
    await settle(page);
  }
  return { page, ctx, db };
}
const shot = async (page, name, opts = {}) => { await page.screenshot({ path: file(name), ...opts }); console.log(`  ${STAGE}-${name}.png`); };
const part = async (page, sel, name, max = 1400) => {
  const l = page.locator(sel).first();
  if (!(await l.count()) || !(await l.isVisible())) { console.log(`  (no ${sel} for ${name})`); return; }
  await l.scrollIntoViewIfNeeded();
  const box = await l.evaluate((e) => { const r = e.getBoundingClientRect(); return { x: Math.max(0, r.left + scrollX), y: r.top + scrollY, width: r.width, height: r.height }; });
  if (!box.width || !box.height) { console.log(`  (empty ${sel} for ${name})`); return; }
  await page.screenshot({ path: file(name), fullPage: true, clip: { ...box, height: Math.min(box.height, max) } });
  console.log(`  ${STAGE}-${name}.png`);
};

const SHOTS = {
  // BUG 2: the sign-in screen with the keyboard up (what is left of the screen: 390×430).
  async login() {
    const { page, ctx } = await open('irit', 'clients.html', { viewport: { width: 390, height: 430 }, signIn: false });
    await page.waitForSelector('#lg-email');
    await page.focus('#lg-email');
    await page.waitForTimeout(400);
    await shot(page, 'bug2-login-keyboard');
    await ctx.close();
  },
  // BUG 3, 4, 5, 6: the manager view on a phone, scrolled.
  async owner() {
    for (const role of ['owner', 'lior']) {
      const { page, ctx } = await open(role, role === 'owner' ? 'owner.html#now' : 'owner.html#all');
      await page.waitForSelector('#ow-tabs');
      await settle(page);
      await shot(page, `bug4-tabs-${role}`);
      if (role === 'owner') {
        await page.evaluate(() => scrollTo(0, 330));
        await page.waitForTimeout(200);
        await shot(page, 'bug3-scrolled-under-status-bar');
        await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(200);
        await shot(page, 'bug5-end-of-page');
      } else {
        await part(page, 'li:has(.tag-landing)', 'bug6-landing-pill', 300);
      }
      await ctx.close();
    }
  },
  // BUG 7 and 9: Ilai's "המשימות שלי", wide and on a phone.
  async ilai() {
    for (const [name, viewport] of [['1280', { width: 1280, height: 900 }], ['390', PHONE]]) {
      const { page, ctx } = await open('ilai', 'clients.html', { viewport });
      await page.waitForSelector('#mine-list');
      await settle(page);
      await part(page, '.g-ilai', `bug7-ilai-cards-${name}`, 1500);
      await ctx.close();
    }
  },
  // BUG 8: "הצעה אחרת" on the deal page.
  async deal() {
    const { page, ctx } = await open('stav', 'deal.html');
    await page.waitForSelector('#deal-form:not([hidden])');
    const custom = page.locator('input[type=radio][value=custom]').first();
    if (await custom.count()) await custom.check({ force: true });
    await page.waitForTimeout(300);
    await part(page, '#d-custom', 'bug8-deal-fields');
    await page.evaluate(() => scrollTo(0, 500));
    await page.waitForTimeout(200);
    await shot(page, 'bug3-deal-scrolled');
    await ctx.close();
  },
  // BUG 9: every place where the staff upload or attach.
  async uploads() {
    {
      const { page, ctx } = await open('yariv', 'editor.html');
      await settle(page);
      await part(page, '.ed-card .fl-work', 'bug9-editor-upload', 700);
      await ctx.close();
    }
    {
      const { page, ctx } = await open('ofir', 'qa.html');
      await settle(page);
      await ctx.close();
    }
    {
      const { page, ctx } = await open('ofir', `intake.html?id=${cid(4)}#form`);
      await settle(page);
      await part(page, '#files-materials', 'bug9-intake-short-form');
      await ctx.close();
    }
    {
      const { page, ctx } = await open('ilai', `intake.html?id=${cid(4)}`);
      await settle(page);
      await part(page, '#files-block', 'bug9-intake-read-materials');
      await ctx.close();
    }
    {
      const { page, ctx } = await open('irit', `client.html?id=${cid(4)}`);
      await page.waitForSelector('#fl-slot .fl-block').catch(() => {});
      await settle(page);
      await part(page, '.fl-gallery', 'bug9-card-gallery');
      await ctx.close();
    }
    {
      const { page, ctx } = await open('lior', `scripts.html?id=${cid(4)}`);
      await settle(page);
      await part(page, '.sc-links', 'bug9-scripts-inspiration-link');
      await ctx.close();
    }
  },
};

for (const [name, run] of Object.entries(SHOTS)) {
  if (ONLY && ONLY !== name) continue;
  console.log(name);
  try { await run(); } catch (e) { console.log(`  !! ${name}: ${e.message.split('\n')[0]}`); }
}
await browser.close();
