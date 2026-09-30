// What happens to each reminder step at the moment it is due (app/reminder-engine.js):
// the sending hours (Sunday–Thursday 08:30–19:00, not on holidays; shoot-day
// events go out anyway), the cap of 6 rings a day (protocol clocks, shoot days and
// urgent work not counted), Lior's shoot day, stale steps, and the digests: 08:30
// for everyone (up to 5 lines, late first, with what is due 09:00–09:30), Lior's
// lists at 12:00 and 16:00, the owner's 18:00 (with the weekly report on Thursday)
// and the first business day's 08:30 week ahead. Israel times; run under 3 zones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDelivery, planDigests, buildEnv, digestLines, candidates, computeReminders, ringsToday, weekAhead } from '../app/reminder-engine.js';
import { DAILY_CAP } from '../app/reminder-rules.js';
import { importKeys } from '../app/client-open.js';
import { IMPORT_NOTE } from '../app/protocol-logic.js';
import { dateIL } from '../app/tz.js';

const IL = (y, m, d, h = 0, mi = 0) => dateIL(y, m, d, h, mi);
const STAFF = [
  { email: 'owner@x', person: null }, { email: 'irit@x', person: 'irit' }, { email: 'lior@x', person: 'lior' },
  { email: 'ofir@x', person: 'ofir' }, { email: 'ilai@x', person: 'ilai' },
];
let n = 0;
const ring = (person, at, o = {}) => ({ key: `t:${(n += 1)}@${person}`, rule: 'deal', step: 's', person, level: 'ring', exempt: null, shoot: false, at, title: `ת${n}`, body: '', clientId: null, ...o });
const plan = (list, now, log = [], liorShoot) => planDelivery({ reminders: list, now, log, liorShoot });
const row = (o) => ({ id: (n += 1), key: `r:${n}`, rule: 'deal', person: 'irit', level: 'ring', channel: 'push', status: 'sent', exempt: false, created_at: IL(2026, 10, 5, 10).toISOString(), sent_at: IL(2026, 10, 5, 10).toISOString(), title: `שורה ${n}`, ...o });
const envAt = (now, extra = {}) => buildEnv({ clients: [], checks: {}, tasks: [], staff: STAFF, now, ...extra });

test('sending hours: a ring outside Sunday–Thursday 08:30–19:00 or on a holiday waits for the next digest', () => {
  const cases = [
    [IL(2026, 10, 5, 8, 29), 'queued'], [IL(2026, 10, 5, 8, 30), 'sent'], [IL(2026, 10, 5, 18, 59), 'sent'],
    [IL(2026, 10, 5, 19, 0), 'queued'], [IL(2026, 10, 9, 11), 'queued'], [IL(2026, 10, 10, 11), 'queued'], [IL(2026, 9, 21, 11), 'queued'],
  ];
  for (const [now, status] of cases) {
    const [r] = plan([ring('irit', now)], now);
    assert.equal(r.status, status, now.toISOString());
    assert.equal(r.channel, status === 'sent' ? 'push' : 'digest');
    if (status === 'queued') assert.equal(r.reason, 'quiet_hours');
  }
  // A shoot-day event goes out at 20:00 (the briefing check) and on a Friday.
  for (const now of [IL(2026, 10, 14, 20), IL(2026, 10, 9, 7)]) {
    const [r] = plan([ring('lior', now, { shoot: true, exempt: 'shoot' })], now);
    assert.deepEqual([r.channel, r.status], ['push', 'sent']);
  }
});

test('the cap: at most 6 rings a day each; protocol clocks, shoot days and urgent work do not count', () => {
  const now = IL(2026, 10, 5, 15);
  const log = Array.from({ length: DAILY_CAP }, () => row({ person: 'irit' }));
  // Rings of yesterday, exempt rings and other people's rings do not count.
  log.push(row({ person: 'irit', sent_at: IL(2026, 10, 4, 12).toISOString(), created_at: IL(2026, 10, 4, 12).toISOString() }));
  log.push(row({ person: 'lior' }));
  assert.equal(ringsToday(log, now).irit, DAILY_CAP);
  const out = plan([ring('irit', now), ring('irit', now, { exempt: 'clock' }), ring('irit', now, { exempt: 'urgent' }), ring('lior', now)], now, log);
  const by = Object.fromEntries(out.map((r) => [r.exempt || r.person, r]));
  assert.deepEqual([by.irit.status, by.irit.reason], ['queued', 'cap']);
  assert.equal(by.clock.status, 'sent');
  assert.equal(by.urgent.status, 'sent');
  assert.equal(by.lior.status, 'sent');
  // Within one tick the count goes up as rings go out.
  const fresh = plan(Array.from({ length: 8 }, () => ring('ofir', now)), now);
  assert.equal(fresh.filter((r) => r.status === 'sent').length, DAILY_CAP);
  assert.equal(fresh.filter((r) => r.reason === 'cap').length, 2);
});

