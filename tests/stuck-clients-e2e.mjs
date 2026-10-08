// Two places where a client was silently lost (docs/ops.md, section 47), in the browser,
// on a phone, against the office of tests/flow-world.mjs (Tuesday 20.10.2026, 10:00 in
// Israel; invented names):
//  A. process 3 with no meeting date: the card stays on Irit's "המשימות שלי" after
//     everything that can be ticked was ticked, says what is missing in one sentence, and
//     the date is set from the card in three taps (the client's own fields, the client
//     card's save path); a client in landing and imported history ask for nothing;
//  B. a contract sent for signature and not signed: one counted line on Irit's list
//     (how many, since when), leading to the list of sent quotes on the ones that wait,
//     each with its reminder and its link; not for a contract a manager still holds, a
//     signed, a cancelled or an expired one; the owners see them in the daily control.
// Run: npx http-server -p 8080 -s -c-1 . &  then  node tests/stuck-clients-e2e.mjs
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { NOW, SUPA, emailOf, flowWorld, makeFlowFake, cid } from './flow-world.mjs';
import { watchCsp, noCspViolations } from './csp-watch.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const PHONE = { width: 390, height: 844 };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(400); };

// A small office: one new deal (signed 20 minutes ago, no meeting date), one client in
// landing with no date at all, one imported mid-way that never had a date here.
const NEW = cid(1);
const LANDING = cid(41);
const IMPORTED = cid(42);
function office() {
  const db = flowWorld({ landing: false, queues: false });
  const base = db.clients.find((c) => c.id === cid(12));
  const fresh = db.clients.find((c) => c.id === NEW);
  const imported = { ...base, id: IMPORTED, name: 'אבנר גולן', business: 'גולן מזגנים', char_at: null, editor: 'anna' };
  const landing = { ...base, id: LANDING, name: 'דנה קורן', business: 'קורן אדריכלות', char_at: null, shoot_at: null, editor: null, landing: true, created_by_email: 'system', deal_at: '2026-06-01T09:00:00+03:00' };
  db.protocol_checks = db.protocol_checks.filter((r) => r.client_id === cid(12)).map((r) => ({ ...r, client_id: IMPORTED }));
  db.clients = [fresh, imported, landing];
  db.client_tasks = [];
  db.deal_requests = [];
  const day = (iso, h) => new Date(Date.parse(iso) + h * 36e5).toISOString();
  const quote = (n, o = {}) => {
    const created = o.created_at || '2026-10-19T11:00:00+03:00';
    return {
      id: `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`, token: `f0000000-0000-4000-8000-${String(n).padStart(12, '0')}`, number: `AST-2026-${String(n).padStart(4, '0')}`,
      client_name: 'רונית דקל', company: 'מאפיית הדקל', phone: '050-5550142', email: null, monthly_gross_agorot: 590000, created_at: created, created_by_email: emailOf('irit'),
      status: 'sent', first_viewed_at: null, signed_at: null, signer_name: null, tier: 'Social all in one', influencer: 'סמיון, מישל ודניס', doc: 'הסכם התקשרות', signable: 'true',
      expires_at: day(created, 72), approval: 'none', approval_by: null, approval_note: null, approval_at: null, term: '12', valid: '72', ...o,
    };
  };
  db.quotes = [
    quote(1),                                                                                                             // sent yesterday, from a field deal
    quote(2, { client_name: 'דנה', company: 'קפה דנה', created_at: '2026-10-20T09:00:00+03:00', created_by_email: emailOf('lior') }), // built directly by Lior, today
    quote(3, { company: 'חריג בע״מ', approval: 'pending', expires_at: null }),                                             // waits for a manager, not for the client
    quote(4, { company: 'חתום בע״מ', status: 'signed', signed_at: '2026-10-19T12:00:00+03:00', signer_name: 'מישהו' }),
    quote(5, { company: 'בוטל בע״מ', status: 'cancelled' }),
    quote(6, { company: 'לצפייה בע״מ', signable: 'false', doc: 'הצעת מחיר' }),
    quote(7, { company: 'פג בע״מ', created_at: '2026-10-12T09:00:00+03:00' }),                                              // its validity ran out last week
  ];
  return db;
}
async function signedIn(role, db, path = 'clients.html#mine') {
  const fake = makeFlowFake(db);
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: PHONE, isMobile: true, hasTouch: true });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, fake.route);
  const page = await ctx.newPage();
  watchCsp(page);
  page.on('pageerror', (e) => errors.push(`${role}: ${e}`));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(`${role}: ${msg.text()}`); });
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', emailOf(role));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  if (path.endsWith('#mine')) await page.waitForSelector('#view-mine:not([hidden])');
  await settle(page);
  return { page, ctx, db, calls: fake.calls };
}
const card = (page, id, proc = 'p03') => page.locator(`#mine-list .wproc[data-key="${id}:${proc}"]`);
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();

