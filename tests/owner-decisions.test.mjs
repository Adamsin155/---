// The owner's decisions of 3.10.2026, rule by rule, at fixed Israel times (npm test
// runs this under UTC, New York and Jerusalem):
//   1–3  Stav's deals (app/deal-logic.js) and their reminders: Irit's 10-minute office
//        clock, again with Ofir, the seller told quietly when it is signed.
//   4    every late item to Ofir and Lior (quiet), 24 hours late in the owner's one
//        18:00 summary (lateSummary).
//   5    the shoot day right after the group (protocol v6, anchor 'group').
//   6    the automatic editor assignment when the shoot day is closed (app/auto-assign.js).
//   7    7ב / 23ב: approved graphics, Ilai's 30-minute ring.
//   8    the station-change message (app/messages-logic.js stationChange): Irit, quietly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeReminders, buildEnv, lateSummary, planDigests, planDelivery } from '../app/reminder-engine.js';
import { REMINDER_PEOPLE, LATE_GRACE_MINUTES } from '../app/reminder-rules.js';
import { clocksFor, ANSWER_CLOCKS } from '../app/clocks.js';
import { PROCESSES, PEOPLE, STAFF_PEOPLE, TEAM_PEOPLE, scopeOf, isSales, STATIONS } from '../app/protocol.js';
import { clientState, IMPORT_NOTE, isImmediate, IMMEDIATE_MINUTES, clientLabel } from '../app/protocol-logic.js';
import { paramsOf } from '../app/wa-templates.js';
import { importKeys } from '../app/client-open.js';
import { dateIL, partsIL } from '../app/tz.js';
import {
  validateDeal, dealSummary, prefillFromDeal, contractTitle, dealDue, statusText, DEAL_STATUS, addonsFor, pendingDeals, dealUrl, landingOf,
} from '../app/deal-logic.js';
import { planAutoAssign, autoReasonOf, AUTO_REASON, AUTO_DRIVE_NOTE } from '../app/auto-assign.js';
import { stationChange, stationChangeText, suggestFor, templatesByKey, messageText } from '../app/messages-logic.js';

const IL = (y, m, d, h = 0, mi = 0) => dateIL(y, m, d, h, mi);
const hhmm = (d) => { const p = partsIL(d); return `${p.day}.${p.month} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`; };
const STAFF = [
  { email: 'owner@x', person: null }, { email: 'irit@x', person: 'irit' }, { email: 'lior@x', person: 'lior' }, { email: 'ofir@x', person: 'ofir' },
  { email: 'ilai@x', person: 'ilai' }, { email: 'nirel@x', person: 'nirel' }, { email: 'nadia@x', person: 'nadia' }, { email: 'yariv@x', person: 'yariv' },
  { email: 'anna@x', person: 'anna' }, { email: 'eli@x', person: 'eli' }, { email: 'stav@x', person: 'stav' },
];
let seq = 0;
const world = () => ({ clients: [], checks: {}, tasks: [], access: [], reviews: [], statusNotes: [], messages: [], subscriptions: [], staff: STAFF, deals: [] });
function client(w, o = {}) {
  seq += 1;
  const c = {
    id: `c${seq}`, name: o.name || `לקוח ${seq}`, status: 'active', shoot_type: 'dms', characterizer: 'ofir', has_logo: true,
    rounds: [], contract_end: '2027-12-31', deal_at: IL(2026, 9, 1, 10).toISOString(), created_by_email: 'irit@x', ...o,
  };
  w.clients.push(c);
  return c;
}
const mark = (w, c, key, at, note = null) => { (w.checks[c.id] ||= {})[key] = { client_id: c.id, item_key: key, state: 'done', note, at: at.toISOString(), by_email: 'x@x' }; };
const marks = (w, c, keys, at, note = null) => keys.forEach((k) => mark(w, c, k, at, note));
const itemsOf = (id, pre = '') => PROCESSES.find((p) => p.id === id).items.filter((i) => !i.optional).map((i) => pre + i.key);
const importTo = (w, c, station, at = IL(2026, 9, 1, 9)) => marks(w, c, importKeys(station), at, IMPORT_NOTE);
const due = (w, now, log = []) => computeReminders({ ...w, now, log });
const pick = (list, rule, step, person = null) => list.filter((r) => r.rule === rule && r.step === step && (!person || r.person === person));
const one = (list, rule, step, person = null) => {
  const got = pick(list, rule, step, person);
  assert.equal(got.length, 1, `${rule}.${step}${person ? `@${person}` : ''}: ${JSON.stringify(list.filter((r) => r.rule === rule).map((r) => r.key))}`);
  return got[0];
};
const none = (list, rule, step = null) => assert.equal(list.filter((r) => r.rule === rule && (!step || r.step === step)).length, 0,
  `${rule}${step ? `.${step}` : ''} should not be due: ${JSON.stringify(list.filter((r) => r.rule === rule).map((r) => r.key))}`);