test('levels: quiet and board go to the app, digest lines are queued, stale steps are never sent late', () => {
  const now = IL(2026, 10, 5, 12);
  const out = plan([
    ring('irit', now, { level: 'quiet' }), ring('owner', now, { level: 'board' }), ring('lior', now, { level: 'digest' }),
    ring('irit', new Date(now - 6 * 36e5 - 6e4)), ring('irit', new Date(now - 5 * 36e5)),
  ], now);
  assert.deepEqual(out.map((r) => `${r.level}:${r.channel}:${r.status}:${r.reason}`), [
    'ring:app:suppressed:stale', 'ring:push:sent:null', 'quiet:app:sent:null', 'board:app:sent:null', 'digest:digest:queued:null',
  ]);
});

test('Lior\'s shoot day: his other rings wait for the summary after it; the shoot\'s own do not', () => {
  const now = IL(2026, 10, 15, 12);
  const shoot = { active: true, cids: new Set(['c1']) };
  const list = [ring('lior', now, { clientId: 'c2' }), ring('lior', now, { clientId: 'c1', shoot: true, exempt: 'shoot' }), ring('ofir', now)];
  const out = new Map(plan(list, now, [], shoot).map((r) => [r.key, r]));
  assert.deepEqual(list.map((r) => out.get(r.key).reason || out.get(r.key).status), ['shoot_mode', 'sent', 'sent']);
});

// ── Digests ───────────────────────────────
function office() {
  // Two clients with work late and due today for Irit, imported up to their station.
  const clients = [
    { id: 'c1', name: 'אלפא', status: 'active', shoot_type: 'dms', characterizer: 'ofir', has_logo: true, rounds: [], contract_end: '2027-12-31', deal_at: IL(2026, 9, 1).toISOString() },
    { id: 'c2', name: 'בטא', status: 'active', shoot_type: 'dms', characterizer: 'ofir', has_logo: true, rounds: [], contract_end: '2027-12-31', deal_at: IL(2026, 9, 1).toISOString() },
  ];
  const checks = {};
  for (const c of clients) for (const k of importKeys('ongoing')) (checks[c.id] ||= {})[k] = { client_id: c.id, item_key: k, state: 'done', note: IMPORT_NOTE, at: IL(2026, 9, 1).toISOString() };
  return { clients, checks };
}

