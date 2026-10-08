// Stage 3, part 2, "intake": ending a characterization and its form
// (app/characterization.js), the focus call's answers (app/briefs.js), and
// Irit's days before a shoot and client requests (app/shoot-prep.js), with the
// reminder ladders they start (app/reminder-rules.js). Fixed Israel times; npm
// test runs this under UTC, New York and Jerusalem.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  endedProblems, endedNote, endedChecks, endedClientFields, validPhone, validUrl, formChecks, isComplete, missingFields,
  missingMaterials, missingTask, blockingTask, missingMessage, AUTO_NOTE, FORM_FIELDS, readDraft, draftText, draftWins,
  businessPhoneOf, logoUrlOf, closingLine, BLOCKING_TITLE,
} from '../app/characterization.js';
import { FOCUS_TOPICS, briefChecks, highlightsOf, emptyTopics, NOT_RAISED } from '../app/briefs.js';
import {
  coordinatorOf, shootContexts, shootPrep, topicsToClose, seenToday, seenNote, reportedOf, blockerTask, eveOf, checkAt,
  dayBefore, dayBeforeResult, dayBeforeNote, readDayBefore, dayBeforeText, DAY_BEFORE_LABELS, dayBeforeTask, shootDateConcerns, shootDateQuestion, shootDateNote, requestTask, requestDue, requestProblems,
  ackMessage, tellMessage, requestOf, TOPICS,
} from '../app/shoot-prep.js';
import { clientState, CHAR_ENDED, resolveTime, applicableProcesses } from '../app/protocol-logic.js';
import { PROCESSES } from '../app/protocol.js';
import { computeReminders, buildEnv } from '../app/reminder-engine.js';
import { qaClock } from '../app/reminder-rules.js';
import { importKeys } from '../app/client-open.js';
import { suggestFor } from '../app/messages-logic.js';
import { dateIL, partsIL, dayKeyIL } from '../app/tz.js';

const IL = (y, m, d, h = 0, mi = 0) => dateIL(y, m, d, h, mi);
const hhmm = (d) => { const p = partsIL(d); return `${p.day}.${p.month} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`; };
const itemsOf = (id) => PROCESSES.find((p) => p.id === id).items.filter((i) => !i.optional).map((i) => i.key);
const STAFF = ['irit', 'lior', 'ofir', 'ilai', 'nadia', 'eli'].map((p) => ({ email: `${p}@x`, person: p })).concat([{ email: 'owner@x', person: null }]);

let seq = 0;
function client(o = {}) {
  seq += 1;
  return {
    id: `c${seq}`, name: o.name || `לקוח ${seq}`, status: 'active', shoot_type: 'dms', characterizer: 'ofir', has_logo: true,
    rounds: [], contract_end: '2027-12-31', deal_at: IL(2026, 9, 1, 10).toISOString(), address: 'הרצל 1, תל אביב', ...o,
  };
}
const done = (key, at, note = null, state = 'done') => ({ [key]: { item_key: key, state, note, at: at.toISOString(), by_email: 'x@x' } });
const all = (keys, at, note = null) => Object.assign({}, ...keys.map((k) => done(k, at, note)));
const imported = (station) => all(importKeys(station), IL(2026, 9, 1, 9), 'ייבוא');
const without = (checks, keys) => { const out = { ...checks }; for (const k of keys) delete out[k]; return out; };
function world(c, checks, extra = {}) {
  return { clients: [c], checks: { [c.id]: checks }, tasks: [], access: [], reviews: [], statusNotes: [], messages: [], subscriptions: [], staff: STAFF, ...extra };
}
const due = (w, now, log = []) => computeReminders({ ...w, now, log });
const pick = (list, rule, step, person = null) => list.filter((r) => r.rule === rule && r.step === step && (!person || r.person === person));
const one = (list, rule, step, person = null) => {
  const got = pick(list, rule, step, person);
  assert.equal(got.length, 1, `${rule}.${step}${person ? `@${person}` : ''}: ${JSON.stringify(list.filter((r) => r.rule === rule).map((r) => r.key))}`);
  return got[0];
};
const none = (list, rule, step = null) => assert.equal(list.filter((r) => r.rule === rule && (!step || r.step === step)).length, 0,
  `${rule}${step ? `.${step}` : ''}: ${JSON.stringify(list.filter((r) => r.rule === rule).map((r) => r.key))}`);

