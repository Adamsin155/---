#!/usr/bin/env node
// The worst-case sweep (docs/ops.md, section 147): every page of the app, each as the person who
// uses it, filled with the worst data we can think of, on the narrowest phones and a computer.
// Why: on 19.11 and 22.11.2026 the owner found, on his own phone, numbers that spilled out of their
// tiles ("815,375.28 ₪" on the dashboard, "2140 מתוך 3417" on מעקב לקוחות). This test looks for
// that kind of fault everywhere, with the data that brings it out:
//   - tests/worst-world.mjs: very long Hebrew business and contact names, an unbroken English name,
//     a long URL and email, a mixed Hebrew/English/digits line, 60+ tasks for a person, 45 more
//     clients;
//   - and here: every package 99 videos and 99 graphics with four-digit hand-typed counts (so every
//     total is four or five digits), 40 quotes of 815,375.28 ₪ a month, Metricool counts of 999,
//     a busy month of shoot days for the sales calendar.
// On every page x size it asserts:
//   spill     a piece of text (or a number) goes out of its tile, card, chip or button;
//   overlap   two pieces of text are drawn over each other;
//   sideways  the page scrolls sideways;
//   tap       a button lower than 44px on a phone.
// Sizes: iPhone SE and iPhone 13 (WebKit), Chromium 360, 390 and 1366.
// Screenshots (SHOTS=1) go to SHOTS_OUT, never into the repository. Nothing touches the live site:
// the database is a fake inside the browser (tests/roles-world.mjs).
//
//   node <a static server> . 8481 &
//   BASE_URL=http://localhost:8481/ node tests/worst-case-sweep-e2e.mjs
//   ONLY=tracking.html SIZES=chromium-390 … runs a part (ONLY: a substring of the page's name).
import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { NOW, SUPA, emailOf, makeFlowFake, cid } from './late-world.mjs';
import { worstWorld, LONG_BUSINESS, LONG_NAME, UNBROKEN } from './worst-world.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8481/';
const SHOTS = process.env.SHOTS === '1' && !!process.env.SHOTS_OUT;
const OUT = `${String(process.env.SHOTS_OUT || '').replace(/[\\/]+$/, '')}/`;
if (SHOTS) mkdirSync(OUT, { recursive: true });
const ONLY = process.env.ONLY || '';
const SIZES_ONLY = process.env.SIZES ? process.env.SIZES.split(',') : null;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