const DEAL_FORM = { business_name: '  פיצה   רון ', contact_name: 'רון כהן', phone: '050-7654321', tier: 'social', influencer: 'natali', paid: ['photographer', 'simeon-day'], free: { graphics: 6, simeonJoin: true }, discount: 150, notes: 'לחזור אחרי 17:00' };

// ── 1. Stav ───────────────────────────────
test('Stav: a sales person on the team, not in the protocol; reminders reach him', () => {
  assert.equal(PEOPLE.stav.name, 'סתיו');
  assert.equal(PEOPLE.stav.role, 'סוכן שטח');
  assert.equal(isSales('stav'), true);
  assert.equal(scopeOf('stav'), 'sales');
  assert.ok(!STAFF_PEOPLE().some((p) => p.key === 'stav'), 'no client protocol work for him');
  assert.ok(TEAM_PEOPLE().some((p) => p.key === 'stav'), 'on the team screen');
  assert.ok(REMINDER_PEOPLE.has('stav'));
  // His page, always (not only once per tab): app/office-ui.js and clients.js send him there.
  assert.equal(landingOf('stav'), 'deal.html');
  for (const p of ['irit', 'lior', 'nadia', null]) assert.equal(landingOf(p), null, String(p));
  // No process or item is his.
  assert.ok(!PROCESSES.some((p) => [p.owners, ...p.items.map((i) => i.owners)].flat().includes('stav')));
});

test('the deal form: cleaned, checked, the catalog\'s rules for add-ons; what Irit reads; the builder prefilled', () => {
  const v = validateDeal(DEAL_FORM);
  assert.equal(v.ok, true);
  assert.equal(v.row.business_name, 'פיצה רון');
  assert.equal(v.row.discount_agorot, 15000);
  // "Another day with Semyon" is not for a Natali package; Semyon joining Natali's day is.
  assert.deepEqual(v.row.paid, ['photographer']);
  assert.equal(v.row.free.simeonJoin, true);
  assert.equal(v.row.free.graphics, 6);
  const bad = validateDeal({ business_name: ' ', contact_name: '', phone: '12', tier: 'gold', influencer: 'x', discount: 250 });
  assert.equal(bad.ok, false);
  assert.deepEqual(Object.keys(bad.errors).sort(), ['business_name', 'contact_name', 'discount', 'influencer', 'phone', 'tier']);
  assert.equal(validateDeal({ ...DEAL_FORM, discount: 10.5 }).ok, false);
  assert.equal(validateDeal({ ...DEAL_FORM, phone: '03-1234567' }).ok, true, 'a landline is fine');
  // Add-ons offered by package.
  assert.deepEqual(addonsFor('social', 'simeon').paid.map((a) => a.id), ['photographer', 'simeon-day']);
  assert.deepEqual(addonsFor('social', 'natali').paid.map((a) => a.id), ['photographer', 'natali-reel', 'natali-story']);
  // In words.
  const d = { ...v.row, id: 'd1', created_at: IL(2026, 10, 5, 10).toISOString(), status: 'pending' };
  assert.equal(contractTitle(d), 'להכין חוזה ל־פיצה רון');
  assert.match(dealSummary(d), /^Social · נטלי דדון · תוספות: צלם חודשי, גרפיקות נוספות \(6\), צירוף סמיון ליום הצילום עם נטלי · הנחה 150 ₪ לחודש$/);
  assert.equal(dealUrl(d), 'index.html?deal=d1');
  // 6.10.2026: two more, between "waiting for a contract" and "sent" (an exceptional contract and its approval).
  assert.deepEqual(Object.values(DEAL_STATUS), ['ממתין לחוזה', 'ממתין לאישור מנהל', 'לא אושר', 'חוזה נשלח', 'נחתם', 'בוטל']);
  assert.equal(statusText({ status: 'sent' }), 'חוזה נשלח');
  // The builder: an agreement with the deal's selection and the client's details.
  const pre = prefillFromDeal(d);
  assert.equal(pre.selection.docType, 'agreement');
  assert.deepEqual([pre.selection.tier, pre.selection.influencer, pre.selection.paid, pre.selection.discount], ['social', 'natali', ['photographer'], 15000]);
  assert.equal(pre.selection.free.simeonJoin, true);
  assert.deepEqual(pre.client, { 'c-name': 'רון כהן', 'c-company': 'פיצה רון', 'c-phone': '050-7654321', 'c-notes': 'לחזור אחרי 17:00' });
  // Irit's list: the oldest first, only those waiting.
  assert.deepEqual(pendingDeals([{ id: 'b', status: 'pending', created_at: '2026-10-05T10:00:00Z' }, { id: 'a', status: 'pending', created_at: '2026-10-05T09:00:00Z' }, { id: 'c', status: 'sent', created_at: '2026-10-05T08:00:00Z' }]).map((x) => x.id), ['a', 'b']);
});

