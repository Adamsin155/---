// End-to-end check of the photographers' monthly availability in the browser (docs/ops.md,
// sections 39 and 136), against an in-memory fake of Supabase that answers as the database
// does (the database still names Eli: no migration when the app stopped asking him).
// Since 16.11.2026 (the owner: "להוריד את אלי ממסירת הזמינות לגמרי") Eli hands nothing over:
//   - Eli, on an iPhone (WebKit) and in Chrome: no card on his shoot days page, nothing read;
//   - Lior on shoot.html and Irit on prep.html#availability: only Eliel's month (kept by the
//     office), none of Eli's old rows, and no words under "אלי הצלם";
//   - Irit setting Eli's shoot day in the client card: no availability line and nothing
//     asked, only a day another shoot already sits on (a clash) is said and asked;
//   - a day Eliel films: his hint and "סימון זמינות במקומו", as before.
// Run: npx http-server -p 8461 -s -c-1 . &  then
//      BASE_URL=http://localhost:8461/ node tests/availability-e2e.mjs [outDir]
import { chromium, webkit, devices } from 'playwright';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { withClientColumns } from './fake-clients.mjs';
import * as A from '../app/availability-logic.js';
import { dateIL, dayKeyIL } from '../app/tz.js';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
if (OUT) mkdirSync(OUT, { recursive: true });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
// Wednesday 7.10.2026, 10:00 in Jerusalem: November is asked for, until 15.10.
const NOW = dateIL(2026, 10, 7, 10);
let clockNow = NOW; // the moment the pages of the current step live in (the fake's now() too)
const iso = (y, m, d, h = 10) => dateIL(y, m, d, h).toISOString();

