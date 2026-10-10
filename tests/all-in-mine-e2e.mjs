// "המשימות שלי" is the one place where a person sees everything that waits for them,
// whichever page it is done on (the owner's rule of 8.10.2026; docs/ops.md, section 46),
// in the browser, on a phone, against tests/flow-world.mjs (Tuesday 20.10.2026, 10:00 in
// Israel; invented names):
//  - per role, a queue of another page with N waiting is one counted line of "המשימות
//    שלי": the right number, in the group of its urgency, a 44px target, and a link that
//    opens the right page on the right section (never a page that refuses the reader);
//  - with nothing waiting there is no line at all;
//  - work on a client that is still in landing is said plainly ("בקליטה, בלי שעון") next
//    to the landing line, and is marked "בקליטה", with no clock and no late colour, on
//    qa.html (the assignment list too), decisions.html, prep.html, pass.html and in
//    Ilai's cards;
//  - Ofir's cards of the assignment (22א) and of the quality control (25) lead to his
//    queue; Irit's card of 22א does not;
//  - the lines are in the list when it is first shown: the page does not jump.
// Run: npx http-server -p 8080 -s -c-1 . &  then  node tests/all-in-mine-e2e.mjs
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { NOW, SUPA, emailOf, flowWorld, makeFlowFake, COUNTS, FOLLOWUP_CLIENTS, cid } from './flow-world.mjs';
import { watchCsp, noCspViolations } from './csp-watch.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const PHONE = { width: 390, height: 844 };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
const NO_CLOCK = 'בקליטה, בלי שעון';

const observe = () => {
  window.__cls = 0;
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch { /* not supported */ }
};
async function signedIn(role, { db = flowWorld(), latency = 0 } = {}) {
  const fake = makeFlowFake(db);
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: PHONE, isMobile: true, hasTouch: true });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, async (route) => { if (latency) await new Promise((done) => { setTimeout(done, latency); }); return fake.route(route); });
  await ctx.addInitScript(observe);
  const page = await ctx.newPage();
  watchCsp(page);
  page.on('pageerror', (e) => errors.push(`${role}: ${e}`));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(`${role}: ${msg.text()}`); });
  await page.goto(`${BASE}clients.html#mine`);
  await page.fill('#lg-email', emailOf(role));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForSelector('#view-mine:not([hidden])');
  await settle(page);
  return { page, ctx, db };
}
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(400); };
// The counted lines on the screen: { id: { text, cta, href, group, height } }. `group` is
// the list's group the line sits in ('landing': next to the landing line).
const lines = (page) => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('a[id^="flow-"]')].map((a) => {
  const group = a.closest('#land-line') ? 'landing' : [...(a.closest('.wgroup')?.classList || [])].find((c) => c.startsWith('g-'))?.slice(2) || null;
  return [a.id.slice(5), { text: a.querySelector('strong').textContent, cta: a.querySelector('span').textContent, href: a.getAttribute('href'), group, height: Math.round(a.getBoundingClientRect().height), shown: a.getClientRects().length > 0 }];
})));
const inView = (page, sel) => page.evaluate((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return !!r && r.height > 0 && r.top >= -4 && r.top < innerHeight - 40; }, sel);
const lateMarks = (loc) => loc.locator('.is-late, .late, .s-overdue, .sbadge.s-overdue').count();

let passed = 0;
async function step(name, fn) {
  try { await fn(); passed += 1; console.log(`ok - ${name}`); } catch (e) { console.log(`not ok - ${name}`); throw e; }
}

