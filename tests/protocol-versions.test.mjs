// Protocol versions per client (app/protocol-versions.js through
// app/protocol-logic.js; plan stage 5: "פריט חדש לא מסמן לקוחות קיימים כ'באיחור'").
// Items added after a client started are "fresh": never late, still work to do; a
// deadline a later version shortened stays as it was for that client. npm test
// runs this under UTC, New York and Jerusalem.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PROCESSES, PROTOCOL_VERSION } from '../app/protocol.js';
import { clientState, openItemsFor, applicableProcesses } from '../app/protocol-logic.js';
import {
  PROTOCOL_HISTORY, LATEST, itemSince, versionOf, adjustForVersion, dueStartedUnder, laterDue, freshText,
} from '../app/protocol-versions.js';
import { importKeys } from '../app/client-open.js';
import { dateIL, partsIL } from '../app/tz.js';

const IL = (y, m, d, h = 0, mi = 0) => dateIL(y, m, d, h, mi);
const day = (d) => { const p = partsIL(d); return `${p.day}.${p.month} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`; };
const KEYS = PROCESSES.flatMap((p) => p.items.map((i) => i.key));
const client = (o = {}) => ({
  id: 'c1', name: 'לקוח', status: 'active', shoot_type: 'dms', characterizer: 'ofir', has_logo: true, rounds: [],
  deal_at: IL(2026, 10, 11, 9).toISOString(), char_at: IL(2026, 10, 12, 10).toISOString(), contract_end: '2027-10-11', ...o,
});
const imported = (station, at = IL(2026, 10, 12, 12)) => Object.fromEntries(importKeys(station).map((k) => [k, { state: 'done', at: at.toISOString(), note: 'ייבוא' }]));
const stateOf = (c, checks, now) => clientState(c, checks, now);
const proc = (s, id) => s.states.find((x) => x.proc.id === id);

test('the history covers the protocol: one entry per version up to PROTOCOL_VERSION, every recorded key and process exists', () => {
  assert.deepEqual(PROTOCOL_HISTORY.map((v) => v.version), Array.from({ length: PROTOCOL_VERSION }, (_, i) => i + 1));
  assert.equal(LATEST, PROTOCOL_VERSION, 'add the new version to PROTOCOL_HISTORY in app/protocol-versions.js');
  for (const v of PROTOCOL_HISTORY) {
    assert.ok(v.title && v.changes.length && /^\d{4}-\d{2}-\d{2}$/.test(v.date), `v${v.version}`);
    for (const k of [...(v.items || []), ...(v.always || [])]) assert.ok(KEYS.includes(k), `v${v.version}: ${k} is not in the protocol`);
    for (const id of Object.keys(v.due || {})) assert.ok(PROCESSES.some((p) => p.id === id), `v${v.version}: ${id}`);
  }
  // Every item the first protocol did not have is recorded with the version that added it:
  // 139 items of version 1 are still in the protocol. A new item not recorded fails here.
  // (`always`: an item a version added for every client, whatever version it started under. Version 9's
  // one new item, Ofir's approval of the first graphics, is recorded so, and is not "חדש בפרוטוקול".)
  const recorded = new Set(PROTOCOL_HISTORY.flatMap((v) => [...(v.items || []), ...(v.always || [])]));
  assert.equal(KEYS.filter((k) => !recorded.has(k)).length, 139, 'record the new items in PROTOCOL_HISTORY (items, or always) with the version that added them');
  assert.deepEqual(PROTOCOL_HISTORY.find((v) => v.version === 9).always, ['p07.ofir']);
});

test('the database stamps the same current version (the latest migration that sets it)', () => {
  const dir = new URL('../supabase/migrations/', import.meta.url);
  let last = null;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    const m = /function private\.protocol_version_current\(\)[^$]*\$\$\s*select\s+(\d+)\s*\$\$/i.exec(readFileSync(new URL(f, dir), 'utf8'));
    if (m) last = Number(m[1]);
  }
  assert.equal(last, PROTOCOL_VERSION, 'raise private.protocol_version_current() in a migration');
});