// ── 2. Irit's 10 minutes, in office hours ──
test('a new deal: Irit rings at once; after 10 office minutes Irit again and Ofir; the contract sent stops it', () => {
  const w = world();
  const d = { ...validateDeal(DEAL_FORM).row, id: 'd1', status: 'pending', created_by_email: 'stav@x', created_at: IL(2026, 10, 5, 10).toISOString() };
  w.deals.push(d);
  const now = one(due(w, IL(2026, 10, 5, 10)), 'dealNew', 'now', 'irit');
  assert.equal(now.level, 'ring');
  assert.equal(now.exempt, 'clock');
  assert.equal(now.title, 'להכין חוזה ל־פיצה רון');
  assert.match(now.body, /^מסתיו: Social · נטלי דדון/);
  assert.match(now.body, /יעד היום 10:10/);
  assert.equal(now.url, 'index.html?deal=d1');
  none(due(w, IL(2026, 10, 5, 10, 9)), 'dealNew', 'due');
  const at10 = due(w, IL(2026, 10, 5, 10, 10));
  assert.equal(one(at10, 'dealNew', 'due', 'irit').level, 'ring');
  const ofir = one(at10, 'dealNew', 'ofir', 'ofir');
  assert.equal(ofir.level, 'ring');
  assert.match(ofir.title, /חוזה לא נשלח 10 דקות: פיצה רון/);
  // The contract sent (a quote linked, or marked): nothing more.
  d.status = 'sent';
  none(due(w, IL(2026, 10, 5, 10, 10)), 'dealNew');
});

test('the 10 minutes count office time only: a deal at 17:55 is due at 09:05 the next business day; on erev chag at 13:00', () => {
  assert.equal(hhmm(dealDue({ created_at: IL(2026, 10, 5, 17, 55).toISOString() })), '6.10 09:05');
  // Thursday evening: Sunday morning.
  assert.equal(hhmm(dealDue({ created_at: IL(2026, 10, 8, 20).toISOString() })), '11.10 09:10');
  const w = world();
  w.deals.push({ ...validateDeal(DEAL_FORM).row, id: 'd2', status: 'pending', created_by_email: 'stav@x', created_at: IL(2026, 10, 5, 17, 55).toISOString() });
  none(due(w, IL(2026, 10, 5, 18, 30)), 'dealNew', 'due');
  one(due(w, IL(2026, 10, 6, 9, 5)), 'dealNew', 'ofir', 'ofir');
});

// ── 3. Signed: the seller hears, quietly ──
test('the deal signed: Stav hears quietly, "<עסק> חתם 🎉", once', () => {
  const w = world();
  w.deals.push({ ...validateDeal(DEAL_FORM).row, id: 'd3', status: 'signed', created_by_email: 'stav@x', created_at: IL(2026, 10, 5, 10).toISOString(), signed_at: IL(2026, 10, 5, 15).toISOString() });
  const r = one(due(w, IL(2026, 10, 5, 15)), 'dealSigned', 'seller', 'stav');
  assert.equal(r.level, 'quiet');
  assert.equal(r.title, 'פיצה רון חתם 🎉');
  assert.equal(planDelivery({ reminders: [r], now: IL(2026, 10, 5, 15) })[0].channel, 'app', 'no sound');
  none(due(w, IL(2026, 10, 5, 15), [r.key]), 'dealSigned');
});