// What each role is expected to see: id → [text, group, href].
const EXPECTED = {
  ofir: {
    'landing-assign': [`${COUNTS.assign.landing} לקוחות מחכים לשיוך עורך · ${NO_CLOCK}`, 'landing', 'qa.html#assign-h'],
    'landing-qa': [`עבודה אחת מחכה לבקרת האיכות שלך · ${NO_CLOCK}`, 'landing', 'qa.html#qa-h'],
  },
  // (Protocol v9: the editor's assignment is Ofir's alone, so "מחכים לשיוך עורך" is no longer a line of Lior's.)
  lior: {
    'landing-shoot': [`לקוח אחד מצטלם ב־14 הימים הקרובים · ${NO_CLOCK}`, 'landing', 'shoot.html'],
    'urgent-back': ['משימה דחופה אחת לא התחילה תוך 30 דקות', 'urgent', 'decisions.html#ur-h'],
    'availability-missing': ['אלי עוד לא מסר זמינות לנובמבר', 'overdue', 'prep.html#availability'],
    paused: ['עריכה אחת עצורה מאתמול ומחכה להחלטה שלך', 'today', 'decisions.html#pz-h'],
    access: ['גישה שבורה אחת מחכה לתיקון', 'today', 'decisions.html#ac-h'],
    changes: ['בקשת שינוי אחת מחכה להחלטה שלך', 'today', 'decisions.html#cq-h'],
    campaigns: ['בדיקת הקמפיינים השבועית עוד לא סומנה', 'today', 'decisions.html#cp-h'],
  },
  irit: {
    'landing-shoot': [`לקוח אחד מצטלם ב־14 הימים הקרובים · ${NO_CLOCK}`, 'landing', 'prep.html'],
    'availability-missing': ['אלי עוד לא מסר זמינות לנובמבר', 'overdue', 'prep.html#availability'],
    messages: [`${COUNTS.messages.clock} לקוחות עוד לא קיבלו הודעה היום (ועוד ${COUNTS.messages.landing} בקליטה)`, 'today', 'messages.html'],
    // Protocol v8: the daily follow-up before the shoot day (14) is one counted line, hers alone.
    followup: [`מעקב לפני צילום: ${COUNTS.followup} לקוחות`, 'today', 'prep.html#followup'],
  },
  anna: { fixes: ['לקוח אחד חזר מאופיר עם תיקונים', 'today', `editor.html#c-${cid(16)}`] },
  yariv: { 'landing-editing': [`לקוח אחד בעריכה אצלך · ${NO_CLOCK}`, 'landing', 'editor.html'] },
  eli: { availability: ['עוד לא מסרת את הזמינות שלך לנובמבר (עד ה־15 בחודש)', 'overdue', 'shoot.html#availability'] },
  ilai: {}, nadia: {}, nirel: {}, owner: {},
};
// The page each line leads to, and what proves it opened on the right place.
const REFUSED = '#no-access:not([hidden]), .ow-noaccess:not([hidden]), .prod-noaccess:not([hidden]), .msg-noaccess:not([hidden])';

