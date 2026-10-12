// Scratch: what the session's store holds after each step.
import { chromium } from 'playwright';
import { NOW, SUPA, emailOf, buildWorld, makeFake } from './roles-world.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:5402/';
const browser = await chromium.launch();
const fake = makeFake(buildWorld());
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
await ctx.clock.install({ time: NOW });
const seen = [];
await ctx.route(`${SUPA}/**`, (route) => { const u = new URL(route.request().url()); seen.push(`${route.request().method()} ${u.pathname.replace('/rest/v1/', '')}`); return fake.route(route); });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('ERROR', String(e).slice(0, 300)));
page.on('console', (m) => { if (/cache|store/i.test(m.text())) console.log('LOG', m.text().slice(0, 300)); });
const dump = async (label) => {
  const s = await page.evaluate(() => {
    const idx = JSON.parse(sessionStorage.getItem('astrateg.cache') || 'null');
    const entries = Object.keys(sessionStorage).filter((k) => k.startsWith('astrateg.cache.') && !/sizes|again/.test(k)).map((k) => { const e = JSON.parse(sessionStorage.getItem(k)); return `${e.key.slice(0, 70)} (${e.body.length})`; });
    return { now: Date.now(), uid: idx?.uid, wrote: idx?.wrote, n: Object.keys(idx?.e || {}).length, ns: idx?.ns, total: entries.reduce((n, e) => n + Number(/\((\d+)\)$/.exec(e)[1]), 0), entries, stale: document.documentElement.hasAttribute('data-stale'), sizes: Object.keys(JSON.parse(sessionStorage.getItem('astrateg.cache.sizes') || '{}')) };
  });
  console.log(`\n== ${label}: now ${s.now} uid ${s.uid} wrote ${s.wrote} entries ${s.n} chars ${s.total} stale ${s.stale} sizes ${JSON.stringify(s.sizes)} unsteady ${JSON.stringify(s.ns)}`);
  if (process.env.FULL) for (const e of s.entries.sort()) console.log('   ', e);
  console.log('   asked of the server:', seen.splice(0).join(', ').slice(0, 1500));
};
await page.goto(`${BASE}clients.html`, { waitUntil: 'domcontentloaded' });
await page.fill('#lg-email', emailOf(process.argv[2] || 'irit'));
await page.fill('#lg-pass', 'correct-horse');
await page.click('#lg-submit');
await page.waitForFunction(() => !('boot' in document.documentElement.dataset) && !document.querySelector('#lg-email')?.offsetParent, null, { timeout: 30000 });
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1000);
await dump('after sign-in');
for (const url of ['client.html?id=c0000000-0000-4000-8000-000000000012', 'clients.html#mine', 'client.html?id=c0000000-0000-4000-8000-000000000012', 'clients.html#mine']) {
  await page.goto('about:blank');
  await ctx.clock.fastForward(8000);
  await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !('boot' in document.documentElement.dataset), null, { timeout: 30000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1200);
  await dump(url);
}
await browser.close();
