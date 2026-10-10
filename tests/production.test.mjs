// The production pages' logic (app/production.js) and the reminder rules that follow
// it (app/reminder-rules.js): day X of 3 and dates in words, the editor's state
// machine, the shoot-day lock and the drive handoff, the quiet mode, Nirel's briefs,
// and each new ladder. Israel times; npm test runs this under 3 time zones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../app/production.js';
import { clientState } from '../app/protocol-logic.js';
import { computeReminders, buildEnv } from '../app/reminder-engine.js';
import { RULES } from '../app/reminder-rules.js';
import { PROCESSES } from '../app/protocol.js';
import { importKeys } from '../app/client-open.js';
import { IMPORT_NOTE } from '../app/protocol-logic.js';
import { dateIL, partsIL, endOfDayIL } from '../app/tz.js';
import { returnNote, returnKey, fixedKey, fixedItemKey } from '../app/office-marks.js';

const IL = (y, m, d, h = 0, mi = 0) => dateIL(y, m, d, h, mi);
const hhmm = (d) => { const p = partsIL(d); return `${p.day}.${p.month} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`; };
const done = (at, note = null) => ({ state: 'done', at: at.toISOString(), note, by_email: 'x@x' });

// ── Words ─────────────────────────────────
test('dates in words: today, tomorrow, the weekday, and the office end for an end-of-day deadline', () => {
  const now = IL(2026, 10, 19, 10); // Monday
  assert.equal(P.dayWords(IL(2026, 10, 19, 15), now), 'היום');
  assert.equal(P.dayWords(IL(2026, 10, 20, 15), now), 'מחר');
  assert.equal(P.dayWords(IL(2026, 10, 21, 15), now), 'רביעי');
  assert.equal(P.dayWords(IL(2026, 10, 27, 15), now), 'שלישי 27.10'); // a week or more away: with the date
  assert.equal(P.dueWords(endOfDayIL(IL(2026, 10, 21)), now), 'רביעי 18:00');
  assert.equal(P.dueWords(IL(2026, 10, 21, 14, 30), now), 'רביעי 14:30');
  // Erev Yom Kippur (Sunday 20.9.2026) closes at 13:00.
  assert.equal(P.dueWords(endOfDayIL(IL(2026, 9, 20)), IL(2026, 9, 17, 10)), 'ראשון 13:00');
  assert.equal(P.dateWords(IL(2026, 10, 15, 11)), 'יום חמישי 15.10');
});

test('day X of 3: the assignment day is not counted; weekends and holidays are skipped', () => {
  const assigned = IL(2026, 10, 18, 10); // Sunday
  assert.equal(P.editingDay(assigned, IL(2026, 10, 18, 17)), 0);
  assert.match(P.editingDayText(0, IL(2026, 10, 18, 17), assigned), /^יום השיוך · יום 1 מתוך 3 מתחיל מחר$/);
  assert.equal(P.editingDay(assigned, IL(2026, 10, 19, 9)), 1);
  assert.equal(P.editingDayText(P.editingDay(assigned, IL(2026, 10, 21, 9))), 'יום 3 מתוך 3');
  assert.equal(P.editingDayText(P.editingDay(assigned, IL(2026, 10, 22, 9))), 'יום 4 · תיקוני הלקוח');
  // Assigned on Thursday: Sunday is day 1.
  assert.equal(P.editingDay(IL(2026, 10, 22, 12), IL(2026, 10, 25, 9)), 1);
  // Assigned on erev Yom Kippur: Yom Kippur is not day 1.
  assert.equal(P.editingDay(IL(2026, 9, 20, 10), IL(2026, 9, 21, 10)), 0);
  assert.equal(P.editingDay(IL(2026, 9, 20, 10), IL(2026, 9, 22, 10)), 1);
});

test('videos for a shoot day: the package split over its shoot days', () => {
  assert.equal(P.videosPerDay({ deliverables: { videos: 25, shoot_days: 1 } }), 25);
  assert.equal(P.videosPerDay({ deliverables: { videos: 42, shoot_days: 2 } }), 21);
  assert.equal(P.videosPerDay({ deliverables: {} }), null);
});

// ── The editor's state machine ────────────
const baseClient = (o = {}) => ({
  id: 'c1', name: 'מספרת רון', status: 'active', shoot_type: 'dms', characterizer: 'ofir', has_logo: true, editor: 'nadia',
  rounds: [], deliverables: { videos: 4, shoot_days: 1 }, links: {}, deal_at: IL(2026, 9, 1).toISOString(),
  char_at: IL(2026, 10, 5, 10).toISOString(), shoot_at: IL(2026, 10, 15, 11).toISOString(), contract_end: '2027-12-31', ...o,
});
const imported = (station) => Object.fromEntries(importKeys(station).map((k) => [k, { state: 'done', at: IL(2026, 9, 1).toISOString(), note: IMPORT_NOTE }]));
function postWorld(o = {}) {
  const c = baseClient(o);
  const checks = imported('post');
  for (const id of ['p22a', 'p22', 'p24', 'p25', 'p26', 'p27']) {
    for (const i of PROCESSES.find((p) => p.id === id).items) delete checks[i.key];
  }
  return { c, checks };
}
const stOf = (c, checks, now = IL(2026, 10, 19, 10)) => {
  const [job] = P.editingCases(c, checks, c.editor, clientState(c, checks, now));
  return job ? P.editorState(job, checks) : null;
};

