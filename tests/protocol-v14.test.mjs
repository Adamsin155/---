// Protocol version 14 (the owner's decision of 10.11.2026, the editors' "סדר בסימונים"; docs/ops.md,
// section 126): what Nadia, Yariv, Anna and Nirel marked "מיותר" left, for every client; the editing
// starts at the assignment (no "התקבל הכונן"); the hand-off to Ofir still goes by itself with what is left.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROCESSES, PROTOCOL_VERSION, CRITICAL_MISTAKES } from '../app/protocol.js';
import { applicableProcesses, clientState, openItemsFor } from '../app/protocol-logic.js';
import { PROTOCOL_HISTORY } from '../app/protocol-versions.js';
import { editingCases, editorState, START_CHECKS, selfCheck, readyKeys, CHECK_OF } from '../app/production.js';
import { editorReadyKeys, NOTIFY } from '../app/editor-auto.js';
import { editorStarted } from '../app/card-assign-logic.js';
import { handoffsFor } from '../app/handoffs.js';
import { monthlyMarks } from '../app/monthly-rounds.js';
import { computeReminders } from '../app/reminder-engine.js';
import { dateIL } from '../app/tz.js';

const IL = (y, m, d, h = 0, mi = 0) => dateIL(y, m, d, h, mi);
const RETIRED = PROTOCOL_HISTORY.find((v) => v.version === 14).retired;
// The owner's list, line by line, and the key each line is.
const MAPPING = [
  ['התקבל הכונן; עודכן שהעריכה התחילה', 'p22.received'],
  ['יש לוגו תקין של העסק', 'p22.check.logo'],
  ['יש מספר טלפון תקין של העסק', 'p22.check.phone'],
  ['כל הסרטונים נערכו לפי התסריטים', 'p22.edited'],
  ['בדיקה עצמית: אותה תבנית B-Roll לא חוזרת ביותר מ־3 סרטונים', 'p22.self.broll'],
  ['בדיקה עצמית: סגיר נקי — לוגו, "לפרטים נוספים התקשרו" ומספר הטלפון, בלי תוספות', 'p22.self.closing'],
  ['בדיקה עצמית: כל כמות הסרטונים הושלמה ותואמת לתסריטים', 'p22.self.complete'],
  ['בדיקה עצמית: אין רעידות מצלמה (Warp Stabilizer, לרוב בבי־רולים)', 'p22.self.stable'],
  ['בדיקה עצמית: נעשה שימוש בכל זוויות המצלמה שצולמו, לא רק בזווית אחת', 'p22.self.angles'],
  ['בדיקה עצמית: הסרטונים יצאו רק בהגדרות שהוגדרו מראש, בלי בעיית פיקסלים', 'p22.self.export'],
  ['התוכן הועלה ל־Dropbox (לפי הצורך)', 'p24.dropbox'],
];
const base = {
  id: 'c1', name: 'דנה', business: 'קפה דנה', status: 'active', shoot_type: 'dms', characterizer: 'ofir', has_logo: true,
  deal_at: IL(2026, 10, 1, 10).toISOString(), char_at: IL(2026, 10, 3, 10).toISOString(), shoot_at: IL(2026, 11, 3, 10).toISOString(),
  contract_end: '2027-10-01', editor: 'nadia', rounds: [],
};
const done = (at, note = null, by = 'nadia@x') => ({ state: 'done', at: at.toISOString(), note, by_email: by });