// ── 4. Lateness ───────────────────────────
test('the owner\'s summary: everything 24 hours late or more, one section, by person; less than 24 hours is not in it', () => {
  const w = world();
  const c = client(w, { name: 'אלפא', char_at: IL(2026, 10, 5, 10).toISOString() });
  importTo(w, c, 'char');
  marks(w, c, itemsOf('p04'), IL(2026, 10, 5, 12)); // 7, 8, 10 due 14:00 on Monday 5.10
  w.tasks.push({ id: 't1', client_id: c.id, title: 'לשלוח חשבונית', owner: 'irit', due_on: '2026-10-01', created_at: IL(2026, 9, 30, 10).toISOString() });
  const at = (now) => lateSummary(buildEnv({ ...w, now }), now);
  // Monday 18:00: four hours late only; the task (due Thursday 1.10) is days late.
  assert.deepEqual(at(IL(2026, 10, 5, 18)), ['באיחור 24 שעות ומעלה (1):', 'עירית (1): אלפא: לשלוח חשבונית']);
  const tue = at(IL(2026, 10, 6, 18));
  // 5, 7, 8, 9 and 10 (the characterization's clocks of Monday) and the task: the most late person first, each oldest first.
  assert.deepEqual(tue, ['באיחור 24 שעות ומעלה (6):', 'אופיר (2): אלפא (5), אלפא (8)', 'עילאי (2): אלפא (9), אלפא (7)', 'עירית (1): אלפא: לשלוח חשבונית', 'ליאור (1): אלפא (10)']);
  // In the 18:00 digest, as one section; one digest, not a message per item.
  const env = buildEnv({ ...w, now: IL(2026, 10, 6, 18) });
  const d = planDigests({ env, now: IL(2026, 10, 6, 18), log: [], active: new Set() }).filter((x) => x.person === 'owner');
  assert.equal(d.length, 1);
  assert.ok(d[0].lines.includes('באיחור 24 שעות ומעלה (6):'), d[0].lines.join('\n'));
  assert.ok(!d[0].lines.includes('הכול לפי התוכנית.'));
  // Nothing late: "הכול לפי התוכנית".
  const empty = world();
  const e2 = buildEnv({ ...empty, now: IL(2026, 10, 6, 18) });
  assert.deepEqual(planDigests({ env: e2, now: IL(2026, 10, 6, 18), log: [], active: new Set() }).filter((x) => x.person === 'owner').map((x) => x.lines[0]), ['הכול לפי התוכנית.']);
});

// ── 5. The shoot day right after the group ──
test('the shoot day (v6): starts when the group is opened, due the end of the next business day; a v5 client keeps 3 days from the meeting', () => {
  const c = { id: 'x', name: 'x', status: 'active', shoot_type: 'dms', rounds: [], deal_at: IL(2026, 10, 4, 9).toISOString(), char_at: IL(2026, 10, 8, 10).toISOString() };
  const checks = { 'p02.opened': { state: 'done', at: IL(2026, 10, 4, 9, 5).toISOString() } };
  const s = clientState(c, checks, IL(2026, 10, 4, 10)).states.find((x) => x.proc.id === 'p11');
  assert.equal(hhmm(s.startAt), '4.10 09:05');
  assert.equal(hhmm(s.dueAt), '5.10 23:59');
  assert.equal(s.proc.phase, 'onboarding');
  assert.ok(STATIONS[0].procs.includes('p11'));
  // Before the group: no start, no deadline.
  assert.equal(clientState(c, {}, IL(2026, 10, 4, 10)).states.find((x) => x.proc.id === 'p11').dueAt, null);
  // A client that started under version 5: as before.
  const old = clientState({ ...c, protocol_version: 5 }, checks, IL(2026, 10, 4, 10)).states.find((x) => x.proc.id === 'p11');
  assert.equal(hhmm(old.dueAt), '13.10 23:59'); // Thursday 8.10 + 3 business days (Sunday, Monday, Tuesday)
  // A shoot round starts its own 11 when it was added.
  const r = { ...c, rounds: [{ n: 2, start_at: IL(2026, 11, 1, 10).toISOString(), shoot_type: 'dms' }] };
  assert.equal(hhmm(clientState(r, checks, IL(2026, 11, 1, 11)).states.find((x) => x.proc.id === 'r2-p11').dueAt), '2.11 23:59');
});

// ── 6. The editor, assigned when the shoot day is closed ──
function shotClient(w, o = {}) {
  const c = client(w, { shoot_at: IL(2026, 10, 18, 10).toISOString(), char_at: IL(2026, 10, 5, 10).toISOString(), ...o });
  importTo(w, c, 'shoot');
  for (const id of ['p17', 'p17b', 'p18', 'p18b', 'p19', 'p19b', 'p20', 'p21']) for (const k of itemsOf(id)) delete w.checks[c.id][k];
  return c;
}
const closeDay = (w, c, at = IL(2026, 10, 18, 17)) => marks(w, c, itemsOf('p19'), at);
const planOf = (w, now) => planAutoAssign({ clients: w.clients, stateOf: (c) => clientState(c, w.checks[c.id] || {}, now), checks: w.checks, tasks: w.tasks, now });