// ── "האפיון הסתיים" ────────────────────────
test('"the characterization ended": 4 required short fields, in plain Hebrew', () => {
  assert.deepEqual(Object.keys(endedProblems({})).sort(), ['address', 'has_logo', 'networks', 'phone']);
  const ok = { address: 'הרצל 1, תל אביב', phone: '03-1234567', has_logo: false, networks: [{ network: 'instagram', status: 'ok' }, { network: 'tiktok', status: null }] };
  assert.deepEqual(endedProblems(ok), {});
  assert.match(endedProblems({ ...ok, phone: '12345' }).phone, /לא נראה תקין/);
  assert.ok(endedProblems({ ...ok, networks: [{ network: 'instagram', status: null }] }).networks);
  // "No network" is an answer too.
  assert.deepEqual(endedProblems({ ...ok, networks: [{ network: 'facebook', status: 'missing' }] }), {});
  for (const p of ['050-1234567', '03-1234567', '+972 50 123 4567', '1-700-500-500', '*2345', '0771234567']) assert.ok(validPhone(p), p);
  for (const p of ['', '123', '050-123', 'abc', '+1 555 123 4567']) assert.ok(!validPhone(p), p);
  assert.ok(validUrl('https://drive.google.com/x'));
  assert.ok(!validUrl('https://user:pw@example.com/'));
  assert.ok(!validUrl('drive.google.com'));
  assert.match(endedNote(ok), /^האפיון הסתיים · לוגו: אין · Instagram: יש גישה תקינה$/);
  assert.deepEqual(endedClientFields(ok), { address: 'הרצל 1, תל אביב', has_logo: false });
  // Access given goes to the vault (5's access and vault); no logo: 5's logo is not relevant.
  assert.deepEqual(endedChecks(ok).map((x) => `${x.key}:${x.state}`), ['p05.access:done', 'p05.vault:done', 'p05.logo:na']);
  // Without the vault (no permission), the access is recorded but not "in the vault".
  assert.deepEqual(endedChecks({ ...ok, has_logo: true }, { inVault: false }).map((x) => x.key), ['p05.access']);
});

test('"ended" starts the clocks of Ilai, Ofir (8) and Lior (10) at once, before the full form (decision 12)', () => {
  const c = client({ char_at: IL(2026, 10, 6, 10).toISOString() });
  const base = imported('char');
  // The meeting ended at 11:20; only the tap, no form yet.
  const checks = { ...base, ...done(CHAR_ENDED, IL(2026, 10, 6, 11, 20), 'האפיון הסתיים') };
  const s = clientState(c, checks, IL(2026, 10, 6, 11, 21));
  const st = (id) => s.states.find((x) => x.proc.id === id);
  assert.equal(st('p04').complete, false);
  assert.equal(hhmm(st('p07').dueAt), '6.10 13:20'); // two office hours from the tap, not from 12:00
  assert.equal(hhmm(st('p09').dueAt), '6.10 11:25');
  assert.equal(hhmm(st('p04').dueAt), '6.10 12:20'); // the form: 60 minutes after the tap
  const at = due(world(c, checks), IL(2026, 10, 6, 11, 20));
  const ilai = one(at, 'started', 'start', 'ilai');
  assert.match(ilai.body, /הכנת 9 גרפיקות ראשונות עד היום 13:20/);
  one(at, 'started', 'start', 'ofir');
  one(at, 'started', 'start', 'lior');
  // "האפיון הסתיים?" does not ring any more once it was tapped.
  none(due(world(c, checks), IL(2026, 10, 6, 12, 15)), 'char', 'end');
  // Without the tap, the old way still works: completing process 4 starts them.
  none(due(world(c, base), IL(2026, 10, 6, 11, 20)), 'started');
  one(due(world(c, base), IL(2026, 10, 6, 12, 15)), 'char', 'end', 'ofir');
});

test('the access given at the end goes straight to Ilai (30 minutes); the vault check closes by itself', () => {
  const c = client({ char_at: IL(2026, 10, 6, 10).toISOString() });
  const ended = IL(2026, 10, 6, 11, 30);
  const v = { address: 'הרצל 1', phone: '03-1234567', has_logo: true, networks: [{ network: 'instagram', status: 'ok' }] };
  const checks = { ...imported('char'), ...done(CHAR_ENDED, ended), ...Object.assign({}, ...endedChecks(v).map((x) => done(x.key, ended, x.note, x.state))) };
  one(due(world(c, checks), ended), 'access', 'now', 'ilai');
  none(due(world(c, checks), IL(2026, 10, 6, 12, 5)), 'vault', 'irit');
  // Irit's "not in the vault" ladder starts from the tap, when nothing went in.
  const noVault = { ...imported('char'), ...done(CHAR_ENDED, ended) };
  one(due(world(c, noVault), IL(2026, 10, 6, 12)), 'vault', 'irit', 'irit');
});

