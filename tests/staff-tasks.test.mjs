// Tasks given on the spot (the owner's request of 6.10.2026), at fixed Israel times
// (npm test runs this under UTC, New York and Jerusalem):
//   - who gives them and to whom, and the form (app/staff-tasks-logic.js);
//   - the reminders' own window, 09:00–20:00 on working days, and the 10-minute slots:
//     across midnight, the weekend, a holiday, erev chag and the change of the clock;
//   - the rules (app/reminder-rules.js `nag`, `nagDone`) through the engine, minute by
//     minute: one ring per slot and never two, nothing outside the window, no cap, no
//     digest, stopped by "בוצע" or a cancellation, the giver told quietly;
//   - one tick of the server (supabase/functions/reminders/tick.js) and two that overlap;
//   - the phone's payload, the notifications list and the WhatsApp template.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GIVERS, canGive, personOfViewer, ASSIGNEES, personName, homeUrl, validateTask, BODY_MAX, shortBody,
  NAG_HOURS, NAG_EVERY, nagOpen, nextNagMoment, nagSlot, nextNagAt, taskLists, KEEP_DAYS,
} from '../app/staff-tasks-logic.js';
import { buildEnv, computeReminders, planDelivery, planDigests, pushPayload, lateSummary, personWork } from '../app/reminder-engine.js';
import { RULES, RULE_BY_ID, NAG, SEND_HOURS, DAILY_CAP, inSendHours, REMINDER_PEOPLE } from '../app/reminder-rules.js';
import { PEOPLE, TEAM_PEOPLE, WORK_HOURS } from '../app/protocol.js';
import { inboxRows, unreadCount } from '../app/push-logic.js';
import { templateFor, TEMPLATES, taskIdOf } from '../app/wa-templates.js';
import { waPlan } from '../app/wa-logic.js';
import { runTick } from '../supabase/functions/reminders/tick.js';
import { dateIL, partsIL } from '../app/tz.js';

const IL = (y, m, d, h = 0, mi = 0, s = 0) => dateIL(y, m, d, h, mi, s);
const MIN = 6e4;
const hhmm = (d) => { const p = partsIL(d); return `${p.day}.${p.month} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`; };
const STAFF = [
  { email: 'owner@x', person: null }, { email: 'irit@x', person: 'irit' }, { email: 'lior@x', person: 'lior' }, { email: 'ofir@x', person: 'ofir' },
  { email: 'ilai@x', person: 'ilai' }, { email: 'nadia@x', person: 'nadia' }, { email: 'eli@x', person: 'eli' }, { email: 'stav@x', person: 'stav' }, { email: 'amos@x', person: 'amos' },
];
const world = (staffTasks = []) => ({ clients: [], checks: {}, tasks: [], access: [], reviews: [], statusNotes: [], messages: [], subscriptions: [], staff: STAFF, deals: [], approvals: [], staffTasks });
const task = (o = {}) => ({
  id: '11111111-1111-4111-8111-111111111111', created_at: IL(2026, 10, 6, 14, 3).toISOString(), created_by: 'irit', assignee: 'nadia',
  body: 'להעלות את הסרטון של פיצה רון לדרייב', client_id: null, client_name: null, status: 'open', done_at: null, cancelled_at: null, ...o,
});
const VIEW = {
  owner: { me: null, scope: 'office', error: null }, irit: { me: 'irit', scope: 'office', error: null }, lior: { me: 'lior', scope: 'office', error: null },
  ofir: { me: 'ofir', scope: 'office', error: null }, nadia: { me: 'nadia', scope: 'own', error: null }, stav: { me: 'stav', scope: 'sales', error: null },
  unknown: { me: null, scope: 'own', error: new Error('x') }, legacy: { me: null, scope: 'own', error: null },
};
// Every minute from `from` to `to`, as the server's tick: what is due and not in the log
// yet, of these tasks' two rules (an empty office has its own lines: who is not connected).
const OURS = new Set([NAG, 'nagDone']);
function run(w, from, to, log = new Set()) {
  const sent = [];
  for (let t = from.getTime(); t <= to.getTime(); t += MIN) {
    const now = new Date(t);
    for (const r of computeReminders({ ...w, now, log })) { log.add(r.key); if (OURS.has(r.rule)) sent.push({ ...r, now }); }
  }
  return sent;
}
const ours = (list) => list.filter((r) => OURS.has(r.rule));
const nags = (list) => list.filter((r) => r.rule === NAG);

