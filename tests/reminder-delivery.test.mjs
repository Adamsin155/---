// What happens to each reminder step at the moment it is due (app/reminder-engine.js):
// the sending hours (Sunday–Thursday 08:30–19:00, not on holidays; shoot-day
// events go out anyway), Lior's shoot day, stale steps, and the digests: 08:30
// for everyone (up to 5 lines, late first, with what is due 09:00–09:30), Lior's
// lists at 12:00 and 16:00, the owner's 18:00 (with the weekly report on Thursday)
// and the first business day's 08:30 week ahead. Israel times; run under 3 zones.
// Since the owner's rule of 7.10.2026 ("אין הודעות שקטות, הכל מקבל התראה לפלאפון";
// docs/ops.md, section 40): every step of every rule reaches the phone, there is no
// daily cap, and the lateness notes go out in batches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planDelivery, planDigests, lateBatches, buildEnv, digestLines, candidates, computeReminders, weekAhead, pushPayload, pushTag, summaryOf } from '../app/reminder-engine.js';
import { pushLines } from '../app/day-summary.js';
import * as rulesModule from '../app/reminder-rules.js';
import * as engineModule from '../app/reminder-engine.js';
import { RULES, LATE_BATCH_MINUTES, SEND_HOURS, BURST_MAX } from '../app/reminder-rules.js';
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

test('the daily cap is gone (7.10.2026): the seventh ring of a day, and the twentieth, still go to the phone', () => {
  const now = IL(2026, 10, 5, 15);
  // Six ordinary rings already went to Irit today (what used to fill the cap), and more.
  const log = Array.from({ length: 12 }, () => row({ person: 'irit' }));
  const out = plan([ring('irit', now), ring('irit', now, { exempt: 'clock' }), ring('irit', now, { exempt: 'urgent' }), ring('lior', now)], now, log);
  assert.deepEqual(out.map((r) => [r.channel, r.status, r.reason]), Array(4).fill(['push', 'sent', null]));
  // Minute after minute through the day, twenty more: every one goes to the phone.
  const fresh = Array.from({ length: 20 }, (_, i) => plan([ring('ofir', new Date(now.getTime() + i * 6e4))], new Date(now.getTime() + i * 6e4), log)[0]);
  assert.equal(fresh.filter((r) => r.channel === 'push' && r.status === 'sent').length, 20);
  assert.equal([...out, ...fresh].filter((r) => r.reason === 'cap').length, 0);
  // Nothing is left of it in the code: no constant, no counter.
  assert.equal('DAILY_CAP' in rulesModule, false);
  assert.equal('ringsToday' in engineModule, false);
  for (const f of ['../app/reminder-engine.js', '../supabase/functions/reminders/tick.js']) {
    assert.doesNotMatch(readFileSync(new URL(f, import.meta.url), 'utf8'), /'cap'|DAILY_CAP/, f);
  }
});

test('levels (7.10.2026): a ring and an update are pushed, a digest line and a lateness note wait for their one push, stale steps are never sent late', () => {
  const now = IL(2026, 10, 5, 12);
  const out = plan([
    ring('irit', now, { level: 'quiet' }), ring('owner', now, { level: 'board' }), ring('lior', now, { level: 'digest' }),
    ring('irit', new Date(now - 6 * 36e5 - 6e4)), ring('irit', new Date(now - 5 * 36e5)), ring('ofir', now, { level: 'quiet', batch: true }),
    ring('irit', new Date(now - 6 * 36e5 - 6e4), { level: 'quiet' }),
  ], now);
  assert.deepEqual(out.map((r) => `${r.level}:${r.channel}:${r.status}:${r.reason}`).sort(), [
    'ring:app:suppressed:stale', 'quiet:app:suppressed:stale', 'ring:push:sent:null', 'quiet:push:sent:null', 'board:app:sent:null', 'digest:digest:queued:null', 'quiet:digest:queued:batch',
  ].sort());
});