test('editor states: waiting → editing → QA → fixes → QA → client → client fixes → final → Ilai → done', () => {
  const { c, checks } = postWorld();
  assert.equal(stOf(c, checks), null); // not assigned yet: nothing on the page
  checks['p22a.assigned'] = done(IL(2026, 10, 18, 10));
  assert.equal(stOf(c, checks).key, 'waiting');
  assert.equal(P.editingCases(c, checks, 'yariv', clientState(c, checks)).length, 0); // another editor sees nothing
  checks['p22.received'] = done(IL(2026, 10, 18, 11));
  assert.equal(stOf(c, checks).key, 'editing');
  // Blocked: reported and the process waits.
  checks['p22.missing'] = done(IL(2026, 10, 18, 12), P.missingNote(['logo', 'phone'], 'אין לוגו'));
  assert.equal(stOf(c, checks).blocked, null, 'a report without the wait is not a block (it was resolved)');
  checks['p22.wait'] = done(IL(2026, 10, 18, 12), JSON.stringify({ reason: P.blockedReason(['logo', 'phone']) }));
  const blocked = stOf(c, checks);
  assert.equal(blocked.key, 'editing');
  assert.deepEqual(blocked.blocked.what, ['logo', 'phone']);
  assert.equal(P.missingText(blocked.blocked.what), 'לוגו, טלפון העסק');
  delete checks['p22.wait'];
  delete checks['p22.missing'];
  // (2) Ready for QA.
  for (const k of P.readyKeys(false)) checks[k] = done(IL(2026, 10, 20, 12));
  assert.equal(stOf(c, checks).key, 'qa');
  // (3) Ofir returns two videos (the office's marks, app/office-marks.js); one
  // fixed, then all → back to Ofir, round 2 of his check.
  checks[returnKey('', 'videos', 1)] = done(IL(2026, 10, 20, 13), returnNote([{ ref: '2', text: 'כתובית' }, { ref: '4', text: 'סגיר' }], IL(2026, 10, 20, 17)));
  let st = stOf(c, checks);
  assert.equal(st.key, 'fixes');
  assert.deepEqual(st.ret.issues.map((v) => v.ref), ['2', '4']);
  assert.equal(hhmm(st.ret.due), '20.10 17:00');
  checks[fixedItemKey('', 'videos', 1, 0)] = done(IL(2026, 10, 20, 14));
  assert.deepEqual([...stOf(c, checks).ret.fixed], [0]);
  assert.equal(P.pausePrefill({ ...P.editingCases(c, checks, 'nadia', clientState(c, checks, IL(2026, 10, 20, 14)))[0] }, stOf(c, checks), IL(2026, 10, 20, 14)).left, 'תיקונים מאופיר (תיקון אחד)');
  checks[fixedItemKey('', 'videos', 1, 1)] = done(IL(2026, 10, 20, 15));
  checks[fixedKey('', 'videos', 1)] = done(IL(2026, 10, 20, 15));
  st = stOf(c, checks);
  assert.equal(st.key, 'qa');
  assert.equal(st.round, 2);
  assert.equal(hhmm(st.since), '20.10 15:00');
  // Marking the videos ready again after a return counts as fixed too (office's rule).
  checks[returnKey('', 'videos', 2)] = done(IL(2026, 10, 20, 15, 30), returnNote([{ ref: '', text: 'הקצב' }], null));
  assert.equal(stOf(c, checks).key, 'fixes');
  checks['p24.notify'] = done(IL(2026, 10, 20, 15, 45));
  assert.equal(stOf(c, checks).key, 'qa');
  // Ofir approved: with the client; the client's notes per video; all fixed → final.
  checks['p25.approved'] = done(IL(2026, 10, 20, 16));
  assert.equal(stOf(c, checks).key, 'client');
  assert.equal(P.canFinish(stOf(c, checks)), false);
  checks['p27.notes'] = done(IL(2026, 10, 21, 10), JSON.stringify({ videos: [{ n: 1, text: 'להחליף שיר' }] }));
  st = stOf(c, checks);
  assert.equal(st.key, 'clientFixes');
  assert.deepEqual(st.notes.videos, [{ n: 1, text: 'להחליף שיר' }]);
  checks['p27.fixed'] = done(IL(2026, 10, 21, 12), P.clientFixedNote([1]));
  assert.deepEqual([...stOf(c, checks).fixed], [1]);
  checks['p27.fixes'] = done(IL(2026, 10, 21, 12));
  assert.equal(stOf(c, checks).key, 'final');
  assert.equal(P.canFinish(stOf(c, checks)), true);
  // (4) → Ilai (the editor marks p27.final); closes when he marks "קיבלתי" (p27.toilai, protocol v5).
  checks['p27.final'] = done(IL(2026, 10, 21, 13));
  assert.equal(stOf(c, checks).key, 'ilai');
  checks['p28.scheduled'] = done(IL(2026, 10, 21, 15));
  assert.equal(stOf(c, checks).key, 'done', 'Ilai already scheduled with them');
  delete checks['p28.scheduled'];
  checks['p27.toilai'] = done(IL(2026, 10, 21, 14));
  assert.equal(stOf(c, checks).key, 'done');
});