test('who gives a task (the owner and Irit, one list) and to whom (everyone on the team, and the owner)', () => {
  assert.deepEqual(GIVERS, ['owner', 'irit']);
  for (const k of ['owner', 'irit']) assert.equal(canGive(VIEW[k]), true, k);
  for (const k of ['lior', 'ofir', 'nadia', 'stav', 'unknown', 'legacy']) assert.equal(canGive(VIEW[k]), false, k);
  assert.equal(canGive(null), false);
  assert.equal(personOfViewer(VIEW.owner), 'owner');
  assert.equal(personOfViewer(VIEW.legacy), null);
  const keys = ASSIGNEES().map((p) => p.key);
  assert.deepEqual(keys, [...TEAM_PEOPLE().map((p) => p.key), 'owner']);
  for (const k of ['irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli', 'stav', 'amos', 'owner']) assert.ok(keys.includes(k), k);
  assert.ok(!keys.includes('editor'));
  // Everyone a task can be given to has a place in the reminder log.
  for (const k of keys) assert.ok(REMINDER_PEOPLE.has(k), k);
  assert.equal(personName('owner'), 'הבעלים');
  assert.equal(personName('nadia'), PEOPLE.nadia.name);
  assert.equal(homeUrl('stav'), 'deal.html');
  assert.equal(homeUrl('amos'), 'deal.html');
  assert.equal(homeUrl('nadia'), 'clients.html#mine');
  assert.equal(homeUrl('owner'), 'clients.html#mine');
});

test('the form: someone to give it to, what to do (up to 500 characters), an optional client', () => {
  const ok = validateTask({ assignee: 'nadia', body: '  להעלות\r\nלדרייב  ', clientId: '22222222-2222-4222-8222-222222222222' });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.args, { p_assignee: 'nadia', p_body: 'להעלות\nלדרייב', p_client: '22222222-2222-4222-8222-222222222222' });
  assert.equal(validateTask({ assignee: 'owner', body: 'x' }).args.p_client, null);
  assert.equal(validateTask({ assignee: 'nadia', body: 'x', clientId: 'not-a-uuid' }).args.p_client, null);
  assert.deepEqual(Object.keys(validateTask({}).errors), ['assignee', 'body']);
  assert.deepEqual(Object.keys(validateTask({ assignee: 'editor', body: 'x' }).errors), ['assignee']);
  assert.deepEqual(Object.keys(validateTask({ assignee: 'nadia', body: '   ' }).errors), ['body']);
  assert.equal(validateTask({ assignee: 'nadia', body: 'א'.repeat(BODY_MAX) }).ok, true);
  assert.match(validateTask({ assignee: 'nadia', body: 'א'.repeat(BODY_MAX + 1) }).errors.body, /עד 500 תווים \(עכשיו 501\)/);
  assert.equal(shortBody('  שורה\nשנייה  '), 'שורה שנייה');
  assert.equal(shortBody('א'.repeat(200)).length, 90);
});

test('the window is 09:00–20:00 on working days, and it is the tasks\' own: no other clock moved', () => {
  assert.deepEqual(NAG_HOURS, { start: 9, end: 20 });
  assert.equal(NAG_EVERY, 10);
  // The office's hours and the other reminders' sending hours are as they were.
  assert.deepEqual(WORK_HOURS, { start: 9, end: 18, erevEnd: 13 });
  assert.deepEqual(SEND_HOURS, { from: 8 * 60 + 30, to: 19 * 60, erevTo: 13 * 60 });
  assert.equal(DAILY_CAP, 6);
  // Tuesday 6.10.2026.
  assert.equal(nagOpen(IL(2026, 10, 6, 8, 59, 59)), false);
  assert.equal(nagOpen(IL(2026, 10, 6, 9, 0)), true);
  assert.equal(nagOpen(IL(2026, 10, 6, 18, 30)), true, 'after the office closed');
  assert.equal(nagOpen(IL(2026, 10, 6, 19, 59, 59)), true, 'after the other reminders stopped');
  assert.equal(inSendHours(IL(2026, 10, 6, 19, 30)), false);
  assert.equal(nagOpen(IL(2026, 10, 6, 20, 0)), false);
  assert.equal(nagOpen(IL(2026, 10, 6, 23, 30)), false);
  assert.equal(nagOpen(IL(2026, 10, 7, 0, 30)), false);
  // Thursday is a working day; Friday and Saturday are not; Sunday is.
  assert.equal(nagOpen(IL(2026, 10, 8, 19, 50)), true);
  assert.equal(nagOpen(IL(2026, 10, 9, 10)), false);
  assert.equal(nagOpen(IL(2026, 10, 10, 10)), false);
  assert.equal(nagOpen(IL(2026, 10, 11, 9, 0)), true);
  // A holiday (Pesach, Thursday 22.4.2027) is closed; its eve closes at 13:00 with the office.
  assert.equal(nagOpen(IL(2027, 4, 22, 10)), false);
  assert.equal(nagOpen(IL(2027, 4, 21, 12, 59)), true);
  assert.equal(nagOpen(IL(2027, 4, 21, 13, 0)), false);
});

