// Lior's four things (protocol v12; the owner's decision of 3.11.2026; docs/ops.md, section 92):
// app/lior-four.js (the campaign's details, the scripts' Google Docs link, the pre-shoot form) and how
// the protocol carries them (app/protocol.js), what left Lior, and how a client of any version reads it.
// `npm test` runs this under UTC, New York and Jerusalem.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROCESSES, PROTOCOL_VERSION, STATIONS, LINKS, isRetired } from '../app/protocol.js';
import { applicableProcesses, clientState, openItemsFor, bulkEligible } from '../app/protocol-logic.js';
import { formOf, guardOf } from '../app/mark-guards.js';
import { writerRows, mayWrite } from '../scripts/protocol-writers.mjs';
import {
  CAMPAIGN_KEY, PRESHOOT_KEY, SCRIPTS_KEY, SCRIPTS_DOC, campaignProblem, campaignNote, readCampaign, campaignWords,
  scriptsDocProblem, scriptsDocOf, scriptsKeysToClose, INFLUENCER_CHOICES, PHOTOGRAPHER_CHOICES, DEFAULT_PHOTOGRAPHER,
  preShootValues, preShootProblem, preShootPatch, preShootComplete, preShootWords, keyFor, roundOfKey,
} from '../app/lior-four.js';
import { crewOf, photographerOf } from '../app/protocol.js';
import { dateIL, inputValueIL } from '../app/tz.js';

const IL = (y, m, d, h = 0, mi = 0) => dateIL(y, m, d, h, mi);
const done = (at, note = null) => ({ state: 'done', at: at.toISOString(), note, by_email: 'lior@x' });
const base = (o = {}) => ({
  id: 'c1', name: 'דנה', business: 'קפה דנה', status: 'active', characterizer: 'noam', has_logo: true, rounds: [], links: {},
  deal_at: IL(2026, 11, 1, 9).toISOString(), char_at: IL(2026, 11, 2, 10).toISOString(), contract_end: '2027-11-01', ...o,
});
const byId = (c) => new Map(applicableProcesses(c).map((p) => [p.id, p]));

test('the protocol: version 12, Lior\'s four things and nothing else of his but 34 and 35', () => {
  assert.equal(PROTOCOL_VERSION, 14); // 14 since 10.11.2026 (the editors' marks, docs/ops.md section 123); v13 (9.11.2026) left Lior's four things as they were
  const c = base({ shoot_type: 'natali', shoot_at: IL(2026, 11, 20, 11).toISOString(), status: 'ending' });
  const mine = [...byId(c).values()].filter((p) => p.items.some((i) => i.owners.includes('lior'))).map((p) => p.id);
  assert.deepEqual(mine.sort(), ['p12', 'p13', 'p30', 'p34', 'p35', 'p36']);
  const p = byId(c);
  assert.deepEqual(p.get('p30').items.map((i) => i.key), [CAMPAIGN_KEY]);
  assert.deepEqual(p.get('p12').items.map((i) => i.key), [SCRIPTS_KEY]);
  assert.deepEqual(p.get('p13').items.map((i) => i.key), ['p13.zoom']);
  assert.deepEqual(p.get('p36').items.map((i) => i.key), [PRESHOOT_KEY]);
  assert.equal(p.get('p36').num, '11ג');
  assert.deepEqual([formOf(CAMPAIGN_KEY), formOf(SCRIPTS_KEY), formOf(PRESHOOT_KEY), formOf('r2.p36.form'), formOf('p13.zoom')], ['campaign', 'scriptsDoc', 'preShoot', 'preShoot', null]);
  assert.equal(guardOf(SCRIPTS_KEY), null);
  // Irit's own processes did not change (11, 14); Eli's are there. (v13: the group and its intro, 2, left the protocol.)
  assert.equal(p.has('p02'), false);
  assert.ok(['p11', 'p14', 'p17b', 'p18b', 'p19b'].every((id) => p.has(id)));
  // The pre-shoot form sits in "תוכן ואישור", after the daily follow-up.
  assert.deepEqual(STATIONS.find((s) => s.key === 'content').procs, ['p12a', 'p12', 'p13', 'p14', 'p36']);
  // The database's item keys take no letter past ב (protocol_checks_item_key_check): 36, not 11ג.
  for (const pr of PROCESSES) for (const i of pr.items) assert.match(i.key, /^p[0-9]+[ab]?\.[a-z0-9.]+$/, i.key);
  // What left is marked so, and kept for the history's words.
  const retired = PROCESSES.filter(isRetired).map((x) => x.id);
  assert.deepEqual(retired, ['p02', 'p11b', 'p07a', 'p10', 'p12a', 'p15', 'p16', 'p17', 'p18', 'p19', 'p20', 'p21', 'p31']);
  // The link field: a Google Docs address, refused otherwise.
  assert.deepEqual(LINKS.find((l) => l.key === SCRIPTS_DOC), { key: SCRIPTS_DOC, label: 'קובץ התסריטים (Google Docs)', after: null, hint: 'docs.google.com', strict: true });
});

