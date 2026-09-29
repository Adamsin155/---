// The client messages center (app/messages-logic.js): which message each client
// gets today. Milestones, the Thursday update, notices of delay, one message per
// Israel day, closed clients, and the templates (the same text as the migration's
// seed). `npm test` runs this under UTC, America/New_York and Asia/Jerusalem.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STATIONS } from '../app/protocol.js';
import { applicableProcesses, clientState, WAIT, waitNote, IMPORT_NOTE } from '../app/protocol-logic.js';
import { importKeys } from '../app/client-open.js';
import {
  suggestFor, dayQueue, stationOf, sentToday, promisedClosing, templatesByKey, fillTemplate, unfilledIn,
  unknownVars, messageText, waLink, groupLink, canSendMessages, DEFAULT_TEMPLATES, templateVars, listText,
  materialsOf, thursdayVars, protocolCheckOf,
} from '../app/messages-logic.js';

const at = (s) => new Date(s);
const iso = (d) => (d ? d.toISOString() : null);
const T = templatesByKey();
// Monday 12.10.2026 is the characterization; Israel is on summer time (+03:00) until 25.10.
const base = {
  id: 'c1', name: 'דנה', business: 'סטודיו דנה', phone: '050-1234567', status: 'active', shoot_type: 'dms',
  characterizer: 'ofir', has_logo: true, address: 'הרצל 10, תל אביב',
  deal_at: '2026-10-11T09:00:00+03:00', char_at: '2026-10-12T10:00:00+03:00',
};
// Every required item of the given processes, as this client has them.
const keysFor = (c, ids) => applicableProcesses(c).filter((p) => ids.includes(p.id))
  .flatMap((p) => p.items.filter((i) => !i.optional).map((i) => i.key));
const done = (c, ids, when, note = null) => Object.fromEntries(keysFor(c, ids).map((k) => [k, { state: 'done', at: when, note }]));
const item = (key, when, note = null) => ({ [key]: { state: 'done', at: when, note } });
const sent = (key, when, extra = {}) => ({ kind: 'milestone', template_key: key, ref: key, sent_at: when, ...extra });
const suggest = (c, checks, msgs, now) => suggestFor(c, checks, msgs, at(now));
const kinds = (s) => s.options.map((o) => `${o.kind}:${o.ref || o.key}`);
// History brought in by an import: never a milestone.
const imported = (c, stationKey) => Object.fromEntries(importKeys(stationKey).map((k) => [k, { state: 'done', at: '2026-10-01T09:00:00+03:00', note: IMPORT_NOTE }]));

test('welcome after the group opens: team, next three dates, what we need, Thursday; once, while fresh', () => {
  const checks = item('p02.opened', '2026-10-11T09:10:00+03:00');
  const s = suggest(base, checks, [], '2026-10-11T10:00:00+03:00');
  assert.deepEqual(kinds(s), ['milestone:welcome', 'daily:daily.join']);
  assert.equal(s.options[0].reason, 'הקבוצה נפתחה היום');
  const text = messageText(s.options[0], T);
  assert.match(text, /^היי דנה, ברוכים הבאים לאסטרטג!/);
  for (const line of ['ליאור: מנהל הלקוח', 'עירית: תפעול ולקוחות', 'אופיר: אפיון העסק', 'עילאי: גרפיקה']) assert.ok(text.includes(line), line);
  assert.ok(text.includes('פגישת האפיון: יום ב׳ 12.10 בשעה 10:00'));
  assert.ok(text.includes('עמוד מסודר ו־9 גרפיקות ראשונות לאישור: ביום האפיון, יום ב׳ 12.10'));
  assert.ok(text.includes('קביעת יום הצילום: עד יום ה׳ 15.10'), 'promise ה4: 3 business days from the meeting');
  assert.match(text, /לוגו, צבעי המותג/);
  assert.match(text, /בכל יום חמישי תקבלו מאיתנו עדכון קצר/);
  assert.deepEqual(unfilledIn(text), []);

  // Sent today: nothing more today.
  const today = suggest(base, checks, [sent('welcome', '2026-10-11T10:05:00+03:00')], '2026-10-11T16:00:00+03:00');
  assert.equal(today.sent.template_key, 'welcome');
  assert.deepEqual(today.options, []);
  // Before the meeting is set (no dates yet): sent once, not again; unsent, it
  // stays 2 business days and no longer.
  const early = { ...base, char_at: null };
  assert.match(messageText(suggest(early, checks, [], '2026-10-11T10:00:00+03:00').options[0], T), /פגישת האפיון: נתאם איתכם מועד בשעות הקרובות[\s\S]*קביעת יום הצילום: עד 3 ימי עסקים אחרי האפיון/);
  assert.deepEqual(kinds(suggest(early, checks, [sent('welcome', '2026-10-11T10:05:00+03:00')], '2026-10-12T09:00:00+03:00')), ['daily:daily.join']);
  assert.equal(suggest(early, checks, [], '2026-10-13T09:00:00+03:00').options[0].key, 'welcome');
  assert.equal(suggest(early, checks, [], '2026-10-14T09:00:00+03:00').options[0].key, 'daily.join');
  // Imported history is not a milestone.
  assert.deepEqual(kinds(suggest(early, item('p02.opened', '2026-10-11T09:10:00+03:00', IMPORT_NOTE), [], '2026-10-11T10:00:00+03:00')), ['daily:daily.join']);
});