test('editor states: the client approved without notes opens button 4; a text-only return; a round of its own', () => {
  const { c, checks } = postWorld();
  checks['p22a.assigned'] = done(IL(2026, 10, 18, 10));
  checks['p22.received'] = done(IL(2026, 10, 18, 11));
  checks['p24.notify'] = done(IL(2026, 10, 20, 12));
  checks[returnKey('', 'videos', 1)] = done(IL(2026, 10, 20, 13), returnNote([{ ref: '', text: 'הקצב איטי בכל הסרטונים' }], null));
  const st = stOf(c, checks);
  assert.equal(st.key, 'fixes');
  assert.deepEqual(st.ret.issues, [{ ref: '', text: 'הקצב איטי בכל הסרטונים' }]);
  assert.deepEqual(P.firstReturnOf(checks, ''), { videos: [] }, 'no video named: the whole batch');
  checks['p24.notify'] = done(IL(2026, 10, 20, 15));
  checks['p25.approved'] = done(IL(2026, 10, 20, 16));
  checks['p27.approved'] = done(IL(2026, 10, 21, 10));
  assert.equal(stOf(c, checks).key, 'final');
  // A shoot round edited by someone else, and one by Nadia.
  const r = baseClient({ editor: 'yariv', rounds: [{ n: 2, shoot_type: 'dms', shoot_at: IL(2026, 11, 5, 11).toISOString(), editor: 'nadia', start_at: IL(2026, 10, 25).toISOString() }] });
  const rc = { 'r2.p22a.assigned': done(IL(2026, 11, 6, 10)) };
  const jobs = P.editingCases(r, rc, 'nadia', clientState(r, rc, IL(2026, 11, 6, 12)));
  assert.deepEqual(jobs.map((j) => [j.round, j.pre]), [[2, 'r2.']]);
  assert.equal(P.editorState(jobs[0], rc).key, 'waiting');
  assert.equal(hhmm(jobs[0].p24.dueAt), '10.11 18:00'); // assigned on a Friday: Sunday is day 1
});

test('the self-check and the start checks are existing items; "מוכן לבדיקה" marks the notice to Ofir last', () => {
  const keys = new Set(PROCESSES.flatMap((p) => p.items.map((i) => i.key)));
  for (const [k] of [...P.START_CHECKS, ...P.selfCheck(true)]) assert.ok(keys.has(k), k);
  // (Protocol v10: the five critical mistakes of editing come last, under their own line.)
  const FIVE = ['sound', 'exposure', 'stable', 'angles', 'export'].map((k) => `p22.self.${k}`);
  assert.deepEqual(P.selfCheck(false).map(([k]) => k), ['p22.self.spelling', 'p22.self.closing', 'p22.self.broll', 'p22.self.complete', 'p24.drive', ...FIVE]);
  assert.deepEqual(P.selfCheck(false).filter(([, , g]) => g === 'critical').map(([k]) => k), FIVE);
  assert.equal(P.selfCheck(true)[5][0], 'p24.dropbox');
  assert.deepEqual(P.readyKeys(false).slice(-6), [...FIVE, 'p24.notify']);
  assert.equal(P.readyKeys(false).at(-1), 'p24.notify');
  assert.equal(P.needsDropbox({ links: { dropbox: 'https://www.dropbox.com/x' } }), true);
  assert.equal(P.needsDropbox({ links: {} }), false);
  // Every new mark passes the database's key rule (protocol_checks_item_key_check).
  const rule = /^(r[0-9]+\.)?p[0-9]+[ab]?\.[a-z0-9.]+$/;
  for (const k of ['p22.missing', 'p27.fixed', 'p16.brief', 'p17b.brollq', 'p18.shot', 'p18.quiet', 'r2.p22.missing']) assert.match(k, rule);
  // Production's own return, fix and receipt marks are gone: the office's keys and p27.toilai (v5) are the only ones.
  for (const k of ['qaReturnOf', 'fixedOf', 'fixedNote', 'firstReturnFrom']) assert.equal(P[k], undefined, k);
  for (const k of ['p25.return', 'p24.fixed', 'p27.ilai']) assert.equal(P.markHistory(k, { action: 'done', note: '{}' }), null, k);
});