test('auto-assign: Natali → Nirel; otherwise the least loaded of Nadia, Yariv and Anna; only once the shoot day is closed for real', () => {
  const w = world();
  // Nadia holds two editing jobs, Yariv one, Anna none.
  for (const ed of ['nadia', 'nadia', 'yariv']) {
    const busy = client(w, { editor: ed, shoot_at: IL(2026, 10, 11, 10).toISOString() });
    importTo(w, busy, 'post');
    for (const k of itemsOf('p27')) delete w.checks[busy.id][k];
  }
  const dms = shotClient(w, { name: 'דמס' });
  const nat = shotClient(w, { name: 'נטלי', shoot_type: 'natali' });
  const now = IL(2026, 10, 18, 17, 1);
  assert.deepEqual(planOf(w, now), [], 'the day is not closed yet');
  closeDay(w, dms);
  closeDay(w, nat);
  const plan = planOf(w, now);
  assert.deepEqual(plan.map((a) => [a.client.name, a.editor]), [['דמס', 'anna'], ['נטלי', 'nirel']]);
  const a = plan[0];
  assert.deepEqual(a.patch, { editor: 'anna' });
  // Lior confirmed the drive is back when he closed the day (p19.took): 22א's own "the drive came back" closes with it.
  assert.deepEqual(a.checks.map((x) => x.key), ['p22a.drive', 'p22a.load', 'p22a.assigned', 'p22a.irit']);
  assert.equal(a.checks[0].note, AUTO_DRIVE_NOTE);
  assert.equal(a.reason.key, 'p22a.reason');
  assert.deepEqual(JSON.parse(a.reason.note), { editor: 'anna', reason: AUTO_REASON, preselected: null, joint: false, auto: true, kept: false });
  assert.deepEqual(a.task, { client_id: dms.id, title: 'פתיחת תיקייה מסודרת בדרייב לעריכה (24)', owner: 'ofir', due_on: '2026-10-19' });
  // Two in one tick spread the load: a second dms client goes to Yariv (Anna just got one).
  const dms2 = shotClient(w, { name: 'דמס 2' });
  closeDay(w, dms2);
  assert.deepEqual(planOf(w, now).filter((x) => x.client.shoot_type === 'dms').map((x) => x.editor), ['anna', 'yariv']);
  // An editor the card already has is kept (no client update), and imported history is not a closed day.
  const kept = shotClient(w, { name: 'קבוע', editor: 'nadia' });
  closeDay(w, kept);
  const k = planOf(w, now).find((x) => x.client.id === kept.id);
  assert.deepEqual([k.editor, k.kept, k.patch], ['nadia', true, null]);
  const imp = shotClient(w, { name: 'מיובא' });
  marks(w, imp, itemsOf('p19'), IL(2026, 10, 18, 17), IMPORT_NOTE);
  assert.ok(!planOf(w, now).some((x) => x.client.id === imp.id));
});

test('auto-assign: assigned, Ofir hears quietly and the editor\'s ladder starts; Ofir\'s "assign an editor" does not ring', () => {
  const w = world();
  const c = shotClient(w);
  closeDay(w, c);
  const now = IL(2026, 10, 18, 17, 1);
  // Before: the 22א ladder would ring Ofir.
  one(due(w, now), 'assign', 'now', 'ofir');
  const [a] = planOf(w, now);
  Object.assign(c, a.patch);
  for (const x of [...a.checks, a.reason]) mark(w, c, x.key, now, x.note);
  assert.equal(autoReasonOf(w.checks[c.id]).editor, a.editor);
  const after = due(w, now);
  none(after, 'assign');
  const q = one(after, 'autoAssigned', 'ofir', 'ofir');
  assert.equal(q.level, 'quiet');
  assert.match(q.title, new RegExp(`שויך אוטומטית: .* · ${PEOPLE[a.editor].name}`));
  one(after, 'editing', 'assigned', a.editor);
  // Ofir changed it by hand (the reason is no longer automatic): no more notes.
  mark(w, c, 'p22a.reason', IL(2026, 10, 18, 17, 30), JSON.stringify({ editor: 'nadia', reason: 'מכירה את הלקוח' }));
  none(due(w, IL(2026, 10, 18, 17, 31)), 'autoAssigned');
});

// ── 7. Approved graphics: Ilai, 30 minutes ──
test('graphics approved (the status page or Irit): Ilai rings at once with 30 office minutes; late, Ofir and Lior', () => {
  const w = world();
  const c = client(w, { name: 'גרפיקה', char_at: IL(2026, 10, 5, 10).toISOString() });
  importTo(w, c, 'char');
  for (const k of [...itemsOf('p07'), ...itemsOf('p07b')]) delete w.checks[c.id][k];
  marks(w, c, itemsOf('p07').filter((k) => k !== 'p07.approved'), IL(2026, 10, 5, 12));
  mark(w, c, 'p07.approved', IL(2026, 10, 5, 13), 'אושר בדף המצב על ידי דנה');
  const r = one(due(w, IL(2026, 10, 5, 13)), 'graphicsUpload', 'now', 'ilai');
  assert.equal(r.title, 'הגרפיקות של גרפיקה אושרו — להעלות לרשתות');
  assert.equal(r.exempt, 'clock');
  assert.match(r.body, /יעד היום 13:30/);
  // Late at 13:30; Ofir and Lior hear 15 office minutes after that, not in the same minute.
  assert.ok(!due(w, IL(2026, 10, 5, 13, 44)).some((x) => x.rule === 'late' && x.key.includes(':p07b@')));
  const late = due(w, IL(2026, 10, 5, 13, 46));
  for (const who of ['ofir', 'lior']) assert.equal(pick(late, 'late', who).find((x) => x.key.includes(':p07b@')).level, 'quiet', who);
  mark(w, c, 'p07b.posted', IL(2026, 10, 5, 13, 20));
  none(due(w, IL(2026, 10, 5, 13, 31)), 'graphicsUpload');
  // The rest of the graphics: Irit marks "אושר" in the app (p23.approved).
  const g = client(w, { name: 'יתרה', shoot_at: IL(2026, 10, 12, 10).toISOString() });
  importTo(w, g, 'post');
  for (const k of [...itemsOf('p23b')]) delete w.checks[g.id][k];
  mark(w, g, 'p23.approved', IL(2026, 10, 14, 17, 50));
  const r2 = one(due(w, IL(2026, 10, 14, 17, 50)), 'graphicsUpload', 'now', 'ilai');
  assert.match(r2.body, /יעד מחר 09:20/, 'office time: 10 minutes today, 20 tomorrow');
});

