// docs/ops.md, section 50, in the browser, each role signed in as itself, against
// tests/late-world.mjs (Tuesday 20.10.2026, 10:00 in Israel; invented names):
//   A1  the approvals of "לפני יום צילום" and of the shoot-date dialog: no label leaves
//       its button and no button lies on another, at 360, 390 and 1280px;
//   A2  "שמירת המועד" with no date saves nothing and says so next to the field; a date
//       of the client card is cleared only after "ניקוי המועד" is confirmed;
//   B   the "באיחור" tab: who has it, its number (the owners' end-of-day table's own
//       count for that person, plus the counted lines of the "באיחור" group), the same
//       number on the group's heading, the opened tab, the address #late, the phone;
//   C   every counted line is solid: a number, one sentence, a button, 48px and up;
//   D   the kit on "המשימות שלי", and the client-file blocks left as they were.
// Run: npx http-server -p 8080 -s -c-1 . &  then  node tests/late-tab-e2e.mjs
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { NOW, SUPA, emailOf, lateWorld, makeFlowFake, cid, NO_DATE, SENT } from './late-world.mjs';
import { watchCsp, noCspViolations } from './csp-watch.mjs';
import { clientState } from '../app/protocol-logic.js';
import { daySummary } from '../app/day-summary.js';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const SIZES = { 360: { width: 360, height: 780 }, 390: { width: 390, height: 844 }, 1280: { width: 1280, height: 900 } };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(400); };
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();

async function signedIn(role, { db = lateWorld(), path = 'clients.html#mine', width = 390 } = {}) {
  const fake = makeFlowFake(db);
  const phone = width < 600;
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: SIZES[width], isMobile: phone, hasTouch: phone });
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
  if (path.startsWith('clients.html')) await page.waitForSelector('#view-mine:not([hidden]), #view-clients:not([hidden])');
  await settle(page);
  return { page, ctx, db, fake };
}

// The buttons of one row: none has words wider than itself, none leaves `box`, no two overlap.
const rowProblems = (page, sel, box) => page.evaluate(([s, b]) => {
  const out = [];
  const els = [...document.querySelectorAll(s)].filter((e) => e.getClientRects().length);
  const frame = document.querySelector(b)?.getBoundingClientRect();
  const rects = els.map((e) => e.getBoundingClientRect());
  els.forEach((e, i) => {
    const name = e.textContent.trim().slice(0, 30);
    if (e.scrollWidth > e.clientWidth + 1) out.push(`the words of "${name}" are wider than the button (${e.scrollWidth} > ${e.clientWidth})`);
    if (e.scrollHeight > e.clientHeight + 1) out.push(`the words of "${name}" are taller than the button`);
    if (frame && (rects[i].left < frame.left - 1 || rects[i].right > frame.right + 1)) out.push(`"${name}" leaves its card`);
    for (let j = i + 1; j < els.length; j += 1) {
      const [a, c] = [rects[i], rects[j]];
      if (a.left < c.right - 1 && c.left < a.right - 1 && a.top < c.bottom - 1 && c.top < a.bottom - 1) out.push(`"${name}" lies on "${els[j].textContent.trim().slice(0, 30)}"`);
    }
  });
  if (!els.length) out.push(`nothing matches ${s}`);
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push('the page scrolls sideways');
  return out;
}, [sel, box]);

// What the owners' end-of-day table counts as late for each person, from the same rows.
function tableLate(db) {
  const checks = {};
  for (const r of db.protocol_checks) (checks[r.client_id] ||= {})[r.item_key] = r;
  const sum = daySummary({
    clients: db.clients, checksOf: (c) => checks[c.id] || {}, stateOf: (c) => clientState(c, checks[c.id] || {}, NOW),
    tasks: db.client_tasks.filter((t) => !t.done_at), now: NOW,
  });
  return (person) => sum.rows.find((r) => r.person === person)?.late || 0;
}
const patches = (fake, table) => fake.calls.filter((c) => c.method === 'PATCH' && c.table === table);