test('the migration sets old rows by the same times the screens read them with', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260930190000_year.sql', import.meta.url), 'utf8');
  const cuts = [...sql.matchAll(/when created_at < '([^']+)' then (\d)/g)].map((m) => [Date.parse(m[1].replace(' ', 'T').replace('+00', 'Z')), Number(m[2]) + 1]);
  assert.deepEqual(cuts, PROTOCOL_HISTORY.filter((v) => v.since).map((v) => [Date.parse(v.since), v.version]));
});

test('which version an item came in, and which version a client started under', () => {
  assert.equal(itemSince('p01.signed'), 1);
  assert.equal(itemSince('p12a.read'), 2);
  assert.equal(itemSince('r2.p12a.read'), 2);
  assert.equal(itemSince('p17b.arrived'), 4);
  assert.equal(itemSince('p27.toilai'), 2);
  assert.equal(versionOf({ protocol_version: 4 }), 4);
  assert.equal(versionOf({ protocol_version: '3' }), 3);
  for (const bad of [undefined, null, 0, 99, 'x', 2.5]) assert.equal(versionOf({ protocol_version: bad }), PROTOCOL_VERSION, String(bad));
  // A row still at the column's old default (before the migration stamps it) reads as
  // the migration sets it: by when it was opened, never above 4.
  const at = (iso) => versionOf({ protocol_version: 1, created_at: iso });
  assert.deepEqual(['2026-09-29T12:00:00Z', '2026-09-29T13:40:00Z', '2026-09-29T15:00:00Z', '2026-09-29T18:00:00Z', '2026-10-04T09:00:00Z'].map(at), [1, 2, 3, 4, 4]);
  assert.equal(versionOf({ protocol_version: 1 }), 1);
  assert.equal(versionOf({ protocol_version: 5, created_at: '2026-09-29T12:00:00Z' }), 5);
  assert.equal(dueStartedUnder('p12', 4).businessDays, 3);
  assert.equal(dueStartedUnder('p12', 5), null);
  assert.equal(dueStartedUnder('p22', 1).businessDays, 5);
  assert.equal(dueStartedUnder('p22', 2), null);
  assert.equal(laterDue(null, null), null);
  assert.equal(laterDue(IL(2026, 1, 1), null).getTime(), IL(2026, 1, 1).getTime());
  assert.equal(laterDue(IL(2026, 1, 1), IL(2026, 1, 2)).getTime(), IL(2026, 1, 2).getTime());
  assert.match(freshText(4), /חדש בפרוטוקול \(גרסה 4\)/);
});

test('a client on the current version (or without one) is untouched', () => {
  for (const v of [PROTOCOL_VERSION, undefined]) {
    const c = client({ protocol_version: v });
    const procs = applicableProcesses(c);
    assert.equal(procs.some((p) => p.dueBefore || p.items.some((i) => i.fresh)), false, String(v));
  }
  const list = [{ id: 'p01', items: [{ key: 'p01.signed' }] }];
  assert.equal(adjustForVersion(list, { protocol_version: PROTOCOL_VERSION }), list);
});

test('v4 client, v5 change: the scripts are due on business day 3 as it started, not day 2; a v5 client is late', () => {
  const checks = imported('content'); // everything before the scripts, imported
  delete checks['p12a.read']; delete checks['p12a.call'];
  for (const k of importKeys('content')) if (k.startsWith('p12a.')) checks[k] = { state: 'done', at: IL(2026, 10, 12, 16).toISOString() };
  // Characterization Monday 12.10: day 2 ends Wednesday 14.10, day 3 Thursday 15.10.
  const now = IL(2026, 10, 15, 10);
  const v5 = proc(stateOf(client({ protocol_version: 5 }), checks, now), 'p12');
  const v4 = proc(stateOf(client({ protocol_version: 4 }), checks, now), 'p12');
  assert.equal(day(v5.dueAt), '14.10 18:00');
  assert.equal(v5.status, 'overdue');
  assert.equal(day(v4.dueAt), '15.10 18:00');
  assert.equal(v4.status, 'today');
  assert.equal(stateOf(client({ protocol_version: 4 }), checks, IL(2026, 10, 16, 10)).overdue >= 1, true, 'late after its own deadline');
  // The same inside a shoot round (r2-p12, counted from the round's start).
  const round = { n: 2, start_at: IL(2026, 11, 2, 10).toISOString(), shoot_type: 'dms', shoot_at: null };
  const r4 = proc(stateOf(client({ protocol_version: 4, rounds: [round] }), checks, IL(2026, 11, 5, 10)), 'r2-p12');
  const r5 = proc(stateOf(client({ protocol_version: 5, rounds: [round] }), checks, IL(2026, 11, 5, 10)), 'r2-p12');
  assert.equal(r4.status, 'today');
  assert.equal(r5.status, 'overdue');
});