// ── 8. The next station ───────────────────
test('the client moved to the next station: the ready text for Irit (quiet) and a milestone in the queue', () => {
  const w = world();
  const c = client(w, { name: 'דנה', deal_at: IL(2026, 10, 4, 9).toISOString(), char_at: IL(2026, 10, 6, 10).toISOString() });
  marks(w, c, [...itemsOf('p01'), ...itemsOf('p02'), ...itemsOf('p03'), ...itemsOf('p11')], IL(2026, 10, 4, 9, 30));
  // Tuesday 10:00: the meeting began, the client is in "אפיון".
  const now = IL(2026, 10, 6, 10, 1);
  const st = clientState(c, w.checks[c.id], now);
  const m = stationChange(c, w.checks[c.id], st, now);
  assert.deepEqual([m.from, m.to, m.ref, hhmm(m.at)], ['הצטרפות', 'אפיון', 'station.char', '6.10 10:00']);
  assert.equal(m.text, 'היי, אנחנו כרגע לאחר שלב הצטרפות, ומתקדמים לשלב אפיון');
  assert.equal(stationChangeText('אפיון', 'תוכן ואישור'), 'היי, אנחנו כרגע לאחר שלב אפיון, ומתקדמים לשלב תוכן ואישור');
  const r = one(due(w, now), 'stationChange', 'irit', 'irit');
  assert.equal(r.level, 'quiet');
  assert.equal(r.title, 'דנה עבר/ה לשלב אפיון');
  assert.equal(r.body, 'לשלוח בקבוצה: היי, אנחנו כרגע לאחר שלב הצטרפות, ומתקדמים לשלב אפיון');
  assert.equal(r.url, 'messages.html');
  // Once per station.
  none(due(w, IL(2026, 10, 6, 11), [r.key]), 'stationChange');
  // In the queue, as a milestone with the owner's words (when no other milestone is due that day).
  const s = suggestFor(c, w.checks[c.id], [{ kind: 'milestone', template_key: 'welcome', ref: 'welcome', sent_at: IL(2026, 10, 4, 10).toISOString() }, { kind: 'milestone', template_key: 'access', ref: 'access', sent_at: IL(2026, 10, 5, 10).toISOString() }, { kind: 'milestone', template_key: 'summary', ref: 'summary', sent_at: IL(2026, 10, 5, 11).toISOString() }], now);
  const o = s.options.find((x) => x.key === 'station_change');
  assert.ok(o, JSON.stringify(s.options.map((x) => x.key)));
  assert.equal(messageText(o, templatesByKey()), 'היי, אנחנו כרגע לאחר שלב הצטרפות, ומתקדמים לשלב אפיון');
  // Sent: not again.
  assert.ok(!suggestFor(c, w.checks[c.id], [{ kind: 'milestone', template_key: 'station_change', ref: 'station.char', sent_at: IL(2026, 10, 5, 9).toISOString() }], now).options.some((x) => x.key === 'station_change'));
  // A client opened (imported) in a later station: nothing happened today.
  const imp = client(w, { name: 'מיובא', char_at: IL(2026, 10, 1, 10).toISOString() });
  importTo(w, imp, 'content', IL(2026, 10, 6, 9));
  assert.equal(stationChange(imp, w.checks[imp.id], null, IL(2026, 10, 6, 9, 30)), null);
  // The first station has no "before".
  const fresh = client(w, { name: 'חדש', char_at: null });
  assert.equal(stationChange(fresh, {}, null, IL(2026, 10, 6, 10)), null);
});