test('the next moment the window is open: tonight → tomorrow 09:00; Thursday night → Sunday; over a holiday', () => {
  assert.equal(hhmm(nextNagMoment(IL(2026, 10, 6, 14, 3))), '6.10 14:03');
  assert.equal(hhmm(nextNagMoment(IL(2026, 10, 6, 7, 0))), '6.10 09:00');
  assert.equal(hhmm(nextNagMoment(IL(2026, 10, 6, 20, 0))), '7.10 09:00');
  assert.equal(hhmm(nextNagMoment(IL(2026, 10, 6, 23, 59))), '7.10 09:00');
  assert.equal(hhmm(nextNagMoment(IL(2026, 10, 8, 20, 30))), '11.10 09:00');
  assert.equal(hhmm(nextNagMoment(IL(2026, 10, 10, 12))), '11.10 09:00');
  // Erev Pesach (Wednesday) after 13:00 → Friday and Saturday follow the holiday → Sunday.
  assert.equal(hhmm(nextNagMoment(IL(2027, 4, 21, 13, 0))), '25.4 09:00');
});

test('slots: from the moment it was given on that day, from 09:00 on every later day, 10 minutes each', () => {
  const at = IL(2026, 10, 6, 14, 3);
  const s0 = nagSlot(at, at);
  assert.deepEqual([s0.id, hhmm(s0.at), s0.n, s0.first], ['2026-10-06.0', '6.10 14:03', 0, true]);
  assert.equal(nagSlot(at, IL(2026, 10, 6, 14, 12, 59)).id, '2026-10-06.0');
  const s1 = nagSlot(at, IL(2026, 10, 6, 14, 13));
  assert.deepEqual([s1.id, hhmm(s1.at), s1.first], ['2026-10-06.1', '6.10 14:13', false]);
  // The last one of the day starts at 19:53; at 20:00 there is none.
  assert.equal(hhmm(nagSlot(at, IL(2026, 10, 6, 19, 59)).at), '6.10 19:53');
  assert.equal(nagSlot(at, IL(2026, 10, 6, 20, 0)), null);
  assert.equal(nagSlot(at, IL(2026, 10, 7, 3, 0)), null);
  // The next working day: from 09:00 sharp, a new day in the slot's name.
  const next = nagSlot(at, IL(2026, 10, 7, 9, 0));
  assert.deepEqual([next.id, hhmm(next.at), next.first], ['2026-10-07.0', '7.10 09:00', false]);
  assert.equal(nagSlot(at, IL(2026, 10, 7, 9, 10)).id, '2026-10-07.1');
  // Given at night: nothing until 09:00, and that one is its first.
  const night = IL(2026, 10, 6, 21, 30);
  assert.equal(nagSlot(night, night), null);
  const morning = nagSlot(night, IL(2026, 10, 7, 9, 4));
  assert.deepEqual([morning.id, hhmm(morning.at), morning.first], ['2026-10-07.0', '7.10 09:00', true]);
  // Given before the office opened: the first one is 09:00 of that day.
  assert.deepEqual([nagSlot(IL(2026, 10, 6, 7, 15), IL(2026, 10, 6, 9, 0)).first, nagSlot(IL(2026, 10, 6, 7, 15), IL(2026, 10, 6, 8, 0))], [true, null]);
  // Thursday 19:55 → one slot, then Sunday 09:00 (the weekend is skipped).
  const thu = IL(2026, 10, 8, 19, 55);
  assert.equal(nagSlot(thu, IL(2026, 10, 8, 19, 59)).id, '2026-10-08.0');
  for (const d of [IL(2026, 10, 8, 20, 5), IL(2026, 10, 9, 10), IL(2026, 10, 10, 10), IL(2026, 10, 11, 8, 59)]) assert.equal(nagSlot(thu, d), null, hhmm(d));
  assert.equal(nagSlot(thu, IL(2026, 10, 11, 9, 0)).id, '2026-10-11.0');
  // No date, a bad one, or a moment before it was given.
  assert.equal(nagSlot(null, at), null);
  assert.equal(nagSlot(new Date('x'), at), null);
  assert.equal(nagSlot(at, IL(2026, 10, 6, 14, 2)), null);
});

test('a whole day has 66 slots, also on the day the clock changes (Sunday 25.10.2026)', () => {
  for (const [y, m, d] of [[2026, 10, 7], [2026, 10, 25], [2027, 3, 28]]) {
    const given = IL(y, m, d - 1 > 0 ? d - 1 : d, 8, 0); // the day before, in the morning
    const ids = new Set();
    const starts = [];
    for (let t = IL(y, m, d, 0, 0).getTime(); t < IL(y, m, d, 23, 59).getTime(); t += MIN) {
      const s = nagSlot(given, new Date(t));
      if (s && !ids.has(s.id)) { ids.add(s.id); starts.push(hhmm(s.at).split(' ')[1]); }
    }
    assert.equal(ids.size, 66, `${d}.${m}.${y}`);
    assert.deepEqual([starts[0], starts[1], starts.at(-1)], ['09:00', '09:10', '19:50'], `${d}.${m}.${y}`);
  }
});

