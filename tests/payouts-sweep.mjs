#!/usr/bin/env node
// The visual sweep of the payouts app (docs/ops.md, section 56): every screen and state of
// payouts/, on phones and on a wide screen, against invented months (a fake Supabase in
// the browser: nothing here touches the live site or the real project, and no real name,
// rate or amount is in this file). For each screen it measures the visual faults below,
// lists every colour the browser computed, and takes screenshots OUTSIDE the repository.
// tests/visual-sweep.mjs sweeps the staff pages; this app has its own sign-in, its own
// tables and no roles, so it has its own short sweep with the same kind of checks.
//
//   node tests/payouts-sweep.mjs                    the whole matrix
//   node tests/payouts-sweep.mjs --world worst --size 360
//   node tests/payouts-sweep.mjs --scheme dark      the system's dark setting (the look must not change)
//   --out <dir>   where the screenshots, findings.json and colours.json go (default: the system temp dir)
//   --pdf         also prints the commission statement to statement.pdf (page count in the summary)
// Exit code: 1 when a high finding exists, else 0.
import { chromium } from 'playwright';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { computeMonth } from '../app/payouts/engine.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const arg = (name) => { const i = argv.indexOf(`--${name}`); if (i < 0) return null; const v = argv[i + 1]; return v && !v.startsWith('--') ? v : '1'; };
const pick = (name) => (arg(name) ? arg(name).split(',') : null);
const OUT = path.resolve(arg('out') || path.join(os.tmpdir(), 'astrateg-payouts-sweep'));
const SCHEME = arg('scheme') === 'dark' ? 'dark' : 'light';
const SUPA = 'https://czncjzziqrqtezpwxxpz.supabase.co';
const MONTH = '2026-09';

// `safe`: an installed iPhone app; the insets are real env(safe-area-inset-*) values.
const SIZES = {
  360: { w: 360, h: 740, phone: true },
  '390pwa': { w: 390, h: 844, phone: true, safe: [59, 34] },
  '393pwa': { w: 393, h: 852, phone: true, safe: [59, 34] },
  1280: { w: 1280, h: 800 },
  1440: { w: 1440, h: 900 },
};
const PLAN = {
  normal: ['360', '390pwa', '393pwa', '1280', '1440'],
  worst: ['360', '390pwa', '1280'],
  empty: ['360', '390pwa', '1280'],
  locked: ['390pwa', '1280'],
  nosettings: ['390pwa'],
};

