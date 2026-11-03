// Noam (the owner's decision of 1.11.2026; docs/ops.md, section 86): the characterization meetings
// (4), the logins taken there (5), checking them and setting the pages up (6) and the Highlights
// (8, 8ב). "Either Ofir or Noam does it": per client, whoever Irit picks as the characterizer owns
// those processes of that client, and a client with none set is Noam's. Ofir keeps every right.
//   - the people: Noam's row, his scope ('own', as Ilai), the lists the team screen and the
//     function keep, the characterizers Irit can pick;
//   - the owners of 4, 5, 6, 8 and 8ב for a client of Noam's, of Ofir's, of Lior's and of nobody's;
//   - the work lists, the hand-off of 5, the reminders and the late watchers follow the client;
//   - who writes: Noam the items of those processes, Ofir (the office) everything as before;
//   - Ofir's meetings (his fast ladder waits for them) are only his own clients' meetings;
//   - the screens: the form of the meeting, the Metricool card, the Gantt index.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PEOPLE, SCOPE, TEAM_PEOPLE, STAFF_PEOPLE, PROCESSES, CHARACTERIZERS, DEFAULT_CHARACTERIZER,
  characterizerOf, pagesOwnerOf,
} from '../app/protocol.js';
import { applicableProcesses, clientState, openItemsFor } from '../app/protocol-logic.js';
import { handoffsFor, describeMark } from '../app/handoffs.js';
import { RULES, LATE_WATCHERS, lateRungOf, RING_TARGETS } from '../app/reminder-rules.js';
import { ofirMeetings } from '../app/office-marks.js';
import { mayWrite } from '../scripts/protocol-writers.mjs';
import { writesChar, MEETING_PEOPLE, seesGantt } from '../app/shell-rules.js';
import { canConnect, CONNECTORS } from '../app/metricool-connect-logic.js';
import { worksCycle } from '../app/month-ui.js';
import { MEET_PEOPLE } from '../app/new-meeting-logic.js';
import { OFFICE_PERSONS, linkOnlyByOwner } from '../app/team-rules.js';
import { PERSONS, OFFICE_PERSONS as FN_OFFICE } from '../supabase/functions/staff-admin/rules.js';