test('the campaign: a start date and a whole daily budget in shekels, kept on the item\'s note', () => {
  assert.deepEqual(campaignProblem({}), { field: 'start', text: 'חסר תאריך ההתחלה של הקמפיין.' });
  assert.equal(campaignProblem({ start: '2026-02-30', budget: '100' }).field, 'start');
  assert.equal(campaignProblem({ start: '2026-11-05', budget: '' }).field, 'budget');
  for (const b of ['0', '-5', '12.5', 'abc', '100001']) assert.equal(campaignProblem({ start: '2026-11-05', budget: b }).field, 'budget', b);
  assert.equal(campaignProblem({ start: '2026-11-05', budget: '1,500 ₪' }), null);
  assert.equal(campaignNote({ start: '2026-11-05', budget: ' 150 ' }), '{"start":"2026-11-05","budget":150}');
  assert.equal(campaignNote({ start: '', budget: '150' }), null);
  assert.deepEqual(readCampaign('{"start":"2026-11-05","budget":150}'), { start: '2026-11-05', budget: 150 });
  for (const n of [null, '', 'הקמפיין עלה', '{"start":"x","budget":1}', '{"start":"2026-11-05","budget":"150"}']) assert.equal(readCampaign(n), null, String(n));
  assert.equal(campaignWords({ start: '2026-11-05', budget: 1500 }), 'התחלה: 5.11.2026 · 1,500 ₪ ליום');
});

test('the scripts: one docs.google.com link; saving it closes the item of the client and of a round that began', () => {
  assert.equal(scriptsDocProblem('https://docs.google.com/document/d/1AbC/edit'), null);
  assert.match(scriptsDocProblem(''), /הדביקו/);
  assert.match(scriptsDocProblem('docs.google.com/document/d/1'), /https/);
  assert.match(scriptsDocProblem('http://docs.google.com/document/d/1'), /https/);
  assert.match(scriptsDocProblem('https://drive.google.com/file/d/1'), /Google Docs/);
  assert.match(scriptsDocProblem('https://docs.google.com.evil.test/x'), /Google Docs/);
  assert.match(scriptsDocProblem('https://docs.google.com/document/d/1?token=abc'), /סיסמאות/);
  const now = IL(2026, 11, 10, 10);
  const c = base({ links: { [SCRIPTS_DOC]: 'https://docs.google.com/document/d/1' }, rounds: [{ n: 2, start_at: IL(2026, 11, 5).toISOString() }, { n: 3, start_at: IL(2026, 12, 5).toISOString() }] });
  assert.equal(scriptsDocOf(c), 'https://docs.google.com/document/d/1');
  assert.deepEqual(scriptsKeysToClose(c, {}, now), ['p12.link', 'r2.p12.link']);
  assert.deepEqual(scriptsKeysToClose(c, { 'p12.link': done(now) }, now), ['r2.p12.link']);
  assert.deepEqual(scriptsKeysToClose(base(), {}, now), []);
  // In the protocol: the scripts are due as they were (business day 2), and the item is closed by the link.
  const s = clientState(base(), {}, IL(2026, 11, 3, 10));
  const p12 = s.states.find((x) => x.proc.id === 'p12');
  assert.equal(p12.complete, false);
  assert.equal(clientState(base(), { 'p12.link': done(IL(2026, 11, 3, 9)) }, IL(2026, 11, 3, 10)).states.find((x) => x.proc.id === 'p12').complete, true);
  // A client whose scripts were already on the scripts page before v12 is not asked (`passedIf`).
  const old = clientState(base(), { 'p12.docs': done(IL(2026, 11, 2, 15)) }, IL(2026, 11, 3, 10));
  assert.equal(old.states.find((x) => x.proc.id === 'p12').complete, true);
  // Never in "mark the whole process".
  assert.deepEqual(bulkEligible(p12, 'lior', base(), {}, IL(2026, 11, 3, 10)), []);
});

