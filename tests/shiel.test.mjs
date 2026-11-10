// Shiel (the owner's decision of 9.11.2026; docs/ops.md, section 113): a characterizer like Noam
// and Ofir who does ONLY the characterization, and gets no notification at all.
//   - the people: his row, his scope ('own'), the lists the team screen and the function keep, the
//     characterizers Irit can pick (the card, "קביעת מועד", "פגישה חדשה");
//   - the owners: 4 and 5 are his for his client; 6, 8 and 8ב are Noam's; the hand-off of 5 goes to Noam;
//   - nothing reaches him: no reminder of any rule, no digest, no line in the owners' 19:00 table, and
//     nobody is reminded instead when his meeting is not marked (the rule `char`, step `irit`);
//   - nobody can give him a task (staff tasks, the card's tasks, decisions, the pass, prep);
//   - the screens: the meeting's form, the whole clients list; not the Gantt, Metricool or the links.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PEOPLE, SCOPE, TEAM_PEOPLE, STAFF_PEOPLE, ASSIGNABLE_PEOPLE, PROCESSES, CHARACTERIZERS, SILENT_PEOPLE, isSilent,
  characterizerOf, pagesOwnerOf,
} from '../app/protocol.js';
import { applicableProcesses, clientState, openItemsFor } from '../app/protocol-logic.js';
import { handoffsFor } from '../app/handoffs.js';
import { REMINDER_PEOPLE, lateRungOf } from '../app/reminder-rules.js';
import { computeReminders, candidates, buildEnv, planDigests } from '../app/reminder-engine.js';
import { daySummary } from '../app/day-summary.js';
import { ofirMeetings } from '../app/office-marks.js';
import { mayWrite } from '../scripts/protocol-writers.mjs';
import { writesChar, MEETING_PEOPLE, listsAllClients, seesGantt, CHAR_WRITERS, avatarFill } from '../app/shell-rules.js';
import { canConnect } from '../app/metricool-connect-logic.js';
import { canManageAccessLinks } from '../app/access-data.js';
import { worksCycle } from '../app/month-ui.js';
import { MEET_PEOPLE } from '../app/new-meeting-logic.js';
import { ASSIGNEES } from '../app/staff-tasks-logic.js';
import { intakeShortcut } from '../app/intake-ui.js';
import { OFFICE_PERSONS } from '../app/team-rules.js';
import { PERSONS, OFFICE_PERSONS as FN_OFFICE } from '../supabase/functions/staff-admin/rules.js';
import { importKeys } from '../app/client-open.js';
import { IMPORT_NOTE, CHAR_ENDED } from '../app/protocol-logic.js';
import { dateIL } from '../app/tz.js';

const IL = (y, m, d, h = 0, mi = 0) => dateIL(y, m, d, h, mi);
const STAFF = ['irit', 'lior', 'ofir', 'ilai', 'noam', 'shiel', 'nadia'].map((p) => ({ email: `${p}@x`, person: p })).concat([{ email: 'owner@x', person: null }]);
const base = { status: 'active', shoot_type: 'dms', has_logo: true, rounds: [], contract_end: '2027-12-31', deal_at: IL(2026, 11, 1, 10).toISOString(), created_by_email: 'irit@x', deliverables: { videos: 25, graphics: 36 } };
const shiels = { ...base, id: 's1', name: 'מספרת שיאל', characterizer: 'shiel' };
const noams = { ...base, id: 'n1', name: 'קפה נעמה', characterizer: 'noam' };
const ownersOf = (c, id) => {
  const p = applicableProcesses(c).find((x) => x.id === id);
  return [...new Set(p.items.filter((i) => !i.optional && !i.when).flatMap((i) => (typeof i.owners === 'function' ? i.owners(c) : i.owners) || (typeof p.owners === 'function' ? p.owners(c) : p.owners)))].sort();
};
const done = (key, at, by = 'irit@x') => ({ client_id: null, item_key: key, state: 'done', at: at.toISOString(), by_email: by, note: null });
// A world with one client whose meeting is at `charAt`, everything before it imported.
function world(c, charAt) {
  const client = { ...c, char_at: charAt.toISOString() };
  const checks = { [client.id]: Object.fromEntries(importKeys('char').map((k) => [k, { ...done(k, IL(2026, 11, 1, 9)), client_id: client.id, note: IMPORT_NOTE }])) };
  return { clients: [client], checks, tasks: [], access: [], reviews: [], statusNotes: [], messages: [], subscriptions: [], staff: STAFF, client };
}
// Every reminder candidate of every rule over a whole working week, minute by quarter hour.
function allWeek(w, from, days = 5) {
  const out = [];
  for (let t = from.getTime(); t < from.getTime() + days * 864e5; t += 15 * 6e4) out.push(...candidates(buildEnv({ ...w, now: new Date(t) })));
  return out;
}

