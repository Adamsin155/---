// The slow pages, fast (docs/ops.md, section 77): the history in one brief answer
// (public.protocol_log_brief, said in JS in app/log-brief.js) and the marks in one compact
// answer (public.protocol_checks_compact) leave every screen as it was. For an office the
// size of the live one, with weeks of history of every kind (sendings, notes, editing stops,
// returns, clears, rounds of shoots), what each of the three pages works out from the brief
// history is what it worked out from the whole of it:
//   - "מעבר על הלקוחות" (pass.html): every client's colour and reasons, place, and "stuck";
//   - "כל הלקוחות במבט" (owner.html): the colours, and the closed processes and the 8 weeks
//     on time (editing stops and the whole history of the rounds);
//   - "המשימות שלי" (clients.html): the newest history moment of each client.
// The test reads the pages' own lines for this (the same calls with the same arguments).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildBigWorld } from './perf-world.mjs';
import { clientState, applicableProcesses, PAUSE } from '../app/protocol-logic.js';
import {
  clientHealth, station, closedProcesses, onTimeTrend, trendSince, historyKeys, withHistory, LOG_NEEDS, historySuffixes,
} from '../app/health.js';
import { stuckOf } from '../app/pass-logic.js';
import { briefOfLog, expandChecks, compactChecks, endsIn } from '../app/log-brief.js';
import { KEPT_RPCS, planOf } from '../app/data-cache.js';

const NOW = new Date('2026-10-20T10:00:00+03:00');
const DAY = 864e5;
// A steady "random" (the same office every run).
let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (list) => list[Math.floor(rnd() * list.length)];
const iso = (ms) => `${new Date(ms).toISOString().slice(0, 19)}+00:00`;

function office() {
  const w = buildBigWorld(45);
  const clients = w.clients.filter((c) => c.status === 'active' || c.status === 'ending');
  // A second shoot round on some: their items carry "r2." and are read too.
  for (const c of clients.filter((_, i) => i % 5 === 0)) c.rounds = [{ n: 2, shoot_at: iso(NOW.getTime() - 9 * DAY) }];
  const log = [];
  let id = 1;
  for (const c of clients) {
    const procs = applicableProcesses(c);
    const keys = procs.flatMap((p) => p.items.map((i) => i.key));
    const hot = [...keys.filter((k) => /(p07\.sent|p23\.sent|p27\.notes|p07\.made|p23\.made|p24\.notify)$/.test(k)), ...procs.map(PAUSE), 'p25.return.1', 'p25.return.3', 'p23.return.2', 'r2.p25.return.1'];
    // Real marks on a third of the items, in the last six weeks (closed processes, activity).
    for (const k of keys) {
      if (rnd() < 0.33 && !w.protocol_checks.some((r) => r.client_id === c.id && r.item_key === k)) {
        w.protocol_checks.push({ client_id: c.id, item_key: k, state: rnd() < 0.9 ? 'done' : 'na', note: null, by_email: pick(['irit@x.test', 'lior@x.test', 'nadia@x.test']), at: iso(NOW.getTime() - rnd() * 42 * DAY) });
      }
    }
    // Rounds of corrections inside the three weeks on every third client (the colour's "סבב תיקונים").
    if (clients.indexOf(c) % 3 === 0) {
      for (const [k, n] of [['p07.sent', 3], ['p23.sent', 3], ['p27.notes', 2]]) {
        for (let j = 0; j < n; j += 1) log.push({ id: id++, client_id: c.id, item_key: k, action: 'done', note: null, by_email: 'lior@x.test', at: iso(NOW.getTime() - (2 + j * 4) * DAY) });
      }
    }
    // Ninety days of history: half of it on the items the screens read, a clear soon after some.
    for (let i = 0; i < 70; i += 1) {
      const key = rnd() < 0.5 ? pick(hot) : pick(keys);
      const at = NOW.getTime() - rnd() * 90 * DAY;
      const by = pick(['irit@x.test', 'lior@x.test', 'nadia@x.test']);
      log.push({ id: id++, client_id: c.id, item_key: key, action: rnd() < 0.8 ? 'done' : 'na', note: rnd() < 0.1 ? 'ייבוא' : null, by_email: by, at: iso(at) });
      if (rnd() < 0.3) log.push({ id: id++, client_id: c.id, item_key: key, action: 'clear', note: null, by_email: by, at: iso(at + rnd() * 2 * DAY) });
    }
  }
  const checks = {};
  for (const r of w.protocol_checks) (checks[r.client_id] ||= {})[r.item_key] = r;
  return { clients, checks, log: log.sort((a, b) => new Date(a.at) - new Date(b.at) || a.id - b.id), rows: w.protocol_checks };
}
const strip = (rows) => rows.map(({ id, ...r }) => r); // the old reads did not ask for the id
const json = (x) => JSON.stringify(x);