test('after the characterization: "התקבלו X מתוך Y" first, then "מה הבנו על העסק"', () => {
  const checks = {
    ...done(base, ['p01', 'p02', 'p03'], '2026-10-11T09:10:00+03:00'),
    ...done(base, ['p04'], '2026-10-12T11:30:00+03:00'),
    ...item('p05.access', '2026-10-12T11:00:00+03:00'), ...item('p05.logo', '2026-10-12T11:00:00+03:00'),
  };
  const welcome = sent('welcome', '2026-10-11T10:05:00+03:00');
  const s = suggest(base, checks, [welcome], '2026-10-12T15:00:00+03:00');
  assert.deepEqual(kinds(s), ['milestone:access', 'milestone:summary', 'daily:daily.char']);
  assert.equal(s.options[0].reason, 'האפיון הסתיים היום. התקבלו 2 מתוך 5 חומרים');
  const text = messageText(s.options[0], T);
  assert.match(text, /התקבלו 2 מתוך 5\.\nעוד חסר: צבעי המותג, תמונות וסרטונים קיימים\./);
  assert.match(text, /את הגישות לרשתות לא שולחים בהודעה/);
  // The next day, with the materials message sent: the summary, with places to fill by hand.
  const next = suggest(base, checks, [welcome, sent('access', '2026-10-12T15:05:00+03:00')], '2026-10-13T09:30:00+03:00');
  assert.equal(next.options[0].key, 'summary');
  const summary = messageText(next.options[0], T);
  assert.match(summary, /זה מה שהבנו על סטודיו דנה:/);
  assert.deepEqual(unfilledIn(summary), ['[להשלים]']);
  // Everything received: no materials message.
  const all = { ...checks, ...done(base, ['p05'], '2026-10-12T12:00:00+03:00') };
  assert.deepEqual(kinds(suggest(base, all, [welcome], '2026-10-12T15:00:00+03:00')), ['milestone:summary', 'daily:daily.char']);
  assert.deepEqual(materialsOf(all), { got: 5, of: 5, missing: [] });
});

test('scripts ready and not approved yet: "תסריטים לאישור"', () => {
  const before = { ...imported(base, 'content'), ...done(base, ['p11'], '2026-10-13T12:00:00+03:00') };
  const checks = { ...before, ...done(base, ['p12a', 'p12'], '2026-10-14T12:00:00+03:00') };
  const s = suggest(base, checks, [], '2026-10-14T16:00:00+03:00');
  assert.equal(s.options[0].key, 'scripts');
  assert.match(messageText(s.options[0], T), /התסריטים ליום הצילום מוכנים![\s\S]*לא מצלמים שום דבר שלא אישרתם/);
  const approved = { ...checks, ...item('p13.zoom', '2026-10-14T13:00:00+03:00'), ...item('p13.approved', '2026-10-14T13:30:00+03:00') };
  assert.ok(!suggest(base, approved, [], '2026-10-14T16:00:00+03:00').options.some((o) => o.key === 'scripts'));
});

test('the day before the shoot: on the business day before (Thursday for a Sunday shoot), before the Thursday update', () => {
  const c = { ...base, shoot_at: '2026-10-18T11:00:00+03:00' };
  const checks = imported(c, 'shoot');
  const thu = suggest(c, checks, [], '2026-10-15T10:00:00+03:00');
  assert.deepEqual(kinds(thu), ['milestone:eve', 'thursday:thursday', 'daily:daily.shoot']);
  assert.equal(thu.options[0].reason, 'יום הצילום ביום א׳ 18.10 ב־11:00');
  const text = messageText(thu.options[0], T);
  assert.match(text, /מתי: יום א׳ 18\.10\. הצוות מגיע ב־10:00, והמשפיענים ב־11:00\./);
  assert.match(text, /איפה: הרצל 10, תל אביב/);
  assert.match(text, /מי מגיע: ליאור \(מנהל יום הצילום\), אלי \(הצלם\) והמשפיענים דניס, מישל וסמיון/);
  assert.match(text, /מה להכין:/);
  assert.deepEqual(unfilledIn(text), []);
  // Not on Wednesday; on Friday the office is closed.
  assert.ok(!suggest(c, checks, [], '2026-10-14T10:00:00+03:00').options.some((o) => o.key === 'eve'));
  assert.equal(suggest(c, checks, [], '2026-10-16T10:00:00+03:00').dayOff, true);
  // A shoot on Wednesday: the eve is Tuesday. Without an address, it has to be filled in.
  const wed = { ...c, shoot_at: '2026-10-14T09:30:00+03:00', address: null, shoot_type: 'natali' };
  const tue = suggest(wed, checks, [], '2026-10-13T12:00:00+03:00');
  assert.equal(tue.options[0].key, 'eve');
  assert.equal(tue.options[0].reason, 'יום הצילום מחר, יום ד׳ 14.10 ב־09:30');
  assert.match(messageText(tue.options[0], T), /ונטלי דדון/);
  assert.deepEqual(unfilledIn(messageText(tue.options[0], T)), ['{כתובת}']);
});