// ── The data ─────────────────────────────────────────────────────────────────────────────
function world() {
  const db = worstWorld();
  for (const [i, c] of db.clients.entries()) {
    c.deliverables = {
      ...(c.deliverables || {}), videos: 99, graphics: 99, shoot_days: 12,
      tracking: {
        ...(c.deliverables?.tracking || {}),
        videos: { done: i % 4 === 0 ? 9999 : 2140, by: 'irit', at: '2026-10-19T09:00:00+03:00', auto: { done: 48, of: 99 } },
        graphics: { done: i % 4 === 1 ? 9999 : 1367, by: 'irit', at: '2026-10-19T09:00:00+03:00', auto: { done: 30, of: 99 } },
        shoots: { agreed: 12, held: 11, by: 'irit', at: '2026-10-19T09:00:00+03:00' },
      },
    };
    c.contract_end ||= '2027-10-11';
    c.metricool_blog_id ||= 1000 + i;
  }
  const at = (d) => new Date(NOW.getTime() - d * 864e5).toISOString();
  db.quotes = Array.from({ length: 40 }, (_, i) => ({
    id: `f0000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, token: `t${i}`, number: `AST-2026-${String(9000 + i)}`,
    client_name: i % 3 === 0 ? LONG_NAME : i % 3 === 1 ? UNBROKEN : 'לקוח',
    monthly_gross_agorot: 81537528, term_gross_agorot: 978450336, created_at: at(i % 18), created_by_email: emailOf(i % 2 ? 'irit' : 'owner'),
    status: ['sent', 'signed', 'expired'][i % 3], first_viewed_at: i % 2 ? at(1) : null, signed_at: i % 3 === 1 ? at(i % 18) : null, signer_name: LONG_NAME,
    tier: 'Social + TV all in one', influencer: 'סמיון, מישל ודניס', doc: 'הסכם התקשרות', signable: 'true', expires_at: new Date(NOW.getTime() + 7 * 864e5).toISOString(),
    phone: '+972-50-1234567', approval: 'none', approval_by: null, approval_note: null, approval_at: null, term: '12', valid: '168',
    company: i % 2 ? LONG_BUSINESS : UNBROKEN, email: 'x@example.test', prepared_by: null, exceptions: null,
    model: { client: { company: LONG_BUSINESS, phone: '+972-50-1234567' }, package: { tierName: 'Social + TV all in one', influencer: 'סמיון, מישל ודניס' }, docTitle: 'הסכם התקשרות', signable: true, termMonths: 12, validHours: 168 },
  }));
  return db;
}
// The functions the fake world does not answer, with big numbers.
function extraRoutes(db) {
  return async (r) => {
    const p = new URL(r.request().url()).pathname;
    const json = async (data) => { await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data), headers: CORS }); return true; };
    if (p === '/rest/v1/rpc/content_months') {
      const rows = [];
      for (const c of db.clients.slice(0, 50)) for (const month of ['2026-09', '2026-10', '2026-11']) rows.push({ client_id: c.id, first_month: '2026-01', month, posted: 999, planned: 1234 });
      return json(rows);
    }
    if (p === '/rest/v1/rpc/sales_shoot_days') {
      return json(Array.from({ length: 20 }, (_, i) => ({ day: `2026-10-${String(i + 1).padStart(2, '0')}`, n: (i % 4) + 1 })));
    }
    return null;
  };
}

// ── The pages: [person, path, tab to click (optional)] ──────────────────────────────────────
const C12 = cid(12);
const PAGES = [
  ['owner', 'clients.html#mine'],
  ['owner', 'clients.html#clients'],
  ['owner', `client.html?id=${encodeURIComponent(cid(4))}`],
  ['owner', 'owner.html#now'],
  ['owner', 'owner.html#all'],
  ['owner', 'owner.html#eod'],
  ['owner', 'owner.html#work'],
  ['owner', 'owner.html#table'],
  ['owner', 'owner.html#shoots'],
  ['owner', 'owner.html#content'],
  ['owner', 'owner.html#archive'],
  ['owner', 'quotes.html'],
  ['owner', 'index.html'],
  ['owner', 'team.html'],
  ['owner', 'payments.html'],
  ['owner', 'payouts/'],
  ['owner', 'insights.html'],
  ['owner', 'calendar.html'],
  ['owner', 'ask.html'],
  ['irit', 'tracking.html', '#tab-videos'],
  ['irit', 'tracking.html', '#tab-shoots'],
  ['irit', 'tracking.html', '#tab-tasks'],
  ['irit', 'prep.html'],
  ['irit', 'messages.html'],
  ['lior', 'decisions.html'],
  ['ofir', 'qa.html'],
  ['ilai', 'year.html'],
  ['ilai', 'year.html#content'],
  ['ilai', `gantt.html?id=${encodeURIComponent(C12)}`],
  ['nadia', 'editor.html'],
  ['eli', 'shoot.html'],
  ['stav', 'deal.html'],
  ['stav', 'calendar.html'],
];
const SIZES = [
  { name: 'webkit-iphone-se', engine: webkit, device: devices['iPhone SE'], phone: true },
  { name: 'webkit-iphone13', engine: webkit, device: devices['iPhone 13'], phone: true },
  { name: 'chromium-360', engine: chromium, width: 360, phone: true },
  { name: 'chromium-390', engine: chromium, width: 390, phone: true },
  { name: 'chromium-1366', engine: chromium, width: 1366, phone: false },
].filter((s) => !SIZES_ONLY || SIZES_ONLY.includes(s.name));

// ── What runs in the page ───────────────────────────────────────────────────────────────
// Boxes a piece of text must stay inside (the nearest one up the tree).
function audit({ phone }) {
  const out = [];
  const de = document.documentElement;
  const BOX = 'button, [role="button"], [role="tab"], a.btn, .btn, .chip, .pill, .tag, .badge, .ow-stat, .stat, .tile, .card, [class*="-card"], [class*="card-"], [class*="-tile"], [class*="-chip"], dialog, .dlg, .panel, li.ow-stat';
  const shown = (el) => {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
      if (e.hidden || (e.tagName === 'DIALOG' && !e.open)) return false;
      // Inside a closed <details> only its <summary> is drawn (the rest still reports boxes).
      if (e.parentElement?.tagName === 'DETAILS' && !e.parentElement.open && e.tagName !== 'SUMMARY') return false;
      if (s.clipPath && s.clipPath !== 'none' && /inset\(50%|rect\(0/.test(s.clipPath)) return false;
      if (s.clip && s.clip !== 'auto') return false;
    }
    return true;
  };
  const fixedUp = (el) => { for (let e = el; e && e !== document.body; e = e.parentElement) { const p = getComputedStyle(e).position; if (p === 'fixed' || p === 'sticky') return true; } return false; };
  // Inside a box that scrolls sideways (a wide table) the text may go past the screen: not a fault.
  const scrollerUp = (el, stop) => { for (let e = el; e && e !== stop && e !== document.body; e = e.parentElement) { const s = getComputedStyle(e); if (/(auto|scroll)/.test(s.overflowX)) return true; } return false; };
  const ellipsisUp = (el, stop) => { for (let e = el; e && e !== stop?.parentElement && e !== document.body; e = e.parentElement) { const s = getComputedStyle(e); if (s.textOverflow === 'ellipsis' && s.overflowX !== 'visible') return true; } return false; };
  const label = (el) => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls ? `.${cls}` : ''}`;
  };
  const texts = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || /^(SCRIPT|STYLE|NOSCRIPT|OPTION|TEMPLATE|TITLE)$/.test(el.tagName) || !shown(el)) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    // What of the text can be seen: cut by every ancestor that hides its overflow (a folded
    // section, a closed accordion). Text that cannot be seen at all is not looked at.
    const clips = [];
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible') clips.push(e.getBoundingClientRect());
    }
    const seen = (r) => {
      let l = r.left, t = r.top, rt = r.right, b = r.bottom;
      for (const c of clips) { l = Math.max(l, c.left); t = Math.max(t, c.top); rt = Math.min(rt, c.right); b = Math.min(b, c.bottom); }
      return rt - l > 1 && b - t > 1 ? { left: l, top: t, right: rt, bottom: b, width: rt - l, height: b - t } : null;
    };
    const full = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
    const rects = full.map(seen).filter(Boolean);
    if (!rects.length) continue;
    const box = el.closest(BOX);
    texts.push({ el, rects, fixed: fixedUp(el), t: n.nodeValue.trim().slice(0, 40) });
    if (box && shown(box)) {
      const b = box.getBoundingClientRect();
      if (b.width < 2 || scrollerUp(el, box) || ellipsisUp(el, box)) continue;
      for (const r of full) {
        const past = Math.max(b.left - r.left, r.right - b.right, b.top - r.top, r.bottom - b.bottom);
        if (past > 2) { out.push({ kind: 'spill', where: label(box), text: n.nodeValue.trim().slice(0, 40), by: Math.round(past) }); break; }
      }
    }
  }
  // Two pieces of text over each other (not the fixed bars, which lie over the page by design).
  const flat = texts.filter((x) => !x.fixed).flatMap((x, i) => x.rects.map((r) => ({ i, r, x })));
  flat.sort((a, b) => a.r.top - b.r.top);
  for (let a = 0; a < flat.length; a += 1) {
    const A = flat[a];
    for (let b = a + 1; b < flat.length && flat[b].r.top < A.r.bottom; b += 1) {
      const B = flat[b];
      if (A.i === B.i || A.x.el.contains(B.x.el) || B.x.el.contains(A.x.el)) continue;
      const w = Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left);
      const h = Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top);
      if (w > 3 && h > Math.min(A.r.height, B.r.height) * 0.35) out.push({ kind: 'overlap', where: `${label(A.x.el)} / ${label(B.x.el)}`, text: `${A.x.t} | ${B.x.t}`, by: Math.round(w) });
    }
  }
  if (de.scrollWidth > window.innerWidth + 1) {
    const wide = [...document.body.querySelectorAll('*')].filter((e) => shown(e) && e.getBoundingClientRect().right > window.innerWidth + 1 && !scrollerUp(e.parentElement, null)).slice(-1)[0];
    out.push({ kind: 'sideways', where: wide ? label(wide) : '', text: '', by: de.scrollWidth - window.innerWidth });
  }
  if (phone) {
    for (const el of document.querySelectorAll('button, [role="button"], [role="tab"], a.btn, input[type="button"], input[type="submit"]')) {
      if (!shown(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height >= 43.5) continue;
      out.push({ kind: 'tap', where: label(el), text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30), by: Math.round(r.height) });
    }
  }
  return out;
}

