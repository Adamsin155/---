// The visual sweep of the manager's screens (owner.html and its tabs, insights.html, year.html,
// team.html): a picture of every tab and dialog per role at 360, 390 and 1280, against
// tests/late-world.mjs (invented names), and what can be measured on each: sideways scroll,
// boxes that stick out of the page, clipped text, small tap targets, "undefined"/"NaN".
// The pictures are written OUTSIDE the repository (SHOTS_OUT, or the system's temp folder).
// Run: npx http-server -p 8080 -s -c-1 . &  then
//      node tests/vfix-manager-shots.mjs [tag] [world: normal|worst|empty] [role,role] [page,page]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NOW, SUPA, emailOf, lateWorld, makeFlowFake } from './late-world.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const TAG = process.argv[2] || 'after';
const WORLD = process.argv[3] || 'normal';
const ROLES = (process.argv[4] || 'owner,irit,lior,ofir').split(',');
const PAGES = (process.argv[5] || 'owner,insights,year,team').split(',');
const OUT = process.env.SHOTS_OUT || join(tmpdir(), 'vfix-manager-shots');
mkdirSync(OUT, { recursive: true });
const SIZES = [[360, { width: 360, height: 740 }], [390, { width: 390, height: 844 }], [1280, { width: 1280, height: 800 }]];
const LONG = 'מרכז הרפואה המשלימה והטיפול ההוליסטי של משפחת אברהמסון־רוזנבלום והשותפים בע״מ';

function world() {
  const db = lateWorld();
  if (WORLD === 'empty') { db.clients = []; db.protocol_checks = []; db.client_tasks = []; return db; }
  if (WORLD !== 'worst') return db;
  const src = db.clients.slice();
  db.clients.forEach((c, i) => {
    if (i % 3 === 0) { c.business = `${LONG} ${i}`; c.name = 'אלכסנדרה־מרגריטה וייסברגר־אבוטבול'; }
    if (i % 4 === 0) c.package_name = 'Social all in one · פרימיום מורחב עם ליווי אישי צמוד · נטלי דדון';
    if (c.deliverables) c.deliverables = { ...c.deliverables, videos: 1250, graphics: 9999 };
  });
  for (let n = 0; n < 48; n += 1) {
    const b = src[n % src.length];
    const id = `c0000000-0000-4000-8000-${String(900 + n).padStart(12, '0')}`;
    db.clients.push({ ...b, id, business: n % 5 === 0 ? `${LONG} ${n}` : `${b.business} ${n}`, name: `${b.name} ${n}` });
    for (const k of db.protocol_checks.filter((x) => x.client_id === b.id)) db.protocol_checks.push({ ...k, client_id: id });
  }
  return db;
}