const PEOPLE = { owner: null, irit: 'irit', lior: 'lior', ofir: 'ofir', ilai: 'ilai', nadia: 'nadia', eli: 'eli' };
const users = new Map();
const staff = [];
for (const [k, person] of Object.entries(PEOPLE)) {
  const email = `${k}@astrateg.test`;
  users.set(email, { id: randomUUID(), email, aud: 'authenticated', role: 'authenticated', email_confirmed_at: iso(2026, 1, 1) });
  staff.push({ email, person, vault: false });
}
const OFFICE = new Set(['irit', 'lior', 'ofir', 'ilai', null]);
const EXP = Math.floor(dateIL(2027, 6, 1) / 1000);
const jwtFor = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp: EXP })}.sig`;
const sessionFor = (u) => ({ access_token: jwtFor(u), token_type: 'bearer', expires_in: 3 * 3600, expires_at: EXP, refresh_token: `r-${u.id}`, user: u });
const userOf = (headers) => {
  const token = /^Bearer (.+)$/.exec(headers.authorization || '')?.[1];
  return [...users.values()].find((u) => jwtFor(u) === token) || null;
};
const personOf = (u) => { const s = staff.find((x) => x.email === u?.email); return s ? s.person ?? 'owner' : null; };
const isOffice = (u) => !!u && staff.some((s) => s.email === u.email) && OFFICE.has(staff.find((s) => s.email === u.email).person);

const client = (name, business, o = {}) => ({
  id: randomUUID(), name, business, address: 'הרצל 10, תל אביב', phone: '050-1234567', package_name: 'סושיאל', shoot_type: 'dms', characterizer: 'ofir', has_logo: true,
  editor_name: null, editor: null, deal_at: iso(2026, 8, 1), char_at: iso(2026, 8, 10), shoot_at: null, contract_end: '2027-12-31', status: 'active', notes: null, quote_id: null,
  created_at: iso(2026, 8, 1), created_by_email: null, links: {}, deliverables: {}, rounds: [], verified_at: iso(2026, 8, 2), verified_by: 'irit@astrateg.test',
  closed_reason: null, archived_at: null, archived_by: null, protocol_version: 7, ...o,
});
// Ron's shoot day (with influencers: Eli films it) is set on 12.11; Dana's is not set yet.
const ron = client('רון כהן', 'פיצה רון', { shoot_at: iso(2026, 11, 12) });
const dana = client('דנה לוי', 'קפה דנה');
const tables = {
  clients: [ron, dana],
  // Process 11 was started for both, so they are on Irit's "before the shoot day" page.
  protocol_checks: [ron, dana].map((c) => ({ client_id: c.id, item_key: 'p11.influencers', state: 'done', note: null, by_email: 'irit@astrateg.test', at: iso(2026, 10, 1) })),
  client_tasks: [], office_reviews: [], client_status_notes: [], protocol_log: [],
};
// What the database holds from before 16.11.2026: Eli's November and an unexpected change of
// his (shown nowhere now), and Eliel's November marked by Lior.
const months = [
  { person: 'eli', month: '2026-11-01', days: ['2026-11-03', '2026-11-20'], none: false, submitted_at: iso(2026, 10, 2), updated_at: iso(2026, 10, 2), by_person: 'eli' },
  { person: 'eliel', month: '2026-11-01', days: ['2026-11-10', '2026-11-11'], none: false, submitted_at: iso(2026, 10, 3), updated_at: iso(2026, 10, 3), by_person: 'lior' },
];
const changes = [
  { id: randomUUID(), person: 'eli', reported_at: iso(2026, 10, 4), reported_month: '2026-10-01', days: ['2026-11-04', '2026-11-05'], shoot_days: [], note: 'חתונה במשפחה' },
];
const monthReads = []; // who read photographer_months
const dateNotes = [];
const calls = [];
const takenCalls = [];
const ELI = 'details.av-office[data-person="eli"]';
const ELIEL = 'details.av-office[data-person="eliel"]';
// public.photographer_people(): unchanged in the database (no migration on 16.11.2026).
const DB_PEOPLE = ['eli', 'eliel'];
let tableMissing = false;

const reads = (me, person) => { const p = personOf(me); return !!p && (A.READERS.includes(p) || (p === person && DB_PEOPLE.includes(p))); };
const takenNow = (person = 'eli') => A.takenFrom(tables.clients.filter((c) => ['active', 'ending'].includes(c.status) && !c.archived_at), person);
const refuse = (json, token, code = '22023') => json(400, { code, message: token });
function rpc(name, body, me, json) {
  if (name === 'is_staff') return json(200, !!me && staff.some((s) => s.email === me.email));
  if (name === 'is_office') return json(200, isOffice(me));
  if (name === 'date_change_note') { dateNotes.push({ ...body, by: me?.email }); return json(200, dateNotes.length); }
  if (name.startsWith('photographer_')) {
    if (tableMissing) return json(404, { code: 'PGRST202', message: `Could not find the function public.${name} in the schema cache` });
    const p = personOf(me);
    const now = clockNow;
    if (name === 'photographer_taken' || name === 'photographer_taken_by') {
      if (!reads(me, p)) return json(403, { code: '42501', message: 'not allowed' });
      // Each photographer's days (20261107100000_shoot_crew.sql): a day Eliel films is his, not Eli's.
      if (name === 'photographer_taken_by' && !DB_PEOPLE.includes(body.p_person)) return json(400, { code: '22023', message: 'unknown photographer' });
      takenCalls.push(name === 'photographer_taken_by' ? body.p_person : 'eli');
      return json(200, Object.entries(takenNow(body.p_person || 'eli')).filter(([d]) => d >= body.p_from && d <= body.p_to).sort().map(([day, n]) => ({ day, n })));
    }
    calls.push({ [name]: body, by: me?.email });
    if (name === 'photographer_submit') {
      const who = body.p_person ?? p;
      if (!p || !DB_PEOPLE.includes(who) || (who !== p && !A.ON_BEHALF.includes(p))) return json(403, { code: '42501', message: 'not allowed' });
      const month = body.p_month.slice(0, 7);
      const days = [...new Set(body.p_days || [])].sort();
      const row = A.monthRow(months, who, month);
      const problem = A.submitProblem({ month, days, none: !!body.p_none, row, taken: takenNow(), now, onBehalf: who !== p });
      if (problem) return refuse(json, { empty: 'availability_empty', month: 'availability_month', taken: 'availability_taken', locked: 'availability_locked' }[problem.code]);
      const stamp = { days, none: !!body.p_none, updated_at: now.toISOString(), by_person: p, by_email: me.email };
      if (row) Object.assign(row, stamp); else months.push({ person: who, month: `${month}-01`, submitted_at: now.toISOString(), ...stamp });
      return json(200, A.monthRow(months, who, month));
    }
    if (name === 'photographer_change') {
      if (!DB_PEOPLE.includes(p)) return json(403, { code: '42501', message: 'not allowed' });
      const days = [...new Set(body.p_days || [])].sort();
      const problem = A.changeProblem({ days, person: p, months, changes, taken: takenNow(), now });
      if (problem) return refuse(json, { used: 'availability_change_used', pick: 'availability_change_span', span: 'availability_change_span', past: 'availability_change_past', notFree: 'availability_change_not_free' }[problem.code]);
      const taken = takenNow();
      const row = { id: randomUUID(), person: p, reported_at: now.toISOString(), reported_month: `${A.monthKeyOf(now)}-01`, days, shoot_days: days.filter((d) => taken[d]), note: body.p_note || null, by_email: me.email };
      changes.push(row);
      for (const m of months) if (m.person === p) m.days = m.days.filter((d) => !days.includes(d));
      return json(200, row);
    }
  }
  return json(200, []);
}

const filtersOf = (url) => [...url.searchParams.entries()].filter(([k]) => !['select', 'order', 'limit', 'offset'].includes(k));
const matcher = (filters) => (row) => filters.every(([k, v]) => {
  if (v.startsWith('eq.')) return String(row[k]) === v.slice(3);
  if (v.startsWith('neq.')) return String(row[k]) !== v.slice(4);
  if (v.startsWith('gte.')) return String(row[k]) >= v.slice(4);
  if (v.startsWith('lte.')) return String(row[k]) <= v.slice(4);
  if (v.startsWith('in.')) return v.slice(4, -1).split(',').map((x) => x.replace(/^"|"$/g, '')).includes(String(row[k]));
  return true;
});
const answer = (req, json) => (rows) => ((req.headers().accept || '').includes('vnd.pgrst.object')
  ? (rows.length ? json(200, rows[0]) : json(406, { code: 'PGRST116', message: 'no rows' })) : json(200, rows));

async function fakeSupabase(route) {
  const req = route.request();
  const url = new URL(req.url());
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  const json = (status, data) => route.fulfill({
    status, contentType: 'application/json', body: JSON.stringify(data),
    headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' },
  });
  if (req.method() === 'OPTIONS') return json(200, {});
  const p = url.pathname;
  const me = userOf(req.headers());
  if (p === '/auth/v1/token') {
    const u = users.get(String(body.email || '').toLowerCase());
    if (!u || body.password !== 'correct-horse') return json(400, { error: 'invalid_grant', msg: 'Invalid login credentials' });
    return json(200, sessionFor(u));
  }
  if (p === '/auth/v1/user') return me ? json(200, me) : json(401, { msg: 'invalid JWT' });
  if (p === '/auth/v1/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  if (p.startsWith('/rest/v1/rpc/')) return rpc(p.slice('/rest/v1/rpc/'.length), body || {}, me, json);
  if (!me) return json(401, { message: 'permission denied' });
  const m = /^\/rest\/v1\/(\w+)$/.exec(p);
  if (!m) return json(404, { message: 'not found' });
  if (m[1] === 'photographer_months' || m[1] === 'photographer_changes') {
    if (tableMissing) return json(404, { code: 'PGRST205', message: `Could not find the table 'public.${m[1]}' in the schema cache` });
    // No direct writes: only the two functions.
    if (req.method() !== 'GET') { calls.push({ directWrite: req.method(), by: me.email }); return json(403, { code: '42501', message: `permission denied for table ${m[1]}` }); }
    if (m[1] === 'photographer_months') monthReads.push(me.email);
    const rows = (m[1] === 'photographer_months' ? months : changes).filter((r) => reads(me, r.person)).filter(matcher(filtersOf(url)));
    return answer(req, json)(rows);
  }
  if (m[1] === 'staff') {
    const eq = url.searchParams.get('email');
    return answer(req, json)(eq?.startsWith('eq.') ? staff.filter((s) => s.email === eq.slice(3)) : staff);
  }
  if (m[1] === 'clients') {
    // Row level security: the office reads every client; Eli's are the shoots of the next 30 days (none here).
    const rows = isOffice(me) ? tables.clients.filter(matcher(filtersOf(url))) : [];
    if (req.method() === 'PATCH') {
      if (!isOffice(me)) return json(403, { code: '42501', message: 'new row violates row-level security policy' });
      calls.push({ clientPatch: body, by: me.email });
      for (const r of rows) Object.assign(r, body);
    }
    return answer(req, json)(rows);
  }
  if (m[1] === 'protocol_checks' && req.method() !== 'GET') calls.push({ check: body, by: me.email });
  if (m[1] === 'reminder_log' || m[1] === 'deal_requests' || m[1] === 'quotes') return json(200, []);
  if (req.method() !== 'GET') return json(200, Array.isArray(body) ? body : body ? [body] : []);
  const rows = (tables[m[1]] || []).filter(matcher(filtersOf(url).filter(([k]) => k === 'id' || k === 'client_id')));
  return answer(req, json)(rows);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
let safari = null;
const errors = [];
const dialogs = [];
// `browserType: webkit` with a `device` (iPhone): Safari's engine, as on the phone.
async function newPage(viewport = { width: 1366, height: 900 }, now = NOW, { browserType = null, device = null } = {}) {
  clockNow = now;
  if (browserType === webkit && !safari) safari = await webkit.launch();
  const b = browserType === webkit ? safari : browser;
  const ctx = await b.newContext({ ...(device || {}), locale: 'he-IL', timezoneId: 'Asia/Jerusalem', ...(viewport ? { viewport } : {}) });
  await ctx.clock.install({ time: now });
  await ctx.route('https://czncjzziqrqtezpwxxpz.supabase.co/**', withClientColumns(fakeSupabase, { clients: () => tables.clients, staff: () => staff }));
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', (e) => errors.push(String(e)));
  watchCsp(page); // a load the Content-Security-Policy refused fails the suite (tests/csp-watch.mjs)
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
  // A browser confirm() is the old question (a date against the usual order): none is expected here.
  page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  return page;
}
async function signIn(page, path, who) {
  await page.goto(`${BASE}${path}`);
  await page.fill('#lg-email', `${who}@astrateg.test`);
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.locator('#app:not([hidden])').waitFor();
}
const CARD = '#availability';
const shot = async (page, name, fullPage = false) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage }); };
const text = (page, sel) => page.locator(sel).first().innerText();
const texts = (page, sel) => page.locator(sel).allInnerTexts();
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const N = (d) => `2026-11-${String(d).padStart(2, '0')}`;
let passed = 0;
async function step(name, fn) {
  try { await fn(); } catch (err) {
    console.error(`not ok - ${name}\n  page errors: ${JSON.stringify(errors)}\n  last calls: ${JSON.stringify(calls.slice(-3)).slice(0, 900)}`);
    throw err;
  }
  passed += 1;
  console.log(`ok - ${name}`);
}

let exitCode = 0;
const IPHONE = { browserType: webkit, device: devices['iPhone 13'] };
const waitShootList = (page) => page.waitForFunction(() => (document.getElementById('sh-list')?.textContent || '').trim().length > 0);
try {
  await step('Eli (iPhone WebKit, Chrome 390 and 1366) on 12.10 and 20.10: no availability card on his shoot days page, and nothing is read for it', async () => {
    for (const [name, vp, opts, now] of [
      ['iphone-eli-shoot', null, IPHONE, dateIL(2026, 10, 12, 9)],
      ['390-eli-shoot', { width: 390, height: 844 }, {}, dateIL(2026, 10, 20, 9)],
      ['1366-eli-shoot', { width: 1366, height: 900 }, {}, dateIL(2026, 10, 20, 9)],
    ]) {
      const before = monthReads.length;
      const page = await newPage(vp, now, opts);
      await signIn(page, 'shoot.html#availability', 'eli');
      await waitShootList(page);
      await page.waitForTimeout(400); // the card used to come after the list
      assert.equal(await page.locator(`${CARD}:not([hidden])`).count(), 0, name);
      assert.equal(await page.locator(`${CARD} *`).count(), 0, name);
      assert.doesNotMatch(await page.locator('#app').innerText(), /זמינות/, name);
      assert.equal(monthReads.slice(before).filter((e) => e === 'eli@astrateg.test').length, 0, name);
      assert.ok(await noSideScroll(page), name);
      await shot(page, name, true);
      await page.context().close();
    }
  });

  await step('Lior on shoot.html (1366 and iPhone): only Eliel\'s folded line; Eli\'s old rows are not shown', async () => {
    for (const [name, vp, opts] of [['1366-lior-shoot', { width: 1366, height: 900 }, {}], ['iphone-lior-shoot', null, IPHONE]]) {
      const page = await newPage(vp, NOW, opts);
      await signIn(page, 'shoot.html', 'lior');
      await page.locator(`${CARD}:not([hidden]) ${ELIEL}`).waitFor();
      assert.equal(await page.locator(`${CARD} ${ELI}`).count(), 0, name);
      assert.deepEqual(await texts(page, `${CARD} ${ELIEL} summary > *`), ['הזמינות של אליאל', 'נובמבר: 2 ימים פנויים'], name);
      assert.doesNotMatch(await page.locator(CARD).innerText(), /אלי[^א]|בלת״ם/, name);
      assert.ok(await noSideScroll(page), name);
      await shot(page, name, true);
      await page.context().close();
    }
  });

  await step('Irit on prep.html#availability (1366 and iPhone): Eliel\'s card open, nothing of Eli\'s, and no words under "אלי הצלם"', async () => {
    for (const [name, vp, opts] of [['1366-irit-prep', { width: 1366, height: 900 }, {}], ['iphone-irit-prep', null, IPHONE]]) {
      const page = await newPage(vp, NOW, opts);
      await signIn(page, 'prep.html#availability', 'irit');
      await page.locator('#pp-shoots .pp-card').first().waitFor();
      await page.locator(`${CARD}:not([hidden]) ${ELIEL}[open]`).waitFor();
      assert.equal(await page.locator(`${CARD} ${ELI}`).count(), 0, name);
      assert.equal(await page.locator(`${CARD} details`).count(), 1, name);
      assert.deepEqual(await texts(page, `${CARD} ${ELIEL} summary > *`), ['הזמינות של אליאל', 'אוקטובר: עוד לא נמסרה', 'נובמבר: 2 ימים פנויים'], name);
      assert.equal(await page.locator(`${CARD} .av-changes`).count(), 0, name); // Eli's old unexpected change
      assert.deepEqual(await page.locator(`${CARD} #av-grid-eliel-2026-11 .is-free`).evaluateAll((els) => els.map((e) => +e.dataset.day.slice(8))), [10, 11], name);
      await page.waitForTimeout(400);
      assert.equal(await page.locator('[id$="p11-ok-photographer"] small').count(), 0, name);
      assert.ok(await noSideScroll(page), name);
      await shot(page, name, true);
      await page.context().close();
    }
  });

  const irit = await newPage({ width: 1366, height: 900 });
  await signIn(irit, `client.html?id=${dana.id}`, 'irit');
  const hint = '#ed-shoot-at + .av-hint';
  const fillDate = (value) => irit.fill('#ed-shoot-at', value);
  const hintIs = (want) => irit.waitForFunction(([s, w]) => document.querySelector(s)?.textContent === w, [hint, want]);
  const hintGone = () => irit.waitForFunction((s) => { const el = document.querySelector(s); return !el || el.hidden; }, hint);

  await step('Irit sets Eli\'s shoot day in the client card: no availability line and nothing asked; a day already taken is still said', async () => {
    await irit.click('#btn-edit');
    await fillDate('2026-11-12T10:00');
    await hintIs('ביום הזה כבר קבוע יום צילום אחר.'); // Ron's shoot day: a clash, not an availability
    assert.match(await irit.locator(hint).getAttribute('class'), /is-taken/);
    await fillDate('2026-11-10T10:00'); // not in Eli's old November row
    await hintGone();
    await fillDate('2026-12-08T10:00'); // a month he never handed over
    await hintGone();
    assert.equal(await irit.locator('.av-mark').count(), 0);
    await shot(irit, '1366-irit-eli-day');
    await fillDate('2026-11-10T10:00');
    await irit.click('#ed-submit');
    await irit.waitForFunction(() => !document.querySelector('#dlg-edit[open]'));
    assert.equal(dayKeyIL(new Date(dana.shoot_at)), N(10));
    assert.equal(await irit.locator('#dlg-shoot-day').count(), 0);
    assert.equal(dateNotes.length, 0);
    // A day another shoot of Eli's sits on is still asked about, and only that is said.
    await irit.click('#btn-edit');
    await hintGone(); // its own saved day is not "another shoot day"
    await fillDate('2026-11-12T10:00');
    await irit.click('#ed-submit');
    await irit.locator('#dlg-shoot-day[open]').waitFor();
    assert.deepEqual(await texts(irit, '#dlg-shoot-day .av-warn li'), ['ביום הזה כבר קבוע יום צילום אחר.']);
    await irit.click('#av-reason-cancel');
    await irit.waitForFunction(() => !document.querySelector('#dlg-shoot-day'));
  });

  await step('Irit, a day Eliel films: his hint and "סימון זמינות במקומו" as before', async () => {
    await irit.check('#ed-crew-solo');
    await irit.check('#ed-photographer-eliel');
    await fillDate('2026-11-11T10:00');
    await hintIs('אליאל סימן את היום הזה כפנוי.');
    await fillDate('2026-11-09T10:00');
    await hintIs('אליאל לא סימן את היום הזה כפנוי.');
    await fillDate('2026-12-08T10:00');
    await irit.waitForFunction((s) => document.querySelector(s)?.textContent.startsWith('אליאל עוד לא מסר זמינות לדצמבר.'), hint);
    assert.equal(await text(irit, `${hint} .av-mark`), 'סימון זמינות במקומו');
    await shot(irit, '1366-irit-eliel-day');
    await irit.keyboard.press('Escape');
    await irit.context().close();
    assert.equal(dayKeyIL(new Date(dana.shoot_at)), N(10));
  });

  assert.deepEqual(calls.filter((c) => c.photographer_submit || c.photographer_change), []);
  assert.deepEqual(dialogs, []);
  assert.deepEqual(errors, []);
  noCspViolations();
  console.log(`\n${passed} steps passed.`);
} catch (err) {
  exitCode = 1;
  console.error(err);
} finally {
  await browser.close();
  await safari?.close();
}
process.exit(exitCode);
