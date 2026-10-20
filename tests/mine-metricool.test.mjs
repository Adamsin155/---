// Ilai's Metricool line in "המשימות שלי" (app/mine-metricool.js; the owner, 20.10.2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import { metricoolProblems, problemsText, problemWindow } from '../app/mine-metricool.js';
import { flowLines, flowNeeds } from '../app/mine-flow.js';

const NOW = new Date('2026-10-20T10:00:00+03:00'); // Tuesday; next week is 25-31.10
const c = (id, fields = {}) => ({ id, status: 'active', metricool_blog_id: `b${id}`, ...fields });
const row = (client_id, day, state, kind = 'video') => ({ client_id, kind, day, time_il: '12:00', state });

test('the window: two weeks back until the end of next week', () => {
  assert.deepEqual(problemWindow(NOW), { from: '2026-10-06', to: '2026-10-31', next: { from: '2026-10-25', to: '2026-10-31' } });
});

test('failed posts and connected clients with nothing scheduled next week', () => {
  const clients = [c('a'), c('b'), c('c'), c('d', { metricool_blog_id: null }), c('e', { status: 'ended' })];
  const rows = [
    row('a', '2026-10-18', 'error'), row('a', '2026-10-26', 'scheduled'),
    row('b', '2026-10-27', 'planned'), row('b', '2026-10-12', 'error'), row('b', '2026-10-01', 'error'),
    row('c', '2026-10-28', 'scheduled'), row('c', '2026-10-29', 'error', 'nope'),
    row('d', '2026-10-18', 'error'), row('e', '2026-10-18', 'error'),
  ];
  const p = metricoolProblems({ clients, rows, now: NOW });
  assert.equal(p.failed, 2);          // a's and b's in the window; not before it, not of a client with no brand or ended
  assert.equal(p.failedClients, 2);
  assert.equal(p.nothingAhead, 1);    // b: only planned next week
  assert.equal(p.connected, 3);
  assert.equal(problemsText(p), '2 פרסומים נכשלו · לקוח אחד בלי שום דבר מתוזמן לשבוע הבא');
  assert.equal(problemsText({ failed: 0, nothingAhead: 0 }), null);
});

test("the line is Ilai's, to the Gantt index, and only when there is a problem", () => {
  const viewer = { me: 'ilai', scope: 'own', error: null };
  assert.ok(flowNeeds(viewer, NOW).includes('metricool'));
  assert.ok(!flowNeeds({ me: 'lior', scope: 'office', error: null }, NOW).includes('metricool'));
  const lines = (metricool) => flowLines({ viewer, clients: [], checks: {}, stateOf: () => ({ states: [] }), extra: { metricool }, now: NOW });
  const l = lines({ failed: 3, nothingAhead: 5 }).find((x) => x.id === 'metricool');
  assert.equal(l.n, 3);
  assert.equal(l.href, 'gantt.html#failed');
  assert.equal(l.text, '3 פרסומים נכשלו · 5 לקוחות בלי שום דבר מתוזמן לשבוע הבא');
  assert.equal(lines({ failed: 0, nothingAhead: 2 }).find((x) => x.id === 'metricool').href, 'gantt.html#nothing-ahead');
  assert.equal(lines({ failed: 0, nothingAhead: 0 }).find((x) => x.id === 'metricool'), undefined);
  assert.equal(lines(null).find((x) => x.id === 'metricool'), undefined);
});
