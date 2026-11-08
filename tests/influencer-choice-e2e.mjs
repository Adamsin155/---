// "משפיען לבחירה" in the browser (the owner, 5.11.2026; docs/ops.md, section 98), against the
// in-memory fake of Supabase of tests/custom-contract-e2e.mjs: the builder offers it last (beside
// Arik Mishali since 8.11.2026), the document says "to be chosen", the signed client's card says "משפיען: עוד לא נבחר" with
// "בחירת משפיען", and Stav's deal form offers it. Phone and desktop screenshots.
// Run: npx http-server -p 8094 -s -c-1 . &  then
//      BASE_URL=http://localhost:8094/ node tests/influencer-choice-e2e.mjs [outDir]
import { openCardFolds } from './open-folds.mjs';
import { chromium } from 'playwright';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { withClientColumns } from './fake-clients.mjs';
import { validateSelection, normalizeSelection, exceptionOf, buildQuoteModel, emptySelection } from '../app/pricing.js';
import { packageDeliverables } from '../app/protocol-logic.js';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
if (OUT) mkdirSync(OUT, { recursive: true });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
// Monday 5.10.2026, 10:00 in Jerusalem: an office day.
const NOW = new Date('2026-10-05T07:00:00Z');
const skew = NOW.getTime() - Date.now();
const serverNow = () => new Date(Date.now() + skew).toISOString();
const minutesAgo = (n) => new Date(NOW - n * 6e4).toISOString();

