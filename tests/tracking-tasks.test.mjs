// "מעקב לקוחות", the tab "משימות לעורכים ולגרפיקאי" (app/tracking-tasks-logic.js; docs/ops.md, section 122).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  kindOf, taskRows, filterTasks, chipCounts, shortDay, tasksWord, formPeople, briefText, fromStaffTask, fromClientTask,
  TASK_PEOPLE, DONE_DAYS,
} from '../app/tracking-tasks-logic.js';
import { EDITORS } from '../app/protocol.js';

const NOW = new Date('2026-11-10T08:00:00Z'); // Tuesday 10.11.2026, 10:00 in Israel
const daysAgo = (n) => new Date(NOW.getTime() - n * 864e5).toISOString();
const clients = {
  c1: { id: 'c1', name: 'דנה כהן', business: 'קפה דנה' },
  c2: { id: 'c2', name: 'אבי', business: 'אבי' },
};

test('who is an editor and who the graphic designer', () => {
  for (const e of EDITORS) assert.equal(kindOf(e), 'edit');
  assert.equal(kindOf('editor'), 'edit', 'the placeholder "העורך המשויך"');
  assert.equal(kindOf('ilai'), 'graphic');
  for (const p of ['irit', 'lior', 'ofir', 'eli', 'stav', 'owner', '', null, undefined]) assert.equal(kindOf(p), null);
  assert.deepEqual(TASK_PEOPLE, [...EDITORS, 'ilai']);
  assert.deepEqual(formPeople('graphic'), ['ilai']);
  assert.deepEqual(formPeople('edit'), EDITORS);
  assert.deepEqual(formPeople('all'), TASK_PEOPLE);
});

test('a task of the client card and one of "משימות לעובדים" become the same kind of row', () => {
  const a = fromClientTask({ id: 1, client_id: 'c1', title: '  לעצב  באנר ', owner: 'ilai', due_on: '2026-11-12', done_at: null, created_at: daysAgo(2), brief: { change: 'צבע  כחול', problem: '' } }, clients);
  assert.deepEqual(a, {
    id: 'c-1', rawId: 1, from: 'client', kind: 'graphic', person: 'ilai', who: 'עילאי', clientId: 'c1', client: 'קפה דנה · דנה כהן',
    title: 'לעצב באנר', brief: 'צבע כחול', createdAt: daysAgo(2), dueOn: '2026-11-12', state: 'open', doneAt: null,
  });
  const b = fromStaffTask({ id: 9, assignee: 'nadia', body: 'לערוך\nרילס', client_id: 'gone', client_name: 'לקוח ישן', status: 'done', done_at: daysAgo(1), created_at: daysAgo(3) }, clients);
  assert.equal(b.kind, 'edit');
  assert.equal(b.who, 'נדיה');
  assert.equal(b.title, 'לערוך רילס');
  assert.equal(b.clientId, null, 'a client not readable: no link');
  assert.equal(b.client, 'לקוח ישן', 'the name as it was when given');
  assert.equal(b.dueOn, null);
  assert.equal(b.state, 'done');
  assert.equal(fromStaffTask({ id: 2, assignee: 'yariv', body: 'x', status: 'cancelled', cancelled_at: daysAgo(1) }), null, 'cancelled: not shown');
  assert.equal(fromStaffTask({ id: 3, assignee: 'lior', body: 'x', status: 'open' }), null, 'not an editor');
  assert.equal(fromClientTask({ id: 4, owner: 'ofir', title: 'x' }), null);
  assert.equal(fromStaffTask({ id: 5, assignee: 'ilai', body: 'x', client_id: 'c2', status: 'open' }, clients).client, 'אבי');
});

test('the brief line: the first answer, short', () => {
  assert.equal(briefText(null), '');
  assert.equal(briefText({}), '');
  assert.equal(briefText({ result: 'תוצאה', problem: 'בעיה' }), 'בעיה');
  const long = briefText({ problem: 'א'.repeat(300) });
  assert.equal(long.length, 110);
  assert.ok(long.endsWith('…'));
  assert.ok(fromStaffTask({ id: 1, assignee: 'nirel', body: 'ב'.repeat(400), status: 'open' }).title.length <= 160);
});