test('the business sheet: phone and logo from the characterization, never the client\'s own phone', () => {
  const c = baseClient({ phone: '050-0000000', links: { logo: 'https://drive.google.com/logo' } });
  assert.deepEqual(P.sheetOf(c, null), { phone: '', logo: 'https://drive.google.com/logo', logoFile: null, hasLogo: true, closing: '' });
  // An uploaded logo file (client_files, kind 'logo') comes first; with neither, there is no logo.
  const file = { id: 'f1', storage_path: 'c1/logo/x-logo.png' };
  assert.deepEqual([P.sheetOf(baseClient(), null, file).logoFile, P.sheetOf(baseClient(), null, file).hasLogo, P.sheetOf(baseClient(), null, file).logo], [file, true, '']);
  assert.equal(P.sheetOf(baseClient(), null, null).hasLogo, false);
  assert.equal(P.sheetOf(baseClient(), null, { id: 'f2' }).hasLogo, false, 'a row without a path is no file');
  // The intake's form fields (app/characterization.js businessPhoneOf / logoUrlOf): fields.phone and fields.logo_url.
  const s = P.sheetOf(c, { fields: { phone: '03-5555555', logo_url: 'https://drive.google.com/l2' } });
  assert.equal(s.phone, '03-5555555');
  assert.equal(s.logo, 'https://drive.google.com/l2');
  assert.equal(s.closing, 'לפרטים נוספים התקשרו: 03-5555555');
  // Other names are not read (the form never writes them).
  assert.equal(P.sheetOf(baseClient(), { fields: { business_phone: '03-1', logo_link: 'https://x.test/l' } }).phone, '');
  assert.equal(P.sheetOf(baseClient(), { fields: { logo_url: 'javascript:alert(1)' } }).logo, '', 'only web links');
  assert.equal(P.sheetOf(baseClient({ links: { logo: 'javascript:alert(1)' } }), null).logo, '', 'only web links');
});

test('pause for someone else\'s urgent task: labelled "עצירה לבקשת", prefilled stage and what is left', () => {
  assert.equal(P.pauseText({ for: 'lior' }), 'עצירה לבקשת ליאור');
  assert.equal(P.pauseText({}), 'העריכה נעצרה');
  const note = JSON.parse(P.pauseNote({ stage: ' עריכה ', left: '3', for: 'ofir', task: 't1' }));
  assert.deepEqual(note, { stage: 'עריכה', left: '3', why: '', for: 'ofir', task: 't1' });
  const { c, checks } = postWorld({ editor: 'nirel', shoot_type: 'natali' });
  checks['p22a.assigned'] = done(IL(2026, 10, 18, 10));
  checks['p22.received'] = done(IL(2026, 10, 18, 11));
  const now = IL(2026, 10, 20, 10);
  const [job] = P.editingCases(c, checks, 'nirel', clientState(c, checks, now));
  const pre = P.pausePrefill(job, P.editorState(job, checks), now);
  assert.equal(pre.stage, 'בעריכה · יום 2 מתוך 3');
  assert.equal(pre.left, '4 סרטונים, אצל אופיר עד מחר 18:00');
});

test('first pass: the videos Ofir did not return the first time; on time: the editing steps met', () => {
  assert.deepEqual(P.firstPassOf([
    { videos: 10, approved: true, firstReturn: null },
    { videos: 10, approved: true, firstReturn: { videos: [{ n: 1 }, { n: 2 }] } },
    { videos: 5, approved: false, firstReturn: { videos: [] } }, // returned as a whole
    { videos: 8, approved: false, firstReturn: null }, // not decided yet: not counted
  ]), { videos: 25, first: 18, rate: 18 / 25 });
  // The first return is round 1 of the office's marks (p25.return.1), whatever came after.
  const checks = {
    [returnKey('', 'videos', 1)]: done(IL(2026, 10, 20, 10), returnNote([{ ref: '1', text: 'a' }, { ref: 'סרטון 2', text: 'b' }, { ref: '3', text: 'c' }, { ref: '3', text: 'd' }], null)),
    [returnKey('', 'videos', 2)]: done(IL(2026, 10, 21, 10), returnNote([{ ref: '1', text: 'a' }], null)),
    [returnKey('r2.', 'videos', 1)]: done(IL(2026, 10, 21, 10), returnNote([{ ref: '5', text: 'a' }], null)),
  };
  assert.deepEqual(P.firstReturnOf(checks, ''), { videos: [1, 2, 3] });
  assert.deepEqual(P.firstReturnOf(checks, 'r2.'), { videos: [5] });
  assert.equal(P.firstReturnOf({}, ''), null);
  const rows = [{ key: 'p22', people: ['nadia'], onTime: true }, { key: 'p24', people: ['nadia'], onTime: false }, { key: 'p23', people: ['ilai'], onTime: true }];
  assert.deepEqual(P.onTimeOf(rows, 'nadia'), { done: 2, onTime: 1, rate: 0.5 });
  assert.equal(P.percent(0.5), '50%');
  assert.equal(P.percent(null), '—');
});

// ── Nirel's briefs ─────────────────────────
test('a finished brief: done and a Drive link required; a follow-up for the requester; Ofir checks, Irit sends', () => {
  assert.deepEqual(Object.keys(P.briefResultErrors({ done: '', drive: '' })), ['done', 'drive']);
  assert.ok(P.briefResultErrors({ done: 'x', drive: 'drive.google.com/x' }).drive);
  assert.ok(P.briefResultErrors({ done: 'x', drive: 'https://x.test/?password=1' }).drive);
  assert.deepEqual(P.briefResultErrors({ done: 'x', drive: 'https://drive.google.com/x' }), {});
  const now = IL(2026, 10, 22, 12); // Thursday
  const task = { id: 't1', client_id: 'c1', owner: 'nirel', title: 'תיקון גרפיקה', created_by_email: 'irit@x' };
  const r = P.briefResult({ done: 'תוקן הצבע', left: 'עוד באנר', drive: 'https://drive.google.com/x', client: true }, now);
  const [follow, check] = P.briefFollowups(task, r, 'irit', now);
  assert.deepEqual([follow.owner, follow.due_on], ['irit', '2026-10-25']); // the next business day (Sunday)
  assert.match(follow.title, /^המשך אחרי ניראל: תיקון גרפיקה/);
  assert.equal(follow.brief.problem, 'נשאר: עוד באנר');
  assert.deepEqual([check.owner, check.brief.route, check.due_on], ['ofir', 'irit', '2026-10-22']);
  // Nothing left, not for the client: nothing opens. Asked by the owner (no person): Lior follows up.
  assert.deepEqual(P.briefFollowups(task, { ...r, left: '', client: false }, 'irit', now), []);
  assert.equal(P.briefFollowups(task, { ...r, client: false }, null, now)[0].owner, 'lior');
});

