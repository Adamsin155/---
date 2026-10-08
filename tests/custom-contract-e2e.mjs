// End-to-end check of custom (exceptional) contracts and their approval in the browser
// (the owner's decisions of 6.10.2026), against an in-memory fake of Supabase that
// answers as the database and the create-quote function do (the engine itself runs in
// the fake: app/pricing.js; the database rules are tested in tests/sql):
//   - a regular contract is unchanged: the same request, a link at once, signable;
//   - Irit builds a custom contract → "שליחה לאישור", no link; the client's link does
//     not exist; Lior sees "חוזים חריגים לאישור" with what differs and rejects with a
//     note → Irit fixes and resubmits → Ofir approves → the link works → the client
//     signs → the client opens with the custom quantities;
//   - Stav writes "הצעה אחרת" → Irit's builder opens in custom mode from it → his list
//     shows "ממתין לאישור מנהל", "לא אושר", "חוזה נשלח", "נחתם";
//   - phones (375px): nothing scrolls sideways, targets of 44px.
// Run: npx http-server -p 8111 -s -c-1 . &  then
//      BASE_URL=http://localhost:8111/ node tests/custom-contract-e2e.mjs [outDir]
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
  if (!body.client?.name?.trim()) return json(400, { error: 'client name required' });
  const exceptions = exceptionOf(selection);
  if ((exceptions.length || body.revise) && !isOffice(me)) return json(403, { error: 'custom contracts are prepared by the office' });
  const model = buildQuoteModel(selection, body.client);
  if (body.revise) {
    const q = quotes.find((x) => x.id === body.revise);
    if (!q || q.status !== 'sent' || q.approval === 'none') return json(409, { error: 'this contract can no longer be changed' });
    Object.assign(q, {
      model: { ...model, number: q.number, createdAt: q.created_at }, client_name: model.client.name, monthly_gross_agorot: model.totals.monthlyGross, term_gross_agorot: model.totals.termGross,
      exceptions: exceptions.length ? exceptions : null, approval: exceptions.length ? 'pending' : 'none', approval_by: null, approval_by_email: null, approval_at: null, approval_note: null,
      version: q.version + 1, submitted_at: exceptions.length ? serverNow() : null, submitted_by_email: me.email, first_viewed_at: null,
    });
    stamp(q, exceptions.length ? null : model.validHours);
    syncDeal(q);
    return json(200, { id: q.id, number: q.number, created_at: q.created_at, approval: q.approval, version: q.version, ...(q.approval === 'none' ? { token: q.token } : {}) });
  }
  const q = {
    id: randomUUID(), token: randomUUID(), number: `AST-2026-${String(++seq).padStart(4, '0')}`, created_at: serverNow(), created_by: me.id, created_by_email: me.email,
    model, client_name: model.client.name, monthly_gross_agorot: model.totals.monthlyGross, term_gross_agorot: model.totals.termGross, status: 'sent',
    first_viewed_at: null, signed_at: null, signer_name: null, signature_png: null,
    approval: exceptions.length ? 'pending' : 'none', approval_by: null, approval_by_email: null, approval_at: null, approval_note: null,
    exceptions: exceptions.length ? exceptions : null, version: 1, submitted_at: exceptions.length ? serverNow() : null, submitted_by_email: me.email,
  };
  q.model = { ...model, number: q.number, createdAt: q.created_at };
  stamp(q, exceptions.length ? null : model.validHours);
  quotes.push(q);
  // Waiting for a manager: no token goes back.
  if (exceptions.length) return json(200, { id: q.id, number: q.number, created_at: q.created_at, approval: 'pending' });
  return json(200, { id: q.id, token: q.token, number: q.number, created_at: q.created_at });
}

const view = (q) => ({
  number: q.number, createdAt: q.created_at, model: q.model, docHash: 'ab'.repeat(32), expiresAt: q.expires_at,
  expired: q.status !== 'signed' && !!q.expires_at && new Date(q.expires_at) < new Date(serverNow()),
  consentText: `קראתי ואני מאשר/ת את הסכם ההתקשרות ${q.number}, בהתחייבות ל־${q.model.termMonths} חודשים`, signatureHash: q.signature_png ? 'cd'.repeat(32) : null,
  status: q.status, signerName: q.signer_name, signedAt: q.signed_at, signaturePng: q.signature_png,
});
const hidden = (q) => !q || q.status === 'cancelled' || ['pending', 'rejected'].includes(q.approval);