test('v3 client, v4 items: the photographer\'s processes are never late for it, still open work for Eli', () => {
  const shoot = IL(2026, 10, 20, 10);
  const checks = imported('shoot', IL(2026, 10, 19, 12));
  const now = IL(2026, 10, 21, 12); // the day after the shoot
  const s3 = stateOf(client({ protocol_version: 3, shoot_at: shoot.toISOString() }), checks, now);
  const s4 = stateOf(client({ protocol_version: 4, shoot_at: shoot.toISOString() }), checks, now);
  for (const id of ['p17b', 'p18b', 'p19b']) {
    assert.equal(proc(s4, id).status, 'overdue', `v4 ${id}`);
    assert.notEqual(proc(s3, id).status, 'overdue', `v3 ${id}`);
    assert.equal(proc(s3, id).complete, false, `v3 ${id} is still work`);
    assert.ok(proc(s3, id).proc.items.every((i) => i.fresh === 4), id);
  }
  // Eli still sees them (as work, without "late").
  const c3 = client({ protocol_version: 3, shoot_at: shoot.toISOString() });
  const open = openItemsFor('eli', c3, checks, s3, now);
  assert.ok(open.some((e) => e.item.key === 'p19b.handed'));
  assert.ok(open.every((e) => e.status !== 'overdue'));
  // Lior's own process of the same day (19, from version 1) is late as before.
  assert.equal(proc(s3, 'p19').status, 'overdue');
});

test('a process late on items the client started with stays late, whatever was added later', () => {
  const shoot = IL(2026, 10, 20, 10);
  const checks = imported('shoot', IL(2026, 10, 19, 12));
  const c1 = client({ protocol_version: 1, shoot_at: shoot.toISOString() });
  const now = IL(2026, 10, 21, 12);
  // Process 19: p19.all is from version 2 (fresh for a v1 client), p19.testimonial from version 1.
  const s = stateOf(c1, checks, now);
  assert.equal(proc(s, 'p19').status, 'overdue');
  const done = { ...checks, ...Object.fromEntries(['p19.testimonial', 'p19.drive', 'p19.took'].map((k) => [k, { state: 'done', at: now.toISOString() }])) };
  const s2 = stateOf(c1, done, now);
  assert.equal(proc(s2, 'p19').status === 'overdue', false, 'only p19.all (version 2) is open');
  assert.equal(proc(s2, 'p19').complete, false);
});

test('v1 client: editing is due 5 business days from the shoot as it started, even before an editor is assigned (22א came in v2)', () => {
  const shoot = IL(2026, 10, 20, 10);
  const checks = imported('post', IL(2026, 10, 20, 20));
  for (const k of Object.keys(checks)) if (/^p22a\./.test(k)) delete checks[k];
  const c1 = client({ protocol_version: 1, shoot_at: shoot.toISOString() });
  const s = stateOf(c1, checks, IL(2026, 10, 22, 10));
  const p22 = proc(s, 'p22');
  // Shoot Tuesday 20.10: 5 business days end Tuesday 27.10.
  assert.equal(day(p22.dueAt), '27.10 18:00');
  // 22א itself (all of it from version 2) is open work, never late.
  const p22a = proc(stateOf(c1, checks, IL(2026, 11, 20, 10)), 'p22a');
  assert.equal(p22a.status === 'overdue', false);
  assert.equal(proc(stateOf(client({ protocol_version: 2, shoot_at: shoot.toISOString() }), checks, IL(2026, 11, 20, 10)), 'p22a').status, 'overdue');
});