test('the pre-shoot form: date and time, address, influencers or the photographer; it writes the shoot\'s own fields', () => {
  assert.deepEqual(INFLUENCER_CHOICES.map(([k]) => k), ['natali', 'dms', 'niro', 'hatzel', 'arik']);
  assert.deepEqual(PHOTOGRAPHER_CHOICES, [['eli', 'אלי'], ['eliel', 'אליאל']]);
  assert.equal(DEFAULT_PHOTOGRAPHER, 'eli');
  const at = IL(2026, 11, 20, 11);
  const c = base({ address: 'הרצל 1, חיפה', deliverables: { videos: 8 } });
  // Empty: Eli by default, nothing else known.
  assert.deepEqual(preShootValues(base()), { at: '', address: '', photographer: 'eli', influencers: '', influencer: '' });
  assert.equal(preShootProblem(preShootValues(base())).field, 'at');
  const v = { at: inputValueIL(at), address: ' הרצל 1, חיפה ', influencers: 'yes', influencer: 'niro', photographer: 'eliel' };
  assert.equal(preShootProblem({ ...v, address: '' }).field, 'address');
  assert.equal(preShootProblem({ ...v, influencers: '' }).field, 'influencers');
  assert.equal(preShootProblem({ ...v, influencer: '' }).field, 'influencer');
  assert.equal(preShootProblem({ ...v, influencers: 'no', photographer: 'nadia' }).field, 'photographer');
  assert.equal(preShootProblem(v), null);
  // With influencers: the type, and no crew (a day with influencers is filmed by Eli).
  const withInf = preShootPatch(c, null, v);
  assert.deepEqual(withInf, { shoot_at: at.toISOString(), shoot_type: 'niro' });
  const c1 = { ...c, ...withInf };
  assert.equal(photographerOf(c1), 'eli');
  assert.equal(preShootComplete(c1), true);
  assert.deepEqual(preShootValues(c1), { at: inputValueIL(at), address: 'הרצל 1, חיפה', photographer: 'eli', influencers: 'yes', influencer: 'niro' });
  // Without: no type, the photographer kept with the package (its counts untouched).
  const solo = preShootPatch(c1, null, { ...v, influencers: 'no', photographer: 'eliel' });
  assert.deepEqual(solo, { shoot_at: at.toISOString(), shoot_type: null, deliverables: { videos: 8, shoot_crew: 'eliel' } });
  const c2 = { ...c1, ...solo };
  assert.equal(crewOf(c2), 'eliel');
  assert.deepEqual(preShootValues(c2).influencers, 'no');
  assert.match(preShootWords(c2), /^20\.11 11:00 · הרצל 1, חיפה · בלי משפיענים · אליאל$/);
  // Back to influencers: the crew is taken away.
  assert.deepEqual(preShootPatch(c2, null, v), { shoot_at: at.toISOString(), shoot_type: 'niro', deliverables: { videos: 8 } });
  // A new address is written; the same one is not.
  assert.deepEqual(preShootPatch(base(), null, v).address, 'הרצל 1, חיפה');
  // A round: its own entry, the others untouched.
  const r = base({ address: 'x', rounds: [{ n: 2, start_at: IL(2026, 11, 1).toISOString(), shoot_type: 'dms' }, { n: 3, shoot_type: null, shoot_crew: 'eli' }] });
  const rp = preShootPatch(r, 2, { ...v, address: 'x', influencers: 'no', photographer: 'eliel' });
  assert.deepEqual(rp, { rounds: [{ n: 2, start_at: r.rounds[0].start_at, shoot_at: at.toISOString(), shoot_type: null, shoot_crew: 'eliel' }, r.rounds[1]] });
  assert.equal(preShootComplete({ ...r, ...rp }, 2), true);
  assert.equal(preShootComplete({ ...r, ...rp }, 3), false);
  assert.deepEqual([keyFor(PRESHOOT_KEY, 2), keyFor(PRESHOOT_KEY, null), roundOfKey('r2.p36.form'), roundOfKey('p36.form')], ['r2.p36.form', 'p36.form', 2, null]);
});

