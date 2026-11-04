// The shoot-day table's logic (app/shoot-table.js): which shoot days took place and
// when (from clients.shoot_at, clients.rounds and process 19, also for a client imported
// mid-way), the default order (the oldest last shoot first; "טרם צולמו" below, by the
// deal date), sorting by a header, the search, and who sees the screen
// (app/manager-rules.js, app/shell-rules.js). `npm test` runs this under three time zones.
import test from 'node:test';
import assert from 'node:assert/strict';
import { clientState, packageDeliverables } from '../app/protocol-logic.js';
import { importKeys } from '../app/client-open.js';
import { station } from '../app/health.js';
import { contractSummary } from '../app/contract-summary.js';
import { canSeeShootTable, canSeeTable } from '../app/manager-rules.js';
import { menuOf, currentOf } from '../app/shell-rules.js';
import {
  shootHistory, shootRow, shootGroups, searchRows, countText, heldText, agoText, aheadText, dayText, SHOOT_COLUMNS, DEFAULT_SORT, NEVER_TITLE,
} from '../app/shoot-table.js';

const at = (s) => new Date(s);
const NOW = at('2026-10-20T10:00:00+03:00'); // Tuesday
const iso = (d) => d?.toISOString() ?? null;
const base = {
  id: 'c1', name: 'דנה', business: 'סטודיו דנה', status: 'active', shoot_type: 'dms', characterizer: 'ofir', has_logo: true,
  deal_at: '2026-06-01T09:00:00+03:00', char_at: '2026-06-02T10:00:00+03:00', created_at: '2026-06-01T09:00:00+03:00',
  shoot_at: null, contract_end: '2027-06-01', rounds: [], editor: null, editor_name: null, package_name: 'Social + TV all in one · סמיון, מישל ודניס',
  deliverables: packageDeliverables({ package: { id: 'social-tv-simeon' }, selection: { paid: ['simeon-day'], free: {} } }), // 3 shoot days
};
const mk = (id, fields) => ({ ...base, id, ...fields });
const mark = (keys, when, note = null) => Object.fromEntries(keys.map((k) => [k, { state: 'done', note, at: when, by_email: 'lior@x.test' }]));
const P19 = ['p19.all', 'p19.testimonial', 'p19.drive', 'p19.took'];
// What the import by station writes: every item before the station, with the note "ייבוא".
const imported = (stationKey, pre = '') => mark(importKeys(stationKey).map((k) => pre + k), '2026-10-06T09:00:00+03:00', 'ייבוא');
const hist = (c, checks = {}, now = NOW) => shootHistory(c, checks, now);

test('a shoot day took place once its date is behind today (v12: nobody closes it); its date is the shoot day\'s own', () => {
  const c = mk('a', { shoot_at: '2026-10-05T10:00:00+03:00' });
  // The date passed: held, whatever was marked (Lior's closing, 19, left the protocol in v12).
  const passed = hist(c);
  assert.deepEqual(passed.done.map(iso), [iso(at('2026-10-05T10:00:00+03:00'))]);
  assert.deepEqual([iso(passed.last), passed.next, passed.held, passed.agreed, passed.unclosed.length], [iso(at('2026-10-05T10:00:00+03:00')), null, 1, 3, 0]);
  assert.equal(hist(c, mark(P19.slice(0, 3), '2026-10-05T14:00:00+03:00')).held, 1);
  assert.equal(hist(c, mark(P19, '2026-10-05T14:00:00+03:00')).held, 1);
  // A date still ahead: not yet, unless a mark says it took place (an old closing of 19, Eli's
  // handing over of the drive, an editor assigned): then the day of that mark.
  const ahead = mk('a', { shoot_at: '2026-10-28T10:00:00+03:00' });
  assert.deepEqual([hist(ahead).held, iso(hist(ahead).next)], [0, iso(at('2026-10-28T10:00:00+03:00'))]);
  for (const k of ['p19.took', 'p19b.handed', 'p22a.assigned']) {
    const h = hist(ahead, mark([k], '2026-10-19T14:00:00+03:00'));
    assert.deepEqual([h.held, iso(h.last), h.next], [1, iso(at('2026-10-19T14:00:00+03:00')), null], k);
  }
  // "לא רלוונטי" says so as "בוצע" does.
  assert.equal(hist(ahead, { 'p19b.handed': { state: 'na', note: null, at: '2026-10-19T14:00:00+03:00', by_email: 'eli@x.test' } }).held, 1);
});

