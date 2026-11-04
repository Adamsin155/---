// Irit, Ofir and Lior get what the owners have, except security and the payments app (the owner's
// decision of 4.11.2026; docs/ops.md, section 96): the app's rules, per role, held equal to the
// database's (supabase/migrations/20261128100000_managers_all.sql; tests/sql/managers-all.test.mjs
// checks the database itself).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scopeOf } from '../app/protocol.js';
import {
  MANAGERS, isManager, seesFinance, seesQuoteMoney, canSeeQuoteList, canSeeDeals, canArchive, canPurge, canSeeTable, canSeeShootTable,
  canSeeOfficeQueues, canSeeQa, hasProfiles, managerHome,
} from '../app/manager-rules.js';
import { menuOf, profileMenu, editsGantt, GANTT_EDITORS } from '../app/shell-rules.js';
import { canManageTeam, canAdminTeam, linkOnlyByOwner, canEditPhone, TEAM_MANAGERS, isOwnerView } from '../app/team-rules.js';
import { TEAM_MANAGERS as FN_TEAM_MANAGERS, planUpsert, planLink, planPhone, planRemove, roleOf, ERR, LINK_PAGES } from '../supabase/functions/staff-admin/rules.js';
import { canSendMessages } from '../app/messages-logic.js';
import { canSeeInsights } from '../app/insights.js';
import { seesWholeTeam, canSeeOwnerScreen } from '../app/health.js';
import { canSeeWorkHistory } from '../app/work-history-logic.js';
import { canUnassign } from '../app/card-assign-logic.js';
import { CONNECTORS, showsCard } from '../app/metricool-connect-logic.js';
import { ON_BEHALF } from '../app/availability-logic.js';
import { MONEY_RPC, MONEY_RPC_BEFORE } from '../app/ask-logic.js';
import { GATE_RPCS, GATE_FALLBACK_RPC } from '../supabase/functions/mcp/handler.js';

const v = (me) => ({ me, scope: me ? scopeOf(me) : 'office', error: null });
const OWNER = v(null);
const THREE = ['irit', 'ofir', 'lior'];
const REST = ['ilai', 'noam', 'nadia', 'nirel', 'eli', 'stav'];
const MIGRATION = readFileSync(new URL('../supabase/migrations/20261128100000_managers_all.sql', import.meta.url), 'utf8');
// The persons a function of the migration names, as written in its "s.person in (...)".
const personsOf = (fn) => {
  const body = new RegExp(`function public\\.${fn}\\(\\)[\\s\\S]*?\\$\\$;`).exec(MIGRATION)?.[0] || '';
  return [...(/s\.person in \(([^)]*)\)/.exec(body)?.[1] || '').matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort();
};

test('the managers are Irit, Ofir and Lior; the database\'s sees_income() and is_manager() name the same three', () => {
  assert.deepEqual([...MANAGERS].sort(), [...THREE].sort());
  assert.deepEqual(personsOf('sees_income'), [...THREE].sort());
  assert.deepEqual(personsOf('is_manager'), [...THREE].sort());
  assert.deepEqual(personsOf('can_approve_quotes'), [...THREE].sort());
});

test('everything the owners have, every work screen and the money: the owners and the three; nobody else', () => {
  for (const who of [OWNER, ...THREE.map(v)]) {
    const name = who.me || 'owner';
    for (const [rule, fn] of Object.entries({ isManager, seesFinance, seesQuoteMoney, canSeeQuoteList, canSeeDeals, canArchive, canSeeTable, canSeeShootTable, canSeeOfficeQueues, canSeeQa, hasProfiles, canSendMessages, canSeeInsights, seesWholeTeam, canSeeOwnerScreen, canSeeWorkHistory, canUnassign, editsGantt, canManageTeam })) {
      assert.equal(fn(who), true, `${name}: ${rule}`);
    }
    assert.equal(managerHome(who), 'owner.html#now', name);
  }
  for (const who of REST.map(v)) {
    for (const [rule, fn] of Object.entries({ isManager, seesFinance, seesQuoteMoney, canSeeDeals, canArchive, canPurge, canSeeOwnerScreen, canSendMessages, canSeeInsights, canManageTeam, canAdminTeam })) {
      assert.equal(fn(who), false, `${who.me}: ${rule}`);
    }
  }
});