test('the 08:30 digest: late first, one line per topic with a count, at most 5 lines, and what is due 09:00–09:30', () => {
  const now = IL(2026, 10, 5, 8, 30);
  const env = envAt(now, office());
  const queued = [
    row({ person: 'irit', status: 'queued', channel: 'digest', level: 'digest', rule: 'dailyMessages', key: 'dm', title: 'הודעות יומיות ללקוחות: 2' }),
    row({ person: 'irit', status: 'queued', channel: 'digest', level: 'digest', rule: 'shootDate', key: 'sd1', client_id: 'c1', title: 'יום צילום לא נסגר: אלפא' }),
    row({ person: 'irit', status: 'queued', channel: 'digest', level: 'digest', rule: 'shootDate', key: 'sd2', client_id: 'c2', title: 'יום צילום לא נסגר: בטא' }),
    row({ person: 'irit', status: 'queued', channel: 'digest', level: 'ring', rule: 'late', key: 'lt', overdue: true, reason: 'quiet_hours', title: 'באיחור: אלפא · 8' }),
    row({ person: 'irit', status: 'queued', channel: 'digest', level: 'digest', rule: 'renewal', key: 'gone', title: 'חידוש' }),
  ];
  const fold = [
    ring('irit', IL(2026, 10, 5, 9, 5), { rule: 'deal', title: 'עברו 5 דקות: גמא', key: 'fold1@irit' }),
    ring('irit', IL(2026, 10, 5, 9, 31), { rule: 'deal', title: 'מאוחר', key: 'fold2@irit' }),
    ring('eli', IL(2026, 10, 5, 9, 10), { shoot: true, title: 'צילום', key: 'fold3@eli' }),
  ];
  const active = new Set(['dm', 'sd1', 'sd2', 'lt', 'fold1@irit']);
  const digests = planDigests({ env, now, log: queued, active, lookahead: fold });
  const irit = digests.find((d) => d.person === 'irit');
  assert.equal(irit.key, 'digest:morning:irit:2026-10-05');
  assert.equal(irit.title, 'תקציר בוקר');
  assert.ok(irit.lines.length <= 5);
  assert.equal(irit.lines[0], 'באיחור: אלפא · 8'); // late first
  assert.ok(irit.lines.includes('עברו 5 דקות: גמא'), irit.lines.join('\n')); // due 09:05: in this digest
  assert.ok(irit.lines.some((l) => l.startsWith('יום צילום לא נסגר (11) (2): אלפא, בטא')), irit.lines.join('\n'));
  assert.deepEqual(irit.include.map((r) => r.key).sort(), ['dm', 'lt', 'sd1', 'sd2']);
  assert.deepEqual(irit.drop.map((r) => r.key), ['gone']); // resolved meanwhile: never sent
  assert.deepEqual(irit.fold.map((r) => r.key), ['fold1@irit']); // 09:31 and shoot-day events ring on their own
  assert.equal(irit.body, irit.lines.join('\n'));
  // Nobody else has anything: no empty digests.
  assert.deepEqual(digests.map((d) => d.person), ['irit']);
  // Not before 08:30, not an hour later, not on a Friday.
  for (const t of [IL(2026, 10, 5, 8, 29), IL(2026, 10, 5, 9, 30), IL(2026, 10, 9, 8, 30)]) {
    assert.equal(planDigests({ env: envAt(t, office()), now: t, log: queued, active }).filter((d) => d.kind === 'morning').length, 0, t.toISOString());
  }
});

test('digest lines: more than 5 topics end with how many more are in "מה עליי"', () => {
  const rows = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((r) => ({ rule: r, key: r, title: `נושא ${r}` }));
  const lines = digestLines({ rows, max: 5 });
  assert.equal(lines.length, 5);
  assert.equal(lines[4], 'ועוד 3 נושאים ב״מה עליי״');
  const work = { overdue: [{ client: 'א', what: 'x' }, { client: 'ב', what: 'y' }], today: [{ client: 'ג', what: 'z' }] };
  assert.deepEqual(digestLines({ work, rows: [] }), ['באיחור (2): א, ב', 'היום: ג · z']);
});

test('Lior\'s lists at 12:00 and 16:00 carry his queued escalations; none while he is on a shoot', () => {
  const log = [row({ person: 'lior', status: 'queued', channel: 'digest', level: 'digest', rule: 'late', key: 'l1', title: 'באיחור: אלפא · 8 · אופיר', overdue: true })];
  const at12 = planDigests({ env: envAt(IL(2026, 10, 5, 12), office()), log, active: new Set(['l1']) });
  assert.deepEqual(at12.map((d) => [d.key, d.title]), [['digest:list12:lior:2026-10-05', 'הרשימה של 12:00']]);
  assert.deepEqual(at12[0].lines, ['באיחור: אלפא · 8 · אופיר']);
  assert.equal(planDigests({ env: envAt(IL(2026, 10, 5, 16, 20), office()), log, active: new Set(['l1']) })[0].key, 'digest:list16:lior:2026-10-05');
  assert.deepEqual(planDigests({ env: envAt(IL(2026, 10, 5, 13), office()), log, active: new Set(['l1']) }), []);
  // On a shoot at 12:00: no list; afterwards everything that waited, in one message.
  const shootWorld = office();
  shootWorld.clients[0].shoot_at = IL(2026, 10, 15, 11).toISOString();
  for (const k of Object.keys(shootWorld.checks.c1)) if (/^p1[79]b?\./.test(k)) delete shootWorld.checks.c1[k];
  // The quiet mode is a recorded flag: Eli's "הגעתי" on the day starts it.
  shootWorld.checks.c1['p17b.arrived'] = { state: 'done', at: IL(2026, 10, 15, 10, 5).toISOString(), note: null };
  const held = [...log, row({ id: 77, person: 'lior', status: 'queued', channel: 'digest', level: 'ring', rule: 'deal', key: 'l2', reason: 'shoot_mode', title: 'עסקה חדשה בלי טיפול: בטא' })];
  const during = planDigests({ env: envAt(IL(2026, 10, 15, 12), shootWorld), log: held, active: new Set(['l1', 'l2']) });
  assert.deepEqual(during, []);
  for (const k of importKeys('post').filter((x) => x.startsWith('p19.'))) shootWorld.checks.c1[k] = { state: 'done', at: IL(2026, 10, 15, 15).toISOString(), note: null };
  const after = planDigests({ env: envAt(IL(2026, 10, 15, 15, 30), shootWorld), log: held, active: new Set(['l1', 'l2']) });
  const summary = after.find((d) => d.kind === 'shoot');
  assert.equal(summary.title, 'סיכום אחרי יום הצילום');
  assert.deepEqual(summary.include.map((r) => r.key).sort(), ['l1', 'l2']);
  // At 16:05 the 16:00 list carries it: one message, not two.
  const at16 = planDigests({ env: envAt(IL(2026, 10, 15, 16, 5), shootWorld), log: held, active: new Set(['l1', 'l2']) });
  assert.deepEqual(at16.map((x) => x.kind), ['list']);
});