const IL = (y, m, d, h = 0, min = 0) => new Date(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00+03:00`);
const done = (at, by = 'irit@x') => ({ state: 'done', at: at.toISOString(), by_email: by, note: null });
const base = { status: 'active', has_logo: true, char_at: IL(2026, 10, 20, 8).toISOString(), deal_at: IL(2026, 10, 19, 9).toISOString(), created_at: IL(2026, 10, 19, 9).toISOString(), rounds: [], deliverables: { videos: 25, graphics: 36 } };
const noams = { ...base, id: 'n1', name: 'קפה נעמה', characterizer: 'noam' };
const ofirs = { ...base, id: 'o1', name: 'מאפיית שחר', characterizer: 'ofir' };
const nobodys = { ...base, id: 'x1', name: 'פיצה ללא', characterizer: null };
const liors = { ...base, id: 'l1', name: 'מספרת ליאור', characterizer: 'lior' };
const ownersOf = (c, id) => {
  const p = applicableProcesses(c).find((x) => x.id === id);
  return [...new Set(p.items.filter((i) => !i.optional && !i.when).flatMap((i) => (typeof i.owners === 'function' ? i.owners(c) : i.owners) || (typeof p.owners === 'function' ? p.owners(c) : p.owners)))].sort();
};

test('the people: Noam on the team, an own screen as Ilai\'s, and a characterizer Irit can pick', () => {
  assert.deepEqual(PEOPLE.noam, { key: 'noam', name: 'נעם', role: 'אפיונים, הקמת דפים ו־Highlights' });
  assert.equal(SCOPE.noam, 'own');
  assert.ok(TEAM_PEOPLE().some((p) => p.key === 'noam'));
  assert.ok(STAFF_PEOPLE().some((p) => p.key === 'noam'));
  assert.deepEqual(PERSONS, TEAM_PEOPLE().map((p) => p.key));
  assert.deepEqual(CHARACTERIZERS, ['noam', 'ofir', 'lior']);
  assert.deepEqual(MEET_PEOPLE, CHARACTERIZERS);
  assert.equal(DEFAULT_CHARACTERIZER, 'noam');
  assert.deepEqual([noams, ofirs, nobodys, liors].map(characterizerOf), ['noam', 'ofir', 'noam', 'lior']);
  assert.deepEqual([noams, ofirs, nobodys, liors].map(pagesOwnerOf), ['noam', 'ofir', 'noam', 'ofir']);
  // He sees every client in the database, as Ilai (public.is_office()), so only the owner makes his sign-in link.
  assert.deepEqual(OFFICE_PERSONS, ['irit', 'lior', 'ofir', 'ilai', 'noam']);
  assert.deepEqual(FN_OFFICE, OFFICE_PERSONS);
  assert.equal(linkOnlyByOwner({ owner: false, email: 'irit@x' }, { email: 'noam@x', person: 'noam', vault: false }), true);
  assert.equal(RING_TARGETS.noam, 5);
});

test('the owners: the client\'s characterizer has 4, 6, 8 and 8ב, and 5 when he ran the meeting', () => {
  for (const [c, who, access] of [[noams, 'noam', 'noam'], [ofirs, 'ofir', 'ofir'], [nobodys, 'noam', 'irit']]) {
    assert.deepEqual(ownersOf(c, 'p04').filter((p) => p !== 'irit'), [who], `${c.name} 4`);
    assert.deepEqual(ownersOf(c, 'p06'), [who], `${c.name} 6`);
    assert.deepEqual(ownersOf(c, 'p08'), [who], `${c.name} 8`);
    assert.deepEqual(ownersOf(c, 'p08b'), [who], `${c.name} 8ב`);
    assert.ok(ownersOf(c, 'p05').includes(access), `${c.name} 5`);
  }
  // Lior runs a meeting only when nobody else can: the meeting and the logins are his; the pages and the Highlights stay Ofir's.
  assert.deepEqual(ownersOf(liors, 'p04').filter((p) => p !== 'irit'), ['lior']);
  assert.deepEqual([ownersOf(liors, 'p06'), ownersOf(liors, 'p08'), ownersOf(liors, 'p08b')], [['ofir'], ['ofir'], ['ofir']]);
  // The broken logins (p06.recovered) were Lior's; they left the protocol in v12 (to nobody).
  const p06 = applicableProcesses(noams).find((p) => p.id === 'p06');
  assert.equal(p06.items.find((i) => i.key === 'p06.recovered'), undefined);
  // Nothing else moved: the graphics' checks are Ofir's for Noam's client too.
  const p07 = applicableProcesses(noams).find((p) => p.id === 'p07');
  assert.deepEqual(p07.items.find((i) => i.key === 'p07.ofir').owners, ['ofir']);
  // The words: 3 asks for Noam or Ofir; 8 and 8ב name the one who characterizes.
  const p03 = PROCESSES.find((p) => p.id === 'p03');
  assert.match(p03.what, /מבצע האפיון \(נעם או אופיר\)/);
  assert.equal(p03.items.find((i) => i.key === 'p03.who').label, 'נקבע מי מבצע את האפיון (נעם או אופיר, או ליאור כשהם לא יכולים)');
  assert.match(PROCESSES.find((p) => p.id === 'p08').what, /^מבצע האפיון \(נעם או אופיר\) מכין/);
});

test('the work lists: 6 is on Noam\'s list for his client and on Ofir\'s for Ofir\'s', () => {
  const checks = {};
  for (const id of ['p01', 'p02', 'p03', 'p04']) for (const i of PROCESSES.find((p) => p.id === id).items.filter((x) => !x.optional && !x.when)) checks[i.key] = done(IL(2026, 10, 20, 8, 55));
  checks['p05.access'] = done(IL(2026, 10, 20, 9));
  const now = IL(2026, 10, 20, 9, 10);
  const open = (who, c) => openItemsFor(who, c, checks, clientState(c, checks, now), now).filter((e) => e.proc.id === 'p06').map((e) => e.item.key);
  assert.ok(open('noam', noams).includes('p06.verified'));
  assert.deepEqual(open('ofir', noams), []);
  assert.ok(open('ofir', ofirs).includes('p06.verified'));
  assert.deepEqual(open('noam', ofirs), []);
});

test('the hand-off of 5: to the client\'s characterizer, never to himself; each record names its person', () => {
  const checks = { 'p05.access': done(IL(2026, 11, 2, 11)) };
  const at = { now: IL(2026, 11, 2, 11, 1) };
  const offers = (c, from) => handoffsFor(c, checks, 'p05.access', { ...at, from }).map((o) => [o.person, o.markKey]);
  assert.deepEqual(offers(noams, 'irit'), [['noam', 'p05.handoff.noam']]);
  assert.deepEqual(offers(ofirs, 'irit'), [['ofir', 'p05.handoff.ofir']]);
  assert.deepEqual(offers(noams, 'noam'), []);
  assert.equal(describeMark('p05.handoff.noam'), 'גישות התקבלו ← נעם');
  assert.equal(describeMark('p05.handoff.ofir'), 'גישות התקבלו ← אופיר');
});

test('the reminders of 6 and 8ב go to the client\'s characterizer; Ofir and Lior still hear what is late', () => {
  const to = (rule, step, i) => {
    const s = RULES.find((r) => r.id === rule).steps.find((x) => x.id === step);
    return typeof s.to === 'function' ? s.to(i) : s.to;
  };
  for (const [c, who] of [[noams, 'noam'], [ofirs, 'ofir'], [nobodys, 'noam']]) {
    const i = { client: c, checker: pagesOwnerOf(c) };
    assert.equal(to('access', 'now', i), who);
    assert.equal(to('access', 'ofir30', i), who);
    assert.equal(to('access', 'lior', i), 'lior');
    assert.equal(to('accessForm', 'ofir', i), who);
    assert.equal(to('accessClosed', 'ofir', i), who);
    assert.equal(to('accessClosed', 'irit', i), 'irit');
    assert.equal(to('highlightsUpload', 'now', i), who);
    assert.equal(to('highlightsUpload', 'due', i), who);
  }
  assert.equal(RULES.find((r) => r.id === 'access').steps.find((s) => s.id === 'lior').body({ checker: 'noam' }), 'עברו 30 דקות מקבלת הגישות ונעם עוד לא סימן שבדק.');
  // The late 8ב: Noam rang for it, so both watchers hear; for Ofir's client only Lior does.
  assert.deepEqual(LATE_WATCHERS, ['ofir', 'lior']);
  assert.equal(lateRungOf('p08b', noams), 'noam');
  assert.equal(lateRungOf('p08b', ofirs), 'ofir');
  assert.equal(lateRungOf('p07', noams), null);
});

test('who writes: Noam the items of 4, 5, 6, 8 and 8ב; Ofir everything, as before', () => {
  const keys = ['p04.address', 'p04.saved', 'p05.access', 'p05.logo', 'p06.verified', 'p06.newpages', 'p06.metricool', 'p08.done', 'p08.saved', 'p08b.posted', 'p05.handoff.noam', 'p06.claim'];
  for (const key of keys) {
    assert.equal(mayWrite({ person: 'ofir', client: noams, key }), true, `ofir ${key}`);
  }
  for (const key of keys.filter((k) => k !== 'p06.claim')) assert.equal(mayWrite({ person: 'noam', client: noams, key }), true, `noam ${key}`);
  for (const key of ['p04.followup', 'p05.vault', 'p06.recovered', 'p07.made', 'p07.ofir', 'p22a.assigned', 'p25.q.sound']) {
    assert.equal(mayWrite({ person: 'noam', client: noams, key }), false, `noam ${key}`);
  }
  assert.equal(mayWrite({ person: 'noam', client: noams, key: 'p04.saved', note: 'ייבוא' }), false, 'no imported history');
});

test('Ofir\'s meetings are only the clients he characterizes', () => {
  const at = IL(2026, 11, 2, 10);
  const c = (characterizer) => ({ ...base, characterizer, char_at: at.toISOString() });
  assert.equal(ofirMeetings([c('ofir')], () => ({})).length, 1);
  assert.equal(ofirMeetings([c('noam'), c(null), c('lior')], () => ({})).length, 0);
});

test('the screens: the meeting\'s form, the Metricool card and the Gantt index for Noam', () => {
  const noam = { me: 'noam', scope: 'own', error: null };
  assert.deepEqual(MEETING_PEOPLE, ['noam']);
  assert.equal(writesChar(noam), true);
  assert.equal(writesChar({ me: 'ilai', scope: 'own', error: null }), false);
  assert.equal(writesChar({ me: 'ofir', scope: 'office', error: null }), true);
  assert.ok(CONNECTORS.includes('noam'));
  assert.equal(canConnect(noam), true);
  assert.equal(worksCycle(noam), true);
  assert.equal(seesGantt(noam), true);
  assert.equal(writesChar({ me: 'noam', scope: 'own', error: 'x' }), false);
});
