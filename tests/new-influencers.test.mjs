// Niro Levi and "הצל" (Yoav Eliasi), the owner's decision of 28.10.2026: each sold and run
// exactly as Natali Dadon (app/catalog.js STARS; app/protocol.js isStarDay, starWords).
//   - the catalog: Natali's three packages, prices and quantities, in their own name; a reel
//     and a story each, in their own packages only; "צירוף סמיון" stays Natali's;
//   - the agreement and the quantities the signed client gets;
//   - the shoot day: the makeup artist and the ride (11ב, 15), three hours (20), Nirel
//     preselected and seeing the client, the scripts' advice, the reminders, the shoot-day
//     screens; every word names the day's own influencer, never Natali;
//   - the forms offer the new days; the payouts system keeps its two families until the owner
//     sets the new ones' rates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { INFLUENCERS, PACKAGES, SPECS, PAID_ADDONS, FREE_ADDONS, STARS, INCLUDES_KEYS } from '../app/catalog.js';
import { emptySelection, validateSelection, computeTotals, buildQuoteModel, paidAddonAvailable, freeAddonAvailable } from '../app/pricing.js';
import { PROCESSES, SHOOT_TYPES, STAR_TYPES, isStarDay, starShort, starWords, starProcess } from '../app/protocol.js';
import { applicableProcesses, packageDeliverables } from '../app/protocol-logic.js';
import { shootTypeOf, packageName } from '../app/client-open.js';
import { preselected, reasonHint, suggestAssignment } from '../app/qa-logic.js';
import { shootMinutes, visibleTo } from '../app/calendar-feed.js';
import { canTake } from '../app/landing-logic.js';
import { crewText } from '../app/messages-logic.js';
import { coordinatorOf, shootContexts, DAY_BEFORE_LABELS, dayBeforeText } from '../app/shoot-prep.js';
import { shootCases, timeline } from '../app/production.js';
import { CREW_GROUPS } from '../app/shoot-crew.js';
import { computeReminders } from '../app/reminder-engine.js';
import { importKeys } from '../app/client-open.js';
import { PAYOUT_FAMILIES, payoutInfluencers } from '../app/payouts/engine.js';
import { dateIL } from '../app/tz.js';

const NEW = ['niro', 'hatzel'];
const sel = (tier, influencer, paid = [], free = {}) => ({ ...emptySelection(), tier, influencer, paid, free: { ...emptySelection().free, ...free } });
const IL = (y, m, d, h = 0, mi = 0) => dateIL(y, m, d, h, mi);

/* ── The catalog and the prices ─────────────── */

test('the influencers: Niro Levi and "הצל" (Yoav Eliasi), each with a shoot day of their own', () => {
  assert.deepEqual(STARS, ['natali', 'niro', 'hatzel']);
  assert.equal(INFLUENCERS.niro.name, 'נירו לוי');
  assert.equal(INFLUENCERS.hatzel.name, 'הצל (יואב אליאסי)');
  assert.deepEqual(Object.keys(INFLUENCERS), ['natali', 'simeon', 'niro', 'hatzel']);
});

test('six new packages: Natali\'s prices, quantities and lines, in the influencer\'s own name', () => {
  for (const inf of NEW) {
    for (const tier of ['podcast', 'social', 'social-tv']) {
      const id = `${tier}-${inf}`;
      const mine = PACKAGES[id];
      const hers = PACKAGES[`${tier}-natali`];
      assert.ok(mine, id);
      assert.equal(mine.price, hers.price, id);
      assert.equal(mine.tier, tier);
      assert.equal(mine.influencer, inf);
      assert.deepEqual(SPECS[id], SPECS[`${tier}-natali`], id);
      assert.deepEqual(INCLUDES_KEYS[id], INCLUDES_KEYS[`${tier}-natali`], id);
      assert.deepEqual(mine.includes.map((l) => l.qty), hers.includes.map((l) => l.qty), id);
      assert.deepEqual(mine.includes.map((l) => l.label), hers.includes.map((l) => l.label.replace('נטלי דדון', INFLUENCERS[inf].name)), id);
      assert.ok(!JSON.stringify(mine).includes('נטלי'), id);
    }
  }
  assert.deepEqual([350000, 390000, 490000], ['podcast', 'social', 'social-tv'].map((t) => PACKAGES[`${t}-niro`].price));
  // Natali's own packages are as they were.
  assert.equal(PACKAGES['social-natali'].includes[0].label, 'יום צילום בבית העסק עם נטלי דדון');
});