test('the owner: 18:00 exceptions (or "all to plan"), the weekly report on Thursday, the week ahead on Sunday 08:30', () => {
  const board = row({ person: 'owner', level: 'board', channel: 'app', status: 'sent', rule: 'weekly', key: 'b1', client_id: 'c1', created_at: IL(2026, 10, 8, 18).toISOString(), title: 'שיחה שבועית הוחמצה: אלפא' });
  const rings = [row({ person: 'irit', sent_at: IL(2026, 10, 6, 10).toISOString() }), row({ person: 'irit', sent_at: IL(2026, 10, 7, 10).toISOString() })];
  const thu = planDigests({ env: envAt(IL(2026, 10, 8, 18), office()), log: [board, ...rings], active: new Set(['b1']) });
  const d = thu.find((x) => x.person === 'owner');
  assert.equal(d.title, 'חריגות היום ודוח שבועי');
  assert.equal(d.lines[0], 'שיחה שבועית הוחמצה: אלפא');
  assert.ok(d.lines.includes('דוח שבועי:'));
  assert.ok(d.lines.includes('צלצולים השבוע: עירית 2'), d.lines.join('\n'));
  assert.ok(d.lines.some((l) => /^לא מחוברים להתראות: 4$/.test(l)), d.lines.join('\n'));
  const mon = planDigests({ env: envAt(IL(2026, 10, 5, 18), office()), log: [], active: new Set() }).find((x) => x.person === 'owner');
  assert.deepEqual(mon.lines, ['הכול לפי התוכנית.']);
  assert.equal(mon.title, 'חריגות היום');
  // Sunday 08:30: the week ahead.
  const world = office();
  world.clients[0].char_at = IL(2026, 10, 6, 10).toISOString();
  world.clients[1].shoot_at = IL(2026, 10, 7, 11).toISOString();
  const sun = planDigests({ env: envAt(IL(2026, 10, 4, 8, 30), world), log: [], active: new Set() }).find((x) => x.kind === 'week');
  assert.equal(sun.key, 'digest:week:owner:2026-10-04');
  assert.ok(sun.lines.includes('אפיונים (1): אלפא'), sun.lines.join('\n'));
  assert.ok(sun.lines.includes('ימי צילום (1): בטא'), sun.lines.join('\n'));
  assert.equal(planDigests({ env: envAt(IL(2026, 10, 5, 8, 30), world), log: [], active: new Set() }).filter((x) => x.kind === 'week').length, 0);
  assert.deepEqual(weekAhead(envAt(IL(2026, 10, 11, 8, 30), office()), IL(2026, 10, 11, 8, 30)), ['אין אירועים מתוכננים השבוע.']);
  // Sunday 3.10.2027 is Rosh Hashana: the week ahead comes on Monday.
  const rh = (d) => planDigests({ env: envAt(d, office()), log: [], active: new Set() }).filter((x) => x.kind === 'week').length;
  assert.equal(rh(IL(2027, 10, 3, 8, 30)), 0);
  assert.equal(rh(IL(2027, 10, 4, 8, 30)), 1);
  assert.equal(rh(IL(2027, 10, 5, 8, 30)), 0);
});

