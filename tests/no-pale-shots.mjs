#!/usr/bin/env node
// The pictures of docs/ops.md section 61 ("no pale rows"): every view of clients.html and
// the client's card, per role, at 390 and 1280, against tests/late-world.mjs (an invented
// office: nothing here touches the live site or the real project). Each view is cut into
// slices a person can read. The pictures go OUTSIDE the repository.
//
//   node tests/no-pale-shots.mjs <before|after> --out <dir> [--role irit,ofir] [--size 390] [--only mine,full,late,tabs,team,card]
import { chromium } from 'playwright';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { NOW, SUPA, emailOf, lateWorld, makeFlowFake, cid } from './late-world.mjs';
import { worstWorld } from './worst-world.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const arg = (name) => { const i = argv.indexOf(`--${name}`); return i < 0 ? null : argv[i + 1]; };
const list = (name) => (arg(name) ? arg(name).split(',') : null);
const STAGE = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'after';
const OUT = path.resolve(arg('out') || path.join(os.tmpdir(), 'astrateg-no-pale'), STAGE);
const WORLD = arg('world') === 'worst' ? worstWorld : lateWorld;
const SIZES = { 360: { width: 360, height: 740 }, 390: { width: 390, height: 844 }, 1280: { width: 1280, height: 900 } };
const ROLES = list('role') || ['irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'eli', 'owner'];
const WIDTHS = (list('size') || ['390', '1280']).map(Number);
const ONLY = list('only');
const want = (k) => !ONLY || ONLY.includes(k);
const PROFILED = ['owner', 'irit', 'lior', 'ofir'];
const CARD = { owner: 12, irit: 4, lior: 7, ofir: 12, ilai: 17, nirel: 15, nadia: 12, eli: 7 };

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const srv = await new Promise((done) => {
  const s = http.createServer(async (req, rsp) => {
    try {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT)) throw new Error('outside');
      rsp.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      rsp.end(await readFile(file));
    } catch { rsp.writeHead(404); rsp.end('not found'); }
  });
  s.listen(0, () => done(s));
});
const BASE = `http://localhost:${srv.address().port}/`;
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const settle = async (page, ms = 500) => { await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {}); await page.waitForTimeout(ms); };

async function open(role, w, pathName, { profile = null, full = false } = {}) {
  const phone = w < 600;
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: SIZES[w], isMobile: phone, hasTouch: phone, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, makeFlowFake(WORLD()).route);
  await ctx.addInitScript(({ profile: p, full: f }) => {
    try { if (p) sessionStorage.setItem('astrateg.profile', p); if (f) sessionStorage.setItem('astrateg.mine.full', 'on'); } catch { /* no storage */ }
  }, { profile, full });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  ! ${role} ${pathName}: ${e}`));
  await page.goto(`${BASE}clients.webmanifest`);
  await page.evaluate(async ({ supa, email }) => {
    const r = await fetch(`${supa}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'correct-horse' }) });
    localStorage.setItem('sb-czncjzziqrqtezpwxxpz-auth-token', JSON.stringify(await r.json()));
  }, { supa: SUPA, email: emailOf(role) });
  await page.goto(BASE + pathName);
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-boot'), null, { timeout: 12000 }).catch(() => {});
  await settle(page);
  return { ctx, page };
}
// The whole page in slices of `step` pixels (at most `cap`), so that each can be read.
async function slices(page, name, w, { cap = 6, step = w < 600 ? 1500 : 1300, from = 0 } = {}) {
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  let i = 0;
  for (let y = from; y < h && i < cap; y += step) {
    i += 1;
    await page.screenshot({ path: path.join(OUT, `${name}-${w}-${i}.png`), fullPage: true, clip: { x: 0, y, width: w, height: Math.min(step, h - y) } });
  }
  console.log(`  ${name}-${w} (${i})`);
}
const openAll = (page) => page.evaluate(() => {
  for (const d of document.querySelectorAll('main details:not([open])')) if (d.checkVisibility()) d.open = true;
  for (const b of document.querySelectorAll('main [aria-expanded=false]')) if (b.checkVisibility() && !b.getAttribute('aria-haspopup') && !b.closest('dialog')) b.click();
});

for (const w of WIDTHS) {
  for (const role of ROLES) {
    if (want('mine')) {
      const { ctx, page } = await open(role, w, 'clients.html#mine');
      await slices(page, `${role}-mine`, w);
      if (want('open')) { await openAll(page); await settle(page, 300); await slices(page, `${role}-mine-open`, w, { cap: 8 }); }
      await ctx.close();
    }
    if (want('full')) {
      const { ctx, page } = await open(role, w, 'clients.html#mine', { full: true });
      await slices(page, `${role}-full`, w, { cap: 5 });
      await ctx.close();
    }
    if (want('tabs')) {
      const { ctx, page } = await open(role, w, 'clients.html#mine');
      const tabs = await page.evaluate(() => [...document.querySelectorAll('[role=tab]')].filter((x) => x.checkVisibility() && x.id && x.getAttribute('aria-selected') !== 'true').map((x) => x.id));
      for (const id of tabs) {
        await page.click(`#${id}`).catch(() => {});
        await settle(page, 400);
        await slices(page, `${role}-${id}`, w, { cap: id === 'tab-control' ? 6 : 3 });
      }
      await ctx.close();
    }
    if (want('team') && PROFILED.includes(role)) {
      const { ctx, page } = await open(role, w, 'clients.html#team', { profile: 'manager' });
      await slices(page, `${role}-team`, w, { cap: 4 });
      // The other tabs of the manager profile (the numbers of the whole team are here).
      const tabs = await page.evaluate(() => [...document.querySelectorAll('[role=tab]')].filter((x) => x.checkVisibility() && x.id && x.getAttribute('aria-selected') !== 'true').map((x) => x.id));
      for (const id of tabs.filter((t) => t === 'tab-performance' || (role === 'owner' && t === 'tab-control'))) {
        await page.click(`#${id}`).catch(() => {});
        await settle(page, 900);
        await slices(page, `${role}-team-${id}`, w, { cap: 5 });
      }
      await ctx.close();
    }
    if (want('card') && CARD[role]) {
      const { ctx, page } = await open(role, w, `client.html?id=${cid(CARD[role])}`);
      await page.waitForSelector('#fl-slot .fl-block', { timeout: 5000 }).catch(() => {});
      await settle(page);
      await slices(page, `${role}-card`, w, { cap: 8 });
      if (want('open')) { await openAll(page); await settle(page, 300); await slices(page, `${role}-card-open`, w, { cap: 10 }); }
      await ctx.close();
    }
  }
}
await browser.close();
srv.close();
console.log(`pictures: ${OUT}`);
