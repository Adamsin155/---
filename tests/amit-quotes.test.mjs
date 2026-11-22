// Amit builds quotes and contracts and sees the list of sent quotes with its amounts, as Irit
// (the owner, 22.11.2026; docs/ops.md, section 144). Only the quotes: none of Irit's other screens or money.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  canBuildQuote, canEditQuote, canSeeQuoteList, seesQuoteMoney, seesFinance, canSeeDeals, isManager, canArchive,
  QUOTE_BUILDERS, QUOTE_LIST_VIEWERS,
} from '../app/manager-rules.js';
import { menuOf, barOf } from '../app/shell-rules.js';

const amit = { me: 'amit', scope: 'office', error: null };
const irit = { me: 'irit', scope: 'office', error: null };

test('Amit builds a contract and sees the sent quotes with their amounts', () => {
  assert.ok(QUOTE_BUILDERS.includes('amit'));
  assert.equal(canBuildQuote(amit), true);
  assert.equal(canSeeQuoteList(amit), true);
  assert.equal(seesQuoteMoney(amit), true);
  // the same as Irit on the quotes
  for (const f of [canBuildQuote, canEditQuote, canSeeQuoteList, seesQuoteMoney]) assert.equal(f(amit), f(irit), f.name);
  assert.equal(canEditQuote({ me: 'ilai', scope: 'office', error: null }), false);
  // a broken session gives nothing
  for (const f of [canBuildQuote, canSeeQuoteList, seesQuoteMoney]) assert.equal(f({ ...amit, error: 'x' }), false, f.name);
});

test('nothing else of Irit\'s: not a manager, no prices, no sellers\' deals, no archive', () => {
  assert.equal(isManager(amit), false);
  assert.equal(seesFinance(amit), false);
  assert.equal(canSeeDeals(amit), false);
  assert.equal(canArchive(amit), false);
  // Irit's line "ממתינות לחתימה" in "המשימות שלי" stays hers (chasing the signature is her work).
  assert.equal(QUOTE_LIST_VIEWERS.includes('amit'), false);
});

test('her menu: the builder and the list; nobody else\'s menu changed', () => {
  const ids = menuOf(amit).map((x) => x.id);
  assert.ok(ids.includes('quote') && ids.includes('quotes'), ids.join(' '));
  for (const id of ['payments', 'payouts', 'insights', 'manager', 'team']) assert.ok(!ids.includes(id), id);
  const { bar, more } = barOf(menuOf(amit), amit);
  assert.ok(bar.length <= 4 && [...bar, ...more].length === menuOf(amit).length);
  for (const me of ['shiel', 'ilai', 'stav', 'nirel', 'eli']) {
    const other = menuOf({ me, scope: me === 'shiel' || me === 'ilai' ? 'office' : 'own', error: null }).map((x) => x.id);
    assert.ok(!other.includes('quote') && !other.includes('quotes'), me);
  }
});

test('the server: the migration gives her public.sees_quote_money(), and the functions follow the shared rules', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261220100000_amit_quotes.sql', import.meta.url), 'utf8');
  assert.match(sql, /my_person\(\) = 'amit'/);
  // the mcp function's copy of the rules (scripts/sync-functions.mjs) has her as a builder
  const copy = readFileSync(new URL('../supabase/functions/_shared/app/manager-rules.js', import.meta.url), 'utf8');
  assert.match(copy, /QUOTE_BUILDERS = \['irit', 'lior', 'ofir', 'amit'\]/);
});
