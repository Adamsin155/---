// Amit (the owner's decision of 15.11.2026; docs/ops.md, section 132): exactly what Noam did (sections
// 86, 87 and 91; she left on 10.11.2026), beside Ofir. Per client, when Irit picks her as the
// characterizer: the meeting (4), the logins taken there (5), checking them and setting the pages up
// with Metricool (6) and the Highlights (8). A new client is still Ofir's; Shiel's and Lior's stay Ofir's
// for 6 and 8. She is told everything, like any employee (not silent like Shiel), and can be given tasks.
//   - the people: her row, her scope ('own'), the lists the team screen and the function keep, the
//     characterizers Irit can pick (the card, "קביעת מועד", "פגישה חדשה"), the default stays Ofir;
//   - the owners of 4, 5, 6 and 8 for a client of hers, of Ofir's, of Shiel's, of Lior's, of nobody's;
//   - her work list, the hand-off of 5, the reminders, the digest, the 19:00 table, tasks;
//   - who writes: Amit the items of 4, 5, 6 and 8; Ofir (the office) everything as before;
//   - the screens: the meeting's form, every client, the Gantt index with the Metricool card, the
//     clients' links to the logins form; not money or contracts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PEOPLE, SCOPE, TEAM_PEOPLE, STAFF_PEOPLE, ASSIGNABLE_PEOPLE, PROCESSES, CHARACTERIZERS, DEFAULT_CHARACTERIZER,
  SILENT_PEOPLE, isSilent, characterizerOf, pagesOwnerOf,
} from '../app/protocol.js';
import { applicableProcesses, clientState, openItemsFor, CHAR_ENDED, IMPORT_NOTE } from '../app/protocol-logic.js';
import { handoffsFor, describeMark } from '../app/handoffs.js';
import { RULES, REMINDER_PEOPLE, RING_TARGETS, LATE_WATCHERS, lateRungOf } from '../app/reminder-rules.js';
import { candidates, buildEnv, planDigests } from '../app/reminder-engine.js';
import { daySummary } from '../app/day-summary.js';
import { ofirMeetings } from '../app/office-marks.js';
import { mayWrite } from '../scripts/protocol-writers.mjs';
import { writesChar, MEETING_PEOPLE, ALL_CLIENTS_PEOPLE, listsAllClients, seesGantt, CHAR_WRITERS, avatarFill, menuOf } from '../app/shell-rules.js';
import { canConnect, CONNECTORS } from '../app/metricool-connect-logic.js';
import { LINK_MANAGERS, canManageAccessLinks, seesAccessLinks } from '../app/access-data.js';
import { worksCycle } from '../app/month-ui.js';
import { MEET_PEOPLE } from '../app/new-meeting-logic.js';
import { ASSIGNEES } from '../app/staff-tasks-logic.js';
import { NOTE_PEOPLE } from '../app/staff-notes-logic.js';
import { ASK_PEOPLE } from '../app/ask-logic.js';
import { flowNeeds } from '../app/mine-flow.js';
import { OFFICE_PERSONS, linkOnlyByOwner } from '../app/team-rules.js';
import { PERSONS, OFFICE_PERSONS as FN_OFFICE } from '../supabase/functions/staff-admin/rules.js';
import { OFFICE as METRICOOL_OFFICE, mayCall } from '../supabase/functions/metricool/sync.js';
import { importKeys } from '../app/client-open.js';
import { dateIL } from '../app/tz.js';