test('sending hours hold for updates too: nobody is pushed at night or on a closed day; what waited is in the morning digest', () => {
  assert.deepEqual(SEND_HOURS, { from: 8 * 60 + 30, to: 19 * 60, erevTo: 13 * 60 });
  const cases = [
    [IL(2026, 10, 5, 8, 29), 'queued'], [IL(2026, 10, 5, 8, 30), 'sent'], [IL(2026, 10, 5, 18, 59), 'sent'], [IL(2026, 10, 5, 19, 0), 'queued'],
    [IL(2026, 10, 5, 23, 30), 'queued'], [IL(2026, 10, 6, 3, 0), 'queued'], [IL(2026, 10, 9, 11), 'queued'], [IL(2026, 10, 10, 11), 'queued'],
    [IL(2026, 9, 21, 11), 'queued'], [IL(2027, 4, 21, 12, 59), 'sent'], [IL(2027, 4, 21, 13, 0), 'queued'],
  ];
  for (const [now, status] of cases) {
    for (const o of [{ level: 'quiet' }, { level: 'quiet', batch: true }, { level: 'ring' }]) {
      const [r] = plan([ring('irit', now, o)], now);
      const want = status === 'sent' ? (o.batch ? 'digest:queued:batch' : 'push:sent:null') : 'digest:queued:quiet_hours';
      assert.equal(`${r.channel}:${r.status}:${r.reason}`, want, `${now.toISOString()} ${JSON.stringify(o)}`);
    }
  }
  // The exemptions that existed stay: a shoot-day event, and a rule with its own hours.
  for (const o of [{ shoot: true, exempt: 'shoot' }, { ownHours: true }, { level: 'quiet', ownHours: true }]) {
    assert.equal(plan([ring('irit', IL(2026, 10, 5, 23), o)], IL(2026, 10, 5, 23))[0].channel, 'push', JSON.stringify(o));
  }
  // An update that came at 21:00 (to Stav of sales too): one line of the 08:30 digest, once.
  const night = IL(2026, 10, 5, 21);
  const staff = [...STAFF, { email: 'stav@x', person: 'stav' }];
  const waited = ['irit', 'stav'].map((p, i) => ({ ...plan([ring(p, night, { level: 'quiet', title: `עדכון ל${p}` })], night)[0], id: 500 + i, created_at: night.toISOString() }));
  const morning = IL(2026, 10, 6, 8, 30);
  const digests = planDigests({ env: buildEnv({ clients: [], checks: {}, tasks: [], staff, now: morning }), log: waited, active: new Set(waited.map((r) => r.key)) });
  assert.deepEqual(digests.filter((d) => d.key).map((d) => [d.person, d.kind, d.lines, d.include.length]).sort(), [
    ['irit', 'morning', ['עדכון לirit'], 1], ['stav', 'morning', ['עדכון לstav'], 1],
  ]);
  // Before the window opens there is no digest: nothing at 07:00.
  assert.deepEqual(planDigests({ env: buildEnv({ clients: [], checks: {}, tasks: [], staff, now: IL(2026, 10, 6, 7) }), log: waited, active: new Set(waited.map((r) => r.key)) }), []);
});

test('the owner\'s board reaches his phone in his digest: at once on his screen until his end-of-day message (19:00), and from then on it waits for the next one', () => {
  const board = (now) => plan([ring('owner', now, { level: 'board', title: 'חריגה' })], now)[0];
  assert.deepEqual([board(IL(2026, 10, 5, 18, 59)).channel, board(IL(2026, 10, 5, 18, 59)).status], ['app', 'sent']);
  for (const now of [IL(2026, 10, 5, 19, 0), IL(2026, 10, 5, 19, 20), IL(2026, 10, 5, 22), IL(2026, 10, 9, 11), IL(2026, 10, 10, 11)]) {
    const r = board(now);
    assert.deepEqual([r.channel, r.status, r.reason], ['digest', 'queued', 'owner_digest'], now.toISOString());
  }
  // 17:30: the 19:00 message carries it, under the day's numbers. 19:20, after it went out: tomorrow's does.
  const early = { ...board(IL(2026, 10, 5, 17, 30)), id: 601, created_at: IL(2026, 10, 5, 17, 30).toISOString() };
  const at19 = planDigests({ env: envAt(IL(2026, 10, 5, 19), office()), log: [early], active: new Set([early.key]) }).find((d) => d.person === 'owner');
  assert.deepEqual(at19.lines.slice(-2), ['עוד מהיום:', 'חריגה']);
  assert.equal(planDigests({ env: envAt(IL(2026, 10, 5, 18), office()), log: [early], active: new Set([early.key]) }).filter((d) => d.person === 'owner').length, 0);
  const late = { ...board(IL(2026, 10, 5, 19, 20)), id: 602, created_at: IL(2026, 10, 5, 19, 20).toISOString() };
  const next = planDigests({ env: envAt(IL(2026, 10, 6, 19), office()), log: [late], active: new Set([late.key]) }).find((d) => d.person === 'owner');
  assert.deepEqual([next.lines.slice(-2), next.include.map((r) => r.id)], [['עוד מהיום:', 'חריגה'], [602]]);
  // One that came on Friday: the first business day's 08:30 "week ahead".
  const fri = { ...board(IL(2026, 10, 9, 11)), id: 603, created_at: IL(2026, 10, 9, 11).toISOString() };
  const sun = planDigests({ env: envAt(IL(2026, 10, 11, 8, 30), office()), log: [fri], active: new Set([fri.key]) }).find((d) => d.kind === 'week');
  assert.equal(sun.lines[0], 'חריגה');
});

