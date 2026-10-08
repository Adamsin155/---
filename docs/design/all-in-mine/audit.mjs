// The audit behind docs/ops.md section 46: for every role, what each page of work holds
// (its own counters) and what "המשימות שלי" says, against tests/flow-world.mjs (no real
// client data). Prints one block per role.
// Run: npx http-server -p 8080 -s -c-1 . &  then  node docs/design/all-in-mine/audit.mjs [role …]
import { chromium } from 'playwright';
import { NOW, SUPA, emailOf, flowWorld, makeFlowFake } from '../../../tests/flow-world.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const roles = process.argv.slice(2).length ? process.argv.slice(2) : ['owner', 'irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'anna', 'eli', 'stav'];
const PAGES = ['qa.html', 'decisions.html', 'pass.html', 'prep.html', 'messages.html', 'shoot.html', 'editor.html', 'gantt.html', 'landing.html', 'quotes.html', 'year.html'];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(600); };
const text = (s) => String(s || '').replace(/\s+/g, ' ').trim();

for (const role of roles) {
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: { width: 390, height: 844 } });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, makeFlowFake(flowWorld()).route);
  const page = await ctx.newPage();
  await page.goto(`${BASE}clients.html#mine`);
  await page.fill('#lg-email', emailOf(role));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForSelector('#app-side', { state: 'attached' });
  await settle(page);
  console.log(`\n===== ${role} (${new URL(page.url()).pathname.split('/').pop()}${new URL(page.url()).hash})`);
  if (/clients\.html/.test(page.url())) {
    const mine = await page.evaluate(() => {
      const vis = (el) => !!el && !el.hidden && el.getClientRects().length > 0;
      const t = (el) => String(el?.innerText || '').replace(/\s+/g, ' ').trim();
      return {
        flow: [...document.querySelectorAll('#flow-lines a, #flow-lines li')].filter(vis).map(t),
        land: vis(document.querySelector('#land-line')) ? t(document.querySelector('#land-line')) : null,
        cards: ['#now-bar', '#staff-tasks-card', '#deals-card', '#approvals-card', '#my-questions', '#my-months'].filter((s) => vis(document.querySelector(s))).map((s) => `${s}: ${t(document.querySelector(s)).slice(0, 90)}`),
        groups: [...document.querySelectorAll('#mine-list .wgroup-h, #mine-list .team-fold, #mine-list .empty')].filter(vis).map(t),
        items: [...document.querySelectorAll('#mine-list .wproc')].map((li) => t(li).slice(0, 110)),
        quiet: vis(document.querySelector('#land-quiet')) ? t(document.querySelector('#land-quiet')).slice(0, 80) : null,
      };
    });
    console.log('MINE', JSON.stringify(mine, null, 1));
  }
  for (const p of PAGES) {
    await page.goto(`${BASE}${p}`);
    await settle(page);
    const got = await page.evaluate(() => {
      const vis = (el) => !!el && !el.hidden && el.getClientRects().length > 0;
      const t = (el) => String(el?.innerText || '').replace(/\s+/g, ' ').trim();
      const refused = [...document.querySelectorAll('#no-access, .ow-noaccess, .prod-noaccess, .msg-noaccess, .deal-noaccess')].some(vis);
      return {
        refused,
        heads: [...document.querySelectorAll('main h2, main .chip')].filter(vis).map(t).filter(Boolean).slice(0, 30),
        landing: document.querySelectorAll('.tag-landing').length,
        late: document.querySelectorAll('.is-late, .s-overdue, .late').length,
      };
    });
    console.log(p.padEnd(15), got.refused ? 'REFUSED' : `${text(got.heads.join(' | ')).slice(0, 400)}  [בקליטה tags: ${got.landing}, late marks: ${got.late}]`);
  }
  await ctx.close();
}
await browser.close();