// ── The invented months ──────────────────────────────────────────────────────────────
const ils = (n) => Math.round(n * 100);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const OWNER = { id: randomUUID(), email: 'owner@astrateg.test', aud: 'authenticated', role: 'authenticated' };
const OTHER = { id: randomUUID(), email: 'seller@astrateg.test', aud: 'authenticated', role: 'authenticated' };
const EXP = Math.floor(Date.now() / 1000) + 3600;
const jwt = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp: EXP })}.sig`;
const USERS = { [OWNER.email]: OWNER, [OTHER.email]: OTHER };
const LONG = 'מסעדת־השף־הגדולה־והמפורסמת־ביותר־בכל־אזור־השרון־והצפון־בע״מ';
const LONG2 = 'חברת ההפקות והאירועים הבינלאומית של האחים לבית משפחת בדיקה ארוכה מאוד ושותפיהם';

function settings(worst) {
  const n = (short, long) => (worst ? long : short);
  return {
    payment: { realBp: 800, commissionBp: 1000, checksRealBp: 300 },
    commissionPeople: [
      { id: 'a', name: n('מוכרת בדיקה', 'מוכרת־בדיקה־עם־שם־משפחה־כפול־וארוך־במיוחד'), rates: { simeon: 1000, natali: 2000 } },
      { id: 'b', name: n('מנהל בדיקה', 'מנהל המכירות הארצי של הבדיקה הארוכה'), rates: { simeon: 500, natali: 500 } },
    ],
    items: {
      'natali-story': { real: ils(1111), commission: ils(2222), per: 'unit' },
      'natali-reel': { real: null, commission: null, per: 'unit' },
      'simeon-story': { real: ils(400), commission: ils(400), per: 'unit' },
      'simeon-collab': { real: 0, commission: 0, per: 'unit' },
      'simeon-day': { real: ils(500), commission: ils(500), per: 'unit' },
      'simeon-join': { real: 0, commission: 0, per: 'deal' },
      ch14: { real: ils(2000), commission: ils(2000), per: 'unit' },
      'photographer-monthly': { real: ils(10000), commission: ils(10000), per: 'unit' },
      graphics: { real: ils(300), commission: ils(300), per: 'deal' },
    },
    production: {
      'social-simeon': { influencer: ils(5000), photographer: ils(100), makeup: 0 },
      'social-tv-simeon': { influencer: ils(5000), photographer: ils(100), makeup: 0 },
      'social-natali': { influencer: ils(4000), photographer: ils(100), makeup: ils(50) },
      'social-tv-natali': { influencer: ils(4000), photographer: ils(100), makeup: ils(50) },
      'podcast-simeon': { influencer: ils(3000), photographer: ils(100), makeup: 0 },
      'podcast-natali': { influencerPerDay: ils(9000), clientsPerDay: 3, makeupPerDay: ils(70), photographer: ils(100), makeup: 0 },
    },
    payees: { influencer: { simeon: 'משפיען ס', natali: 'משפיענית נ' }, photographer: 'צלם', makeup: 'מאפרת' },
    employees: [
      { id: 'e1', name: n('עובד בדיקה', 'עובדת־בדיקה־ותיקה־עם־שם־ארוך־ולא־נשבר־בכלל'), role: 'עורך', salary: ils(worst ? 1234567.89 : 1000), payroll: true },
      { id: 'e2', name: 'פרילנסרית בדיקה', role: 'גרפיקה', salary: ils(800), payroll: false },
    ],
    employerCostBp: 2000,
    perDealPeople: [{ id: 'c1', name: n('סוגר בדיקה', 'סוגר העסקאות של הבדיקה עם שם ארוך מאוד'), amount: ils(250) }],
    meetingRate: ils(40),
    meetingPayee: n('מוכרת בדיקה', 'מוכרת־בדיקה־עם־שם־משפחה־כפול־וארוך־במיוחד'),
    expenses: [
      { id: 'x1', name: n('פרסום בדיקה', 'פרסום ממומן בכל הרשתות החברתיות ובמנועי החיפוש לחודש הזה'), amount: ils(worst ? 250000000 : 500) },
      { id: 'x2', name: 'משרד בדיקה', payee: 'משכיר בדיקה', amount: ils(300) },
    ],
    partners: [
      { id: 'p1', name: n('שותף 1', 'שותף־ראשון־עם־שם־ארוך־מאוד־מאוד־ולא־נשבר'), weight: 1 },
      { id: 'p2', name: 'שותף 2', weight: 1 },
    ],
  };
}
const pkg = (tier, influencer, more = {}) => ({ tier, influencer, paid: [], free: { graphics: 0, simeonStories: 0, simeonJoin: false, extraCh14: false }, discount: 0, ...more });
function deal(client, date, selection, more = {}) {
  return { id: randomUUID(), created_at: `${date}T09:00:00Z`, deal_date: date, client, selection, perks: [], seller: null, note: null, quote_id: null, cancelled_on: null, paid_months: null, pay_method: 'payment', installments: null, term_months: 12, ...more };
}
function world(kind) {
  const worst = kind === 'worst';
  const S = settings(worst);
  const closer = S.perDealPeople[0].name;
  const t = {
    payout_owners: [{ user_id: OWNER.id, email: OWNER.email }],
    payout_settings: kind === 'nosettings' ? [] : [
      { id: randomUUID(), effective_from: '2026-01-01', data: S, note: 'בדיקה', created_at: '2026-01-01T08:00:00Z' },
      { id: randomUUID(), effective_from: '2025-06-01', data: S, note: worst ? 'עדכון אחוזי העמלה של כל אנשי המכירות לקראת השנה החדשה, אחרי הישיבה' : null, created_at: '2025-06-01T08:00:00Z' },
    ],
    payout_deals: [], payout_incomes: [], payout_expenses: [], payout_locks: [], payout_performed: [],
  };
  if (kind === 'empty' || kind === 'nosettings') return t;
  const first = deal(worst ? LONG : 'מסעדת הבדיקה', `${MONTH}-14`, pkg('social-tv', 'natali', { paid: ['photographer'], discount: 10000 }), { perks: [{ id: 'natali-story', qty: 1 }], seller: S.commissionPeople[0].name });
  const second = deal(worst ? LONG2 : 'לקוח שני', `${MONTH}-20`, pkg('social', 'simeon', { free: { graphics: 24, simeonStories: 2, simeonJoin: false, extraCh14: false } }), { seller: closer });
  const cheques = deal('לקוח צ׳קים', `${MONTH}-05`, pkg('social', 'natali'), { pay_method: 'checks', installments: 12 });
  const half = deal('לקוח חצי שנתי', `${MONTH}-06`, pkg('social', 'simeon'), { term_months: 6 });
  const personal = deal('לקוח ותיק', `${MONTH}-21`, { custom: true, influencer: 'simeon', amount: ils(worst ? 98765432.1 : 30000), shootDays: 2 });
  const podcast = deal('פודקאסט בדיקה', `${MONTH}-09`, pkg('podcast', 'natali'));
  const cancelledNow = deal('לקוח שהתחרט', `${MONTH}-02`, pkg('social', 'simeon'), { cancelled_on: `${MONTH}-25`, paid_months: 0 });
  const oldCancelled = deal(worst ? `${LONG} (סניף שני)` : 'לקוח מיולי', '2026-07-10', pkg('social-tv', 'natali'), { cancelled_on: `${MONTH}-18`, paid_months: 2 });
  const oldCheques = deal('צ׳קים ממרץ', '2026-03-12', pkg('social', 'simeon'), { pay_method: 'checks', installments: 12 });
  t.payout_deals.push(first, second, cheques, half, personal, podcast, cancelledNow, oldCancelled, oldCheques);
  if (worst) {
    for (let i = 0; i < 38; i += 1) {
      const day = String((i % 27) + 1).padStart(2, '0');
      t.payout_deals.push(deal(`לקוח מספר ${i + 1}${i % 7 === 0 ? ` ${LONG}` : ''}`, `${MONTH}-${day}`, pkg(i % 3 ? 'social' : 'social-tv', i % 2 ? 'simeon' : 'natali'), { seller: i % 4 ? null : closer }));
    }
  }
  t.payout_incomes.push({ id: randomUUID(), created_at: `${MONTH}-03T09:00:00Z`, income_date: `${MONTH}-03`, label: worst ? `שיקים של ${LONG2}` : 'שיקים של לקוח ישן', family: 'natali', amount_agorot: ils(1234.5), note: null });
  t.payout_expenses.push(
    { id: randomUUID(), created_at: `${MONTH}-04T09:00:00Z`, month: MONTH, kind: 'other', label: worst ? 'אירוע לקוחות שנתי גדול עם הופעה, כיבוד ומתנות לכל המשתתפים' : 'אירוע לקוחות', payee: worst ? LONG : 'ספק בדיקה', qty: null, amount_agorot: ils(750) },
    { id: randomUUID(), created_at: `${MONTH}-05T09:00:00Z`, month: MONTH, kind: 'meetings', label: 'תיאום פגישות', payee: S.meetingPayee, qty: 5, amount_agorot: ils(200) },
    { id: randomUUID(), created_at: `${MONTH}-06T09:00:00Z`, month: MONTH, kind: 'fuel', label: 'דלק', payee: S.employees[0].name, qty: null, amount_agorot: ils(320) },
  );
  t.payout_performed.push(
    { deal_id: second.id, task_key: 'day:1', performed_on: `${MONTH}-22` },
    { deal_id: podcast.id, task_key: 'recording', performed_on: `${MONTH}-23` },
    { deal_id: cancelledNow.id, task_key: 'day:1', performed_on: `${MONTH}-27` },
  );
  if (kind === 'locked') {
    const fromRow = (r) => ({ id: r.id, date: r.deal_date, client: r.client, selection: r.selection, perks: r.perks, seller: r.seller || '', cancelledOn: r.cancelled_on, paidMonths: r.paid_months, payMethod: r.pay_method, installments: r.installments, termMonths: r.term_months });
    const report = computeMonth({
      month: MONTH,
      deals: t.payout_deals.map(fromRow),
      incomes: t.payout_incomes.map((e) => ({ id: e.id, date: e.income_date, label: e.label, family: e.family, amount: e.amount_agorot })),
      expenses: t.payout_expenses.map((e) => ({ id: e.id, month: e.month, kind: e.kind, label: e.label, payee: e.payee, qty: e.qty, amount: e.amount_agorot })),
      versions: t.payout_settings.map((r) => ({ effectiveFrom: r.effective_from, data: r.data })).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1)),
    });
    t.payout_locks.push({ month: MONTH, report: JSON.parse(JSON.stringify(report)), locked_at: '2026-10-02T07:30:00Z' });
  }
  return t;
}

// ── The fake Supabase (the calls app/payouts/data.js makes) ──────────────────────────
function applyFilters(rows, params) {
  let out = rows;
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'on_conflict', 'columns'].includes(k)) continue;
    const [op, ...rest] = v.split('.');
    const val = rest.join('.');
    const get = (r) => (k.includes('->>') ? r[k.split('->>')[0]]?.[k.split('->>')[1]] : r[k]);
    if (op === 'eq') out = out.filter((r) => String(get(r)) === val);
    else if (op === 'gte') out = out.filter((r) => r[k] >= val);
    else if (op === 'lte') out = out.filter((r) => r[k] <= val);
    else if (op === 'not' && val === 'is.null') out = out.filter((r) => r[k] !== null && r[k] !== undefined);
  }
  const order = params.get('order');
  if (order) {
    const [col, dir] = order.split('.');
    out = [...out].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === 'desc' ? -1 : 1));
  }
  if (params.get('limit')) out = out.slice(0, Number(params.get('limit')));
  return out;
}
const fakeFor = (tables) => async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  const json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data), headers });
  if (req.method() === 'OPTIONS') return json(200, {});
  const p = url.pathname;
  if (p === '/auth/v1/token') {
    const u = USERS[body.email];
    if (!u || body.password !== 'correct-horse') return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials', code: 'invalid_credentials' });
    return json(200, { access_token: jwt(u), token_type: 'bearer', expires_in: 3600, expires_at: EXP, refresh_token: 'r', user: u });
  }
  if (p === '/auth/v1/recover') return json(200, {});
  if (p === '/auth/v1/user') return json(200, OWNER);
  if (p === '/auth/v1/logout') return route.fulfill({ status: 204, headers });
  const m = p.match(/^\/rest\/v1\/(\w+)$/);
  if (!m) return json(404, { message: 'not found' });
  const t = m[1];
  const auth = req.headers().authorization || '';
  const who = [OWNER, OTHER].find((u) => auth.includes(jwt(u)));
  if (t === 'payout_owners') return json(200, applyFilters(tables.payout_owners, url.searchParams).filter((r) => r.user_id === who?.id));
  if (!who || !tables.payout_owners.some((o) => o.user_id === who.id)) return json(200, []);
  const rows = tables[t] || [];
  if (req.method() === 'GET') {
    const out = applyFilters(rows, url.searchParams);
    if ((req.headers().accept || '').includes('vnd.pgrst.object')) return out.length ? json(200, out[0]) : json(406, { code: 'PGRST116', message: 'no rows', details: 'The result contains 0 rows' });
    return json(200, out);
  }
  if (req.method() === 'POST') {
    for (const r of Array.isArray(body) ? body : [body]) {
      const cols = (url.searchParams.get('on_conflict') || '').split(',').filter(Boolean);
      const i = cols.length ? rows.findIndex((x) => cols.every((c) => x[c] === r[c])) : -1;
      if (i >= 0) rows[i] = { ...rows[i], ...r }; else rows.push({ id: randomUUID(), created_at: new Date().toISOString(), locked_at: new Date().toISOString(), ...r });
    }
    return route.fulfill({ status: 201, headers });
  }
  if (req.method() === 'PATCH') { for (const r of applyFilters(rows, url.searchParams)) Object.assign(r, body); return route.fulfill({ status: 204, headers }); }
  if (req.method() === 'DELETE') { const del = applyFilters(rows, url.searchParams); tables[t] = rows.filter((r) => !del.includes(r)); return route.fulfill({ status: 204, headers }); }
  return json(405, {});
};

// ── What runs in the page: the checks, and every colour the browser computed ─────────
// `o`: { phone, safeTop, safeBottom, scope (a selector: only inside it, for an open dialog) }
function audit(o) {
  const out = [];
  const more = {};
  const de = document.documentElement;
  const vw = de.clientWidth;
  const vh = window.innerHeight;
  const scope = (o.scope && document.querySelector(o.scope)) || document.body;
  const R = (el) => el.getBoundingClientRect();
  const px = (n) => Math.round(n * 10) / 10;
  const one = (el) => { const t = el.tagName.toLowerCase(); if (el.id) return `${t}#${el.id.replace(/[0-9a-z]{6,}$/i, '*')}`; const c = [...el.classList].slice(0, 2).join('.'); return c ? `${t}.${c}` : t; };
  const selOf = (el) => { const parts = []; let n = el; while (n && n !== document.body && parts.length < 3) { parts.unshift(one(n)); if (n.id) break; n = n.parentElement; } return parts.join(' > '); };
  const textOf = (el) => String(el.innerText || el.value || el.getAttribute?.('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const add = (check, sev, el, what, nums) => { more[check] = (more[check] || 0) + 1; if (more[check] > 8) return; out.push({ check, sev, sel: el ? selOf(el) : '', text: el ? textOf(el) : '', what, nums: nums || '' }); };
  const vis = (el) => { if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false; const r = R(el); return r.width > 1 && r.height > 1; };
  const srOnly = (el) => { for (let n = el; n && n !== document.body; n = n.parentElement) { const r = R(n); if ((r.width <= 1.5 || r.height <= 1.5) && getComputedStyle(n).overflow !== 'visible') return true; } return false; };
  const all = [...scope.querySelectorAll('*')].filter((el) => !(el instanceof SVGElement && el.tagName.toLowerCase() !== 'svg') && vis(el) && !srOnly(el));
  const visSet = new Set(all);
  const cs = (el) => getComputedStyle(el);
  const fixedAnc = (el) => { for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const p = cs(n).position; if (p === 'fixed' || p === 'sticky') return n; } return null; };
  const inScroller = (el) => { for (let n = el.parentElement; n && n !== document.body && n !== de; n = n.parentElement) { const x = cs(n).overflowX; if ((x === 'auto' || x === 'scroll') && n.scrollWidth > n.clientWidth + 1) return n; } return null; };
  const textRects = (el) => {
    const rects = []; const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      if (!n.nodeValue.trim() || !visSet.has(n.parentElement)) continue;
      const rg = document.createRange(); rg.selectNodeContents(n);
      for (const r of rg.getClientRects()) if (r.width > 0.5 && r.height > 0.5) rects.push(r);
    }
    return rects;
  };
  const INTER = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=tab], [role=button]';
  const inter = all.filter((el) => el.matches(INTER) && !el.disabled);

  // 1. the page scrolls sideways; something is wider than the viewport
  const hs = de.scrollWidth - de.clientWidth;
  if (!o.scope && hs > 1) add('01-page-scrolls-sideways', 'high', null, 'the page scrolls sideways', `scrollWidth ${de.scrollWidth} > viewport ${de.clientWidth}`);
  for (const el of all) { const r = R(el); if (((r.right > vw + 1 && r.left < vw) || (r.left < -1 && r.right > 0)) && !inScroller(el) && !(el.parentElement && (R(el.parentElement).right > vw + 1 || R(el.parentElement).left < -1))) add('01-wider-than-viewport', 'high', el, 'cut by the edge of the viewport', `left ${px(r.left)} right ${px(r.right)} viewport ${vw}`); }

  // 2. text clipped by its box, or drawn outside it
  const BOXED = 'button, .btn, .k-pill, .tag-cancel, .tag-cheques, .lock-tag, .side-link, .k-count, summary, .tile, .kpi, .p-stat, .deal-nums > span, .choice, .paybar, .toast';
  for (const el of all) {
    if (!el.textContent.trim() || el.matches('select, option, input, textarea')) continue;
    const s = cs(el); const er = R(el);
    const hx = s.overflowX === 'hidden' || s.overflowX === 'clip';
    if (hx && el.scrollWidth > el.clientWidth + 1 && textRects(el).some((r) => r.right > er.right + 1 || r.left < er.left - 1)) add('02-text-clipped', 'high', el, s.textOverflow === 'ellipsis' ? 'text cut with an ellipsis' : 'text is clipped by its own box', `scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`);
    else if (!hx && el.matches(BOXED) && s.display !== 'inline' && s.display !== 'contents') {
      const bad = textRects(el).find((r) => r.right > er.right + 2 || r.left < er.left - 2 || r.bottom > er.bottom + 4 || r.top < er.top - 4);
      if (bad) add('02-text-outside-its-box', 'high', el, 'text is drawn outside its box', `text ${px(bad.left)}–${px(bad.right)}, box ${px(er.left)}–${px(er.right)}`);
    }
  }

  // 3. controls that overlap, and siblings drawn on one another
  const cut = (a, b) => { const x = Math.min(a.right, b.right) - Math.max(a.left, b.left); const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); return x > 2 && y > 2 ? [x, y] : null; };
  const isField = (x) => x.matches('input, textarea, select');
  const ir = inter.slice(0, 400).map((el) => [el, R(el)]);
  for (let i = 0; i < ir.length; i += 1) for (let j = i + 1; j < ir.length; j += 1) {
    const [a, ra] = ir[i]; const [b, rb] = ir[j];
    const c = cut(ra, rb); if (!c) continue;
    if (a.contains(b) || b.contains(a) || fixedAnc(a) !== fixedAnc(b) || isField(a) !== isField(b)) continue;
    const la = a.closest('label'); const lb = b.closest('label'); if ((la && la.contains(b)) || (lb && lb.contains(a))) continue;
    add('03-controls-overlap', 'high', b, `overlaps ${selOf(a)} "${textOf(a).slice(0, 24)}"`, `${px(c[0])}×${px(c[1])}px`);
  }
  for (const p of all) {
    const kids = [...p.children].filter((k) => visSet.has(k) && /^(static|relative)$/.test(cs(k).position));
    if (kids.length < 2 || kids.length > 30) continue;
    for (let i = 0; i < kids.length; i += 1) for (let j = i + 1; j < kids.length; j += 1) {
      const a = kids[i]; const b = kids[j]; const c = cut(R(a), R(b)); if (!c || c[0] < 4 || c[1] < 4) continue;
      const neg = (k) => ['marginTop', 'marginBottom', 'marginLeft', 'marginRight'].some((m) => parseFloat(cs(k)[m]) < 0);
      if (neg(a) || neg(b) || cs(a).display === 'inline' || cs(b).display === 'inline') continue;
      add('03-siblings-overlap', 'medium', b, `drawn over its sibling ${one(a)} "${textOf(a).slice(0, 24)}"`, `${px(c[0])}×${px(c[1])}px`);
    }
  }
  // a fixed or sticky bar that covers the control under it at rest (the last thing of the page is checked by scrolling, in the runner)

  // 4. form rows: fields of one row on one line and one height; a label right over its field
  const fields = all.filter((el) => el.matches('input:not([type=checkbox]):not([type=radio]):not([type=hidden]), select, textarea'));
  const used = new Set();
  for (const a of fields) {
    if (used.has(a)) continue;
    const ra = R(a); const row = [a];
    const box = a.closest('.two-col, .three-col, .perk-row, .task-act, .set-row') || a.parentElement.parentElement;
    for (const b of fields) {
      if (b === a || used.has(b) || !box.contains(b)) continue;
      const rb = R(b); const ov = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top); const hx = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      if (ov > 0.5 * Math.min(ra.height, rb.height) && hx <= 0) row.push(b);
    }
    if (row.length < 2) continue;
    for (const x of row) used.add(x);
    const single = row.filter((x) => x.tagName !== 'TEXTAREA');
    const tops = single.map((x) => R(x).top); const hts = single.map((x) => R(x).height);
    if (Math.max(...tops) - Math.min(...tops) > 1.5) add('04-row-fields-not-on-one-line', 'high', a, 'the fields of one row do not start on one line', `tops ${tops.map(px).join(', ')}`);
    if (Math.max(...hts) - Math.min(...hts) > 1.5) add('04-row-fields-heights', 'medium', a, 'the fields of one row have different heights', `heights ${hts.map(px).join(', ')}`);
  }
  for (const f of fields) {
    const lab = f.id && document.querySelector(`label[for="${CSS.escape(f.id)}"]`);
    if (!lab || !visSet.has(lab) || lab.closest('.lg-field')) continue;
    const lr = R(lab); const fr = R(f);
    if (Math.abs(lr.right - fr.right) > 2 && lr.bottom <= fr.top + 2) add('04-label-not-over-its-field', 'medium', lab, 'a label does not start where its field starts', `label right ${px(lr.right)}, field right ${px(fr.right)}`);
    if (f.matches('input, select') && fr.height < 47.5 && !f.matches('.input-sm, .input-date') && cs(f).fontSize) add('04-field-under-48', 'medium', f, 'a field is lower than 48px', `${px(fr.height)}px`);
    if (parseFloat(cs(f).fontSize) < 16) add('04-field-text-under-16', 'high', f, 'a field with text under 16px (an iPhone zooms the page)', cs(f).fontSize);
  }
  for (const f of fields) if (parseFloat(cs(f).fontSize) < 16 && !f.id) add('04-field-text-under-16', 'high', f, 'a field with text under 16px (an iPhone zooms the page)', cs(f).fontSize);

  // 5. an amount apart from its ₪, or an amount broken over two lines; a figure not under its label
  const tw = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (!visSet.has(n.parentElement)) continue;
    const re = /-?[\d,]+(?:\.\d+)?\s₪|₪\s?-?[\d,]+(?:\.\d+)?/g; let m;
    while ((m = re.exec(n.nodeValue))) {
      const rg = document.createRange(); rg.setStart(n, m.index); rg.setEnd(n, m.index + m[0].length);
      const tops = [...rg.getClientRects()].filter((r) => r.width > 0.5).map((r) => Math.round(r.top));
      if (Math.max(...tops) - Math.min(...tops) > 4) add('05-amount-split-from-its-sign', 'high', n.parentElement, 'an amount is broken apart from its ₪', m[0]);
    }
  }
  for (const el of all.filter((x) => x.matches('.num'))) {
    const s = cs(el);
    if (s.fontVariantNumeric.indexOf('tabular-nums') < 0) add('05-amount-not-tabular', 'medium', el, 'an amount without tabular figures', s.fontVariantNumeric);
    const r = R(el); const p = el.closest('.tile, .kpi, .deal-nums > span, .payee summary, .row, .list-btn, .list-row, .paybar, li, .fig');
    if (p && (r.left < R(p).left - 1 || r.right > R(p).right + 1) && !inScroller(el)) add('05-amount-outside-its-box', 'high', el, 'an amount is drawn outside its box', `amount ${px(r.left)}–${px(r.right)}, box ${px(R(p).left)}–${px(R(p).right)}`);
  }
  for (const el of all.filter((x) => x.matches('.deal-nums > span, .tile, .fig, .kpi') && x.children.length >= 2)) {
    const a = R(el.firstElementChild); const b = R(el.children[1]);
    if (Math.abs(a.right - b.right) > 2) add('05-figure-not-under-its-label', 'high', el, 'the figure does not start where its label starts', `label right ${px(a.right)}, figure right ${px(b.right)}`);
    if (b.top < a.bottom - 2) add('05-figure-beside-its-label', 'medium', el, 'the figure is not under its label', `label bottom ${px(a.bottom)}, figure top ${px(b.top)}`);
  }

  // 6. tap targets under 44px
  for (const el of inter) {
    if (el.matches('input[type=checkbox], input[type=radio]') && el.closest('label')) continue;
    if (el.matches('a') && cs(el).display === 'inline') continue; // a link inside a sentence
    const r = R(el);
    if (r.width < 43.5 || r.height < 43.5) add('06-tap-target-under-44', o.phone ? 'high' : 'low', el, 'a control smaller than 44px', `${px(r.width)}×${px(r.height)}`);
  }
  for (const el of all.filter((x) => x.matches('label.choice'))) { const r = R(el); if (r.height < 43.5) add('06-tap-target-under-44', o.phone ? 'high' : 'low', el, 'a choice lower than 44px', `${px(r.height)}`); }

  // 7. the safe-area insets of an installed iPhone app
  if (o.safeTop && !o.scope) {
    for (const el of inter) { const r = R(el); const fx = fixedAnc(el); if (fx && cs(fx).position === 'fixed' && r.bottom > vh - o.safeBottom + 0.5 && r.top < vh) add('07-in-home-indicator-zone', 'high', el, 'a control inside the home-indicator inset', `bottom ${px(r.bottom)} > ${vh - o.safeBottom}`); if (r.top < o.safeTop - 0.5 && r.bottom > 0 && scrollY < 2) add('07-under-status-bar', 'high', el, 'a control inside the status-bar inset', `top ${px(r.top)} < ${o.safeTop}`); }
  }

  // 8. contrast, and every colour used
  const parse = (str) => {
    let m = /^rgba?\(([^)]+)\)$/.exec(str);
    if (m) { const p = m[1].split(/[,/ ]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
    m = /^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+))?\)$/.exec(str);
    if (m) return [Math.round(m[1] * 255), Math.round(m[2] * 255), Math.round(m[3] * 255), m[4] === undefined ? 1 : Number(m[4])];
    return null;
  };
  const over = (top, under) => { const a = top[3]; return [0, 1, 2].map((i) => Math.round(top[i] * a + under[i] * (1 - a))).concat(1); };
  const lum = (c) => { const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  // The ground an element is drawn on: its own fill and those behind it, composited. A
  // gradient or a picture is unknown (null), except the ones this app is known to use.
  const KNOWN_IMG = [[/rgb\(28, 47, 107\).*rgb\(7, 20, 51\)|rgb\(7, 20, 51\).*rgb\(28, 47, 107\)/, [28, 47, 107, 1]]];
  const groundOf = (el) => {
    const stack = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const s = cs(n);
      if (s.backgroundImage && s.backgroundImage !== 'none') { const k = KNOWN_IMG.find(([re]) => re.test(s.backgroundImage)); if (!k) return null; stack.push(k[1]); break; }
      const c = parse(s.backgroundColor); if (c && c[3] > 0) { stack.push(c); if (c[3] >= 1) break; }
    }
    let base = [255, 255, 255, 1];
    for (let i = stack.length - 1; i >= 0; i -= 1) base = over(stack[i], base);
    return base;
  };
  const colours = {};
  const note = (kind, str, el) => { const c = parse(str); if (!c || c[3] === 0) return; const key = `${c[0]},${c[1]},${c[2]},${Math.round(c[3] * 100) / 100}`; const e = (colours[key] ||= { n: 0, kinds: {}, where: [] }); e.n += 1; e.kinds[kind] = (e.kinds[kind] || 0) + 1; if (e.where.length < 3) { const w = selOf(el); if (!e.where.includes(w)) e.where.push(w); } };
  const onNight = !!document.documentElement.dataset.door;
  for (const el of all) {
    const s = cs(el);
    note('fill', s.backgroundColor, el);
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) if (parseFloat(s[`border${side}Width`]) > 0 && s[`border${side}Style`] !== 'none') note('edge', s[`border${side}Color`], el);
    if (el instanceof SVGElement) { if (s.stroke !== 'none') note('icon', s.stroke, el); continue; }
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim());
    if (!own && !el.matches('input, select, textarea')) continue;
    note('text', s.color, el);
    if (el.matches(':disabled') || el.closest(':disabled')) continue;
    const fg0 = parse(s.color); const bg = groundOf(el);
    if (!fg0) continue;
    if (!bg) { if (!onNight) add('08-contrast-unknown-ground', 'low', el, 'text on a gradient or a picture: read by eye', s.color); continue; }
    const fg = over(fg0, bg); const cr = ratio(fg, bg);
    const size = parseFloat(s.fontSize); const big = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
    if (cr < (big ? 3 : 4.5) - 0.005) add('08-contrast', cr < 3 ? 'high' : 'medium', el, `contrast ${cr.toFixed(2)}:1 (needs ${big ? 3 : 4.5}:1)`, `text rgb(${fg.slice(0, 3)}) on rgb(${bg.slice(0, 3)}), ${size}px/${s.fontWeight}`);
  }

  // 9. words that must never be on the screen; Hebrew, right to left
  if (/\bnull\b|undefined|NaN|\[object /.test(scope.innerText)) add('09-stray-value', 'high', null, 'null / undefined / NaN / [object on the screen', '');
  if (de.dir !== 'rtl' || de.lang !== 'he') add('09-not-hebrew-rtl', 'high', null, 'the page is not Hebrew, right to left', `${de.lang} ${de.dir}`);
  return { findings: out, more, colours, fonts: [...new Set(all.filter((el) => el.matches('h1, h2, h3, .kpi-v, .payee-amt, .paybar-amt')).map((el) => `${one(el)}: ${cs(el).fontFamily.split(',')[0].replace(/["']/g, '')}`))] };
}