test('version 14: each line of the owner\'s list is one item, retired: 14, and applies to no client (rounds, any version)', () => {
  assert.equal(PROTOCOL_VERSION, 14);
  const items = new Map(PROCESSES.flatMap((p) => p.items.map((i) => [i.key, i])));
  assert.deepEqual(MAPPING.map(([, k]) => k).sort(), RETIRED.filter((k) => /^p2[24]\./.test(k)).sort()); // the editors' list
  for (const [label, key] of MAPPING) {
    assert.ok(items.has(key), key);
    assert.equal(items.get(key).retired, 14, key);
    assert.equal(items.get(key).label, label, key); // the owner's words, exactly
  }
  for (const v of [14, 13, 10, 5, 1]) {
    const c = { ...base, protocol_version: v, rounds: [{ n: 2, shoot_at: IL(2026, 11, 20, 10).toISOString(), editor: 'yariv' }] };
    const have = new Set(applicableProcesses(c).flatMap((p) => p.items.map((i) => i.key.replace(/^r\d+\./, ''))));
    for (const k of RETIRED) assert.ok(!have.has(k), `${k} still applies (v${v})`);
    for (const k of ['p22.check.footage', 'p22.check.scripts', 'p22.self.spelling', 'p22.self.sound', 'p22.self.exposure', 'p24.folder', 'p24.drive', 'p24.notify']) assert.ok(have.has(k), `${k} kept (v${v})`);
  }
  // Ofir's quality control (25) still checks all five critical mistakes.
  for (const [k] of CRITICAL_MISTAKES) assert.ok(items.get(`p25.q.${k}`) && !items.get(`p25.q.${k}`).retired, `p25.q.${k}`);
});

test('the editor\'s page writes nothing retired: the material checks and "מוכן לבדיקה"', () => {
  const written = [...START_CHECKS.map(([k]) => k), ...selfCheck(true).map(([k]) => k), ...readyKeys(true), ...Object.values(CHECK_OF), 'p24.folder'];
  for (const k of written) assert.ok(!RETIRED.includes(k), k);
  // The monthly round starts at its assignment: no "התקבל הכונן" written.
  assert.ok(!monthlyMarks(3).some((m) => m.item_key === 'r3.p22.received'));
});

test('the editing starts at the assignment: "בעריכה" at once, for a client of any version', () => {
  const now = IL(2026, 11, 4, 12);
  for (const v of [14, 13, 9]) {
    const c = { ...base, protocol_version: v };
    const cs = { 'p22a.assigned': done(IL(2026, 11, 4, 10), null, 'ofir@x') };
    const [job] = editingCases(c, cs, 'nadia', clientState(c, cs, now));
    assert.equal(editorState(job, cs).key, 'editing', `v${v}`);
  }
});

test('"עוד לא התחלת" and "עריכה לא התחילה" ring nobody; the assignment ring stays', () => {
  const staff = [{ email: 'irit@x', person: 'irit' }, { email: 'ofir@x', person: 'ofir' }, { email: 'lior@x', person: 'lior' }, { email: 'nadia@x', person: 'nadia' }];
  const cs = { 'p22a.assigned': done(IL(2026, 11, 4, 10), null, 'ofir@x') };
  const w = { clients: [base], checks: { c1: cs }, tasks: [], access: [], reviews: [], statusNotes: [], messages: [], subscriptions: [], staff };
  const at = (now) => computeReminders({ ...w, now, log: [] }).filter((r) => r.rule === 'editing');
  assert.ok(at(IL(2026, 11, 4, 10)).some((r) => r.step === 'assigned' && r.person === 'nadia'));
  for (const now of [IL(2026, 11, 4, 12, 30), IL(2026, 11, 4, 15), IL(2026, 11, 5, 11)]) {
    assert.deepEqual(at(now).filter((r) => /^nostart|^ofir$/.test(r.step)), [], String(now));
  }
});

test('the hand-off to Ofir: the five of 22, the folder and the Drive → p24.notify; the Drive is "editing done"', () => {
  const now = IL(2026, 11, 9, 12);
  const at = IL(2026, 11, 9, 10);
  const cs = { 'p22a.assigned': done(IL(2026, 11, 4, 10), null, 'ofir@x') };
  for (const k of ['p22.check.footage', 'p22.check.scripts', 'p22.self.spelling', 'p22.self.sound', 'p22.self.exposure', 'p24.folder']) cs[k] = done(at);
  const keys = (c, x) => editorReadyKeys(c, x, clientState(c, x, now));
  assert.deepEqual(keys(base, cs), [], 'the videos are not in the Drive yet');
  cs['p24.drive'] = done(at, 'https://drive.google.com/drive/folders/x');
  assert.deepEqual(keys(base, cs), [NOTIFY]);
  assert.deepEqual(keys({ ...base, links: { dropbox: 'https://www.dropbox.com/x' } }, cs), [NOTIFY], 'Dropbox is not asked');
});