test('the next shoot day: the nearest one set from today on that is not closed; today\'s is still ahead', () => {
  const c = mk('a', { shoot_at: '2026-10-28T10:00:00+03:00' });
  assert.deepEqual([iso(hist(c).next), hist(c).held, hist(c).unclosed.length], [iso(at('2026-10-28T10:00:00+03:00')), 0, 0]);
  assert.equal(hist(mk('a', {})).next, null);
  // A shoot this morning, seen in the evening: today's, not "passed and not closed".
  const today = mk('a', { shoot_at: '2026-10-20T08:00:00+03:00' });
  const evening = hist(today, {}, at('2026-10-20T21:00:00+03:00'));
  assert.deepEqual([iso(evening.next), evening.unclosed.length], [iso(at('2026-10-20T08:00:00+03:00')), 0]);
  // The day after: it took place (v12: a passed date is never "not closed").
  const after = hist(today, {}, at('2026-10-21T00:30:00+03:00'));
  assert.deepEqual([after.done.map(iso), after.unclosed.length, after.next], [[iso(at('2026-10-20T08:00:00+03:00'))], 0, null]);
  // Two rounds ahead: the nearer one.
  const two = mk('a', {
    shoot_at: '2026-09-01T10:00:00+03:00',
    rounds: [{ n: 2, shoot_at: '2026-12-01T10:00:00+02:00' }, { n: 3, shoot_at: '2026-11-10T10:00:00+02:00' }],
  });
  const h = hist(two, mark(P19, '2026-09-01T15:00:00+03:00'));
  assert.deepEqual([iso(h.last), iso(h.next), h.held], [iso(at('2026-09-01T10:00:00+03:00')), iso(at('2026-11-10T10:00:00+02:00')), 1]);
});

test('shoot rounds: every closed round is a shoot day, the last is the latest, oldest first in the list', () => {
  const c = mk('a', {
    shoot_at: '2026-06-20T10:00:00+03:00',
    rounds: [{ n: 2, shoot_at: '2026-08-18T10:00:00+03:00' }, { n: 3, shoot_at: '2026-11-03T10:00:00+02:00' }],
  });
  const checks = { ...mark(P19, '2026-06-20T15:00:00+03:00'), ...mark(P19.map((k) => `r2.${k}`), '2026-08-18T15:00:00+03:00') };
  const h = hist(c, checks);
  assert.deepEqual(h.done.map(iso), [iso(at('2026-06-20T10:00:00+03:00')), iso(at('2026-08-18T10:00:00+03:00'))]);
  assert.deepEqual([iso(h.last), iso(h.next), h.held, h.agreed], [iso(at('2026-08-18T10:00:00+03:00')), iso(at('2026-11-03T10:00:00+02:00')), 2, 3]);
  // The same count the contract summary shows in the client card.
  const s = contractSummary(c, clientState(c, checks, NOW), checks, { now: NOW }).items.find((x) => x.key === 'shoot_days');
  assert.deepEqual([s.done, s.total], [h.held, h.agreed]);
});