const IL = (y, m, d, h = 0, mi = 0) => dateIL(y, m, d, h, mi);
const src = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const STAFF = ['irit', 'lior', 'ofir', 'ilai', 'amit', 'shiel', 'nadia'].map((p) => ({ email: `${p}@x`, person: p })).concat([{ email: 'owner@x', person: null }]);
const base = { status: 'active', shoot_type: 'dms', has_logo: true, rounds: [], contract_end: '2027-12-31', deal_at: IL(2026, 11, 1, 10).toISOString(), created_by_email: 'irit@x', deliverables: { videos: 25, graphics: 36 } };
const amits = { ...base, id: 'a1', name: 'קונדיטוריית עמית', characterizer: 'amit' };
const ofirs = { ...base, id: 'o1', name: 'מאפיית שחר', characterizer: 'ofir' };
const shiels = { ...base, id: 's1', name: 'מספרת שיאל', characterizer: 'shiel' };
const liors = { ...base, id: 'l1', name: 'מספרת ליאור', characterizer: 'lior' };
const nobodys = { ...base, id: 'x1', name: 'פיצה ללא', characterizer: null };
const noams = { ...base, id: 'n1', name: 'קפה נעמה', characterizer: 'noam' }; // Noam left on 10.11.2026
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
function allWeek(w, from, days = 5) {
  const out = [];
  for (let t = from.getTime(); t < from.getTime() + days * 864e5; t += 15 * 6e4) out.push(...candidates(buildEnv({ ...w, now: new Date(t) })));
  return out;
}

test('the people: Amit on the team, an own screen, a characterizer Irit can pick everywhere; the default stays Ofir', () => {
  assert.deepEqual(PEOPLE.amit, { key: 'amit', name: 'עמית', role: 'אפיונים, הקמת דפים ו־Highlights' });
  assert.equal(SCOPE.amit, 'own');
  assert.ok(TEAM_PEOPLE().some((p) => p.key === 'amit'), 'the team screen has her row');
  assert.ok(STAFF_PEOPLE().some((p) => p.key === 'amit'));
  assert.deepEqual(PERSONS, TEAM_PEOPLE().map((p) => p.key));
  assert.deepEqual(CHARACTERIZERS, ['amit', 'ofir', 'shiel', 'lior']);
  assert.deepEqual(MEET_PEOPLE, CHARACTERIZERS); // "קביעת מועד" and "פגישה חדשה"
  assert.equal(DEFAULT_CHARACTERIZER, 'ofir');
  assert.deepEqual([amits, ofirs, shiels, liors, nobodys, noams].map(characterizerOf), ['amit', 'ofir', 'shiel', 'lior', 'ofir', 'ofir']);
  assert.deepEqual([amits, ofirs, shiels, liors, nobodys, noams].map(pagesOwnerOf), ['amit', 'ofir', 'ofir', 'ofir', 'ofir', 'ofir']);
  // The pickers written in the pages: the card's edit form and "קביעת מועד" (Lior stays last).
  assert.match(src('client.html'), /<option value="">טרם נקבע<\/option><option value="amit">עמית<\/option><option value="ofir">אופיר<\/option><option value="shiel">שיאל<\/option><option value="lior">/);
  assert.match(src('clients.html'), /id="meet-who"><option value="amit">עמית<\/option><option value="ofir">אופיר<\/option><option value="shiel">שיאל<\/option><option value="lior">/);
  // She sees every client in the database, as Ilai and Shiel (public.is_office()): only the owner makes her sign-in link.
  assert.ok(OFFICE_PERSONS.includes('amit'));
  assert.deepEqual(FN_OFFICE, OFFICE_PERSONS);
  assert.equal(linkOnlyByOwner({ owner: false, email: 'irit@x' }, { email: 'amit@x', person: 'amit', vault: false }), true);
  assert.notEqual(avatarFill('amit'), avatarFill('nobody'), 'a colour of her own');
  assert.equal(RING_TARGETS.amit, 5);
});

test('she is told everything and can be given work, as any employee (not silent like Shiel)', () => {
  assert.equal(isSilent('amit'), false);
  assert.deepEqual(SILENT_PEOPLE, ['shiel', 'gal']); // Gal, the bookkeeper (16.11.2026): no notifications either
  assert.ok(REMINDER_PEOPLE.has('amit'));
  assert.ok(ASSIGNEES().some((p) => p.key === 'amit'), 'staff tasks ("נודניק")');
  assert.ok(ASSIGNABLE_PEOPLE().some((p) => p.key === 'amit'), 'the card\'s tasks, decisions, the pass, prep');
  assert.ok(NOTE_PEOPLE().some((p) => p.key === 'amit'), 'a special note to her');
  assert.ok(ASK_PEOPLE.includes('amit'));
});