const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', stav: 'stav', nadia: 'nadia' };
const users = new Map();
const staff = [];
for (const [k, person] of Object.entries(PEOPLE)) {
  const email = `${k}@astrateg.test`;
  users.set(email, { id: randomUUID(), email, aud: 'authenticated', role: 'authenticated', email_confirmed_at: minutesAgo(9000) });
  staff.push({ email, person, vault: false });
}
const OFFICE = new Set(['irit', 'lior', 'ofir', 'ilai', null]);
const EXP = Math.floor(NOW / 1000) + 3 * 3600;
const jwtFor = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp: EXP })}.sig`;
const sessionFor = (u) => ({ access_token: jwtFor(u), token_type: 'bearer', expires_in: 3 * 3600, expires_at: EXP, refresh_token: `r-${u.id}`, user: u });
const userOf = (headers) => {
  const token = /^Bearer (.+)$/.exec(headers.authorization || '')?.[1];
  return [...users.values()].find((u) => jwtFor(u) === token) || null;
};
const personOf = (u) => staff.find((s) => s.email === u?.email)?.person;
const isOffice = (u) => !!u && staff.some((s) => s.email === u.email) && OFFICE.has(personOf(u));
const canApprove = (u) => !!u && [null, 'ofir', 'lior'].includes(personOf(u));

const quotes = [];
const deals = [];
const tables = { clients: [], protocol_checks: [], client_tasks: [], office_reviews: [], client_status_notes: [], protocol_log: [] };
const calls = [];
let seq = 40;

// The deal of a quote follows its approval (the triggers of the migration).
function syncDeal(q) {
  for (const d of deals.filter((x) => x.quote_id === q.id && ['pending', 'approval', 'rejected', 'sent'].includes(x.status))) {
    d.status = q.approval === 'pending' ? 'approval' : q.approval === 'rejected' ? 'rejected' : 'sent';
    if (d.status === 'sent') d.sent_at ||= serverNow();
  }
}
const stamp = (q, hours) => {
  q.expires_at = hours ? new Date(Date.parse(serverNow()) + hours * 3600e3).toISOString() : null;
  if (q.expires_at) q.model.validUntil = q.expires_at; else delete q.model.validUntil;
};

// The create-quote edge function: validates, computes the model itself, stores.
function createQuote(body, me, json) {
  calls.push({ createQuote: body });
  if (!me) return json(401, { error: 'not signed in' });
  let selection;
  try { validateSelection(body.selection); selection = normalizeSelection(body.selection); } catch (e) { return json(400, { error: e.message }); }
  if (!body.client?.name?.trim() && body.selection?.docType !== 'quote') return json(400, { error: 'client name required' });
  const exceptions = exceptionOf(selection);
  if ((exceptions.length || body.revise) && !isOffice(me)) return json(403, { error: 'custom contracts are prepared by the office' });
  const model = buildQuoteModel(selection, body.client);
  if (body.revise) {
    const q = quotes.find((x) => x.id === body.revise);
    if (!q || q.status !== 'sent' || q.approval === 'none') return json(409, { error: 'this contract can no longer be changed' });
    Object.assign(q, {
      model: { ...model, number: q.number, createdAt: q.created_at }, client_name: model.client.name, monthly_gross_agorot: model.totals.monthlyGross, term_gross_agorot: model.totals.termGross,
      exceptions: exceptions.length ? exceptions : null, approval: 'none', approval_by: null, approval_by_email: null, approval_at: null, approval_note: null,
      version: q.version + 1, submitted_at: null, submitted_by_email: me.email, first_viewed_at: null,
    });
    stamp(q, model.validHours);
    syncDeal(q);
    return json(200, { id: q.id, number: q.number, created_at: q.created_at, approval: q.approval, version: q.version, token: q.token });
  }
  const q = {
    id: randomUUID(), token: randomUUID(), number: `AST-2026-${String(++seq).padStart(4, '0')}`, created_at: serverNow(), created_by: me.id, created_by_email: me.email,
    model, client_name: model.client.name, monthly_gross_agorot: model.totals.monthlyGross, term_gross_agorot: model.totals.termGross, status: 'sent',
    first_viewed_at: null, signed_at: null, signer_name: null, signature_png: null,
    approval: 'none', approval_by: null, approval_by_email: null, approval_at: null, approval_note: null,
    exceptions: exceptions.length ? exceptions : null, version: 1, submitted_at: null, submitted_by_email: me.email,
  };
  q.model = { ...model, number: q.number, createdAt: q.created_at };
  stamp(q, model.validHours);
  quotes.push(q);
  return json(200, { id: q.id, token: q.token, number: q.number, created_at: q.created_at, ...(exceptions.length ? { approval: 'none' } : {}) });
}

const view = (q) => ({
  number: q.number, createdAt: q.created_at, model: q.model, docHash: 'ab'.repeat(32), expiresAt: q.expires_at,
  expired: q.status !== 'signed' && !!q.expires_at && new Date(q.expires_at) < new Date(serverNow()),
  consentText: `קראתי ואני מאשר/ת את הסכם ההתקשרות ${q.number}, בהתחייבות ל־${q.model.termMonths} חודשים`, signatureHash: q.signature_png ? 'cd'.repeat(32) : null,
  status: q.status, signerName: q.signer_name, signedAt: q.signed_at, signaturePng: q.signature_png,
});
// Since 29.10.2026 only a contract a manager turned down has no link.
const hidden = (q) => !q || q.status === 'cancelled' || q.approval === 'rejected';

function rpc(name, body, me, json) {
  if (name === 'deal_take') {
    const d = deals.find((x) => x.id === body.p_id);
    const who = personOf(me);
    if (!d.taken_by && d.status === 'pending' && ['irit', 'ofir'].includes(who)) Object.assign(d, { taken_by: who, taken_at: serverNow() });
    return json(200, { ok: !d.taken_by || d.taken_by === who, taken_by: d.taken_by ?? null, status: d.status });
  }
  if (name === 'is_staff') return json(200, !!me && staff.some((s) => s.email === me.email));
  if (name === 'is_office') return json(200, isOffice(me));
  if (name === 'get_quote') {
    const q = quotes.find((x) => x.token === body.p_token);
    if (hidden(q)) return json(200, null);
    if (!me) q.first_viewed_at ||= serverNow();
    return json(200, view(q));
  }
  if (name === 'sign_quote') {
    const q = quotes.find((x) => x.token === body.p_token);
    if (hidden(q)) return json(404, { code: 'P0002', message: 'quote not found' });
    if (q.status === 'signed') return json(409, { code: '23505', message: 'quote already signed' });
    Object.assign(q, { status: 'signed', signer_name: body.p_name.trim(), signed_at: serverNow(), signature_png: body.p_signature });
    // open_client_on_signing: the client opens with what the signed contract grants.
    const m = q.model;
    tables.clients.push({
      id: randomUUID(), name: m.client.name, business: m.client.company || null, address: null, phone: m.client.phone || null,
      package_name: `${m.package.tierName} · ${m.package.influencer}`, shoot_type: { natali: 'natali', simeon: 'dms', niro: 'niro', hatzel: 'hatzel', arik: 'arik' }[m.selection.influencer] ?? null, // as the trigger: 'choice' none characterizer: 'ofir',
      has_logo: null, editor_name: null, editor: null, deal_at: q.signed_at, char_at: null, shoot_at: null,
      contract_end: new Date(Date.parse(q.signed_at) + m.termMonths * 30.4 * 864e5).toISOString().slice(0, 10), status: 'active', notes: null, quote_id: q.id,
      created_at: q.signed_at, created_by_email: null, links: {}, deliverables: packageDeliverables(m), rounds: [], verified_at: null, verified_by: null,
      closed_reason: null, archived_at: null, archived_by: null, protocol_version: 6,
    });
    for (const d of deals.filter((x) => x.quote_id === q.id)) Object.assign(d, { status: 'signed', signed_at: q.signed_at });
    return json(200, view(q));
  }
  if (name === 'cancel_quote') { const q = quotes.find((x) => x.id === body.p_id); if (q) q.status = 'cancelled'; return json(200, null); }
  if (name === 'quote_approve' || name === 'quote_reject') {
    calls.push({ [name]: body, by: me?.email });
    if (!canApprove(me)) return json(403, { code: '42501', message: 'not allowed' });
    const q = quotes.find((x) => x.id === body.p_id);
    if (!q || q.status !== 'sent') return json(404, { code: 'P0002', message: 'quote not found' });
    if (q.approval !== 'pending') return json(400, { code: '22023', message: 'this contract is not waiting for approval' });
    const person = personOf(me);
    if (name === 'quote_approve') {
      if (person !== null && q.submitted_by_email === me.email) return json(403, { code: '42501', message: 'you cannot approve a contract you prepared' });
      Object.assign(q, { approval: 'approved', approval_by: person ?? 'owner', approval_by_email: me.email, approval_at: serverNow(), approval_note: null });
      stamp(q, q.model.validHours); // the signing window starts at the approval
    } else {
      const note = String(body.p_note || '').trim();
      if (!note || note.length > 1000) return json(400, { code: '22023', message: 'a note is required (up to 1000 characters)' });
      Object.assign(q, { approval: 'rejected', approval_by: person ?? 'owner', approval_by_email: me.email, approval_at: serverNow(), approval_note: note });
    }
    syncDeal(q);
    return json(200, { id: q.id, number: q.number, approval: q.approval });
  }
  return json(200, []);
}

const filtersOf = (url) => [...url.searchParams.entries()].filter(([k]) => !['select', 'order', 'limit', 'offset'].includes(k));
const matcher = (filters) => (row) => filters.every(([k, v]) => {
  if (v.startsWith('eq.')) return String(row[k]) === v.slice(3);
  if (v.startsWith('neq.')) return String(row[k]) !== v.slice(4);
  if (v.startsWith('in.')) return v.slice(4, -1).split(',').map((x) => x.replace(/^"|"$/g, '')).includes(String(row[k]));
  return true;
});
const answer = (req, json) => (rows) => ((req.headers().accept || '').includes('vnd.pgrst.object')
  ? (rows.length ? json(200, rows[0]) : json(406, { code: 'PGRST116', message: 'no rows' })) : json(200, rows));

function dealsRoute(req, url, me, json) {
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  const match = matcher(filtersOf(url));
  const mine = (d) => isOffice(me) || (personOf(me) === 'stav' && d.created_by_email === me.email);
  const out = answer(req, json);
  if (req.method() === 'GET') return out(deals.filter(mine).filter(match).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)));
  if (req.method() === 'POST') {
    calls.push({ dealInsert: body });
    if (personOf(me) !== 'stav') return json(403, { code: '42501', message: 'new row violates row-level security policy' });
    const d = { custom: null, tier: null, influencer: null, paid: [], free: {}, discount_agorot: 0, notes: null, ...body, id: randomUUID(), created_at: serverNow(), created_by_email: me.email, seller: 'stav', status: 'pending', quote_id: null, sent_at: null, signed_at: null, status_by_email: null };
    deals.push(d);
    return out([d]);
  }
  if (req.method() === 'PATCH') {
    if (!isOffice(me)) return out([]);
    const rows = deals.filter(match);
    for (const d of rows) {
      Object.assign(d, body);
      if (body.quote_id && d.status === 'pending') {
        const q = quotes.find((x) => x.id === body.quote_id);
        d.status = q?.approval === 'pending' ? 'approval' : q?.approval === 'rejected' ? 'rejected' : 'sent';
      }
      if (d.status === 'sent') d.sent_at ||= serverNow();
    }
    return out(rows);
  }
  return json(405, {});
}

// A quote as a list row: the columns and the aliases the screens select.
const quoteRow = (q) => ({
  ...q, tier: q.model.package.tierName, influencer: q.model.package.influencer, doc: q.model.docTitle, signable: String(q.model.signable),
  phone: q.model.client.phone, email: q.model.client.email, company: q.model.client.company, business: q.model.client.company,
  term: String(q.model.termMonths), valid: String(q.model.validHours),
});

async function fakeSupabase(route) {
  const req = route.request();
  const url = new URL(req.url());
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  const headers = req.headers();
  const json = (status, data) => route.fulfill({
    status, contentType: 'application/json', body: JSON.stringify(data),
    headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' },
  });
  if (req.method() === 'OPTIONS') return json(200, {});
  const p = url.pathname;
  const me = userOf(headers);
  if (p === '/auth/v1/token') {
    const u = users.get(String(body.email || '').toLowerCase());
    if (!u || body.password !== 'correct-horse') return json(400, { error: 'invalid_grant', msg: 'Invalid login credentials' });
    return json(200, sessionFor(u));
  }
  if (p === '/auth/v1/user') return me ? json(200, me) : json(401, { msg: 'invalid JWT' });
  if (p === '/auth/v1/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  if (p === '/functions/v1/create-quote') return createQuote(body, me, json);
  if (p.startsWith('/rest/v1/rpc/')) return rpc(p.slice('/rest/v1/rpc/'.length), body || {}, me, json);
  if (!me) return json(401, { message: 'permission denied' });
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m) return json(404, { message: 'not found' });
  if (m[1] === 'deal_requests') return dealsRoute(req, url, me, json);
  if (m[1] === 'quotes') {
    // Row level security: the office only. Sales and editors read no quote.
    const rows = isOffice(me) ? quotes.filter(matcher(filtersOf(url))).map(quoteRow).reverse() : [];
    return answer(req, json)(rows);
  }
  if (m[1] === 'staff') {
    const eq = url.searchParams.get('email');
    return answer(req, json)(eq?.startsWith('eq.') ? staff.filter((s) => s.email === eq.slice(3)) : staff);
  }
  if (m[1] === 'reminder_log') return json(200, []);
  // A client's details saved (the card's "עריכת פרטים"; Arik's step): the row takes them.
  if (req.method() === 'PATCH' && m[1] === 'clients' && isOffice(me)) {
    const hit = tables.clients.filter(matcher(filtersOf(url)));
    for (const r of hit) Object.assign(r, body);
    return answer(req, json)(hit);
  }
  const rows = (tables[m[1]] || []).filter(matcher(filtersOf(url).filter(([k]) => k === 'id' || k === 'client_id')));
  return answer(req, json)(rows);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
async function newPage(viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport });
  await ctx.clock.install({ time: new Date(serverNow()) });
  await openCardFolds(ctx); // the card's closed rows, opened (the owner, 20.10.2026)
  await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', withClientColumns(fakeSupabase, { clients: () => tables.clients, staff: () => staff }));
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', (e) => errors.push(String(e)));
  watchCsp(page); // a load the Content-Security-Policy refused fails the suite (tests/csp-watch.mjs)
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
  page.on('dialog', (d) => d.accept());
  return page;
}
async function signIn(page, path, who) {
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', `${who}@astrateg.test`);
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
}
// A hash-only change does not load the page again: always a real load.
const fresh = async (page, path) => { await page.goto(`${BASE}${path}`); await page.reload(); };
const shot = async (page, name, fullPage = true) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage }); };
const text = (page, sel) => page.locator(sel).first().innerText();
const texts = (page, sel) => page.locator(sel).allInnerTexts();
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const smallTargets = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((el) => el.offsetParent && el.getBoundingClientRect().height < 43.5)
  .map((el) => `${el.textContent.trim().slice(0, 20)}:${Math.round(el.getBoundingClientRect().height)}`), sel);
let passed = 0;
async function step(name, fn) {
  try { await fn(); } catch (err) {
    console.error(`not ok - ${name}\n  page errors: ${JSON.stringify(errors)}\n  last calls: ${JSON.stringify(calls.slice(-2)).slice(0, 900)}`);
    throw err;
  }
  passed += 1;
  console.log(`ok - ${name}`);
}
const lastCreate = () => calls.filter((c) => c.createQuote).at(-1).createQuote;
async function drawAndSign(page, name) {
  await page.locator('#s-name').fill(name);
  await page.locator('#pad').scrollIntoViewIfNeeded();
  const box = await page.locator('#pad').boundingBox();
  await page.mouse.move(box.x + 40, box.y + 80);
  await page.mouse.down();
  for (let i = 0; i <= 20; i += 1) await page.mouse.move(box.x + 40 + i * 9, box.y + 80 - Math.sin(i / 3) * 25);
  await page.mouse.up();
  await page.locator('#s-consent').check();
  await page.locator('#btn-sign').click();
  await page.locator('#signed').waitFor();
}

let exitCode = 0;
try {
  const irit = await newPage();
  await signIn(irit, 'quotes.html', 'irit');
  await irit.locator('#list-block').waitFor();
  let q;
  await step('the builder: "משפיען לבחירה" last (beside Arik since 8.11.2026); Natali\'s package said as one to be chosen; only the monthly photographer to add', async () => {
    await irit.goto(`${BASE}index.html`);
    await irit.locator('#start-agreement').click();
    await irit.locator('#c-name').fill('סיוון פנסו');
    await irit.locator('#c-company').fill('סטודיו לעיצוב פנים');
    await irit.locator('#c-companyid').fill('514729938');
    await irit.locator('#c-phone').fill('050-1234567');
    const names = await texts(irit, '#influencers .inf-name');
    assert.deepEqual(names, ['נטלי דדון', 'סמיון, מישל ודניס', 'נירו לוי', 'הצל (יואב אליאסי)', 'אריק משעלי', 'משפיען לבחירה']);
    await irit.locator('label[for="inf-choice"]').click();
    assert.equal(await irit.locator('#inf-choice').isChecked(), true);
    assert.match(await text(irit, '#included .included-title'), /משפיען לבחירה/);
    assert.match(await text(irit, '#included ul'), /יום צילום בבית העסק, עם משפיען מרשימת המשפיענים של אסטרטג שייבחר בתיאום עם בית העסק/);
    assert.match(await text(irit, '#included ul'), /36\s*סרטונים בבית העסק/);
    assert.doesNotMatch(await text(irit, '#included ul'), /קולאב/);
    assert.deepEqual(await irit.locator('#paid input').evaluateAll((els) => els.map((e) => e.id)), ['paid-photographer']);
    assert.equal(await text(irit, '#t-mnet'), '3,900 ₪');
    assert.equal(await noSideScroll(irit), true);
    await irit.locator('#influencers').scrollIntoViewIfNeeded();
    await shot(irit, '01-builder-choice-desktop', false);
    await irit.locator('#btn-preview').click();
    await irit.locator('#dlg-preview[open]').waitFor();
    const doc = await irit.locator('#preview-body').innerText();
    assert.match(doc, /משפיען לבחירה מרשימת המשפיענים של אסטרטג/);
    assert.match(doc, /בהשתתפות משפיען מרשימת המשפיענים של אסטרטג שייבחר בתיאום עם בית העסק/);
    assert.doesNotMatch(doc, /נטלי|נירו|הצל \(/);
    await shot(irit, '02-preview-choice-desktop', false);
    await irit.keyboard.press('Escape');
    await irit.locator('#btn-link').click();
    await irit.locator('#dlg-share[open]').waitFor();
    assert.equal(lastCreate().selection.influencer, 'choice');
    q = quotes.at(-1);
    assert.equal(q.model.package.id, 'social-choice');
  });

  await step('the client\'s document on a phone: the head says it, the client signs', async () => {
    const client = await newPage({ width: 390, height: 844 });
    await client.goto(`${BASE}q.html?t=${q.token}`);
    await client.locator('#signbox').waitFor();
    assert.match(await client.locator('body').innerText(), /משפיען לבחירה מרשימת המשפיענים של אסטרטג/);
    assert.equal(await noSideScroll(client), true);
    await shot(client, '03-document-choice-phone-top', false);
    if (OUT) await client.locator('.qd-grid').first().screenshot({ path: `${OUT}/04-document-package-phone.png` });
    await drawAndSign(client, 'סיוון פנסו');
    await client.context().close();
  });

  let c;
  await step('the card: "משפיען: עוד לא נבחר" and "בחירת משפיען" opens "סוג יום הצילום"', async () => {
    c = tables.clients.find((x) => x.quote_id === q.id);
    assert.equal(c.shoot_type, null);
    await irit.goto(`${BASE}client.html?id=${c.id}`);
    const fact = irit.locator('.cc-facts .fact', { hasText: 'משפיען' }).first();
    await fact.waitFor();
    assert.match(await fact.innerText(), /עוד לא נבחר/);
    await irit.waitForTimeout(2500); // the sign-in veil fades
    await shot(irit, '05-card-choice-desktop', false);
    await irit.locator('#cc-choose-inf').click();
    await irit.locator('#ed-shoot-type').waitFor({ state: 'visible' });
    assert.equal(await irit.evaluate(() => document.activeElement?.id), 'ed-shoot-type');
    await shot(irit, '06-card-choose-dialog-desktop', false);
  });

  await step('the card and the builder on a phone', async () => {
    const phone = await newPage({ width: 390, height: 844 });
    await signIn(phone, 'quotes.html', 'irit');
    await phone.locator('#list-block').waitFor();
    await phone.goto(`${BASE}client.html?id=${c.id}`);
    const fact = phone.locator('.cc-facts .fact', { hasText: 'משפיען' }).first();
    await fact.waitFor();
    await fact.scrollIntoViewIfNeeded();
    assert.equal(await noSideScroll(phone), true);
    assert.deepEqual(await smallTargets(phone, '#cc-choose-inf'), []);
    await phone.waitForTimeout(2500); // the sign-in veil fades
    await shot(phone, '07-card-choice-phone', false);
    await phone.goto(`${BASE}index.html`);
    await phone.locator('#start-agreement').click();
    await phone.locator('label[for="inf-choice"]').click();
    await phone.locator('#influencers').scrollIntoViewIfNeeded();
    assert.equal(await noSideScroll(phone), true);
    await shot(phone, '08-builder-choice-phone', false);
    await phone.context().close();
  });

  await step('Stav\'s form on a phone: "משפיען לבחירה" is a choice and goes in the deal', async () => {
    const stav = await newPage({ width: 360, height: 780 });
    await signIn(stav, 'clients.html', 'stav');
    await stav.waitForURL(/deal\.html/);
    await stav.waitForSelector('#deal-form:not([hidden])');
    await stav.fill('#d-business', 'פיצה רון');
    await stav.fill('#d-contact', 'רון כהן');
    await stav.fill('#d-phone', '050-7654321');
    await stav.fill('#d-company_id', '514729938');
    await stav.check('#d-doc-agreement');
    await stav.click('#d-to-package');
    assert.match(await stav.locator('label[for="d-influencer-choice"]').innerText(), /משפיען לבחירה/);
    await stav.check('#d-influencer-choice');
    await stav.check('#d-tier-social');
    await stav.locator('#d-influencer-choice').scrollIntoViewIfNeeded();
    assert.equal(await noSideScroll(stav), true);
    await shot(stav, '09-deal-choice-phone', false);
    await stav.click('#d-submit');
    await stav.waitForFunction(() => document.querySelectorAll('#deal-list .deal-item').length === 1);
    assert.equal(calls.filter((x) => x.dealInsert).at(-1).dealInsert.influencer, 'choice');
    assert.match(await stav.locator('#deal-list .deal-item').first().innerText(), /משפיען לבחירה/);
    await stav.context().close();
  });

  // Arik Mishali (the owner, 8.11.2026; docs/ops.md, section 109): Natali's packages in his name.
  await step('Arik Mishali: the builder, Stav\'s form, and the card\'s "עם מי"', async () => {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const page = await newPage(viewport);
      await signIn(page, 'quotes.html', 'irit');
      await page.locator('#list-block').waitFor();
      await page.goto(`${BASE}index.html`);
      await page.locator('#start-agreement').click();
      await page.locator('label[for="inf-arik"]').click();
      assert.equal(await page.locator('#inf-arik').isChecked(), true);
      assert.match(await text(page, '#included .included-title'), /אריק משעלי/);
      assert.match(await text(page, '#included ul'), /יום צילום בבית העסק עם אריק משעלי/);
      assert.doesNotMatch(await text(page, '#included ul'), /נטלי/);
      assert.deepEqual(await page.locator('#paid input').evaluateAll((els) => els.map((e) => e.id)), ['paid-photographer', 'paid-arik-reel', 'paid-arik-story']);
      assert.equal(await text(page, '#t-mnet'), '3,900 ₪');
      assert.equal(await noSideScroll(page), true);
      await page.locator('#influencers').scrollIntoViewIfNeeded();
      await shot(page, `10-builder-arik-${viewport.width}`, false);
      await page.locator('#paid').scrollIntoViewIfNeeded();
      await shot(page, `11-builder-arik-paid-${viewport.width}`, false);
      await page.context().close();
    }
    const stav = await newPage({ width: 360, height: 780 });
    await signIn(stav, 'clients.html', 'stav');
    await stav.waitForURL(/deal\.html/);
    await stav.waitForSelector('#deal-form:not([hidden])');
    await stav.check('#d-doc-agreement');
    await stav.click('#d-to-package');
    assert.match(await stav.locator('label[for="d-influencer-arik"]').innerText(), /אריק משעלי/);
    await stav.check('#d-influencer-arik');
    await stav.locator('#d-influencer-arik').scrollIntoViewIfNeeded();
    assert.equal(await noSideScroll(stav), true);
    await shot(stav, '12-deal-arik-phone', false);
    await stav.context().close();
    // The card: "בחירת משפיען" ← "אריק משעלי", saved as his shoot type.
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const page = await newPage(viewport);
      await signIn(page, 'quotes.html', 'irit');
      await page.locator('#list-block').waitFor();
      await page.goto(`${BASE}client.html?id=${c.id}`);
      await page.locator('.cc-facts .fact').first().waitFor();
      await page.waitForTimeout(2500); // the sign-in veil fades
      if (!c.shoot_type) {
        await page.locator('#cc-choose-inf').click();
        await page.locator('#ed-shoot-type').waitFor({ state: 'visible' });
        assert.ok((await page.locator('#ed-shoot-type option').allInnerTexts()).includes('אריק משעלי'));
        await page.selectOption('#ed-shoot-type', 'arik');
        await shot(page, `13-card-pick-arik-${viewport.width}`, false);
        await page.locator('#ed-submit').click();
        await page.waitForFunction(() => !document.querySelector('#dlg-edit[open]'));
        for (let i = 0; i < 50 && tables.clients.find((x) => x.id === c.id).shoot_type !== 'arik'; i += 1) await page.waitForTimeout(100);
        assert.equal(tables.clients.find((x) => x.id === c.id).shoot_type, 'arik');
      }
      await page.goto(`${BASE}client.html?id=${c.id}`);
      await page.locator('.cc-facts').first().waitFor();
      await page.waitForTimeout(2500);
      assert.match(await page.locator('main').innerText(), /אריק משעלי/);
      assert.equal(await noSideScroll(page), true);
      await shot(page, `14-card-arik-${viewport.width}`, false);
      await page.context().close();
    }
  });

  assert.deepEqual(errors, [], 'no page errors');
  console.log(`\n${passed} steps passed`);
} catch (err) {
  console.error(err);
  exitCode = 1;
} finally {
  await browser.close();
  noCspViolations();
}
process.exit(exitCode);