test('the menus: the three have the owners\' list but the payments app; the owners keep it', () => {
  const ids = (who) => menuOf(who).map((it) => it.id);
  const owners = ids(OWNER);
  assert.ok(owners.includes('payouts'));
  for (const who of THREE.map(v)) {
    assert.deepEqual(ids(who), owners.filter((id) => id !== 'payouts'), who.me);
    for (const p of ['mine', 'manager']) assert.equal(profileMenu(who, p).some((it) => it.id === 'payouts'), false, `${who.me} ${p}`);
  }
  for (const who of REST.map(v)) assert.equal(ids(who).includes('payouts') || ids(who).includes('team'), false, who.me);
});

test('kept the owners\': the permanent purge, the payments app, and every action on the team page', () => {
  assert.equal(canPurge(OWNER), true);
  assert.equal(canAdminTeam(OWNER), true);
  for (const who of THREE.map(v)) {
    assert.equal(canPurge(who), false, who.me);
    assert.equal(canAdminTeam(who), false, who.me);
    assert.equal(isOwnerView(who), false, who.me);
  }
  // The team page and the function agree: the three read the list, and nothing else.
  assert.deepEqual(TEAM_MANAGERS, FN_TEAM_MANAGERS);
  assert.deepEqual([...TEAM_MANAGERS].sort(), [...THREE].sort());
  const nadia = { email: 'n@a.test', person: 'nadia', vault: false };
  for (const person of THREE) {
    const me = { email: `${person}@a.test`, person, vault: true };
    const role = roleOf(me);
    assert.equal(role, 'manager');
    const caller = { ...me, owner: false };
    assert.equal(linkOnlyByOwner(caller, nadia), true, person);
    assert.equal(canEditPhone(caller, nadia), false, person);
    assert.equal(planUpsert({ role, callerEmail: me.email, existing: null, input: { email: 'x@a.test', person: 'eli' } }).error, ERR.ownerOnly, person);
    assert.equal(planUpsert({ role, callerEmail: me.email, existing: nadia, input: { email: nadia.email, vault: true } }).error, ERR.ownerOnly, person);
    assert.equal(planLink({ role, me, target: nadia, redirectTo: LINK_PAGES[0] }).error, ERR.ownerOnly, person);
    assert.equal(planLink({ role, me, target: me, redirectTo: LINK_PAGES[0] }).error, ERR.ownerOnly, `${person}: own`);
    assert.equal(planPhone({ role, target: nadia, input: { email: nadia.email, phone: '0501234567' } }).error, ERR.ownerOnly, person);
    assert.equal(planRemove({ role, callerEmail: me.email, existing: nadia }).error, ERR.ownerOnly, person);
  }
  assert.equal(planLink({ role: 'owner', target: nadia, redirectTo: LINK_PAGES[0] }).ok, true);
});

test('the work that was the owners\' or a colleague\'s: the app\'s lists match the database\'s', () => {
  assert.deepEqual([...GANTT_EDITORS].sort(), personsOf('can_edit_gantt').filter((p) => p !== 'noam').sort());
  // gantt.js keeps its own copy (its public view loads no menu module).
  const gantt = readFileSync(new URL('../app/gantt.js', import.meta.url), 'utf8');
  assert.deepEqual(JSON.parse(/export const GANTT_EDITORS = (\[[^\]]*\]);/.exec(gantt)[1].replace(/'/g, '"')), GANTT_EDITORS);
  assert.deepEqual(CONNECTORS.filter((p) => p !== 'owner').sort(), personsOf('can_connect_metricool'));
  // Connecting is not Irit's or Lior's task: the card stays out of their "המשימות שלי".
  for (const me of ['irit', 'lior']) assert.deepEqual([showsCard(v(me), true), showsCard(v(me), false)], [false, true], me);
  assert.deepEqual(personsOf('can_manage_status_links'), [...THREE].sort());
  assert.deepEqual(personsOf('can_manage_scripts'), [...THREE].sort());
  assert.deepEqual([...ON_BEHALF].sort(), ['irit', 'lior', 'ofir', 'owner']);
  assert.match(MIGRATION, /reminder_person\(\) in \('owner', 'irit', 'lior', 'ofir'\)/);
});

test('the ask and mcp functions read money through sees_income(), with sees_money() before the migration', () => {
  assert.equal(MONEY_RPC, 'sees_income');
  assert.equal(MONEY_RPC_BEFORE, 'sees_money');
  assert.equal(GATE_RPCS.at(-1), MONEY_RPC);
  assert.equal(GATE_FALLBACK_RPC, MONEY_RPC_BEFORE);
  const ask = readFileSync(new URL('../supabase/functions/ask/handler.js', import.meta.url), 'utf8');
  assert.match(ask, /\['is_office', 'my_person', MONEY_RPC\]/);
  assert.match(ask, /income\.error \? await userClient\.rpc\(MONEY_RPC_BEFORE\) : income/);
});