test('the owners: 4, 6 and 8 are the characterizer\'s; 5 when she ran the meeting; Shiel\'s and Lior\'s pages stay Ofir\'s', () => {
  for (const [c, who] of [[amits, 'amit'], [ofirs, 'ofir']]) {
    assert.deepEqual(ownersOf(c, 'p04').filter((p) => p !== 'irit'), [who], `${c.name} 4`);
    assert.ok(ownersOf(c, 'p05').includes(who), `${c.name} 5`);
    assert.deepEqual(ownersOf(c, 'p06'), [who], `${c.name} 6`);
    assert.deepEqual(ownersOf(c, 'p08'), [who], `${c.name} 8`);
  }
  for (const c of [shiels, liors, nobodys, noams]) {
    for (const id of ['p06', 'p08']) assert.deepEqual(ownersOf(c, id), ['ofir'], `${c.name} ${id}`);
    assert.ok(!ownersOf(c, 'p05').includes('amit'));
  }
  // Nothing else moved: the graphics' checks are Ofir's for her client too.
  const p07 = applicableProcesses(amits).find((p) => p.id === 'p07');
  assert.deepEqual(p07.items.find((i) => i.key === 'p07.ofir').owners, ['ofir']);
  // The words: 3 asks for Amit, Ofir or Shiel; 8 names the one who characterizes.
  const p03 = PROCESSES.find((p) => p.id === 'p03');
  assert.match(p03.what, /מבצע האפיון \(עמית, אופיר או שיאל\)/);
  assert.match(p03.ownerNote, /^מבצע האפיון הוא עמית, אופיר או שיאל\./);
  assert.match(PROCESSES.find((p) => p.id === 'p08').what, /^מבצע האפיון \(עמית או אופיר\) מכין/);
  // Not Ofir's meeting: his fast ladder does not wait for it.
  assert.equal(ofirMeetings([{ ...amits, char_at: IL(2026, 11, 16, 10).toISOString() }], () => ({})).length, 0);
});

test('her work list: 4 and then 6 of her client; never 6 of Ofir\'s or Shiel\'s', () => {
  const checks = {};
  for (const id of ['p01', 'p02', 'p03']) for (const i of PROCESSES.find((p) => p.id === id).items.filter((x) => !x.optional && !x.when)) checks[i.key] = done(i.key, IL(2026, 11, 16, 8));
  const now = IL(2026, 11, 16, 9);
  const at = (c) => ({ ...c, char_at: IL(2026, 11, 16, 8, 30).toISOString() });
  const open = (who, c, ck = checks, t = now) => openItemsFor(who, at(c), ck, clientState(at(c), ck, t), t).map((e) => e.proc.id);
  assert.ok(open('amit', amits).includes('p04'));
  assert.ok(!open('amit', ofirs).includes('p04'));
  const after = { ...checks, 'p05.got': done('p05.got', IL(2026, 11, 16, 10, 30), 'amit@x') };
  for (const i of PROCESSES.find((p) => p.id === 'p04').items.filter((x) => !x.optional)) after[i.key] = done(i.key, IL(2026, 11, 16, 10, 30), 'amit@x');
  after[CHAR_ENDED] = done(CHAR_ENDED, IL(2026, 11, 16, 10, 30), 'amit@x');
  const t = IL(2026, 11, 16, 10, 40);
  assert.ok(open('amit', amits, after, t).includes('p06'));
  assert.ok(open('amit', amits, after, t).includes('p08'));
  assert.ok(!open('ofir', amits, after, t).includes('p06'));
  assert.ok(!open('amit', ofirs, after, t).includes('p06'));
  assert.ok(!open('amit', shiels, after, t).includes('p06'));
  assert.ok(open('ofir', shiels, after, t).includes('p06'));
});

