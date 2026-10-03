// The manager's features in the browser's logic: who is a manager and the two
// profiles (app/manager-rules.js), where each one lands (app/office-ui.js
// firstScreenOf), the contract summary (app/contract-summary.js), and the manager
// table: rows, the price columns only for who sees money, filters, sorting and the
// CSV (app/manager-table.js). `npm test` runs this under three time zones.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applicableProcesses, clientState, packageDeliverables } from '../app/protocol-logic.js';
import { importKeys } from '../app/client-open.js';
import { clientHealth, station } from '../app/health.js';
import {
  isManager, canArchive, seesFinance, canSeeTable, modeOf, setMode, modeOfPage, defaultMode, MODES,
} from '../app/manager-rules.js';
import { firstScreenOf } from '../app/office-ui.js';
import { contractSummary, itemText, ITEMS, fileCounts, renewalWindow, ratio } from '../app/contract-summary.js';
import {
  tableRow, columnsFor, filterRows, sortRows, toCsv, filterOptions, DEFAULT_FILTERS, csvName, shootOf,
} from '../app/manager-table.js';

const v = (me, scope = 'office', error = null) => ({ me, scope, error });
const OWNER = v(null);
const at = (s) => new Date(s);
const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, x) => m.set(k, String(x)) }; };

test('the managers: the owner, Irit and Ofir; the prices never for Lior; the owner and Ofir archive', () => {
  const who = [OWNER, v('irit'), v('ofir'), v('lior'), v('ilai', 'own'), v('nadia', 'own'), v('eli', 'own')];
  assert.deepEqual(who.map(isManager), [true, true, true, false, false, false, false]);
  assert.deepEqual(who.map(seesFinance), [true, true, true, false, false, false, false]);
  assert.deepEqual(who.map(canArchive), [true, false, true, false, false, false, false]);
  assert.deepEqual(who.map(canSeeTable), [true, true, true, true, false, false, false]);
  // Someone the app could not identify gets nothing.
  assert.equal(isManager(v(null, 'office', new Error('x'))), false);
  assert.equal(canArchive(v('ofir', 'office', new Error('x'))), false);
  assert.equal(isManager(null), false);
});

test('the two profiles: the owner starts as manager, Irit and Ofir in their own work; the choice is remembered', () => {
  const s = memory();
  assert.equal(modeOf(OWNER, s), 'manager');
  assert.equal(modeOf(v('irit'), s), 'mine');
  assert.equal(modeOf(v('lior'), s), null);
  assert.equal(modeOf(v('nadia', 'own'), s), null);
  setMode('manager', s);
  assert.equal(modeOf(v('ofir'), s), 'manager');
  setMode('nonsense', s);
  assert.equal(modeOf(v('ofir'), s), 'manager');
  setMode('mine', s);
  assert.equal(modeOf(OWNER, s), 'mine');
  assert.equal(defaultMode(OWNER), 'manager');
  // Storage that throws (a locked-down browser): the default.
  const broken = { getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('no'); } };
  assert.equal(modeOf(v('irit'), broken), 'mine');
  setMode('manager', broken);
  assert.deepEqual([MODES.mine.label, MODES.mine.href, MODES.manager.label, MODES.manager.href], ['המשימות שלי', 'clients.html#mine', 'מבט מנהל', 'owner.html#now']);
  assert.equal(modeOfPage('/---/owner.html', '#table', 'mine'), 'manager');
  assert.equal(modeOfPage('/clients.html', '#mine', 'manager'), 'mine');
  assert.equal(modeOfPage('/clients.html', '#clients', 'manager'), 'manager');
  assert.equal(modeOfPage('/qa.html', '', 'mine'), 'mine');
});

test('where each one lands: a manager on the profile chosen, everyone else as before', () => {
  assert.equal(firstScreenOf(null, OWNER), 'owner.html');
  assert.equal(firstScreenOf(null, OWNER, 'manager'), 'owner.html');
  assert.equal(firstScreenOf(null, OWNER, 'mine'), null);
  assert.equal(firstScreenOf('irit', v('irit'), 'mine'), null);
  assert.equal(firstScreenOf('irit', v('irit'), 'manager'), 'owner.html');
  assert.equal(firstScreenOf('ofir', v('ofir'), 'mine'), 'qa.html');
  assert.equal(firstScreenOf('ofir', v('ofir'), 'manager'), 'owner.html');
  // Lior and the editors are not managers: a stored 'manager' changes nothing.
  assert.equal(firstScreenOf('lior', v('lior'), 'manager'), 'decisions.html');
  assert.equal(firstScreenOf('nadia', v('nadia', 'own'), 'manager'), 'editor.html');
});