test('the order: by when put in, the newest first (the owner, 10.11.2026); done only 30 days', () => {
  const ct = [
    { id: 1, owner: 'nadia', title: 'יעד מאוחר', due_on: '2026-11-20', created_at: daysAgo(1) },
    { id: 2, owner: 'ilai', title: 'יעד מוקדם', due_on: '2026-11-05', created_at: daysAgo(2) },
    { id: 3, owner: 'anna', title: 'הושלמה אתמול', done_at: daysAgo(1), created_at: daysAgo(5) },
    { id: 4, owner: 'anna', title: 'הושלמה מזמן', done_at: daysAgo(DONE_DAYS + 1), created_at: daysAgo(60) },
    { id: 5, owner: 'lior', title: 'לא כאן', created_at: daysAgo(1) },
  ];
  const st = [
    { id: 1, assignee: 'yariv', body: 'בלי יעד, ישנה', status: 'open', created_at: daysAgo(9) },
    { id: 2, assignee: 'ilai', body: 'בלי יעד, חדשה', status: 'open', created_at: daysAgo(1) },
    { id: 3, assignee: 'nadia', body: 'הושלמה לפני שבוע', status: 'done', done_at: daysAgo(7), created_at: daysAgo(8) },
    { id: 4, assignee: 'nadia', body: 'בוטלה', status: 'cancelled', created_at: daysAgo(2) },
  ];
  const rows = taskRows({ clientTasks: ct, staffTasks: st, clients }, NOW);
  assert.deepEqual(rows.map((r) => r.title), ['יעד מאוחר', 'בלי יעד, חדשה', 'יעד מוקדם', 'הושלמה אתמול', 'הושלמה לפני שבוע', 'בלי יעד, ישנה']);
  assert.deepEqual(rows.map((r) => r.state), ['open', 'open', 'open', 'done', 'done', 'open']);
  assert.deepEqual(taskRows({}, NOW), []);
  assert.deepEqual(taskRows({ clientTasks: null, staffTasks: null }, NOW), []);
});

test('the filters and their counts', () => {
  const rows = taskRows({
    clientTasks: [{ id: 1, owner: 'ilai', title: 'a', created_at: daysAgo(1) }, { id: 2, owner: 'nadia', title: 'b', done_at: daysAgo(1), created_at: daysAgo(2) }],
    staffTasks: [{ id: 3, assignee: 'nirel', body: 'c', status: 'open', created_at: daysAgo(1) }],
  }, NOW);
  assert.equal(filterTasks(rows).length, 3);
  assert.deepEqual(filterTasks(rows, { kind: 'graphic' }).map((r) => r.title), ['a']);
  assert.deepEqual(filterTasks(rows, { kind: 'edit' }).map((r) => r.title), ['c', 'b']);
  assert.deepEqual(filterTasks(rows, { kind: 'edit', state: 'open' }).map((r) => r.title), ['c']);
  assert.deepEqual(filterTasks(rows, { state: 'done' }).map((r) => r.title), ['b']);
  assert.deepEqual(chipCounts(rows), { kind: { all: 3, edit: 2, graphic: 1 }, state: { all: 3, open: 2, done: 1 }, person: { all: 3, nadia: 1, yariv: 0, anna: 0, nirel: 1, ilai: 1 } });
  assert.deepEqual(chipCounts(rows, { kind: 'edit', state: 'open' }), { kind: { all: 2, edit: 1, graphic: 1 }, state: { all: 2, open: 1, done: 1 }, person: { all: 1, nadia: 0, yariv: 0, anna: 0, nirel: 1, ilai: 0 } });
});

test('the dates and the words', () => {
  assert.equal(shortDay('2026-11-12', NOW), '12.11');
  assert.equal(shortDay('2026-11-09T22:30:00Z', NOW), '10.11', 'an Israel day');
  assert.equal(shortDay('2025-12-28', NOW), '28.12.25');
  assert.equal(shortDay(null, NOW), '');
  assert.equal(shortDay('nonsense', NOW), '');
  assert.equal(tasksWord(1), 'משימה אחת');
  assert.equal(tasksWord(0), '0 משימות');
  assert.equal(tasksWord(12), '12 משימות');
});

// By name (the owner, 10.11.2026: "לוחצת עילאי ויכולה לראות את כל מה שיש לו").
test('by name: one person\'s tasks, the counts per person, and the form offers that person', async () => {
  const { PERSON_CHIPS } = await import('../app/tracking-tasks-logic.js');
  assert.deepEqual(PERSON_CHIPS.map(([k]) => k), ['all', 'nadia', 'yariv', 'anna', 'nirel', 'ilai']);
  const rows = taskRows({
    clientTasks: [{ id: 1, owner: 'ilai', title: 'a', created_at: daysAgo(1) }, { id: 2, owner: 'nadia', title: 'b', created_at: daysAgo(2) }],
    staffTasks: [{ id: 3, assignee: 'ilai', body: 'c', status: 'open', created_at: daysAgo(3) }, { id: 4, assignee: 'yariv', body: 'd', status: 'done', done_at: daysAgo(1), created_at: daysAgo(4) }],
  }, NOW);
  assert.deepEqual(filterTasks(rows, { person: 'ilai' }).map((r) => r.title), ['a', 'c']);
  assert.deepEqual(filterTasks(rows, { person: 'yariv', state: 'open' }), []);
  const c = chipCounts(rows, { person: 'all' });
  assert.deepEqual([c.person.all, c.person.ilai, c.person.nadia, c.person.yariv, c.person.anna], [4, 2, 1, 1, 0]);
  assert.deepEqual(chipCounts(rows, { person: 'ilai' }).state, { all: 2, open: 2, done: 0 });
  assert.deepEqual(formPeople('all', 'yariv'), ['yariv']);
  assert.deepEqual(formPeople('edit'), ['nadia', 'yariv', 'anna', 'nirel']);
});
