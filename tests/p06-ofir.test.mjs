// Process 6 passes to Ofir (the owner's decision of 28.10.2026: "להוריד מעילאי את כל עניין הגישות
// לרשתות, זה צריך לעבור לאופיר"; docs/ops.md, section 71). Checking every login, opening new
// networks and setting the pages up are Ofir's; Lior keeps the broken logins; nothing of 6 stays
// Ilai's, who keeps his graphics, the Gantt and his read of the vault.
//   - the protocol: the owners, the work lists, who may write, no new protocol version;
//   - the hand-off of 5 and the reminders go to Ofir, never to Ilai;
//   - Ilai's characterization-day card has no access line and no page line; the vault's statuses
//     still check the access by themselves (app/access-check.js), now from Ofir's list;
//   - the words the client reads in the welcome message.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PROCESSES, PROTOCOL_VERSION } from '../app/protocol.js';
import { PROTOCOL_HISTORY } from '../app/protocol-versions.js';
import { clientState, openItemsFor } from '../app/protocol-logic.js';
import { HANDOFFS, handoffsFor, describeMark } from '../app/handoffs.js';
import { RULES } from '../app/reminder-rules.js';
import { charDay } from '../app/ilai-logic.js';
import { PAGE_KEYS, ACCESS_KEYS, accessChecked, AUTO_ACCESS_NOTE } from '../app/access-check.js';
import { CLIENT_ROLES } from '../app/messages-logic.js';
import { mayWrite } from '../scripts/protocol-writers.mjs';