test('the card says when the next reminder comes', () => {
  const at = IL(2026, 10, 6, 14, 3);
  assert.equal(hhmm(nextNagAt(at, IL(2026, 10, 6, 14, 5))), '6.10 14:13');
  assert.equal(hhmm(nextNagAt(at, IL(2026, 10, 6, 19, 55))), '7.10 09:00');
  assert.equal(hhmm(nextNagAt(at, IL(2026, 10, 6, 22, 0))), '7.10 09:00');
  assert.equal(hhmm(nextNagAt(IL(2026, 10, 8, 19, 55), IL(2026, 10, 8, 19, 56))), '11.10 09:00');
});

test('the assignee rings at once and then every 10 minutes until 20:00, each slot once', () => {
  const w = world([task()]);
  const sent = run(w, IL(2026, 10, 6, 14, 0), IL(2026, 10, 6, 21, 0));
  const mine = nags(sent);
  assert.equal(mine.length, sent.length, 'no other step of its own');
  // 14:03, 14:13 … 19:53: 36 rings, each on its minute, all to Nadia, all rings.
  assert.equal(mine.length, 36);
  assert.deepEqual(mine.slice(0, 3).map((r) => hhmm(r.now)), ['6.10 14:03', '6.10 14:13', '6.10 14:23']);
  assert.equal(hhmm(mine.at(-1).now), '6.10 19:53');
  assert.ok(mine.every((r) => r.person === 'nadia' && r.level === 'ring' && r.ownHours && r.exempt === NAG && r.url === 'clients.html#mine' && r.clientId === null && r.ref === null));
  assert.equal(new Set(mine.map((r) => r.key)).size, 36);
  assert.equal(mine[0].key, 'nag:-:11111111-1111-4111-8111-111111111111:2026-10-06.0@nadia');
  assert.equal(mine[0].title, 'משימה מעירית: להעלות את הסרטון של פיצה רון לדרייב');
  assert.match(mine[0].body, /^מעירית, היום 14:03 · תזכורת כל 10 דקות עד שמסמנים ״בוצע״ ב״המשימות שלי״\.$/);
  assert.equal(mine[1].title, 'עוד לא סומן ״בוצע״: להעלות את הסרטון של פיצה רון לדרייב');
  // The gaps are exactly 10 minutes.
  for (let i = 1; i < mine.length; i += 1) assert.equal(mine[i].now - mine[i - 1].now, 10 * MIN);
  // Asked again in the same minute, or anywhere in the same slot: nothing new.
  const log = new Set(mine.map((r) => r.key));
  assert.deepEqual(ours(computeReminders({ ...w, now: IL(2026, 10, 6, 14, 3, 30), log })), []);
  assert.deepEqual(ours(computeReminders({ ...w, now: IL(2026, 10, 6, 14, 12), log })), []);
});

test('a task still open at 20:00 is silent through the night and resumes at 09:00 of the next working day', () => {
  const w = world([task({ created_at: IL(2026, 10, 8, 19, 45).toISOString() })]); // Thursday evening
  const sent = nags(run(w, IL(2026, 10, 8, 19, 40), IL(2026, 10, 11, 9, 25)));
  assert.deepEqual(sent.map((r) => hhmm(r.now)), ['8.10 19:45', '8.10 19:55', '11.10 09:00', '11.10 09:10', '11.10 09:20']);
  assert.match(sent[2].body, /^מעירית, ה׳ 8\.10 19:45/);
  // Given at night: the first ring is 09:00, worded as the first.
  const night = nags(run(world([task({ created_at: IL(2026, 10, 6, 22, 10).toISOString() })]), IL(2026, 10, 6, 22, 0), IL(2026, 10, 7, 9, 12)));
  assert.deepEqual(night.map((r) => [hhmm(r.now), r.title.split(':')[0]]), [['7.10 09:00', 'משימה מעירית'], ['7.10 09:10', 'עוד לא סומן ״בוצע״']]);
});

test('a slot the engine missed is not sent late: the next one goes out on time', () => {
  const w = world([task()]);
  const log = new Set();
  const first = run(w, IL(2026, 10, 6, 14, 3), IL(2026, 10, 6, 14, 5), log);
  assert.equal(first.length, 1);
  // The engine was down from 14:06 to 14:47.
  const back = run(w, IL(2026, 10, 6, 14, 48), IL(2026, 10, 6, 14, 55), log);
  assert.deepEqual(back.map((r) => [hhmm(r.now), hhmm(r.at)]), [['6.10 14:48', '6.10 14:43'], ['6.10 14:53', '6.10 14:53']]);
});