test('thanks after the shoot, from the next business day, with the date promised (ה8)', () => {
  const c = { ...base, shoot_at: '2026-10-13T11:00:00+03:00' };
  const checks = { ...imported(c, 'shoot'), ...done(c, ['p19'], '2026-10-13T18:00:00+03:00') };
  assert.ok(!suggest(c, checks, [], '2026-10-13T19:00:00+03:00').options.some((o) => o.key === 'thanks'), 'not on the shoot day');
  const s = suggest(c, checks, [], '2026-10-14T10:00:00+03:00');
  assert.equal(s.options[0].key, 'thanks');
  // 5 business days starting the business day after the shoot: Wed, Thu, Sun, Mon, Tue.
  assert.equal(s.options[0].vars['תאריך'], 'יום ג׳ 20.10');
  assert.match(messageText(s.options[0], T), /הסרטונים יהיו סגורים עד יום ג׳ 20\.10, כולל סבב תיקונים\.[\s\S]*מ־1 עד 5/);
  assert.equal(iso(promisedClosing('2026-10-13T11:00:00+03:00')), iso(at('2026-10-20T23:59:59.999+03:00')));
  // Over a weekend and Yom Kippur (Monday 21.9): Sun 20, Tue 22, Wed 23, Thu 24, Sun 27.
  assert.equal(iso(promisedClosing('2026-09-17T10:00:00+03:00')), iso(at('2026-09-27T23:59:59.999+03:00')));
  // Across the move to winter time: a shoot on Thursday 22.10 closes on Thursday 29.10 (+02:00).
  assert.equal(iso(promisedClosing('2026-10-22T10:00:00+03:00')), iso(at('2026-10-29T23:59:59.999+02:00')));
});

test('videos sent: "סבב תיקונים 1 מתוך 1"; first post; campaign live', () => {
  // Shot on Thursday 8.10: promised closed by Thursday 15.10.
  const c = { ...base, shoot_at: '2026-10-08T11:00:00+03:00' };
  const checks = { ...imported(c, 'post'), ...item('p25.approved', '2026-10-12T10:00:00+03:00'), ...item('p26.sent', '2026-10-12T12:00:00+03:00') };
  const s = suggest(c, checks, [], '2026-10-12T14:00:00+03:00');
  assert.equal(s.options[0].key, 'videos');
  assert.match(messageText(s.options[0], T), /סבב 1 מתוך 1[\s\S]*סגור עד יום ה׳ 15\.10/);
  const approved = { ...checks, ...item('p27.approved', '2026-10-12T13:00:00+03:00') };
  assert.ok(!suggest(c, approved, [], '2026-10-12T14:00:00+03:00').options.some((o) => o.key === 'videos'));

  const pub = { ...imported(c, 'publish'), ...done(c, ['p28'], '2026-10-14T11:00:00+03:00'), ...done(c, ['p30'], '2026-10-14T12:00:00+03:00') };
  const both = suggest(c, pub, [], '2026-10-14T15:00:00+03:00');
  assert.deepEqual(kinds(both).slice(0, 2), ['milestone:first_post', 'milestone:campaign']);
  assert.match(messageText(both.options[0], T), /הפוסט הראשון שלכם עלה!/);
  assert.match(messageText(both.options[1], T), /הקמפיין שלכם באוויר!/);
  // The gantt sent to the client also counts as the first post going up.
  const gantt = { ...imported(c, 'publish'), ...item('p29.sent', '2026-10-14T11:00:00+03:00') };
  assert.equal(suggest(c, gantt, [], '2026-10-14T15:00:00+03:00').options[0].key, 'first_post');
  // Next day, after the first post went out: the campaign.
  assert.equal(suggest(c, pub, [sent('first_post', '2026-10-14T15:05:00+03:00')], '2026-10-15T09:00:00+03:00').options[0].key, 'campaign');
});

test('Thursday: the update in three lines from the system\'s data replaces the daily message; a milestone comes first', () => {
  // The meeting was on Sunday 11.10, so no promise falls due this Thursday.
  const c = { ...base, deal_at: '2026-10-11T08:00:00+03:00', char_at: '2026-10-11T10:00:00+03:00' };
  const checks = {
    ...done(c, ['p01', 'p02', 'p03'], '2026-10-11T08:30:00+03:00'),
    ...done(c, ['p04'], '2026-10-11T11:30:00+03:00'),
    ...item('p05.access', '2026-10-11T11:00:00+03:00'), ...item('p05.logo', '2026-10-11T11:00:00+03:00'),
    ...item('p07.sent', '2026-10-12T12:00:00+03:00'), ...item('p11.influencers', '2026-10-13T12:00:00+03:00'),
  };
  const msgs = [sent('welcome', '2026-10-11T09:00:00+03:00'), sent('access', '2026-10-12T15:00:00+03:00'), sent('summary', '2026-10-13T10:00:00+03:00')];
  const s = suggest(c, checks, msgs, '2026-10-15T10:00:00+03:00');
  assert.deepEqual(kinds(s), ['thursday:thursday', 'daily:daily.content']);
  const text = messageText(s.options[0], T);
  assert.equal(text, [
    'היי דנה, העדכון השבועי שלנו:',
    'מה עשינו השבוע: פתחנו את קבוצת העבודה, קבענו את פגישת האפיון וקיימנו את פגישת האפיון.',
    'מה הלאה: קביעת יום הצילום ושיחת דגשים לתוכן.',
    'מה צריך מכם: צבעי המותג, תמונות, סרטונים קיימים, אישור על 9 הגרפיקות הראשונות ואישור מועד ליום הצילום.',
    'סוף שבוע נעים!',
  ].join('\n'));
  // Another day: the daily message.
  assert.deepEqual(kinds(suggest(c, checks, msgs, '2026-10-18T10:00:00+03:00')), ['daily:daily.content']);
  // Thursday with a milestone: the milestone first, the update as an option.
  const withScripts = { ...checks, ...done(c, ['p12a', 'p12'], '2026-10-15T09:00:00+03:00') };
  assert.deepEqual(kinds(suggest(c, withScripts, msgs, '2026-10-15T10:00:00+03:00')).slice(0, 2), ['milestone:scripts', 'thursday:thursday']);
  // Nothing done this week that the client would see: a place to fill by hand; the coming shoot is next.
  const later = { ...base, char_at: '2026-10-01T10:00:00+03:00', shoot_at: '2026-10-20T10:00:00+03:00' };
  const quietChecks = imported(later, 'content');
  const quiet = thursdayVars(later, quietChecks, clientState(later, quietChecks, at('2026-10-15T10:00:00+03:00')), at('2026-10-15T10:00:00+03:00'));
  assert.equal(quiet['עשינו'], '[מה עשינו השבוע]');
  assert.match(quiet['הלאה'], /^יום הצילום ביום ג׳ 20\.10/);
  assert.equal(quiet['צריך'], 'כרגע כלום. אם עולה שאלה, כתבו לנו');
  // An ongoing client: the content keeps going up.
  const ongoing = imported(base, 'ongoing');
  const o = thursdayVars(base, ongoing, clientState(base, ongoing, at('2026-10-15T10:00:00+03:00')), at('2026-10-15T10:00:00+03:00'));
  assert.equal(o['עשינו'], 'התכנים שלכם המשיכו לעלות לפי הגאנט');
  assert.equal(o['הלאה'], 'השיחה השבועית והמשך התכנים לפי הגאנט');
});