test('the hand-off of 5: to her for her client, never to herself; each record names its person', () => {
  const checks = { 'p05.got': done('p05.got', IL(2026, 11, 16, 11)) };
  const offers = (c, from) => handoffsFor(c, checks, 'p05.got', { now: IL(2026, 11, 16, 11, 1), from }).map((o) => [o.person, o.markKey]);
  assert.deepEqual(offers(amits, 'irit'), [['amit', 'p05.handoff.amit']]);
  assert.deepEqual(offers(amits, 'amit'), []);
  assert.deepEqual(offers(ofirs, 'irit'), [['ofir', 'p05.handoff.ofir']]);
  assert.deepEqual(offers(shiels, 'shiel'), [['ofir', 'p05.handoff.ofir']]);
  assert.equal(describeMark('p05.handoff.amit'), 'גישות התקבלו ← עמית');
  assert.equal(describeMark('p05.handoff.noam'), 'גישות התקבלו ← נעם');
});

test('the reminders of 6 and 8 go to her for her client; Ofir and Lior still hear what is late', () => {
  const to = (rule, step, i) => {
    const s = RULES.find((r) => r.id === rule).steps.find((x) => x.id === step);
    return typeof s.to === 'function' ? s.to(i) : s.to;
  };
  for (const [c, who] of [[amits, 'amit'], [ofirs, 'ofir'], [shiels, 'ofir']]) {
    const i = { client: c, checker: pagesOwnerOf(c) };
    assert.equal(to('access', 'now', i), who);
    assert.equal(to('access', 'ofir30', i), who);
    assert.equal(to('access', 'lior', i), 'lior');
    assert.equal(to('accessForm', 'ofir', i), who);
    assert.equal(to('accessClosed', 'ofir', i), who);
  }
  assert.equal(RULES.find((r) => r.id === 'access').steps.find((s) => s.id === 'lior').body({ checker: 'amit' }), 'עברו 30 דקות מקבלת הגישות ועמית עוד לא סימן שבדק.');
  assert.deepEqual(LATE_WATCHERS, ['ofir', 'lior']);
  assert.equal(lateRungOf('p08b', amits), 'amit');
});

test('after her meeting she is rung: the logins to check and the Highlights\' clock', () => {
  const w = world(amits, IL(2026, 11, 16, 10));
  const ck = w.checks[w.client.id];
  for (const i of PROCESSES.find((p) => p.id === 'p04').items.filter((x) => !x.optional)) ck[i.key] = { ...done(i.key, IL(2026, 11, 16, 11, 30), 'amit@x'), client_id: w.client.id };
  ck[CHAR_ENDED] = { ...done(CHAR_ENDED, IL(2026, 11, 16, 11, 30), 'amit@x'), client_id: w.client.id };
  ck['p05.access'] = { ...done('p05.access', IL(2026, 11, 16, 11, 30), 'irit@x'), client_id: w.client.id };
  const at = candidates(buildEnv({ ...w, now: IL(2026, 11, 16, 11, 31) }));
  assert.ok(at.some((r) => r.rule === 'access' && r.step === 'now' && r.person === 'amit'), JSON.stringify(at.map((r) => r.key)));
  assert.ok(at.some((r) => r.rule === 'started' && r.person === 'amit'));
  assert.ok(!at.some((r) => r.rule === 'access' && r.step === 'now' && r.person === 'ofir'));
  // Her meeting not marked: she is told, and Irit too (unlike Shiel's).
  const late = allWeek(world(amits, IL(2026, 11, 16, 10)), IL(2026, 11, 15, 18), 2);
  assert.ok(late.some((r) => r.rule === 'char' && r.person === 'amit'), 'she hears of her meeting');
  assert.ok(late.some((r) => r.rule === 'char' && r.step === 'irit' && r.person === 'irit'));
});