test('the full form within 60 minutes: the characterizer, then Irit, then Lior\'s list; saving it stops the ladder', () => {
  const c = client({ char_at: IL(2026, 10, 6, 10).toISOString(), characterizer: 'lior' });
  const checks = { ...imported('char'), ...done(CHAR_ENDED, IL(2026, 10, 6, 11)) };
  const w = world(c, checks);
  none(due(w, IL(2026, 10, 6, 11, 59)), 'charForm');
  const form = one(due(w, IL(2026, 10, 6, 12)), 'charForm', 'form', 'lior');
  assert.equal(form.level, 'ring');
  assert.equal(form.url, `intake.html?id=${c.id}#form`);
  one(due(w, IL(2026, 10, 6, 12, 30)), 'charForm', 'irit', 'irit');
  const l = one(due(w, IL(2026, 10, 6, 13)), 'charForm', 'lior', 'lior');
  assert.equal(l.list, true);
  Object.assign(checks, done('p04.saved', IL(2026, 10, 6, 11, 50)));
  none(due(w, IL(2026, 10, 6, 13)), 'charForm');
  // Process 4 is not reported late by the general rule meanwhile (its own ladder is above).
  const w2 = world(c, { ...imported('char'), ...done(CHAR_ENDED, IL(2026, 10, 6, 11)) });
  none(due(w2, IL(2026, 10, 6, 15)).filter((r) => r.key.includes(':p04@')), 'late');
  // Without the tap, a late process 4 is still reported the usual way (3.10.2026: Ofir and Lior, quietly).
  const w3 = world(c, imported('char'));
  for (const who of ['ofir', 'lior']) assert.ok(pick(due(w3, IL(2026, 10, 6, 12, 16)), 'late', who).some((r) => r.key.includes(':p04@') && r.level === 'quiet'), who);
});

test('the complete form checks process 4\'s items and closes Irit\'s follow-up by itself', () => {
  const f = Object.fromEntries(FORM_FIELDS.map((x) => [x.key, `${x.label} של העסק`]));
  f.phone = '050-1234567';
  assert.ok(isComplete(f));
  const keys = formChecks(f, {}).map((x) => x.key);
  for (const x of FORM_FIELDS) assert.ok(keys.includes(x.item), x.item);
  assert.ok(keys.includes('p04.saved'));
  const auto = formChecks(f, {}).filter((x) => x.note === AUTO_NOTE).map((x) => x.key);
  assert.deepEqual(auto, ['p04.followup', 'p04.tasks']);
  // With everything saved, the whole of process 4 is done.
  const c = client({ char_at: IL(2026, 10, 6, 10).toISOString() });
  const checks = Object.assign({}, ...formChecks(f, {}).map((x) => done(x.key, IL(2026, 10, 6, 12), x.note)));
  assert.ok(clientState(c, checks, IL(2026, 10, 6, 12, 1)).states.find((s) => s.proc.id === 'p04').complete);
  // Partial: only the fields filled; no "saved", no follow-up.
  const part = { ...f, special: '' };
  assert.ok(!isComplete(part));
  assert.deepEqual(missingFields(part).map((x) => x.key), ['special']);
  const pk = formChecks(part, {}).map((x) => x.key);
  assert.ok(!pk.includes('p04.saved') && !pk.includes('p04.followup'));
  assert.ok(pk.includes('p04.services'));
  // An invalid phone is not "a valid phone" (the item stays open) and the form is not complete.
  assert.ok(!isComplete({ ...f, phone: '123' }));
  assert.ok(!formChecks({ ...f, phone: '123' }, {}).some((x) => x.key === 'p04.phone'));
  // What is already resolved is not written again.
  assert.deepEqual(formChecks(f, checks), []);
});

test('materials: received, missing or not relevant; missing ones become one task for Irit with a ready message', () => {
  const f = { logo_url: '', colors: 'כחול ולבן', materials: { photos: 'got', videos: 'missing', menu: 'none' } };
  assert.deepEqual(missingMaterials(f, true), ['לוגו', 'סרטונים קיימים']);
  assert.deepEqual(missingMaterials(f, false), ['סרטונים קיימים']); // no logo: Ilai makes one
  const ch = formChecks(f, {}, { hasLogo: true });
  assert.deepEqual(ch.map((x) => `${x.key}:${x.state}`), ['p05.colors:done', 'p05.photos:done', 'p05.menu:na']);
  assert.deepEqual(formChecks({ logo_url: 'https://drive.google.com/logo' }, {}, { hasLogo: true }).map((x) => x.key), ['p05.logo']);
  const c = client({ name: 'מספרת רון', business: 'רון עיצוב שיער' });
  // Thursday: the next business day is Sunday.
  const t = missingTask(c, ['לוגו', 'סרטונים קיימים'], IL(2026, 10, 8, 12));
  assert.deepEqual({ owner: t.owner, due: t.due_on, urgent: t.urgent }, { owner: 'irit', due: '2026-10-11', urgent: false });
  assert.equal(t.title, 'להשלים מהלקוח: לוגו וסרטונים קיימים');
  const msg = missingMessage(c, ['לוגו', 'סרטונים קיימים'], 3, 5);
  assert.match(msg, /^היי מספרת רון, .*התקבלו 3 מתוך 5\.\nעוד חסר: לוגו וסרטונים קיימים\./s);
  assert.ok(!/[{}]/.test(msg));
  // Blocking today's work: an exception that rings Lior at once.
  const b = blockingTask(c, '', ['לוגו']);
  assert.deepEqual([b.owner, b.source, b.title], ['lior', 'escalation', `${BLOCKING_TITLE}: לוגו`]);
  const cc = client({ char_at: IL(2026, 10, 6, 10).toISOString() });
  const w = world(cc, imported('char'), { tasks: [{ id: 't1', ...b, client_id: cc.id, created_at: IL(2026, 10, 6, 12).toISOString() }] });
  const r = one(due(w, IL(2026, 10, 6, 12)), 'exception', 'blocking', 'lior');
  assert.equal(r.level, 'ring');
  assert.equal(r.body, 'לוגו');
  none(due(w, IL(2026, 10, 6, 12)), 'exception', 'list');
});