test('a notice of delay: on the promised date, or a business day before it when the office is behind; never after it', () => {
  // Shot on Tuesday 6.10 and handed to the editor on Wednesday 7.10: the videos
  // are promised closed by Tuesday 13.10 (ה8); editing is due Monday 12.10.
  const c = { ...base, shoot_at: '2026-10-06T11:00:00+03:00' };
  const checks = { ...imported(c, 'post'), ...done(c, ['p22a'], '2026-10-07T10:00:00+03:00') };
  const msgs = [sent('thanks', '2026-10-07T10:00:00+03:00')];
  // Monday, the day before, with editing on time: an option after the daily message, with a word on the card's reason.
  const mon = suggest(c, checks, msgs, '2026-10-12T10:00:00+03:00');
  assert.deepEqual(kinds(mon), ['daily:daily.post', 'delay:p27']);
  assert.equal(mon.options[1].reason, 'הבטחנו את סגירת הסרטונים עד יום ג׳ 13.10, וזה עוד לא הושלם');
  // Tuesday, the date itself (before its end): the notice leads the day.
  const tue = suggest(c, checks, msgs, '2026-10-13T09:00:00+03:00');
  assert.deepEqual(kinds(tue), ['delay:p27', 'daily:daily.post']);
  const text = messageText(tue.options[0], T);
  assert.match(text, /לגבי סגירת הסרטונים: זה ייקח קצת יותר זמן[\s\S]*במקום יום ג׳ 13\.10, זה יהיה מוכן עד \[מועד חדש\]/);
  assert.deepEqual(unfilledIn(text), ['[מועד חדש]']);
  // Two business days before, and after the date: none.
  assert.ok(!suggest(c, checks, msgs, '2026-10-11T10:00:00+03:00').options.some((o) => o.kind === 'delay'));
  assert.ok(!suggest(c, checks, msgs, '2026-10-14T09:00:00+03:00').options.some((o) => o.kind === 'delay'));
  // The office is behind (editing, due Sunday 11.10, is not done): it leads already on Monday.
  const late = { ...imported(c, 'post'), ...done(c, ['p19', 'p22a'], '2026-10-06T19:00:00+03:00') };
  assert.deepEqual(kinds(suggest(c, late, msgs, '2026-10-12T10:00:00+03:00')), ['delay:p27', 'daily:daily.post']);
  // Quality control passed an hour ago and the videos are about to go out (26 is due at once): not behind.
  const qa = { ...checks, ...done(c, ['p22', 'p24', 'p25'], '2026-10-12T09:00:00+03:00') };
  // (The campaigns, promised a business day after quality control, are an option too.)
  assert.deepEqual(kinds(suggest(c, qa, msgs, '2026-10-12T10:00:00+03:00')), ['daily:daily.post', 'delay:p27', 'delay:p30']);
  // Once per promise.
  const noticed = [...msgs, { kind: 'delay', template_key: 'delay', ref: 'p27', sent_at: '2026-10-12T10:05:00+03:00' }];
  assert.ok(!suggest(c, checks, noticed, '2026-10-13T09:00:00+03:00').options.some((o) => o.kind === 'delay'));

  // Closed in time, or waiting on the client: no notice.
  const none = (ch, now = '2026-10-13T09:00:00+03:00') => assert.ok(!suggest(c, ch, msgs, now).options.some((o) => o.kind === 'delay'), now);
  none({ ...checks, ...done(c, ['p22', 'p24', 'p25', 'p26', 'p27'], '2026-10-11T12:00:00+03:00') });
  none({ ...checks, [WAIT({ id: 'p27' })]: { state: 'done', at: '2026-10-11T12:00:00+03:00', note: waitNote('ממתינים להערות', null) } });
  // The videos are with the client and no notes came back yet.
  const withClient = { ...checks, ...done(c, ['p22', 'p24', 'p25', 'p26'], '2026-10-08T12:00:00+03:00') };
  none(withClient);
  // Everything is done but the client's approval.
  none({ ...withClient, ...item('p27.final', '2026-10-09T12:00:00+03:00'), ...item('p27.toilai', '2026-10-09T12:05:00+03:00') });
  // The client's notes came back and the fixes are ours: a notice.
  const notes = { ...withClient, ...item('p27.notes', '2026-10-09T12:00:00+03:00') };
  assert.equal(suggest(c, notes, msgs, '2026-10-13T09:00:00+03:00').options[0].ref, 'p27');
  // The videos were not sent to the client yet: ours.
  assert.equal(suggest(c, { ...checks, ...done(c, ['p22', 'p24', 'p25'], '2026-10-08T12:00:00+03:00') }, msgs, '2026-10-13T09:00:00+03:00').options[0].ref, 'p27');

  // The shoot day (ה4): three business days from the meeting on Monday 12.10 → Thursday 15.10.
  // The scripts (ה5) have the same date; the content call was due Tuesday 13.10 and is late.
  const content = imported(base, 'content');
  const wed = suggest(base, content, [], '2026-10-14T10:00:00+03:00');
  assert.deepEqual(kinds(wed), ['delay:p12', 'daily:daily.content', 'delay:p11']);
  assert.equal(wed.options[0].vars['תאריך'], 'יום ה׳ 15.10');
  // Everyone confirmed the date but the client: the date is theirs to approve.
  const oks = ['p11.influencers', 'p11.ok.influencers', 'p11.ok.lior', 'p11.ok.photographer'].reduce((a, k) => ({ ...a, ...item(k, '2026-10-13T12:00:00+03:00') }), {});
  assert.deepEqual(kinds(suggest(base, { ...content, ...oks }, [], '2026-10-14T10:00:00+03:00')), ['delay:p12', 'daily:daily.content']);
  // Without the photographer's confirmation, it is still ours.
  const { 'p11.ok.photographer': _, ...noPhotographer } = oks;
  assert.ok(suggest(base, { ...content, ...noPhotographer }, [], '2026-10-14T10:00:00+03:00').options.some((o) => o.ref === 'p11'));
});