// ── The contract summary ─────────────────────
// Sunday 11.10.2026: the deal; an imported client in the ongoing station, the shoot held.
const base = {
  id: 'c1', name: 'דנה', business: 'סטודיו דנה', status: 'active', shoot_type: 'dms', characterizer: 'ofir', has_logo: true,
  deal_at: '2026-10-11T09:00:00+03:00', char_at: '2026-10-12T10:00:00+03:00', created_at: '2026-10-11T09:00:00+03:00',
  shoot_at: '2026-10-20T10:00:00+03:00', contract_end: '2027-10-11', rounds: [],
  deliverables: packageDeliverables({ package: { id: 'social-tv-simeon' }, selection: { paid: ['simeon-day'], free: { graphics: 4 } } }),
};
const imported = (c, stationKey) => Object.fromEntries(importKeys(stationKey).map((k) => [k, { state: 'done', note: 'ייבוא', at: '2026-10-25T09:00:00+03:00', by_email: 'irit@x.test' }]));

test('the summary: what the agreement grants against what was done, in words', () => {
  const now = at('2026-11-02T10:00:00+02:00');
  const checks = imported(base, 'publish'); // everything up to publishing: the main shoot's videos approved (27)
  const s = contractSummary(base, clientState(base, checks, now), checks, { now });
  assert.deepEqual(s.items.map((x) => x.key), ['videos', 'graphics', 'shoot_days', 'collabs', 'stories', 'ch14']);
  const videos = s.items.find((x) => x.key === 'videos');
  // 42 videos over 3 shoot days: the main shoot's 14 are approved.
  assert.deepEqual([videos.done, videos.total, videos.left], [14, 42, 28]);
  assert.equal(videos.text, 'בוצעו 14 סרטונים מתוך 42 שבחוזה');
  const shoots = s.items.find((x) => x.key === 'shoot_days');
  assert.deepEqual([shoots.done, shoots.total], [1, 3]);
  assert.equal(shoots.text, 'בוצע יום צילום אחד מתוך 3 שבחוזה');
  assert.equal(s.items.find((x) => x.key === 'collabs').text, 'עוד לא בוצעו קולאבים · 3 בחוזה');
  assert.equal(ratio(s, 'graphics'), '46/46');
  assert.equal(ratio(s, 'monthly'), '');
  assert.equal(s.month.text, 'חודש 1 מתוך 12');
  assert.equal(s.renewal.state, 'later');
  assert.equal(s.empty, false);
});

test('the summary: the most of the protocol, the card\'s counter and uploaded files, never their sum; more than the contract', () => {
  const now = at('2026-10-13T10:00:00+03:00');
  const c = { ...base, deliverables: { ...base.deliverables, done: { videos: 3, collabs: 4 } } };
  const files = fileCounts([
    { client_id: 'c1', kind: 'deliverable_video' }, { client_id: 'c1', kind: 'deliverable_videos' }, { client_id: 'c1', kind: 'deliverable_video', deleted_at: '2026-10-12' },
    { client_id: 'c1', kind: 'deliverable_graphic' }, { client_id: 'c1', kind: 'logo' }, { client_id: 'c2', kind: 'deliverable_video' }, { client_id: 'c1', kind: 'deliverable_unknown' },
  ], 'c1');
  assert.deepEqual(files, { videos: 2, graphics: 1 });
  const s = contractSummary(c, clientState(c, {}, now), {}, { files, now });
  const get = (k) => s.items.find((x) => x.key === k);
  assert.deepEqual(get('videos').sources, { protocol: 0, counter: 3, files: 2 });
  assert.equal(get('videos').done, 3);
  assert.equal(get('graphics').done, 1);
  assert.equal(get('graphics').text, 'בוצעה גרפיקה אחת מתוך 46 שבחוזה');
  assert.equal(get('collabs').text, 'בוצעו 4 קולאבים מתוך 3 שבחוזה (1 מעבר לחוזה)');
  assert.deepEqual([get('collabs').over, get('collabs').left], [1, 0]);
  // Without the files table: null, and the files are not a source.
  assert.equal(contractSummary(c, clientState(c, {}, now), {}, { now }).items[0].sources.files, null);
});