test('the form\'s draft on the phone: restored only when newer and different', () => {
  const d = readDraft(draftText({ services: 'תספורות' }, IL(2026, 10, 6, 12)));
  assert.deepEqual(d.fields, { services: 'תספורות' });
  assert.equal(readDraft('not json'), null);
  assert.equal(readDraft(JSON.stringify({ x: 1 })), null);
  assert.ok(draftWins(d, null));
  assert.ok(draftWins(d, { fields: {}, at: IL(2026, 10, 6, 11).toISOString() }));
  assert.ok(!draftWins(d, { fields: {}, at: IL(2026, 10, 6, 13).toISOString() })); // saved after the draft
  assert.ok(!draftWins(d, { fields: { services: 'תספורות' }, at: IL(2026, 10, 6, 11).toISOString() })); // nothing new
});

test('the business phone and the logo link for the editors, never the client\'s private phone', () => {
  const row = { fields: { phone: '03-1234567', logo_url: 'https://drive.google.com/logo' } };
  assert.equal(businessPhoneOf(row), '03-1234567');
  assert.equal(logoUrlOf(row), 'https://drive.google.com/logo');
  assert.equal(logoUrlOf({ fields: { logo_url: 'javascript:alert(1)' } }), null);
  assert.equal(businessPhoneOf(null), null);
  assert.equal(closingLine('03-1234567'), 'לפרטים נוספים התקשרו: 03-1234567');
});

test('Ofir\'s quality clock runs on from "ended", not from the end of the form (decision 11)', () => {
  const c = client({ char_at: IL(2026, 10, 6, 10).toISOString() });
  const checks = { ...imported('char'), ...done(CHAR_ENDED, IL(2026, 10, 6, 11)) };
  const env = buildEnv({ clients: [c], checks: { [c.id]: checks }, staff: STAFF, now: IL(2026, 10, 6, 11, 30) });
  assert.deepEqual(env.ofirMeetings, [[IL(2026, 10, 6, 10).getTime(), IL(2026, 10, 6, 11).getTime()]]);
  // Ready at 09:30: 30 minutes, the meeting 10:00–11:00, then 30 more → 11:30.
  assert.equal(hhmm(qaClock(env, IL(2026, 10, 6, 9, 30), 60)), '6.10 11:30');
});

// ── 12א, 12, 13 ────────────────────────────
test('the focus call (12א): the 10 topics of the protocol; saving checks them; "done" closes the rest as not raised', () => {
  assert.equal(FOCUS_TOPICS.length, 10);
  assert.deepEqual(FOCUS_TOPICS.map(([k]) => k), PROCESSES.find((p) => p.id === 'p12a').items.filter((i) => i.key.startsWith('p12a.t.')).map((i) => i.key.slice(7)));
  const f = { messages: 'להגיד שיש חניה', dont: 'לא להזכיר מחירים', services: 'צבע ותספורת' };
  const keys = briefChecks(f, {}).map((x) => x.key);
  assert.deepEqual(keys, ['p12a.t.services', 'p12a.t.messages', 'p12a.t.dont']);
  const fin = briefChecks(f, {}, { read: true, done: true });
  assert.ok(fin.some((x) => x.key === 'p12a.read') && fin.some((x) => x.key === 'p12a.call'));
  assert.equal(fin.filter((x) => x.state === 'na').length, 7);
  assert.ok(fin.filter((x) => x.state === 'na').every((x) => x.note === NOT_RAISED));
  assert.equal(emptyTopics(f).length, 7);
  // A second shoot round has its own keys.
  assert.ok(briefChecks(f, {}, { round: 2 }).every((x) => x.key.startsWith('r2.p12a.t.')));
  assert.deepEqual(highlightsOf({ fields: f }), { must: 'להגיד שיש חניה', dont: 'לא להזכיר מחירים' });
  assert.equal(highlightsOf({ fields: { services: 'x' } }), null);
  assert.equal(highlightsOf(null), null);
});