// ── The owner's rule of 7.10.2026: everything reaches the phone ─────────────
// The steps that stay in the app only, each with its reason, for the owner's decision.
// It is empty: the rule is literal ("אין הודעות שקטות"). A step added here must say why.
const IN_APP_ONLY = new Map([
  // ['rule.step', 'the reason'],
]);
const LEVELS = ['ring', 'quiet', 'digest', 'board'];
// Where a step of a level goes on an ordinary working noon: 'push' (its own
// notification), 'batch' (one push with the other lateness notes), 'digest' (a line
// of the person's next digest, which is one push), or 'app' (the app only).
function phoneRoute(step) {
  const now = IL(2026, 10, 5, 12);
  const [r] = plan([ring(step.to === 'owner' || step.level === 'board' ? 'owner' : 'irit', now, { level: step.level, batch: !!step.batch, shoot: !!step.shoot, ownHours: !!step.ownHours, exempt: step.exempt || null })], now);
  if (r.channel === 'push' && r.status === 'sent') return 'push';
  if (r.channel === 'digest' && r.status === 'queued') return r.reason === 'batch' ? 'batch' : 'digest';
  if (r.level === 'board' && r.channel === 'app') {
    // On the owner's screen now; his end-of-day message of the same day carries it to the phone.
    const sent = { ...r, id: 700, created_at: now.toISOString() };
    const d = planDigests({ env: envAt(IL(2026, 10, 5, 19), office()), log: [sent], active: new Set([sent.key]) }).find((x) => x.person === 'owner');
    return d?.lines.includes(sent.title) ? 'digest' : 'app';
  }
  return 'app';
}
test('every step of every rule reaches the phone: no step is in the app only (the allow-list is empty)', () => {
  const seen = { push: 0, batch: 0, digest: 0 };
  const check = (id, step) => {
    assert.ok(LEVELS.includes(step.level), `${id}: level ${step.level}`);
    const route = phoneRoute(step);
    if (IN_APP_ONLY.has(id)) { assert.equal(route, 'app', `${id} is listed as in the app only but is sent`); return; }
    assert.notEqual(route, 'app', `${id} would stay in the app only: push it, or list it in IN_APP_ONLY with a reason`);
    seen[route] += 1;
  };
  const ids = new Set();
  for (const rule of RULES) {
    if (Array.isArray(rule.steps)) {
      for (const s of rule.steps) { ids.add(`${rule.id}.${s.id}`); check(`${rule.id}.${s.id}`, s); }
      continue;
    }
    // Steps computed per case: every level its code can give (the helper of the daily
    // digest lines is read with it), with and without the flags it sets.
    const src = `${rule.steps}${/dailyDigest\(/.test(String(rule.steps)) ? " level: 'digest'" : ''}`;
    const levels = [...src.matchAll(/level: '([a-z]+)'/g)].map((m) => m[1]);
    assert.ok(levels.length > 0, `${rule.id}: no level found in its computed steps`);
    for (const level of new Set(levels)) {
      ids.add(`${rule.id}.*`);
      for (const flags of [{}, { shoot: true }, { ownHours: true }, { batch: /batch: true/.test(src) }]) check(`${rule.id}.(computed, ${level})`, { level, ...flags });
    }
  }
  for (const id of IN_APP_ONLY.keys()) assert.ok(ids.has(id), `IN_APP_ONLY names ${id}, which is not a step`);
  assert.equal(IN_APP_ONLY.size, 0);
  assert.ok(seen.push > 60 && seen.batch >= 4 && seen.digest > 30, JSON.stringify(seen));
  // And every `level:` written in the rule files is one of the four (none slipped past the walk).
  for (const f of ['reminder-rules.js', 'status-rules.js', 'year-rules.js']) {
    const text = readFileSync(new URL(`../app/${f}`, import.meta.url), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    for (const m of text.matchAll(/\blevel: '([a-z]+)'/g)) assert.ok(LEVELS.includes(m[1]), `${f}: level '${m[1]}'`);
  }
  // No path of the engine itself ends in the app, whatever the hour, but the owner's
  // board before his end-of-day message (above) and a step too old to send.
  for (const now of [IL(2026, 10, 5, 12), IL(2026, 10, 5, 22), IL(2026, 10, 9, 11), IL(2026, 10, 5, 19, 30)]) {
    for (const level of LEVELS) {
      for (const o of [{}, { batch: true }, { shoot: true }, { ownHours: true }, { copy: true }]) {
        for (const person of ['irit', 'lior', 'owner']) {
          const [r] = plan([ring(person, now, { level, ...o })], now, [], { active: true, cids: new Set(['c1']) });
          if (level === 'board' && !o.copy && now.getTime() === IL(2026, 10, 5, 12).getTime()) continue;
          assert.notEqual(r.channel, 'app', `${level} ${JSON.stringify(o)} ${person} ${now.toISOString()}`);
        }
      }
    }
  }
});

// ── The lateness notes go out in batches ───────────────────────────────────
const lateNote = (person, at, o = {}) => {
  const [r] = plan([ring(person, at, { level: 'quiet', batch: true, rule: 'late', overdue: true, title: `באיחור: לקוח ${(n += 1)} · 12 · תסריטים · ליאור`, body: 'היעד היה היום 10:00.', url: `client.html?id=c${n}#p12`, ...o })], at);
  return { ...r, id: n, client_id: null, created_at: at.toISOString() };
};
// What the tick does with a batch: its row in the log, and its notes marked as sent in it.
function sendBatch(log, d, now) {
  for (const r of log) if (d.include.some((x) => x.id === r.id)) Object.assign(r, { status: 'sent', channel: 'digest', reason: 'batch', digest_key: d.key, sent_at: now.toISOString() });
  log.push({ id: (n += 1), key: d.key, rule: 'digest', person: d.person, level: 'digest', channel: 'push', status: 'sent', created_at: now.toISOString(), sent_at: now.toISOString(), title: d.title, body: d.body });
}
const batchesAt = (now, log, extra = {}) => planDigests({ env: envAt(now, extra), now, log, active: new Set(log.map((r) => r.key)) }).filter((d) => d.kind === 'late');

test('lateness notes: the first goes to the phone at once, the next ones together half an hour later; one push per person, each note its own row', () => {
  assert.equal(LATE_BATCH_MINUTES, 30);
  const log = [];
  const t0 = IL(2026, 10, 5, 10, 15);
  // One late item, to Ofir and to Lior: a note each, queued for its batch, never pushed by itself.
  log.push(lateNote('ofir', t0), lateNote('lior', t0));
  assert.ok(log.every((r) => r.status === 'queued' && r.reason === 'batch' && r.channel === 'digest'));
  const first = batchesAt(t0, log);
  assert.deepEqual(first.map((d) => d.person).sort(), ['lior', 'ofir']);
  const ofir = first.find((d) => d.person === 'ofir');
  // A single note is sent as itself: its own title, its own link.
  assert.deepEqual([ofir.title, ofir.lines, ofir.url, ofir.include.length], [log[0].title, ['היעד היה היום 10:00.'], log[0].url, 1]);
  assert.match(ofir.key, /^digest:late:ofir:2026-10-05:\d+$/);
  for (const d of first) sendBatch(log, d, t0);
  // The same minute again (an overlapping tick): nothing more, the notes are sent and the key is taken.
  assert.deepEqual(batchesAt(t0, log), []);
  // 10:20, 10:31, 10:40: three more for Ofir. Not yet: half an hour has not passed.
  for (const m of [20, 31, 40]) log.push(lateNote('ofir', IL(2026, 10, 5, 10, m)));
  for (const m of [20, 31, 40, 44]) assert.deepEqual(batchesAt(IL(2026, 10, 5, 10, m), log.filter((r) => new Date(r.created_at) <= IL(2026, 10, 5, 10, m))), [], `10:${m}`);
  // 10:45: one push for the three.
  const t1 = IL(2026, 10, 5, 10, 45);
  const second = batchesAt(t1, log);
  assert.equal(second.length, 1);
  const b = second[0];
  assert.equal(b.title, '3 איחורים חדשים');
  assert.equal(b.lines.length, 4);
  assert.match(b.lines[0], /^לקוח \d+ · 12 · תסריטים · ליאור$/);
  assert.equal(b.lines[3], 'היום עד עכשיו: 4 איחורים. הכול ב״התראות״.');
  assert.equal(b.url, 'clients.html#mine');
  assert.equal(b.include.length, 3);
  assert.equal(b.body, b.lines.join('\n'));
  sendBatch(log, b, t1);
  // No note was lost: every one of the five is marked sent in exactly one batch.
  const notes = log.filter((r) => r.rule === 'late');
  assert.equal(notes.length, 5);
  assert.ok(notes.every((r) => r.status === 'sent' && r.reason === 'batch' && /^digest:late:/.test(r.digest_key)));
  assert.equal(log.filter((r) => r.rule === 'digest' && r.person === 'ofir').length, 2, 'two pushes for four notes');
  // More than four in one batch: the first four and how many more.
  const many = Array.from({ length: 7 }, () => lateNote('ofir', IL(2026, 10, 5, 12)));
  const [big] = batchesAt(IL(2026, 10, 5, 12), many);
  assert.equal(big.title, '7 איחורים חדשים');
  assert.deepEqual([big.lines.length, big.lines[4]], [5, 'ועוד 3']);
  // On the phone the batches of one person share a tag: each replaces the one before and sounds again.
  assert.equal(pushTag(b.key), 'digest:late:ofir');
  assert.equal(JSON.parse(pushPayload({ key: b.key, title: b.title, body: b.body, url: b.url, level: 'digest' })).renotify, true);
});

test('lateness notes: not at night and not on Lior\'s shoot day; a digest of that minute carries them; one that was done meanwhile is dropped', () => {
  // Queued at 18:50; at 19:20 the sending hours are over: no push. The 08:30 digest carries it.
  const a = lateNote('ofir', IL(2026, 10, 5, 18, 50));
  const sent = { id: 801, key: 'digest:late:ofir:2026-10-05:1', rule: 'digest', person: 'ofir', status: 'sent', channel: 'push', level: 'digest', created_at: IL(2026, 10, 5, 18, 45).toISOString() };
  assert.deepEqual(batchesAt(IL(2026, 10, 5, 19, 20), [a, sent]), []);
  const morning = planDigests({ env: envAt(IL(2026, 10, 6, 8, 30)), log: [a, sent], active: new Set([a.key]) }).filter((d) => d.key);
  assert.deepEqual(morning.map((d) => [d.person, d.kind, d.include.map((r) => r.id)]), [['ofir', 'morning', [a.id]]]);
  // Later in the digest's hour (the digest already went out) a new note is not held by it.
  const digestRow = { id: 802, key: 'digest:morning:ofir:2026-10-06', rule: 'digest', person: 'ofir', status: 'sent', channel: 'push', level: 'digest', created_at: IL(2026, 10, 6, 8, 30).toISOString() };
  const b = lateNote('ofir', IL(2026, 10, 6, 9, 15));
  assert.deepEqual(batchesAt(IL(2026, 10, 6, 9, 15), [digestRow, b]).map((d) => d.include.map((r) => r.id)), [[b.id]]);
  // Lior's 12:00 list of this minute carries his note: one push, not two.
  const l = lateNote('lior', IL(2026, 10, 5, 12));
  const noon = planDigests({ env: envAt(IL(2026, 10, 5, 12)), log: [l], active: new Set([l.key]) }).filter((d) => d.key);
  assert.deepEqual(noon.map((d) => [d.kind, d.include.length]), [['list', 1]]);
  // The item was done before its batch: dropped, never pushed.
  const gone = lateNote('ofir', IL(2026, 10, 5, 10, 31));
  const dropped = planDigests({ env: envAt(IL(2026, 10, 5, 10, 32)), log: [gone], active: new Set() });
  assert.deepEqual(dropped.map((d) => [d.key, d.drop.map((r) => r.id)]), [[null, [gone.id]]]);
  // Lior on a shoot: his notes wait (planDelivery holds new ones for his summary; one
  // queued before it started is not pushed during it either).
  const w = office();
  w.clients[0].shoot_at = IL(2026, 10, 15, 11).toISOString();
  for (const k of Object.keys(w.checks.c1)) if (/^p1[79]b?\./.test(k)) delete w.checks.c1[k];
  w.checks.c1['p17b.arrived'] = { state: 'done', at: IL(2026, 10, 15, 10, 5).toISOString(), note: null };
  const before = lateNote('lior', IL(2026, 10, 15, 10));
  const env = envAt(IL(2026, 10, 15, 10, 30), w);
  assert.equal(env.liorShoot.active, true);
  assert.deepEqual(lateBatches({ env, log: [before] }), []);
  const [held] = plan([ring('lior', IL(2026, 10, 15, 10, 30), { level: 'quiet', batch: true, clientId: 'c2' })], IL(2026, 10, 15, 10, 30), [], env.liorShoot);
  assert.deepEqual([held.status, held.reason], ['queued', 'shoot_mode']);
});

test('a burst: more than 4 pushes for one person in one minute are one push that lists them, the same minute; none is lost; shoot-day events are not held', () => {
  assert.equal(BURST_MAX, 4);
  const now = IL(2026, 10, 8, 12); // Thursday 12:00: "שיחה שבועית" for every client without a call
  const names = ['אלפא', 'בטא', 'גמא', 'דלתא', 'הא', 'וו', 'זין'];
  const calls = names.map((x, i) => ring('lior', now, { rule: 'weekly', step: 'thu', key: `weekly:c${i}:p31@2026-10-04:thu@lior`, clientId: `c${i}`, title: `שיחה שבועית: ${x}` }));
  // Four are four pushes; one for another person is not counted with them.
  assert.deepEqual(plan([...calls.slice(0, 4), ring('irit', now)], now).map((r) => r.channel), Array(5).fill('push'));
  // Seven, with a protocol clock and a shoot-day event of the same minute.
  const clock = ring('lior', now, { exempt: 'clock', title: 'שעון' });
  const shoot = ring('lior', now, { shoot: true, exempt: 'shoot', title: 'צילום' });
  const nag = ring('lior', now, { ownHours: true, title: 'נודניק' });
  const planned = plan([...calls, clock, shoot, nag, ring('irit', now)], now);
  const by = (t) => planned.find((r) => r.title === t);
  assert.deepEqual([by('צילום').channel, by('נודניק').channel, planned.find((r) => r.person === 'irit').channel], ['push', 'push', 'push']);
  const held = planned.filter((r) => r.reason === 'burst');
  assert.equal(held.length, 8);
  assert.ok(held.every((r) => r.person === 'lior' && r.channel === 'digest' && r.status === 'queued'));
  // The same minute: one push with all of them, the clock first, the calls as one line with a count.
  const log = held.map((r, i) => ({ ...r, id: 900 + i, client_id: r.clientId, created_at: now.toISOString() }));
  const clients = names.map((x, i) => ({ id: `c${i}`, name: x, status: 'active', rounds: [], deal_at: IL(2026, 9, 1).toISOString() }));
  // (At 12:00 Lior's list goes out too, and carries them; at 12:01, after it, the burst is its own push.)
  const at1200 = planDigests({ env: envAt(now, { clients }), now, log, active: new Set(log.map((r) => r.key)) }).filter((d) => d.key);
  assert.deepEqual(at1200.map((d) => [d.kind, d.include.length]), [['list', 8]]);
  const listRow = { id: 950, key: 'digest:list12:lior:2026-10-08', rule: 'digest', person: 'lior', status: 'sent', channel: 'push', level: 'digest', created_at: now.toISOString() };
  const at1201 = planDigests({ env: envAt(new Date(now.getTime() + 6e4), { clients }), log: [...log, listRow], active: new Set(log.map((r) => r.key)) }).filter((d) => d.kind === 'burst');
  assert.equal(at1201.length, 1);
  const b = at1201[0];
  assert.match(b.key, /^digest:burst:lior:2026-10-08:\d+$/);
  assert.deepEqual([b.title, b.url, b.include.length], ['8 הודעות חדשות', 'clients.html#mine', 8]);
  assert.deepEqual(b.lines, ['שעון', 'שיחה שבועית (31) (7): אלפא, בטא, גמא ועוד 4']);
  // Nothing of it is left waiting once the tick marks them sent; nothing more is planned.
  for (const r of log) Object.assign(r, { status: 'sent', channel: 'digest', reason: 'digest', digest_key: b.key });
  assert.deepEqual(planDigests({ env: envAt(new Date(now.getTime() + 12e4), { clients }), log: [...log, listRow], active: new Set(log.map((r) => r.key)) }).filter((d) => d.kind === 'burst'), []);
});

test('one banner per case on the phone: the steps of a ladder share a tag and sound again; a digest and a test keep their own', () => {
  assert.equal(pushTag('deal:c1:deal:now@irit'), 'deal:c1:deal');
  assert.equal(pushTag('deal:c1:deal:due@irit'), 'deal:c1:deal');
  assert.equal(pushTag('char:c1:p04@2026-10-06T08:00:00.000Z:hour@ofir'), 'char:c1:p04@2026-10-06T08:00:00.000Z');
  assert.equal(pushTag('nag:-:t1:2026-10-06.3@nadia'), 'nag:-:t1');
  assert.equal(pushTag('digest:morning:irit:2026-10-05'), 'digest:morning:irit:2026-10-05');
  assert.equal(pushTag('digest:late:lior:2026-10-05:77'), 'digest:late:lior');
  assert.equal(pushTag('test:irit@x:2026-10-05T07:00:00.000Z'), 'test:irit@x:2026-10-05T07:00:00.000Z');
  const ring1 = JSON.parse(pushPayload({ key: 'deal:c1:deal:now@irit', title: 'א', body: '', url: 'x.html', level: 'ring' }));
  assert.deepEqual([ring1.tag, ring1.renotify], ['deal:c1:deal', true]);
  const digest = JSON.parse(pushPayload({ key: 'digest:morning:irit:2026-10-05', title: 'א', body: '', url: 'x.html', level: 'digest' }));
  assert.deepEqual([digest.tag, 'renotify' in digest], ['digest:morning:irit:2026-10-05', false]);
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

test('digest lines: more than 5 topics end with how many more are in "המשימות שלי"', () => {
  const rows = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((r) => ({ rule: r, key: r, title: `נושא ${r}` }));
  const lines = digestLines({ rows, max: 5 });
  assert.equal(lines.length, 5);
  assert.equal(lines[4], 'ועוד 3 נושאים ב״המשימות שלי״');
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

test('the owner: the end-of-day message at 19:00 (the day\'s numbers, then the board), the weekly report on Thursday, the week ahead on Sunday 08:30', () => {
  const board = row({ person: 'owner', level: 'board', channel: 'app', status: 'sent', rule: 'weekly', key: 'b1', client_id: 'c1', created_at: IL(2026, 10, 8, 18).toISOString(), title: 'שיחה שבועית הוחמצה: אלפא' });
  const rings = [row({ person: 'irit', sent_at: IL(2026, 10, 6, 10).toISOString() }), row({ person: 'irit', sent_at: IL(2026, 10, 7, 10).toISOString() })];
  const thu = planDigests({ env: envAt(IL(2026, 10, 8, 19), office()), log: [board, ...rings], active: new Set(['b1']) });
  const d = thu.find((x) => x.person === 'owner');
  assert.equal(d.title, 'סיכום היום ודוח שבועי');
  assert.equal(d.key, 'digest:eod:owner:2026-10-08');
  assert.equal(d.url, 'owner.html#eod');
  assert.match(d.lines[0], /^היום/);
  assert.equal(d.lines[d.lines.indexOf('עוד מהיום:') + 1], 'שיחה שבועית הוחמצה: אלפא');
  assert.ok(d.lines.includes('דוח שבועי:'));
  assert.ok(d.lines.includes('צלצולים השבוע: עירית 2'), d.lines.join('\n'));
  assert.ok(d.lines.some((l) => /^לא מחוברים להתראות: 4$/.test(l)), d.lines.join('\n'));
  const mon = planDigests({ env: envAt(IL(2026, 10, 5, 19), office()), log: [], active: new Set() }).find((x) => x.person === 'owner');
  assert.deepEqual(mon.lines, pushLines(summaryOf(envAt(IL(2026, 10, 5, 19), office()))));
  assert.equal(mon.title, 'סיכום היום');
  // Nothing at 18:00 any more: one message a day, not two alike.
  assert.equal(planDigests({ env: envAt(IL(2026, 10, 5, 18), office()), log: [], active: new Set() }).filter((x) => x.person === 'owner').length, 0);
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

test('the weekly report still counts rings only; the updates, digests and batches pushed since 7.10.2026 are a line of their own', () => {
  const log = [
    row({ person: 'irit' }), row({ person: 'irit' }), // two rings
    row({ person: 'irit', level: 'quiet' }), // an update, pushed
    row({ person: 'irit', level: 'quiet', channel: 'digest', reason: 'batch' }), // a lateness note: in a batch, not a push of its own
    row({ person: 'irit', rule: 'digest', level: 'digest', key: 'digest:late:irit:2026-10-05:9' }), // the batch
    row({ person: 'irit', rule: 'digest', level: 'digest', key: 'digest:morning:irit:2026-10-05' }),
    row({ person: 'ofir', level: 'quiet' }),
  ];
  const d = planDigests({ env: envAt(IL(2026, 10, 8, 19), office()), log, active: new Set() }).find((x) => x.person === 'owner');
  assert.ok(d.lines.includes('צלצולים השבוע: עירית 2'), d.lines.join('\n'));
  assert.ok(d.lines.includes('כל ההודעות לטלפון השבוע (עם עדכונים ותקצירים): עירית 5, אופיר 1'), d.lines.join('\n'));
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
  // The 09:05 step (group, meeting date) and the 09:10 one (the contract).
  assert.deepEqual(d.fold.map((r) => r.key).sort(), ['deal:c3:deal:contract@irit', 'deal:c3:deal:due@irit']);
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

test('erev chag: the office closes at 13:00, and so do the rings and Lior\'s 16:00 list; the owners\' end-of-day message comes at 13:00', () => {
  const erev = (h, m = 0) => IL(2027, 4, 21, h, m); // Wednesday, erev Pesach
  assert.deepEqual(plan([ring('irit', erev(12, 59))], erev(12, 59)).map((r) => r.status), ['sent']);
  const [late] = plan([ring('irit', erev(14))], erev(14));
  assert.deepEqual([late.status, late.reason], ['queued', 'quiet_hours']);
  // A shoot-day event still goes out.
  assert.equal(plan([ring('lior', erev(17), { shoot: true, exempt: 'shoot' })], erev(17))[0].status, 'sent');
  const log = [row({ person: 'lior', status: 'queued', channel: 'digest', level: 'digest', rule: 'late', key: 'l1', title: 'באיחור: אלפא' })];
  assert.equal(planDigests({ env: envAt(erev(12), office()), log, active: new Set(['l1']) })[0].key, 'digest:list12:lior:2027-04-21');
  assert.deepEqual(planDigests({ env: envAt(erev(16), office()), log, active: new Set(['l1']) }), []);
  // The end of that day's sending window is 13:00: the owners' message goes out then, not at 19:00.
  const eod = (now) => planDigests({ env: envAt(now, office()), log: [], active: new Set() }).filter((d) => d.person === 'owner').map((d) => d.key);
  assert.deepEqual([eod(erev(12, 59)), eod(erev(13)), eod(erev(19))], [[], ['digest:eod:owner:2027-04-21'], []]);
  // A normal day's 16:00 list is untouched.
  assert.equal(planDigests({ env: envAt(IL(2027, 4, 20, 16), office()), log, active: new Set(['l1']) })[0].key, 'digest:list16:lior:2027-04-20');
});

test('the weekly report comes on the last business day of the week when Thursday is a holiday', () => {
  // Thursday 22.4.2027 is Pesach: the report is in Wednesday's end-of-day message (erev chag: at 13:00).
  const wed = planDigests({ env: envAt(IL(2027, 4, 21, 13), office()), log: [], active: new Set() }).find((d) => d.person === 'owner');
  assert.equal(wed.title, 'סיכום היום ודוח שבועי');
  assert.ok(wed.lines.includes('דוח שבועי:'), wed.lines.join('\n'));
  // An ordinary Wednesday has none.
  const plainWed = planDigests({ env: envAt(IL(2026, 10, 7, 19), office()), log: [], active: new Set() }).find((d) => d.person === 'owner');
  assert.equal(plainWed.title, 'סיכום היום');
});

test('the owner\'s Sunday 08:30 digest carries what waited for him over the weekend', () => {
  const waited = row({ id: 95, person: 'owner', status: 'queued', channel: 'digest', level: 'ring', rule: 'renewal', key: 'renewal:c1:p34@2026-11-07:owner30@owner', reason: 'quiet_hours', client_id: 'c1', created_at: IL(2026, 10, 10, 10).toISOString(), title: 'חידוש בלי שיחה, 30 יום לפני הסיום: אלפא' });
  const sun = planDigests({ env: envAt(IL(2026, 10, 11, 8, 30), office()), log: [waited], active: new Set([waited.key]) }).find((d) => d.kind === 'week');
  assert.equal(sun.lines[0], 'חידוש בלי שיחה, 30 יום לפני הסיום: אלפא');
  assert.deepEqual(sun.include.map((r) => r.key), [waited.key]);
});