test('the whole morning: a tick at 08:30 queues what came overnight and the digest carries it', () => {
  const w = office();
  w.clients.push({ id: 'c3', name: 'גמא', status: 'active', shoot_type: 'dms', characterizer: 'ofir', has_logo: true, rounds: [], contract_end: '2027-12-31', deal_at: IL(2026, 10, 4, 22).toISOString() });
  // Sunday 22:00 deal; Monday 08:30: the "now" step (22:00, queued at night) and the 09:05 step (folded).
  const night = IL(2026, 10, 4, 22);
  const envN = envAt(night, w);
  const atNight = planDelivery({ reminders: computeReminders({ env: envN }), now: night, log: [] });
  const nowStep = atNight.find((r) => r.key === 'deal:c3:deal:now@irit');
  assert.deepEqual([nowStep.status, nowStep.reason], ['queued', 'quiet_hours']);
  const morning = IL(2026, 10, 5, 8, 30);
  const env = envAt(morning, w);
  const all = candidates(env);
  const log = [{ ...nowStep, id: 1, client_id: 'c3' }];
  const look = computeReminders({ env, log, until: IL(2026, 10, 5, 9, 30) });
  const d = planDigests({ env, now: morning, log, active: new Set(all.map((r) => r.key)), lookahead: look }).find((x) => x.person === 'irit');
  assert.deepEqual(d.include.map((r) => r.key), ['deal:c3:deal:now@irit']);
  assert.deepEqual(d.fold.map((r) => r.key).sort(), ['deal:c3:deal:due@irit']);
  assert.ok(d.lines.some((l) => l.includes('גמא')), d.lines.join('\n'));
});

test('Lior\'s shoot day never closed: no summary at midnight; the next morning\'s digest carries what waited, once', () => {
  const w = office();
  w.clients[0].shoot_at = IL(2026, 10, 14, 11).toISOString(); // Wednesday
  for (const k of Object.keys(w.checks.c1)) if (/^p1[79]b?\./.test(k)) delete w.checks.c1[k];
  // The quiet mode is a recorded flag: Eli's "הגעתי" on the day starts it.
  w.checks.c1['p17b.arrived'] = { state: 'done', at: IL(2026, 10, 14, 10, 5).toISOString(), note: null };
  const held = [row({ id: 90, person: 'lior', status: 'queued', channel: 'digest', level: 'ring', rule: 'deal', key: 'h1', reason: 'shoot_mode', created_at: IL(2026, 10, 14, 12).toISOString(), title: 'עסקה חדשה בלי טיפול: בטא' })];
  assert.equal(buildEnv({ ...w, staff: STAFF, now: IL(2026, 10, 14, 23, 59) }).liorShoot.active, true);
  // 00:00: the shoot day is over, but it is the middle of the night.
  assert.deepEqual(planDigests({ env: envAt(IL(2026, 10, 15, 0, 0), w), log: held, active: new Set(['h1']) }), []);
  // 08:30: his morning digest carries it; no second message with the same lines.
  const morning = planDigests({ env: envAt(IL(2026, 10, 15, 8, 30), w), log: held, active: new Set(['h1']) }).filter((d) => d.person === 'lior');
  assert.deepEqual(morning.map((d) => d.kind), ['morning']);
  assert.deepEqual(morning[0].include.map((r) => r.key), ['h1']);
  // Closed at 21:00 on the shoot day itself: the summary goes out then (a shoot-day event).
  for (const k of importKeys('post').filter((x) => x.startsWith('p19.'))) w.checks.c1[k] = { state: 'done', at: IL(2026, 10, 14, 21).toISOString(), note: null };
  assert.deepEqual(planDigests({ env: envAt(IL(2026, 10, 14, 21, 1), w), log: held, active: new Set(['h1']) }).map((d) => d.kind), ['shoot']);
});