test('the people: Shiel on the team, an own screen, a characterizer Irit can pick everywhere', () => {
  assert.deepEqual(PEOPLE.shiel, { key: 'shiel', name: 'שיאל', role: 'אפיונים' });
  assert.equal(SCOPE.shiel, 'own');
  assert.ok(TEAM_PEOPLE().some((p) => p.key === 'shiel'), 'the team screen has his row');
  assert.deepEqual(PERSONS, TEAM_PEOPLE().map((p) => p.key));
  assert.ok(CHARACTERIZERS.includes('shiel'));
  assert.equal(CHARACTERIZERS.at(-1), 'lior', 'Lior stays last: only when nobody else can');
  assert.deepEqual(MEET_PEOPLE, CHARACTERIZERS); // "קביעת מועד" and "פגישה חדשה"
  for (const page of ['client.html', 'clients.html']) {
    assert.match(readFileSync(new URL(`../${page}`, import.meta.url), 'utf8'), /<option value="shiel">שיאל<\/option>/, page);
  }
  assert.ok(OFFICE_PERSONS.includes('shiel'));
  assert.deepEqual(FN_OFFICE, OFFICE_PERSONS);
  assert.notEqual(avatarFill('shiel'), avatarFill('nobody'), 'a colour of his own');
  assert.deepEqual(SILENT_PEOPLE, ['shiel']);
  assert.equal(isSilent('noam'), false);
});

test('the owners: the meeting (4) and the logins (5) are his; the pages and the Highlights (6, 8, 8ב) are Noam\'s', () => {
  assert.equal(characterizerOf(shiels), 'shiel');
  assert.equal(pagesOwnerOf(shiels), 'noam');
  assert.deepEqual(ownersOf(shiels, 'p04').filter((p) => p !== 'irit'), ['shiel']);
  assert.ok(ownersOf(shiels, 'p05').includes('shiel'));
  for (const id of ['p06', 'p08']) assert.deepEqual(ownersOf(shiels, id), ['noam'], id); // (v14: 8ב left, one mark in 8)
  assert.equal(lateRungOf('p08b', shiels), 'noam');
  // Nothing of anyone else's client moves.
  assert.equal(pagesOwnerOf(noams), 'noam');
  assert.equal(pagesOwnerOf({ characterizer: 'lior' }), 'ofir');
  assert.equal(pagesOwnerOf({ characterizer: 'ofir' }), 'ofir');
  // Not Ofir's meeting: his fast ladder does not wait for it.
  assert.equal(ofirMeetings([{ ...shiels, char_at: IL(2026, 11, 2, 10).toISOString() }], () => ({})).length, 0);
  // His list: process 4 of his client; never 6.
  const checks = {};
  for (const id of ['p01', 'p02', 'p03']) for (const i of PROCESSES.find((p) => p.id === id).items.filter((x) => !x.optional && !x.when)) checks[i.key] = done(i.key, IL(2026, 11, 2, 8));
  const now = IL(2026, 11, 2, 9);
  const c = { ...shiels, char_at: IL(2026, 11, 2, 8, 30).toISOString() };
  const mine = openItemsFor('shiel', c, checks, clientState(c, checks, now), now).map((e) => e.proc.id);
  assert.ok(mine.includes('p04'));
  assert.ok(!mine.includes('p06'));
});

test('the hand-off of 5: to Noam, also when Shiel marked it', () => {
  // v14: offered when 5 is complete, by its one mark (p05.got).
  const checks = { 'p05.got': done('p05.got', IL(2026, 11, 2, 11), 'shiel@x') };
  const offers = (from) => handoffsFor(shiels, checks, 'p05.got', { now: IL(2026, 11, 2, 11, 1), from }).map((o) => [o.person, o.markKey]);
  assert.deepEqual(offers('shiel'), [['noam', 'p05.handoff.noam']]);
  assert.deepEqual(offers('irit'), [['noam', 'p05.handoff.noam']]);
});

test('no reminder reaches Shiel, and nobody is told instead that his meeting is not marked', () => {
  // Sunday 8.11.2026 at 11:00, nothing marked after it, for a whole week.
  const meeting = IL(2026, 11, 8, 11);
  const w = world(shiels, meeting);
  const got = allWeek(w, IL(2026, 11, 5, 8));
  assert.deepEqual(got.filter((r) => r.person === 'shiel').map((r) => r.key), []);
  assert.deepEqual(got.filter((r) => r.rule === 'char').map((r) => r.key), [], 'no "האפיון לא סומן" to Irit');
  assert.deepEqual(computeReminders({ ...w, now: IL(2026, 11, 8, 13, 45) }).filter((r) => r.rule === 'char'), []);
  // The same week for Noam's client: he and Irit are told (the rule still works for everyone else).
  const n = allWeek(world(noams, meeting), IL(2026, 11, 7, 18), 2);
  assert.ok(n.some((r) => r.rule === 'char' && r.step === 'end' && r.person === 'noam'));
  assert.ok(n.some((r) => r.rule === 'char' && r.step === 'irit' && r.person === 'irit'));
});

