// Google Calendar → the system (app/gcal-logic.js; the owner's request of 21.10.2026):
// the secret address, reading iCalendar (folded lines, escaped text, UTC, TZID, floating,
// whole days, DST, recurrences), whose meeting it is and what kind, and the suggestion.
// Run under several machine zones by `npm test`: nothing may depend on the device's zone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  googleIcsUrl, unfold, unescapeText, parseIcs, parseWhen, durationMs, wallToDate, cleanZone, occurrences, walkable,
  kindGuess, matchClient, clientScore, googleRows, googleEvent, suggestionOf, suggestionText, WINDOW,
} from '../app/gcal-logic.js';

const URL_OK = 'https://calendar.google.com/calendar/ical/irit.astrateg%40gmail.com/private-0123456789abcdef0123456789abcdef/basic.ics';
const cal = (...events) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Google Inc//Google Calendar 70.9054//EN', 'X-WR-TIMEZONE:Asia/Jerusalem',
  ...events.flatMap((e) => ['BEGIN:VEVENT', ...e, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');
const NOW = new Date('2026-10-21T09:00:00+03:00');
const CLIENTS = [
  { id: 'c1', name: 'דנה לוי', business: 'קפה דנה', status: 'active' },
  { id: 'c2', name: 'רון כהן', business: 'מספרת רון', status: 'active' },
  { id: 'c3', name: 'עומר דיין', business: 'דיין רהיטים', status: 'active' },
  { id: 'c4', name: 'אבי', business: 'מוסך הצפון', status: 'active' },
  { id: 'c5', name: 'שני', business: 'מוסך הדרום', status: 'active' },
];

test('the address: Google\'s secret iCal address only', () => {
  assert.equal(googleIcsUrl(`  ${URL_OK}\n`), URL_OK);
  assert.equal(googleIcsUrl('https://calendar.google.com/calendar/ical/abc%40group.calendar.google.com/private-a1b2c3d4e5f6/basic.ics') !== null, true);
  for (const bad of [
    '', null, 'http://calendar.google.com/calendar/ical/x%40gmail.com/private-0123456789/basic.ics',
    'https://calendar.google.com.evil.com/calendar/ical/x%40gmail.com/private-0123456789/basic.ics',
    'https://evil.com/calendar/ical/x%40gmail.com/private-0123456789/basic.ics',
    'https://calendar.google.com/calendar/ical/x%40gmail.com/public/basic.ics',
    `${URL_OK}?x=1`, `${URL_OK}#a`, 'https://user@calendar.google.com/calendar/ical/x%40gmail.com/private-0123456789/basic.ics',
    'https://calendar.google.com/calendar/ical/../private-0123456789/basic.ics',
    'https://calendar.google.com/calendar/embed?src=x%40gmail.com',
  ]) assert.equal(googleIcsUrl(bad), null, String(bad));
});

test('lines: folded lines are joined, escaped text is read once', () => {
  assert.deepEqual(unfold('SUMMARY:פגישת אפ\r\n יון\r\nLOCATION:a\n\tb'), ['SUMMARY:פגישת אפיון', 'LOCATION:ab']);
  assert.equal(unescapeText('הרצל 10\\, תל אביב\\; קומה 2\\nדלת\\\\n'), 'הרצל 10, תל אביב; קומה 2\nדלת\\n');
  // A fold in the middle of a Hebrew letter's bytes is a fold in the text here: still joined.
  const { events } = parseIcs(cal(['UID:a', 'DTSTART:20261105T080000Z', 'SUMMARY:צילום מספרת\r\n  רון', 'LOCATION:"קפה"\\, הרצל']));
  assert.equal(events[0].summary, 'צילום מספרת רון');
  assert.equal(events[0].location, '"קפה", הרצל');
});

test('times: UTC, TZID=Asia/Jerusalem across the clock change, floating, other zones, whole days', () => {
  assert.equal(wallToDate([2026, 10, 22, 10, 0, 0], 'Asia/Jerusalem').toISOString(), '2026-10-22T07:00:00.000Z'); // summer
  assert.equal(wallToDate([2026, 10, 26, 10, 0, 0], 'Asia/Jerusalem').toISOString(), '2026-10-26T08:00:00.000Z'); // winter (clock moved 25.10)
  assert.equal(wallToDate([2026, 11, 5, 10, 0, 0], 'Europe/London').toISOString(), '2026-11-05T10:00:00.000Z');
  assert.equal(wallToDate([2026, 7, 5, 10, 0, 0], 'America/New_York').toISOString(), '2026-07-05T14:00:00.000Z');
  assert.equal(cleanZone('Israel Standard Time'), 'Asia/Jerusalem');
  assert.equal(cleanZone('Mars/Olympus'), 'Asia/Jerusalem');
  assert.equal(cleanZone('/mozilla.org/20050126_1/Europe/Paris'), 'Europe/Paris');
  assert.deepEqual(parseWhen('20261105'), { day: '2026-11-05', wall: [2026, 11, 5, 0, 0, 0] });
  assert.equal(parseWhen('20261105T100000', { TZID: 'Asia/Jerusalem' }).zone, 'Asia/Jerusalem');
  assert.equal(parseWhen('20261105T100000Z').zone, 'UTC');
  assert.equal(parseWhen('20261105T100000').zone, 'Asia/Jerusalem'); // floating: the calendar's zone
  assert.equal(parseWhen('nonsense'), null);
  assert.equal(durationMs('PT1H30M'), 5400e3);
  assert.equal(durationMs('P1D'), 864e5);
  assert.equal(durationMs('P1W'), 7 * 864e5);
  assert.equal(durationMs('P'), null);
  assert.equal(durationMs('bad'), null);
  const { rows } = googleRows(cal(
    ['UID:z', 'DTSTART:20261105T080000Z', 'DTEND:20261105T090000Z', 'SUMMARY:UTC'],
    ['UID:j', 'DTSTART;TZID=Asia/Jerusalem:20261105T100000', 'DTEND;TZID=Asia/Jerusalem:20261105T120000', 'SUMMARY:ירושלים'],
    ['UID:f', 'DTSTART:20261105T140000', 'DURATION:PT45M', 'SUMMARY:צף'],
    ['UID:d', 'DTSTART;VALUE=DATE:20261106', 'DTEND;VALUE=DATE:20261108', 'SUMMARY:חופש'],
    ['UID:n', 'DTSTART;VALUE=DATE:20261110', 'SUMMARY:יום הולדת'],
  ), { now: NOW });
  const by = Object.fromEntries(rows.map((r) => [r.uid, r]));
  assert.deepEqual([by.z.starts_at, by.z.ends_at, by.z.all_day], ['2026-11-05T08:00:00.000Z', '2026-11-05T09:00:00.000Z', false]);
  assert.deepEqual([by.j.starts_at, by.j.ends_at], ['2026-11-05T08:00:00.000Z', '2026-11-05T10:00:00.000Z']);
  assert.deepEqual([by.f.starts_at, by.f.ends_at], ['2026-11-05T12:00:00.000Z', '2026-11-05T12:45:00.000Z']);
  // Whole days: the start of the first Israel day to the start of the day after the last.
  assert.deepEqual([by.d.starts_at, by.d.ends_at, by.d.all_day], ['2026-11-05T22:00:00.000Z', '2026-11-07T22:00:00.000Z', true]);
  assert.deepEqual([by.n.starts_at, by.n.ends_at], ['2026-11-09T22:00:00.000Z', '2026-11-10T22:00:00.000Z']);
  assert.equal(googleEvent(by.d).allDay, '2026-11-06');
  assert.equal(googleEvent(by.j).end, '2026-11-05T10:00:00.000Z');
  assert.equal(googleEvent(by.j).uid, 'g:j');
});

test('the window: 7 days back to 120 ahead; cancelled events and alarms are not events', () => {
  const { rows, stats } = googleRows(cal(
    ['UID:old', 'DTSTART:20261001T080000Z', 'SUMMARY:ישן'],
    ['UID:back', 'DTSTART:20261015T080000Z', 'SUMMARY:שבוע שעבר'],
    ['UID:far', 'DTSTART:20270301T080000Z', 'SUMMARY:רחוק'],
    ['UID:x', 'DTSTART:20261105T080000Z', 'STATUS:CANCELLED', 'SUMMARY:בוטל'],
    ['UID:al', 'DTSTART:20261105T080000Z', 'SUMMARY:עם תזכורת', 'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:not the summary', 'TRIGGER:-PT10M', 'END:VALARM'],
  ), { now: NOW });
  assert.deepEqual(rows.map((r) => r.uid), ['back', 'al']);
  assert.equal(rows[1].summary, 'עם תזכורת');
  assert.equal(stats.cancelled, 1);
  assert.equal(WINDOW.back, 7);
  assert.equal(WINDOW.ahead, 120);
});

test('recurrences: weekly at the same Israel hour across the clock change, daily with COUNT, EXDATE, a moved one', () => {
  const { rows, stats } = googleRows(cal(
    ['UID:w', 'DTSTART;TZID=Asia/Jerusalem:20261013T090000', 'DTEND;TZID=Asia/Jerusalem:20261013T093000', 'RRULE:FREQ=WEEKLY;UNTIL=20261110T215959Z', 'SUMMARY:ישיבת צוות',
      'EXDATE;TZID=Asia/Jerusalem:20261027T090000'],
    ['UID:w', 'RECURRENCE-ID;TZID=Asia/Jerusalem:20261103T090000', 'DTSTART;TZID=Asia/Jerusalem:20261104T120000', 'DTEND;TZID=Asia/Jerusalem:20261104T123000', 'SUMMARY:ישיבת צוות (הוזזה)'],
    ['UID:dly', 'DTSTART:20261022T050000Z', 'RRULE:FREQ=DAILY;INTERVAL=2;COUNT=3', 'SUMMARY:כל יומיים'],
  ), { now: NOW });
  const weekly = rows.filter((r) => r.uid.startsWith('w#')).map((r) => [r.uid, r.starts_at]);
  assert.deepEqual(weekly, [
    ['w#20261020T060000Z', '2026-10-20T06:00:00.000Z'],   // 09:00 summer time
    ['w#20261103T070000Z', '2026-11-04T10:00:00.000Z'],   // moved to Wednesday 12:00, under its own id
    ['w#20261110T070000Z', '2026-11-10T07:00:00.000Z'],   // 09:00 winter time
  ]);
  assert.ok(!rows.some((r) => r.uid === 'w#20261013T060000Z'), 'more than 7 days back');
  assert.deepEqual(rows.filter((r) => r.uid.startsWith('dly#')).map((r) => r.starts_at), ['2026-10-22T05:00:00.000Z', '2026-10-24T05:00:00.000Z', '2026-10-26T05:00:00.000Z']);
  assert.equal(stats.recurring, 2);
  // A cancelled occurrence is gone.
  const off = googleRows(cal(
    ['UID:w', 'DTSTART;TZID=Asia/Jerusalem:20261022T090000', 'RRULE:FREQ=WEEKLY;COUNT=2', 'SUMMARY:ש'],
    ['UID:w', 'RECURRENCE-ID;TZID=Asia/Jerusalem:20261029T090000', 'DTSTART;TZID=Asia/Jerusalem:20261029T090000', 'STATUS:CANCELLED', 'SUMMARY:ש'],
  ), { now: NOW });
  assert.equal(off.rows.length, 1);
});

test('recurrences: weekly BYDAY, whole-day yearly, and what is not walked keeps its first occurrence', () => {
  const e = parseIcs(cal(['UID:b', 'DTSTART;TZID=Asia/Jerusalem:20261025T080000', 'RRULE:FREQ=WEEKLY;BYDAY=SU,TU,TH;COUNT=5', 'SUMMARY:x'])).events[0];
  const days = occurrences(e, new Date('2027-01-01')).map((w) => w.slice(0, 3).join('-'));
  assert.deepEqual(days, ['2026-10-25', '2026-10-27', '2026-10-29', '2026-11-1', '2026-11-3']);
  const { rows, stats } = googleRows(cal(
    ['UID:y', 'DTSTART;VALUE=DATE:20101102', 'DTEND;VALUE=DATE:20101103', 'RRULE:FREQ=YEARLY', 'SUMMARY:יום הולדת לעירית'],
    ['UID:m', 'DTSTART:20261023T080000Z', 'RRULE:FREQ=MONTHLY;BYDAY=2MO', 'SUMMARY:חודשי מסובך'],
  ), { now: NOW });
  assert.deepEqual(rows.filter((r) => r.uid.startsWith('y#')).map((r) => [r.uid, r.starts_at]), [['y#20261102', '2026-11-01T22:00:00.000Z']]);
  assert.deepEqual(rows.filter((r) => r.uid.startsWith('m#')).map((r) => r.starts_at), ['2026-10-23T08:00:00.000Z']);
  assert.equal(stats.unwalked, 1);
  assert.equal(walkable({ FREQ: 'WEEKLY', BYDAY: 'MO,WE' }), true);
  assert.equal(walkable({ FREQ: 'MONTHLY', BYMONTHDAY: '15' }), false);
  assert.equal(walkable({ FREQ: 'HOURLY' }), false);
  // A month without the 31st has no occurrence.
  const m31 = parseIcs(cal(['UID:31', 'DTSTART:20261031T080000Z', 'RRULE:FREQ=MONTHLY;COUNT=3', 'SUMMARY:x'])).events[0];
  assert.deepEqual(occurrences(m31, new Date('2027-12-01')).map((w) => w.slice(0, 3).join('-')), ['2026-10-31', '2026-12-31', '2027-1-31']);
});

test('what kind: אפיון, צילום, יום צילום; a Zoom or anything else is neither', () => {
  assert.equal(kindGuess('פגישת אפיון - קפה דנה'), 'char');
  assert.equal(kindGuess('זום אפיון עם רון'), 'char');
  assert.equal(kindGuess('יום צילום מספרת רון'), 'shoot');
  assert.equal(kindGuess('צילומים אצל דיין'), 'shoot');
  assert.equal(kindGuess('לצילום'), 'shoot');
  assert.equal(kindGuess('זום תסריטים'), null);
  assert.equal(kindGuess('רופא שיניים'), null);
});

test('whose: the business or the contact in the title, with a Hebrew prefix; two equal fits are none', () => {
  assert.deepEqual(matchClient('פגישת אפיון - קפה דנה', CLIENTS)?.id, 'c1');
  assert.deepEqual(matchClient('צילום לקפה דנה', CLIENTS)?.id, 'c1');
  assert.deepEqual(matchClient('יום צילום מספרת רון', CLIENTS)?.id, 'c2');
  assert.deepEqual(matchClient('אפיון עם עומר דיין', CLIENTS)?.id, 'c3');
  assert.deepEqual(matchClient('פגישה', CLIENTS, 'דיין רהיטים, הרצל 3')?.id, 'c3');
  assert.equal(matchClient('אפיון קפה', CLIENTS), null, 'a part of a name is not enough');
  assert.equal(matchClient('צילום מוסך', CLIENTS), null);
  assert.equal(matchClient('רופא שיניים', CLIENTS), null);
  assert.equal(matchClient('אפיון קפהדנה', CLIENTS)?.id, 'c1', 'the same letters, other spaces');
  // Two clients that fit as well: none.
  const twins = [{ id: 'a', business: 'פיצה נאפולי' }, { id: 'b', business: 'נאפולי פיצה' }];
  assert.equal(matchClient('צילום פיצה נאפולי', twins), null);
  assert.equal(clientScore('', CLIENTS[0]), 0);
  const { rows } = googleRows(cal(['UID:k', 'DTSTART;TZID=Asia/Jerusalem:20261105T100000', 'SUMMARY:פגישת אפיון\\, קפה דנה']), { clients: CLIENTS, now: NOW });
  assert.deepEqual([rows[0].client_id, rows[0].kind_guess, rows[0].summary], ['c1', 'char', 'פגישת אפיון, קפה דנה']);
});

test('the suggestion: a coming meeting or shoot day of a client that the system does not hold', () => {
  const row = (fields) => ({ uid: 'u', starts_at: '2026-11-05T08:00:00.000Z', all_day: false, client_id: 'c1', kind_guess: 'char', dismissed_at: null, ...fields });
  const c = (fields) => ({ id: 'c1', name: 'דנה לוי', business: 'קפה דנה', status: 'active', char_at: null, shoot_at: null, rounds: [], ...fields });
  const s = suggestionOf(row(), c(), { now: NOW });
  assert.equal(s.kind, 'char');
  assert.equal(s.at.toISOString(), '2026-11-05T08:00:00.000Z');
  assert.equal(suggestionText(s, c()), 'לקבוע במערכת כפגישת אפיון של קפה דנה?');
  assert.equal(suggestionText({ kind: 'shoot' }, c()), 'לקבוע במערכת כיום צילום של קפה דנה?');
  // The same day already: nothing; another coming day: moved; a meeting already held: nothing.
  assert.equal(suggestionOf(row(), c({ char_at: '2026-11-05T15:00:00+02:00' }), { now: NOW }), null);
  assert.equal(suggestionOf(row(), c({ char_at: '2026-11-02T10:00:00+02:00' }), { now: NOW }).kind, 'char');
  assert.equal(suggestionOf(row(), c({ char_at: '2026-10-12T10:00:00+03:00' }), { now: NOW }), null);
  // Answered "לא קשור", past, a whole day, no client, another kind, an ended client.
  assert.equal(suggestionOf(row({ dismissed_at: '2026-10-21T08:00:00Z' }), c(), { now: NOW }), null);
  assert.equal(suggestionOf(row({ starts_at: '2026-10-20T08:00:00Z' }), c(), { now: NOW }), null);
  assert.equal(suggestionOf(row({ all_day: true }), c(), { now: NOW }), null);
  assert.equal(suggestionOf(row({ client_id: null }), c(), { now: NOW }), null);
  assert.equal(suggestionOf(row({ kind_guess: null }), c(), { now: NOW }), null);
  assert.equal(suggestionOf(row(), c({ status: 'ended' }), { now: NOW }), null);
  assert.equal(suggestionOf(row(), null, { now: NOW }), null);
  // A shoot day: none set, another coming day, the same day, a later round on that day, already shot.
  const sh = row({ kind_guess: 'shoot' });
  assert.equal(suggestionOf(sh, c(), { now: NOW }).kind, 'shoot');
  assert.equal(suggestionOf(sh, c({ shoot_at: '2026-11-09T10:00:00+02:00' }), { now: NOW }).kind, 'shoot');
  assert.equal(suggestionOf(sh, c({ shoot_at: '2026-11-05T09:00:00+02:00' }), { now: NOW }), null);
  assert.equal(suggestionOf(sh, c({ shoot_at: '2026-10-10T09:00:00+03:00', rounds: [{ n: 2, shoot_at: '2026-11-05T12:00:00+02:00' }] }), { now: NOW }), null);
  assert.equal(suggestionOf(sh, c({ shoot_at: '2026-10-10T09:00:00+03:00' }), { now: NOW }), null);
});