function rpc(name, body, me, json) {
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
      package_name: `${m.package.tierName} · ${m.package.influencer}`, shoot_type: m.selection.influencer === 'natali' ? 'natali' : 'dms', characterizer: 'ofir',
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
  const rows = (tables[m[1]] || []).filter(matcher(filtersOf(url).filter(([k]) => k === 'id' || k === 'client_id')));
  return answer(req, json)(rows);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
async function newPage(viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport });
  await ctx.clock.install({ time: new Date(serverNow()) });
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
  // ── A regular contract is unchanged ────────
  const irit = await newPage();
  await signIn(irit, 'quotes.html', 'irit');
  await irit.locator('#list-block').waitFor();
  let regular;
  await step('a regular contract is unchanged: the same request, the link at once, no approval anywhere', async () => {
    await irit.goto(`${BASE}index.html`);
    await irit.locator('#start-agreement').click();
    await irit.locator('#custom-group').waitFor(); // offered to the office, closed
    assert.equal(await irit.locator('#custom-on').isChecked(), false);
    assert.ok(await irit.locator('#custom-body').isHidden());
    assert.equal(await text(irit, '#btn-link'), 'יצירת קישור לחתימה');
    assert.equal(await text(irit, '#t-ynet-label'), '12 חודשים, לפני מע״מ');
    assert.equal(await irit.locator('#discount').getAttribute('max'), '200');
    assert.ok(await irit.locator('#sum-diff').isHidden());
    await irit.locator('#c-name').fill('רון כהן');
    await irit.locator('#c-company').fill('פיצה רון');
    await irit.locator('#c-phone').fill('050-7654321');
    await irit.locator('#discount').fill('200');
    await irit.locator('#btn-link').click();
    await irit.locator('#dlg-share[open]').waitFor();
    const sent = lastCreate();
    // Exactly the selection the builder always sent: no `custom`, no `revise`.
    assert.deepEqual(sent.selection, { ...emptySelection(), docType: 'agreement', discount: 20000 });
    assert.deepEqual(Object.keys(sent), ['selection', 'client']);
    regular = quotes.at(-1);
    assert.equal(regular.approval, 'none');
    assert.equal(JSON.stringify({ ...regular.model, number: null, createdAt: null, validUntil: undefined }),
      JSON.stringify(buildQuoteModel({ ...emptySelection(), docType: 'agreement', discount: 20000 }, sent.client)));
    assert.match(await irit.locator('#sh-link').inputValue(), new RegExp(`q\\.html#t=${regular.token}$`));
    assert.match(await irit.locator('#sh-wa').getAttribute('href'), /12%20%D7%97%D7%95%D7%93%D7%A9%D7%99%D7%9D/); // "12 חודשים"
    await irit.locator('#dlg-share .close').click();
    const anon = await newPage({ width: 390, height: 844 });
    await anon.goto(`${BASE}q.html?t=${regular.token}`);
    await anon.locator('#signbox').waitFor();
    assert.equal(await anon.locator('.qd-clauses > li').count(), buildQuoteModel({ ...emptySelection(), docType: 'agreement' }, { name: 'x' }).legal.length);
    assert.equal(await anon.locator('.qd-clauses h3', { hasText: 'תנאים מיוחדים' }).count(), 0);
    await anon.context().close();
    // The list: a regular row, no approval state, the usual actions.
    await irit.goto(`${BASE}quotes.html`);
    const row = irit.locator('#rows tr', { hasText: regular.number });
    await row.waitFor();
    assert.equal((await row.locator('.apv-cell').innerText()).trim(), '—');
    assert.match(await row.locator('.pill').innerText(), /^נצפה/); // the client opened it a moment ago
    assert.deepEqual(await row.locator('.acts .btn').allInnerTexts(), ['תזכורת בוואטסאפ', 'פתיחה', 'העתקת קישור', 'ביטול']);
    assert.equal(await irit.locator('#filters .chip').count(), 5);
  });

  // ── Irit builds a custom contract ──────────
  let custom;
  await step('Irit: "חוזה מותאם אישית" opens the overrides; the panel lists what differs; the summary follows', async () => {
    await irit.goto(`${BASE}index.html`);
    await irit.evaluate(() => sessionStorage.clear());
    await irit.reload();
    await irit.locator('#start-agreement').click();
    await irit.locator('#custom-group').waitFor();
    await irit.locator('#c-name').fill('דנה לוי');
    await irit.locator('#c-company').fill('קפה דנה');
    await irit.locator('#c-phone').fill('050-1234567');
    await irit.locator('.custom-head .switch').click();
    await irit.locator('#custom-body').waitFor();
    // Steppers prefilled from the package (Social · Simeon): nothing differs yet.
    assert.equal(await irit.locator('#cq-videos').inputValue(), '25');
    assert.equal(await irit.locator('#cq-graphics').inputValue(), '35');
    assert.equal(await irit.locator('#cq-collabs').inputValue(), '1');
    assert.equal(await irit.locator('#custom-price').inputValue(), '3900');
    assert.equal(await irit.locator('#custom-term').inputValue(), '12');
    assert.equal(await irit.locator('#cq-monthly').count(), 0, 'the monthly photographer is not in this contract');
    assert.match(await text(irit, '#custom-diff'), /אין שינוי מהחבילה/);
    assert.equal(await text(irit, '#btn-link'), 'יצירת קישור לחתימה');
    for (let i = 0; i < 5; i += 1) await irit.locator('#cq-videos-inc').click();
    await irit.locator('#cq-collabs-dec').click();
    await irit.locator('#discount').fill('350');
    await irit.locator('#custom-term').fill('6');
    await irit.locator('#custom-add-line').click();
    await irit.locator('#cl-label-0').fill('אתר תדמית');
    await irit.locator('#cl-qty-0').fill('1');
    await irit.locator('#cl-price-0').fill('500');
    await irit.locator('#custom-terms').fill('הלקוח רשאי לסיים את ההסכם אחרי 3 חודשים, בהודעה של 30 ימים.');
    assert.deepEqual(await texts(irit, '#custom-diff-list li'), [
      '30 סרטונים במקום 25', '0 קולאבים באינסטגרם במקום 1', 'הנחה חודשית 350 ₪ (המותר בלי אישור: 200 ₪)', 'תקופה 6 חודשים במקום 12',
      'שורה נוספת: אתר תדמית × 1 · 500 ₪ לחודש', 'תנאים מיוחדים',
    ]);
    assert.match(await text(irit, '#custom-diff .needs'), /אדם, אופיר או ליאור/);
    // 3,900 + 500 − 350 = 4,050; VAT 729; six months.
    assert.equal(await text(irit, '#t-mnet'), '4,050 ₪');
    assert.equal(await text(irit, '#t-mgross'), '4,779 ₪');
    assert.equal(await text(irit, '#t-ynet-label'), '6 חודשים, לפני מע״מ');
    assert.equal(await text(irit, '#t-ynet'), '24,300 ₪');
    assert.equal(await text(irit, '#t-ygross'), '28,674 ₪');
    assert.match(await text(irit, '#sum-diff'), /חוזה חריג · 6 שינויים מהחבילה/);
    assert.equal(await text(irit, '#btn-link'), 'שליחה לאישור');
    assert.match(await text(irit, '#act-hint'), /הקישור ללקוח נוצר אחרי האישור/);
    assert.equal(await noSideScroll(irit), true);
    await shot(irit, '01-builder-custom-desktop');
    // The preview is the document the client will get.
    await irit.locator('#btn-preview').click();
    await irit.locator('#dlg-preview[open]').waitFor();
    assert.equal(await irit.locator('#preview-body .qd-clauses > li').last().locator('h3').innerText(), `${buildQuoteModel({ ...emptySelection(), docType: 'agreement' }, { name: 'x' }).legal.length + 1}.תנאים מיוחדים`.replace('.', '.'));
    assert.match(await irit.locator('#preview-body .qd-clauses > li').last().innerText(), /יגבר התנאי המיוחד, אך ורק במידה שנקבעה בו במפורש/);
    assert.match(await irit.locator('#preview-body .qd-grid').innerText(), /30\s*סרטונים בבית העסק/);
    assert.doesNotMatch(await irit.locator('#preview-body .qd-grid').innerText(), /קולאב/);
    assert.match(await irit.locator('#preview-body .qd-pricing').innerText(), /אתר תדמית/);
    await shot(irit, '02-builder-preview-special-terms', false);
    await irit.locator('#dlg-preview .close').click();
  });

  await step('"שליחה לאישור": stored as pending, no link comes back, and to the client it does not exist', async () => {
    await irit.locator('#btn-link').click();
    await irit.locator('#dlg-pending[open]').waitFor();
    custom = quotes.at(-1);
    assert.equal(custom.approval, 'pending');
    assert.equal(custom.expires_at, null);
    assert.equal(await text(irit, '#pd-number'), custom.number);
    assert.equal(await irit.locator('#pd-list li').count(), 6);
    assert.ok(await irit.locator('#dlg-share').isHidden());
    // The request: the selection with `custom`, never totals; the answer carries no token.
    const sent = lastCreate();
    assert.deepEqual(sent.selection.custom, { qty: { videos: 30, collabs: 0 }, termMonths: 6, lines: [{ label: 'אתר תדמית', qty: 1, monthly: 50000 }], terms: 'הלקוח רשאי לסיים את ההסכם אחרי 3 חודשים, בהודעה של 30 ימים.', discount: 35000 });
    assert.ok(!JSON.stringify(sent).includes('monthlyGross'));
    await shot(irit, '03-sent-for-approval-dialog', false);
    await irit.locator('#dlg-pending [data-close]').last().click();
    const anon = await newPage({ width: 390, height: 844 });
    await anon.goto(`${BASE}q.html?t=${custom.token}`);
    await anon.locator('#state h1').waitFor();
    await anon.waitForFunction(() => !/טוען/.test(document.getElementById('state').textContent));
    assert.ok(await anon.locator('#doc').isHidden());
    assert.ok(await anon.locator('#signbox').isHidden());
    await anon.context().close();
  });

  await step('Irit sees "ממתין לאישור" on quotes.html and in her work list, with nothing to send', async () => {
    await irit.goto(`${BASE}quotes.html`);
    const row = irit.locator('#rows tr', { hasText: custom.number });
    await row.waitFor();
    assert.equal(await row.locator('.pill').innerText(), 'ממתין לאישור');
    assert.match(await row.locator('.apv-cell').innerText(), /ממתין לאישור/);
    assert.deepEqual(await row.locator('.acts .btn').allInnerTexts(), ['תיקון', 'ביטול']);
    assert.equal(await irit.locator('#filters .chip', { hasText: 'באישור מנהל' }).count(), 1);
    await shot(irit, '04-quotes-approval-column');
    await fresh(irit, "clients.html#mine");
    const card = irit.locator('#approvals-card');
    await card.locator('.apv-item').waitFor();
    assert.equal(await card.locator('h2').innerText(), 'חוזים חריגים (1)');
    assert.equal(await card.locator('.apv-state').innerText(), 'ממתין לאישור');
    assert.equal(await card.locator('[data-act="approve"], [data-act="reject"]').count(), 0, 'Irit does not decide');
    assert.match(await card.locator('.apv-item').innerText(), /מספיק שאחד מהם יאשר/);
  });

  // ── Lior rejects with a note ───────────────
  const lior = await newPage({ width: 1280, height: 900 });
  await step('Lior: "חוזים חריגים לאישור (1)" on his first screen, with what differs, the totals, who prepared it and the preview', async () => {
    await signIn(lior, 'decisions.html', 'lior');
    const card = lior.locator('#approvals-card');
    await card.locator('.apv-item').waitFor();
    assert.equal(await card.locator('h2').innerText(), 'חוזים חריגים לאישור (1)');
    const item = card.locator('.apv-item');
    assert.equal(await item.locator('.apv-title').innerText(), 'קפה דנה');
    assert.match(await item.locator('.apv-meta').first().innerText(), /Social all in one · סמיון, מישל ודניס · AST-2026-\d+ · הכין\/ה: עירית/);
    assert.deepEqual(await item.locator('.apv-diff li').allInnerTexts(), custom.exceptions.map((e) => e.text));
    // He sees the price and the discount of what he is asked to approve.
    const facts = await item.locator('.apv-facts').innerText();
    for (const re of [/לחודש לפני מע״מ\s*4,050 ₪/, /הנחה לחודש\s*350 ₪/, /לחודש כולל מע״מ\s*4,779 ₪/, /תקופה\s*6 חודשים/, /סה״כ כולל מע״מ\s*28,674 ₪/]) assert.match(facts, re);
    assert.deepEqual(await item.locator('.apv-acts .btn').allInnerTexts(), ['מאשר', 'לא מאשר', 'תצוגת ההסכם']);
    await shot(lior, '05-approver-card-desktop');
    await item.locator('[data-act="preview"]').click();
    await lior.locator('#dlg-approval-preview[open]').waitFor();
    assert.match(await lior.locator('#dlg-approval-preview .qd-clauses').innerText(), /תנאים מיוחדים/);
    assert.match(await lior.locator('#dlg-approval-preview .qd-top').innerText(), /6 חודשים/);
    await lior.locator('#dlg-approval-preview .close').click();
  });

  await step('the card on a phone (375px): one column, 44px targets, nothing scrolls sideways', async () => {
    const phone = await newPage({ width: 375, height: 800 });
    await signIn(phone, 'decisions.html', 'lior');
    await phone.locator('#approvals-card .apv-item').waitFor();
    assert.equal(await noSideScroll(phone), true);
    assert.deepEqual(await smallTargets(phone, '#approvals-card .btn'), []);
    await phone.locator('#approvals-card').scrollIntoViewIfNeeded();
    await shot(phone, '06-approver-card-phone');
    await phone.locator('#approvals-card [data-act="reject"]').click();
    await phone.locator('.apv-reject textarea').waitFor();
    assert.equal(await noSideScroll(phone), true);
    assert.deepEqual(await smallTargets(phone, '#approvals-card .btn, #approvals-card textarea'), []);
    await shot(phone, '07-approver-reject-note-phone');
    await phone.context().close();
  });

  await step('"לא מאשר" asks for a note; with it the contract goes back, and it leaves his list', async () => {
    const item = lior.locator('#approvals-card .apv-item');
    await item.locator('[data-act="reject"]').click();
    const note = item.locator('.apv-reject textarea');
    await note.waitFor();
    await item.locator('[data-act="reject-send"]').click();
    assert.ok(await item.locator('.apv-reject .err').isVisible());
    assert.equal(calls.filter((c) => c.quote_reject).length, 0, 'nothing was sent without a note');
    await note.fill('ההנחה גבוהה מדי. עד 300 ₪.');
    await item.locator('[data-act="reject-send"]').click();
    await lior.locator('#approvals-card h2', { hasText: 'חוזים חריגים (1)' }).waitFor();
    assert.deepEqual([custom.approval, custom.approval_by, custom.approval_note], ['rejected', 'lior', 'ההנחה גבוהה מדי. עד 300 ₪.']);
    assert.match(await text(lior, '#toast'), /חזר לעירית עם ההערה/);
    assert.equal(await lior.locator('#approvals-card [data-act="approve"]').count(), 0);
  });

  // ── Irit fixes and resubmits ───────────────
  await step('Irit: "לא אושר: <הערה>" with "תיקון ושליחה מחדש"; the builder opens on the same contract with the note', async () => {
    await irit.goto(`${BASE}quotes.html`);
    const row = irit.locator('#rows tr', { hasText: custom.number });
    await row.waitFor();
    assert.match(await row.locator('.apv-cell').innerText(), /לא אושר\s*ליאור: ההנחה גבוהה מדי\. עד 300 ₪\./);
    assert.deepEqual(await row.locator('.acts .btn').allInnerTexts(), ['תיקון ושליחה מחדש', 'ביטול']);
    await fresh(irit, "clients.html#mine");
    const item = irit.locator('#approvals-card .apv-item');
    await item.waitFor();
    assert.equal(await item.locator('.apv-state').innerText(), 'לא אושר');
    assert.match(await item.locator('.apv-note').innerText(), /ליאור לא אישר\/ה: ההנחה גבוהה מדי\. עד 300 ₪\./);
    await shot(irit, '08-irit-rejected-in-work-list');
    await item.locator('[data-act="revise"]').click();
    await irit.waitForURL(/index\.html\?revise=/);
    await irit.locator('#revise-note:not([hidden])').waitFor();
    assert.match(await text(irit, '#revise-note'), new RegExp(`תיקון חוזה ${custom.number} · לא אושר: ההנחה גבוהה מדי`));
    assert.equal(await irit.locator('#custom-on').isChecked(), true);
    assert.equal(await irit.locator('#cq-videos').inputValue(), '30');
    assert.equal(await irit.locator('#discount').inputValue(), '350');
    assert.equal(await irit.locator('#custom-term').inputValue(), '6');
    assert.equal(await irit.locator('#cl-label-0').inputValue(), 'אתר תדמית');
    assert.equal(await irit.locator('#custom-terms').inputValue(), 'הלקוח רשאי לסיים את ההסכם אחרי 3 חודשים, בהודעה של 30 ימים.');
    assert.equal(await irit.locator('#c-company').inputValue(), 'קפה דנה');
    await irit.locator('#discount').fill('300');
    assert.ok((await texts(irit, '#custom-diff-list li')).includes('הנחה חודשית 300 ₪ (המותר בלי אישור: 200 ₪)'));
    await irit.locator('#btn-link').click();
    await irit.locator('#dlg-pending[open]').waitFor();
    assert.equal(lastCreate().revise, custom.id);
    assert.deepEqual([custom.approval, custom.version, custom.approval_note, custom.model.totals.discount], ['pending', 2, null, 30000]);
    assert.equal(quotes.filter((q) => q.number === custom.number).length, 1, 'the same quote, a new version');
    await irit.locator('#dlg-pending [data-close]').last().click();
  });

  // ── Ofir approves ──────────────────────────
  const ofir = await newPage({ width: 1280, height: 900 });
  await step('Ofir approves on his first screen: one approval is enough; Lior has nothing left to decide', async () => {
    await signIn(ofir, 'qa.html', 'ofir');
    const item = ofir.locator('#approvals-card .apv-item');
    await item.waitFor();
    assert.equal(await ofir.locator('#approvals-card h2').innerText(), 'חוזים חריגים לאישור (1)');
    assert.match(await item.locator('.apv-meta').first().innerText(), /גרסה 2/);
    assert.ok((await item.locator('.apv-diff li').allInnerTexts()).includes('הנחה חודשית 300 ₪ (המותר בלי אישור: 200 ₪)'));
    await item.locator('[data-act="approve"]').click();
    await ofir.locator('#approvals-card .apv-state.is-approved').waitFor();
    assert.deepEqual([custom.approval, custom.approval_by], ['approved', 'ofir']);
    // The signing window starts at the approval.
    assert.ok(Math.abs(Date.parse(custom.expires_at) - Date.parse(serverNow()) - 72 * 3600e3) < 60e3);
    await lior.reload();
    await lior.locator('#approvals-card .apv-item').waitFor();
    assert.equal(await lior.locator('#approvals-card [data-act="approve"]').count(), 0);
    assert.equal(await lior.locator('#approvals-card .apv-state').innerText(), 'אושר — אפשר לשלוח');
  });

  await step('Irit: "אושר — אפשר לשלוח" with the share dialog; the link works and the client signs', async () => {
    await fresh(irit, "clients.html#mine");
    const item = irit.locator('#approvals-card .apv-item');
    await item.locator('.apv-state.is-approved').waitFor();
    assert.match(await item.innerText(), /אישר\/ה אופיר/);
    await item.locator('[data-act="share"]').click();
    await irit.locator('#dlg-approval-share[open]').waitFor();
    const link = await irit.locator('#aps-link').inputValue();
    assert.match(link, new RegExp(`q\\.html#t=${custom.token}$`));
    assert.match(decodeURIComponent(await irit.locator('#aps-wa').getAttribute('href')), /wa\.me\/972501234567\?text=שלום דנה לוי, מצורף הסכם ההתקשרות מאסטרטג \(AST-2026-\d+\) ל־6 חודשים\. אפשר לעיין ולחתום כאן בתוך 72 שעות/);
    await shot(irit, '09-irit-approved-share-dialog', false);
    await irit.locator('#dlg-approval-share .close').click();
    // The same from quotes.html.
    await irit.goto(`${BASE}quotes.html`);
    const row = irit.locator('#rows tr', { hasText: custom.number });
    await row.waitFor();
    assert.match(await row.locator('.apv-cell').innerText(), /אושר — אפשר לשלוח\s*אישר\/ה אופיר/);
    await row.locator('[data-act="share"]').click();
    await irit.locator('#dlg-approval-share[open]').waitFor();
    assert.equal(await irit.locator('#aps-link').inputValue(), link);
    await irit.locator('#dlg-approval-share .close').click();

    const client = await newPage({ width: 375, height: 800 });
    await client.goto(link);
    await client.locator('#signbox').waitFor();
    assert.match(await client.locator('#strip-sub').innerText(), /6 חודשים · סה״כ 29,028 ₪ כולל מע״מ/); // (3,900 + 500 − 300) × 1.18 × 6
    assert.match(await client.locator('.qd-clauses').innerText(), /תנאים מיוחדים/);
    assert.match(await client.locator('.qd-grid').innerText(), /30\s*סרטונים בבית העסק/);
    assert.equal(await noSideScroll(client), true);
    await shot(client, '10-client-custom-agreement-phone');
    await drawAndSign(client, 'דנה לוי');
    assert.equal(custom.status, 'signed');
    await client.context().close();
  });

  await step('the client opened with the custom quantities: "X מתוך Y" follows the signed contract, the added line is listed', async () => {
    const c = tables.clients.find((x) => x.quote_id === custom.id);
    assert.deepEqual(c.deliverables, { videos: 30, graphics: 35, shoot_days: 1, collabs: 0, stories: 0, ch14: 0, monthly: 0, extra: [{ label: 'אתר תדמית', qty: 1 }] });
    await irit.goto(`${BASE}client.html?id=${c.id}`);
    await irit.locator('#contract-summary').waitFor();
    assert.equal(await text(irit, '#cs-videos .cs-t'), 'עוד לא בוצעו סרטונים · 30 בחוזה');
    assert.equal(await text(irit, '#cs-graphics .cs-t'), 'עוד לא בוצעו גרפיקות · 35 בחוזה');
    assert.equal(await irit.locator('#cs-collabs').count(), 0, 'the collab was taken out of this contract');
    assert.equal(await text(irit, '.cs-flags'), 'כלול גם: אתר תדמית × 1');
    await shot(irit, '11-client-card-custom-quantities');
    // Signed: it left the approval cards.
    await fresh(irit, "clients.html#mine");
    await irit.locator('#now-bar, #mine-list, .mine').first().waitFor({ state: 'attached' });
    await irit.waitForTimeout(400);
    assert.ok(await irit.locator('#approvals-card').isHidden());
  });

  // ── Stav's "הצעה אחרת" ─────────────────────
  const stav = await newPage({ width: 375, height: 800 });
  let deal;
  await step('Stav: "הצעה אחרת" instead of a built-in package: his words, optional quantities, the price and the term', async () => {
    await signIn(stav, 'deal.html', 'stav');
    await stav.locator('#deal-form').waitFor();
    assert.ok(await stav.locator('#d-custom').isHidden());
    assert.ok(await stav.locator('#d-tiers').isVisible());
    await stav.locator('label[for="d-kind-custom"]').click();
    await stav.locator('#d-custom').waitFor();
    assert.ok(await stav.locator('#d-tiers').isHidden());
    assert.ok(await stav.locator('#d-discount').isHidden());
    assert.equal(await text(stav, '#d-submit'), 'לעירית להכנת חוזה מותאם');
    await stav.locator('#d-business').fill('מוסך אבי');
    await stav.locator('#d-contact').fill('אבי');
    await stav.locator('#d-phone').fill('052-1112233');
    await stav.locator('#d-submit').click();
    assert.ok(await stav.locator('#d-description-err').isVisible());
    assert.ok(await stav.locator('#d-price-err').isVisible());
    assert.equal(deals.length, 0);
    await stav.locator('#d-description').fill('15 סרטונים ו־10 גרפיקות, יום צילום אחד, בלי קולאב');
    await stav.locator('#d-videos').fill('15');
    await stav.locator('#d-graphics').fill('10');
    await stav.locator('#d-price').fill('2500');
    await stav.locator('#d-term_months').fill('6');
    await stav.locator('#d-notes').fill('רוצה להתחיל בנובמבר');
    assert.equal(await noSideScroll(stav), true);
    assert.deepEqual(await smallTargets(stav, '#deal-form .btn, #deal-form input:not([type="radio"]), #deal-form textarea, #deal-form .deal-choice'), []);
    await shot(stav, '12-stav-other-offer-phone');
    await stav.locator('#d-submit').click();
    await stav.locator('.deal-item', { hasText: 'מוסך אבי' }).waitFor();
    deal = deals.at(-1);
    assert.deepEqual(deal.custom, { description: '15 סרטונים ו־10 גרפיקות, יום צילום אחד, בלי קולאב', videos: 15, graphics: 10, price_agorot: 250000, term_months: 6 });
    assert.deepEqual([deal.tier, deal.influencer, deal.discount_agorot], [null, null, 0]);
    const item = stav.locator('.deal-item', { hasText: 'מוסך אבי' });
    assert.equal(await item.locator('.deal-status').innerText(), 'ממתין לחוזה');
    assert.match(await item.innerText(), /הצעה אחרת · 2,500 ₪ לחודש · 6 חודשים · 15 סרטונים · 10 גרפיקות/);
    // A built-in deal still works as before.
    assert.ok(await stav.locator('#d-custom').isHidden(), 'the form is back on the built-in package');
    assert.equal(await text(stav, '#d-submit'), 'לעירית להכנת חוזה');
  });

  await step('Irit opens the builder from it: custom mode, prefilled from what he wrote; sending it stops her clock and waits for a manager', async () => {
    await fresh(irit, "clients.html#mine");
    const task = irit.locator('#deals-card .deal-task', { hasText: 'מוסך אבי' });
    await task.waitFor();
    assert.match(await task.innerText(), /להכין חוזה ל־מוסך אבי/);
    assert.match(await task.innerText(), /הצעה אחרת · 2,500 ₪ לחודש/);
    await task.locator('a.btn', { hasText: 'להכנת החוזה' }).click();
    await irit.waitForURL(/index\.html\?deal=/);
    await irit.locator('#custom-body').waitFor();
    assert.equal(await irit.locator('#custom-on').isChecked(), true);
    assert.equal(await irit.locator('#cq-videos').inputValue(), '15');
    assert.equal(await irit.locator('#cq-graphics').inputValue(), '10');
    assert.equal(await irit.locator('#custom-price').inputValue(), '2500');
    assert.equal(await irit.locator('#custom-term').inputValue(), '6');
    assert.equal(await irit.locator('#custom-terms').inputValue(), '15 סרטונים ו־10 גרפיקות, יום צילום אחד, בלי קולאב');
    assert.equal(await irit.locator('#c-company').inputValue(), 'מוסך אבי');
    assert.equal(await irit.locator('#c-notes').inputValue(), 'רוצה להתחיל בנובמבר');
    assert.equal(await text(irit, '#t-mnet'), '2,500 ₪');
    assert.equal(await text(irit, '#btn-link'), 'שליחה לאישור');
    // Irit turns his text into the terms she wants in the agreement, and takes the collab out.
    await irit.locator('#cq-collabs-dec').click();
    await irit.locator('#custom-terms').fill('החבילה אינה כוללת קולאב אצל המשפיענים.');
    await irit.locator('#btn-link').click();
    await irit.locator('#dlg-pending[open]').waitFor();
    const q = quotes.at(-1);
    assert.deepEqual([q.approval, deal.quote_id, deal.status], ['pending', q.id, 'approval']);
    await irit.locator('#dlg-pending [data-close]').last().click();
    // Her deals card no longer lists it: her part is done.
    await fresh(irit, "clients.html#mine");
    await irit.locator('#approvals-card .apv-item').waitFor();
    assert.equal(await irit.locator('#deals-card .deal-task', { hasText: 'מוסך אבי' }).count(), 0);
  });

  await step('Stav\'s list follows the approval: "ממתין לאישור מנהל" → "לא אושר" → "חוזה נשלח" → "נחתם"; he reads no quote', async () => {
    const q = quotes.at(-1);
    const status = async () => { await stav.reload(); const item = stav.locator('.deal-item', { hasText: 'מוסך אבי' }); await item.waitFor(); return item.locator('.deal-status').innerText(); };
    assert.equal(await status(), 'ממתין לאישור מנהל');
    await shot(stav, '13-stav-waiting-for-manager-phone');
    // Lior sends it back.
    await lior.reload();
    const item = lior.locator('#approvals-card .apv-item', { hasText: 'מוסך אבי' });
    await item.waitFor();
    await item.locator('[data-act="reject"]').click();
    await item.locator('.apv-reject textarea').fill('המחיר נמוך מדי ל־15 סרטונים. לפחות 2,900 ₪.');
    await item.locator('[data-act="reject-send"]').click();
    await lior.locator('#approvals-card .apv-state.is-rejected').first().waitFor();
    assert.equal(await status(), 'לא אושר');
    assert.match(await stav.locator('.deal-item', { hasText: 'מוסך אבי' }).innerText(), /עירית מתקנת ושולחת שוב לאישור/);
    // Irit corrects the price and resubmits.
    await irit.goto(`${BASE}index.html?revise=${q.id}`);
    await irit.locator('#revise-note:not([hidden])').waitFor();
    await irit.locator('#custom-price').fill('2900');
    await irit.locator('#custom-price').blur();
    assert.equal(await text(irit, '#t-mnet'), '2,900 ₪');
    await irit.locator('#btn-link').click();
    await irit.locator('#dlg-pending[open]').waitFor();
    assert.equal(await status(), 'ממתין לאישור מנהל');
    // The owner approves, on his own screen.
    const owner = await newPage({ width: 1280, height: 900 });
    await signIn(owner, 'owner.html', 'owner');
    const mine = owner.locator('#approvals-card .apv-item', { hasText: 'מוסך אבי' });
    await mine.waitFor();
    assert.match(await mine.locator('.apv-facts').innerText(), /לחודש לפני מע״מ\s*2,900 ₪/);
    await shot(owner, '14-owner-card-desktop');
    await mine.locator('[data-act="approve"]').click();
    await owner.locator('#approvals-card .apv-state.is-approved').first().waitFor();
    assert.deepEqual([q.approval, q.approval_by, deal.status], ['approved', 'owner', 'sent']);
    await owner.context().close();
    assert.equal(await status(), 'חוזה נשלח');
    // The client signs.
    const client = await newPage({ width: 390, height: 844 });
    await client.goto(`${BASE}q.html#t=${q.token}`); // the link as it is made now (the others here: as sent before 6.10.2026)
    await client.locator('#signbox').waitFor();
    await drawAndSign(client, 'אבי מוסך');
    await client.context().close();
    assert.equal(await status(), 'נחתם');
    assert.deepEqual(tables.clients.find((c) => c.quote_id === q.id).deliverables, { videos: 15, graphics: 10, shoot_days: 1, collabs: 0, stories: 0, ch14: 0, monthly: 0 });
    // Sales never see quotes: the list is empty for him, and he has no approvals card.
    await stav.goto(`${BASE}quotes.html`);
    await stav.waitForLoadState('networkidle');
    assert.equal(await stav.locator('#rows tr').count(), 0);
  });

  await step('nobody approves their own contract (Lior), another manager may; an editor sees nothing new', async () => {
    // Lior prepares one himself. (Ofir builds no contracts since 8.10.2026: the builder refuses him.)
    await lior.goto(`${BASE}index.html`);
    await lior.evaluate(() => sessionStorage.clear());
    await lior.reload();
    await lior.locator('#start-agreement').click();
    await lior.locator('#custom-group').waitFor();
    await lior.locator('#c-name').fill('גליה');
    await lior.locator('#c-company').fill('קפה גליה');
    await lior.locator('.custom-head .switch').click();
    await lior.locator('#custom-term').fill('3');
    await lior.locator('#btn-link').click();
    await lior.locator('#dlg-pending[open]').waitFor();
    await lior.goto(`${BASE}decisions.html`);
    const own = lior.locator('#approvals-card .apv-item', { hasText: 'קפה גליה' });
    await own.waitFor();
    assert.equal(await own.locator('[data-act="approve"], [data-act="reject"]').count(), 0);
    assert.match(await own.innerText(), /את החוזה הזה הכנת בעצמך: מנהל אחר צריך לאשר אותו/);
    // Ofir may.
    await ofir.goto(`${BASE}qa.html`);
    await ofir.locator('#approvals-card .apv-item', { hasText: 'קפה גליה' }).waitFor();
    assert.equal(await ofir.locator('#approvals-card .apv-item', { hasText: 'קפה גליה' }).locator('[data-act="approve"]').count(), 1);
    // And the builder is not his screen.
    await ofir.goto(`${BASE}index.html`);
    await ofir.getByText('אין לך גישה לעמוד הזה').first().waitFor();
    // An editor: no card (and the database gives her no quote).
    const nadia = await newPage({ width: 390, height: 844 });
    await signIn(nadia, 'clients.html', 'nadia');
    await nadia.waitForLoadState('networkidle');
    assert.ok(await nadia.locator('#approvals-card').isHidden());
    await nadia.context().close();
  });

  await step('the builder on a phone (375px): the custom area in one column, 44px targets, nothing scrolls sideways', async () => {
    const phone = await newPage({ width: 375, height: 800 });
    await signIn(phone, 'quotes.html', 'irit');
    await phone.locator('#list-block').waitFor();
    assert.equal(await noSideScroll(phone), true);
    await shot(phone, '15-quotes-approval-phone');
    await phone.goto(`${BASE}index.html`);
    await phone.locator('#start-agreement').click();
    await phone.locator('#custom-group').waitFor();
    await phone.locator('.custom-head .switch').click();
    await phone.locator('#custom-body').waitFor();
    await phone.locator('#cq-videos-inc').click();
    await phone.locator('#custom-add-line').click();
    await phone.locator('#cl-label-0').fill('אתר תדמית');
    assert.equal(await noSideScroll(phone), true);
    assert.deepEqual(await smallTargets(phone, '#custom-group .btn, #custom-group input.input, #custom-group textarea, #custom-group .stepper button, #custom-group .custom-line .x'), []);
    await phone.locator('#custom-group').scrollIntoViewIfNeeded();
    await shot(phone, '16-builder-custom-phone');
    await phone.context().close();
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