// ── Shoot day ─────────────────────────────
const shootClient = (o = {}) => baseClient({ editor: null, shoot_at: IL(2026, 10, 15, 11).toISOString(), ...o });

test('shoot timeline: Natali with the makeup two hours before and "an hour left"; DMS with its prompts', () => {
  const [n] = P.shootCases(shootClient({ shoot_type: 'natali' }));
  assert.deepEqual(P.timeline(n).map((x) => `${hhmm(x.at)} ${x.key}`), ['15.10 09:00 makeup', '15.10 10:00 eli', '15.10 11:00 influencers', '15.10 13:00 hourLeft', '15.10 14:00 end']);
  const [d] = P.shootCases(shootClient());
  assert.deepEqual(P.timeline(d).map((x) => `${hhmm(x.at)} ${x.key}`), ['15.10 10:00 eli', '15.10 11:00 influencers', '15.10 11:30 begin', '15.10 15:00 progress', '15.10 16:30 end']);
  assert.equal(hhmm(P.arrivalOf(d.shootAt)), '15.10 10:00');
  const nav = P.navLinks('הרצל 10, תל אביב');
  assert.equal(nav.waze, 'https://waze.com/ul?q=%D7%94%D7%A8%D7%A6%D7%9C%2010%2C%20%D7%AA%D7%9C%20%D7%90%D7%91%D7%99%D7%91&navigate=yes');
  assert.match(nav.maps, /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=/);
  assert.equal(P.navLinks(''), null);
  // The briefing: 17:00 the business day before; a Sunday shoot's on Thursday (decision 15).
  assert.equal(hhmm(P.briefingDay(IL(2026, 10, 15, 11))), '14.10 17:00');
  assert.equal(hhmm(P.briefingDay(IL(2026, 10, 18, 11))), '15.10 17:00');
});

test('shoot-day lock: the testimonial, the full quantity and the drive back, confirmed by both', () => {
  const c = {};
  let lock = P.closeLock(c, '', 3);
  assert.equal(lock.ok, false);
  assert.deepEqual(lock.missing, ['סרטון המלצה', 'עוד 3 סרטונים (צולמו 0 מתוך 3)', 'אלי עוד לא סימן שמסר את הכונן', 'לא אישרת שהכונן חזר אליך']);
  c['p18.shot'] = done(IL(2026, 10, 15, 12), P.shotNote([1, 2, 3]));
  c['p19.testimonial'] = done(IL(2026, 10, 15, 13));
  c['p19b.handed'] = done(IL(2026, 10, 15, 16));
  lock = P.closeLock(c, '', 3);
  assert.deepEqual(lock.missing, ['לא אישרת שהכונן חזר אליך']);
  assert.equal(P.handoffOf(c).done, false);
  c['p19.took'] = done(IL(2026, 10, 15, 16, 5));
  assert.equal(P.closeLock(c, '', 3).ok, true);
  assert.equal(hhmm(P.handoffOf(c).at), '15.10 16:05');
  // Not before the day starts (found live: a day closed 36 minutes before its start).
  const startAt = IL(2026, 10, 15, 11);
  const early = P.closeLock(c, '', 3, { startAt, now: IL(2026, 10, 15, 10, 24) });
  assert.deepEqual([early.ok, early.early, early.missing], [false, true, ['יום הצילום מתחיל ב־11:00']]);
  assert.equal(P.closeLock(c, '', 3, { startAt, now: startAt }).ok, true);
  assert.equal(P.shootStarted({ shootAt: startAt }, IL(2026, 10, 15, 10, 59)), false);
  assert.equal(P.shootStarted({ shootAt: startAt }, startAt), true);
  // What closing says: the editor is assigned by the server; one already in the card is kept.
  // Protocol v9: nothing is assigned by itself; Ofir is rung to assign.
  assert.equal(P.afterCloseText(c, '', { editor: null }), 'אופיר קיבל הודעה לשייך עורך.');
  assert.equal(P.afterCloseText(c, '', { editor: 'nadia' }), 'בכרטיס רשום נדיה כעורך. אופיר קיבל הודעה לשייך.');
  assert.equal(P.afterCloseText({ 'p22a.assigned': done(IL(2026, 10, 15, 17)) }, '', { editor: 'nadia' }), 'העריכה אצל נדיה.');
  // Without a number in the package: Lior's own check of the quantity.
  assert.deepEqual(P.closeLock(c, '', null).missing, ['סימון שכל הכמות צולמה']);
  // The counter: numbered, the next one, the words.
  assert.deepEqual(P.shotOf(c), [1, 2, 3]);
  assert.equal(P.nextVideo([1, 2, 3]), 4);
  assert.equal(P.counterText(3, 25), 'צולמו 3 מתוך 25');
  // Eli's finish list, then the handoff; and in a round, its own keys.
  assert.deepEqual(P.finishOpen({ 'p19b.folders': done(IL(2026, 10, 15, 16)) }), ['p19b.complete', 'p19b.opens', 'p19b.cards']);
  assert.equal(P.handoffOf({ 'r2.p19b.handed': done(IL(2026, 10, 15, 16)) }, 'r2.').eli !== null, true);
});