test('one proactive message per Israel day: 00:30 in Israel (21:30 UTC) is already the next day', () => {
  const checks = item('p02.opened', '2026-10-12T20:00:00+03:00');
  const now = '2026-10-12T21:30:00Z'; // Tuesday 13.10, 00:30 in Israel
  const lastNight = { kind: 'daily', template_key: 'daily.join', ref: null, sent_at: '2026-10-12T20:50:00Z' }; // Monday 23:50
  const justNow = { kind: 'daily', template_key: 'daily.join', ref: null, sent_at: '2026-10-12T21:10:00Z' }; // Tuesday 00:10
  const s = suggest(base, checks, [lastNight], now);
  assert.equal(s.sent, null);
  assert.equal(s.options[0].key, 'welcome');
  const t = suggest(base, checks, [lastNight, justNow], now);
  assert.equal(t.sent, justNow);
  assert.deepEqual(t.options, []);
  assert.equal(sentToday([lastNight, justNow], at(now)), justNow);
  assert.equal(sentToday([lastNight], at(now)), null);
  // After the move to winter time (+02:00): 00:30 on Monday 26.10 is 22:30 UTC on Sunday.
  const winter = { kind: 'daily', template_key: 'daily.join', ref: null, sent_at: '2026-10-25T21:50:00Z' }; // Sunday 23:50
  assert.equal(sentToday([winter], at('2026-10-25T22:30:00Z')), null);
  assert.equal(sentToday([winter], at('2026-10-25T21:59:00Z')), winter);
});

test('closed clients get nothing; nobody gets anything on a day off', () => {
  for (const status of ['ended', 'cancelled']) assert.equal(suggest({ ...base, status }, {}, [], '2026-10-13T10:00:00+03:00'), null, status);
  const ending = suggest({ ...base, status: 'ending' }, imported(base, 'ongoing'), [], '2026-10-13T10:00:00+03:00');
  assert.deepEqual(kinds(ending), ['daily:daily.renewal']);
  for (const day of ['2026-10-16T10:00:00+03:00', '2026-10-17T10:00:00+03:00', '2026-09-21T10:00:00+03:00']) {
    const s = suggest(base, item('p02.opened', day), [], day);
    assert.equal(s.dayOff, true, day);
    assert.deepEqual(s.options, []);
  }
});