test('the pages ask for what they read: the pass, the owner\'s screens and "המשימות שלי"', () => {
  const src = (f) => readFileSync(new URL(`../app/${f}`, import.meta.url), 'utf8');
  assert.match(src('pass.js'), /loadLogBrief\(since21, \{ suffixes: LOG_NEEDS \}\)\.then\(\(brief\) => brief \?\? loadAllLog\(since21\)\)/);
  assert.match(src('owner.js'), /loadLogBrief\(since, \{ suffixes: LOG_NEEDS, history: historySuffixes\(\) \}\)/);
  assert.match(src('clients.js'), /loadLogBrief\(since21\)\.then\(\(brief\) => brief \?\? loadAllLog\(since21\)\)/);
  // The answers are kept as the tables' were (a call on neither list would be taken for a write).
  assert.ok(KEPT_RPCS.has('protocol_checks_compact') && KEPT_RPCS.has('protocol_log_brief'));
  const base = 'https://x.supabase.co';
  assert.equal(planOf(base, { url: `${base}/rest/v1/rpc/protocol_log_brief`, method: 'POST', body: '{"p_since":"2026-10-01T07:00:00.000Z"}' }).kind, 'keep');
});

test('the pass: colours, places and "stuck" from the brief history are those from three whole weeks', () => {
  const o = office();
  const since = new Date(NOW.getTime() - 21 * DAY).toISOString();
  const whole = strip(o.log.filter((r) => new Date(r.at) >= new Date(since)));
  const brief = briefOfLog(o.log, { since, suffixes: LOG_NEEDS });
  assert.ok(brief.length < whole.length, `${brief.length} of ${whole.length}`);
  let revisions = 0;
  for (const c of o.clients) {
    const s = clientState(c, o.checks[c.id] || {}, NOW);
    const ex = (log) => ({ now: NOW, checks: o.checks[c.id] || {}, tasks: [], messages: [], log: log.filter((r) => r.client_id === c.id), access: [], statusNotes: [], dateChanges: [] });
    assert.equal(json(clientHealth(c, s, ex(brief))), json(clientHealth(c, s, ex(whole))), c.name);
    assert.equal(json(station(c, s, ex(brief))), json(station(c, s, ex(whole))), c.name);
    assert.equal(json(stuckOf(c, s, ex(brief), NOW)), json(stuckOf(c, s, ex(whole), NOW)), c.name);
    revisions += clientHealth(c, s, ex(whole)).reasons.filter((r) => r.code === 'revision').length;
  }
  assert.ok(revisions > 0, 'the office has rounds of corrections to count');
});

test('the owner\'s screens: colours, closed processes and the weeks on time are those of the whole history', () => {
  const o = office();
  const since = new Date(Math.min(+trendSince(NOW), NOW.getTime() - 30 * DAY)).toISOString();
  const hist = historyKeys(o.clients);
  // Before: eight weeks, and the whole history of the rounds' items (loadAllLog, loadLogFor).
  const before = withHistory(strip(o.log.filter((r) => new Date(r.at) >= new Date(since))), strip(o.log.filter((r) => hist.includes(r.item_key))), hist);
  // Now: one answer, its window's part with the whole history of those items in place of it (app/owner.js).
  const answer = briefOfLog(o.log, { since, suffixes: LOG_NEEDS, history: historySuffixes() });
  const now = withHistory(answer.filter((r) => new Date(r.at).getTime() >= new Date(since).getTime()), answer, hist);
  assert.ok(now.length < before.length);
  const stateOf = (c) => clientState(c, o.checks[c.id] || {}, NOW);
  for (const c of o.clients) {
    const ex = (log) => ({ now: NOW, checks: o.checks[c.id] || {}, tasks: [], messages: [], log: log.filter((r) => r.client_id === c.id), access: [], statusNotes: [], dateChanges: [] });
    assert.equal(json(clientHealth(c, stateOf(c), ex(now))), json(clientHealth(c, stateOf(c), ex(before))), c.name);
  }
  const closed = (log) => closedProcesses(o.clients, { stateOf, checksByClient: o.checks, since: trendSince(NOW), now: NOW, log });
  assert.equal(json(closed(now)), json(closed(before)));
  assert.equal(json(onTimeTrend(closed(now), NOW)), json(onTimeTrend(closed(before), NOW)));
  assert.ok(closed(before).some((x) => x.paused > 0), 'editing stops are counted');
  // Every key historyKeys() can name ends in one of the endings asked for.
  for (const k of hist) assert.ok(historySuffixes().some((s) => endsIn(k, s)), k);
});

test('"המשימות שלי": the newest history moment of each client is the same', () => {
  const o = office();
  const since = new Date(NOW.getTime() - 21 * DAY).toISOString();
  const lastOf = (rows) => { const m = new Map(); for (const r of rows) if (!m.has(r.client_id) || r.at > m.get(r.client_id)) m.set(r.client_id, r.at); return [...m].sort(); };
  const brief = briefOfLog(o.log, { since });
  assert.deepEqual(lastOf(brief), lastOf(strip(o.log.filter((r) => new Date(r.at) >= new Date(since)))));
  assert.ok(brief.length <= o.clients.length);
});

test('the marks: the compact answer unpacks to the grouped rows, values and order', () => {
  const o = office();
  const want = {};
  const sorted = [...o.rows].sort((a, b) => (a.client_id < b.client_id ? -1 : a.client_id > b.client_id ? 1 : a.item_key < b.item_key ? -1 : 1));
  for (const r of sorted) (want[r.client_id] ||= {})[r.item_key] = { client_id: r.client_id, item_key: r.item_key, state: r.state, note: r.note ?? null, by_email: r.by_email, at: r.at };
  const packed = compactChecks(o.rows);
  assert.equal(json(expandChecks(packed)), json(want));
  assert.ok(json(packed).length < json(o.rows).length / 2.5);
  assert.throws(() => expandChecks(null));
});
