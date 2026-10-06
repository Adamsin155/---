// Opening a client: stations, the shoot type and quantities from the package, and importing mid-way.
process.env.TZ = 'Asia/Jerusalem';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROCESSES, PHASES, STATIONS } from '../app/protocol.js';
import { PACKAGES, SPECS } from '../app/catalog.js';
import { clientState } from '../app/protocol-logic.js';
import { IMPORT_NOTE, PACKAGE_OPTIONS, packageName, shootTypeOf, dealDeliverables, importKeys, isImportedClient, openedBySigning } from '../app/client-open.js';

test('the 8 stations cover every process once, in protocol order', () => {
  assert.deepEqual(STATIONS.map((s) => s.title), ['הצטרפות', 'אפיון', 'תוכן ואישור', 'יום צילום', 'עריכה ובקרה', 'פרסום', 'שוטף', 'חידוש']);
  assert.deepEqual(STATIONS.flatMap((s) => s.procs), PROCESSES.map((p) => p.id));
  // Stations never go back in the protocol's phases.
  const phaseAt = (id) => PHASES.findIndex((ph) => ph.key === PROCESSES.find((p) => p.id === id).phase);
  const order = STATIONS.flatMap((s) => s.procs).map(phaseAt);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.deepEqual(STATIONS.find((s) => s.key === 'post').procs.map((id) => PROCESSES.find((p) => p.id === id).phase), Array(8).fill('post'));
  // v6 (3.10.2026): the shoot day is set in the first station, right after the group.
  assert.deepEqual(STATIONS[0].procs, ['p01', 'p02', 'p03', 'p11', 'p11b']);
});

test('the shoot type comes from the package in the catalog', () => {
  for (const [id, p] of Object.entries(PACKAGES)) assert.equal(shootTypeOf(id), p.influencer === 'natali' ? 'natali' : 'dms', id);
  assert.equal(shootTypeOf(''), null);
  assert.equal(shootTypeOf('old-package'), null);
});

test('packages are shown by name, as the signing trigger writes them', () => {
  assert.equal(packageName('social-natali'), 'Social all in one · נטלי דדון');
  assert.equal(packageName('social-tv-simeon'), 'Social + TV all in one · סמיון, מישל ודניס');
  assert.equal(packageName('nope'), null);
  assert.equal(PACKAGE_OPTIONS.length, Object.keys(PACKAGES).length);
});

test('quantities follow the package, with the agreement add-ons when there are any', () => {
  const d = dealDeliverables('social-natali');
  assert.equal(d.videos, SPECS['social-natali'].videos);
  assert.equal(d.graphics, 35);
  assert.equal(d.shoot_days, 1);
  const withAddons = dealDeliverables('social-simeon', { paid: ['simeon-day', 'photographer'], free: { graphics: 4 } });
  assert.equal(withAddons.graphics, 39);
  assert.equal(withAddons.shoot_days, 2);
  assert.equal(withAddons.monthly, 96);
  assert.deepEqual(dealDeliverables(''), {});
});

test('import marks every item before the station, and nothing from it on', () => {
  const client = {
    id: 'c', status: 'active', shoot_type: 'natali', characterizer: 'ofir', has_logo: true,
    deal_at: '2026-08-02T10:00:00+03:00', char_at: '2026-08-04T10:00:00+03:00', shoot_at: '2026-08-20T10:00:00+03:00',
  };
  assert.deepEqual(importKeys('join'), []);
  assert.deepEqual(importKeys('unknown'), []);
  const keys = importKeys('post');
  const before = new Set(STATIONS.slice(0, 4).flatMap((s) => s.procs));
  assert.ok(keys.length > 100);
  assert.equal(new Set(keys).size, keys.length);
  for (const k of keys) assert.ok(before.has(k.split('.')[0]), k);
  for (const k of ['p01.signed', 'p05.menu', 'p11b.makeup', 'p15.natali.ride', 'p20.focus', 'p19b.handed']) assert.ok(keys.includes(k), k);
  // Items that do not apply yet are marked too: the other shoot day, a new logo.
  for (const k of ['p21.fun', 'p05.newlogo']) assert.ok(keys.includes(k), k);
  for (const k of ['p22a.assigned', 'p23.made']) assert.ok(!keys.includes(k), k); // from the station on

  const now = new Date('2026-09-29T12:00:00+03:00');
  const checks = Object.fromEntries(keys.map((k) => [k, { state: 'done', note: IMPORT_NOTE, at: now.toISOString() }]));
  const s = clientState(client, checks, now);
  for (const x of s.states.filter((st) => before.has(st.proc.id))) assert.equal(x.status, 'done', x.proc.id);
  assert.equal(s.current, 'post');
});