test('a client imported mid-way: the past shoot dates in shoot_at and rounds, closed by the import\'s own checks', () => {
  // In the ongoing station, shot twice in the old CRM: the first day and round 2, both imported.
  const c = mk('a', { shoot_at: '2026-03-10T10:00:00+02:00', rounds: [{ n: 2, shoot_at: '2026-07-14T10:00:00+03:00' }] });
  const checks = { ...imported('ongoing'), ...imported('ongoing', 'r2.') };
  const h = hist(c, checks);
  assert.deepEqual(h.done.map(iso), [iso(at('2026-03-10T10:00:00+02:00')), iso(at('2026-07-14T10:00:00+03:00'))]);
  assert.deepEqual([iso(h.last), h.next, h.held, h.unclosed.length], [iso(at('2026-07-14T10:00:00+03:00')), null, 2, 0]);
  const s = contractSummary(c, clientState(c, checks, NOW), checks, { now: NOW }).items.find((x) => x.key === 'shoot_days');
  assert.equal(s.done, 2);
  // Imported after its shoot with no date typed: it was shot, the date is not on record
  // (the day of the import is not the day of the shoot).
  const undated = hist(mk('b', {}), imported('ongoing'));
  assert.deepEqual([undated.done.length, undated.last, undated.held], [0, null, 1]);
  // Imported before its shoot: nothing took place.
  assert.equal(hist(mk('b', {}), imported('content')).held, 0);
  // Only the card's counter ("נמסרו 2 ימי צילום"): two were held, no dates.
  const counted = hist(mk('b', { deliverables: { ...base.deliverables, done: { shoot_days: 2 } } }));
  assert.deepEqual([counted.held, counted.last], [2, null]);
});

test('closed by hand with no date, or before the date set: the day it was closed on', () => {
  const closedAt = '2026-10-08T16:00:00+03:00';
  assert.equal(iso(hist(mk('a', {}), mark(P19, closedAt)).last), iso(at(closedAt)));
  const ahead = hist(mk('a', { shoot_at: '2026-10-30T10:00:00+03:00' }), mark(P19, closedAt));
  assert.deepEqual([iso(ahead.last), ahead.next, ahead.held], [iso(at(closedAt)), null, 1]);
});

test('the days are Israel days, whatever the zone of the machine', () => {
  // Shot on 5.10 at 23:30 in Israel (still 5.10 in UTC, 16:30 in New York): one day ago at 00:10 on 6.10.
  const c = mk('a', { shoot_at: '2026-10-05T23:30:00+03:00', rounds: [{ n: 2, shoot_at: '2026-10-07T00:20:00+03:00' }] });
  const r = shootRow({ client: c, state: null, station: null }, { checks: { a: mark(P19, '2026-10-05T23:50:00+03:00') }, now: at('2026-10-06T00:10:00+03:00') });
  assert.deepEqual([r.lastDays, r.nextDays], [1, 1]);
  assert.equal(dayText(r.last), '05.10.26');
  assert.equal(dayText(r.next), '07.10.26');
  assert.deepEqual([0, 1, 2, 12].map(agoText), ['היום', 'אתמול', 'לפני יומיים', 'לפני 12 ימים']);
  assert.deepEqual([0, 1, 2, 9].map(aheadText), ['היום', 'מחר', 'בעוד יומיים', 'בעוד 9 ימים']);
});