// ── The live run of 6.10.2026: "late" in the minute a handoff landed ──
test('"מיד" gets 15 office minutes before it is late anywhere; Ofir and Lior hear 15 more after; the minute clocks are as they were', () => {
  assert.deepEqual([IMMEDIATE_MINUTES, LATE_GRACE_MINUTES], [15, 15]);
  // Exactly the processes whose deadline is the event that starts them.
  // (5 starts with the meeting and is due at its end: it has the meeting's two hours, not zero.)
  assert.deepEqual(PROCESSES.filter((p) => isImmediate(p)).map((p) => p.id).sort(), ['p11b', 'p22a', 'p26']);
  const w = world();
  const c = client(w, { name: 'מיידי', editor: 'nadia', shoot_at: IL(2026, 10, 15, 11).toISOString(), char_at: IL(2026, 10, 5, 10).toISOString() });
  importTo(w, c, 'post');
  for (const id of ['p25', 'p26', 'p27']) for (const i of PROCESSES.find((p) => p.id === id).items) delete w.checks[c.id][i.key];
  marks(w, c, itemsOf('p25'), IL(2026, 10, 20, 10)); // Ofir approved at 10:00
  const p26 = (now) => clientState(c, w.checks[c.id], now).states.find((x) => x.proc.id === 'p26');
  assert.equal(hhmm(p26(IL(2026, 10, 20, 10, 1)).dueAt), '20.10 10:15');
  assert.notEqual(p26(IL(2026, 10, 20, 10, 1)).status, 'overdue');
  assert.notEqual(p26(IL(2026, 10, 20, 10, 15)).status, 'overdue');
  assert.equal(p26(IL(2026, 10, 20, 10, 16)).status, 'overdue');
  // Irit's "עכשיו" clock: 14 minutes left a minute after the approval, not "נגמר לפני 1 דק׳".
  const clock = clocksFor('irit', [c], w.checks, { now: IL(2026, 10, 20, 10, 1) }).find((k) => k.proc.id === 'p26');
  assert.deepEqual([clock.state, Math.round(clock.remaining / 6e4), clock.office], ['running', 14, true]);
  // The quiet note to Ofir and Lior: not when the handoff lands, not when the allowance ends, only 15 office minutes later.
  const lateOf = (now) => due(w, now).filter((r) => r.rule === 'late' && r.key.includes(':p26@'));
  for (const m of [0, 1, 14, 16, 29]) assert.deepEqual(lateOf(IL(2026, 10, 20, 10, m)), [], `10:${m}`);
  assert.deepEqual(lateOf(IL(2026, 10, 20, 10, 30)).map((r) => [r.person, r.level]).sort(), [['lior', 'quiet'], ['ofir', 'quiet']]);
  // Sent in time: never a note.
  mark(w, c, 'p26.sent', IL(2026, 10, 20, 10, 12));
  assert.deepEqual(lateOf(IL(2026, 10, 20, 11)), []);
  // After hours the allowance is office time: approved Thursday 17:55, late from Sunday 09:10.
  const w2 = world();
  const d = client(w2, { name: 'ערב', editor: 'nadia', shoot_at: IL(2026, 10, 15, 11).toISOString(), char_at: IL(2026, 10, 5, 10).toISOString() });
  importTo(w2, d, 'post');
  for (const id of ['p25', 'p26', 'p27']) for (const i of PROCESSES.find((p) => p.id === id).items) delete w2.checks[d.id][i.key];
  marks(w2, d, itemsOf('p25'), IL(2026, 10, 22, 17, 55));
  assert.equal(hhmm(clientState(d, w2.checks[d.id], IL(2026, 10, 22, 18)).states.find((x) => x.proc.id === 'p26').dueAt), '25.10 09:10');
  // The protocol's own short clocks did not move: 5 minutes for a deal, 30 for the access
  // check and the approved graphics, 10 / 10 / 5 for "the client did not answer".
  const n = client(w2, { name: 'חדש', deal_at: IL(2026, 10, 20, 10).toISOString() });
  const fresh = clientState(n, { 'p05.access': { state: 'done', at: IL(2026, 10, 20, 12).toISOString() }, 'p07.approved': { state: 'done', at: IL(2026, 10, 20, 13).toISOString() } }, IL(2026, 10, 20, 13));
  const dueOf = (id) => hhmm(fresh.states.find((x) => x.proc.id === id).dueAt);
  assert.deepEqual(['p01', 'p02', 'p03', 'p06', 'p07b'].map(dueOf), ['20.10 10:10', '20.10 10:05', '20.10 10:05', '20.10 12:30', '20.10 13:30']); // the contract: 10
  assert.deepEqual(Object.fromEntries(Object.entries(ANSWER_CLOCKS).map(([k, v]) => [k, v.minutes])), { p07: 10, p23: 10, p26: 5 });
});