test('the morning digest and the owners\' 19:00 table have her', () => {
  const w = world(amits, IL(2026, 11, 9, 10)); // a week before: her meeting is long late
  const now = IL(2026, 11, 16, 8, 30);
  const env = buildEnv({ ...w, now });
  assert.ok(planDigests({ env, now }).some((d) => d.person === 'amit'), 'a morning digest');
  const at19 = IL(2026, 11, 16, 19);
  const e19 = buildEnv({ ...w, now: at19 });
  const sum = daySummary({ clients: e19.clients, checksOf: e19.checksOf, stateOf: e19.stateOf, tasks: [], personOf: e19.personOf, now: at19 });
  assert.ok(sum.rows.some((r) => r.person === 'amit'), JSON.stringify(sum.rows));
});

test('who writes: Amit the items of 4, 5, 6 and 8; not the office\'s; Ofir everything, as before', () => {
  const keys = ['p04.address', 'p04.saved', 'p05.got', 'p05.access', 'p05.logo', 'p06.ok', 'p08.ok', 'p05.handoff.amit'];
  for (const key of keys) {
    assert.equal(mayWrite({ person: 'amit', client: amits, key }), true, `amit ${key}`);
    assert.equal(mayWrite({ person: 'ofir', client: amits, key }), true, `ofir ${key}`);
  }
  for (const key of ['p04.followup', 'p05.vault', 'p07.made', 'p07.ofir', 'p22a.assigned', 'p25.q.sound']) {
    assert.equal(mayWrite({ person: 'amit', client: amits, key }), false, `amit ${key}`);
  }
  assert.equal(mayWrite({ person: 'amit', client: amits, key: 'p04.saved', note: 'ייבוא' }), false, 'no imported history');
  // The writers table goes by the key, not by the client (as it did for Noam): she may write 6 on any
  // client; her screens offer it only where it is hers (the owners above, her work list).
  assert.equal(mayWrite({ person: 'amit', client: shiels, key: 'p06.ok' }), true);
  assert.equal(mayWrite({ person: 'shiel', client: amits, key: 'p06.ok' }), false);
});

test('the screens: the meeting\'s form, every client, the Gantt index with Metricool, the clients\' links; no money', () => {
  const amit = { me: 'amit', scope: 'own', error: null };
  assert.ok(MEETING_PEOPLE.includes('amit'));
  assert.ok(CHAR_WRITERS.includes('amit'));
  assert.ok(ALL_CLIENTS_PEOPLE.includes('amit'));
  assert.equal(writesChar(amit), true);
  assert.equal(writesChar({ ...amit, error: 'x' }), false);
  assert.equal(listsAllClients('amit'), true);
  assert.ok(CONNECTORS.includes('amit'));
  assert.equal(canConnect(amit), true);
  assert.equal(worksCycle(amit), true);
  assert.equal(seesGantt(amit), true);
  assert.ok(LINK_MANAGERS.includes('amit'));
  assert.equal(canManageAccessLinks(amit), true);
  assert.equal(seesAccessLinks(amit), true);
  assert.ok(flowNeeds(amit).includes('metricool'));
  assert.ok(METRICOOL_OFFICE.includes('amit'));
  assert.equal(mayCall('brands', { person: 'amit' }), true);
  // Not the money or the contracts: her menu.
  const hrefs = menuOf(amit).map((x) => x.href).join(' ');
  for (const page of ['quotes.html', 'payments.html', 'contract', 'owner.html', 'insights.html']) assert.ok(!hrefs.includes(page), page);
  assert.ok(hrefs.includes('gantt.html'), hrefs);
  // Still nobody else's: Ilai and Shiel stay as they were.
  assert.equal(canManageAccessLinks({ me: 'shiel', scope: 'own' }), false);
  assert.equal(canConnect({ me: 'shiel', scope: 'own' }), false);
  assert.equal(writesChar({ me: 'ilai', scope: 'own', error: null }), false);
});