test('decision 14: scripts due at the end of business day 2, the Zoom on day 3; the approval is always real', () => {
  const c = client({ char_at: IL(2026, 10, 8, 10).toISOString() }); // Thursday
  const procs = applicableProcesses(c);
  const at = (id) => resolveTime(procs.find((p) => p.id === id).due, c, procs, {}, IL(2026, 10, 8, 12));
  assert.equal(dayKeyIL(at('p12')), '2026-10-12'); // Sunday 11, Monday 12
  assert.equal(dayKeyIL(at('p13')), '2026-10-13');
  const p13 = PROCESSES.find((p) => p.id === 'p13');
  assert.ok(p13.items.find((i) => i.key === 'p13.approved').noBulk);
  // The client's promise (ה5: scripts and Zoom within 3 business days) keeps its date;
  // day 2 is the office's own target. A notice of delay names the promised day.
  const m = client({ char_at: IL(2026, 10, 12, 10).toISOString(), business: 'x' }); // Monday
  const content = imported('content');
  const wed = suggestFor(m, content, [], IL(2026, 10, 14, 10));
  const delay = wed.options.find((o) => o.ref === 'p12');
  assert.equal(delay.vars['תאריך'], 'יום ה׳ 15.10');
});

// ── 11: the coordinator ────────────────────
test('the shoot-day coordinator (11): closed only when all four approved and it is in the calendar; Natali: makeup and ride', () => {
  const c = client({ shoot_type: 'natali', shoot_at: IL(2026, 10, 15, 11).toISOString() });
  const x = shootContexts(c)[0];
  const t = IL(2026, 10, 9, 10);
  let k = coordinatorOf(c, {}, x);
  assert.equal(k.closed, false);
  assert.deepEqual(k.approvals.map((a) => a.short), ['לקוח', 'משפיענים', 'ליאור', 'אלי']);
  const four = all(['p11.ok.client', 'p11.ok.influencers', 'p11.ok.lior', 'p11.ok.photographer', 'p11.influencers'], t);
  k = coordinatorOf(c, four, x);
  assert.equal(k.closed, false);
  assert.deepEqual(k.missing, ['הכנסה ליומן']);
  k = coordinatorOf(c, { ...four, ...done('p11.calendar', t) }, x);
  assert.equal(k.closed, true);
  assert.equal(k.fullyClosed, false);
  assert.deepEqual(k.nataliMissing, ['מאפרת', 'הסעה']);
  k = coordinatorOf(c, { ...four, ...all(['p11.calendar', 'p11b.makeup', 'p11b.ride'], t) }, x);
  assert.ok(k.fullyClosed);
  // The same state is process 11 complete.
  assert.ok(clientState(c, { ...four, ...done('p11.calendar', t) }, t).states.find((s) => s.proc.id === 'p11').complete);
  // A round's coordinator uses its own keys.
  const r = client({ rounds: [{ n: 2, shoot_type: 'dms', shoot_at: IL(2026, 11, 3, 11).toISOString(), start_at: IL(2026, 10, 20, 10).toISOString() }] });
  assert.ok(coordinatorOf(r, {}, shootContexts(r)[1]).approvals.every((a) => a.key.startsWith('r2.p11.ok.')));
  assert.deepEqual(coordinatorOf(client(), {}, shootContexts(client())[0]).needs, ['תאריך ושעה']);
});

// ── 14: blockers ───────────────────────────
test('shoot blockers (14) are computed from what the system knows, by the 8 topics of process 14', () => {
  const c = client({ char_at: IL(2026, 10, 4, 10).toISOString(), shoot_at: IL(2026, 10, 15, 11).toISOString() });
  // Everything before the shoot done, except: the scripts (late), the client's approval, a broken login.
  const checks = without(imported('shoot'), [...itemsOf('p12'), ...itemsOf('p13'), ...PROCESSES.find((p) => p.id === 'p14').items.map((i) => i.key)]);
  const now = IL(2026, 10, 12, 9);
  const access = [{ id: 'a1', client_id: c.id, network: 'instagram', status: 'broken', updated_at: IL(2026, 10, 10).toISOString() }];
  const tasks = [
    { id: 't1', client_id: c.id, title: 'להביא מחירון', owner: 'irit', due_on: '2026-10-11', done_at: null, source: null, urgent: false },
    { id: 't2', client_id: c.id, title: 'לתאם חניה', owner: 'irit', due_on: '2026-10-20', done_at: null, source: null, urgent: false },
    { id: 't3', client_id: c.id, title: 'לעדכן את הלקוח: x', owner: 'irit', due_on: '2026-10-01', done_at: null, source: 'tell', urgent: false },
  ];
  const [p] = shootPrep(c, checks, clientState(c, checks, now), { tasks, access, now });
  assert.deepEqual(p.topics.map((t) => t.item), TOPICS.map((t) => `p14.${t.key}`));
  const ids = p.blockers.map((b) => b.id);
  assert.deepEqual(ids, ['approvals:p13', 'scripts:p12', 'access:a1', 'team:t1']);
  assert.match(p.blockers[1].text, /התסריטים לא מוכנים \(היעד: יום ג׳ 6\.10 18:00\)/);
  assert.equal(p.blockers.find((b) => b.id === 'access:a1').who, 'lior');
  // An approval not late yet blocks from two business days before the shoot.
  const d = client({ char_at: IL(2026, 10, 11, 10).toISOString(), shoot_at: IL(2026, 10, 15, 11).toISOString() });
  const dc = { ...checks, ...all(itemsOf('p12'), IL(2026, 10, 12, 12)) };
  const at = (n) => shootPrep(d, dc, clientState(d, dc, n), { now: n })[0].blockers.map((b) => b.id);
  assert.deepEqual(at(IL(2026, 10, 12, 9)), []);
  assert.deepEqual(at(IL(2026, 10, 13, 9)), ['approvals:p13']);
  // Clear topics are closed by the system: done things at once, "no delays / no team
  // tasks" only from the business day before the shoot.
  const close = topicsToClose(p, checks, now);
  assert.ok(close.includes('p14.graphics') && close.includes('p14.shootday') && close.includes('p14.missing'));
  assert.ok(!close.includes('p14.delays') && !close.includes('p14.scripts') && !close.includes('p14.access'));
  const eve = IL(2026, 10, 14, 9);
  const pe = shootPrep(c, checks, clientState(c, checks, eve), { tasks: [], access: [], now: eve })[0];
  assert.ok(topicsToClose(pe, checks, eve).includes('p14.delays'));
  assert.ok(topicsToClose(pe, checks, eve).includes('p14.team'));
  // A past shoot, or a client not live: nothing.
  assert.deepEqual(shootPrep(c, checks, clientState(c, checks, IL(2026, 10, 16)), { now: IL(2026, 10, 16) }), []);
  assert.deepEqual(shootPrep({ ...c, status: 'cancelled' }, checks, clientState(c, checks, now), { now }), []);
});