test('details filled on the card after an import do not reopen anything before the station', () => {
  // Imported at "עריכה ובקרה" without knowing about the logo; the shoot type is corrected later.
  const imported = {
    id: 'c', status: 'active', shoot_type: 'natali', characterizer: 'ofir', has_logo: null,
    deal_at: '2026-08-02T10:00:00+03:00', char_at: '2026-08-04T10:00:00+03:00', shoot_at: '2026-08-20T10:00:00+03:00',
  };
  const at = new Date('2026-09-29T12:00:00+03:00');
  const checks = Object.fromEntries(importKeys('post').map((k) => [k, { state: 'done', note: IMPORT_NOTE, at: at.toISOString() }]));
  const before = new Set(STATIONS.slice(0, 4).flatMap((s) => s.procs));
  for (const later of [
    { has_logo: false },
    { shoot_type: 'dms' },
    { has_logo: false, shoot_type: 'dms', characterizer: 'lior' },
  ]) {
    for (const now of [at, new Date('2026-10-05T12:00:00+03:00')]) {
      const s = clientState({ ...imported, ...later }, checks, now);
      const open = s.states.filter((x) => before.has(x.proc.id) && x.status !== 'done').map((x) => `${x.proc.id}:${x.status}`);
      assert.deepEqual(open, [], JSON.stringify(later));
      assert.equal(s.current, 'post', JSON.stringify(later));
    }
  }
});

test('the weekly call keeps its own rhythm: an import never marks it', () => {
  const keys = importKeys('renewal');
  assert.ok(!keys.some((k) => k.startsWith('p31.')));
  assert.ok(keys.includes('p30.live'));
  assert.ok(!keys.some((k) => k.startsWith('p34.') || k.startsWith('p35.')));
});

test('process wording names no fixed quantity: it follows the package', () => {
  for (const p of PROCESSES) {
    for (const text of [p.title, p.what, p.sla, ...p.items.map((i) => i.label)]) {
      assert.doesNotMatch(String(text || ''), /\b36\b|עוד 27/, `${p.id}: ${text}`);
    }
  }
  assert.match(PROCESSES.find((p) => p.id === 'p12').items.find((i) => i.key === 'p12.scripts').label, /לפי החבילה/);
  assert.match(PROCESSES.find((p) => p.id === 'p23').items.find((i) => i.key === 'p23.made').label, /לפי החבילה/);
});

test('import before the shoot day without a shoot date: setting the shoot day stays open', () => {
  for (const st of ['char', 'content', 'shoot']) {
    const keys = importKeys(st, { shootSet: false });
    assert.ok(!keys.some((k) => /^p11b?./.test(k)), st);
    assert.ok(importKeys(st).some((k) => k.startsWith('p11.')), st);
    assert.ok(keys.some((k) => k.startsWith('p02.')), st);
  }
  // After the shoot took place there is nothing left to set.
  assert.ok(importKeys('post', { shootSet: false }).some((k) => k.startsWith('p11.')));
});

// Found live (6.10.2026): 39 imported clients (written by the system itself, their
// history marked "ייבוא") filled Irit's list with "לקוח חדש נפתח אוטומטית … ועוד 38".
test('an imported client is never "new, opened by itself": only one the signing trigger opened from an agreement', () => {
  const signed = { created_by_email: 'system', quote_id: 'q-1' };
  assert.equal(openedBySigning(signed, {}), true);
  assert.equal(openedBySigning(signed, undefined), true);
  // A batch import: the system wrote it, there is no agreement.
  assert.equal(openedBySigning({ created_by_email: 'system', quote_id: null }, {}), false);
  // Its history carries the import note, whatever else it has.
  const imported = Object.fromEntries(importKeys('char').map((k) => [k, { state: 'done', note: IMPORT_NOTE }]));
  assert.equal(isImportedClient(imported), true);
  assert.equal(openedBySigning({ created_by_email: 'system', quote_id: null }, imported), false);
  assert.equal(openedBySigning(signed, imported), false);
  // A check with another note, or none, is not an import.
  assert.equal(isImportedClient({ 'p01.contract': { state: 'done', note: 'נחתם במערכת' }, 'p02.group': { state: 'done', note: null } }), false);
  assert.equal(isImportedClient(null), false);
  // Opened by a person: never "automatic".
  assert.equal(openedBySigning({ created_by_email: 'irit@astrateg.test', quote_id: 'q-1' }, {}), false);
  assert.equal(openedBySigning(null, {}), false);
});