// ── The palette the colours are held against ─────────────────────────────────────────
const hexRgb = (hex) => { const h = hex.length === 4 ? [...hex.slice(1)].map((c) => c + c).join('') : hex.slice(1); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(','); };
const TOKENS = new Map(); // "r,g,b" -> names
const learn = (file, tag) => {
  const css = readFileSync(path.join(ROOT, file), 'utf8');
  for (const m of css.matchAll(/(--[\w-]+):\s*(#[0-9A-Fa-f]{3,6})\b/g)) { const k = hexRgb(m[2]); TOKENS.set(k, [...(TOKENS.get(k) || []), m[1]]); }
  if (tag) for (const m of css.matchAll(/#[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{3}\b/g)) { const k = hexRgb(m[0]); if (!TOKENS.has(k)) TOKENS.set(k, [tag]); }
};
learn('app/styles/tokens.css');
learn('app/styles/kit.css');
learn('app/styles/login.css', 'login.css');
for (const [hex, name] of [['#FFFFFF', 'white'], ['#000000', 'black'], ['#1B2340', 'shell.css avatar ink'], ['#0B1530', 'statement (print) ink'], ['#DDE1EC', 'statement (print) line'], ['#36405C', 'statement (print) ink 2'], ['#031432', 'statement (print) rule'], ['#56607A', 'statement (print) muted'], ['#B3123E', 'statement (print) offset']]) { const k = hexRgb(hex); if (!TOKENS.has(k)) TOKENS.set(k, [name]); }
// The look this app had before section 56: its dark scheme, its navy bar. None may come back.
const OLD_BLUES = new Map([['#020A1D', 'dark ground'], ['#07183A', 'dark surface'], ['#0B2150', 'dark surface 2'], ['#1C3265', 'dark line'], ['#4A6AA6', 'dark edge'], ['#B4C3F2', 'dark accent'], ['#C3CBE0', 'dark text 2'], ['#A3AECB', 'dark muted'], ['#C5CEEA', 'bar product name'], ['#F6F7FA', 'old surface 2'], ['#F1F3FA', 'dark text']].map(([h, n]) => [hexRgb(h), n]));

// ── The runner ───────────────────────────────────────────────────────────────────────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let f = path.join(ROOT, p);
    if (!f.startsWith(ROOT)) throw new Error('outside');
    if ((await stat(f)).isDirectory()) f = path.join(f, 'index.html');
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(await readFile(f));
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((done) => { server.listen(0, '127.0.0.1', done); });
const BASE = process.env.BASE_URL || `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const findings = [];
const colourUse = new Map(); // key -> { n, kinds, where, screens }
const fonts = new Set();
const problems = [];
let shots = 0;
let pdfPages = null;

async function sweep(worldKey, sizeKey) {
  const size = SIZES[sizeKey];
  const tables = world(worldKey);
  const dir = path.join(OUT, SCHEME === 'dark' ? 'dark' : 'shots', worldKey, sizeKey);
  await mkdir(dir, { recursive: true });
  const open = async () => {
    const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: { width: size.w, height: size.h }, isMobile: !!size.phone, hasTouch: !!size.phone, deviceScaleFactor: 1, colorScheme: SCHEME });
    await ctx.route(`${SUPA}/**`, fakeFor(tables));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`${worldKey}/${sizeKey}: ${String(e).slice(0, 200)}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`${worldKey}/${sizeKey}: ${m.text().slice(0, 200)}`); });
    page.on('dialog', (d) => d.accept());
    if (size.safe) {
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: size.safe[0], bottom: size.safe[1], left: 0, right: 0 } }).catch(() => problems.push('this Chromium cannot emulate the safe-area insets'));
    }
    return { ctx, page };
  };
  const rec = async (page, name, opts = {}) => {
    await page.waitForTimeout(opts.wait ?? 350); // the entrance of a dialog, a fade
    if (!opts.keep) await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('dialog[open] .sheet-body')?.scrollTo(0, 0); });
    const res = await page.evaluate(audit, { phone: !!size.phone, safeTop: size.safe ? size.safe[0] : 0, safeBottom: size.safe ? size.safe[1] : 0, scope: opts.scope || null })
      .catch((e) => ({ findings: [{ check: '00-audit-failed', sev: 'high', sel: '', text: '', what: String(e).slice(0, 200), nums: '' }], colours: {}, fonts: [] }));
    for (const f of res.findings) findings.push({ ...f, screen: name, world: worldKey, size: sizeKey });
    for (const [k, v] of Object.entries(res.colours)) { const e = colourUse.get(k) || { n: 0, kinds: {}, where: [], screens: new Set() }; e.n += v.n; for (const [kk, nn] of Object.entries(v.kinds)) e.kinds[kk] = (e.kinds[kk] || 0) + nn; for (const w of v.where) if (e.where.length < 4 && !e.where.includes(w)) e.where.push(w); e.screens.add(name); colourUse.set(k, e); }
    for (const f of res.fonts) fonts.add(f);
    await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: !opts.scope && !opts.viewport });
    shots += 1;
  };
  const step = async (name, run) => { try { await run(); } catch (e) { problems.push(`${worldKey}/${sizeKey}/${name}: ${String(e).split('\n')[0].slice(0, 220)}`); } };
  const signIn = async (page, email, to = `#/month/${MONTH}`) => {
    await page.goto(`${BASE}payouts/${to}`);
    await page.locator('input[type=email]').fill(email);
    await page.locator('input[type=password]').fill('correct-horse');
    await page.locator('button[type=submit]').click();
  };
  const dlg = (page) => page.locator('dialog[open]');
  const closeDlg = async (page) => { await page.keyboard.press('Escape'); await page.locator('dialog[open]').waitFor({ state: 'detached' }).catch(() => {}); await page.locator('dialog').evaluate((d) => d.open && d.close()).catch(() => {}); };
  const goTo = async (page, route, month = MONTH) => { await page.goto(`${BASE}payouts/#/${route}/${month}`); await page.waitForTimeout(450); };
  // The last thing of a page is reachable above whatever is fixed at the bottom.
  const lastClear = async (page, name) => {
    const hidden = await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
      const els = [...document.querySelectorAll('#view button, #view a[href], #view input, #view summary, #view select')].filter((el) => el.checkVisibility() && !el.closest('.save-bar, .paybar'));
      const last = els.at(-1); if (!last) return null;
      const r = last.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return hit && (last.contains(hit) || hit.contains(last)) ? null : `${last.tagName.toLowerCase()} "${(last.innerText || last.getAttribute('aria-label') || '').slice(0, 30)}" is under ${hit ? hit.tagName.toLowerCase() + (hit.className ? `.${String(hit.className).split(' ')[0]}` : '') : 'nothing'}`;
    });
    if (hidden) findings.push({ check: '07-last-control-covered', sev: 'high', sel: '', text: '', what: `at the end of the page, ${hidden}`, nums: '', screen: name, world: worldKey, size: sizeKey });
    await page.evaluate(() => window.scrollTo(0, 0));
  };

  // The sign-in screens, the new password and "no access" (once per size, in the normal world).
  if (worldKey === 'normal') {
    const a = await open();
    await step('sign-in', async () => {
      await a.page.goto(`${BASE}payouts/`);
      await a.page.locator('input[type=email]').waitFor();
      await rec(a.page, '01-sign-in');
      await a.page.locator('input[type=email]').fill('someone@astrateg.test');
      await a.page.locator('input[type=password]').fill('not-the-password');
      await a.page.locator('button[type=submit]').click();
      await a.page.getByText('האימייל או הסיסמה שגויים.').waitFor();
      await rec(a.page, '02-sign-in-refused', { wait: 600 });
      await a.page.locator('input[type=email]').fill('');
      await a.page.getByRole('button', { name: 'שכחתי סיסמה' }).click();
      await rec(a.page, '03-forgot-needs-email');
      await a.page.locator('input[type=email]').fill(OWNER.email);
      await a.page.getByRole('button', { name: 'שכחתי סיסמה' }).click();
      await a.page.getByText(/נשלח אליה קישור/).waitFor();
      await rec(a.page, '04-forgot-sent');
    });
    await step('new-password', async () => {
      await a.page.goto('about:blank');
      await a.page.goto(`${BASE}payouts/#access_token=${jwt(OWNER)}&refresh_token=r&expires_in=3600&token_type=bearer&type=recovery`);
      await a.page.getByRole('heading', { name: 'בחירת סיסמה חדשה' }).waitFor();
      await rec(a.page, '05-new-password');
      await a.page.locator('input[type=password]').first().fill('short');
      await a.page.locator('button[type=submit]').click();
      await a.page.getByText('הסיסמה צריכה להיות באורך 10 תווים לפחות.').waitFor();
      await rec(a.page, '06-new-password-refused');
    });
    await a.ctx.close();
    const b = await open();
    await step('no-access', async () => {
      await signIn(b.page, OTHER.email);
      await b.page.getByRole('heading', { name: 'אין לך גישה לאסטרטג פיימנט' }).waitFor();
      await rec(b.page, '07-no-access', { wait: 1500 });
    });
    await b.ctx.close();
  }

  const { ctx, page } = await open();
  await step('enter', async () => { await signIn(page, OWNER.email); await page.locator('#m-title').filter({ hasText: /2026/ }).waitFor(); await page.waitForTimeout(1600); });
  await step('month', async () => { await goTo(page, 'month'); await rec(page, '10-month'); await page.screenshot({ path: path.join(dir, '10-month-top.png') }); await lastClear(page, '10-month'); });
  await step('deals', async () => { await goTo(page, 'deals'); await rec(page, '20-deals'); await page.screenshot({ path: path.join(dir, '20-deals-top.png') }); await lastClear(page, '20-deals'); });
  await step('pay', async () => {
    await goTo(page, 'pay'); await rec(page, '30-pay'); await page.screenshot({ path: path.join(dir, '30-pay-top.png') });
    await page.evaluate(() => { for (const d of document.querySelectorAll('details.payee')) d.open = true; });
    await rec(page, '31-pay-open'); await lastClear(page, '31-pay-open');
    await page.evaluate(() => window.scrollTo(0, 600)); await page.waitForTimeout(150); await page.screenshot({ path: path.join(dir, '32-pay-scrolled.png') });
  });
  await step('influencers', async () => { await goTo(page, 'simeon'); await rec(page, '40-simeon'); await lastClear(page, '40-simeon'); await goTo(page, 'natali'); await rec(page, '41-natali'); });
  await step('settings', async () => {
    await goTo(page, 'settings'); await rec(page, '50-settings');
    await page.evaluate(() => { for (const d of document.querySelectorAll('details.set-sec')) d.open = true; });
    await rec(page, '51-settings-open'); await lastClear(page, '51-settings-open');
    await page.evaluate(() => window.scrollTo(0, 900)); await page.waitForTimeout(150); await page.screenshot({ path: path.join(dir, '52-settings-scrolled.png') });
  });
  await step('menu', async () => {
    await goTo(page, 'month');
    const moreBtn = page.locator('#side-more');
    if (size.phone && await moreBtn.count()) { await moreBtn.click(); await rec(page, '60-more-sheet', { viewport: true }); await page.keyboard.press('Escape'); }
  });
  if (worldKey !== 'nosettings') {
    await step('deal-new', async () => {
      await goTo(page, 'deals');
      if (worldKey === 'locked') { await page.locator('#nav-add').click(); await page.locator('#toast:not([hidden])').waitFor(); await rec(page, '61-toast', { viewport: true, wait: 100 }); return; }
      await page.locator('#nav-add').click(); await dlg(page).waitFor();
      await rec(page, '70-deal-new', { scope: 'dialog[open]' });
      await dlg(page).getByRole('button', { name: 'שמירת העסקה' }).click();
      await rec(page, '71-deal-new-errors', { scope: 'dialog[open]' });
      await dlg(page).getByLabel('שם הלקוח').fill(worldKey === 'worst' ? LONG2 : 'לקוח חדש');
      await dlg(page).getByRole('button', { name: 'הוספת צ׳ופר' }).click();
      await dlg(page).getByRole('radio', { name: 'צ׳קים' }).check();
      await page.evaluate(() => { const b = document.querySelector('dialog[open] .sheet-body'); b.scrollTo(0, b.scrollHeight); });
      await rec(page, '72-deal-new-end', { scope: 'dialog[open]', keep: true });
      await dlg(page).getByRole('radio', { name: /הצעה אישית/ }).check();
      await rec(page, '73-deal-personal', { scope: 'dialog[open]' });
      await closeDlg(page);
    });
    if (worldKey !== 'locked' && worldKey !== 'empty') {
      await step('deal-edit', async () => { await page.locator('#view button.deal').first().click(); await dlg(page).waitFor(); await rec(page, '74-deal-edit', { scope: 'dialog[open]' }); await closeDlg(page); });
      await step('cancel', async () => { await page.getByRole('button', { name: 'ביטול עסקה' }).click(); await dlg(page).waitFor(); await rec(page, '75-cancel', { scope: 'dialog[open]' }); await closeDlg(page); });
    }
    if (worldKey !== 'locked') {
      await step('income', async () => { await goTo(page, 'month'); await page.getByRole('button', { name: 'הוספה' }).first().click(); await dlg(page).waitFor(); await rec(page, '76-income', { scope: 'dialog[open]' }); await dlg(page).getByRole('button', { name: 'שמירה' }).click(); await rec(page, '77-income-errors', { scope: 'dialog[open]' }); await closeDlg(page); });
      await step('expense', async () => { await page.getByRole('button', { name: 'הוספה' }).nth(1).click(); await dlg(page).waitFor(); await rec(page, '78-expense', { scope: 'dialog[open]' }); await closeDlg(page); });
      await step('lock', async () => { await page.getByRole('button', { name: 'סגירת החודש' }).click(); await dlg(page).waitFor(); await rec(page, '79-lock-confirm', { scope: 'dialog[open]' }); await closeDlg(page); });
    } else {
      await step('unlock', async () => { await goTo(page, 'month'); await page.getByRole('button', { name: 'פתיחת החודש' }).click(); await dlg(page).waitFor(); await rec(page, '79-unlock-confirm', { scope: 'dialog[open]' }); await closeDlg(page); });
    }
    await step('account', async () => { await page.locator('#btn-account').click(); await dlg(page).waitFor(); await rec(page, '80-account', { scope: 'dialog[open]' }); await closeDlg(page); });
    if (worldKey !== 'empty') {
      await step('statement', async () => {
        await goTo(page, 'pay');
        await page.locator('details.payee').first().locator('summary').click();
        await page.getByRole('button', { name: 'דוח עמלה להצגה' }).first().click(); await dlg(page).waitFor();
        await rec(page, '81-statement', { scope: 'dialog[open]' });
        if (arg('pdf') && worldKey === 'normal' && sizeKey === '1280') {
          await page.evaluate(() => document.body.classList.add('print-statement'));
          const file = path.join(OUT, 'statement.pdf');
          await page.pdf({ path: file, format: 'A4', printBackground: true });
          const pdf = (await readFile(file)).toString('latin1');
          pdfPages = (pdf.match(/\/Type\s*\/Page[^s]/g) || []).length;
          await page.emulateMedia({ media: 'print' });
          await page.screenshot({ path: path.join(OUT, 'statement-print.png'), fullPage: true });
          await page.emulateMedia({ media: 'screen' });
          await page.evaluate(() => document.body.classList.remove('print-statement'));
        }
        await closeDlg(page);
      });
    }
  }
  await ctx.close();
}

const worlds = pick('world') || Object.keys(PLAN);
for (const w of worlds) for (const s of (pick('size') || PLAN[w]).filter((x) => SIZES[x])) { process.stdout.write(`${w} ${s} … `); await sweep(w, s); console.log('done'); }
await browser.close();
server.close();

// ── The report ───────────────────────────────────────────────────────────────────────
const inventory = [...colourUse.entries()].map(([key, e]) => {
  const [r, g, b, a] = key.split(',').map(Number);
  const rgb = `${r},${g},${b}`;
  const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  return { hex, alpha: a, n: e.n, kinds: Object.keys(e.kinds).join('+'), from: (TOKENS.get(rgb) || []).join(' '), old: OLD_BLUES.get(rgb) || '', where: e.where, screens: [...e.screens].slice(0, 4) };
}).sort((x, y) => y.n - x.n);
const solidUnknown = inventory.filter((c) => !c.from && c.alpha >= 1);
const oldBlue = inventory.filter((c) => c.old);
for (const c of oldBlue) findings.push({ check: '10-old-blue', sev: 'high', sel: c.where.join(' | '), text: '', what: `the old look's colour ${c.hex} (${c.old}) is on the screen`, nums: `${c.n} times`, screen: c.screens.join(', '), world: '', size: '' });
for (const c of solidUnknown.filter((x) => !x.old)) findings.push({ check: '10-colour-not-from-tokens', sev: 'medium', sel: c.where.join(' | '), text: '', what: `${c.hex} (${c.kinds}) is not a token of tokens.css, kit.css or login.css`, nums: `${c.n} times`, screen: c.screens.join(', '), world: '', size: '' });
await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, `findings-${SCHEME}.json`), JSON.stringify(findings, null, 1));
await writeFile(path.join(OUT, `colours-${SCHEME}.json`), JSON.stringify(inventory, null, 1));

const groups = new Map();
for (const f of findings) { const k = `${f.check} | ${f.sel} | ${f.what.replace(/[\d.]+/g, 'N')}`; const g = groups.get(k) || { ...f, n: 0, at: new Set() }; g.n += 1; g.at.add(`${f.world}/${f.size}/${f.screen}`); groups.set(k, g); }
const sorted = [...groups.values()].sort((a, b) => ['high', 'medium', 'low'].indexOf(a.sev) - ['high', 'medium', 'low'].indexOf(b.sev) || a.check.localeCompare(b.check));
console.log(`\n${shots} screenshots in ${OUT} (${SCHEME})`);
console.log(`colours on the screen: ${inventory.length}; solid and not from the tokens: ${solidUnknown.length}; from the old look: ${oldBlue.length}`);
for (const c of inventory.filter((x) => x.alpha >= 1)) console.log(`  ${c.hex}  ${String(c.n).padStart(6)}  ${c.kinds.padEnd(14)} ${c.old ? `OLD: ${c.old}` : c.from || 'NOT A TOKEN'}${c.from ? '' : `   ${c.where[0] || ''}`}`);
console.log(`fonts of headings and big numbers: ${[...new Set([...fonts].map((f) => f.split(': ')[1]))].join(', ')}`);
if (pdfPages !== null) console.log(`the printed statement: ${pdfPages} page(s) (statement.pdf, statement-print.png)`);
console.log(`\nfindings: ${sorted.length} kinds (${findings.length} in all)`);
for (const g of sorted) console.log(`  [${g.sev}] ${g.check} ×${g.n}  ${g.sel}  ${g.text ? `"${g.text.slice(0, 40)}" ` : ''}— ${g.what} ${g.nums}  @ ${[...g.at].slice(0, 3).join(', ')}`);
if (problems.length) { console.log('\nsteps that did not run, and browser errors:'); for (const p of [...new Set(problems)]) console.log(`  ${p}`); }
process.exit(findings.some((f) => f.sev === 'high') || problems.length ? 1 : 0);