const IL = (y, m, d, h = 0, min = 0) => new Date(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00+03:00`);
const P06 = PROCESSES.find((p) => p.id === 'p06');
const src = (f) => readFileSync(new URL(`../app/${f}`, import.meta.url), 'utf8');
const done = (at, by = 'irit@x') => ({ state: 'done', at: at.toISOString(), by_email: by, note: null });
const client = { id: 'c1', name: 'מאפיית שחר', status: 'active', characterizer: 'ofir', has_logo: true, char_at: IL(2026, 10, 20, 8).toISOString(), deal_at: IL(2026, 10, 19, 9).toISOString(), created_at: IL(2026, 10, 19, 9).toISOString(), rounds: [], deliverables: { videos: 25, graphics: 36 } };
const itemsOf = (id) => PROCESSES.find((p) => p.id === id).items.filter((i) => !i.optional && !i.when).map((i) => i.key);

test('the protocol: the whole of 6 is Ofir\'s; Lior keeps the broken logins; nothing of it is Ilai\'s', () => {
  assert.deepEqual(P06.owners, ['ofir']);
  const st = clientState(client, {}, IL(2026, 10, 20, 12));
  const p06 = st.states.find((s) => s.proc.id === 'p06');
  const by = Object.fromEntries(p06.proc.items.map((i) => [i.key, i.owners]));
  for (const k of [...ACCESS_KEYS, ...PAGE_KEYS]) assert.deepEqual(by[k], ['ofir'], k);
  assert.deepEqual(by['p06.recovered'], ['lior']);
  assert.ok(!Object.values(by).flat().includes('ilai'));
  // Who owns an item is not a protocol version (app/protocol-versions.js): still 11, no new entry.
  assert.equal(PROTOCOL_VERSION, 11);
  assert.equal(PROTOCOL_HISTORY.at(-1).version, 11);
  // A new network to open is Ofir's to say: 5's own note says so.
  assert.match(PROCESSES.find((p) => p.id === 'p05').ownerNote, /אין רשתות: משימה לאופיר לפתוח/);
});

test('the lists: after the accesses, 6 is on Ofir\'s list and not on Ilai\'s', () => {
  const checks = {};
  for (const id of ['p01', 'p02', 'p03', 'p04']) for (const k of itemsOf(id)) checks[k] = done(IL(2026, 10, 20, 8, 55));
  checks['p05.access'] = done(IL(2026, 10, 20, 9), 'ofir@x');
  const now = IL(2026, 10, 20, 9, 10);
  const st = clientState(client, checks, now);
  const open = (who) => openItemsFor(who, client, checks, st, now).filter((e) => e.proc.id === 'p06').map((e) => e.item.key);
  assert.deepEqual(open('ofir').sort(), ['p06.address', 'p06.bio', 'p06.details', 'p06.look', 'p06.metricool', 'p06.name', 'p06.phone', 'p06.verified'].sort());
  assert.deepEqual(open('ilai'), []);
  // Ilai's characterization day: his graphics and the Gantt skeleton only.
  const [card] = charDay({ clients: [client], stateOf: (c) => clientState(c, checks, now), checks: { c1: checks }, now });
  assert.deepEqual(card.lines.map((l) => l.key), ['graphics', 'gantt']);
});

test('who writes 6: the office (Ofir among them); Ilai no more, and still his own items elsewhere', () => {
  for (const k of [...P06.items.map((i) => i.key), 'p06.claim', 'p06.handoff.ofir']) {
    assert.equal(mayWrite({ person: 'ofir', client, key: k }), true, k);
    assert.equal(mayWrite({ person: 'ilai', client, key: k }), false, k);
  }
  for (const k of ['p05.newlogo', 'p07.made', 'p07b.posted', 'p23b.posted', 'p29.filled']) assert.equal(mayWrite({ person: 'ilai', client, key: k }), true, k);
});

test('the hand-off of 5: to Ofir, never to himself; an old record to Ilai keeps its words', () => {
  const point = HANDOFFS.find((p) => p.id === 'access');
  assert.deepEqual(point.to.map((t) => [t.id, t.person, t.proc, t.until]), [['ofir', 'ofir', 'p06', 'p06.verified']]);
  const checks = { 'p05.access': done(IL(2026, 10, 20, 11)) };
  const at = { now: IL(2026, 10, 20, 11, 1) };
  assert.deepEqual(handoffsFor(client, checks, 'p05.access', { ...at, from: 'irit' }).map((o) => [o.person, o.markKey]), [['ofir', 'p05.handoff.ofir']]);
  assert.deepEqual(handoffsFor(client, checks, 'p05.access', { ...at, from: 'ofir' }), []);
  assert.equal(describeMark('p05.handoff.ofir'), 'גישות התקבלו ← אופיר');
  assert.equal(describeMark('p05.handoff.ilai'), 'גישות התקבלו ← עילאי');
});

test('the reminders of the accesses go to Ofir; none of them to Ilai', () => {
  const steps = (id) => RULES.find((r) => r.id === id).steps.map((s) => [s.id, s.to]);
  assert.deepEqual(steps('access'), [['now', 'ofir'], ['ofir30', 'ofir'], ['lior', 'lior']]);
  assert.deepEqual(steps('accessForm'), [['irit', 'irit'], ['ofir', 'ofir'], ['lior', 'lior']]);
  assert.deepEqual(steps('accessClosed'), [['irit', 'irit'], ['ofir', 'ofir']]);
  assert.equal(RULES.find((r) => r.id === 'access').steps.find((s) => s.id === 'lior').body(), 'עברו 30 דקות מקבלת הגישות ואופיר עוד לא סימן שבדק.');
});

test('the vault\'s statuses check the access by themselves (Ofir\'s list and the client card share the rule)', () => {
  const at = IL(2026, 10, 20, 12);
  assert.equal(accessChecked([{ status: 'ok', updated_at: IL(2026, 10, 20, 12, 5).toISOString() }, { status: 'missing', updated_at: IL(2026, 10, 20, 12, 6).toISOString() }], at), true);
  assert.equal(accessChecked([{ status: 'new', updated_at: IL(2026, 10, 20, 12, 5).toISOString() }], at), false);
  assert.equal(AUTO_ACCESS_NOTE, 'נסגר לבד: כל הרשתות בכספת קיבלו סטטוס');
  // The pages: Ilai's card has no access line and no page line, and marks nothing of 6 itself.
  const card = src('ilai-card.js');
  assert.doesNotMatch(card.replace(/\/\/[^\n]*/g, ''), /p06\.|loadAccessStatusForWork|AUTO_ACCESS_NOTE/);
  // Ofir's list lays 6 out in its two parts and marks the check from the statuses; the client
  // card's vault marks it for the office only.
  assert.match(src('clients.js'), /accessPanel\(g, \{ checks: checks\[g\.client\.id\] \|\| \{\}, row: rowOf \}\)/);
  assert.match(src('clients.js'), /mayMark: scope === 'office' && !viewerError/);
  assert.match(src('client-card.js'), /async function autoAccessCheck\(\) \{\r?\n  if \(scope !== 'office' \|\| viewerError\) return;/);
  // A network to open, from the vault's dialog, is a task for Ofir.
  assert.match(src('client-card.js'), /const owner = st === 'broken' \? 'lior' : 'ofir';/);
});

test('the welcome message: the pages are Ofir\'s, Ilai makes the graphics', () => {
  const roles = Object.fromEntries(CLIENT_ROLES);
  assert.match(roles.ofir, /סידור העמודים/);
  assert.doesNotMatch(roles.ilai, /עמוד/);
});