test('quiet mode: from Eli\'s "הגעתי" (or Lior\'s start) until the handoff confirmed by both; marks of another day do not count', () => {
  const [sc] = P.shootCases(shootClient());
  assert.equal(P.quietWindow(sc, {}), null);
  const c = { 'p17b.arrived': done(IL(2026, 10, 15, 9, 58)) };
  let w = P.quietWindow(sc, c);
  assert.deepEqual([hhmm(w.from), hhmm(w.to), w.by], ['15.10 09:58', '15.10 23:59', 'eli']);
  c['p19b.handed'] = done(IL(2026, 10, 15, 16));
  c['p19.took'] = done(IL(2026, 10, 15, 16, 10));
  w = P.quietWindow(sc, c);
  assert.equal(hhmm(w.to), '15.10 16:10');
  assert.equal(P.quietWindow(sc, { 'p17b.arrived': done(IL(2026, 10, 14, 10)) }), null);
  assert.equal(P.quietWindow(sc, { 'p17b.arrived': { ...done(IL(2026, 10, 15, 10)), note: IMPORT_NOTE } }), null);
  assert.equal(P.quietWindow(sc, { 'p18.quiet': done(IL(2026, 10, 15, 9, 30)) }).by, 'lior');
});

test('written notes only: imported history and whole-process marks are not Eli\'s notes or a drive label', () => {
  assert.equal(P.noteOf(done(IL(2026, 10, 15, 16), 'בסרטון 2 שתי גרסאות')), 'בסרטון 2 שתי גרסאות');
  for (const n of [IMPORT_NOTE, 'בסימון כל התהליך', null, '  ']) assert.equal(P.noteOf(done(IL(2026, 10, 15, 16), n)), '', String(n));
  assert.equal(P.noteOf({ state: 'na', note: 'x' }), '');
  assert.equal(P.noteOf(undefined), '');
  assert.equal(P.driveName('3'), 'כונן 3');
  assert.equal(P.driveName('כונן A'), 'כונן A');
});

test('history lines for the new marks', () => {
  assert.equal(P.markHistory('p22.missing', { action: 'done', note: P.missingNote(['logo']) }), 'דיווח/ה שחסר לעריכה: לוגו');
  assert.equal(P.markHistory('p16.brief', { action: 'done', note: P.briefNote('כונן 3') }), 'שלח/ה תדריך לאלי, כונן 3');
  assert.equal(P.markHistory('p17b.brollq', { action: 'done', note: 'no' }), 'ענה/תה שהבי־רול לא גמור');
  assert.equal(P.markHistory('p18.shot', { action: 'done', note: P.shotNote([1, 2]) }), 'מונה יום הצילום: צולמו 2');
  assert.equal(P.markHistory('p04.address', { action: 'done' }), null);
});

// ── The reminder ladders that follow the pages ──
const STAFF = [
  { email: 'owner@x', person: null }, { email: 'irit@x', person: 'irit' }, { email: 'lior@x', person: 'lior' },
  { email: 'ofir@x', person: 'ofir' }, { email: 'ilai@x', person: 'ilai' }, { email: 'nirel@x', person: 'nirel' },
  { email: 'nadia@x', person: 'nadia' }, { email: 'eli@x', person: 'eli' },
];
function world(o = {}) {
  const { c, checks } = postWorld(o);
  return { clients: [c], checks: { [c.id]: checks }, tasks: [], access: [], reviews: [], statusNotes: [], messages: [], subscriptions: [], staff: STAFF, c, cs: checks };
}
const due = (w, now) => computeReminders({ ...w, now, log: [] });
const pick = (list, rule, step) => list.filter((r) => r.rule === rule && (!step || r.step === step));
const one = (list, rule, step) => { const x = pick(list, rule, step); assert.equal(x.length, 1, `${rule}.${step}: ${JSON.stringify(list.map((r) => r.key))}`); return x[0]; };
const none = (list, rule, step) => assert.equal(pick(list, rule, step).length, 0, `${rule}.${step || ''} should not be due`);