test('four new add-ons: a reel (1,000 ₪) and a story (300 ₪) at each, in their own packages only', () => {
  for (const inf of NEW) {
    const reel = PAID_ADDONS.find((a) => a.id === `${inf}-reel`);
    const story = PAID_ADDONS.find((a) => a.id === `${inf}-story`);
    assert.deepEqual([reel.price, story.price], [100000, 30000]);
    assert.equal(reel.name, `העלאה אצל ${INFLUENCERS[inf].name}`);
    assert.equal(story.name, `סטורי אצל ${INFLUENCERS[inf].name}`);
    for (const tier of ['podcast', 'social', 'social-tv']) {
      for (const other of Object.keys(INFLUENCERS)) {
        assert.equal(paidAddonAvailable(reel, sel(tier, other)), other === inf, `${reel.id} in ${tier}-${other}`);
        assert.equal(paidAddonAvailable(story, sel(tier, other)), other === inf, `${story.id} in ${tier}-${other}`);
      }
    }
    assert.throws(() => validateSelection(sel('social', inf, ['natali-reel'])), /not available/);
    assert.throws(() => validateSelection(sel('social', 'natali', [`${inf}-story`])), /not available/);
  }
  // Simeon joining the shoot day stays Natali's.
  for (const inf of NEW) {
    assert.equal(freeAddonAvailable('simeonJoin', sel('social', inf)), false);
    assert.throws(() => validateSelection(sel('social', inf, [], { simeonJoin: true })), /simeonJoin/);
  }
  assert.equal(FREE_ADDONS.simeonJoin.name, 'צירוף סמיון ליום הצילום עם נטלי');
});

test('the totals are Natali\'s, and the agreement names the influencer', () => {
  for (const inf of NEW) {
    const a = computeTotals(sel('social-tv', inf, ['photographer', `${inf}-reel`, `${inf}-story`]));
    const b = computeTotals(sel('social-tv', 'natali', ['photographer', 'natali-reel', 'natali-story']));
    assert.deepEqual(a, b);
    const m = buildQuoteModel({ ...sel('social', inf, [`${inf}-reel`]), docType: 'agreement' }, { name: 'x' });
    assert.equal(m.package.influencer, INFLUENCERS[inf].name);
    const text = m.legal.map((s) => `${s.title} ${s.items.join(' ')}`).join(' ');
    assert.ok(text.includes(`בהשתתפות ${INFLUENCERS[inf].name}`));
    assert.ok(!text.includes('נטלי'), inf);
    // A reel at the influencer is a post at the influencer in the agreement too.
    const none = buildQuoteModel({ ...sel('social', inf), docType: 'agreement' }, { name: 'x' });
    assert.notEqual(JSON.stringify(m.legal), JSON.stringify(none.legal));
  }
});

test('what the signed client gets: Natali\'s quantities, one more collab or story per reel or story', () => {
  const q = (id, paid = []) => packageDeliverables({ package: { id }, selection: { paid, free: {} } });
  for (const inf of NEW) {
    for (const tier of ['podcast', 'social', 'social-tv']) assert.deepEqual(q(`${tier}-${inf}`), q(`${tier}-natali`));
    assert.deepEqual(q(`social-tv-${inf}`, [`${inf}-reel`, `${inf}-story`]), { videos: 36, graphics: 36, shoot_days: 1, collabs: 1, stories: 1, ch14: 1, monthly: 0 });
    assert.equal(shootTypeOf(`social-${inf}`), inf);
  }
  assert.equal(packageName('social-hatzel'), 'Social all in one · הצל (יואב אליאסי)');
});

/* ── The shoot day ──────────────────────────── */