test('the summary: a podcast\'s shoot day with a photographer, Simeon joining, nothing entered', () => {
  const now = at('2026-10-13T10:00:00+03:00');
  const d = packageDeliverables({ package: { id: 'podcast-natali' }, selection: { paid: ['photographer'], free: { simeonJoin: true } } });
  assert.deepEqual([d.shoot_days, d.photo_days, d.simeon_join, d.monthly], [0, 1, 1, 96]);
  const c = { ...base, shoot_type: 'natali', deliverables: d };
  const s = contractSummary(c, clientState(c, {}, now), {}, { now });
  assert.equal(s.items.find((x) => x.key === 'shoot_days').total, 1);
  assert.equal(s.items.find((x) => x.key === 'monthly').text, 'עוד לא בוצעו תכנים מהצלם החודשי · 96 בחוזה');
  assert.deepEqual(s.flags, ['סמיון מצטרף ליום הצילום עם נטלי (ללא קולאב וללא סטוריז)']);
  const none = contractSummary({ ...base, deliverables: {} }, null, {}, { now });
  assert.equal(none.empty, true);
  // Every item has its words.
  for (const it of ITEMS) assert.match(itemText(it, 2, 5), /^בוצעו 2 .+ מתוך 5 שבחוזה$/);
});

test('the renewal window: the 90 days before the end, in Israel days', () => {
  const c = { contract_end: '2027-01-31' };
  assert.equal(renewalWindow(c, at('2026-11-02T00:30:00+02:00')).state, 'open'); // 2.11 in Israel (still 1.11 in UTC): 90 days
  assert.equal(renewalWindow(c, at('2026-11-02T00:30:00+02:00')).text, 'חלון החידוש פתוח · עוד 90 ימים');
  assert.equal(renewalWindow(c, at('2026-11-01T23:30:00+02:00')).state, 'later');
  assert.equal(renewalWindow(c, at('2026-11-01T10:00:00+02:00')).daysLeft, 91);
  assert.equal(renewalWindow(c, at('2026-10-15T10:00:00+03:00')).state, 'later');
  assert.match(renewalWindow(c, at('2026-10-15T10:00:00+03:00')).text, /^נפתח ב־2\.11\.26$/);
  assert.equal(renewalWindow(c, at('2027-01-30T10:00:00+02:00')).text, 'חלון החידוש פתוח · עוד יום אחד');
  assert.equal(renewalWindow(c, at('2027-01-31T20:00:00+02:00')).text, 'חלון החידוש פתוח · החוזה מסתיים היום');
  assert.equal(renewalWindow(c, at('2027-02-01T08:00:00+02:00')).text, 'החוזה הסתיים');
  assert.equal(renewalWindow({}, new Date()), null);
});

// ── The table ────────────────────────────────
const NOW = at('2026-10-20T10:00:00+03:00');
const mk = (id, fields) => ({ ...base, id, ...fields });
const entryOf = (c, checks = {}) => {
  const s = clientState(c, checks, NOW);
  const open = c.status === 'active' || c.status === 'ending';
  return { client: c, state: s, health: open ? clientHealth(c, s, { now: NOW, checks }) : null, station: open ? station(c, s, { now: NOW, checks }) : null };
};
const A = mk('a', { name: 'רון', business: 'מספרת רון', editor: 'nadia', contract_end: '2026-12-01', shoot_at: '2026-10-25T10:00:00+03:00' });
const B = mk('b', { name: 'גליה', business: null, editor: null, editor_name: 'סטודיו חיצוני', package_name: 'Social all in one · נטלי דדון', shoot_type: 'natali' });
const C = mk('c', { name: '=HYPERLINK("x")', business: null, status: 'ended', editor: 'yariv' });
const FIN = { a: { client_id: 'a', monthly_gross_agorot: 578200, term_gross_agorot: 6938400, quote_number: 'Q-2026-0012', signed_at: '2026-10-11T09:05:00+03:00' } };