test('missing logo / phone / footage: Irit at once, Lior after 3 office hours; the editing ladder waits; it ends with the wait', () => {
  const w = world();
  w.cs['p22a.assigned'] = done(IL(2026, 10, 18, 10));
  w.cs['p22.received'] = done(IL(2026, 10, 18, 10, 30));
  w.cs['p22.missing'] = done(IL(2026, 10, 18, 11), P.missingNote(['logo'], 'לא נפתח'));
  w.cs['p22.wait'] = done(IL(2026, 10, 18, 11), JSON.stringify({ reason: P.blockedReason(['logo']) }));
  const at = one(due(w, IL(2026, 10, 18, 11)), 'editorMissing', 'irit');
  assert.equal(at.level, 'ring');
  assert.match(at.body, /^נדיה: חסר לוגו \(לא נפתח\)\. העריכה חסומה/);
  none(due(w, IL(2026, 10, 18, 13, 59)), 'editorMissing', 'lior');
  const lior = one(due(w, IL(2026, 10, 18, 14)), 'editorMissing', 'lior');
  assert.equal(lior.exception, true); // on his shoot day it goes to Ofir (decision 8)
  none(due(w, IL(2026, 10, 18, 14)), 'editing'); // "not started" and the day digests wait while blocked
  delete w.cs['p22.wait'];
  none(due(w, IL(2026, 10, 18, 14)), 'editorMissing');
});

test('QA return (the office\'s rule, one per event): the editor at once on their page; the QA clock stops; fixed starts a new one; the owner from round 2', () => {
  const w = world();
  w.cs['p22a.assigned'] = done(IL(2026, 10, 18, 10));
  w.cs['p24.notify'] = done(IL(2026, 10, 20, 11));
  one(due(w, IL(2026, 10, 20, 11)), 'qa', 'now');
  w.cs[returnKey('', 'videos', 1)] = done(IL(2026, 10, 20, 11, 20), returnNote([{ ref: '3', text: 'x' }], IL(2026, 10, 20, 15)));
  const list = due(w, IL(2026, 10, 20, 11, 20));
  // Exactly one ring for the return (no second rule rings the same event).
  assert.deepEqual(list.filter((r) => r.person === 'nadia' && r.level === 'ring').map((r) => `${r.rule}.${r.step}`), ['qaReturn.now']);
  const r = one(list, 'qaReturn', 'now');
  assert.equal(r.url, 'editor.html#c-c1');
  assert.match(r.body, /^סרטונים: בעיה אחת מאופיר\. לתקן עד היום 15:00\.$/);
  none(due(w, IL(2026, 10, 20, 11, 40)), 'qa', 'again'); // Ofir's clock stopped: the videos are with the editor
  none(due(w, IL(2026, 10, 20, 12)), 'qaReturn', 'board');
  assert.equal(one(due(w, IL(2026, 10, 20, 15)), 'qaReturn', 'late').list, true);
  // Fixed (the office's "סמן הכול תוקן"): back to Ofir, a new check with its own key.
  w.cs[fixedItemKey('', 'videos', 1, 0)] = done(IL(2026, 10, 20, 14));
  w.cs[fixedKey('', 'videos', 1)] = done(IL(2026, 10, 20, 14));
  none(due(w, IL(2026, 10, 20, 15)), 'qaReturn');
  const again = one(due(w, IL(2026, 10, 20, 14)), 'qa', 'now');
  assert.match(again.title, /^התיקונים מוכנים לבדיקה \(סבב 1\)/);
  assert.equal(again.key, `qa:c1:p25@${IL(2026, 10, 20, 14).toISOString()}:now@ofir`, 'the new check has its own key (it rings once)');
  w.cs[returnKey('', 'videos', 2)] = done(IL(2026, 10, 20, 14, 30), returnNote([{ ref: '3', text: 'y' }], null));
  one(due(w, IL(2026, 10, 20, 14, 30)), 'qaReturn', 'board');
  // Marked ready again from the editor's page (p24.notify) after the return: fixed too.
  w.cs['p24.notify'] = done(IL(2026, 10, 20, 15));
  none(due(w, IL(2026, 10, 20, 15)), 'qaReturn');
  one(due(w, IL(2026, 10, 20, 15)), 'qa', 'now');
});

test('client notes ring the editor; the final versions (p27.final) reach Ilai quietly, once; Lior\'s list at the end of that business day', () => {
  const w = world();
  w.cs['p22a.assigned'] = done(IL(2026, 10, 18, 10));
  w.cs['p25.approved'] = done(IL(2026, 10, 20, 12));
  w.cs['p26.sent'] = done(IL(2026, 10, 20, 12, 10));
  w.cs['p27.notes'] = done(IL(2026, 10, 21, 10), JSON.stringify({ videos: [{ n: 1, text: 'שיר' }] }));
  const n = one(due(w, IL(2026, 10, 21, 10)), 'clientFixes', 'editor');
  assert.deepEqual([n.person, n.level], ['nadia', 'ring']);
  w.cs['p27.fixes'] = done(IL(2026, 10, 21, 16));
  none(due(w, IL(2026, 10, 21, 16)), 'clientFixes');
  w.cs['p27.final'] = done(IL(2026, 10, 21, 16, 30));
  const list = due(w, IL(2026, 10, 21, 16, 30));
  assert.deepEqual(list.filter((r) => /סופיות/.test(r.title)).map((r) => `${r.rule}.${r.step}`), ['finalReady.ilai']);
  assert.equal(RULES.filter((r) => r.id === 'finals').length, 0, 'one rule for the final versions');
  const fin = one(list, 'finalReady', 'ilai');
  assert.deepEqual([fin.level, fin.url], ['quiet', 'client.html?id=c1#p27']); // his item p27.toilai
  none(due(w, IL(2026, 10, 21, 17, 59)), 'finalReady', 'lior');
  assert.equal(hhmm(one(due(w, IL(2026, 10, 21, 18)), 'finalReady', 'lior').at), '21.10 18:00');
  // After hours: the end of the next office day.
  w.cs['p27.final'] = done(IL(2026, 10, 21, 19));
  none(due(w, IL(2026, 10, 21, 20)), 'finalReady', 'lior');
  assert.equal(hhmm(one(due(w, IL(2026, 10, 22, 18)), 'finalReady', 'lior').at), '22.10 18:00');
  // Ilai's "קיבלתי" is p27.toilai (protocol v5).
  w.cs['p27.toilai'] = done(IL(2026, 10, 22, 9));
  none(due(w, IL(2026, 10, 22, 18)), 'finalReady');
});

