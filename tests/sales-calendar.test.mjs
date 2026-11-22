// The field sales' "יומן" (Lior's request, approved by the owner on 22.11.2026; docs/ops.md,
// section 146): Stav sees a month of days, taken by shoot days or free, and nothing of a
// client. The pure rules of app/calendar-view.js and the menu of app/shell-rules.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { seesShootDays, seesCalendar, salesMonth, salesDayText, salesCount, shootCountWords, calendarEvents } from '../app/calendar-view.js';
import { SALES_CALENDAR, SCOPE } from '../app/protocol.js';
import { menuOf, homeLink } from '../app/shell-rules.js';

const v = (me) => ({ me, scope: SCOPE[me] || 'own' });

test('who: Stav only of the sales; never anyone who has the full page', () => {
  assert.deepEqual(SALES_CALENDAR, ['stav']);
  assert.equal(seesShootDays(v('stav')), true);
  assert.equal(seesCalendar(v('stav')), false, 'Stav gets no events of a client');
  for (const me of ['amos', 'irit', 'lior', 'ofir', 'nadia', 'eli', 'tal', 'gal']) assert.equal(seesShootDays(v(me)), false, me);
  assert.equal(seesShootDays({ me: null, scope: 'office' }), false, 'the owners have the full page');
  assert.equal(seesShootDays({ me: 'stav', scope: 'sales', error: new Error('x') }), false);
  // Her calendar events, if the page were ever asked for them: none.
  assert.deepEqual(calendarEvents({ viewer: v('stav'), clients: [{ id: 'c', name: 'x', status: 'active', shoot_at: '2027-03-03T10:00:00+02:00' }], from: new Date('2027-03-01'), until: new Date('2027-04-01') }), []);
});

test('the menu: deal, calendar, the bot; home stays the deal page', () => {
  assert.deepEqual(menuOf(v('stav')).map((it) => it.id), ['deal', 'calendar', 'ask']);
  assert.deepEqual(menuOf(v('amos')).map((it) => it.id), ['deal', 'ask']);
  assert.equal(homeLink(v('stav')).href, 'deal.html');
});

test('a month: taken with its count, free on business days, Friday, Saturday and holidays closed, the past quiet', () => {
  // March 2027: the 1st is a Monday.
  const rows = [{ day: '2027-03-03', n: 2 }, { day: '2027-03-04', n: 1 }, { day: '2027-03-01', n: 1 }, { day: '2027-03-05', n: 1 }];
  const m = salesMonth('2027-03-10', rows, '2027-03-02');
  assert.equal(m.month, '2027-03');
  const by = Object.fromEntries(m.days.map((d) => [d.key, d]));
  assert.deepEqual([by['2027-03-01'].state, by['2027-03-01'].n], ['past', 1]);
  assert.deepEqual([by['2027-03-03'].state, by['2027-03-03'].n], ['taken', 2]);
  assert.equal(by['2027-03-04'].state, 'taken');
  assert.equal(by['2027-03-05'].state, 'taken', 'a shoot set on a Friday still shows taken');
  assert.equal(by['2027-03-06'].state, 'closed', 'Saturday');
  assert.equal(by['2027-03-12'].state, 'closed', 'Friday');
  assert.equal(by['2027-03-08'].state, 'free');
  assert.equal(by['2027-02-28'].out, true, 'the Sunday before the 1st is drawn quietly');
  assert.equal(m.days.length % 7, 0);
});

test('the words', () => {
  assert.equal(shootCountWords(1), 'יום צילום');
  assert.equal(shootCountWords(2), '2 צילומים');
  assert.equal(salesDayText({ state: 'taken', n: 1 }), 'יש יום צילום ביום הזה.');
  assert.equal(salesDayText({ state: 'taken', n: 3 }), 'יש 3 צילומים ביום הזה.');
  assert.equal(salesDayText({ state: 'free', n: 0 }), 'פנוי: אין צילום ביום הזה.');
  assert.match(salesDayText({ state: 'closed', n: 0 }), /סוף שבוע או חג/);
  assert.equal(salesDayText({ state: 'past', n: 1 }), 'היום הזה עבר. היה בו צילום.');
  const m = salesMonth('2027-03-01', [{ day: '2027-03-03', n: 2 }], '2027-03-01');
  assert.match(salesCount(m), /^יום אחד תפוס בצילום · \d+ ימי עבודה פנויים$/);
});

test('bad rows from the server change nothing', () => {
  const m = salesMonth('2027-03-01', [null, { day: 'x', n: 4 }, { day: '2027-03-08', n: 'a' }], '2027-03-01');
  assert.ok(m.days.every((d) => d.n === 0));
});

test('the page holds no client for the sales: it asks only public.sales_shoot_days', () => {
  const page = readFileSync(new URL('../app/calendar-page.js', import.meta.url), 'utf8');
  const sales = page.slice(page.indexOf('// ── The field sales'), page.indexOf('function render()'));
  assert.match(sales, /rpc\('sales_shoot_days'/);
  assert.ok(!/loadClients|loadChecks|loadTasks|quoteFacts/.test(sales));
  // The branch returns before the clients are ever loaded.
  const mount = page.slice(page.indexOf('mountSession('));
  assert.ok(mount.indexOf('seesShootDays(v)') < mount.indexOf('await load()'));
});
