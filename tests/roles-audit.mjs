// Walks every role from sign-in on a phone and saves what each one sees: a full-page
// screenshot per screen and a line of numbers (page height, sideways scroll, small
// tap targets, the links offered). No assertions: tests/roles-phone-e2e.mjs has them.
// Run: npx http-server -p 8099 -s -c-1 . &   then
//      BASE_URL=http://localhost:8099/ node tests/roles-audit.mjs <outDir> [prefix] [role,role]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { NOW, SUPA, ROLES, emailOf, buildWorld, makeFake } from './roles-world.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || '.playwright-mcp/ux-review';
const PREFIX = process.argv[3] || 'before';
const ONLY = process.argv[4] ? process.argv[4].split(',') : null;
const WIDTH = Number(process.env.WIDTH || 375);
mkdirSync(`${OUT}/parts`, { recursive: true });

// The pages each role is taken through after the first screen.
const C7 = 'c0000000-0000-4000-8000-000000000007';
const C12 = 'c0000000-0000-4000-8000-000000000012';
const TOUR = {
  owner: ['clients.html#mine', 'owner.html#all', 'owner.html#table', `client.html?id=${C12}`, 'team.html', 'decisions.html', 'qa.html'],
  irit: ['clients.html#clients', 'clients.html#control', 'owner.html#now', 'messages.html', 'prep.html', `client.html?id=${C12}`, 'index.html', 'quotes.html'],
  lior: ['clients.html#mine', 'shoot.html', `scripts.html?id=${C7}`, 'insights.html', 'year.html'],
  ofir: ['clients.html#mine', 'pass.html', 'owner.html#table'],
  ilai: ['clients.html#clients', `gantt.html?id=${C12}`, `client.html?id=${C12}`, 'year.html'],
  nirel: ['clients.html#mine', 'clients.html#clients'],
  nadia: ['clients.html#mine', 'clients.html#clients', `client.html?id=${C12}`, 'clients.html#performance'],
  eli: ['clients.html#mine', `client.html?id=${C7}`],
  stav: ['clients.html'],
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const report = [];
for (const role of Object.keys(ROLES)) {
  if (ONLY && !ONLY.includes(role)) continue;
  if (!TOUR[role]) continue;
  const db = buildWorld();
  const fake = makeFake(db);
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: { width: WIDTH, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, fake.route);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
  const settle = async () => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(500); };
  const measure = async (name) => {
    await settle();
    const m = await page.evaluate(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
      const targets = [...document.querySelectorAll('a, button, select, input:not([type=hidden]), summary, [role=tab]')].filter(vis).filter((el) => !el.closest('dialog:not([open])'));
      const small = targets.filter((el) => { const r = el.getBoundingClientRect(); return r.height < 40 || r.width < 24; }).filter((el) => !(el.matches('input[type=checkbox], input[type=radio]') && el.closest('label')));
      const txt = (el) => (el.innerText || el.getAttribute('aria-label') || el.id || el.tagName).trim().slice(0, 28);
      const wide = [...document.querySelectorAll('body *')].filter(vis).filter((el) => { const r = el.getBoundingClientRect(); return r.right > innerWidth + 1 || r.left < -1; }).filter((el) => !el.closest('.mt-scroll, .table-scroll, [data-hscroll]'));
      return {
        url: location.pathname.split('/').pop() + location.search.replace(/id=[^&]+/, 'id=…') + location.hash,
        height: document.documentElement.scrollHeight,
        hscroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        nav: [...document.querySelectorAll('header.topbar a, header.topbar button')].filter(vis).map(txt),
        head: [...document.querySelectorAll('.head-actions a, .head-actions button, #mode-bar a, #mode-bar button, .tabs [role=tab]')].filter(vis).map(txt),
        h1: document.querySelector('h1')?.innerText || '',
        small: small.length, smallList: small.slice(0, 12).map((el) => `${txt(el)}(${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)})`),
        wide: wide.slice(0, 5).map((el) => `${el.tagName}.${String(el.className).slice(0, 30)}`),
        latin: [...new Set((document.querySelector('main')?.innerText || '').match(/\b[A-Za-z]{4,}\b/g) || [])].slice(0, 15),
        denied: /אין לך גישה|אינו מורשה|אין הרשאה/.test(document.body.innerText),
      };
    });
    await page.screenshot({ path: `${OUT}/${PREFIX}-${role}-${name}.png`, fullPage: true });
    for (let part = 0; part < Math.min(3, Math.ceil(m.height / 1500)); part += 1) await page.screenshot({ path: `${OUT}/parts/${PREFIX}-${role}-${name}-p${part + 1}.png`, fullPage: true, clip: { x: 0, y: part * 1500, width: WIDTH, height: Math.min(1500, m.height - part * 1500) } });
    report.push({ role, name, ...m, errors: errors.splice(0) });
    console.log(`${role} ${name}: ${m.url} h=${m.height} hscroll=${m.hscroll} small=${m.small}${m.denied ? ' DENIED' : ''}`);
  };
  await page.goto(`${BASE}clients.html`);
  await page.fill('#lg-email', emailOf(role));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await measure('00-first');
  let i = 1;
  for (const path of TOUR[role]) {
    await page.goto(`${BASE}${path}`);
    if (path.includes('#')) await page.reload();
    if (path.startsWith('gantt.html')) { await settle(); const b = page.getByRole('button', { name: 'יצירת הגאנט מהתבנית' }); if (await b.count()) { await b.click(); await settle(); } }
    await measure(`${String(i).padStart(2, '0')}-${path.replace(/\?.*$/, '').replace(/[^\w]+/g, '-')}`);
    i += 1;
  }
  await ctx.close();
}
await browser.close();
const { writeFileSync } = await import('node:fs');
writeFileSync(`${OUT}/${PREFIX}-report.json`, JSON.stringify(report, null, 1));
for (const r of report) {
  console.log(`\n## ${r.role} ${r.name} — ${r.url} — h=${r.height} hscroll=${r.hscroll}`);
  console.log(`  h1: ${r.h1}`);
  console.log(`  nav: ${r.nav.join(' | ')}`);
  console.log(`  head: ${r.head.join(' | ')}`);
  if (r.small) console.log(`  small(${r.small}): ${r.smallList.join(' ; ')}`);
  if (r.wide.length) console.log(`  wide: ${r.wide.join(' ; ')}`);
  if (r.latin.length) console.log(`  latin: ${r.latin.join(' ')}`);
  if (r.errors.length) console.log(`  errors: ${r.errors.slice(0, 4).join(' || ').slice(0, 500)}`);
}