test('blockers: "עברתי" is for today only; "דווח לליאור" opens an exception that keeps it on her list until closed', () => {
  const c = client({ shoot_at: IL(2026, 10, 15, 11).toISOString() });
  const now = IL(2026, 10, 12, 9);
  const note = seenNote({}, '', 'scripts:p12', now);
  const checks = done('p14.seen', now, note);
  assert.deepEqual([...seenToday(checks, '', now)], ['scripts:p12']);
  assert.deepEqual([...seenToday(checks, '', IL(2026, 10, 13, 9))], []); // the next morning it is back
  const more = seenNote(checks, '', 'team:t1', now);
  assert.deepEqual(JSON.parse(more).ids, ['scripts:p12', 'team:t1']);
  const prep = { shootAt: IL(2026, 10, 15, 11) };
  const t = blockerTask(c, prep, { id: 'scripts:p12', text: 'התסריטים לא מוכנים' }, now);
  assert.deepEqual([t.owner, t.source, t.urgent, t.brief.blocker], ['lior', 'escalation', false, 'scripts:p12']);
  assert.match(t.title, /^חוסם ליום הצילום \(יום ה׳ 15\.10\): התסריטים לא מוכנים$/);
  assert.equal(blockerTask(c, prep, { id: 'x', text: 'y' }, IL(2026, 10, 13, 9)).urgent, true); // 2 business days before
  // An open exception about the client is Lior's already: a known blocker, not reported again
  // (the day-before check's own exception is shown in that check, not here).
  const cc = client({ char_at: IL(2026, 10, 4, 10).toISOString(), shoot_at: IL(2026, 10, 15, 11).toISOString() });
  const ch = imported('shoot');
  const tk = [
    { id: 'e1', client_id: cc.id, title: 'חסר מידע', owner: 'lior', source: 'escalation', urgent: false, done_at: null },
    { id: 'e2', client_id: cc.id, title: 'בדיקת יום לפני נכשלה', owner: 'lior', source: 'escalation', urgent: true, done_at: null, brief: { dayBefore: 'p15' } },
  ];
  const [pp] = shootPrep(cc, ch, clientState(cc, ch, now), { tasks: tk, now });
  assert.deepEqual(pp.blockers.map((x) => [x.id, !!x.known]), [['team:e1', true]]);
  const w = world(cc, ch, { tasks: tk.map((x) => ({ ...x, created_at: IL(2026, 10, 12, 9).toISOString() })) });
  one(due(w, IL(2026, 10, 12, 8, 30)), 'blockers', 'd2026-10-12', 'irit');
  none(due(w, IL(2026, 10, 13, 10)), 'blockers', 'lior');
  const reported = reportedOf([{ ...t, id: 'e1', done_at: null }, { ...t, id: 'e2', client_id: 'other' }], c.id);
  assert.deepEqual([...reported.keys()], ['scripts:p12']);
  assert.equal(reportedOf([{ ...t, done_at: now.toISOString() }], c.id).size, 0);
});