// ── The run ──────────────────────────────────────────────────────────────────────────────
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(700); };
const all = [];
const errors = [];
for (const size of SIZES) {
  const browser = await size.engine.launch();
  try {
    const people = [...new Set(PAGES.filter(([, p]) => !ONLY || p.includes(ONLY)).map(([who]) => who))];
    for (const who of people) {
      const db = world();
      const fake = makeFlowFake(db);
      const extra = extraRoutes(db);
      const ctx = size.device
        ? await browser.newContext({ ...size.device, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' })
        : await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: { width: size.width, height: size.phone ? 844 : 900 }, isMobile: size.phone, hasTouch: size.phone });
      await ctx.clock.install({ time: NOW });
      await ctx.route(`${SUPA}/**`, async (r) => (await extra(r)) ?? fake.route(r));
      await ctx.route('**/sw.js', (r) => r.fulfill({ status: 404, body: '' }));
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${who} ${page.url()}: ${e}`));
      let signed = false;
      for (const [person, path, tab] of PAGES.filter(([w, p]) => w === who && (!ONLY || p.includes(ONLY)))) {
        await page.goto(`${BASE}${path}`);
        if (!signed) {
          const form = await page.waitForSelector('#lg-email', { timeout: 8000 }).catch(() => null);
          if (form) {
            await page.fill('#lg-email', emailOf(person));
            await page.fill('#lg-pass', 'correct-horse');
            await page.click('#lg-submit');
          }
          signed = true;
        }
        await settle(page);
        if (tab) { await page.click(tab).catch(() => {}); await settle(page); }
        await page.waitForTimeout(500);
        const found = await page.evaluate(audit, { phone: size.phone }).catch((e) => [{ kind: 'audit-failed', where: '', text: String(e).slice(0, 120), by: 0 }]);
        const name = `${path.replace(/[^a-z0-9]+/gi, '_')}${tab ? tab.replace('#', '_') : ''}`;
        if (SHOTS) await page.screenshot({ path: `${OUT}${name}--${size.name}.png`, fullPage: true }).catch(() => {});
        for (const f of found) all.push({ page: `${path}${tab ? ` ${tab}` : ''}`, who: person, size: size.name, ...f });
        console.log(`${size.name} ${person} ${path}${tab ? ` ${tab}` : ''}: ${found.length ? found.map((f) => f.kind).join(',') : 'ok'}`);
      }
      await ctx.close();
    }
  } finally { await browser.close(); }
}

// One line per fault (the same fault on several sizes is listed once, with its sizes).
const key = (f) => `${f.page}|${f.kind}|${f.where}|${f.text}`;
const grouped = new Map();
for (const f of all) {
  const g = grouped.get(key(f)) || { ...f, sizes: [] };
  g.sizes.push(`${f.size}(${f.by})`);
  grouped.set(key(f), g);
}
const list = [...grouped.values()];
console.log(`\n${list.length} faults`);
for (const f of list) console.log(`  [${f.kind}] ${f.page} (${f.who}) ${f.where} "${f.text}" — ${f.sizes.join(' ')}`);
if (errors.length) console.log(`\npage errors:\n  ${[...new Set(errors)].slice(0, 20).join('\n  ')}`);
assert.deepEqual(list.map((f) => `[${f.kind}] ${f.page} ${f.where} "${f.text}"`), [], 'faults found');
console.log('\nno faults');