test('a row per client: the contract, the station, the colour, the next step, the editor, the shoot, X/Y and the renewal', () => {
  const r = tableRow(entryOf(A), { finance: FIN, now: NOW });
  assert.equal(r.name, 'מספרת רון');
  assert.equal(r.contact, 'רון');
  assert.equal(r.editorName, 'נדיה');
  assert.equal(r.monthly, 578200);
  assert.equal(r.quote, 'Q-2026-0012');
  assert.equal(+r.signedAt, +at('2026-10-11T09:05:00+03:00'));
  assert.ok(['red', 'yellow', 'green'].includes(r.color));
  assert.ok(r.station);
  assert.ok(r.step);
  assert.equal(+r.shootAt, +at('2026-10-25T10:00:00+03:00'));
  assert.equal(ratio(r.summary, 'videos'), '0/42');
  assert.equal(r.renewal.state, 'open');
  // Without the prices (Lior): no price at all on the row.
  const lior = tableRow(entryOf(A), { now: NOW });
  assert.equal(lior.monthly, undefined);
  assert.equal(lior.quote, '');
  assert.equal(+lior.signedAt, +at(A.deal_at));
  // An outside editor; an ended client has no colour.
  const b = tableRow(entryOf(B), { now: NOW });
  assert.deepEqual([b.name, b.editor, b.editorName], ['גליה', 'other', 'סטודיו חיצוני']);
  assert.equal(tableRow(entryOf(C), { now: NOW }).color, null);
  assert.equal(+shootOf({ ...A, rounds: [{ n: 2, shoot_at: '2026-10-01T10:00:00+03:00' }] }, NOW), +at('2026-10-25T10:00:00+03:00'));
  assert.equal(+shootOf({ ...A, shoot_at: '2026-10-01T10:00:00+03:00' }, NOW), +at('2026-10-01T10:00:00+03:00'));
});

test('the price columns exist only for who sees money, on screen and in the CSV', () => {
  const keys = (cols) => cols.map((c) => c.key);
  assert.ok(keys(columnsFor(true)).includes('monthly'));
  assert.ok(keys(columnsFor(true)).includes('term'));
  assert.ok(!keys(columnsFor(false)).includes('monthly'));
  assert.ok(!keys(columnsFor(false)).some((k) => /monthly|term|price/.test(k)));
  const rows = [tableRow(entryOf(A), { finance: FIN, now: NOW })];
  const money = toCsv(rows, columnsFor(true));
  assert.match(money, /5,782 ₪|5٬782 ₪|5 782 ₪|"5,782 ₪"/);
  const plain = toCsv(rows, columnsFor(false));
  assert.doesNotMatch(plain, /₪|חודשי|סה״כ/);
});

test('filters, search and sorting; empty values last; the CSV keeps Hebrew and never a formula', () => {
  const rows = [A, B, C].map((c) => tableRow(entryOf(c), { now: NOW }));
  assert.deepEqual(filterRows(rows, DEFAULT_FILTERS).map((r) => r.id), ['a', 'b']);
  assert.deepEqual(filterRows(rows, { ...DEFAULT_FILTERS, status: 'all' }).map((r) => r.id), ['a', 'b', 'c']);
  assert.deepEqual(filterRows(rows, { ...DEFAULT_FILTERS, status: 'ended' }).map((r) => r.id), ['c']);
  assert.deepEqual(filterRows(rows, { ...DEFAULT_FILTERS, editor: 'nadia' }).map((r) => r.id), ['a']);
  assert.deepEqual(filterRows(rows, { ...DEFAULT_FILTERS, editor: 'other' }).map((r) => r.id), ['b']);
  assert.deepEqual(filterRows(rows, { ...DEFAULT_FILTERS, q: 'מספרת' }).map((r) => r.id), ['a']);
  assert.deepEqual(filterRows(rows, { ...DEFAULT_FILTERS, q: ' נטלי  דדון ' }).map((r) => r.id), ['b']);
  assert.deepEqual(filterRows(rows, { ...DEFAULT_FILTERS, station: rows[0].stationKey }).map((r) => r.id).includes('a'), true);
  assert.deepEqual(filterRows(rows, { ...DEFAULT_FILTERS, color: rows[0].color }).map((r) => r.id).includes('a'), true);
  assert.deepEqual(sortRows(rows, 'name').map((r) => r.id), ['c', 'b', 'a'].sort((x, y) => rows.find((r) => r.id === x).name.localeCompare(rows.find((r) => r.id === y).name, 'he')));
  assert.deepEqual(sortRows(rows, 'end', 'asc').map((r) => r.id)[0], 'a');
  // No colour (ended): last, both ways.
  assert.equal(sortRows(rows, 'color', 'asc').at(-1).id, 'c');
  assert.equal(sortRows(rows, 'color', 'desc').at(-1).id, 'c');
  const opts = filterOptions(rows);
  assert.deepEqual(opts.editors.map(([k]) => k).sort(), ['nadia', 'other', 'yariv'].sort());
  assert.equal(opts.stations.length, 8);
  const csv = toCsv(rows, columnsFor(false));
  assert.ok(csv.startsWith('﻿עסק,חבילה,נחתם'));
  assert.match(csv, /'=HYPERLINK\(""x""\)|"'=HYPERLINK\(""x""\)"/);
  assert.equal(csv.split('\r\n').length, rows.length + 2);
  assert.match(csvName(NOW), /^astrateg-clients-2026-10-20\.csv$/);
});