test('the daily message follows the client\'s station, also for an imported client', () => {
  const now = '2026-10-13T10:00:00+03:00';
  assert.deepEqual(kinds(suggest({ ...base, char_at: null }, {}, [], now)), ['daily:daily.join']);
  // The meeting's time came: the characterization station.
  assert.equal(STATIONS[suggest(base, {}, [], now).station].key, 'char');
  // Imported at each station (with the meeting and the shoot still ahead).
  const ahead = { ...base, char_at: '2026-10-20T10:00:00+03:00', shoot_at: '2026-10-27T11:00:00+03:00' };
  STATIONS.slice(0, 7).forEach((st, i) => {
    const checks = imported(ahead, st.key);
    assert.equal(stationOf(ahead, clientState(ahead, checks, at(now)), at(now)), i, st.key);
  });
  // The shoot day itself is still the shoot station; once the day is closed, editing.
  const shot = { ...base, shoot_at: '2026-10-13T08:00:00+03:00' };
  const onTheDay = imported(shot, 'shoot');
  assert.equal(STATIONS[stationOf(shot, clientState(shot, onTheDay, at(now)), at(now))].key, 'shoot');
  const closed = { ...onTheDay, ...done(shot, ['p19'], '2026-10-13T09:30:00+03:00') };
  assert.equal(STATIONS[stationOf(shot, clientState(shot, closed, at(now)), at(now))].key, 'post');

  const c = { ...base, shoot_at: '2026-10-06T11:00:00+03:00', char_at: '2026-09-29T10:00:00+03:00' };
  const post = suggest(c, imported(c, 'post'), [], now);
  assert.equal(post.options.at(-1).key, 'daily.post');
  assert.equal(messageText(post.options.at(-1), T), 'היי דנה, הסרטונים שלכם בעריכה. נשלח לכם אותם לאישור, והכול יהיה סגור עד יום ג׳ 13.10.');
  // The day after the promised date, it is not repeated: the message without a date.
  const after = suggest(c, imported(c, 'post'), [], '2026-10-14T10:00:00+03:00');
  assert.deepEqual(kinds(after), ['daily:daily.post_nodate']);
  assert.equal(messageText(after.options[0], T), 'היי דנה, הסרטונים שלכם בעריכה ואנחנו על זה. נעדכן אתכם ברגע שהם מוכנים.');
  assert.match(after.options[0].reason, /מועד הסגירה שהבטחנו \(יום ג׳ 13\.10\) כבר עבר, ולכן בלי תאריך/);
  assert.deepEqual(unfilledIn(messageText(after.options[0], T)), []);
  // Sixty days before the contract ends: the renewal station, and the renewal message.
  const renew = { ...c, contract_end: '2026-12-10' };
  const r = suggest(renew, imported(renew, 'ongoing'), [], now);
  assert.equal(STATIONS[r.station].key, 'renewal');
  assert.equal(r.options[0].key, 'renewal');
  assert.match(messageText(r.options[0], T), /ביום ה׳ 10\.12, מסתיימת שנת העבודה שלנו יחד/);
  // Work checked late in one go does not greet a client who is already in editing.
  const late = { ...imported(c, 'post'), ...item('p02.opened', '2026-10-13T09:00:00+03:00') };
  assert.ok(!suggest(c, late, [], now).options.some((o) => o.key === 'welcome'));
});

test('an extra shoot round has its own milestones', () => {
  const c = {
    ...base, shoot_at: '2026-09-01T10:00:00+03:00',
    rounds: [{ n: 2, start_at: '2026-10-01T09:00:00+03:00', shoot_at: '2026-10-13T11:00:00+03:00', shoot_type: 'dms' }],
  };
  const checks = { ...imported(c, 'ongoing'), ...done(c, ['r2-p19'], '2026-10-13T17:00:00+03:00') };
  for (const k of keysFor(c, ['r2-p19'])) assert.match(k, /^r2\./);
  const s = suggest(c, checks, [], '2026-10-14T10:00:00+03:00');
  assert.equal(s.options[0].ref, 'r2.thanks');
  assert.equal(s.options[0].reason, 'יום הצילום הסתיים. הסרטונים סגורים עד יום ג׳ 20.10 (סבב צילום 2)');
  assert.equal(STATIONS[s.station].key, 'post');
  // The first round's thanks went out long ago; this one is new.
  assert.equal(suggest(c, checks, [sent('thanks', '2026-09-02T10:00:00+03:00')], '2026-10-14T10:00:00+03:00').options[0].ref, 'r2.thanks');
});

test('a promised date that already passed is never repeated: videos sent late leave the date to write', () => {
  // Shot on Tuesday 6.10: promised closed by Tuesday 13.10; the videos went out on Wednesday 14.10.
  const c = { ...base, shoot_at: '2026-10-06T11:00:00+03:00' };
  const checks = { ...imported(c, 'post'), ...item('p25.approved', '2026-10-14T09:00:00+03:00'), ...item('p26.sent', '2026-10-14T10:00:00+03:00') };
  const s = suggest(c, checks, [], '2026-10-14T11:00:00+03:00');
  assert.equal(s.options[0].key, 'videos');
  assert.equal(s.options[0].vars['תאריך'], undefined);
  assert.deepEqual(unfilledIn(messageText(s.options[0], T)), ['{תאריך}']);
  assert.equal(s.options[0].reason, 'הסרטונים נשלחו ללקוח היום. מועד הסגירה שהבטחנו (יום ג׳ 13.10) כבר עבר: כותבים מועד חדש');
  // The shoot day closed in the card only after the promised date: the thanks too.
  const thanks = { ...imported(c, 'shoot'), ...done(c, ['p19'], '2026-10-14T09:00:00+03:00') };
  const t = suggest(c, thanks, [], '2026-10-14T11:00:00+03:00');
  assert.equal(t.options[0].key, 'thanks');
  assert.deepEqual(unfilledIn(messageText(t.options[0], T)), ['{תאריך}']);
  assert.match(t.options[0].reason, /^יום הצילום הסתיים\. מועד הסגירה שהבטחנו \(יום ג׳ 13\.10\) כבר עבר/);
});