test('the WhatsApp hand-off to the editor and "already started" read the editor\'s first marks', () => {
  const now = IL(2026, 11, 4, 11);
  const cs = { 'p22a.assigned': done(IL(2026, 11, 4, 10), null, 'ofir@x') };
  const offered = (x) => handoffsFor(base, x, 'p22a.assigned', { now }).filter((o) => o.markKey === 'p22a.handoff.editor').length;
  assert.equal(offered(cs), 1);
  assert.equal(editorStarted(cs), false);
  for (const k of ['p22.check.footage', 'p22.check.scripts', 'p22.received']) {
    const x = { ...cs, [k]: done(IL(2026, 11, 4, 10, 30)) };
    assert.equal(offered(x), 0, k);
    assert.equal(editorStarted(x), true, k);
  }
  assert.equal(editorStarted({ ...cs, 'p24.folder': done(IL(2026, 11, 4, 10, 30)) }), true);
  assert.equal(editorStarted({ ...cs, 'r2.p22.check.footage': done(IL(2026, 11, 4, 10, 30)) }), false, 'another shoot');
  assert.equal(editorStarted({ ...cs, 'r2.p22.check.footage': done(IL(2026, 11, 4, 10, 30)) }, 'r2.'), true);
});

// The characterizer's one mark per process (the owner, 10.11.2026; Ofir marked "לאחד"): old key → new key.
const MERGED = {
  'p05.got': ['p05.access', 'p05.allnets', 'p05.logo', 'p05.colors', 'p05.photos', 'p05.videos', 'p05.menu'],
  'p06.ok': ['p06.verified', 'p06.newpages', 'p06.name', 'p06.bio', 'p06.details', 'p06.phone', 'p06.address', 'p06.look', 'p06.metricool'],
  'p08.ok': ['p08.done', 'p08.saved', 'p08b.posted'],
};
const cz = { ...base, characterizer: 'noam', editor: null, char_at: IL(2026, 11, 2, 10).toISOString(), deal_at: IL(2026, 11, 1, 10).toISOString() };
const stOf = (c, cs, now) => clientState(c, cs, now);
const proc = (c, cs, now, id) => stOf(c, cs, now).states.find((s) => s.proc.id === id);

test('the characterizer: one item in 5, 6 and 8 (8ב left); 4 and the others of 5 unchanged', () => {
  const live = (id) => applicableProcesses({ ...cz, has_logo: false }).find((p) => p.id === id)?.items.map((i) => i.key);
  assert.deepEqual(live('p05'), ['p05.got', 'p05.newlogo']); // Ilai's new logo stays
  assert.deepEqual(live('p06'), ['p06.ok']);
  assert.deepEqual(live('p08'), ['p08.ok']);
  assert.equal(live('p08b'), undefined);
  assert.deepEqual(live('p04'), ['p04.address', 'p04.phone', 'p04.services', 'p04.audiences', 'p04.advantages', 'p04.goals', 'p04.offers', 'p04.content', 'p04.graphics', 'p04.campaigns', 'p04.special', 'p04.saved']);
  const items = new Map(PROCESSES.flatMap((p) => p.items.map((i) => [i.key, i])));
  assert.deepEqual([items.get('p05.got').label, items.get('p06.ok').label, items.get('p08.ok').label], ['התקבלו הגישות והחומרים', 'הגישות נבדקו, הרשתות סודרו וחוברו ל־Metricool', 'ה־Highlights הוכנו והועלו לרשתות']);
  for (const [k, old] of Object.entries(MERGED)) for (const o of old) assert.ok(RETIRED.includes(o) || (o === 'p08b.posted' && RETIRED.includes('p08b')), `${o} → ${k}`);
});