try {
  await step('per role, each queue with N waiting is one counted line of "המשימות שלי": the number, the group, the link, a 44px target', async () => {
    for (const [role, want] of Object.entries(EXPECTED)) {
      const { page, ctx } = await signedIn(role);
      const got = await lines(page);
      assert.deepEqual(Object.keys(got).sort(), Object.keys(want).sort(), `${role}: the lines are ${JSON.stringify(got)}`);
      for (const [id, [text, group, href]] of Object.entries(want)) {
        assert.deepEqual([got[id].text, got[id].group, got[id].href], [text, group, href], `${role}: ${id}`);
        assert.ok(got[id].cta.length > 2, `${role}: ${id} has no name for its link`);
        // A group of "this week" or "later" is folded on a short list; everything else is on the screen.
        if (got[id].shown) assert.ok(got[id].height >= 44, `${role}: ${id} is ${got[id].height}px high`);
        else assert.ok(['week', 'later'].includes(group), `${role}: ${id} is not shown`);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${role}: the page scrolls sideways`);
      await ctx.close();
    }
  });

  await step('every line opens a page that lets its reader in, on the section of the queue', async () => {
    for (const [role, want] of Object.entries(EXPECTED)) {
      for (const [id, [, , href]] of Object.entries(want)) {
        const { page, ctx } = await signedIn(role);
        await page.locator(`#flow-${id}`).scrollIntoViewIfNeeded();
        await page.click(`#flow-${id}`);
        await page.waitForURL((u) => u.pathname.endsWith(href.split('#')[0]));
        await page.waitForSelector('#app-side', { state: 'attached' });
        await settle(page);
        assert.equal(await page.locator(REFUSED).count(), 0, `${role}: ${id} leads to a page that refuses`);
        const hash = href.split('#')[1];
        if (/-h$/.test(hash || '')) {
          assert.equal(await inView(page, `#${hash}`), true, `${role}: ${href} did not open on its section`);
          assert.equal(await page.evaluate(() => document.activeElement?.id), hash, `${role}: ${href} did not move the focus`);
        }
        if (hash === 'availability') assert.equal(await page.locator('#availability:not([hidden])').count(), 1, `${role}: ${href}`);
        if (hash === 'followup') assert.equal(await page.locator('#followup:not([hidden]) .pp-follow-row').count(), COUNTS.followup, `${role}: ${href}`);
        if (hash?.startsWith('c-')) assert.equal(await page.locator(`[id="${hash}"]`).count(), 1, `${role}: ${href}`);
        await ctx.close();
      }
    }
  });

  await step('with nothing waiting there is no line, for anyone', async () => {
    for (const role of Object.keys(EXPECTED)) {
      const db = flowWorld({ landing: false, queues: false });
      db.client_messages = db.clients.map((c) => ({ id: `m-${c.id}`, client_id: c.id, kind: 'daily', sent_at: '2026-10-20T09:00:00+03:00', by_email: emailOf('irit') }));
      db.office_reviews = [{ day: '2026-10-20', kind: 'campaigns', note: null, by_email: emailOf('lior'), at: '2026-10-20T09:00:00+03:00' }];
      db.photographer_months = [{ person: 'eli', month: '2026-11-01', days: ['2026-11-03'], none: false, submitted_at: '2026-10-12T09:00:00+03:00', updated_at: '2026-10-12T09:00:00+03:00', by_person: 'eli' }];
      // Today's follow-up before the shoot day was answered for every client it is asked of.
      for (const n of FOLLOWUP_CLIENTS) db.protocol_checks.push({ client_id: cid(n), item_key: 'p14.day', state: 'done', note: JSON.stringify({ ok: true }), by_email: emailOf('irit'), at: '2026-10-20T09:00:00+03:00' });
      const { page, ctx } = await signedIn(role, { db });
      assert.deepEqual(await lines(page), {}, role);
      assert.equal(await page.locator('#land-line:not([hidden])').count(), 0, `${role}: a landing line with no client in landing`);
      await ctx.close();
    }
  });

  await step('a line follows its queue: it counts down when the work is done, and goes at zero', async () => {
    const { page, ctx, db } = await signedIn('ofir');
    assert.equal((await lines(page))['landing-assign'].text, `3 לקוחות מחכים לשיוך עורך · ${NO_CLOCK}`);
    // Two of the three are assigned on Ofir's page.
    for (const n of [31, 32]) {
      db.clients.find((c) => c.id === cid(n)).editor = 'nadia';
      db.protocol_checks.push({ client_id: cid(n), item_key: 'p22a.assigned', state: 'done', note: null, by_email: emailOf('ofir'), at: NOW.toISOString() });
    }
    await page.click('#btn-refresh');
    await settle(page);
    assert.equal((await lines(page))['landing-assign'].text, `לקוח אחד מחכה לשיוך עורך · ${NO_CLOCK}`);
    db.clients.find((c) => c.id === cid(33)).editor = 'nirel';
    db.protocol_checks.push({ client_id: cid(33), item_key: 'p22a.assigned', state: 'done', note: null, by_email: emailOf('ofir'), at: NOW.toISOString() });
    await page.click('#btn-refresh');
    await settle(page);
    assert.equal((await lines(page))['landing-assign'], undefined);
    await ctx.close();
  });

  await step('the lines are of the person\'s own list only: not on the team\'s work, and not on another person\'s list', async () => {
    const { page, ctx } = await signedIn('lior');
    assert.ok(Object.keys(await lines(page)).length >= 6);
    await page.goto(`${BASE}clients.html#team`);
    await settle(page);
    await page.selectOption('#mine-select', 'ofir');
    await settle(page);
    assert.deepEqual(await lines(page), {});
    await ctx.close();
  });

  await step('qa.html: work of a client in landing is marked "בקליטה", with no clock and no late colour, in the queue and in the assignment list', async () => {
    const { page, ctx } = await signedIn('ofir');
    await page.goto(`${BASE}qa.html#assign-h`);
    await page.waitForSelector('#of-page:not([hidden]) #assign-list li.of-card');
    await settle(page);
    assert.equal(await page.locator('#assign-list li.of-card').count(), COUNTS.assign.clock + COUNTS.assign.landing);
    const old = page.locator('#assign-list li.of-card:has(.tag-landing)');
    assert.equal(await old.count(), COUNTS.assign.landing);
    assert.equal(await lateMarks(old), 0, 'a client in landing is late in the assignment list');
    assert.ok(await lateMarks(page.locator('#assign-list li.of-card:not(:has(.tag-landing))')) > 0, 'the clients with a clock keep it');
    for (const n of [31, 32, 33]) assert.equal(await page.locator(`#assign-list li[data-key^="${cid(n)}:"] .tag-landing`).count(), 1, `client ${n}`);
    // The dialog says the same, and names no hour.
    await page.click(`#assign-list li[data-key^="${cid(31)}:"] button`);
    await page.waitForSelector('#dlg-assign[open]');
    assert.match(await page.innerText('#as-meta'), /בקליטה · בלי שעון עד שהלקוח יופעל/);
    assert.doesNotMatch(await page.innerText('#as-meta'), /לשייך עד/);
    await page.keyboard.press('Escape');
    // The quality-control queue: the one in landing has the mark and no hour or meter.
    assert.equal(await page.locator('#qa-list li.of-card').count(), COUNTS.qa.clock + COUNTS.qa.landing);
    const quiet = page.locator(`#qa-list li[data-key^="${cid(34)}:"]`);
    assert.equal(await quiet.locator('.tag-landing').count(), 1);
    assert.equal(await quiet.locator('.of-meter').count(), 0);
    assert.doesNotMatch(await quiet.innerText(), /בקרה עד|מתוך שעה|עבר היעד/);
    assert.equal(await lateMarks(quiet), 0);
    const live = page.locator(`#qa-list li[data-key^="${cid(12)}:"]`);
    assert.equal(await live.locator('.tag-landing').count(), 0);
    assert.match(await live.innerText(), /מתוך שעה · בקרה עד/);
    // The editors' load names it the same way.
    assert.equal(await page.locator('#load-list .of-jobs li:has(.tag-landing)').count(), 2);
    assert.equal(await lateMarks(page.locator('#load-list .of-jobs li:has(.tag-landing)')), 0);
    await ctx.close();
  });

  await step('decisions.html, prep.html, pass.html and Ilai\'s cards mark a client in landing the same way', async () => {
    // An editing paused yesterday on a client of the old system, and its broken login.
    const db = flowWorld();
    db.protocol_checks.push({ client_id: cid(36), item_key: 'p22.pause', state: 'done', note: JSON.stringify({ reason: 'חסר חומר' }), by_email: emailOf('yariv'), at: '2026-10-19T09:00:00+03:00' });
    db.client_access.push({ id: 'a0000000-0000-4000-8000-000000000002', client_id: cid(36), network: 'facebook', label: null, username: 'noy', status: 'broken', note: null, updated_by: emailOf('ilai'), updated_at: '2026-10-19T14:00:00+03:00' });
    const { page, ctx } = await signedIn('lior', { db });
    const mine = await lines(page);
    assert.equal(mine['landing-paused'].text, `עריכה אחת עצורה ומחכה להחלטה שלך · ${NO_CLOCK}`);
    assert.equal(mine.paused.text, 'עריכה אחת עצורה מאתמול ומחכה להחלטה שלך');
    assert.equal(mine.access.text, '2 גישות שבורות מחכות לתיקון');
    await page.click('#flow-landing-paused');
    await page.waitForSelector('#dc-page:not([hidden]) #pz-list li.of-card');
    await settle(page);
    assert.equal(await page.locator('#pz-list li.of-card').count(), 2);
    assert.equal(await page.locator('#pz-list li.of-card:has(.tag-landing)').count(), 1);
    assert.match(await page.locator('#pz-list li.of-card:has(.tag-landing)').innerText(), /נוי מסגרות/);
    assert.equal(await page.locator('#ac-list li.of-card:has(.tag-landing)').count(), 1);
    assert.match(await page.locator('#ac-list li.of-card:has(.tag-landing)').innerText(), /נוי מסגרות/);
    // The lists of 12:00 and 16:00: nothing of a client in landing is "late" there.
    assert.equal(await lateMarks(page.locator('#ls-list li.of-card:has(.tag-landing)')), 0);

    // prep.html: the shoot day of next week is real, the client is marked, nothing is late in its card.
    await page.goto(`${BASE}prep.html`);
    await page.waitForSelector('#pp-shoots li.pp-card');
    await settle(page);
    const card = page.locator('#pp-shoots li.pp-card:has(.tag-landing)');
    assert.equal(await card.count(), 1);
    assert.match(await card.locator('h2').innerText(), /רותי אלון/);
    assert.equal(await lateMarks(card), 0);
    assert.equal(await page.locator('#pp-shoots li.pp-card:not(:has(.tag-landing))').count() > 0, true);
    await ctx.close();

    // pass.html (Ofir): every client of the old system has the mark, and none is late or stuck.
    const ofir = await signedIn('ofir', { db: flowWorld() });
    await ofir.page.goto(`${BASE}pass.html`);
    await ofir.page.waitForSelector('#of-page:not([hidden]) .ps-row, #ps-list .ps-row, .ps-row', { state: 'attached' });
    await settle(ofir.page);
    for (const n of [31, 32, 33, 34, 35, 36]) {
      const row = ofir.page.locator(`[id="ps-${cid(n)}"]`);
      if (!(await row.count())) continue; // folded into "all the rest"
      assert.equal(await row.locator('.tag-landing').count(), 1, `client ${n} on pass.html`);
      assert.equal(await row.locator('.tag-warn').count(), 0, `client ${n} is "stuck" on pass.html`);
      assert.equal(await lateMarks(row), 0, `client ${n} is late on pass.html`);
    }
    await ofir.ctx.close();

    // Ilai's cards of "המשימות שלי" list the graphics of the old clients too: marked, and with no date.
    const ilai = await signedIn('ilai');
    const old = ilai.page.locator('#mine-list .il-card:has(.tag-landing)');
    assert.equal(await old.count(), 5);
    assert.equal(await lateMarks(old), 0);
    await ilai.ctx.close();
  });

  await step('Ofir\'s card of 22א opens the assignment of that client on his page, and of 25 his queue; Irit\'s card of 22א has no such link', async () => {
    const { page, ctx } = await signedIn('ofir');
    await page.evaluate(() => { try { sessionStorage.setItem('astrateg.mine.full', 'on'); } catch { /* no storage */ } });
    await page.reload();
    await page.waitForSelector('#view-mine:not([hidden]) .wproc');
    await settle(page);
    const assign = page.locator(`#mine-list .wproc[data-key="${cid(23)}:p22a"] a.ik-go`);
    assert.deepEqual([await assign.getAttribute('href'), (await assign.innerText()).trim()], [`qa.html#assign-${cid(23)}`, 'שיוך עורך']);
    const qa = page.locator(`#mine-list .wproc[data-key="${cid(12)}:p25"] a.ik-go`);
    assert.deepEqual([await qa.getAttribute('href'), (await qa.innerText()).trim()], ['qa.html#qa-h', 'לבקרת האיכות']);
    await assign.click();
    await page.waitForSelector('#dlg-assign[open]');
    assert.match(await page.innerText('#as-h'), /שיוך עורך · נטע שלום/);
    await ctx.close();

    const irit = await signedIn('irit');
    await irit.page.evaluate(() => { try { sessionStorage.setItem('astrateg.mine.full', 'on'); } catch { /* no storage */ } });
    await irit.page.reload();
    await irit.page.waitForSelector('#view-mine:not([hidden]) .wproc');
    await settle(irit.page);
    assert.equal(await irit.page.locator('#mine-list a[href^="qa.html"], #mine-list a[href^="decisions.html"], #land-line a[href^="qa.html"]').count(), 0);
    await irit.ctx.close();
  });

  await step('the lines are there when the list is first shown: "המשימות שלי" does not jump', async () => {
    for (const role of ['ofir', 'lior', 'irit', 'eli']) {
      const { page, ctx } = await signedIn(role, { latency: 120 });
      await page.goto('about:blank');
      await page.goto(`${BASE}clients.html#mine`);
      await page.waitForFunction(() => !('boot' in document.documentElement.dataset) && !document.getElementById('app')?.hidden, null, { timeout: 20000 });
      // The moment the page is shown, its lines are in it.
      assert.deepEqual(Object.keys(await lines(page)).sort(), Object.keys(EXPECTED[role]).sort(), `${role}: the lines came after the page was shown`);
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(700);
      const cls = await page.evaluate(() => Math.round(window.__cls * 1000) / 1000);
      assert.ok(cls < 0.1, `${role}: "המשימות שלי" shifted by ${cls}`);
      await ctx.close();
    }
  });

  noCspViolations();
  assert.deepEqual(errors, [], `errors on the pages: ${errors.join(' | ')}`);
  console.log(`\nall-in-mine: ${passed} steps passed`);
} finally {
  await browser.close();
}