test('"בוצע" stops it and tells the giver quietly, once; a cancellation stops it and tells nobody', () => {
  const t = task();
  const w = world([t]);
  const log = new Set();
  assert.equal(nags(run(w, IL(2026, 10, 6, 14, 3), IL(2026, 10, 6, 14, 30), log)).length, 3);
  // 14:31: Nadia marks it done.
  w.staffTasks[0] = { ...t, status: 'done', done_at: IL(2026, 10, 6, 14, 31).toISOString() };
  const after = run(w, IL(2026, 10, 6, 14, 31), IL(2026, 10, 7, 12, 0), log);
  assert.deepEqual(after.map((r) => [r.rule, r.person, r.level, r.title, hhmm(r.now)]), [['nagDone', 'irit', 'quiet', 'נדיה סימן/ה ״בוצע״: להעלות את הסרטון של פיצה רון לדרייב', '6.10 14:31']]);
  assert.equal(after[0].key, 'nagDone:-:11111111-1111-4111-8111-111111111111:done@irit');
  const [plan] = planDelivery({ reminders: after, now: IL(2026, 10, 6, 14, 31) });
  assert.deepEqual([plan.channel, plan.status], ['app', 'sent']);
  // Cancelled: silence.
  const c = world([task({ status: 'cancelled', cancelled_at: IL(2026, 10, 6, 14, 20).toISOString() })]);
  assert.deepEqual(run(c, IL(2026, 10, 6, 14, 20), IL(2026, 10, 7, 10, 0)), []);
  // The owner gave it: the owner hears. A task one gave oneself: nobody is told.
  const own = world([task({ created_by: 'owner', status: 'done', done_at: IL(2026, 10, 6, 15).toISOString() })]);
  assert.deepEqual(run(own, IL(2026, 10, 6, 15), IL(2026, 10, 6, 15, 5)).map((r) => [r.rule, r.person]), [['nagDone', 'owner']]);
  const self = world([task({ assignee: 'irit', status: 'done', done_at: IL(2026, 10, 6, 15).toISOString() })]);
  assert.deepEqual(run(self, IL(2026, 10, 6, 15), IL(2026, 10, 6, 15, 5)), []);
});

test('it goes to the phone at 19:30 and past the daily cap, and never to a digest or to the lateness notes', () => {
  const w = world([task({ created_at: IL(2026, 10, 6, 9, 0).toISOString() })]);
  const now = IL(2026, 10, 6, 19, 30);
  const due = ours(computeReminders({ ...w, now }));
  assert.equal(due.length, 1);
  // Six ordinary rings already went to Nadia today, and 60 of this task's own.
  const log = [
    ...Array.from({ length: 6 }, (_, i) => ({ id: i + 1, key: `x:${i}`, rule: 'task', person: 'nadia', level: 'ring', channel: 'push', status: 'sent', exempt: false, sent_at: IL(2026, 10, 6, 10, i).toISOString() })),
    ...Array.from({ length: 60 }, (_, i) => ({ id: 100 + i, key: `nag:-:t:2026-10-06.${i}@nadia`, rule: NAG, person: 'nadia', level: 'ring', channel: 'push', status: 'sent', exempt: true, sent_at: IL(2026, 10, 6, 9, 0).toISOString() })),
  ];
  const [plan] = planDelivery({ reminders: due, now, log });
  assert.deepEqual([plan.channel, plan.status, plan.reason], ['push', 'sent', null]);
  // An ordinary ring at that hour still waits for the digest, as before.
  const [other] = planDelivery({ reminders: [{ ...due[0], key: 'k', rule: 'task', ownHours: false, exempt: null }], now, log: [] });
  assert.deepEqual([other.channel, other.status, other.reason], ['digest', 'queued', 'quiet_hours']);
  // Its repeats do not use up the cap of the other rings: with 5 ordinary ones, the sixth still rings at noon.
  const noon = IL(2026, 10, 6, 12, 0);
  const [sixth] = planDelivery({ reminders: [{ ...due[0], key: 'k2', rule: 'task', ownHours: false, exempt: null, at: noon }], now: noon, log: log.slice(1) });
  assert.deepEqual([sixth.channel, sixth.status], ['push', 'sent']);
  // The lateness notes to Ofir and Lior, the owner's 24-hour summary and the morning digest do not know it.
  const old = world([task({ created_at: IL(2026, 10, 1, 9, 0).toISOString() })]); // five days open
  const env = buildEnv({ ...old, now: IL(2026, 10, 6, 18, 0) });
  assert.deepEqual(lateSummary(env), []);
  assert.deepEqual(personWork(env, 'nadia'), { overdue: [], today: [] });
  const at18 = computeReminders({ ...old, now: IL(2026, 10, 6, 18, 0) });
  assert.deepEqual(ours(at18).map((r) => [r.rule, r.person]), [[NAG, 'nadia']]);
  // Its ring, once in the log, is in nobody's digest: the owner's 18:00 has nothing to report.
  const rung = planDelivery({ reminders: ours(at18), now: IL(2026, 10, 6, 18, 0) }).map((r, i) => ({ ...r, id: i + 1, created_at: IL(2026, 10, 6, 18, 0).toISOString() }));
  const digests = planDigests({ env, log: rung, active: new Set(at18.map((r) => r.key)) });
  assert.deepEqual(digests.map((d) => [d.person, d.lines]), [['owner', ['הכול לפי התוכנית.']]]);
  const morningEnv = buildEnv({ ...old, now: IL(2026, 10, 7, 8, 30) });
  const morning = planDigests({ env: morningEnv, log: rung, active: new Set() });
  assert.deepEqual(morning.filter((d) => d.key && d.person === 'nadia'), []);
  assert.ok(morning.every((d) => !d.key || !d.lines.join(' ').includes('פיצה רון')));
});