test('the shoot day passed but is not closed in the card: no "the shoot day is coming"', () => {
  const c = { ...base, shoot_at: '2026-10-13T11:00:00+03:00' };
  const checks = imported(c, 'shoot');
  // On the day itself, the shoot station's message.
  assert.deepEqual(kinds(suggest(c, checks, [], '2026-10-13T08:00:00+03:00')), ['daily:daily.shoot']);
  // The next day, with process 19 still open: editing's message, and a word to close 19.
  const s = suggest(c, checks, [], '2026-10-14T10:00:00+03:00');
  assert.equal(STATIONS[s.station].key, 'shoot');
  assert.deepEqual(kinds(s), ['daily:daily.post']);
  assert.equal(messageText(s.options[0], T), 'היי דנה, הסרטונים שלכם בעריכה. נשלח לכם אותם לאישור, והכול יהיה סגור עד יום ג׳ 20.10.');
  assert.match(s.options[0].reason, /יום הצילום היה אתמול ועוד לא נסגר בכרטיס \(תהליך 19\)/);
  // A week and more later, past the promised date too: without a date.
  const late = suggest(c, checks, [], '2026-10-21T10:00:00+03:00');
  assert.deepEqual(kinds(late), ['daily:daily.post_nodate']);
  assert.deepEqual(unfilledIn(messageText(late.options[0], T)), []);
});

test('the welcome lists only dates still ahead', () => {
  const checks = item('p02.opened', '2026-10-13T09:10:00+03:00');
  const now = '2026-10-13T10:00:00+03:00';
  // The meeting was last week and its 3-day deadline for the shoot day passed too: none of them is listed.
  const past = suggest({ ...base, char_at: '2026-10-05T10:00:00+03:00' }, checks, [], now);
  assert.equal(past.options[0].key, 'welcome');
  const text = messageText(past.options[0], T);
  assert.doesNotMatch(text, /5\.10|8\.10/);
  assert.deepEqual(unfilledIn(text), ['[התאריכים הקרובים]']);
  // The meeting passed, the shoot day is set and ahead: only the shoot.
  const shoot = messageText(suggest({ ...base, char_at: '2026-10-05T10:00:00+03:00', shoot_at: '2026-10-20T11:00:00+03:00' }, checks, [], now).options[0], T);
  assert.match(shoot, /התאריכים הקרובים:\nיום הצילום: יום ג׳ 20\.10 בשעה 11:00\n\n/);
  // The meeting was this morning: the deadline for the shoot day is still ahead.
  const morning = messageText(suggest({ ...base, char_at: '2026-10-13T08:00:00+03:00' }, checks, [], now).options[0], T);
  // Tuesday 08:00 + 3 business days: Wednesday, Thursday, Sunday.
  assert.match(morning, /התאריכים הקרובים:\nקביעת יום הצילום: עד יום א׳ 18\.10\n\n/);
  assert.deepEqual(unfilledIn(morning), []);
});

test('a message the protocol already checked is not suggested again; sending one checks it', () => {
  // The intro of process 2 was sent (and checked) before the queue: no welcome.
  const opened = item('p02.opened', '2026-10-13T09:10:00+03:00');
  const now = '2026-10-13T10:00:00+03:00';
  assert.equal(suggest(base, opened, [], now).options[0].key, 'welcome');
  assert.deepEqual(kinds(suggest(base, { ...opened, ...item('p02.intro', '2026-10-13T09:20:00+03:00') }, [], now)), ['daily:daily.char']);
  // The reminder of process 15 went out: no day-before message.
  const c = { ...base, shoot_at: '2026-10-18T11:00:00+03:00' };
  const checks = imported(c, 'shoot');
  assert.equal(suggest(c, checks, [], '2026-10-15T10:00:00+03:00').options[0].key, 'eve');
  assert.ok(!suggest(c, { ...checks, ...item('p15.client', '2026-10-15T09:00:00+03:00') }, [], '2026-10-15T10:00:00+03:00').options.some((o) => o.key === 'eve'));
  // In an extra shoot round, that round's reminder.
  const r = { ...base, shoot_at: '2026-09-01T10:00:00+03:00', rounds: [{ n: 2, start_at: '2026-10-01T09:00:00+03:00', shoot_at: '2026-10-18T11:00:00+03:00', shoot_type: 'dms' }] };
  const rc = imported(r, 'ongoing');
  assert.equal(suggest(r, rc, [], '2026-10-15T10:00:00+03:00').options[0].ref, 'r2.eve');
  assert.ok(!suggest(r, { ...rc, ...item('r2.p15.client', '2026-10-15T09:00:00+03:00') }, [], '2026-10-15T10:00:00+03:00').options.some((o) => o.key === 'eve'));
  // The item each message checks when it is sent from the queue.
  assert.equal(protocolCheckOf({ key: 'welcome', ref: 'welcome' }), 'p02.intro');
  assert.equal(protocolCheckOf({ template_key: 'eve', ref: 'eve' }), 'p15.client');
  assert.equal(protocolCheckOf({ template_key: 'eve', ref: 'r2.eve' }), 'r2.p15.client');
  for (const key of ['thanks', 'daily.join', 'thursday', 'delay']) assert.equal(protocolCheckOf({ key, ref: null }), null, key);
});

test('a later milestone already sent makes an earlier one moot', () => {
  const checks = {
    ...done(base, ['p01', 'p02', 'p03'], '2026-10-11T09:10:00+03:00'),
    ...done(base, ['p04'], '2026-10-12T11:30:00+03:00'),
    ...done(base, ['p12a', 'p12'], '2026-10-13T11:00:00+03:00'),
  };
  const s = suggest(base, checks, [sent('scripts', '2026-10-13T12:00:00+03:00')], '2026-10-14T09:00:00+03:00');
  assert.ok(!s.options.some((o) => ['welcome', 'access', 'summary'].includes(o.key)), JSON.stringify(kinds(s)));
});