// What can be measured without looking.
const measure = (phone) => {
  const vw = document.documentElement.clientWidth;
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !e.closest('[hidden]'); };
  const name = (e) => `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''}${e.classList.length ? `.${[...e.classList].join('.')}` : ''}`;
  const scroller = (e) => { for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return p; } return null; };
  const out = { hscroll: document.documentElement.scrollWidth - vw, outside: [], clipped: [], small: [], bad: [], dashed: [], inner: [] };
  const seen = new Set();
  const root = document.querySelector('dialog[open]') || document.querySelector('main') || document.body;
  for (const e of root.querySelectorAll('*')) {
    if (!vis(e) || e.closest('.sr-only')) continue;
    const r = e.getBoundingClientRect();
    const s = getComputedStyle(e);
    if ((r.left < -1 || r.right > vw + 1) && !scroller(e) && s.position !== 'fixed') { const k = name(e); if (!seen.has(k) && out.outside.length < 12) { seen.add(k); out.outside.push(`${k} [${Math.round(r.left)}..${Math.round(r.right)}]`); } }
    const p = scroller(e);
    if (p && !/auto|scroll/.test(getComputedStyle(p).overflowX)) { const pr = p.getBoundingClientRect(); if (r.left < pr.left - 1.5 || r.right > pr.right + 1.5) { const k = `cut:${name(e)}`; if (!seen.has(k) && out.clipped.length < 12) { seen.add(k); out.clipped.push(`${name(e)} cut by ${name(p)} (${Math.round(Math.max(pr.left - r.left, r.right - pr.right))}px)`); } } }
    if (e.scrollWidth > e.clientWidth + 1 && /hidden|clip/.test(s.overflowX) && e.children.length === 0 && e.textContent.trim()) { const k = `ell:${name(e)}`; if (!seen.has(k) && out.clipped.length < 12) { seen.add(k); out.clipped.push(`${name(e)} text ${e.scrollWidth}>${e.clientWidth} "${e.textContent.trim().slice(0, 24)}"`); } }
    if (/auto|scroll/.test(s.overflowX) && e.scrollWidth > e.clientWidth + 1) out.inner.push(`${name(e)} ${e.scrollWidth}>${e.clientWidth}`);
    if (phone && e.matches('a[href], button, select, input:not([type=hidden]), [role=tab], summary') && !e.closest('.topbar, .tabs, nav') && (r.height < 43.5 || r.width < 43.5) && !(e.matches('a') && s.display === 'inline')) { const k = `s:${name(e)}`; if (!seen.has(k) && out.small.length < 14) { seen.add(k); out.small.push(`${name(e)} ${Math.round(r.width)}x${Math.round(r.height)}`); } }
    if (/dashed/.test(`${s.borderTopStyle}${s.borderBottomStyle}${s.borderInlineStartStyle}`) && parseFloat(s.borderTopWidth + s.borderBottomWidth) !== 0) { const k = `d:${name(e)}`; if (!seen.has(k) && out.dashed.length < 8) { seen.add(k); out.dashed.push(name(e)); } }
  }
  const t = root.innerText || '';
  for (const w of ['undefined', 'NaN', 'null', '[object']) if (t.includes(w)) out.bad.push(w);
  return out;
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(450); };
let count = 0;
async function shot(page, name, w, { el } = {}) {
  const phone = w < 600;
  const m = await page.evaluate(measure, phone);
  const file = join(OUT, `${TAG}-${WORLD}-${name}-${w}.png`);
  if (el) await page.locator(el).first().screenshot({ path: file }).catch(() => page.screenshot({ path: file }));
  else {
    // A long page is cut into pieces a person can read, not shrunk into one strip.
    const hgt = Math.min(await page.evaluate(() => document.documentElement.scrollHeight), phone ? 5200 : 4800);
    const step = phone ? 1300 : 1600;
    for (let y = 0, i = 0; y < hgt; y += step, i += 1) {
      await page.screenshot({ path: i ? file.replace(/\.png$/, `-p${i + 1}.png`) : file, fullPage: true, clip: { x: 0, y, width: w, height: Math.min(step, hgt - y) } });
      if (i) count += 1;
    }
  }
  count += 1;
  const notes = Object.entries(m).filter(([k, v]) => (k === 'hscroll' ? v > 0 : v.length) && k !== 'inner').map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(' ; ') : v}`);
  console.log(`${name} ${w}${notes.length ? `\n   ${notes.join('\n   ')}` : ' ok'}${m.inner.length ? `\n   (scrolls inside: ${m.inner.slice(0, 4).join(' ; ')})` : ''}`);
}
async function open(role, path, w, viewport) {
  const phone = w < 600;
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport, isMobile: phone, hasTouch: phone, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await ctx.clock.install({ time: NOW });
  const db = world();
  await ctx.route(`${SUPA}/**`, makeFlowFake(db).route);
  // The team screen's function (supabase/functions/staff-admin): the list, and a link.
  const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  await ctx.route(`${SUPA}/functions/v1/staff-admin`, async (r) => {
    const req = r.request();
    const json = (data) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data), headers: CORS });
    if (req.method() === 'OPTIONS') return json({});
    const body = JSON.parse(req.postData() || '{}');
    if (body.action === 'link') return json({ link: `${BASE}clients.html#access_token=${'x'.repeat(120)}`, type: 'recovery' });
    if (body.action !== 'list') return json({ ok: true });
    const staff = WORLD === 'empty' ? db.staff.slice(0, 1) : db.staff;
    return json({ caller: { email: emailOf(role), person: role === 'owner' ? null : role, owner: role === 'owner', vault: true }, rows: staff.map((x, i) => ({
      email: WORLD === 'worst' && i % 3 === 1 ? `alexandra.margarita.weissberger.abutbul.${i}@astrateg-long-domain.test` : x.email, person: x.person, vault: !!x.vault, phone: i % 2 ? '972500000001' : null, created_at: '2026-09-01T09:00:00+03:00',
      has_login: i % 4 !== 3, confirmed: i % 3 !== 2, last_sign_in_at: i % 3 === 0 ? '2026-10-20T08:00:00+03:00' : i % 3 === 1 ? '2026-10-12T08:00:00+03:00' : null, invited_at: i % 3 === 2 ? '2026-10-18T08:00:00+03:00' : null, last_link_at: i % 2 ? '2026-10-19T08:00:00+03:00' : null, last_link_by: i % 2 ? emailOf('owner') : null })) });
  });
  // The archive: two clients (one with a very long name), or none in the empty office.
  await ctx.route(`${SUPA}/rest/v1/rpc/archived_clients`, (r) => (r.request().method() === 'OPTIONS' ? r.fulfill({ status: 200, headers: CORS, body: '' })
    : r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(WORLD === 'empty' ? [] : [
      { id: 'c0000000-0000-4000-8000-000000000801', label: WORLD === 'worst' ? `${LONG} · אלכסנדרה־מרגריטה וייסברגר־אבוטבול` : 'סטודיו דנה · דנה לב', package_name: 'Social all in one · נטלי דדון', contract_end: '2026-09-01', archived_at: '2026-10-12T09:00:00+03:00', archived_by: emailOf('ofir') },
      { id: 'c0000000-0000-4000-8000-000000000802', label: 'גן הפרחים · רון גן', package_name: null, contract_end: null, archived_at: '2026-10-01T09:00:00+03:00', archived_by: null }]) })));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  ! ${role} ${path}: ${e}`));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) console.log(`  ! ${role} ${path}: ${msg.text()}`); });
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', emailOf(role));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForSelector('#app:not([hidden])', { timeout: 8000 }).catch(() => {});
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-boot') && !document.documentElement.hasAttribute('data-door'), null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(900);
  await settle(page);
  return { page, ctx };
}
const closeDlg = (page) => page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));

for (const role of ROLES) {
  for (const [w, viewport] of SIZES) {
    if (PAGES.includes('owner')) {
      const { page, ctx } = await open(role, 'owner.html', w, viewport);
      const tabs = await page.$$eval('#ow-tabs .tab:not([hidden])', (l) => l.map((t) => t.id));
      for (const id of tabs) {
        await page.evaluate((i) => document.getElementById(i).click(), id);
        await settle(page);
        await shot(page, `${role}-owner-${id}`, w);
        if (id === 'tab-now') {
          const ask = page.locator('#ow-rows button', { hasText: 'שאלה' }).first();
          if (await ask.count()) { await ask.click().catch(() => {}); await settle(page); if (await page.locator('#dlg-ask[open]').count()) await shot(page, `${role}-owner-dlg-ask`, w, { el: '#dlg-ask' }); await closeDlg(page); }
        }
        if (id === 'tab-all') {
          const row = page.locator('#ga-list > li button, #ga-list > li summary').first();
          if (await row.count()) { await row.click().catch(() => {}); await settle(page); await shot(page, `${role}-owner-tab-all-open`, w); }
        }
        if (id === 'tab-archive') {
          const del = page.locator('#ar-list button', { hasText: 'מחיקה' }).first();
          if (await del.count()) { await del.click().catch(() => {}); await settle(page); if (await page.locator('#dlg-purge[open]').count()) await shot(page, `${role}-owner-dlg-purge`, w, { el: '#dlg-purge' }); await closeDlg(page); }
        }
      }
      await ctx.close();
    }
    for (const p of ['insights', 'year', 'team']) {
      if (!PAGES.includes(p)) continue;
      const { page, ctx } = await open(role, `${p}.html`, w, viewport);
      await shot(page, `${role}-${p}`, w);
      if (p === 'insights' && await page.locator('main details').count()) { await page.evaluate(() => document.querySelectorAll('main details').forEach((d) => { d.open = true; })); await settle(page); await shot(page, `${role}-insights-open`, w); }
      if (p === 'team') {
        const btns = await page.$$eval('main button:not([hidden])', (l) => l.filter((b) => b.offsetParent && !b.closest('#login-block')).map((b) => b.textContent.trim()).filter((t, i, a) => t && a.indexOf(t) === i).slice(0, 8));
        for (const t of btns) {
          const b = page.locator('main button:visible', { hasText: t }).first();
          await b.click({ timeout: 1500 }).catch(() => {});
          await page.waitForTimeout(300);
          if (await page.locator('dialog[open]').count()) { await shot(page, `${role}-team-dlg-${btns.indexOf(t)}`, w, { el: 'dialog[open]' }); await closeDlg(page); }
        }
      }
      await ctx.close();
    }
  }
}
await browser.close();
console.log(`${count} pictures in ${OUT}`);