test('sales agents and the owner get theirs; on Lior\'s shoot day his wait until it is over', () => {
  const stav = nags(run(world([task({ assignee: 'stav' })]), IL(2026, 10, 6, 14, 3), IL(2026, 10, 6, 14, 4)));
  assert.deepEqual(stav.map((r) => [r.person, r.url]), [['stav', 'deal.html']]);
  assert.match(stav[0].body, /עד שמסמנים ״בוצע״ במערכת\.$/);
  const owner = nags(run(world([task({ assignee: 'owner', client_name: 'פיצה רון' })]), IL(2026, 10, 6, 14, 3), IL(2026, 10, 6, 14, 4)));
  assert.deepEqual(owner.map((r) => r.person), ['owner']);
  assert.match(owner[0].body, / · לקוח: פיצה רון · /);
  // Someone who is not a person of the system is skipped, never a broken row.
  assert.deepEqual(run(world([task({ assignee: 'editor' })]), IL(2026, 10, 6, 14, 3), IL(2026, 10, 6, 14, 4)), []);
  const w = world([task({ assignee: 'lior' })]);
  const env = buildEnv({ ...w, now: IL(2026, 10, 6, 14, 3) });
  assert.equal(ours(computeReminders({ env })).length, 1);
  env.liorShoot = { active: true, cids: new Set(['c1']) };
  assert.deepEqual(ours(computeReminders({ env })), []);
});

test('the rules are registered once, with their own hours', () => {
  for (const id of [NAG, 'nagDone']) assert.equal(RULES.filter((r) => r.id === id).length, 1, id);
  assert.equal(typeof RULE_BY_ID.get(NAG).steps, 'function');
  assert.equal(RULE_BY_ID.get('nagDone').steps[0].level, 'quiet');
});

// ── The server's tick ──────────────────────
const KEY = 'B' + 'A'.repeat(86);
function fakeDb({ staffTasks = [], subs = [] } = {}) {
  let clock = new Date();
  const db = {
    log: [], subs: subs.map((s, i) => ({ id: `s${i}`, p256dh: KEY, auth: 'A'.repeat(22), fail_count: 0, ...s })), nextId: 1, staffTasks,
    at(now) { clock = now; return db; },
    async load() {
      // As index.ts: the repeats of these tasks are not loaded with the week's log.
      return { ...world(db.staffTasks.map((t) => ({ ...t }))), subscriptions: db.subs.map((s) => ({ ...s })), log: db.log.filter((r) => r.rule !== NAG).map((r) => ({ ...r })) };
    },
    async known(keys) { const set = new Set(keys); return new Set(db.log.map((r) => r.key).filter((k) => set.has(k))); },
    async insertLog(rows) {
      const out = [];
      for (const r of rows) {
        // The table's checks (20260930110000_reminders.sql, 20261005100000_sales_amos.sql).
        assert.ok(/^[a-zA-Z0-9]+$/.test(r.rule) && r.key.length <= 400 && r.title.length <= 300 && r.ref === null && !/^[a-z]+:/.test(r.url), r.key);
        if (db.log.some((x) => x.key === r.key)) continue; // ON CONFLICT (key) DO NOTHING
        const row = { id: db.nextId++, created_at: clock.toISOString(), claimed_at: clock.toISOString(), attempts: 0, read_at: null, digest_key: null, ...r };
        db.log.push(row);
        out.push({ ...row });
      }
      return out;
    },
    async reclaim(before) {
      const out = [];
      for (const r of db.log) {
        if (r.status !== 'pending' || !(new Date(r.claimed_at) < before)) continue;
        Object.assign(r, { claimed_at: clock.toISOString(), attempts: r.attempts + 1 });
        out.push({ ...r });
      }
      return out;
    },
    async updateLog(ids, patch) { for (const r of db.log) if (ids.includes(r.id)) Object.assign(r, patch); },
    async subscriptionOk() {},
    async subscriptionFailed() {},
    async removeSubscription(id) { db.subs = db.subs.filter((s) => s.id !== id); },
  };
  return db;
}
function fakePush() {
  const sent = [];
  return { sent, push: async (sub, payload, opts) => { sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload), opts }); return { ok: true, status: 201 }; } };
}