test('the shoot day closed and the editor assigned by the server: 22א is whole, and never reported late', () => {
  const w = world();
  const c = shotClient(w);
  closeDay(w, c, IL(2026, 10, 18, 16)); // Sunday 16:00
  const lateOf = (now) => due(w, now).filter((r) => r.rule === 'late' && r.key.includes(':p22a@'));
  // The minute the day closed, before the server's run: not late (it was, in the live run).
  const now = IL(2026, 10, 18, 16, 1);
  assert.deepEqual(lateOf(now), []);
  const [a] = planOf(w, now);
  Object.assign(c, a.patch);
  for (const x of [...a.checks, a.reason]) mark(w, c, x.key, now, x.note);
  assert.equal(w.checks[c.id]['p22a.drive'].note, AUTO_DRIVE_NOTE);
  assert.equal(clientState(c, w.checks[c.id], now).states.find((x) => x.proc.id === 'p22a').complete, true);
  for (const t of [now, IL(2026, 10, 18, 16, 31), IL(2026, 10, 18, 17, 30), IL(2026, 10, 19, 9, 30), IL(2026, 10, 19, 12)]) assert.deepEqual(lateOf(t), [], hhmm(t));
  // A drive Lior never confirmed (the day closed from the card) is not closed for him.
  const w2 = world();
  const d = shotClient(w2);
  marks(w2, d, itemsOf('p19').filter((k) => k !== 'p19.took'), IL(2026, 10, 18, 16));
  mark(w2, d, 'p19.took', IL(2026, 10, 18, 16), 'לא רלוונטי');
  w2.checks[d.id]['p19.took'].state = 'na';
  assert.deepEqual(planOf(w2, now)[0].checks.map((x) => x.key), ['p22a.load', 'p22a.assigned', 'p22a.irit']);
  // With the assignment not running at all, 22א is late after the allowance and the note 15 minutes after that.
  const w3 = world();
  const e = shotClient(w3);
  closeDay(w3, e, IL(2026, 10, 18, 16));
  const late3 = (t) => due(w3, t).filter((r) => r.rule === 'late' && r.key.includes(':p22a@')).map((r) => r.person).sort();
  assert.deepEqual(late3(IL(2026, 10, 18, 16, 29)), []);
  assert.deepEqual(late3(IL(2026, 10, 18, 16, 30)), ['lior', 'ofir']);
});

// Found live (6.10.2026): lists, clocks, the Thursday summary and reminder titles named
// a client by the contact only; two clients with the same contact could not be told apart.
test('a client is named by the business first, then the contact: in reminder titles, the summaries and the WhatsApp variables', () => {
  assert.equal(clientLabel({ name: 'דנה', business: 'קפה דנה' }), 'קפה דנה · דנה');
  assert.equal(clientLabel({ name: 'דנה', business: null }), 'דנה');
  assert.equal(clientLabel({ name: 'קפה דנה', business: ' קפה דנה ' }), 'קפה דנה');
  assert.equal(clientLabel({ name: '', business: 'קפה דנה' }), 'קפה דנה');
  assert.equal(clientLabel(null), '');
  const w = world();
  const a = client(w, { name: 'דנה', business: 'קפה דנה', deal_at: IL(2026, 10, 20, 10).toISOString() });
  const b = client(w, { name: 'דנה', business: 'סטודיו דנה', deal_at: IL(2026, 10, 20, 10).toISOString() });
  const now = IL(2026, 10, 20, 10);
  const titles = due(w, now).filter((r) => r.rule === 'deal' && r.step === 'now').map((r) => r.title).sort();
  assert.deepEqual(titles, ['עסקה חדשה: סטודיו דנה · דנה', 'עסקה חדשה: קפה דנה · דנה']);
  // The WhatsApp template's first variable is the reminder's title: the same name.
  const row = due(w, now).find((r) => r.rule === 'deal' && r.step === 'now' && r.clientId === a.id);
  assert.equal(paramsOf(row)[0], 'עסקה חדשה: קפה דנה · דנה');
  // Every reminder of these clients that names them names the business (no title with the bare contact).
  const later = due(w, IL(2026, 10, 21, 12)).filter((r) => [a.id, b.id].includes(r.clientId));
  assert.ok(later.length > 2);
  for (const r of later) assert.ok(!/(^|[^·] )דנה($|[ :])/.test(r.title.replace(/(קפה|סטודיו) דנה · דנה/g, '')), r.title);
  // The owner's summary of what is 24 hours late, and the clocks, name them the same way.
  const late = lateSummary(buildEnv({ ...w, now: IL(2026, 10, 22, 18) }), IL(2026, 10, 22, 18)).join(' | ');
  assert.match(late, /קפה דנה · דנה \(\d\)/); // the line lists the first three, then "ועוד"
  assert.doesNotMatch(late, /[(,:] דנה \(/);
});