test('the day\'s queue: what to send first, those done today last, closed clients out', () => {
  const now = '2026-10-13T10:00:00+03:00';
  const a = { ...base, id: 'a', name: 'א' };
  const b = { ...base, id: 'b', name: 'ב' };
  const d = { ...base, id: 'd', name: 'ד' };
  const e = { ...base, id: 'e', name: 'ה', status: 'ended' };
  const q = dayQueue([d, a, b, e], { b: item('p02.opened', '2026-10-13T09:00:00+03:00') },
    { d: [{ kind: 'daily', template_key: 'daily.join', sent_at: '2026-10-13T09:00:00+03:00' }] }, at(now));
  assert.deepEqual(q.map((x) => x.client.id), ['b', 'a', 'd']);
  assert.equal(q[0].options[0].key, 'welcome');
  assert.ok(q[2].sent);
});

test('templates: defaults, the table wins, filling, and what is left to fill', () => {
  const map = templatesByKey([{ key: 'welcome', title: 'שלום', body: 'היי {לקוח}' }, { key: 'nope', body: 'x' }]);
  assert.equal(map.get('welcome').body, 'היי {לקוח}');
  assert.equal(map.get('welcome').isDefault, false);
  assert.equal(map.get('welcome').kind, 'milestone');
  assert.equal(map.get('daily.join').isDefault, true);
  assert.equal(map.has('nope'), false);
  assert.equal(map.size, 21);
  assert.equal(fillTemplate('היי {לקוח}, חסר {חסר}.', { 'לקוח': 'דנה', 'חסר': '' }), 'היי דנה, חסר {חסר}.');
  assert.deepEqual(unfilledIn('היי {לקוח}, עד [מועד חדש] ו[מועד חדש].'), ['{לקוח}', '[מועד חדש]']);
  assert.deepEqual(unfilledIn('היי דנה!'), []);
  assert.deepEqual(unknownVars('daily.join', 'היי {לקוח} {שעה} {עסק}'), ['שעה']);
  assert.deepEqual(unknownVars('eve', '{שעה} {כתובת} {מגיעים}'), []);
  assert.deepEqual(templateVars('thursday'), ['לקוח', 'עסק', 'עשינו', 'הלאה', 'צריך']);
  for (const t of DEFAULT_TEMPLATES) assert.deepEqual(unknownVars(t.key, t.body), [], t.key);
  // One daily message per station, in the order of STATIONS, and editing's variant without a date.
  const dailyKeys = STATIONS.map((s, i) => [`daily.${s.key}`, i + 1]);
  dailyKeys.splice(5, 0, ['daily.post_nodate', 5]);
  assert.deepEqual(DEFAULT_TEMPLATES.filter((t) => t.kind === 'daily').map((t) => [t.key, t.station]), dailyKeys);
  // The copy fits a message to the group and one to the client's own number.
  for (const t of DEFAULT_TEMPLATES) assert.doesNotMatch(t.body, /כאן|בקבוצה/, t.key);
  assert.equal(listText(['א']), 'א');
  assert.equal(listText(['א', 'ב', 'ג']), 'א, ב וג');
  assert.equal(listText(['א', '9 גרפיקות']), 'א ו־9 גרפיקות');
});

test('the migration seeds exactly the default templates', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260930100000_client_messages.sql', import.meta.url), 'utf8');
  const seed = sql.split('-- seed:begin')[1].split('-- seed:end')[0];
  const rows = [...seed.matchAll(/\(\s*'([^']+)',\s*'((?:[^']|'')*)',\s*'(\w+)',\s*(\d+|null),\s*\$t\$([\s\S]*?)\$t\$\s*\)/g)]
    .map((m) => ({ key: m[1], title: m[2].replace(/''/g, "'"), kind: m[3], station: m[4] === 'null' ? null : Number(m[4]), body: m[5] }));
  assert.deepEqual(rows, DEFAULT_TEMPLATES.map(({ key, title, kind, station, body }) => ({ key, title, kind, station, body })));
});

test('WhatsApp links: the client\'s number in 972 form, or no number to pick the group', () => {
  assert.equal(waLink('050-123 4567', 'היי דנה'), `https://wa.me/972501234567?text=${encodeURIComponent('היי דנה')}`);
  assert.equal(waLink('+972 52-765-4321', 'x'), 'https://wa.me/972527654321?text=x');
  assert.equal(waLink('', 'a&b'), 'https://wa.me/?text=a%26b');
  assert.equal(waLink('123', 'x'), 'https://wa.me/?text=x');
  assert.equal(groupLink('שורה\nשנייה'), `https://wa.me/?text=${encodeURIComponent('שורה\nשנייה')}`);
});

test('who works in the queue: the owner, Irit and Lior', () => {
  assert.equal(canSendMessages({ me: null, scope: 'office', error: null }), true);
  assert.equal(canSendMessages({ me: 'irit', scope: 'office', error: null }), true);
  assert.equal(canSendMessages({ me: 'lior', scope: 'office', error: null }), true);
  for (const me of ['ofir', 'ilai', 'nirel', 'nadia', 'eli']) assert.equal(canSendMessages({ me, scope: me === 'ofir' ? 'office' : 'own', error: null }), false, me);
  assert.equal(canSendMessages({ me: null, scope: 'own', error: null }), false, 'an unknown role');
  assert.equal(canSendMessages({ me: null, scope: 'own', error: new Error('x') }), false);
  assert.equal(canSendMessages(null), false);
});