test('old marks: all of them done → the process is done; one missing → the one mark is asked; the one mark alone → done', () => {
  const now = IL(2026, 11, 3, 12);
  const at = IL(2026, 11, 2, 12);
  const d = (k) => [k, done(at, null, 'noam@x')];
  for (const [k, old] of Object.entries(MERGED)) {
    const pid = k.slice(0, 3);
    const base0 = { 'p04.ended': done(IL(2026, 11, 2, 11)), ...(pid === 'p06' ? { 'p05.access': done(at) } : {}) };
    const required = old.filter((o) => !['p05.menu', 'p06.newpages'].includes(o));
    const all = { ...base0, ...Object.fromEntries(required.map(d)) };
    assert.equal(proc(cz, all, now, pid).complete, true, `${k}: all old marks`);
    const less = { ...all };
    delete less[required[required.length - 1]];
    assert.equal(proc(cz, less, now, pid).complete, false, `${k}: one old mark missing`);
    assert.ok(openItemsFor('ofir', cz, less, stOf(cz, less, now), now).some((o) => o.item.key === k), `${k} asked of the characterizer`);
    assert.equal(proc(cz, { ...base0, [k]: done(at, null, 'noam@x') }, now, pid).complete, true, `${k}: the one mark`);
  }
  // A client of version 7 imported without "אין עוד" (p05.allnets came in version 8): not reopened.
  const v7 = { ...cz, protocol_version: 7 };
  const imp = Object.fromEntries(['p05.access', 'p05.logo', 'p05.colors', 'p05.photos', 'p05.videos'].map((k) => [k, { state: 'done', at: at.toISOString(), note: 'ייבוא' }]));
  assert.equal(proc(v7, { 'p04.ended': done(IL(2026, 11, 2, 11)), ...imp }, now, 'p05').complete, true);
  // 6 starts from the access (the vault, the client's form) or from 5's one mark, whichever first.
  assert.equal(+proc(cz, { 'p04.ended': done(IL(2026, 11, 2, 11)), 'p05.got': done(IL(2026, 11, 2, 12, 15)) }, now, 'p06').startAt, +IL(2026, 11, 2, 12, 15));
});

test('the hand-off of 5 and the reminders of 6 follow the one marks; nothing of 8ב rings', () => {
  const at = IL(2026, 11, 2, 12);
  const cs = { 'p04.ended': done(IL(2026, 11, 2, 11)), 'p05.got': done(at, null, 'irit@x') };
  assert.deepEqual(handoffsFor(cz, cs, 'p05.got', { now: IL(2026, 11, 2, 12, 1), from: 'irit' }).map((o) => [o.person, o.markKey]), [['ofir', 'p05.handoff.ofir']]); // Noam left on 10.11.2026: her old client is Ofir's
  const staff = [{ email: 'irit@x', person: 'irit' }, { email: 'ofir@x', person: 'ofir' }, { email: 'lior@x', person: 'lior' }, { email: 'noam@x', person: 'noam' }];
  const w = (checks) => ({ clients: [cz], checks: { c1: checks }, tasks: [], access: [], reviews: [], statusNotes: [], messages: [], subscriptions: [], staff });
  const rings = (checks, now) => computeReminders({ ...w(checks), now, log: [] }).filter((r) => r.rule === 'access').map((r) => `${r.step}@${r.person}`);
  assert.deepEqual(rings(cs, at), ['now@ofir']);
  assert.deepEqual(rings({ ...cs, 'p06.ok': done(IL(2026, 11, 2, 12, 10), null, 'noam@x') }, IL(2026, 11, 2, 12, 30)), [], '6 done: nothing more');
  const all = computeReminders({ ...w({ ...cs, 'p08.done': done(at), 'p08.saved': done(at) }), now: IL(2026, 11, 2, 13), log: [] });
  assert.deepEqual(all.filter((r) => r.rule === 'highlightsUpload'), []);
});
