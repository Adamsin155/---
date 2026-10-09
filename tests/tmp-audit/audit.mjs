import { chromium } from 'playwright';
import { NOW, SUPA, emailOf, flowWorld, makeFlowFake, cid } from '../flow-world.mjs';
const BASE = process.env.BASE_URL;
const browser = await chromium.launch();
const PAGES = [
  ['irit', 'clients.html#mine'], ['irit', 'clients.html#clients'], ['irit', 'clients.html#control'], ['irit', 'prep.html'], ['irit', 'landing.html'], ['irit', 'messages.html'],
  ['ofir', 'qa.html'], ['ofir', 'pass.html'], ['lior', 'decisions.html'], ['lior', 'shoot.html'], ['eli', 'shoot.html'], ['nadia', 'editor.html'], ['irit', `client.html?id=${cid(4)}`],
  ['owner', 'owner.html'], ['owner', 'team.html'], ['ilai', 'clients.html#mine'], ['ilai', 'gantt.html'], ['irit', 'year.html'], ['irit', `intake.html?id=${cid(4)}`], ['owner', 'clients.html#team'],
];
for (const w of [360, 1280]) for (const [role, path] of PAGES) {
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: { width: w, height: 800 }, isMobile: w < 500, hasTouch: w < 500 });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, makeFlowFake(flowWorld()).route);
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}${path}`);
    await page.fill('#lg-email', emailOf(role)); await page.fill('#lg-pass', 'correct-horse'); await page.click('#lg-submit');
    await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(1200);
    await page.evaluate(() => { for (const d of document.querySelectorAll('details')) d.open = true; });
    await page.waitForTimeout(200);
    const bad = await page.evaluate(() => {
      const out = [];
      const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
      const els = [...document.querySelectorAll('button, a.btn, .chip, .ik-opt span, .tab, label.tile')].filter(vis);
      for (const e of els) {
        const name = `${e.tagName}.${e.className}#${e.id} "${e.textContent.trim().slice(0, 40)}"`;
        if (e.scrollWidth > e.clientWidth + 1) out.push(`TEXT-OVERFLOW ${name} ${e.scrollWidth}>${e.clientWidth}`);
        const r = e.getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(e); const tr = range.getBoundingClientRect();
        if (tr.width > r.width + 1 || tr.left < r.left - 1 || tr.right > r.right + 1) out.push(`SPILL ${name} text ${Math.round(tr.width)} box ${Math.round(r.width)}`);
        if (r.left < -1 || r.right > innerWidth + 1) { if (!e.closest('.table-wrap, .ctable-wrap, .tabs, table')) out.push(`OFFSCREEN ${name} ${Math.round(r.left)}..${Math.round(r.right)}`); }
      }
      if (document.documentElement.scrollWidth > innerWidth + 1) out.push(`PAGE-SCROLL ${document.documentElement.scrollWidth}`);
      return [...new Set(out)];
    });
    console.log(`== ${w} ${role} ${path}: ${bad.length ? `\n  ${bad.slice(0, 14).join('\n  ')}` : 'clean'}`);
  } catch (e) { console.log(`== ${w} ${role} ${path}: ERR ${String(e).slice(0, 120)}`); }
  await ctx.close();
}
await browser.close();