test('decision 8: the exceptions Ofir took on Lior\'s shoot day are in Lior\'s summary after it', () => {
  const w = office();
  w.clients[0].shoot_at = IL(2026, 10, 14, 11).toISOString();
  for (const k of Object.keys(w.checks.c1)) if (/^p1[79]b?\./.test(k)) delete w.checks.c1[k];
  for (const k of importKeys('post').filter((x) => x.startsWith('p19.'))) w.checks.c1[k] = { state: 'done', at: IL(2026, 10, 14, 15).toISOString(), note: null };
  // Held during the day: the copy of an urgent task that went to Ofir (the task is done by now).
  const copy = row({ id: 91, person: 'lior', status: 'queued', channel: 'digest', level: 'ring', rule: 'urgent', key: 'urgent:c2:t9:now@lior+shoot', reason: 'shoot_mode', client_id: 'c2', created_at: IL(2026, 10, 14, 12).toISOString(), title: 'הועבר לאופיר · משימה דחופה: בטא' });
  const after = planDigests({ env: envAt(IL(2026, 10, 14, 15, 30), w), log: [copy], active: new Set() });
  const summary = after.find((d) => d.kind === 'shoot');
  assert.ok(summary, JSON.stringify(after));
  assert.deepEqual(summary.lines, ['הועבר לאופיר · משימה דחופה: בטא']);
  assert.deepEqual(summary.include.map((r) => r.key), ['urgent:c2:t9:now@lior+shoot']);
});

test('erev chag: the office closes at 13:00, and so do the rings and Lior\'s 16:00 list; the owner\'s 18:00 stays', () => {
  const erev = (h, m = 0) => IL(2027, 4, 21, h, m); // Wednesday, erev Pesach
  assert.deepEqual(plan([ring('irit', erev(12, 59))], erev(12, 59)).map((r) => r.status), ['sent']);
  const [late] = plan([ring('irit', erev(14))], erev(14));
  assert.deepEqual([late.status, late.reason], ['queued', 'quiet_hours']);
  // A shoot-day event still goes out.
  assert.equal(plan([ring('lior', erev(17), { shoot: true, exempt: 'shoot' })], erev(17))[0].status, 'sent');
  const log = [row({ person: 'lior', status: 'queued', channel: 'digest', level: 'digest', rule: 'late', key: 'l1', title: 'באיחור: אלפא' })];
  assert.equal(planDigests({ env: envAt(erev(12), office()), log, active: new Set(['l1']) })[0].key, 'digest:list12:lior:2027-04-21');
  assert.deepEqual(planDigests({ env: envAt(erev(16), office()), log, active: new Set(['l1']) }), []);
  // A normal day's 16:00 list is untouched.
  assert.equal(planDigests({ env: envAt(IL(2027, 4, 20, 16), office()), log, active: new Set(['l1']) })[0].key, 'digest:list16:lior:2027-04-20');
});

test('the weekly report comes on the last business day of the week when Thursday is a holiday', () => {
  // Thursday 22.4.2027 is Pesach: the report is in Wednesday's 18:00 digest.
  const wed = planDigests({ env: envAt(IL(2027, 4, 21, 18), office()), log: [], active: new Set() }).find((d) => d.person === 'owner');
  assert.equal(wed.title, 'חריגות היום ודוח שבועי');
  assert.ok(wed.lines.includes('דוח שבועי:'), wed.lines.join('\n'));
  // An ordinary Wednesday has none.
  const plainWed = planDigests({ env: envAt(IL(2026, 10, 7, 18), office()), log: [], active: new Set() }).find((d) => d.person === 'owner');
  assert.equal(plainWed.title, 'חריגות היום');
});

test('the owner\'s Sunday 08:30 digest carries what waited for him over the weekend', () => {
  const waited = row({ id: 95, person: 'owner', status: 'queued', channel: 'digest', level: 'ring', rule: 'renewal', key: 'renewal:c1:p34@2026-11-07:owner30@owner', reason: 'quiet_hours', client_id: 'c1', created_at: IL(2026, 10, 10, 10).toISOString(), title: 'חידוש בלי שיחה, 30 יום לפני הסיום: אלפא' });
  const sun = planDigests({ env: envAt(IL(2026, 10, 11, 8, 30), office()), log: [waited], active: new Set([waited.key]) }).find((d) => d.kind === 'week');
  assert.equal(sun.lines[0], 'חידוש בלי שיחה, 30 יום לפני הסיום: אלפא');
  assert.deepEqual(sun.include.map((r) => r.key), [waited.key]);
});
