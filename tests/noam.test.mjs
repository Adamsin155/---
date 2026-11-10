// Noam left the company (the owner, 10.11.2026; docs/ops.md, section 124). Ofir took over all of
// her work. (From 1.11.2026 she ran characterization meetings and set pages and Highlights up.)
//   - no list offers her: the characterizer pickers (the card, "קביעת מועד", "פגישה חדשה", the
//     owner's Claude tools), tasks, notes, reminders, ask, the team screen, the work lists, the
//     load tables, Metricool, the clients' links, the Gantt, the meeting's form;
//   - her name stays for the history: an old client still set to 'noam', an old hand-off record,
//     a mark she made (the `person` of a mark), a note to her;
//   - the work of an old client still set to her is Ofir's: 4, 5, 6, 8 and 8ב, the hand-off of 5,
//     the reminders, Ofir's meetings, and a new date set by the owner's Claude tools.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PEOPLE, SCOPE, TEAM_PEOPLE, STAFF_PEOPLE, ASSIGNABLE_PEOPLE, CHARACTERIZERS, DEFAULT_CHARACTERIZER,
  FORMER_PEOPLE, isFormer, characterizerOf, characterizedBy, pagesOwnerOf,
} from '../app/protocol.js';
import { applicableProcesses } from '../app/protocol-logic.js';
import { characterizerName } from '../app/characterization.js';
import { handoffsFor, describeMark } from '../app/handoffs.js';
import { REMINDER_PEOPLE, RING_TARGETS, lateRungOf } from '../app/reminder-rules.js';
import { ofirMeetings } from '../app/office-marks.js';
import { mayWrite } from '../scripts/protocol-writers.mjs';
import { writesChar, MEETING_PEOPLE, ALL_CLIENTS_PEOPLE, CHAR_WRITERS, seesGantt } from '../app/shell-rules.js';
import { canConnect, CONNECTORS } from '../app/metricool-connect-logic.js';
import { LINK_MANAGERS, canManageAccessLinks, seesAccessLinks } from '../app/access-data.js';
import { worksCycle } from '../app/month-ui.js';
import { MEET_PEOPLE } from '../app/new-meeting-logic.js';
import { ASSIGNEES } from '../app/staff-tasks-logic.js';
import { NOTE_PEOPLE, personName, notesByPerson } from '../app/staff-notes-logic.js';
import { ASK_PEOPLE } from '../app/ask-logic.js';
import { INSIGHT_PEOPLE } from '../app/insights.js';
import { OFFICE_PERSONS } from '../app/team-rules.js';
import { PERSONS, OFFICE_PERSONS as FN_OFFICE } from '../supabase/functions/staff-admin/rules.js';
import { OFFICE as METRICOOL_OFFICE } from '../supabase/functions/metricool/sync.js';

const at = '2026-11-02T08:00:00.000Z';
const base = { status: 'active', has_logo: true, char_at: at, deal_at: at, created_at: at, rounds: [], deliverables: { videos: 25, graphics: 36 } };
const noams = { ...base, id: 'n1', name: 'קפה נעמה', characterizer: 'noam' };
const ownersOf = (c, id) => {
  const p = applicableProcesses(c).find((x) => x.id === id);
  return [...new Set(p.items.filter((i) => !i.optional && !i.when).flatMap((i) => (typeof i.owners === 'function' ? i.owners(c) : i.owners) || (typeof p.owners === 'function' ? p.owners(c) : p.owners)))].sort();
};
const src = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('no picker, list or menu offers Noam', () => {
  assert.equal(PEOPLE.noam.left, true);
  assert.equal(isFormer('noam'), true);
  assert.equal(isFormer('ofir'), false);
  assert.deepEqual(FORMER_PEOPLE, { noam: 'ofir' });
  assert.deepEqual(CHARACTERIZERS, ['ofir', 'shiel', 'lior']);
  assert.equal(DEFAULT_CHARACTERIZER, 'ofir');
  assert.deepEqual(MEET_PEOPLE, CHARACTERIZERS);
  // The characterizer pickers written in the pages: the card's edit form and "קביעת מועד".
  for (const page of ['client.html', 'clients.html']) {
    assert.doesNotMatch(src(page), /value="noam"|>נעם</, page);
    assert.match(src(page), /<option value="ofir">אופיר<\/option>/, page);
  }
  const lists = {
    TEAM_PEOPLE: TEAM_PEOPLE().map((p) => p.key), STAFF_PEOPLE: STAFF_PEOPLE().map((p) => p.key),
    ASSIGNABLE_PEOPLE: ASSIGNABLE_PEOPLE().map((p) => p.key), ASSIGNEES: ASSIGNEES().map((p) => p.key),
    NOTE_PEOPLE: NOTE_PEOPLE().map((p) => p.key), ASK_PEOPLE, INSIGHT_PEOPLE, REMINDER_PEOPLE: [...REMINDER_PEOPLE],
    RING_TARGETS: Object.keys(RING_TARGETS), CONNECTORS, LINK_MANAGERS, CHAR_WRITERS, MEETING_PEOPLE, ALL_CLIENTS_PEOPLE,
    OFFICE_PERSONS, FN_OFFICE, PERSONS, METRICOOL_OFFICE, SCOPE: Object.keys(SCOPE),
  };
  for (const [name, list] of Object.entries(lists)) assert.ok(!list.includes('noam'), name);
  assert.deepEqual(PERSONS, TEAM_PEOPLE().map((p) => p.key));
  assert.ok(ASSIGNEES().some((p) => p.key === 'ofir'));
});