// ── The table ────────────────────────────────
const entryOf = (c, checks = {}) => {
  const s = clientState(c, checks, NOW);
  return { client: c, state: s, station: station(c, s, { now: NOW, checks }) };
};
const world = () => {
  const list = [
    // Shot on 5.10 (closed by Lior); the next round on 12.11.
    [mk('ron', { name: 'רון כהן', business: 'מספרת רון', editor: 'nadia', shoot_at: '2026-10-05T10:00:00+03:00', rounds: [{ n: 2, shoot_at: '2026-11-12T10:00:00+02:00' }] }),
      mark(P19, '2026-10-05T15:00:00+03:00')],
    // Imported: shot on 10.3 and on 14.7.
    [mk('gal', { name: 'גליה', business: 'קפה גליה', editor: 'yariv', shoot_type: 'natali', shoot_at: '2026-03-10T10:00:00+02:00', rounds: [{ n: 2, shoot_at: '2026-07-14T10:00:00+03:00' }] }),
      { ...imported('ongoing'), ...imported('ongoing', 'r2.') }],
    // Imported: shot on 2.2, nothing since. The oldest.
    [mk('avi', { name: 'אבי', business: 'אבי מוסך', editor_name: 'עורך חיצוני', shoot_at: '2026-02-02T10:00:00+02:00' }), imported('post')],
    // Imported after its shoot, no date.
    [mk('tal', { name: 'טל', business: 'טל פרחים' }), imported('ongoing')],
    // Never shot: the deal of 1.9, a shoot set for 28.10.
    [mk('dan', { name: 'דן', business: 'דן נדל״ן', deal_at: '2026-09-01T09:00:00+03:00', shoot_at: '2026-10-28T10:00:00+03:00' }), imported('content')],
    // The older deal, of 1.8; its shoot date (12.10) passed: shot (v12), though nobody closed the day.
    [mk('noa', { name: 'נועה', business: '', deal_at: '2026-08-01T09:00:00+03:00', shoot_at: '2026-10-12T10:00:00+03:00', deliverables: {} }), {}],
  ];
  return list.map(([c, checks]) => shootRow(entryOf(c, checks), { checks: { [c.id]: checks }, now: NOW }));
};
const ids = (groups) => groups.map((g) => [g.key, g.rows.map((r) => r.id)]);

test('the default order: the oldest last shoot first, shot-without-a-date after them, and "טרם צולמו" below by the deal date', () => {
  const rows = world();
  assert.deepEqual(DEFAULT_SORT, { key: 'last', dir: 'asc' });
  const groups = shootGroups(rows);
  assert.deepEqual(ids(groups), [['shot', ['avi', 'gal', 'ron', 'noa', 'tal']], ['never', ['dan']]]);
  assert.deepEqual(groups.map((g) => g.title), ['', NEVER_TITLE]);
  // The other way round (a second click): the latest shoot first; "טרם צולמו" stays below, as it was.
  assert.deepEqual(ids(shootGroups(rows, 'last', 'desc')), [['shot', ['noa', 'ron', 'gal', 'avi', 'tal']], ['never', ['dan']]]);
  // Nobody was shot, or everybody: one group, no empty one.
  assert.deepEqual(ids(shootGroups(rows.filter((r) => r.group === 'never'))), [['never', ['dan']]]);
  assert.deepEqual(shootGroups([]), []);
  // The order does not depend on the order the clients arrived in.
  assert.deepEqual(ids(shootGroups([...rows].reverse())), ids(groups));
});

test('a row: the client, who comes to the shoot, the last and the next shoot day, held out of the contract, station, editor', () => {
  const by = Object.fromEntries(world().map((r) => [r.id, r]));
  assert.deepEqual([by.ron.name, by.ron.contact, by.ron.shootType, by.ron.editorName], ['מספרת רון', 'רון כהן', 'דניס, מישל וסמיון', 'נדיה']);
  assert.deepEqual([dayText(by.ron.last), by.ron.lastDays, dayText(by.ron.next), by.ron.nextDays, heldText(by.ron)], ['05.10.26', 15, '12.11.26', 23, '1 מתוך 3']);
  assert.deepEqual([by.gal.shootType, heldText(by.gal), by.gal.next, by.gal.editorName], ['נטלי דדון', '2 מתוך 3', null, 'יריב']);
  assert.deepEqual([by.avi.editorName, by.avi.station !== '', Number.isInteger(by.avi.stationIndex)], ['עורך חיצוני', true, true]);
  assert.deepEqual([by.tal.group, by.tal.last, by.tal.held], ['shot', null, 1]);
  assert.deepEqual([by.dan.group, heldText(by.dan), dayText(by.dan.next), by.dan.unclosed], ['never', '0 מתוך 3', '28.10.26', null]);
  // No business name: the contact's name is the row's name. No quantities entered: no "out of".
  assert.deepEqual([by.noa.name, by.noa.contact, heldText(by.noa), by.noa.unclosed, dayText(by.noa.last), by.noa.next], ['נועה', '', '1', null, '12.10.26', null]);
  assert.deepEqual(SHOOT_COLUMNS.map((c) => c.key), ['name', 'type', 'last', 'held', 'next', 'station', 'editor']);
});