test('the shoot types: Natali, Niro and "הצל" are star days; Denis, Michel and Semion are not', () => {
  assert.deepEqual(STAR_TYPES, ['natali', 'niro', 'hatzel']);
  assert.deepEqual(Object.keys(SHOOT_TYPES), ['natali', 'niro', 'hatzel', 'dms']);
  assert.deepEqual(['natali', 'niro', 'hatzel', 'dms', null, '', 'x'].map(isStarDay), [true, true, true, false, false, false, false]);
  assert.deepEqual(['natali', 'niro', 'hatzel', 'dms', null].map(starShort), ['נטלי', 'נירו', 'הצל', '', '']);
  assert.equal(starWords('ניהול יום צילום עם נטלי דדון, המאפרת בבית של נטלי', 'hatzel'), 'ניהול יום צילום עם הצל (יואב אליאסי), המאפרת בבית של הצל');
  assert.equal(starWords('של נטלי', 'natali'), 'של נטלי');
  assert.equal(starWords('של נטלי', 'dms'), 'של נטלי');
  const p20 = PROCESSES.find((p) => p.id === 'p20');
  assert.equal(starProcess(p20, 'natali'), p20);
  assert.equal(starProcess(p20, 'dms'), p20);
  assert.equal(starProcess(p20, 'niro').title, 'ניהול יום צילום עם נירו לוי');
  assert.deepEqual(CREW_GROUPS[0].options, [['natali', 'נטלי דדון'], ['niro', 'נירו לוי'], ['hatzel', 'הצל (יואב אליאסי)'], ['dms', 'דניס, מישל וסמיון']]);
});