test('a tick every minute: one push per 10 minutes to every device, two overlapping ticks never send a slot twice', async () => {
  const db = fakeDb({ staffTasks: [task()], subs: [{ email: 'nadia@x', endpoint: 'https://push.test/phone' }, { email: 'nadia@x', endpoint: 'https://push.test/tablet' }, { email: 'irit@x', endpoint: 'https://push.test/irit' }] });
  const { push, sent } = fakePush();
  for (let t = IL(2026, 10, 6, 14, 3).getTime(); t <= IL(2026, 10, 6, 14, 34).getTime(); t += MIN) {
    const now = new Date(t);
    // Two ticks in the same minute (the second started before the first finished).
    await Promise.all([runTick({ db: db.at(now), push, now }), runTick({ db: db.at(now), push, now })]);
  }
  // 14:03, 14:13, 14:23, 14:33: four rows, each pushed once to each of Nadia's two devices.
  const rows = db.log.filter((r) => r.rule === NAG);
  assert.deepEqual(rows.map((r) => [r.key.split(':').at(-1), r.status, r.channel, r.exempt, hhmm(new Date(r.created_at))]), [
    ['2026-10-06.0@nadia', 'sent', 'push', true, '6.10 14:03'], ['2026-10-06.1@nadia', 'sent', 'push', true, '6.10 14:13'],
    ['2026-10-06.2@nadia', 'sent', 'push', true, '6.10 14:23'], ['2026-10-06.3@nadia', 'sent', 'push', true, '6.10 14:33'],
  ]);
  assert.equal(sent.length, 8);
  assert.ok(sent.every((s) => s.endpoint !== 'https://push.test/irit' && s.opts.urgency === 'high'));
  // On the phone the repeats replace each other and sound again.
  assert.deepEqual([...new Set(sent.map((s) => s.payload.tag))], ['nag:-:11111111-1111-4111-8111-111111111111']);
  assert.ok(sent.every((s) => s.payload.renotify === true && s.payload.url === 'clients.html#mine'));
  // Done at 14:40: Irit hears in the app (her phone does not ring), and nothing more goes to Nadia.
  db.staffTasks[0] = { ...db.staffTasks[0], status: 'done', done_at: IL(2026, 10, 6, 14, 40).toISOString() };
  for (let t = IL(2026, 10, 6, 14, 40).getTime(); t <= IL(2026, 10, 6, 15, 10).getTime(); t += MIN) await runTick({ db: db.at(new Date(t)), push, now: new Date(t) });
  assert.equal(sent.length, 8);
  assert.deepEqual(db.log.filter((r) => r.rule === 'nagDone').map((r) => [r.person, r.level, r.channel, r.status]), [['irit', 'quiet', 'app', 'sent']]);
  assert.equal(db.log.filter((r) => OURS.has(r.rule)).length, 5);
});

test('a ring at 19:40 goes out by push; someone with no phone connected still gets it in the app', async () => {
  const db = fakeDb({ staffTasks: [task({ created_at: IL(2026, 10, 6, 19, 40).toISOString() }), task({ id: '33333333-3333-4333-8333-333333333333', assignee: 'eli', created_at: IL(2026, 10, 6, 19, 40).toISOString() })], subs: [{ email: 'nadia@x', endpoint: 'https://push.test/phone' }] });
  const { push, sent } = fakePush();
  const now = IL(2026, 10, 6, 19, 40);
  const stats = await runTick({ db: db.at(now), push, now });
  assert.deepEqual([stats.pushed, stats.noDevice, stats.queued], [1, 1, 0]);
  assert.equal(sent.length, 1);
  const rows = () => db.log.filter((r) => OURS.has(r.rule)).map((r) => [r.person, r.channel, r.status, r.reason]).sort();
  assert.deepEqual(rows(), [['eli', 'app', 'sent', 'no_device'], ['nadia', 'push', 'sent', null]]);
  // 20:00: nothing, for anyone.
  const late = IL(2026, 10, 6, 20, 0);
  await runTick({ db: db.at(late), push, now: late });
  assert.equal(rows().length, 2);
  assert.equal(sent.length, 1);
});