test('the pre-shoot form in the protocol: Lior\'s after the meeting, no clock, history once an editor was assigned', () => {
  const c = base({ shoot_at: IL(2026, 11, 20, 11).toISOString() });
  const before = clientState(c, {}, IL(2026, 11, 2, 9));
  assert.equal(before.states.find((x) => x.proc.id === 'p36').ready, false);
  const after = clientState(c, { 'p04.ended': done(IL(2026, 11, 2, 11)) }, IL(2026, 11, 3, 10));
  const s = after.states.find((x) => x.proc.id === 'p36');
  assert.deepEqual([s.ready, s.dueAt, s.complete], [true, null, false]);
  assert.ok(openItemsFor('lior', c, { 'p04.ended': done(IL(2026, 11, 2, 11)) }, after, IL(2026, 11, 3, 10)).some((x) => x.item.key === PRESHOOT_KEY));
  // Never late, whenever it is looked at.
  assert.notEqual(clientState(c, {}, IL(2027, 1, 1)).states.find((x) => x.proc.id === 'p36').status, 'overdue');
  // An editor assigned before it existed: history, asked of nobody.
  const assigned = { 'p22a.assigned': done(IL(2026, 11, 21, 10)) };
  assert.equal(clientState(c, assigned, IL(2026, 11, 22)).states.find((x) => x.proc.id === 'p36').complete, true);
  // Only the office writes it (Lior, Irit, Ofir and the owner); the database's writers table has no row of its own.
  assert.ok(!writerRows().some((r) => r.key === PRESHOOT_KEY || r.key === SCRIPTS_KEY || r.key === CAMPAIGN_KEY));
  assert.deepEqual(['lior', 'irit', 'ofir', 'ilai', 'nadia', 'eli'].map((p) => mayWrite({ person: p, client: {}, key: PRESHOOT_KEY })), [true, true, true, false, false, false]);
});

test('current clients: what left Lior stops ringing and counting as late, for a client of any version, whatever it had open', () => {
  // A client that started under v8, with Lior's old work wide open and long late.
  const c = base({ protocol_version: 8, shoot_type: 'natali', shoot_at: IL(2026, 10, 20, 11).toISOString(), char_at: IL(2026, 10, 5, 10).toISOString() });
  const now = IL(2026, 11, 3, 10);
  const s = clientState(c, { 'p04.ended': done(IL(2026, 10, 5, 12)), 'p02.opened': done(IL(2026, 10, 1, 10)) }, now);
  const late = s.states.filter((x) => x.late || x.status === 'overdue').map((x) => x.proc.id);
  for (const id of ['p10', 'p11b', 'p12a', 'p15', 'p16', 'p17', 'p18', 'p19', 'p20', 'p31']) assert.ok(!late.includes(id) && !s.states.some((x) => x.proc.id === id), id);
  const lior = openItemsFor('lior', c, {}, s, now).map((x) => x.item.key);
  for (const k of lior) assert.match(k, /^(p12\.link|p13\.zoom|p30\.live|p36\.form|p3[45]\.)/, k);
});