test('shoot day: "הבי־רול לא גמור" rings Lior at once (a shoot event); "cards" names the drive label; no B-roll question once answered', () => {
  const w = world({ editor: null, shoot_at: IL(2026, 10, 15, 11).toISOString() });
  for (const k of importKeys('shoot')) w.cs[k] = { state: 'done', at: IL(2026, 9, 1).toISOString(), note: IMPORT_NOTE };
  for (const id of ['p16', 'p17', 'p17b', 'p18', 'p18b', 'p19', 'p19b']) for (const i of PROCESSES.find((p) => p.id === id).items) delete w.cs[i.key];
  w.cs['p17b.brollq'] = done(IL(2026, 10, 15, 10, 45), 'no');
  const r = one(due(w, IL(2026, 10, 15, 10, 45)), 'broll', 'lior');
  assert.deepEqual([r.person, r.shoot, r.exempt, r.url], ['lior', true, 'shoot', 'shoot.html?id=c1']);
  none(due(w, IL(2026, 10, 15, 10, 45)), 'shoot', 'eli15');
  w.cs['p16.brief'] = done(IL(2026, 10, 14, 16), P.briefNote('כונן 7'));
  for (const i of PROCESSES.find((p) => p.id === 'p19b').items) if (!i.optional) w.cs[i.key] = done(IL(2026, 10, 15, 16));
  w.cs['p19.took'] = done(IL(2026, 10, 15, 16, 5));
  assert.equal(one(due(w, IL(2026, 10, 15, 16, 5)), 'cards', 'eli').title, 'אפשר לפרמט את הכרטיסים של מספרת רון, כונן 7');
});

test('a paused edit for someone else\'s urgent task says so; a finished brief reaches whoever asked (a ring only when urgent)', () => {
  const w = world({ editor: 'nirel', shoot_type: 'natali' });
  w.cs['p22a.assigned'] = done(IL(2026, 10, 18, 10));
  w.cs['p22.received'] = done(IL(2026, 10, 18, 11));
  w.cs['p22.pause'] = done(IL(2026, 10, 19, 10), P.pauseNote({ stage: 'עריכה', left: '2', for: 'lior', task: 't1' }));
  assert.equal(one(due(w, IL(2026, 10, 19, 10)), 'paused', 'ofir').title, 'עצירה לבקשת ליאור: מספרת רון · ניראל');
  const result = P.briefResult({ done: 'הבאנר מוכן', left: '', drive: 'https://drive.google.com/x' }, IL(2026, 10, 19, 12));
  w.tasks.push({ id: 't1', client_id: 'c1', title: 'באנר', owner: 'nirel', urgent: true, created_by_email: 'lior@x', created_at: IL(2026, 10, 19, 9).toISOString(), done_at: IL(2026, 10, 19, 12).toISOString(), result });
  w.tasks.push({ id: 't2', client_id: 'c1', title: 'לוגו', owner: 'nirel', urgent: false, created_by_email: 'irit@x', created_at: IL(2026, 10, 19, 9).toISOString(), done_at: IL(2026, 10, 19, 12).toISOString(), result: { ...result, left: 'גרסה לבנה', client: true } });
  w.tasks.push({ id: 't3', client_id: 'c1', title: 'בלי תוצאה', owner: 'nirel', created_by_email: 'irit@x', created_at: IL(2026, 10, 19, 9).toISOString(), done_at: IL(2026, 10, 19, 12).toISOString() });
  const list = due(w, IL(2026, 10, 19, 12));
  const ring = one(list, 'briefDone', 'ring');
  assert.deepEqual([ring.person, ring.exempt], ['lior', 'urgent']);
  assert.equal(ring.title, 'ניראל סיים/ה: מספרת רון · באנר');
  const quiet = one(list, 'briefDone', 'quiet');
  assert.equal(quiet.person, 'irit');
  assert.equal(quiet.body, 'בוצע: הבאנר מוכן · נשאר: גרסה לבנה (נפתחה משימת המשך) · אופיר בודק, ואז עירית שולחת ללקוח');
  // Done tasks never count as open work.
  assert.equal(buildEnv({ ...w, now: IL(2026, 10, 19, 12) }).tasks.length, 0);
});