// ── 15: the day before ─────────────────────
test('the day-before check (15): 11:15 on the business day before; a Sunday shoot is checked on Thursday (decision 15)', () => {
  assert.equal(hhmm(checkAt(IL(2026, 10, 15, 11))), '14.10 11:15');
  assert.equal(hhmm(checkAt(IL(2026, 10, 18, 11))), '15.10 11:15'); // Sunday → Thursday
  assert.equal(hhmm(eveOf(IL(2026, 10, 18, 11))), '15.10 12:00');
  // The reminder engine rings Irit at the same moment.
  const c = client({ shoot_at: IL(2026, 10, 18, 11).toISOString() });
  const checks = without(imported('shoot'), itemsOf('p15'));
  const w = world(c, checks);
  none(due(w, IL(2026, 10, 15, 11, 14)), 'eve', '1115');
  one(due(w, IL(2026, 10, 15, 11, 15)), 'eve', '1115', 'irit');
});

test('the day-before check is prefilled: what the system knows is checked, Irit answers the rest, a failure goes to Lior', () => {
  const c = client({ shoot_type: 'natali', shoot_at: IL(2026, 10, 15, 11).toISOString() });
  const t = IL(2026, 10, 14, 10);
  const checks = { ...all(['p13.approved', 'p15.client', 'p15.influencers', 'p15.natali.makeup', 'p15.natali.ride'], t) };
  const x = shootContexts(c)[0];
  const now = IL(2026, 10, 14, 11, 15);
  const prep = shootPrep(c, checks, clientState(c, checks, now), { now })[0] || null;
  const d = dayBefore(c, checks, prep, x, now);
  assert.ok(d.open);
  assert.equal(hhmm(d.at), '14.10 11:15');
  const auto = Object.fromEntries(d.items.map((i) => [i.id, i.auto]));
  assert.deepEqual(auto, { content: 'ok', client: 'ok', influencers: 'ok', crew: 'fail', address: null, tasks: 'ok', natali: 'ok', remembers: null });
  assert.equal(dayBeforeResult(d, { address: 'ok' }), null); // "the client remembers" is still unanswered
  const res = dayBeforeResult(d, { address: 'ok', remembers: 'fail' });
  assert.deepEqual(res.failed, ['crew', 'remembers']);
  assert.deepEqual(readDayBefore(dayBeforeNote(res)), res);
  // In the client card the saved result is a line of words, never the JSON (found live, 6.10.2026).
  assert.deepEqual(Object.fromEntries(d.items.map((i) => [i.id, i.label])), DAY_BEFORE_LABELS);
  assert.equal(dayBeforeText(dayBeforeNote(res)), 'נבדקו 8 פריטים. לא תקין: הצלם והצוות עודכנו, הלקוח זוכר את היום (שיחה קצרה)');
  assert.equal(dayBeforeText(dayBeforeNote({ ok: d.items.map((i) => i.id), failed: [] })), 'נבדקו 8 פריטים, הכול תקין');
  assert.equal(dayBeforeText(dayBeforeNote({ ok: ['content'], failed: [] })), 'נבדק פריט אחד, הכול תקין');
  assert.equal(dayBeforeText('הערה רגילה'), null);
  assert.equal(dayBeforeText('{"videos":[1]}'), null);
  const task = dayBeforeTask(c, d, res.failed);
  assert.deepEqual([task.owner, task.source, task.urgent], ['lior', 'escalation', true]);
  assert.equal(task.title, 'בדיקת יום לפני הצילום (יום ה׳ 15.10) נכשלה: הצלם והצוות עודכנו והלקוח זוכר את היום (שיחה קצרה)');
  // The address marked as given to everyone: checked by the system too. No address in the card: failed.
  const withAddr = dayBefore(c, { ...checks, ...done('p15.d.address', t) }, prep, x, now);
  assert.equal(withAddr.items.find((i) => i.id === 'address').auto, 'ok');
  assert.equal(dayBefore({ ...c, address: '' }, checks, prep, x, now).items.find((i) => i.id === 'address').auto, 'fail');
  // Two days before, it is not open yet; a past shoot has none.
  assert.equal(dayBefore(c, checks, prep, x, IL(2026, 10, 13, 10)).open, false);
  assert.equal(dayBefore(c, checks, prep, x, IL(2026, 10, 16, 10)), null);
  // Done: the note is read back.
  const fin = dayBefore(c, { ...checks, ...done('p15.irit', now, dayBeforeNote(res)) }, prep, x, now);
  assert.deepEqual(fin.done.failed, ['crew', 'remembers']);
});