test('the phone: an ordinary reminder keeps its own tag and does not ask to ring again', () => {
  const p = JSON.parse(pushPayload({ id: 7, key: 'urgent:c1:t1:now@ilai', title: 'x', body: 'y', url: 'clients.html#mine', level: 'ring' }));
  assert.deepEqual(p, { title: 'x', body: 'y', url: 'clients.html#mine', tag: 'urgent:c1:t1:now@ilai', id: 7, level: 'ring' });
  const n = JSON.parse(pushPayload({ id: 8, key: 'nag:-:t9:2026-10-06.4@ilai', title: 'x', body: 'y', url: 'clients.html#mine', level: 'ring' }));
  assert.deepEqual(n, { title: 'x', body: 'y', url: 'clients.html#mine', tag: 'nag:-:t9', id: 8, level: 'ring', renotify: true });
});

test('the notifications list shows one row for a task, the latest, next to everything else', () => {
  const now = IL(2026, 10, 6, 15, 0);
  const row = (id, key, rule, mi, read = false) => ({ id, key, rule, level: 'ring', channel: 'push', status: 'sent', title: key, created_at: IL(2026, 10, 6, 14, mi).toISOString(), read_at: read ? now.toISOString() : null });
  const rows = inboxRows([
    row(1, 'nag:-:t1:2026-10-06.0@nadia', 'nag', 3), row(2, 'nag:-:t1:2026-10-06.1@nadia', 'nag', 13), row(3, 'nag:-:t1:2026-10-06.2@nadia', 'nag', 23),
    row(4, 'nag:-:t2:2026-10-06.0@nadia', 'nag', 20), row(5, 'task:c1:t5:created@nadia', 'task', 10), row(6, 'task:c1:t6:created@nadia', 'task', 11),
  ], now);
  assert.deepEqual(rows.map((r) => r.id), [3, 4, 6, 5]);
  assert.equal(unreadCount(rows), 4);
});

test('WhatsApp: the existing "due" template, no new one; within the consent\'s hours only', () => {
  const row = { key: 'nag:-:t1:2026-10-06.3@nadia', rule: NAG, level: 'ring', person: 'nadia' };
  assert.equal(templateFor(row), 'due');
  assert.equal(taskIdOf(row), null, 'not a client task: no "בוצע" button is wired to it');
  assert.deepEqual(Object.keys(TEMPLATES), ['digest', 'new_task', 'due', 'late', 'exception', 'shoot_day', 'editor_assigned', 'owner_digest', 'review']);
  const recipient = { email: 'nadia@x', phone: '972501234567' };
  assert.deepEqual(waPlan({ row, kind: 'ring', now: IL(2026, 10, 6, 14, 33), recipient }), { template: 'due', to: '972501234567' });
  // 19:00–20:00 is outside the hours the staff agreed to on WhatsApp: push only.
  assert.deepEqual(waPlan({ row, kind: 'ring', now: IL(2026, 10, 6, 19, 30), recipient }), { skip: 'quiet_hours' });
});

test('the card\'s lists: mine (oldest first), what I gave (the owner: everyone\'s), closed ones for a week', () => {
  const now = IL(2026, 10, 6, 15, 0);
  const all = [
    task({ id: 'a', assignee: 'nadia', created_at: IL(2026, 10, 6, 14, 3).toISOString() }),
    task({ id: 'b', assignee: 'nadia', created_at: IL(2026, 10, 6, 10, 0).toISOString(), created_by: 'owner' }),
    task({ id: 'c', assignee: 'irit', created_by: 'owner', created_at: IL(2026, 10, 6, 11, 0).toISOString() }),
    task({ id: 'd', assignee: 'eli', status: 'done', done_at: IL(2026, 10, 5, 12, 0).toISOString() }),
    task({ id: 'e', assignee: 'eli', status: 'cancelled', cancelled_at: IL(2026, 10, 6, 9, 30).toISOString() }),
    task({ id: 'f', assignee: 'eli', status: 'done', done_at: IL(2026, 9, 20, 12, 0).toISOString() }),
  ];
  assert.equal(KEEP_DAYS, 7);
  const nadia = taskLists(all, VIEW.nadia, now);
  assert.deepEqual([nadia.mine.map((t) => t.id), nadia.given.open, nadia.given.closed], [['b', 'a'], [], []]);
  const irit = taskLists(all, VIEW.irit, now);
  assert.deepEqual([irit.mine.map((t) => t.id), irit.given.open.map((t) => t.id), irit.given.closed.map((t) => t.id)], [['c'], ['a'], ['e', 'd']]);
  const owner = taskLists(all, VIEW.owner, now);
  assert.deepEqual([owner.mine, owner.given.open.map((t) => t.id), owner.given.closed.map((t) => t.id)], [[], ['a', 'c', 'b'], ['e', 'd']]);
  assert.deepEqual(taskLists(all, VIEW.unknown, now), { mine: [], given: { open: [], closed: [] } });
  // Lior gives none (until he is added to GIVERS): he sees only what he got.
  assert.deepEqual(taskLists([task({ id: 'g', created_by: 'lior', assignee: 'eli' })], VIEW.lior, now).given.open, []);
});
