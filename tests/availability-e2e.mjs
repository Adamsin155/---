// End-to-end check of the photographer's monthly availability in the browser (his
// protocol, step 1; docs/ops.md, section 39), against an in-memory fake of Supabase
// that answers as the database does (tests/sql/availability.test.mjs holds the real
// rules; the fake applies the same ones through app/availability-logic.js):
//   - Eli, on a phone: the card above his shoot days, the month as big days (44px, no
//     sideways scroll at 360px), a taken day, "אין לי ימים פנויים", the draft kept, the
//     submit, then one line with "עדכון" and "בלת״ם"; highlighted from the 10th, late
//     after the 15th;
//   - he updates (a day comes off before the 15th, not after it), reports an unexpected
//     change (two consecutive days at most, a shoot day said), and hits the limit: told
//     to call Lior;
//   - Irit, setting a shoot date in the client card: the line next to the date (free,
//     taken, not free, an unexpected change, not handed over), a day he did not mark
//     free asks for a reason that is kept with the date change, a free day asks
//     nothing, and his approval is never ticked for her;
//   - prep.html: the folded line, what he handed over, an entry in his name, and the
//     words under "אלי הצלם";
//   - who sees it: Lior and the owner (and enter it in his name), Ofir (reads); Ilai
//     and an editor see nothing; before the migration nothing is shown or asked.
// Run: npx http-server -p 8461 -s -c-1 . &  then
//      BASE_URL=http://localhost:8461/ node tests/availability-e2e.mjs [outDir]
import { chromium } from 'playwright';
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
// Ron's shoot day is set on 12.11 (beyond the 30 days Eli sees clients for); Dana's is not set yet.
const ron = client('רון כהן', 'פיצה רון', { shoot_at: iso(2026, 11, 12) });
const dana = client('דנה לוי', 'קפה דנה');
const tables = {
  clients: [ron, dana],
  // Process 11 was started for both, so they are on Irit's "before the shoot day" page.
  protocol_checks: [ron, dana].map((c) => ({ client_id: c.id, item_key: 'p11.influencers', state: 'done', note: null, by_email: 'irit@astrateg.test', at: iso(2026, 10, 1) })),
  client_tasks: [], office_reviews: [], client_status_notes: [], protocol_log: [],
};
const months = [];
const changes = [];
const dateNotes = [];
const calls = [];
let tableMissing = false;