let passed = 0;
async function step(name, fn) {
  try { await fn(); passed += 1; console.log(`ok - ${name}`); } catch (e) { console.log(`not ok - ${name}`); throw e; }
}

try {
  // ── A1 ──
  for (const width of [360, 390, 1280]) {
    await step(`A1: the approvals of "לפני יום צילום" stay inside their buttons at ${width}px`, async () => {
      const { page, ctx } = await signedIn('irit', { path: 'prep.html', width });
      await page.waitForSelector('#pp-shoots .pp-party');
      await page.evaluate(() => { for (const d of document.querySelectorAll('#pp-shoots details')) d.open = true; });
      const cards = await page.locator('#pp-shoots .pp-card:has(.pp-party)').evaluateAll((els) => els.map((e) => e.id));
      assert.ok(cards.includes(`shoot-${NO_DATE}-1`), 'the client with no shoot date has its card');
      for (const id of cards) assert.deepEqual(await rowProblems(page, `#${id} .pp-party .btn, #${id} .ik-row .btn`, `#${id}`), [], `${id} at ${width}`);
      // The long one is whole: its words are on the screen, inside the button.
      const long = page.locator(`#shoot-${NO_DATE}-1 .pp-party .btn`, { hasText: 'בדקתי בחוזה אילו משפיענים נרכשו' });
      assert.equal(await long.count(), 1);
      assert.ok((await long.boundingBox()).height >= 48);
      await ctx.close();
    });
    await step(`A1: the approvals of the shoot-date dialog at ${width}px`, async () => {
      const { page, ctx } = await signedIn('irit', { width });
      await page.locator(`#mine-list .wproc[data-key="${NO_DATE}:p11"] [data-need] button`).evaluate((b) => b.click());
      await page.waitForSelector('#dlg-shoot[open]');
      await settle(page);
      assert.equal(await page.locator('#shoot-oks .chip').count(), 6);
      assert.deepEqual(await rowProblems(page, '#shoot-oks .chip, #shoot-free .chip', '#dlg-shoot'), []);
      for (const h of await page.locator('#shoot-oks .chip').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) assert.ok(h >= 44, `a chip is ${h}px`);
      await ctx.close();
    });
  }

  // ── A2 ──
  await step('A2: "שמירת המועד" with no date saves nothing, says so at the field, and a date then saves', async () => {
    const { page, ctx, fake, db } = await signedIn('irit', { path: 'prep.html' });
    const k = `${NO_DATE}-1`;
    await page.waitForSelector(`#sh-save-${k}`);
    assert.equal(await page.inputValue(`#sh-at-${k}`), '');
    assert.equal(await page.inputValue(`#sh-type-${k}`), 'dms', 'the group comes filled in from the package');
    const before = patches(fake, 'clients').length;
    await page.click(`#sh-save-${k}`);
    await page.waitForTimeout(300);
    assert.equal(patches(fake, 'clients').length, before, 'nothing was written');
    assert.equal(await text(page.locator(`#sh-at-${k}-err`)), 'צריך לבחור תאריך ושעה');
    assert.equal(await page.getAttribute(`#sh-at-${k}`, 'aria-invalid'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement?.id), `sh-at-${k}`);
    assert.doesNotMatch(await text(page.locator('#toast')), /נשמר/);
    assert.equal(db.clients.find((c) => c.id === NO_DATE).shoot_at, null);
    // A date: the sentence goes, and the date is what is saved.
    await page.fill(`#sh-at-${k}`, '2026-11-10T10:00');
    assert.equal(await page.isHidden(`#sh-at-${k}-err`), true);
    await page.click(`#sh-save-${k}`);
    const ask = page.locator('#dlg-shoot-day[open]');
    await Promise.race([ask.waitFor(), page.waitForFunction(() => /המועד נשמר/.test(document.getElementById('toast')?.textContent || ''))]).catch(() => {});
    if (await ask.count()) { await page.fill('#av-reason', 'תואם עם הלקוח'); await page.click('#av-reason-ok'); }
    await page.waitForFunction(() => /המועד נשמר: /.test(document.getElementById('toast')?.textContent || ''));
    const sent = patches(fake, 'clients').at(-1).body;
    assert.equal(new Date(sent.shoot_at).toISOString(), '2026-11-10T08:00:00.000Z');
    assert.equal(sent.shoot_type, 'dms');
    await ctx.close();
  });
  await step('A2: the client card clears a date only after "ניקוי המועד" is confirmed', async () => {
    const { page, ctx, fake } = await signedIn('irit', { path: `client.html?id=${SENT}`, width: 1280 });
    await page.waitForSelector('#cc-head button, #cc-head .btn');
    const asked = [];
    let answer = false;
    page.on('dialog', (d) => { asked.push(d.message()); if (answer) d.accept(); else d.dismiss(); });
    const openEdit = async () => { await page.locator('#cc-head button', { hasText: /עריכ|פרטי/ }).first().click(); await page.waitForSelector('#dlg-edit[open]'); };
    await openEdit();
    assert.notEqual(await page.inputValue('#ed-shoot-at'), '');
    await page.fill('#ed-shoot-at', '');
    const before = patches(fake, 'clients').length;
    await page.click('#ed-submit');
    await page.waitForTimeout(300);
    assert.equal(asked.length, 1);
    assert.match(asked[0], /^ניקוי המועד: מועד יום הצילום\./);
    assert.equal(patches(fake, 'clients').length, before, 'declined: nothing was written');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'ed-shoot-at');
    answer = true;
    await page.click('#ed-submit');
    await page.waitForFunction(() => /נוקה: מועד יום הצילום/.test(document.getElementById('toast')?.textContent || ''));
    assert.equal(patches(fake, 'clients').at(-1).body.shoot_at, null);
    // A save that clears nothing asks nothing.
    await openEdit();
    await page.click('#ed-submit');
    await page.waitForFunction(() => /הפרטים נשמרו\.$/.test((document.getElementById('toast')?.textContent || '').trim()));
    assert.equal(asked.length, 2 - 0, 'no third question');
    await ctx.close();
  });

  // ── B ──
  const expected = tableLate(lateWorld());
  const seen = {};
  for (const role of ['irit', 'ofir', 'lior', 'ilai', 'nadia', 'anna', 'eli']) {
    await step(`B: ${role}: the "באיחור" tab carries the table's own number, and so does the group`, async () => {
      const { page, ctx } = await signedIn(role);
      const lateLines = await page.locator('#mine-list .g-overdue a.flow-line').count();
      const want = expected(role) + lateLines;
      seen[role] = want;
      if (!want) {
        assert.equal(await page.isHidden('#tab-late'), true, 'nothing late: no tab, and no zero');
        assert.equal(await page.locator('#mine-list .g-overdue').count(), 0);
        await ctx.close();
        return;
      }
      assert.equal(await page.isVisible('#tab-late'), true);
      assert.equal(await text(page.locator('#tab-late')), `באיחור ${want}`);
      assert.equal(await page.getAttribute('#tab-late', 'aria-selected'), 'false');
      assert.equal(Number(await page.locator('#mine-list .g-overdue .wgroup-h .n').innerText()), want, 'the heading of the group says the same number');
      // Late items stay at the top of "המשימות שלי": the group is still there.
      assert.ok(await page.locator('#mine-list .g-overdue').count() === 1);
      // Opened: only the late ones, with the same controls.
      await page.click('#tab-late');
      await settle(page);
      assert.equal(await page.getAttribute('#tab-late', 'aria-selected'), 'true');
      assert.equal(await page.getAttribute('#tab-mine', 'aria-selected'), 'false');
      assert.equal(await page.evaluate(() => location.hash), '#late');
      assert.equal(await page.getAttribute('#view-mine', 'aria-labelledby'), 'tab-late');
      assert.match(await text(page.locator('#late-h')), new RegExp(`^${want === 1 ? 'דבר אחד' : `${want} דברים`} באיחור אצלך`));
      for (const sel of ['#now-bar', '#push-card', '#mine-foot', '#my-months', '#land-line', '#staff-tasks-card']) assert.equal(await page.isVisible(sel), false, `${sel} is not part of the late view`);
      if (role !== 'ilai') {
        const rows = await page.locator('#mine-list .late-list > li:not(.more-row)').count();
        assert.equal(rows, want, 'one row for each late thing');
        assert.equal(await page.locator('#mine-list .late-list .wc-when:not(.s-overdue)').count(), 0, 'every card there is late');
        assert.ok(await page.locator('#mine-list .late-list .cbx, #mine-list .late-list .wc-go, #mine-list .late-list a.k-line').count() >= 1, 'the same controls');
      } else {
        assert.ok(await page.locator('#mine-list .il-list .il-card').count() >= 1, 'his own cards, the late ones');
      }
      await ctx.close();
    });
  }
  await step('B: somebody is late and somebody is not (the world covers both), and the owners have no tab', async () => {
    assert.ok(Object.values(seen).some((n) => n > 0) && seen.nadia > 0, JSON.stringify(seen));
    const { page, ctx } = await signedIn('owner');
    assert.equal(await page.isHidden('#tab-late'), true);
    await page.goto(`${BASE}clients.html#late`);
    await settle(page);
    assert.equal(await page.getAttribute('#tab-mine', 'aria-selected'), 'true', 'the address falls back to the list');
    await ctx.close();
  });
  await step('B: the address #late opens the tab, the keyboard walks the row, and the tab stays personal', async () => {
    const { page, ctx } = await signedIn('irit', { path: 'clients.html#late', width: 1280 });
    await page.waitForSelector('#late-h');
    assert.equal(await page.getAttribute('#tab-late', 'aria-selected'), 'true');
    assert.equal(await page.locator('.side-link[aria-current="page"], .side-link.is-current').first().innerText().then((t) => t.trim()), 'המשימות שלי');
    await page.focus('#tab-late');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.getAttribute('#tab-mine', 'aria-selected'), 'true');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.getAttribute('#tab-late', 'aria-selected'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'tab-late');
    // In the manager profile the tab is not offered.
    await page.goto(`${BASE}clients.html#team`);
    await settle(page);
    assert.equal(await page.isHidden('#tab-late'), true);
    await ctx.close();
  });
  await step('B: a late item ticked in the tab leaves it, and the number follows', async () => {
    const { page, ctx } = await signedIn('nadia');
    const n = Number(await page.locator('#tab-late-n').innerText());
    await page.click('#tab-late');
    await settle(page);
    const card = page.locator('#mine-list .late-list .wproc[data-key^="task:"]').first();
    await card.locator('.cbx').check();
    await page.waitForFunction((was) => (Number(document.getElementById('tab-late-n')?.textContent || 0)) === was - 1, n);
    assert.equal(await page.getAttribute('#tab-late', 'aria-selected'), 'true', 'still on the tab');
    if (n === 1) {
      assert.equal(await text(page.locator('#mine-list .k-empty p')), 'אין אצלך כרגע שום דבר באיחור.');
      assert.equal(await page.isVisible('#tab-late'), true, 'it stays while it is the open view');
      await page.click('#late-back');
      assert.equal(await page.getAttribute('#tab-mine', 'aria-selected'), 'true');
      assert.equal(await page.isHidden('#tab-late'), true, 'and goes once left');
    }
    await ctx.close();
  });
  await step('B: the client\'s turn and a client in landing are nobody\'s lateness', async () => {
    const { page, ctx } = await signedIn('irit');
    await page.evaluate(() => { for (const d of document.querySelectorAll('#mine-list details')) d.open = true; });
    for (let i = 0; i < 12 && await page.locator('#mine-list .more-btn:visible').count(); i += 1) await page.locator('#mine-list .more-btn:visible').first().click();
    const sent = page.locator(`#mine-list .wproc[data-key="${SENT}:p07"]`);
    assert.equal(await sent.count(), 1);
    assert.equal(await sent.evaluate((e) => !!e.closest('.g-overdue')), false, 'not in "באיחור"');
    assert.equal(await text(sent.locator('.wc-when')), 'מחכה לתשובת הלקוח');
    assert.equal(await sent.locator('.s-overdue').count(), 0);
    const landed = page.locator('#mine-list .wproc[data-key="task:d0000000-0000-4000-8000-000000000072"]');
    assert.equal(await landed.count(), 1);
    assert.equal(await landed.evaluate((e) => !!e.closest('.g-overdue')), false);
    assert.equal(await text(landed.locator('.wc-when')), 'היעד עבר');
    await ctx.close();
  });
  for (const [role, labels] of [['irit', 4], ['ilai', 4]]) {
    await step(`B: ${role} on a 360px phone: the ${labels} tabs are all on the screen, 44px and up, and the page does not scroll sideways`, async () => {
      const { page, ctx } = await signedIn(role, { width: 360 });
      const tabs = await page.locator('.tabs [role=tab]:visible').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { id: e.id, left: r.left, right: r.right, height: r.height, over: e.scrollWidth > e.clientWidth + 1 }; }));
      assert.equal(tabs.length, labels, tabs.map((t) => t.id).join(','));
      for (const t of tabs) {
        assert.ok(t.left >= 0 && t.right <= 360, `${t.id} is off the screen (${t.left}..${t.right})`);
        assert.ok(t.height >= 44, `${t.id} is ${t.height}px`);
        assert.equal(t.over, false, `${t.id}: its words are cut`);
      }
      assert.equal(await page.evaluate(() => document.querySelector('.tabs').scrollWidth <= document.querySelector('.tabs').clientWidth + 1), true, 'the row itself does not scroll');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await page.click('#tab-late');
      await settle(page);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await ctx.close();
    });
  }

  // ── C ──
  for (const role of ['ofir', 'irit', 'lior', 'eli', 'yariv']) {
    await step(`C: ${role}: every counted line is solid, with its number, one sentence and a button`, async () => {
      const { page, ctx } = await signedIn(role, { width: 360 });
      await page.evaluate(() => { for (const d of document.querySelectorAll('#mine-list details')) d.open = true; });
      const rows = await page.evaluate(() => [...document.querySelectorAll('#land-line a, #mine-list a.flow-line')].filter((a) => a.getClientRects().length).map((a) => {
        const cs = getComputedStyle(a);
        const go = a.querySelector('.k-go');
        const num = a.querySelector('.k-num');
        return {
          id: a.id || a.getAttribute('href'), cls: a.className, height: a.getBoundingClientRect().height, bg: cs.backgroundColor, dashed: cs.borderStyle.includes('dashed'),
          num: num?.textContent, numSize: parseFloat(getComputedStyle(num).fontSize), numWeight: Number(getComputedStyle(num).fontWeight),
          words: a.querySelector('strong').textContent, go: go?.textContent, goBg: go ? getComputedStyle(go).backgroundColor : null, weight: Number(getComputedStyle(a.querySelector('strong')).fontWeight),
          group: a.closest('#land-line') ? 'landing' : [...(a.closest('.wgroup')?.classList || [])].find((c) => c.startsWith('g-'))?.slice(2) || null,
          wide: a.scrollWidth > a.clientWidth + 1,
        };
      }));
      assert.ok(rows.length >= 1, `${role} has a counted line in this world`);
      for (const r of rows) {
        assert.ok(r.height >= 48, `${r.id}: ${r.height}px`);
        assert.notEqual(r.bg, 'rgba(0, 0, 0, 0)', `${r.id}: a filled surface`);
        assert.equal(r.dashed, false, `${r.id}: no dashed edge`);
        assert.match(r.num, /^\d+$/, `${r.id}: its number`);
        assert.ok(r.numSize >= 20 && r.numWeight >= 700, `${r.id}: the number is big and bold (${r.numSize}px, ${r.numWeight})`);
        assert.ok(r.weight >= 600, `${r.id}: the sentence is bold`);
        assert.ok(r.go && r.goBg !== 'rgba(0, 0, 0, 0)', `${r.id}: the action is a filled button`);
        assert.equal(r.wide, false, `${r.id}: nothing is cut at 360px`);
        // The whole sentence is still there for whoever reads without eyes; the number is not said twice.
        assert.ok(r.words.length > 8);
        const tone = r.group === 'landing' ? 'k-line-landing' : ['overdue', 'urgent', 'escalation'].includes(r.group) ? 'k-line-late' : r.group === 'today' ? 'k-line-today' : 'k-line-plain';
        assert.ok(r.cls.split(' ').includes(tone), `${r.id} in ${r.group}: ${r.cls}`);
        if (r.group === 'landing' && r.cls.includes('flow-line')) assert.match(r.words, /· בקליטה, בלי שעון$/);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      // The whole row is the link.
      const first = page.locator('#land-line a, #mine-list a.flow-line').first();
      const href = await first.getAttribute('href');
      await first.scrollIntoViewIfNeeded();
      await first.locator('.k-go').click();
      await page.waitForURL((u) => u.href.includes(href.split('#')[0]));
      await ctx.close();
    });
  }

  // ── D ──
  await step('D: the kit on "המשימות שלי": icon squares on the headings, and a friendly empty state', async () => {
    const { page, ctx } = await signedIn('irit', { width: 1280 });
    const heads = await page.evaluate(() => [...document.querySelectorAll('#view-mine h2, #view-mine summary.wgroup-h')].filter((e) => e.getClientRects().length).map((e) => ({ id: e.id || e.textContent.trim().slice(0, 20), icon: !!e.querySelector(':scope > .k-ico svg[aria-hidden="true"]') })));
    assert.ok(heads.length >= 4, JSON.stringify(heads));
    assert.deepEqual(heads.filter((x) => !x.icon), [], 'every heading of the screen has its icon square');
    // The icons are decoration: none is named, none takes the focus.
    assert.equal(await page.locator('#app svg.k-svg:not([aria-hidden="true"])').count(), 0);
    // The colour is in the squares only: a glyph on its soft square, 3:1 and up.
    const low = await page.evaluate(() => {
      const lum = (c) => { const v = c.match(/[\d.]+/g).slice(0, 3).map((x) => x / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
      return [...document.querySelectorAll('#app .k-ico')].filter((e) => e.getClientRects().length).map((e) => { const cs = getComputedStyle(e); const [a, b] = [lum(cs.color), lum(cs.backgroundColor)].sort((x, y) => y - x); return (a + 0.05) / (b + 0.05); }).filter((r) => r < 3);
    });
    assert.deepEqual(low, []);
    await ctx.close();
    // Nothing open at all: the empty state, with the same sentence as before.
    const db = lateWorld({ landing: false, queues: false });
    db.clients = db.clients.filter((c) => c.id === cid(12));
    db.client_tasks = [];
    const quiet = await signedIn('eli', { db });
    if (await quiet.page.locator('#mine-list .k-empty').count()) {
      assert.equal(await text(quiet.page.locator('#mine-list .k-empty p.empty')), 'אין כרגע משהו פתוח אצלך.');
      assert.equal(await quiet.page.locator('#mine-list .k-empty .k-ico').count(), 1);
    }
    await quiet.ctx.close();
  });
  await step('D: the client-file blocks of the client card are as they were (their turn comes with the next screens)', async () => {
    const { page, ctx } = await signedIn('irit', { path: `client.html?id=${cid(4)}`, width: 1280 });
    await page.waitForSelector('#fl-slot .fl-block');
    assert.equal(await page.locator('#fl-slot .k-ico, #st-slot .k-ico').count(), 0);
    assert.ok(await page.locator('#fl-slot .fl-add').count() >= 4);
    await ctx.close();
  });

  assert.deepEqual(errors, [], 'no page errors');
  noCspViolations();
  console.log(`\nlate-tab-e2e: ${passed} steps passed`);
} finally {
  await browser.close();
}