// ── Irit's section 17: client requests ─────
test('a client request is a task with an owner and a due day; done, Irit is told to update the client', () => {
  const c = client({ name: 'קפה גולן' });
  assert.equal(requestDue(IL(2026, 10, 8, 12)), '2026-10-11'); // a business day (decision 29)
  assert.equal(requestDue(IL(2026, 10, 8, 12), true), '2026-10-08');
  const t = requestTask({ client: c, text: '  להוסיף מבצע לסטורי ', owner: 'ilai', dueOn: '2026-10-11' });
  assert.deepEqual(t, { client_id: c.id, title: 'להוסיף מבצע לסטורי', owner: 'ilai', due_on: '2026-10-11', source: 'request', urgent: false });
  assert.deepEqual(Object.keys(requestProblems({ client: null, text: '', owner: '' })).sort(), ['client', 'owner', 'text']);
  assert.deepEqual(requestProblems({ client: c, text: 'בקשה', owner: 'editor' }), { owner: 'לבחור מי מטפל.' });
  assert.equal(ackMessage(c, 'להוסיף מבצע', 'ilai', '2026-10-11'), 'היי קפה גולן, קיבלנו את הבקשה: "להוסיף מבצע". הבקשה אצל עילאי, ונחזור אליכם עד יום א׳ 11.10.');
  const tell = { id: 'tt', client_id: c.id, title: 'לעדכן את הלקוח: להוסיף מבצע', owner: 'irit', source: 'tell', brief: { of: 'x', request: 'להוסיף מבצע' }, done_at: null, created_at: IL(2026, 10, 11, 14).toISOString() };
  assert.equal(requestOf(tell), 'להוסיף מבצע');
  assert.equal(requestOf({ title: 'לעדכן את הלקוח: אחר' }), 'אחר');
  assert.match(tellMessage(c, 'להוסיף מבצע'), /^היי קפה גולן, עדכון על הבקשה שלכם: "להוסיף מבצע"\. טיפלנו בזה\./);
  // The reminder: Irit in the app at once, her digest the next morning; not the ordinary task ladder.
  const w = world(c, imported('ongoing'), { tasks: [tell] });
  const now = one(due(w, IL(2026, 10, 11, 14)), 'tell', 'now', 'irit');
  assert.equal(now.level, 'quiet');
  assert.equal(now.title, 'לעדכן את הלקוח: קפה גולן');
  assert.equal(now.body, 'הבקשה טופלה: להוסיף מבצע');
  none(due(w, IL(2026, 10, 11, 14)), 'task');
  one(due(w, IL(2026, 10, 12, 8, 30)), 'tell', 'next', 'irit');
  // The request itself follows the ordinary task ladder (its owner; the due morning).
  const w2 = world(c, imported('ongoing'), { tasks: [{ ...t, id: 'r1', done_at: null, created_by_email: 'irit@x', created_at: IL(2026, 10, 8, 12).toISOString() }] });
  one(due(w2, IL(2026, 10, 8, 12)), 'task', 'created', 'ilai');
  one(due(w2, IL(2026, 10, 11, 8, 30)), 'task', 'due', 'ilai');
});

// Found live (6.10.2026): a shoot day was set on the evening of the characterization itself.
test('a shoot date against the usual order is asked about: in the past, before the characterization, or under 3 business days after it', () => {
  const now = IL(2026, 10, 6, 12); // Tuesday
  const char = IL(2026, 10, 8, 10).toISOString(); // Thursday
  const ask = (shoot, c = char) => shootDateConcerns({ shootAt: shoot.toISOString(), charAt: c, now });
  // In order: three business days after (Sunday, Monday, Tuesday → from Tuesday 13.10).
  assert.deepEqual(ask(IL(2026, 10, 13, 11)), []);
  assert.deepEqual(ask(IL(2026, 11, 2, 11)), []);
  // The live case: the same evening.
  assert.deepEqual(ask(IL(2026, 10, 8, 19)), ['פחות מ־3 ימי עסקים אחרי פגישת האפיון (יום ה׳ 8.10): התסריטים עוד לא יהיו כתובים ומאושרים.']);
  assert.equal(ask(IL(2026, 10, 12, 11)).length, 1); // two business days after
  // Before the characterization, and in the past.
  assert.deepEqual(ask(IL(2026, 10, 7, 11)), ['יום הצילום לפני פגישת האפיון (יום ה׳ 8.10).']);
  assert.deepEqual(ask(IL(2026, 10, 5, 11)), ['המועד כבר עבר.', 'יום הצילום לפני פגישת האפיון (יום ה׳ 8.10).']);
  // No characterization date (a shoot round): only a date in the past is asked about.
  assert.deepEqual(ask(IL(2026, 10, 7, 11), null), []);
  assert.deepEqual(ask(IL(2026, 10, 5, 11), null), ['המועד כבר עבר.']);
  assert.deepEqual(shootDateConcerns({ shootAt: null, charAt: char, now }), []);
  const concerns = ask(IL(2026, 10, 8, 19));
  assert.equal(shootDateQuestion(IL(2026, 10, 8, 19).toISOString(), concerns), `יום הצילום: יום ה׳ 8.10 בשעה 19:00.\n• ${concerns[0]}\n\nלקבוע את המועד בכל זאת?`);
  assert.equal(shootDateNote(concerns), `אושר למרות: ${concerns[0]}`);
  assert.ok(shootDateNote(['א'.repeat(600)]).length <= 500);
});