const reads = (me, person) => { const p = personOf(me); return !!p && (A.READERS.includes(p) || (p === person && A.PHOTOGRAPHERS.includes(p))); };
const takenNow = () => A.takenFrom(tables.clients.filter((c) => ['active', 'ending'].includes(c.status) && !c.archived_at));
const refuse = (json, token, code = '22023') => json(400, { code, message: token });
function rpc(name, body, me, json) {
  if (name === 'is_staff') return json(200, !!me && staff.some((s) => s.email === me.email));
  if (name === 'is_office') return json(200, isOffice(me));
  if (name === 'date_change_note') { dateNotes.push({ ...body, by: me?.email }); return json(200, dateNotes.length); }
  if (name.startsWith('photographer_')) {
    if (tableMissing) return json(404, { code: 'PGRST202', message: `Could not find the function public.${name} in the schema cache` });
    const p = personOf(me);
    const now = clockNow;
    if (name === 'photographer_taken') {
      if (!reads(me, p)) return json(403, { code: '42501', message: 'not allowed' });
      return json(200, Object.entries(takenNow()).filter(([d]) => d >= body.p_from && d <= body.p_to).sort().map(([day, n]) => ({ day, n })));
    }
    calls.push({ [name]: body, by: me?.email });
    if (name === 'photographer_submit') {
      const who = body.p_person ?? p;
      if (!p || !A.PHOTOGRAPHERS.includes(who) || (who !== p && !A.ON_BEHALF.includes(p))) return json(403, { code: '42501', message: 'not allowed' });
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
      if (!A.PHOTOGRAPHERS.includes(p)) return json(403, { code: '42501', message: 'not allowed' });
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
const errors = [];
const dialogs = [];
async function newPage(viewport = { width: 1366, height: 900 }, now = NOW) {
  clockNow = now;
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport });
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
const toastOf = (page) => page.locator('#toast.on').innerText();
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const smallTargets = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((el) => el.offsetParent && (el.getBoundingClientRect().height < 43.5 || el.getBoundingClientRect().width < 43.5))
  .map((el) => `${el.textContent.trim().slice(0, 20)}:${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`), sel);
const day = (page, d) => page.locator(`${CARD} [data-day="2026-11-${String(d).padStart(2, '0')}"]`);
const pick = (page, d) => page.locator(`${CARD} [data-pick="2026-11-${String(d).padStart(2, '0')}"]`);
const pressed = (page) => page.locator(`${CARD} .av-grid [aria-pressed="true"]`).evaluateAll((els) => els.map((e) => +e.dataset.day.slice(8)));
const lastCall = (name) => calls.filter((c) => c[name]).at(-1);
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
try {
  await step('Eli on the 12th and on the 16th: the card is highlighted with the days left, then late', async () => {
    const soon = await newPage({ width: 390, height: 844 }, dateIL(2026, 10, 12, 9));
    await signIn(soon, 'shoot.html', 'eli');
    await soon.locator(`${CARD} .av-card.is-soon`).waitFor();
    assert.equal(await text(soon, `${CARD} .av-pill`), 'נשארו 3 ימים');
    await soon.context().close();
    const last = await newPage({ width: 390, height: 844 }, dateIL(2026, 10, 15, 9));
    await signIn(last, 'shoot.html', 'eli');
    assert.equal(await text(last, `${CARD} .av-pill`), 'היום המועד האחרון');
    await last.context().close();
    const late = await newPage({ width: 390, height: 844 }, dateIL(2026, 10, 16, 9));
    await signIn(late, 'shoot.html', 'eli');
    await late.locator(`${CARD} .av-card.is-late`).waitFor();
    assert.equal(await text(late, `${CARD} .av-pill`), 'באיחור: המועד היה 15.10');
    await shot(late, '390-eli-late');
    await late.context().close();
  });

  const eli = await newPage({ width: 390, height: 844 });
  await signIn(eli, 'shoot.html', 'eli');

  await step('Eli: one card above his shoot days, asking for November until 15.10, with the month as big days and no pink button', async () => {
    await eli.locator(`${CARD}:not([hidden]) .av-card`).waitFor();
    assert.equal(await text(eli, `${CARD} h2`), 'הזמינות שלך לנובמבר');
    assert.equal(await text(eli, `${CARD} .av-pill`), 'למסור עד 15.10');
    assert.equal(await eli.locator(`${CARD} .av-card.is-open`).count(), 1);
    // Above the shoot days, under the page's head.
    assert.ok(await eli.evaluate(() => !!(document.getElementById('availability').compareDocumentPosition(document.getElementById('sh-list')) & Node.DOCUMENT_POSITION_FOLLOWING)));
    assert.equal(await eli.locator(`${CARD} .av-grid [data-day]`).count(), 30);
    // November 2026 starts on a Sunday: no empty cell before the 1st.
    assert.equal(await eli.locator(`${CARD} .av-grid .is-blank`).count(), 0);
    assert.deepEqual(await texts(eli, `${CARD} .av-week span`), A.WEEKDAYS);
    // The 12th has a shoot day: shown as taken, not a button.
    assert.equal(await day(eli, 12).evaluate((e) => e.tagName), 'SPAN');
    assert.equal(await day(eli, 12).getAttribute('aria-label'), 'יום ה׳ 12.11: קבוע יום צילום');
    assert.match(await day(eli, 12).innerText(), /12\s*צילום/);
    assert.equal(await day(eli, 3).getAttribute('aria-label'), 'יום ג׳ 3.11: לא פנוי');
    assert.equal(await eli.locator(`${CARD} .btn-primary`).count(), 0);
    assert.equal(await text(eli, '#av-submit'), 'מסירת הזמינות');
    assert.equal(await eli.locator('#av-change').count(), 0); // nothing handed over yet to change
    await shot(eli, '390-eli-ask', true);
  });

  await step('Eli at 360px: no sideways scroll, every day and button at least 44px', async () => {
    await eli.setViewportSize({ width: 360, height: 740 });
    assert.equal(await noSideScroll(eli), true);
    assert.deepEqual(await smallTargets(eli, `${CARD} button, ${CARD} .av-grid [data-day], ${CARD} label.av-none`), []);
    await eli.setViewportSize({ width: 390, height: 844 });
  });

  await step('Eli: nothing marked is not a hand-over; "אין לי ימים פנויים בחודש הזה" is said, not left empty', async () => {
    await eli.click('#av-submit');
    assert.equal(await text(eli, '#av-msg'), A.TEXT.empty);
    assert.equal(await eli.evaluate(() => document.activeElement?.id), 'av-msg');
    assert.equal(calls.length, 0);
    await eli.check('#av-none');
    assert.equal(await text(eli, '#av-submit'), 'מסירה: אין ימים פנויים');
    await eli.uncheck('#av-none');
    assert.equal(await text(eli, '#av-submit'), 'מסירת הזמינות');
  });

  await step('Eli marks days; the marks survive a reload; he submits, and the card folds to one line', async () => {
    for (const d of [3, 4, 5, 10]) await day(eli, d).click();
    assert.deepEqual(await pressed(eli), [3, 4, 5, 10]);
    assert.equal(await day(eli, 4).getAttribute('aria-label'), 'יום ד׳ 4.11: פנוי');
    assert.equal(await text(eli, '#av-submit'), 'מסירת הזמינות · 4 ימים');
    assert.equal(await eli.locator('#av-none').isDisabled(), true);
    await eli.reload();
    await eli.locator(`${CARD} .av-grid`).waitFor();
    assert.deepEqual(await pressed(eli), [3, 4, 5, 10]);
    assert.equal(calls.length, 0); // nothing is handed over before the submit
    await shot(eli, '390-eli-marked', true);
    await eli.click('#av-submit');
    await eli.locator(`${CARD} .av-card.is-done`).waitFor();
    assert.deepEqual(lastCall('photographer_submit').photographer_submit, { p_month: '2026-11-01', p_days: [N(3), N(4), N(5), N(10)], p_none: false });
    assert.equal(await toastOf(eli), 'הזמינות לנובמבר נמסרה. עירית וליאור רואים אותה.');
    assert.equal(await text(eli, `${CARD} h2`), 'הזמינות לנובמבר נמסרה');
    assert.equal(await text(eli, `${CARD} .av-sum`), '4 ימים פנויים');
    assert.deepEqual(await texts(eli, `${CARD} button`), ['עדכון', 'בלת״ם']);
    assert.equal(await eli.locator(`${CARD} .av-grid`).count(), 0);
    assert.deepEqual([months[0].person, months[0].by_person, months[0].by_email], ['eli', 'eli', 'eli@astrateg.test']);
    assert.deepEqual(await smallTargets(eli, `${CARD} button`), []);
    await shot(eli, '390-eli-done');
  });

  await step('Eli updates before the 15th: a day comes off, another is added', async () => {
    await eli.click('#av-edit');
    assert.equal(await text(eli, `${CARD} h2`), 'עדכון הזמינות לנובמבר');
    assert.deepEqual(await pressed(eli), [3, 4, 5, 10]);
    await day(eli, 10).click();
    await day(eli, 20).click();
    await eli.click('#av-submit');
    await eli.locator(`${CARD} .av-card.is-done`).waitFor();
    assert.deepEqual(lastCall('photographer_submit').photographer_submit.p_days, [N(3), N(4), N(5), N(20)]);
    assert.equal(await toastOf(eli), 'הזמינות עודכנה.');
    assert.equal(await text(eli, `${CARD} .av-sum`), '4 ימים פנויים');
    // "ביטול" leaves it as it was.
    await eli.click('#av-edit');
    await day(eli, 25).click();
    await eli.click('#av-cancel');
    assert.deepEqual(months[0].days, [N(3), N(4), N(5), N(20)]);
  });

  await step('Eli reports an unexpected change: two consecutive days at most, a shoot day said, then it is off his free days and with the office', async () => {
    await eli.click('#av-change');
    assert.equal(await text(eli, `${CARD} h2`), 'בלת״ם: שינוי בזמינות');
    assert.match(await text(eli, `${CARD} .av-lead`), /פעם אחת בחודש, עד 48 שעות/);
    // His free days and the day a shoot day sits on.
    assert.deepEqual(await texts(eli, `${CARD} .av-pick .av-n`), ['ג׳ 3.11', 'ד׳ 4.11', 'ה׳ 5.11', 'ה׳ 12.11', 'ו׳ 20.11']);
    assert.equal(await eli.locator('#av-report').isDisabled(), true);
    await pick(eli, 3).click();
    // Not consecutive: refused in words, and not marked.
    await pick(eli, 5).click();
    assert.equal(await text(eli, '#av-msg'), A.TEXT.span);
    assert.equal(await pick(eli, 5).getAttribute('aria-pressed'), 'false');
    await pick(eli, 4).click();
    assert.equal(await text(eli, '#av-report'), 'דיווח בלת״ם · 3.11–4.11');
    // A third day: more than 48 hours.
    await pick(eli, 5).click();
    assert.equal(await text(eli, '#av-msg'), A.TEXT.span);
    assert.match(await text(eli, '#av-msg'), /להתקשר לליאור/);
    await pick(eli, 3).click();
    await pick(eli, 4).click();
    // The day with the shoot day: he is told what it means before it goes.
    await pick(eli, 12).click();
    assert.match(await text(eli, '#av-warn'), /ב־12\.11 קבוע יום צילום\. הדיווח מגיע מיד לעירית ולליאור; להתקשר לליאור גם עכשיו\./);
    await shot(eli, '390-eli-change', true);
    await pick(eli, 12).click();
    assert.equal(await eli.locator('#av-warn').count(), 0);
    await pick(eli, 4).click();
    await pick(eli, 5).click();
    assert.deepEqual(await smallTargets(eli, `${CARD} button`), []);
    await eli.fill('#av-note', 'חתונה במשפחה');
    await eli.click('#av-report');
    await eli.locator(`${CARD} .av-card.is-done`).waitFor();
    assert.deepEqual(lastCall('photographer_change').photographer_change, { p_days: [N(4), N(5)], p_note: 'חתונה במשפחה' });
    assert.equal(await toastOf(eli), 'הבלת״ם על 4.11–5.11 דווח. עירית וליאור קיבלו הודעה.');
    assert.equal(await text(eli, `${CARD} .av-sum`), '2 ימים פנויים');
    assert.deepEqual(months[0].days, [N(3), N(20)]);
    assert.deepEqual([changes[0].days, changes[0].shoot_days, changes[0].reported_month], [[N(4), N(5)], [], '2026-10-01']);
  });

  await step('Eli at the limit: a second change this month is not just refused, he is told to call Lior', async () => {
    await eli.click('#av-change');
    assert.equal(await text(eli, '#av-msg'), 'כבר דיווחת על בלת״ם החודש (4.11–5.11). בלת״ם אפשר פעם אחת בחודש. לשינוי נוסף: להתקשר לליאור.');
    assert.equal(await eli.locator(`${CARD} .av-pick`).count(), 0);
    assert.deepEqual(await texts(eli, `${CARD} button`), ['סגירה']);
    await shot(eli, '390-eli-limit');
    await eli.click('#av-cancel');
    assert.equal(await text(eli, `${CARD} h2`), 'הזמינות לנובמבר נמסרה');
    assert.equal(changes.length, 1);
    await eli.context().close();
  });

  await step('Eli after the 15th: a free day no longer comes off through an update (only as an unexpected change); adding is open', async () => {
    const late = await newPage({ width: 390, height: 844 }, dateIL(2026, 10, 20, 9));
    await signIn(late, 'shoot.html', 'eli');
    await late.locator(`${CARD} .av-card.is-done`).waitFor();
    await late.click('#av-edit');
    assert.match(await text(late, `${CARD} .hint`), /אחרי ה־15 בחודש יום פנוי יורד רק כבלת״ם/);
    const before = calls.length;
    // The day says it is held (aria-disabled), and a tap on it explains why.
    assert.equal(await day(late, 3).getAttribute('aria-disabled'), 'true');
    await day(late, 3).click({ force: true });
    assert.equal(await text(late, '#av-msg'), A.TEXT.locked);
    assert.deepEqual(await pressed(late), [3, 20]);
    await day(late, 25).click();
    await late.click('#av-submit');
    await late.locator(`${CARD} .av-card.is-done`).waitFor();
    assert.equal(calls.length, before + 1);
    assert.deepEqual(months[0].days, [N(3), N(20), N(25)]);
    // The database holds the same line when the screen is passed by.
    const refused = await late.evaluate(async () => {
      const { supabase } = await import('./app/supa.js');
      const a = await supabase.rpc('photographer_submit', { p_month: '2026-11-01', p_days: ['2026-11-03'], p_none: false });
      const b = await supabase.rpc('photographer_change', { p_days: ['2026-11-20'], p_note: null });
      const c = await supabase.from('photographer_months').update({ days: [] }).eq('person', 'eli').select();
      return [a.error?.message, b.error?.message, c.error?.code];
    });
    assert.deepEqual(refused, ['availability_locked', 'availability_change_used', '42501']);
    assert.deepEqual(months[0].days, [N(3), N(20), N(25)]);
    await late.context().close();
  });

  const irit = await newPage({ width: 1366, height: 900 });
  await signIn(irit, `client.html?id=${dana.id}`, 'irit');
  const hint = '#ed-shoot-at + .av-hint';
  const setDate = async (value) => { await irit.fill('#ed-shoot-at', value); await irit.locator(`${hint}:not([hidden])`).waitFor(); };

  await step('Irit sets a shoot date in the client card: next to the date, what Eli handed over for that day', async () => {
    await irit.click('#btn-edit');
    assert.equal(await irit.locator(`${hint}:not([hidden])`).count(), 0); // no date yet: nothing to say
    await setDate('2026-11-20T10:00');
    await irit.waitForFunction((s) => document.querySelector(s)?.textContent === 'אלי סימן את היום הזה כפנוי.', hint);
    assert.match(await irit.locator(hint).getAttribute('class'), /is-free/);
    await shot(irit, '1366-irit-hint-free');
    await setDate('2026-11-10T10:00');
    await irit.waitForFunction((s) => document.querySelector(s)?.textContent === 'אלי לא סימן את היום הזה כפנוי.', hint);
    assert.match(await irit.locator(hint).getAttribute('class'), /is-busy/);
    await setDate('2026-11-04T10:00');
    await irit.waitForFunction((s) => document.querySelector(s)?.textContent === 'אלי דיווח בלת״ם על היום הזה: הוא לא פנוי.', hint);
    await setDate('2026-11-12T10:00');
    await irit.waitForFunction((s) => document.querySelector(s)?.textContent === 'ביום הזה כבר קבוע יום צילום אחר.', hint);
    assert.match(await irit.locator(hint).getAttribute('class'), /is-taken/);
    await setDate('2026-12-08T10:00');
    await irit.waitForFunction((s) => document.querySelector(s)?.textContent === 'אלי עוד לא מסר זמינות לדצמבר. לוודא איתו לפני שסוגרים.', hint);
    assert.match(await irit.locator(hint).getAttribute('class'), /is-unknown/);
  });

  await step('Irit picks a day he did not mark free: asked to confirm with a short reason; "ביטול" saves nothing', async () => {
    await setDate('2026-11-10T10:00');
    await irit.click('#ed-submit');
    await irit.locator('#dlg-shoot-day[open]').waitFor();
    assert.equal(await text(irit, '#av-dlg-h'), 'לקבוע את יום הצילום בכל זאת?');
    assert.equal(await text(irit, '#dlg-shoot-day .av-dlg-when'), 'יום ג׳ 10.11 בשעה 10:00');
    assert.deepEqual(await texts(irit, '#dlg-shoot-day .av-warn li'), ['אלי לא סימן את היום הזה כפנוי.']);
    assert.equal(await irit.locator('#dlg-shoot-day .btn-primary').count(), 0);
    await shot(irit, '1366-irit-reason');
    // No reason: not accepted.
    await irit.click('#av-reason-ok');
    assert.equal(await irit.locator('#av-reason-err:not([hidden])').innerText(), 'לכתוב סיבה קצרה.');
    await irit.click('#av-reason-cancel');
    await irit.waitForFunction(() => !document.querySelector('#dlg-shoot-day') && document.activeElement?.id === 'ed-shoot-at');
    assert.equal(await irit.locator('#dlg-edit[open]').count(), 1);
    assert.equal(dana.shoot_at, null);
    assert.equal(dateNotes.length, 0);
  });

  await step('Irit confirms the exception: saved, the reason is kept with the date change, and his approval is not ticked for her', async () => {
    await irit.click('#ed-submit');
    await irit.locator('#dlg-shoot-day[open]').waitFor();
    await irit.fill('#av-reason', 'הלקוח יכול רק ביום הזה');
    await irit.click('#av-reason-ok');
    await irit.waitForFunction(() => !document.querySelector('#dlg-edit[open]'));
    assert.equal(new Date(dana.shoot_at).toISOString(), dateIL(2026, 11, 10, 10).toISOString());
    assert.deepEqual(dateNotes.map((n) => [n.p_client, n.p_field, n.p_round, n.p_note, n.by]), [
      [dana.id, 'shoot_at', null, 'אושר למרות: אלי לא סימן את היום הזה כפנוי. סיבה: הלקוח יכול רק ביום הזה', 'irit@astrateg.test'],
    ]);
    assert.equal(calls.some((c) => c.check), false);
    assert.equal(tables.protocol_checks.some((c) => c.item_key === 'p11.ok.photographer'), false);
  });

  await step('Irit moves it to a day he marked free: said in the hint, nothing asked, nothing more kept', async () => {
    await irit.click('#btn-edit');
    // The saved date of this very shoot is not "another shoot day".
    await irit.waitForFunction((s) => document.querySelector(s)?.textContent === 'אלי לא סימן את היום הזה כפנוי.', hint);
    await setDate('2026-11-20T10:00');
    await irit.waitForFunction((s) => document.querySelector(s)?.textContent === 'אלי סימן את היום הזה כפנוי.', hint);
    await irit.click('#ed-submit');
    await irit.waitForFunction(() => !document.querySelector('#dlg-edit[open]'));
    assert.equal(dayKeyIL(new Date(dana.shoot_at)), N(20));
    assert.equal(dateNotes.length, 1);
    assert.equal(await irit.locator('#dlg-shoot-day').count(), 0);
    assert.deepEqual(dialogs, []);
    assert.equal(tables.protocol_checks.some((c) => c.item_key === 'p11.ok.photographer'), false);
    // A day another shoot sits on is asked about too (Ron's 12.11).
    await irit.click('#btn-edit');
    await setDate('2026-11-12T10:00');
    await irit.click('#ed-submit');
    await irit.locator('#dlg-shoot-day[open]').waitFor();
    assert.deepEqual(await texts(irit, '#dlg-shoot-day .av-warn li'), ['ביום הזה כבר קבוע יום צילום אחר.', 'אלי לא סימן את היום הזה כפנוי.']);
    await irit.click('#av-reason-cancel');
    await irit.keyboard.press('Escape');
    assert.equal(dayKeyIL(new Date(dana.shoot_at)), N(20));
  });

  await step('Irit on "before the shoot day": the folded line, what he handed over, and the words under "אלי הצלם"', async () => {
    await irit.goto(`${BASE}prep.html`);
    await irit.locator(`${CARD}:not([hidden]) details.av-office`).waitFor();
    assert.equal(await irit.locator(`${CARD} details[open]`).count(), 0);
    assert.deepEqual(await texts(irit, `${CARD} summary > *`), ['הזמינות של אלי', 'אוקטובר: עוד לא נמסרה', 'נובמבר: 3 ימים פנויים']);
    assert.equal(await irit.locator(`${CARD} .btn-primary`).count(), 0);
    // Under his name in each coordinator: what he handed over for that shoot's own day, never the tick.
    await irit.waitForFunction(() => document.querySelectorAll('[id$="p11-ok-photographer"] small').length === 2);
    assert.deepEqual((await texts(irit, '[id$="p11-ok-photographer"] small')).sort(), ['לא סימן את היום כפנוי', 'סימן את היום כפנוי']);
    assert.deepEqual(await irit.locator('[id$="p11-ok-photographer"]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-pressed'))), ['false', 'false']);
    await irit.click(`${CARD} summary`);
    await irit.locator(`${CARD} #av-grid-2026-11`).waitFor();
    assert.deepEqual(await irit.locator(`${CARD} #av-grid-2026-11 .is-free`).evaluateAll((els) => els.map((e) => +e.dataset.day.slice(8))), [3, 20, 25]);
    assert.deepEqual(await irit.locator(`${CARD} #av-grid-2026-11 .is-taken`).evaluateAll((els) => els.map((e) => +e.dataset.day.slice(8))), [12, 20]);
    assert.deepEqual(await irit.locator(`${CARD} #av-grid-2026-11 .is-off`).evaluateAll((els) => els.map((e) => +e.dataset.day.slice(8))), [4, 5]);
    assert.equal(await irit.locator(`${CARD} #av-grid-2026-11 button`).count(), 0); // read only
    assert.match(await text(irit, `${CARD} .av-changes`), /בלת״ם: 4\.11–5\.11 · דווח .* · חתונה במשפחה/);
    await shot(irit, '1366-irit-prep', true);
  });

  await step('Irit enters it in his name after a call: not held by his limits, and stamped as hers', async () => {
    assert.equal(await text(irit, '#av-enter-2026-11'), 'עדכון בשם אלי');
    assert.equal(await text(irit, '#av-enter-2026-10'), 'הזנה בשם אלי');
    await irit.click('#av-enter-2026-11');
    assert.deepEqual(await pressed(irit), [3, 25]); // the 20th is free too, under the shoot day set on it
    await day(irit, 25).click();
    await day(irit, 26).click();
    assert.equal(await text(irit, '#av-submit'), 'שמירה בשם אלי');
    await irit.click('#av-submit');
    await irit.waitForFunction(() => /הזמינות של אלי לנובמבר נשמרה\./.test(document.querySelector('#toast.on')?.innerText || ''));
    assert.deepEqual(lastCall('photographer_submit').photographer_submit, { p_month: '2026-11-01', p_days: [N(3), N(20), N(26)], p_none: false, p_person: 'eli' });
    assert.deepEqual([months[0].days, months[0].by_person], [[N(3), N(20), N(26)], 'irit']);
    await irit.waitForFunction(() => /הוזן על ידי עירית/.test(document.querySelector('#availability')?.innerText || ''));
    await irit.context().close();
  });

  await step('who sees it: Lior and the owner (and enter it in his name), Ofir (reads); Ilai and an editor see nothing', async () => {
    for (const [who, enters] of [['lior', true], ['owner', true], ['ofir', false]]) {
      const page = await newPage();
      await signIn(page, 'shoot.html', who);
      await page.locator(`${CARD}:not([hidden]) details.av-office`).waitFor();
      assert.match(await text(page, `${CARD} summary`), /הזמינות של אלי[\s\S]*נובמבר: 3 ימים פנויים/, who);
      await page.click(`${CARD} summary`);
      await page.locator(`${CARD} #av-grid-2026-11`).waitFor();
      assert.equal(await page.locator('#av-enter-2026-11').count(), enters ? 1 : 0, who);
      if (who === 'lior') await shot(page, '1366-lior-shoot', true);
      await page.context().close();
    }
    for (const who of ['ilai', 'nadia']) {
      const page = await newPage();
      await signIn(page, 'shoot.html', who);
      await page.waitForFunction(() => document.getElementById('state').textContent === '' || !document.getElementById('no-access').hidden);
      assert.equal(await page.locator(`${CARD}:not([hidden])`).count(), 0, who);
      assert.equal(await page.locator(`${CARD} *`).count(), 0, who);
      const direct = await page.evaluate(async () => {
        const { supabase } = await import('./app/supa.js');
        const a = await supabase.from('photographer_months').select('person');
        const b = await supabase.rpc('photographer_taken', { p_from: '2026-11-01', p_to: '2026-11-30' });
        const c = await supabase.rpc('photographer_submit', { p_month: '2026-11-01', p_days: ['2026-11-07'], p_none: false, p_person: 'eli' });
        return [a.data?.length, b.error?.code, c.error?.code];
      });
      assert.deepEqual(direct, [0, '42501', '42501'], who);
      await page.context().close();
    }
    // Ilai's client card has no "עריכת פרטים" at all: he never reaches a shoot date to set.
    const ilai = await newPage();
    await signIn(ilai, `client.html?id=${dana.id}`, 'ilai');
    await ilai.locator('#app:not([hidden]) h1').first().waitFor();
    assert.equal(await ilai.locator('#btn-edit').count(), 0);
    await ilai.context().close();
    assert.deepEqual(months[0].days, [N(3), N(20), N(26)]);
  });

  await step('before the migration: no card, no line next to the date, and a date is saved as before', async () => {
    tableMissing = true;
    const e2 = await newPage({ width: 390, height: 844 });
    await signIn(e2, 'shoot.html', 'eli');
    await e2.waitForFunction(() => /אין ימי צילום בחודש הקרוב/.test(document.getElementById('sh-list').textContent));
    assert.equal(await e2.locator(`${CARD}:not([hidden])`).count(), 0);
    await e2.context().close();
    const i2 = await newPage();
    await signIn(i2, `client.html?id=${dana.id}`, 'irit');
    await i2.click('#btn-edit');
    await i2.fill('#ed-shoot-at', '2026-11-10T10:00');
    await i2.click('#ed-submit');
    await i2.waitForFunction(() => !document.querySelector('#dlg-edit[open]'));
    assert.equal(dayKeyIL(new Date(dana.shoot_at)), N(10));
    assert.equal(await i2.locator('#dlg-shoot-day').count(), 0);
    assert.equal(dateNotes.length, 1);
    await i2.goto(`${BASE}prep.html`);
    await i2.locator('#pp-shoots .pp-card').first().waitFor();
    assert.equal(await i2.locator(`${CARD}:not([hidden])`).count(), 0);
    await i2.context().close();
    tableMissing = false;
  });

  assert.deepEqual(calls.filter((c) => c.directWrite).map((c) => c.by), ['eli@astrateg.test']); // the one tried on purpose above
  assert.deepEqual(dialogs, []);
  assert.deepEqual(errors, []);
  noCspViolations();
  console.log(`\n${passed} steps passed.`);
} catch (err) {
  exitCode = 1;
  console.error(err);
} finally {
  await browser.close();
}
process.exit(exitCode);
