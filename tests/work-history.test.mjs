// "עבודה לפי עובד" (app/work-history-logic.js): who did what on which day, per employee and client.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workHistory, standingMarks, lastWork, canSeeWorkHistory } from '../app/work-history-logic.js';
import { IMPORT_NOTE } from '../app/protocol-logic.js';
import { AUTO_DRIVE_NOTE } from '../app/auto-assign.js';
import { dateIL } from '../app/tz.js';

const EMAILS = { 'ilai@x': 'ilai', 'anna@x': 'anna', 'ofir@x': 'ofir', 'irit@x': 'irit' };
const personOf = (e) => EMAILS[e] || null;
const clients = [{ id: 'c1', name: 'בטא' }, { id: 'c2', name: 'אלפא' }];
const at = (d, h = 10) => dateIL(2026, 10, d, h).toISOString();
const mark = (key, by, d, cid = 'c1', extra = {}) => ({ client_id: cid, item_key: key, action: 'done', note: null, by_email: by, at: at(d), ...extra });
const run = (over) => workHistory({ clients, personOf, ...over });
const of = (list, p) => list.find((x) => x.person === p);

test('a day of Ilai: the graphics uploaded and the Gantts, one line, then client by client', () => {
  const files = [1, 2, 3, 4].map((i) => ({ client_id: i < 4 ? 'c1' : 'c2', kind: 'deliverable_graphic', uploaded_by: 'ilai@x', created_at: at(25) }));
  const log = [mark('p29.filled', 'ilai@x', 25), mark('p29.filled', 'ilai@x', 25, 'c2')];
  const [d] = of(run({ log, files }), 'ilai').days;
  assert.equal(d.day, '2026-10-25');
  assert.equal(d.line, '4 גרפיקות, 2 גאנטים מולאו');
  assert.deepEqual(d.clients.map((c) => [c.name, c.lines]), [['אלפא', ['גרפיקה אחת', 'גאנט אחד מולא']], ['בטא', ['3 גרפיקות', 'גאנט אחד מולא']]]);
});

test('an editor: the day\'s sum per client, a correction lowers it, and never below zero', () => {
  const progress = [
    { client_id: 'c1', editor: 'anna', day: '2026-10-26', delta: 6 }, { client_id: 'c1', editor: 'anna', day: '2026-10-26', delta: -2 },
    { client_id: 'c2', editor: 'anna', day: '2026-10-27', delta: -3 },
  ];
  const { days } = of(run({ progress }), 'anna');
  assert.deepEqual(days.map((d) => [d.day, d.line]), [['2026-10-26', '4 סרטונים נערכו']]);
});

test('steps: several items of one process are one step; named marks have their words; the newest day first', () => {
  const log = [mark('p25.q.sound', 'ofir@x', 26), mark('p25.q.stable', 'ofir@x', 26), mark('p22a.assigned', 'ofir@x', 27), mark('p25.q.sound', 'ofir@x', 27, 'c2')];
  const { days } = of(run({ log }), 'ofir');
  assert.deepEqual(days.map((d) => [d.day, d.line]), [['2026-10-27', 'שיוך עורך, עוד שלב אחד'], ['2026-10-26', 'שלב אחד']]);
});

test('a round\'s mark counts as its process; what nobody did by hand, what an owner did and a key of no item do not', () => {
  const log = [
    mark('r2.p28.scheduled', 'ilai@x', 26),
    mark('p28.scheduled', 'ilai@x', 26, 'c2', { note: IMPORT_NOTE }),
    mark('p22a.drive', 'ilai@x', 26, 'c2', { note: AUTO_DRIVE_NOTE }),
    mark('p22a.irit', 'irit@x', 26, 'c2', { note: 'נסגר לבד: השיוך נרשם במערכת' }),
    mark('p22a.todo', 'ilai@x', 26),
    mark('p22.edited', 'owner@x', 26),
    { ...mark('p28.scheduled', 'system', 26) },
  ];
  const list = run({ log });
  assert.deepEqual(of(list, 'ilai').days.map((d) => d.line), ['תזמון אחד']);
  assert.deepEqual(of(list, 'irit').days, []);
});

test('a mark taken back does not count; marked again it counts on its last day', () => {
  const clear = (key, d) => ({ client_id: 'c1', item_key: key, action: 'clear', by_email: 'ofir@x', at: at(d) });
  assert.deepEqual(standingMarks([mark('p22a.assigned', 'ofir@x', 25), clear('p22a.assigned', 25)]), []);
  const log = [mark('p22a.assigned', 'ofir@x', 25), clear('p22a.assigned', 25), mark('p22a.assigned', 'ofir@x', 27)];
  assert.deepEqual(of(run({ log }), 'ofir').days.map((d) => d.day), ['2026-10-27']);
  assert.deepEqual(of(run({ log: [mark('p22.edited', 'anna@x', 25, 'c1', { action: 'na' })] }), 'anna').days, []);
});

test('a file: a deleted one and one of no employee are not counted; a client no longer here keeps a plain name', () => {
  const files = [
    { client_id: 'c1', kind: 'deliverable_graphic', uploaded_by: 'ilai@x', created_at: at(25), deleted_at: at(26) },
    { client_id: 'c1', kind: 'deliverable_graphic', uploaded_by: 'owner@x', created_at: at(25) },
    { client_id: 'gone', kind: 'deliverable_video', uploaded_by: 'ilai@x', created_at: at(25) },
  ];
  const [d] = of(run({ files }), 'ilai').days;
  assert.equal(d.line, 'סרטון אחד הועלה');
  assert.equal(d.clients[0].name, 'לקוח שכבר לא במערכת');
});

test('a day is the day in Israel: a mark at 00:30 on the 27th is of the 27th', () => {
  const log = [{ ...mark('p22a.assigned', 'ofir@x', 27), at: dateIL(2026, 10, 27, 0, 30).toISOString() }];
  assert.equal(of(run({ log }), 'ofir').days[0].day, '2026-10-27');
});

test('every employee is listed, also with nothing; the list line says today or the last day', () => {
  const list = run({ log: [mark('p22a.assigned', 'ofir@x', 27)] });
  assert.ok(of(list, 'nadia') && of(list, 'ilai'));
  assert.equal(lastWork(of(list, 'nadia'), '2026-10-27'), null);
  assert.deepEqual(lastWork(of(list, 'ofir'), '2026-10-27'), { day: '2026-10-27', isToday: true, line: 'שיוך עורך' });
  assert.equal(lastWork(of(list, 'ofir'), '2026-10-28').isToday, false);
});

test('who sees the tab: the owners, Lior and Ofir', () => {
  const office = (me) => ({ scope: 'office', me });
  assert.equal(canSeeWorkHistory(office('lior')), true);
  assert.equal(canSeeWorkHistory(office('ofir')), true);
  assert.equal(canSeeWorkHistory(office('irit')), false);
  assert.equal(canSeeWorkHistory({ scope: 'assigned', me: 'anna' }), false);
  assert.equal(canSeeWorkHistory({ error: 'x', scope: 'office', me: 'ofir' }), false);
  assert.equal(canSeeWorkHistory(null), false);
});