test('no protocol text puts a letter before Natali\'s name: "הצל" takes no prefix ("לנטלי" would be "להצל")', () => {
  const texts = [];
  const walk = (v) => {
    if (typeof v === 'string') texts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(PROCESSES);
  walk(DAY_BEFORE_LABELS);
  const bad = texts.filter((t) => /[לבמוכשה]נטלי/.test(t));
  assert.deepEqual(bad, []);
});

test('a client of Niro or "הצל" has Natali\'s processes, every word in the right name', () => {
  for (const inf of NEW) {
    const c = { id: 'c1', name: 'קפה', status: 'active', shoot_type: inf, shoot_at: IL(2026, 11, 20, 11).toISOString(), deal_at: IL(2026, 11, 1, 10).toISOString(), rounds: [{ n: 2, shoot_type: inf, shoot_at: IL(2026, 12, 20, 11).toISOString() }] };
    const procs = applicableProcesses(c);
    const ids = procs.map((p) => p.id);
    for (const id of ['p11b', 'p20', 'r2-p11b', 'r2-p20']) assert.ok(ids.includes(id), `${inf} ${id}`);
    assert.ok(!ids.includes('p21'));
    const p15 = procs.find((p) => p.id === 'p15').items.map((i) => i.key);
    assert.ok(p15.includes('p15.natali.makeup') && p15.includes('p15.natali.ride'));
    assert.equal(procs.find((p) => p.id === 'p20').due.hours, 3);
    const all = JSON.stringify(procs.map(({ title, sla, what, rule, ownerNote, items, guidance }) => ({ title, sla, what, rule, ownerNote, items: items.map((i) => i.label), guidance: guidance?.[inf] })));
    assert.ok(!all.includes('נטלי'), `${inf}: ${all.match(/[^"]{0,40}נטלי[^"]{0,40}/)?.[0]}`);
    assert.ok(all.includes(`מאפרת תואמה, מגיעה לבית של ${starShort(inf)} שעתיים לפני הצילום`));
    assert.ok(all.includes(`ניהול יום צילום עם ${INFLUENCERS[inf].name}`));
    assert.ok(procs.find((p) => p.id === 'p12').guidance[inf].startsWith(`יום עם ${starShort(inf)}:`));
  }
});

test('Nirel: preselected, sees the client, the calendar and the landing; three hours in the calendar', () => {
  for (const inf of NEW) {
    assert.equal(preselected(inf), 'nirel');
    assert.equal(preselected(inf, true), null);
    assert.ok(reasonHint({ shootType: inf }).startsWith(`בצילום של ${starShort(inf)} ניראל`));
    const c = { id: 'c1', status: 'active', shoot_type: inf, rounds: [] };
    assert.equal(visibleTo('nirel', c), true);
    assert.equal(canTake('nirel', c), true);
    assert.equal(shootMinutes(inf), shootMinutes('natali'));
    const load = Object.fromEntries(['nadia', 'yariv', 'anna', 'nirel'].map((e) => [e, { jobs: [] }]));
    const s = suggestAssignment({ client: c, shootType: inf, load });
    assert.equal(s.editor, 'nirel');
    assert.equal(s.reason, `צילום של ${starShort(inf)}: ניראל מסומנת מראש`);
  }
  assert.equal(visibleTo('nirel', { id: 'c2', status: 'active', shoot_type: 'dms', rounds: [] }), false);
  assert.equal(preselected('dms'), null);
});

test('the shoot-day screens and texts name the day\'s influencer', () => {
  const c = { id: 'c1', name: 'קפה', status: 'active', shoot_type: 'niro', shoot_at: IL(2026, 11, 20, 11).toISOString(), rounds: [] };
  const coord = coordinatorOf(c, {}, shootContexts(c)[0]);
  assert.equal(coord.star, 'נירו');
  assert.deepEqual(coord.natali.map((a) => a.label), ['המאפרת, בבית של נירו שעתיים לפני', 'ההסעה של נירו, הלוך וחזור']);
  const sc = shootCases(c)[0];
  assert.equal(sc.natali, true);
  const makeup = timeline(sc).find((t) => t.key === 'makeup');
  assert.equal(makeup.label, 'המאפרת בבית של נירו');
  assert.ok(timeline(sc).some((t) => t.key === 'hourLeft'));
  assert.equal(crewText('hatzel'), crewText('natali').replace('נטלי דדון', 'הצל (יואב אליאסי)'));
  assert.ok(!dayBeforeText(JSON.stringify({ ok: [], failed: ['natali'] }), 'hatzel').includes('נטלי'));
  assert.ok(dayBeforeText(JSON.stringify({ ok: [], failed: ['natali'] }), 'natali').includes('של נטלי'));
});

test('the reminders: 11ב and the three-hour day for Niro, in his name', () => {
  const staff = [{ email: 'owner@x', person: null }, ...['irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli'].map((p) => ({ email: `${p}@x`, person: p }))];
  const w = { clients: [], checks: {}, tasks: [], access: [], reviews: [], statusNotes: [], messages: [], subscriptions: [], staff };
  const c = { id: 'c1', name: 'קפה', status: 'active', shoot_type: 'niro', characterizer: 'ofir', has_logo: true, rounds: [], contract_end: '2027-12-31',
    deal_at: IL(2026, 9, 1, 10).toISOString(), created_by_email: 'irit@x', shoot_at: IL(2026, 10, 15, 11).toISOString() };
  w.clients.push(c);
  const checks = (w.checks.c1 = {});
  for (const k of importKeys('content')) checks[k] = { client_id: 'c1', item_key: k, state: 'done', note: 'ייבוא', at: IL(2026, 9, 1, 9).toISOString(), by_email: 'x@x' };
  const p11b = PROCESSES.find((p) => p.id === 'p11b').items.map((i) => i.key);
  for (const k of p11b) delete checks[k];
  for (const k of PROCESSES.find((p) => p.id === 'p11').items.filter((i) => !i.optional).map((i) => i.key)) checks[k] = { client_id: 'c1', item_key: k, state: 'done', at: IL(2026, 10, 11, 10).toISOString(), by_email: 'x@x' };
  const quiet = computeReminders({ ...w, now: IL(2026, 10, 11, 10), log: [] }).filter((r) => r.rule === 'natali');
  assert.equal(quiet.length, 1);
  assert.match(`${quiet[0].title} ${quiet[0].body}`, /של נירו/);
  const red = computeReminders({ ...w, now: IL(2026, 10, 12, 10), log: [] }).filter((r) => r.rule === 'natali');
  assert.ok(red.length >= 3);
  for (const r of [...quiet, ...red]) assert.ok(!`${r.title} ${r.body}`.includes('נטלי'), r.title);
});

test('the forms: every shoot type is offered where the shoot type is chosen by hand', () => {
  for (const page of ['client.html', 'clients.html']) {
    const html = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
    for (const t of Object.values(SHOOT_TYPES)) assert.ok(html.includes(`<option value="${t.key}">${t.name}</option>`), `${page} ${t.key}`);
  }
});

test('the payouts keep their two families until the owner sets the new ones\' rates', () => {
  assert.deepEqual(PAYOUT_FAMILIES, ['natali', 'simeon']);
  assert.deepEqual(payoutInfluencers().map((i) => i.id), ['natali', 'simeon']);
  const sql = readFileSync(new URL('../supabase/migrations/20260927140000_payouts.sql', import.meta.url), 'utf8');
  assert.match(sql, /family in \('simeon', 'natali'\)/);
});