let passed = 0;
async function step(name, fn) {
  try { await fn(); passed += 1; console.log(`ok - ${name}`); } catch (e) { console.log(`not ok - ${name}`); throw e; }
}

try {
  // ── A ──
  await step('A: process 3 says what is missing; ticking what can be ticked does not make it leave', async () => {
    const { page, ctx, db } = await signedIn('irit', office());
    const c = card(page, NEW);
    await c.waitFor();
    assert.equal(await text(c.locator('.wneed span')), 'עוד לא נקבע מועד לפגישת האפיון.');
    assert.equal(await text(c.locator('.wneed button')), 'קביעת מועד');
    const box = await c.locator('.wneed button').boundingBox();
    assert.ok(box.height >= 44, `the button is ${box.height}px high`);
    // The three items the card shows are ticked; "the meeting was set" was never offered as a tick.
    await c.locator('button.wc-open').click();
    assert.equal(await c.locator('.cbx').count(), 3);
    for (let i = 0; i < 3; i += 1) { await card(page, NEW).locator('.cbx').first().check(); await settle(page); }
    assert.deepEqual(db.protocol_checks.filter((r) => r.client_id === NEW && r.item_key.startsWith('p03.')).map((r) => r.item_key).sort(), ['p03.available', 'p03.calendar', 'p03.who']);
    assert.equal(await card(page, NEW).count(), 1, 'the card left the list with no meeting date');
    assert.equal(await card(page, NEW).locator('.cbx').count(), 0);
    assert.equal(await text(card(page, NEW).locator('.wneed span')), 'עוד לא נקבע מועד לפגישת האפיון.');
    assert.match(await text(card(page, NEW).locator('.wc-when')), /באיחור/);
    // A fresh load reads the same answer from the data: still hers, still late.
    await page.reload();
    await page.waitForSelector('#view-mine:not([hidden]) .wproc');
    await settle(page);
    assert.equal(await card(page, NEW).locator('.wneed').count(), 1);
    await ctx.close();
  });

  await step('A: the date is set from the card in three taps, through the client\'s own fields; then the card leaves', async () => {
    const db = office();
    for (const k of ['p03.who', 'p03.available', 'p03.calendar']) db.protocol_checks.push({ client_id: NEW, item_key: k, state: 'done', note: null, by_email: emailOf('irit'), at: '2026-10-20T09:44:00+03:00' });
    const { page, ctx, calls } = await signedIn('irit', db);
    await card(page, NEW).locator('.wneed button').click();          // tap 1
    await page.waitForSelector('#dlg-meet[open]');
    assert.equal(await page.locator('#meet-who').inputValue(), 'ofir', 'the default is Ofir');
    // Saving with no date is refused in words, and nothing is written.
    await page.click('#meet-submit');
    assert.equal(await text(page.locator('#meet-err')), 'בחרו יום ושעה לפגישה.');
    assert.equal(calls.filter((x) => x.table === 'clients').length, 0);
    await page.fill('#meet-at', '2026-10-21T10:00');                  // tap 2
    await page.click('#meet-submit');                                 // tap 3
    await page.waitForSelector('#dlg-meet:not([open])', { state: 'attached' });
    await settle(page);
    const saved = calls.filter((x) => x.table === 'clients' && x.method === 'PATCH');
    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0].body, { char_at: new Date('2026-10-21T10:00:00+03:00').toISOString(), characterizer: 'ofir' }, 'only the two fields of the client card');
    const c = db.clients.find((x) => x.id === NEW);
    assert.equal(c.characterizer, 'ofir');
    assert.equal(new Date(c.char_at).toISOString(), new Date('2026-10-21T10:00:00+03:00').toISOString());
    assert.ok(db.protocol_checks.some((r) => r.client_id === NEW && r.item_key === 'p03.scheduled' && r.state === 'done'), '"the meeting was set" is marked with the date');
    assert.equal(await card(page, NEW).count(), 0, 'process 3 is done: the card left');
    assert.match(await text(page.locator('#toast, .toast').first()), /המועד נשמר/);
    await ctx.close();
  });

  await step('A: a client in landing and imported history ask for no date', async () => {
    const { page, ctx } = await signedIn('irit', office());
    await card(page, NEW).waitFor();
    assert.equal(await page.locator('#mine-list .wneed').count(), 1, 'only the new deal asks for a date');
    assert.equal(await card(page, LANDING).count(), 0);
    assert.equal(await card(page, IMPORTED).count(), 0);
    // The whole team's list has none for them either.
    assert.equal(await page.locator(`#mine-list .wproc[data-key^="${LANDING}:"], #mine-list .wproc[data-key="${IMPORTED}:p03"]`).count(), 0);
    await ctx.close();
  });

  // ── B ──
  await step('B: Irit has one counted line for the contracts that wait for a signature, and it opens the list on them', async () => {
    const { page, ctx } = await signedIn('irit', office());
    const line = page.locator('#flow-unsigned');
    await line.waitFor();
    assert.equal(await text(line.locator('strong')), '2 הסכמים מחכים לחתימת הלקוח (הוותיק נשלח אתמול)');
    assert.equal(await line.getAttribute('href'), 'quotes.html#sign');
    assert.ok((await line.boundingBox()).height >= 44);
    assert.ok(await line.evaluate((a) => a.closest('.wgroup').classList.contains('g-today')));
    await line.click();
    await page.waitForSelector('#rows tr');
    await settle(page);
    assert.equal(await text(page.locator('#filters .chip[aria-pressed="true"]')), 'ממתינות לחתימה2');
    // The same two, the one that waits longest first; never the one a manager holds, the signed, the cancelled, the expired.
    assert.deepEqual(await page.locator('#rows tr td[data-label="מספר"] .num').allInnerTexts(), ['AST-2026-0001', 'AST-2026-0002']);
    for (const row of await page.locator('#rows tr').all()) {
      const acts = await text(row.locator('.acts'));
      assert.match(acts, /תזכורת בוואטסאפ/);
      assert.match(acts, /העתקת קישור/);
    }
    // Irit does not see amounts there (docs/ops.md, section 35).
    assert.equal(await page.locator('#rows td.amt').count(), 0);
    assert.doesNotMatch(await text(page.locator('#rows')), /₪/);
    await ctx.close();
  });

  await step('B: with one contract the line names it; with none there is no line; nobody else gets one', async () => {
    const one = office();
    one.quotes = one.quotes.filter((q) => q.number !== 'AST-2026-0002');
    const a = await signedIn('irit', one);
    assert.equal(await text(a.page.locator('#flow-unsigned strong')), 'ההסכם של מאפיית הדקל מחכה לחתימה (נשלח אתמול)');
    await a.ctx.close();
    const none = office();
    none.quotes = none.quotes.filter((q) => !['AST-2026-0001', 'AST-2026-0002'].includes(q.number));
    const b = await signedIn('irit', none);
    await card(b.page, NEW).waitFor();
    assert.equal(await b.page.locator('#flow-unsigned').count(), 0);
    await b.ctx.close();
    for (const role of ['lior', 'ofir', 'ilai']) {
      const x = await signedIn(role, office());
      assert.equal(await x.page.locator('#flow-unsigned').count(), 0, role);
      await x.ctx.close();
    }
  });

  await step('B: the owners see them in the daily control, under "חתימות"', async () => {
    const { page, ctx } = await signedIn('owner', office(), 'clients.html#control');
    await page.waitForSelector('#tp-signatures');
    await settle(page);
    assert.equal(await text(page.locator('#tp-signatures summary .n')), '2');
    await page.locator('#tp-signatures summary').click();
    const items = await text(page.locator('#tp-signatures .tp-items'));
    assert.match(items, /מאפיית הדקל/);
    assert.match(items, /קפה דנה/);
    assert.doesNotMatch(items, /חריג בע״מ|חתום בע״מ|בוטל בע״מ|פג בע״מ/);
    await ctx.close();
  });

  noCspViolations();
  assert.deepEqual(errors, [], `errors on the pages: ${errors.join(' | ')}`);
  console.log(`\nstuck-clients: ${passed} steps passed`);
} finally {
  await browser.close();
}