test('sorting by a header: one list, empty values last either way; the search by business or contact', () => {
  const rows = world();
  const flat = (key, dir) => { const g = shootGroups(rows, key, dir); assert.equal(g.length, 1); assert.equal(g[0].title, ''); return g[0].rows.map((r) => r.id); };
  assert.deepEqual(flat('name', 'asc'), ['avi', 'dan', 'tal', 'ron', 'noa', 'gal']);
  assert.deepEqual(flat('name', 'desc'), ['gal', 'noa', 'ron', 'tal', 'dan', 'avi']);
  // The next shoot day: the nearest first; the clients with none set after them, by name.
  assert.deepEqual(flat('next', 'asc'), ['dan', 'ron', 'avi', 'tal', 'noa', 'gal']);
  assert.deepEqual(flat('next', 'desc').slice(0, 2), ['ron', 'dan']);
  assert.deepEqual(flat('held', 'desc')[0], 'gal');
  assert.deepEqual(searchRows(rows, 'קפה').map((r) => r.id), ['gal']);
  assert.deepEqual(searchRows(rows, ' רון ').map((r) => r.id), ['ron']);
  assert.equal(searchRows(rows, '').length, 6);
  assert.equal(searchRows(rows, 'אין כזה').length, 0);
  assert.equal(countText(rows), '6 לקוחות · 5 צולמו · 1 טרם צולמו');
  assert.equal(countText(searchRows(rows, 'קפה')), 'לקוח אחד · 1 צולמו · 0 טרם צולמו');
});

// ── Who sees it ──────────────────────────────
const v = (me, scope = 'office', error = null) => ({ me, scope, error });
test('the screen: Lior, Ofir, Irit (4.11.2026) and the owner; nobody else, and nobody the app could not identify', () => {
  const who = [v(null), v('lior'), v('ofir'), v('irit'), v('ilai'), v('nadia', 'own'), v('nirel', 'own'), v('eli', 'own'), v('stav', 'own')];
  assert.deepEqual(who.map(canSeeShootTable), [true, true, true, true, false, false, false, false, false]);
  assert.equal(canSeeShootTable(v('lior', 'office', new Error('x'))), false);
  assert.equal(canSeeShootTable(null), false);
  // Whoever sees it also opens owner.html, where it lives.
  for (const x of who) if (canSeeShootTable(x)) assert.equal(canSeeTable(x), true);
  for (const x of who) {
    const item = menuOf(x).find((it) => it.id === 'shoot-table');
    assert.deepEqual(item || null, canSeeShootTable(x) ? { id: 'shoot-table', href: 'owner.html#shoots', label: 'טבלת ימי צילום' } : null, x.me || 'owner');
  }
  // The menu marks the table as its own entry, and every other tab of owner.html as before.
  // Lior has "מבט מנהל" since 4.11.2026 (until then "כל הלקוחות במבט", 'overview'); Irit has the table since that day.
  for (const [x, other] of [[v(null), 'manager'], [v('ofir'), 'manager'], [v('lior'), 'manager'], [v('irit'), 'manager']]) {
    const items = menuOf(x);
    assert.deepEqual(currentOf(items, '/owner.html', '#shoots'), { id: 'shoot-table', exact: true });
    for (const hash of ['', '#now', '#all', '#table', '#archive']) assert.deepEqual(currentOf(items, '/owner.html', hash), { id: other, exact: true }, hash);
  }
  assert.deepEqual(currentOf(menuOf(v('ilai', 'own')), '/owner.html', '#shoots'), { id: null, exact: false });
});