test('no screen or right is hers any more', () => {
  const noam = { me: 'noam', scope: 'own', error: null };
  assert.equal(writesChar(noam), false);
  assert.equal(canConnect(noam), false);
  assert.equal(worksCycle(noam), false);
  assert.equal(seesGantt(noam), false);
  assert.equal(canManageAccessLinks(noam), false);
  assert.equal(seesAccessLinks(noam), false);
  for (const key of ['p04.address', 'p05.access', 'p06.verified', 'p08.done', 'p08b.posted']) {
    assert.equal(mayWrite({ person: 'noam', client: noams, key }), false, key);
    assert.equal(mayWrite({ person: 'ofir', client: noams, key }), true, key);
  }
});

test('the history keeps her name: an old client, an old hand-off, a note to her', () => {
  assert.equal(PEOPLE.noam.name, 'נעם');
  assert.equal(characterizedBy(noams), 'noam');
  assert.equal(characterizerName(noams), 'נעם');
  assert.equal(characterizerName({ characterizer: 'ofir' }), 'אופיר');
  assert.equal(characterizerName({ characterizer: null }), 'אופיר');
  assert.equal(describeMark('p05.handoff.noam'), 'גישות התקבלו ← נעם');
  assert.equal(personName('noam'), 'נעם');
  assert.deepEqual(notesByPerson([{ person: 'noam', body: 'x', created_at: at }]).map((g) => g.name), ['נעם']);
  // The card's edit form keeps her name for such a client alone (app/client-card.js).
  assert.match(src('app/client-card.js'), /if \(isFormer\(c\.characterizer\)\) charSel\.append/);
});

test('the work of an old client still set to her is Ofir\'s', () => {
  assert.equal(characterizerOf(noams), 'ofir');
  assert.equal(pagesOwnerOf(noams), 'ofir');
  for (const id of ['p04', 'p06', 'p08', 'p08b']) assert.deepEqual(ownersOf(noams, id).filter((p) => p !== 'irit'), ['ofir'], id);
  assert.ok(ownersOf(noams, 'p05').includes('ofir'));
  assert.ok(!ownersOf(noams, 'p05').includes('noam'));
  assert.equal(lateRungOf('p08b', noams), 'ofir');
  const checks = { 'p05.access': { state: 'done', at: '2026-11-02T09:00:00.000Z', by_email: 'irit@x', note: null } };
  assert.deepEqual(handoffsFor(noams, checks, 'p05.access', { now: new Date('2026-11-02T09:01:00.000Z'), from: 'irit' }).map((o) => [o.person, o.markKey]), [['ofir', 'p05.handoff.ofir']]);
  // Ofir's fast ladder waits for her old clients' meetings, and for a client with nobody set.
  const meet = (characterizer) => ({ ...base, characterizer, char_at: '2026-11-10T08:00:00.000Z' });
  assert.equal(ofirMeetings([meet('noam'), meet(null), meet('ofir')], () => ({})).length, 3);
  assert.equal(ofirMeetings([meet('shiel'), meet('lior')], () => ({})).length, 0);
});

test('the database: the migration takes her out of the functions, and keeps the history\'s checks', () => {
  const sql = src('supabase/migrations/20261209100000_remove_noam.sql');
  for (const fn of ['is_office', 'can_connect_metricool', 'can_edit_gantt', 'can_manage_access_links', 'ofir_meetings', 'access_form_submit', 'staff_task_create_brief']) {
    assert.match(sql, new RegExp(`create or replace function public\\.${fn}\\(`), fn);
  }
  assert.match(sql, /create or replace function private\.task_gives_access\(/);
  // 'noam' stays only where an old client is read as Ofir's (ofir_meetings).
  const code = sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
  assert.deepEqual([...code.matchAll(/'noam'/g)].length, 1);
  assert.match(code, /coalesce\(c\.characterizer, 'ofir'\) in \('ofir', 'noam'\)/);
  // Nothing is dropped or deleted.
  assert.doesNotMatch(code, /\b(drop|delete|truncate)\b/i);
});