test('after his meeting the work goes on to Noam: the access to check and the Highlights\' clock', () => {
  const meeting = IL(2026, 11, 8, 10);
  const w = world(shiels, meeting);
  const ck = w.checks[w.client.id];
  for (const i of PROCESSES.find((p) => p.id === 'p04').items.filter((x) => !x.optional)) ck[i.key] = { ...done(i.key, IL(2026, 11, 8, 11, 30), 'shiel@x'), client_id: w.client.id };
  ck[CHAR_ENDED] = { ...done(CHAR_ENDED, IL(2026, 11, 8, 11, 30), 'shiel@x'), client_id: w.client.id };
  ck['p05.access'] = { ...done('p05.access', IL(2026, 11, 8, 11, 30), 'shiel@x'), client_id: w.client.id };
  const at = candidates(buildEnv({ ...w, now: IL(2026, 11, 8, 11, 31) }));
  assert.ok(at.some((r) => r.rule === 'access' && r.step === 'now' && r.person === 'noam'), JSON.stringify(at.map((r) => r.key)));
  assert.ok(at.some((r) => r.rule === 'started' && r.person === 'noam'));
  assert.deepEqual(at.filter((r) => r.person === 'shiel'), []);
});

test('no digest, no table row: the morning digest and the owners\' 19:00 table leave him out', () => {
  const w = world(shiels, IL(2026, 11, 2, 10)); // a week before: his meeting is long late
  const now = IL(2026, 11, 9, 8, 30);
  const env = buildEnv({ ...w, now, staff: STAFF.map((s) => s) });
  const digests = planDigests({ env, now });
  assert.deepEqual(digests.filter((d) => d.person === 'shiel'), []);
  const at19 = IL(2026, 11, 9, 19);
  const e19 = buildEnv({ ...w, now: at19 });
  const sum = daySummary({ clients: e19.clients, checksOf: e19.checksOf, stateOf: e19.stateOf, tasks: [], personOf: e19.personOf, now: at19 });
  assert.deepEqual(sum.rows.filter((r) => r.person === 'shiel'), []);
  assert.ok(sum.items.every((x) => !x.who.includes('shiel')));
  // The same for Noam's client: his late meeting is in the table (the table still works).
  const n = buildEnv({ ...world(noams, IL(2026, 11, 2, 10)), now: at19 });
  const nsum = daySummary({ clients: n.clients, checksOf: n.checksOf, stateOf: n.stateOf, tasks: [], personOf: n.personOf, now: at19 });
  assert.ok(nsum.rows.some((r) => r.person === 'noam'), JSON.stringify(nsum.rows));
});

test('nobody can give him a task', () => {
  assert.ok(!REMINDER_PEOPLE.has('shiel'));
  assert.ok(!ASSIGNEES().some((p) => p.key === 'shiel'), 'staff tasks ("נודניק")');
  assert.ok(!ASSIGNABLE_PEOPLE().some((p) => p.key === 'shiel'), 'the card\'s tasks, decisions, the pass, prep');
  assert.ok(STAFF_PEOPLE().some((p) => p.key === 'shiel'), 'still on the office\'s work lists and filters');
  assert.ok(ASSIGNEES().some((p) => p.key === 'noam'));
  // The pickers use the list without him.
  for (const f of ['app/client-card.js', 'app/decisions.js', 'app/pass.js', 'app/prep.js']) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.ok(src.includes('ASSIGNABLE_PEOPLE()'), f);
  }
});

test('the screens: the meeting\'s form and every client; not the Gantt, Metricool or the clients\' links', () => {
  const shiel = { me: 'shiel', scope: 'own', error: null };
  assert.ok(MEETING_PEOPLE.includes('shiel'));
  assert.ok(CHAR_WRITERS.includes('shiel'));
  assert.equal(writesChar(shiel), true); // "אפיון חדש" and the form
  assert.equal(listsAllClients('shiel'), true);
  // (The card's shortcut to the meeting's form, intakeShortcut in app/intake-ui.js, reads MEETING_PEOPLE; it needs a page.)
  assert.equal(intakeShortcut('p06', 's1', { scope: 'own', me: 'shiel' }), null);
  assert.equal(seesGantt(shiel), false);
  assert.equal(worksCycle(shiel), false);
  assert.equal(canConnect(shiel), false);
  assert.equal(canManageAccessLinks({ me: 'shiel', scope: 'own' }), false);
});

test('who writes: Shiel the items of 4 and 5; not 6, 8 or the office\'s', () => {
  for (const key of ['p04.address', 'p04.saved', 'p05.got', 'p05.access', 'p05.logo']) assert.equal(mayWrite({ person: 'shiel', client: shiels, key }), true, key);
  for (const key of ['p06.ok', 'p08.ok', 'p06.verified', 'p08.done', 'p08b.posted', 'p04.followup', 'p05.vault', 'p07.made', 'p22a.assigned']) assert.equal(mayWrite({ person: 'shiel', client: shiels, key }), false, key);
  assert.equal(mayWrite({ person: 'shiel', client: shiels, key: 'p04.saved', note: 'ייבוא' }), false, 'no imported history');
  assert.equal(mayWrite({ person: 'noam', client: shiels, key: 'p06.ok' }), true); // v14: one mark
});
