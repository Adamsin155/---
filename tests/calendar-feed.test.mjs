// The personal calendar feed: the iCalendar text (app/ics.js) is valid RFC 5545
// (CRLF, 75-octet folding that never cuts a Hebrew letter, escaping, UTC and
// all-day times, stable UIDs, DTSTAMP and SEQUENCE), and each person's feed
// (app/calendar-feed.js) holds only their own work on the clients they may see,
// with the address only for those who go there and never a client's phone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCalendar, eventLines, escapeText, foldLine, utcStamp, dateValue, nextDateValue, sequenceOf,
} from '../app/ics.js';
import {
  feedEvents, feedUrl, webcalUrl, googleAddUrl, tokenFrom, visibleTo, feedName, FEED_TOKEN,
} from '../app/calendar-feed.js';
import { applicableProcesses } from '../app/protocol-logic.js';

const NOW = new Date('2026-10-20T10:00:00+03:00'); // Tuesday
const octets = (s) => new TextEncoder().encode(s).length;

// A small RFC 5545 reader: unfolds, checks the frame and returns the events' properties.
function parse(ics) {
  assert.ok(ics.endsWith('\r\n'), 'ends with CRLF');
  assert.ok(!/[^\r]\n/.test(ics), 'every line ends with CRLF');
  const physical = ics.slice(0, -2).split('\r\n');
  for (const l of physical) assert.ok(octets(l) <= 75, `longer than 75 octets: ${l}`);
  const lines = ics.slice(0, -2).replace(/\r\n /g, '').split('\r\n');
  assert.equal(lines[0], 'BEGIN:VCALENDAR');
  assert.equal(lines.at(-1), 'END:VCALENDAR');
  assert.ok(lines.includes('VERSION:2.0') && lines.some((l) => l.startsWith('PRODID:')));
  const events = [];
  let cur = null;
  for (const l of lines) {
    if (l === 'BEGIN:VEVENT') { assert.equal(cur, null, 'nested event'); cur = {}; continue; }
    if (l === 'END:VEVENT') { events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = l.indexOf(':');
    cur[l.slice(0, i)] = l.slice(i + 1);
  }
  assert.equal(cur, null, 'unclosed event');
  for (const e of events) {
    for (const k of ['UID', 'DTSTAMP', 'SEQUENCE', 'SUMMARY']) assert.ok(k in e, `${k} missing`);
    assert.match(e.DTSTAMP, /^\d{8}T\d{6}Z$/);
    assert.ok(e.DTSTART || e['DTSTART;VALUE=DATE']);
  }
  return events;
}
const unescape = (s) => s.replace(/\\n/g, '\n').replace(/\\([\\;,])/g, '$1');

test('ics: escaping, folding at 75 octets without cutting a letter, UTC and all-day values', () => {
  assert.equal(escapeText('a,b;c\\d\ne\r\nf\u0007'), 'a\\,b\\;c\\\\d\\ne\\nf');
  assert.equal(utcStamp('2026-10-25T01:30:00+03:00'), '20261024T223000Z');
  assert.equal(dateValue('2026-12-31'), '20261231');
  assert.equal(nextDateValue('2026-12-31'), '20270101');
  assert.equal(nextDateValue('2028-02-28'), '20280229');
  assert.throws(() => dateValue('31.12.2026'));
  // Hebrew (2 octets a letter) and an emoji (4): every physical line within 75, joined back exactly.
  const long = `SUMMARY:${'יום צילום במספרה של רון 😀 '.repeat(8)}`;
  const folded = foldLine(long);
  const parts = folded.split('\r\n');
  assert.ok(parts.length > 3);
  assert.ok(parts.every((p, i) => octets(p) <= 75 && (i === 0 || p.startsWith(' '))));
  assert.equal(parts.map((p, i) => (i ? p.slice(1) : p)).join(''), long);
  assert.ok(!folded.includes('�'));
  assert.equal(foldLine('short'), 'short');
  // SEQUENCE grows with the last change; never negative.
  assert.equal(sequenceOf('2026-01-01T00:10:00Z'), 10);
  assert.ok(sequenceOf('2026-10-02T00:00:00Z') > sequenceOf('2026-10-01T00:00:00Z'));
  assert.equal(sequenceOf('2025-01-01T00:00:00Z'), 0);
  assert.equal(sequenceOf(null), 0);
});

test('ics: a calendar with a timed and an all-day event is valid, with the feed headers', () => {
  const ics = buildCalendar({
    name: 'אסטרטג · ליאור', now: NOW,
    events: [
      { uid: 'shoot-x-1@astrateg', title: 'יום צילום · מספרת רון, תל אביב', start: '2026-10-22T10:00:00+03:00', minutes: 390, location: 'הרצל 10, תל אביב', description: 'שורה 1\nשורה 2', changedAt: '2026-10-19T08:00:00Z' },
      { uid: 'task 7/x', title: 'משימה', allDay: '2026-10-25' },
    ],
  });
  const [a, b] = parse(ics);
  assert.match(ics, /\r\nX-WR-CALNAME:אסטרטג · ליאור\r\n/);
  assert.match(ics, /\r\nREFRESH-INTERVAL;VALUE=DURATION:PT60M\r\n/);
  assert.equal(a.UID, 'shoot-x-1@astrateg');
  assert.equal(a.DTSTAMP, '20261020T070000Z');
  assert.equal(a.DTSTART, '20261022T070000Z');
  assert.equal(a.DTEND, '20261022T133000Z');
  assert.equal(unescape(a.SUMMARY), 'יום צילום · מספרת רון, תל אביב');
  assert.equal(unescape(a.DESCRIPTION), 'שורה 1\nשורה 2');
  assert.equal(unescape(a.LOCATION), 'הרצל 10, תל אביב');
  assert.equal(a.SEQUENCE, String(sequenceOf('2026-10-19T08:00:00Z')));
  assert.equal(a['LAST-MODIFIED'], '20261019T080000Z');
  assert.equal(a.TRANSP, 'OPAQUE');
  // All day: a DATE and the next day as the (exclusive) end; the UID made safe.
  assert.equal(b['DTSTART;VALUE=DATE'], '20261025');
  assert.equal(b['DTEND;VALUE=DATE'], '20261026');
  assert.equal(b.UID, 'task-7-x');
  assert.equal(b.TRANSP, 'TRANSPARENT');
  // A one-event file (app/calendar.js) has no calendar name or refresh.
  assert.ok(!buildCalendar({ feed: false, events: [] }).includes('X-WR-CALNAME'));
  assert.throws(() => eventLines({ title: 'no uid', start: NOW }));
});

// ── The feed ───────────────────────────────
const client = (id, fields) => ({
  id, name: '', address: null, phone: '050-7654321', shoot_type: 'dms', characterizer: 'ofir', editor: null,
  deal_at: '2026-10-01T09:00:00+03:00', char_at: null, shoot_at: null, contract_end: '2027-10-01', status: 'active',
  rounds: [], deliverables: {}, links: {}, created_at: '2026-10-01T09:00:00+03:00', updated_at: '2026-10-19T09:00:00+03:00', ...fields,
});
const doneAll = (c, ids, at) => Object.fromEntries(applicableProcesses(c).filter((p) => ids.includes(p.id))
  .flatMap((p) => p.items.filter((i) => !i.optional).map((i) => [i.key, { state: 'done', at, note: null, by_email: 'x@astrateg.test' }])));
const EARLY = ['p01', 'p02', 'p03', 'p04', 'p05', 'p06', 'p07', 'p07b', 'p08', 'p08b', 'p09', 'p10'];

// Ron: meeting today (Ofir), shoot on Sunday 25.10 (Denis, Michel and Semion), a second
// round in 40 days (beyond Eli's window), editing Nadia's, a Zoom set for tomorrow.
const A = client('aaaaaaaa-0000-4000-8000-000000000001', {
  name: 'מספרת רון', address: 'הרצל 10, תל אביב', char_at: '2026-10-20T12:00:00+03:00', shoot_at: '2026-10-25T11:00:00+02:00',
  editor: 'nadia', rounds: [{ n: 2, shoot_at: '2026-11-29T10:00:00+02:00', shoot_type: 'natali', editor: 'nadia' }],
});
// Galia: shot last week; editing Yariv's, assigned yesterday.
const B = client('bbbbbbbb-0000-4000-8000-000000000002', { name: 'קפה גליה', shoot_at: '2026-10-14T10:00:00+03:00', editor: 'yariv', char_at: '2026-10-05T10:00:00+03:00' });
// Dana: ended; nothing of hers is in any feed.
const C = client('cccccccc-0000-4000-8000-000000000003', { name: 'סטודיו דנה', status: 'ended', shoot_at: '2026-10-22T10:00:00+03:00' });
const checks = {
  [A.id]: { ...doneAll(A, ['p01', 'p02', 'p03'], '2026-10-02T10:00:00+03:00'), 'p13.zoomat': { state: 'done', note: '2026-10-21T15:00:00+03:00', at: '2026-10-19T12:00:00+03:00' } },
  [B.id]: {
    ...doneAll(B, [...EARLY, 'p11', 'p11b', 'p12a', 'p12', 'p13', 'p14', 'p15', 'p16', 'p17', 'p17b', 'p18', 'p18b', 'p19', 'p19b', 'p21'], '2026-10-14T18:00:00+03:00'),
    'p22a.drive': { state: 'done', at: '2026-10-19T09:00:00+03:00' }, 'p22a.load': { state: 'done', at: '2026-10-19T09:00:00+03:00' },
    'p22a.assigned': { state: 'done', at: '2026-10-19T09:30:00+03:00' },
  },
};
const tasks = [
  { id: 't1', client_id: A.id, owner: 'nadia', title: 'לוגו חדש, בגרסה לבנה', due_on: '2026-10-22', done_at: null, created_at: '2026-10-19T10:00:00+03:00', urgent: false },
  { id: 't2', client_id: A.id, owner: 'lior', title: 'להתקשר ללקוח', due_on: '2026-10-21', done_at: null, created_at: '2026-10-19T10:00:00+03:00', urgent: true },
  { id: 't3', client_id: A.id, owner: 'nadia', title: 'בוצע', due_on: '2026-10-19', done_at: '2026-10-19T12:00:00+03:00', created_at: '2026-10-18T10:00:00+03:00' },
  { id: 't4', client_id: C.id, owner: 'anna', title: 'משימה בלקוח שהסתיים', due_on: '2026-10-21', done_at: null, created_at: '2026-10-19T10:00:00+03:00' },
];
const feed = (person) => feedEvents({ person, clients: [A, B, C], checks, tasks: tasks.filter((t) => t.owner === person), now: NOW });
const kinds = (person) => feed(person).map((e) => `${e.kind}:${e.uid.split('@')[0]}`);

test('feed: shoot days for Lior, Eli (his window only), Irit and the owner; the address only for those who go', () => {
  const shoot = (person) => feed(person).filter((e) => e.kind === 'shoot');
  // Galia's, last week, stays (30 days back); Ron's second round is 40 days ahead.
  const all = [`shoot-${B.id}-1@astrateg`, `shoot-${A.id}-1@astrateg`, `shoot-${A.id}-2@astrateg`];
  assert.deepEqual(shoot('lior').map((e) => e.uid), all);
  assert.deepEqual(shoot('eli').map((e) => e.uid), all.slice(0, 2));
  assert.deepEqual(shoot('irit').map((e) => e.uid), all);
  assert.equal(shoot('owner').length, 3);
  for (const p of ['ofir', 'ilai', 'nadia', 'yariv', 'nirel']) assert.equal(shoot(p).length, 0, p);
  const [, ron] = shoot('eli');
  // The team an hour before the influencers; 5.5 hours with Denis, Michel and Semion.
  assert.equal(ron.start.toISOString(), '2026-10-25T08:00:00.000Z');
  assert.equal(ron.minutes, 390);
  assert.equal(ron.title, 'יום צילום · מספרת רון · דניס, מישל וסמיון');
  assert.equal(ron.location, 'הרצל 10, תל אביב');
  // Eli's entry names his own time, an hour before the shoot time (the owner's rule of 7.10.2026).
  assert.match(ron.description, /^ההגעה שלך: 10:00, שעה לפני הצילום\. המשפיענים מגיעים ב־11:00\.$/m);
  assert.match(shoot('lior')[1].description, /הגעת המשפיענים: 11:00\. הצוות מגיע שעה לפני\./);
  assert.equal(shoot('lior')[1].start.toISOString(), ron.start.toISOString());
  assert.equal(shoot('irit')[1].location, 'הרצל 10, תל אביב');
  assert.equal(shoot('owner')[1].location, '');
  assert.equal(shoot('lior')[2].title, 'יום צילום 2 · מספרת רון · נטלי דדון');
  assert.equal(shoot('lior')[2].minutes, 240);
});

test('feed: the meeting for its characterizer (with the address) and the owner; the Zoom for Lior', () => {
  const char = (person) => feed(person).filter((e) => e.kind === 'char');
  assert.deepEqual(char('ofir').map((e) => [e.title, e.location, e.minutes]), [['פגישת אפיון · קפה גליה', '', 120], ['פגישת אפיון · מספרת רון', 'הרצל 10, תל אביב', 120]]);
  assert.deepEqual(char('owner').map((e) => e.location), ['', '']);
  for (const p of ['lior', 'irit', 'eli', 'nadia']) assert.equal(char(p).length, 0, p);
  // Lior characterizes when Ofir cannot: then it is his.
  const withLior = feedEvents({ person: 'lior', clients: [{ ...A, characterizer: 'lior' }], checks, now: NOW });
  assert.equal(withLior.filter((e) => e.kind === 'char').length, 1);
  assert.equal(withLior.find((e) => e.kind === 'char').location, 'הרצל 10, תל אביב');
  const zoom = feed('lior').filter((e) => e.kind === 'zoom');
  assert.deepEqual(zoom.map((e) => [e.title, e.start.toISOString(), e.minutes]), [['זום לאישור התסריטים · מספרת רון', '2026-10-21T12:00:00.000Z', 60]]);
  assert.equal(feed('ofir').filter((e) => e.kind === 'zoom').length, 0);
  // The client approved the scripts on the status page: the Zoom is 'na', and leaves the calendar.
  const approved = { ...checks, [A.id]: { ...checks[A.id], 'p13.zoom': { state: 'na', note: 'אושר בדף המצב', at: '2026-10-20T09:00:00+03:00' } } };
  assert.equal(feedEvents({ person: 'lior', clients: [A, B, C], checks: approved, now: NOW }).filter((e) => e.kind === 'zoom').length, 0);
});

test('feed: deadlines of one\'s own open processes: the editor\'s editing, never someone else\'s client', () => {
  const yariv = feed('yariv').filter((e) => e.kind === 'due');
  const ids = yariv.map((e) => e.uid.replace(`due-${B.id}-`, '').replace('-yariv@astrateg', ''));
  // Editing (22) and handing to Ofir (24): 3 business days from the assignment (Thursday
  // 22.10, end of day: all day); closing (27) on day 4.
  assert.deepEqual(ids, ['p22', 'p24', 'p27']);
  assert.equal(yariv[0].allDay, '2026-10-22');
  assert.match(yariv[0].title, /^יעד: 22 עריכת הסרטונים · קפה גליה$/);
  assert.match(yariv[0].description, /• התקבל הכונן/);
  assert.match(yariv[0].description, new RegExp(`client\\.html\\?id=${B.id}#p22`));
  // Nadia edits Ron (not Galia) and has no deadline there yet; Anna and Nirel see nothing.
  assert.equal(feed('nadia').filter((e) => e.kind === 'due').length, 0);
  assert.deepEqual(feed('anna'), []);
  assert.equal(feed('owner').filter((e) => e.kind === 'due').length, 0);
  // Irit's own: setting Ron's shoot day, and her part of Galia's editing (22א).
  const irit = feed('irit').filter((e) => e.kind === 'due').map((e) => e.uid);
  assert.ok(irit.some((u) => u.includes(`${A.id}-p11-irit`)), irit.join());
  assert.ok(!irit.some((u) => u.includes(C.id)));
  // The meeting and shoot-day processes are events, not deadlines.
  assert.ok(!feed('ofir').some((e) => e.kind === 'due' && /-p04-/.test(e.uid)));
  assert.ok(!feed('lior').some((e) => e.kind === 'due' && /-p(17|18|19|20|21)-/.test(e.uid)));
});

test('feed: open tasks with a due day, all day; recurring office work; nothing of an ended client; no phone', () => {
  assert.deepEqual(feed('nadia').filter((e) => e.kind === 'task').map((e) => [e.title, e.allDay]), [['משימה: לוגו חדש, בגרסה לבנה · מספרת רון', '2026-10-22']]);
  assert.deepEqual(feed('lior').filter((e) => e.kind === 'task').map((e) => e.title), ['דחוף: להתקשר ללקוח · מספרת רון']);
  // Ofir's Thursday summary (13:00) for 8 weeks, skipping days off; Lior's Tuesday campaigns check.
  const thu = feed('ofir').filter((e) => e.kind === 'weekly');
  assert.ok(thu.length >= 7 && thu.length <= 8);
  assert.equal(thu[0].end.toISOString(), '2026-10-22T10:00:00.000Z');
  assert.equal(thu[0].title, 'סיכום חמישי: יעד 13:00');
  const tue = feed('lior').filter((e) => e.kind === 'weekly');
  assert.equal(tue[0].allDay, '2026-10-20');
  for (const p of ['owner', 'irit', 'lior', 'ofir', 'ilai', 'nadia', 'yariv', 'anna', 'eli', 'nirel']) {
    const all = JSON.stringify(feed(p));
    assert.ok(!all.includes('050-7654321'), `${p}: a client's phone`);
    assert.ok(!all.includes(C.id) && !all.includes('סטודיו דנה'), `${p}: an ended client`);
  }
  // Sorted by time; every UID is unique.
  for (const p of ['owner', 'lior', 'irit']) {
    const uids = feed(p).map((e) => e.uid);
    assert.equal(new Set(uids).size, uids.length, p);
  }
  assert.ok(kinds('lior').length > 5);
});

test('feed: who sees which client follows the database\'s rule', () => {
  assert.equal(visibleTo('irit', B, [], NOW), true);
  assert.equal(visibleTo('nadia', A, [], NOW), true);
  assert.equal(visibleTo('nadia', B, [], NOW), false);
  assert.equal(visibleTo('nadia', B, [{ client_id: B.id, owner: 'nadia', done_at: '2026-10-01T10:00:00+03:00' }], NOW), true);
  assert.equal(visibleTo('nadia', B, [{ client_id: B.id, owner: 'nadia', done_at: '2026-09-01T10:00:00+03:00' }], NOW), false);
  assert.equal(visibleTo('nirel', { ...B, shoot_type: 'natali' }, [], NOW), true);
  assert.equal(visibleTo('eli', B, [], NOW), true); // shot 6 days ago
  assert.equal(visibleTo('eli', { ...B, shoot_at: '2026-10-12T10:00:00+03:00' }, [], NOW), false); // 8 days ago
  assert.equal(visibleTo('editor', A, [], NOW), false);
  assert.equal(visibleTo('stranger', A, [], NOW), false);
  assert.equal(feedName('owner'), 'אסטרטג · הבעלים');
  assert.equal(feedName('lior'), 'אסטרטג · ליאור');
});

test('feed: the whole feed as iCalendar is valid, and the link helpers', () => {
  const events = parse(buildCalendar({ name: feedName('lior'), events: feed('lior'), now: NOW }));
  assert.equal(events.length, feed('lior').length);
  const token = 'ab'.repeat(32);
  assert.ok(FEED_TOKEN.test(token));
  const url = feedUrl('https://czncjzziqrqtezpwxxpz.supabase.co/', token);
  assert.equal(url, `https://czncjzziqrqtezpwxxpz.supabase.co/functions/v1/calendar?t=${token}`);
  assert.equal(webcalUrl(url), `webcal://czncjzziqrqtezpwxxpz.supabase.co/functions/v1/calendar?t=${token}`);
  assert.equal(new URL(googleAddUrl(url)).searchParams.get('cid'), webcalUrl(url));
  assert.equal(tokenFrom(url), token);
  assert.equal(tokenFrom(`https://x.supabase.co/functions/v1/calendar/${token}.ics`), token);
  assert.equal(tokenFrom(`https://x.supabase.co/functions/v1/calendar?t=${token.toUpperCase()}`), token);
  for (const bad of ['https://x.supabase.co/functions/v1/calendar', `https://x.supabase.co/functions/v1/calendar?t=${token}0`, 'not a url', `https://x/calendar?t=${'z'.repeat(64)}`]) {
    assert.equal(tokenFrom(bad), null, bad);
  }
});
