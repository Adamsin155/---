// A shoot day without influencers (the owner's decision of 25.10.2026): Lior and one
// photographer, Eli or Eliel (who has no account). What the choice means (app/protocol.js,
// app/protocol-logic.js), how the forms write it (app/shoot-crew.js), the shoot card's own
// number and the closing lock (app/production.js), Irit's coordinator and day-before check
// (app/shoot-prep.js), the calendars and the invitations (app/calendar-feed.js,
// app/calendar-view.js), the reminders (app/reminder-rules.js), the client's message the day
// before (app/messages-logic.js) and Eli's taken days (app/availability-logic.js).
// Nothing changes for a day with influencers. Israel times; npm test runs this under 3 zones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROCESSES, PHASES, PHOTOGRAPHERS, crewOf, isSolo, eliFilms, photographerOf, shootTypeName, hasShootType } from '../app/protocol.js';
import { applicableProcesses, clientState, missingFields, blockers, roundContext, IMPORT_NOTE } from '../app/protocol-logic.js';
import * as P from '../app/production.js';
import { soloOf, isChoice, choiceOf, crewPatch, roundWithCrew, timeLabel, crewOptions, CREW_GROUPS } from '../app/shoot-crew.js';
import { coordinatorOf, shootContexts, dayBefore } from '../app/shoot-prep.js';
import { feedEvents, shootMinutes, shootStart } from '../app/calendar-feed.js';
import { inviteFor, wordsOf } from '../app/calendar-view.js';
import { computeReminders } from '../app/reminder-engine.js';
import { importKeys } from '../app/client-open.js';
import { suggestFor, messageText, templatesByKey, protocolCheckOf, crewText, unfilledIn } from '../app/messages-logic.js';
import { takenFrom } from '../app/availability-logic.js';
import * as A from '../app/availability-logic.js';
import { flowLines } from '../app/mine-flow.js';
import { dateIL } from '../app/tz.js';

const IL = (y, m, d, h = 0, mi = 0) => dateIL(y, m, d, h, mi);
const done = (at, note = null) => ({ state: 'done', at: at.toISOString(), note, by_email: 'x@x' });
// Thursday 15.10.2026, 11:00 in Israel: the shoot.
const SHOOT = IL(2026, 10, 15, 11);
const base = (o = {}) => ({
  id: 'c1', name: 'מספרת רון', business: 'מספרת רון', status: 'active', shoot_type: 'dms', characterizer: 'ofir', has_logo: true, editor: null,
  rounds: [], deliverables: { videos: 4, shoot_days: 1 }, links: {}, address: 'הרצל 1, תל אביב', deal_at: IL(2026, 9, 1).toISOString(),
  char_at: IL(2026, 10, 5, 10).toISOString(), shoot_at: SHOOT.toISOString(), contract_end: '2027-12-31', ...o,
});
const withInf = base();
const soloEli = base({ shoot_type: null, deliverables: { videos: 4, shoot_days: 1, shoot_crew: 'eli' } });
const soloEliel = base({ shoot_type: null, deliverables: { videos: 4, shoot_days: 1, shoot_crew: 'eliel' } });
const keysOf = (c) => new Set(applicableProcesses(c).flatMap((p) => p.items.map((i) => i.key)));
const idsOf = (c) => new Set(applicableProcesses(c).map((p) => p.id));
const itemOf = (c, key) => applicableProcesses(c).flatMap((p) => p.items).find((i) => i.key === key);
const INFLUENCER_ONLY = ['p11.influencers', 'p11.ok.influencers', 'p15.influencers', 'p16.early', 'p17.broll', 'p17b.broll'];

// ── What the choice means ─────────────────
test('the crew: a solo shoot has a photographer and no shoot type; a shoot type always wins', () => {
  assert.deepEqual(Object.keys(PHOTOGRAPHERS), ['eli', 'eliel']);
  assert.equal(crewOf(withInf), null);
  assert.equal(crewOf(soloEli), 'eli');
  assert.equal(crewOf(soloEliel), 'eliel');
  assert.equal(crewOf(base({ shoot_type: 'natali', deliverables: { shoot_crew: 'eliel' } })), null, 'a stale crew under a type');
  assert.equal(crewOf(base({ shoot_type: null, deliverables: { shoot_crew: 'nadia' } })), null, 'not a photographer');
  assert.deepEqual([isSolo(soloEliel), eliFilms(soloEliel), eliFilms(soloEli), eliFilms(withInf)], [true, false, true, true]);
  assert.deepEqual([photographerOf(withInf), photographerOf(soloEliel)], ['eli', 'eliel']);
  assert.equal(shootTypeName(soloEliel), 'בלי משפיענים · ליאור + אליאל');
  assert.equal(shootTypeName(soloEli), 'בלי משפיענים · ליאור + אלי');
  assert.equal(shootTypeName(withInf), 'דניס, מישל וסמיון');
  assert.equal(shootTypeName(base({ shoot_type: null })), '');
  assert.deepEqual([hasShootType(soloEliel), hasShootType(base({ shoot_type: null }))], [true, false]);
});

test('a day without influencers: the influencers\' items do not apply, and nothing else changes', () => {
  const inf = keysOf(withInf);
  const eli = keysOf(soloEli);
  for (const k of INFLUENCER_ONLY) assert.ok(inf.has(k), `${k} on a day with influencers`);
  // (21 is the Denis, Michel and Semion day's own management.)
  assert.deepEqual([...inf].filter((k) => !eli.has(k) && !k.startsWith('p21.')).sort(), [...INFLUENCER_ONLY].sort());
  assert.deepEqual([...eli].filter((k) => !inf.has(k)), []);
  // Eli films: his processes are there; Eliel films: they are not, and nothing else goes.
  for (const id of ['p17b', 'p18b', 'p19b']) assert.ok(idsOf(soloEli).has(id) && idsOf(withInf).has(id), id);
  const eliel = keysOf(soloEliel);
  for (const id of ['p17b', 'p18b', 'p19b']) assert.ok(!idsOf(soloEliel).has(id), id);
  assert.deepEqual([...eli].filter((k) => !eliel.has(k)).every((k) => /^p1[789]b\./.test(k)), true);
  // Natali's own processes stay hers (11ב, 20).
  assert.ok(idsOf(base({ shoot_type: 'natali' })).has('p11b'));
  assert.ok(!idsOf(soloEliel).has('p11b') && !idsOf(soloEliel).has('p20') && !idsOf(soloEliel).has('p21'));
});

test('the testimonial is not required on a day without influencers; the words follow the day', () => {
  assert.ok(!itemOf(withInf, 'p19.testimonial').optional);
  assert.match(itemOf(withInf, 'p19.testimonial').label, /עם המשפיענים \(חובה\)/);
  assert.equal(itemOf(soloEli, 'p19.testimonial').optional, true);
  assert.match(itemOf(soloEli, 'p19.testimonial').label, /לא חובה/);
  assert.equal(itemOf(soloEli, 'p17b.arrived').label, 'הגעתי בשעת הצילום');
  assert.equal(itemOf(soloEliel, 'p11.ok.photographer').label, 'הצלם (אליאל) אישר');
  assert.match(itemOf(soloEliel, 'p19.took').label, /אליאל/);
  assert.equal(itemOf(withInf, 'p19.took').label, 'הכונן חזר לליאור מהצלם');
  // The raw protocol (the history's labels, the writers' table) is the same item.
  const raw = PROCESSES.find((p) => p.id === 'p19').items.find((i) => i.key === 'p19.testimonial');
  assert.ok(!raw.optional);
  assert.equal(itemOf(soloEli, 'p19.testimonial').owners.join(), 'lior');
});

test('"with whom" is answered by the crew: the shoot phases and the calendar item are not held for a type', () => {
  const eve = PHASES.find((p) => p.key === 'eve');
  assert.deepEqual(missingFields(eve, soloEliel), []);
  assert.deepEqual(missingFields(eve, base({ shoot_type: null })), ['shoot_type']);
  const cal = itemOf(soloEliel, 'p11.calendar');
  assert.equal(blockers(cal, soloEliel, {}), null);
  assert.deepEqual(blockers(cal, base({ shoot_type: null, shoot_at: null }), {}).fields, ['shoot_type', 'shoot_at']);
});

test('rounds: a round without influencers keeps its own crew; a round with a type is that type; the client\'s crew never leaks into a round', () => {
  const c = base({
    shoot_type: 'natali',
    rounds: [
      { n: 2, shoot_type: null, shoot_crew: 'eliel', shoot_at: IL(2026, 11, 12, 10).toISOString(), start_at: IL(2026, 11, 1).toISOString() },
      { n: 3, shoot_type: 'dms', shoot_crew: 'eliel', shoot_at: IL(2026, 12, 10, 10).toISOString(), start_at: IL(2026, 12, 1).toISOString() },
    ],
  });
  const r2 = roundContext(c, c.rounds[0]);
  const r3 = roundContext(c, c.rounds[1]);
  assert.deepEqual([r2.shoot_type, crewOf(r2)], [null, 'eliel']);
  assert.deepEqual([r3.shoot_type, crewOf(r3)], ['dms', null]);
  const ids = idsOf(c);
  assert.ok(ids.has('p11b') && ids.has('p17b'), 'the client\'s own Natali day');
  assert.ok(!ids.has('r2-p17b') && !ids.has('r2-p11b') && ids.has('r3-p17b'));
  const keys = keysOf(c);
  assert.ok(!keys.has('r2.p11.ok.influencers') && keys.has('r3.p11.ok.influencers') && keys.has('p11.ok.influencers'));
  // A client whose own shoot has no influencers: an old round with no type of its own takes the client's (none) and asks.
  const s = base({ shoot_type: null, deliverables: { shoot_crew: 'eliel' }, rounds: [{ n: 2, shoot_at: null, start_at: IL(2026, 11, 1).toISOString() }] });
  const old = roundContext(s, s.rounds[0]);
  assert.deepEqual([old.shoot_type, crewOf(old), hasShootType(old)], [null, null, false]);
});

test('closing a day without influencers: Lior\'s items and the drive; no testimonial', () => {
  const now = IL(2026, 10, 15, 15);
  const marks = { 'p18.order': done(now), 'p18.all': done(now), 'p19.all': done(now), 'p19.drive': done(now), 'p19.took': done(now) };
  const p19 = (c, checks) => clientState(c, checks, now).states.find((s) => s.proc.id === 'p19');
  assert.equal(p19(soloEliel, marks).complete, true);
  assert.equal(p19(soloEli, marks).complete, true);
  assert.equal(p19(withInf, marks).complete, false, 'with influencers the testimonial is required');
  assert.equal(p19(withInf, { ...marks, 'p19.testimonial': done(now) }).complete, true);
});

// ── The forms ─────────────────────────────
test('the forms\' choice: values, the client\'s fields, a round\'s entry and the time\'s words', () => {
  // Niro and "הצל" beside Natali since 28.10.2026.
  assert.deepEqual(CREW_GROUPS.map((g) => g.options.map(([v]) => v)), [['natali', 'niro', 'hatzel', 'dms'], ['solo:eli', 'solo:eliel']]);
  assert.deepEqual([soloOf('solo:eliel'), soloOf('solo:eli'), soloOf('solo:nadia'), soloOf('natali'), soloOf(null)], ['eliel', 'eli', null, null, null]);
  assert.deepEqual(['natali', 'dms', 'solo:eli', 'solo:eliel', '', 'solo:', 'x'].map(isChoice), [true, true, true, true, false, false, false]);
  assert.deepEqual([choiceOf(withInf), choiceOf(soloEliel), choiceOf(base({ shoot_type: null })), choiceOf({ shoot_crew: 'eli' })], ['dms', 'solo:eliel', '', 'solo:eli']);
  // The client's own shoot: the type, or the crew kept with the package (its counts untouched).
  assert.deepEqual(crewPatch(withInf, 'solo:eliel'), { shoot_type: null, deliverables: { videos: 4, shoot_days: 1, shoot_crew: 'eliel' } });
  assert.deepEqual(crewPatch(soloEliel, 'natali'), { shoot_type: 'natali', deliverables: { videos: 4, shoot_days: 1 } });
  assert.deepEqual(crewPatch(withInf, 'natali'), { shoot_type: 'natali' }, 'no crew to take away: only the type');
  assert.deepEqual(crewPatch({ deliverables: null }, 'solo:eli'), { shoot_type: null, deliverables: { shoot_crew: 'eli' } });
  assert.deepEqual(crewPatch(withInf, ''), {});
  // A round's entry.
  assert.deepEqual(roundWithCrew({ n: 2, shoot_type: 'dms', shoot_at: 'x' }, 'solo:eliel'), { n: 2, shoot_type: null, shoot_at: 'x', shoot_crew: 'eliel' });
  assert.deepEqual(roundWithCrew({ n: 2, shoot_type: null, shoot_crew: 'eliel' }, 'natali'), { n: 2, shoot_type: 'natali' });
  assert.deepEqual(roundWithCrew({ n: 2, shoot_type: 'dms' }, ''), { n: 2, shoot_type: 'dms' });
  assert.deepEqual([timeLabel('solo:eli'), timeLabel('natali'), timeLabel('solo:eliel', { long: true }), timeLabel('', { long: true })],
    ['שעת הצילום', 'הגעת המשפיענים', 'מועד הצילום', 'מועד הגעת המשפיענים']);
  const h = (tag, attrs, ...kids) => ({ tag, attrs, kids: kids.flat() });
  const opts = crewOptions(h, 'solo:eliel', { empty: 'לבחור' });
  assert.deepEqual(opts.map((o) => o.tag), ['option', 'optgroup', 'optgroup']);
  assert.deepEqual(opts[2].attrs.label, 'בלי משפיענים: ליאור + צלם');
  assert.deepEqual(opts[2].kids.map((o) => [o.attrs.value, o.attrs.selected, o.kids[0]]), [['solo:eli', false, 'ליאור + אלי'], ['solo:eliel', true, 'ליאור + אליאל']]);
});

// ── The shoot card ────────────────────────
const caseOf = (c) => P.shootCases(c)[0];
test('shoot cases: who films, the arrival and the timeline of a day without influencers', () => {
  assert.deepEqual([caseOf(withInf).solo, caseOf(withInf).crew, caseOf(withInf).eli], [false, 'eli', true]);
  assert.deepEqual([caseOf(soloEliel).solo, caseOf(soloEliel).crew, caseOf(soloEliel).eli], [true, 'eliel', false]);
  assert.equal(P.photographerName(caseOf(soloEliel)), 'אליאל');
  assert.equal(+P.arrivalOf(SHOOT, true), +SHOOT, 'the shoot\'s own time');
  assert.equal(+P.arrivalOf(SHOOT), +IL(2026, 10, 15, 10), 'an hour before the influencers');
  assert.equal(P.windowMinutes(false, true), 180);
  const tl = P.timeline(caseOf(soloEliel));
  assert.deepEqual(tl.map((x) => [x.key, P.clockText(x.at)]), [['start', '11:00'], ['end', '14:00']]);
  assert.match(tl[0].label, /ליאור \+ אליאל מגיעים/);
  assert.ok(!P.timeline(caseOf(soloEli)).some((x) => /משפיענים|נטלי/.test(x.label)));
  assert.ok(P.timeline(caseOf(withInf)).some((x) => x.key === 'influencers'));
});

test('"כמה סרטונים מצלמים היום": Lior\'s number, its checks, and what the day counts to', () => {
  assert.equal(P.COUNT_KEY, 'p18.count');
  assert.equal(P.dayCountOf({}, ''), null);
  assert.equal(P.dayCountOf({ 'p18.count': done(SHOOT, P.dayCountNote(6)) }), 6);
  assert.equal(P.dayCountOf({ 'r2.p18.count': done(SHOOT, P.dayCountNote(3)) }, 'r2.'), 3);
  assert.equal(P.dayCountOf({ 'p18.count': done(SHOOT, '{"videos":0}') }), null);
  assert.equal(P.dayCountOf({ 'p18.count': { state: 'na', note: P.dayCountNote(6) } }), null);
  assert.deepEqual(['5', ' 12 ', '', 'a', '0', '100', '1.5', '٣'].map(P.dayCountProblem),
    [null, null, 'כמה סרטונים? מספר.', 'רק ספרות.', 'מספר בין 1 ל־99.', 'מספר בין 1 ל־99.', 'רק ספרות.', 'רק ספרות.']);
  // A day with influencers counts to the package's share; a day without them to Lior's number only.
  assert.equal(P.dayTarget(caseOf(withInf), {}), 4);
  assert.equal(P.dayTarget(caseOf(soloEliel), {}), null);
  assert.equal(P.dayTarget(caseOf(soloEliel), { 'p18.count': done(SHOOT, P.dayCountNote(6)) }), 6);
  assert.equal(P.markHistory('p18.count', { action: 'done', note: P.dayCountNote(6) }), 'קבע/ה שמצלמים היום 6 סרטונים');
});

test('the lock of a day without influencers, Eli films: the number first, no testimonial, the drive by both', () => {
  const sc = caseOf(soloEli);
  const after = IL(2026, 10, 15, 14);
  const lockOf = (c) => P.caseLock(sc, c, after);
  let c = {};
  assert.deepEqual(lockOf(c).missing, ['כמה סרטונים מצלמים היום', 'אלי עוד לא סימן שמסר את הכונן', 'לא אישרת שהכונן חזר אליך']);
  c['p18.count'] = done(IL(2026, 10, 15, 10), P.dayCountNote(3));
  c['p18.shot'] = done(IL(2026, 10, 15, 13), P.shotNote([1, 2]));
  assert.deepEqual(lockOf(c).missing[0], 'עוד 1 סרטונים (צולמו 2 מתוך 3)');
  c['p18.shot'] = done(IL(2026, 10, 15, 13), P.shotNote([1, 2, 3]));
  c['p19b.handed'] = done(IL(2026, 10, 15, 13, 30));
  c['p19.took'] = done(IL(2026, 10, 15, 13, 35));
  assert.equal(lockOf(c).ok, true);
  // Before the shoot's own time it stays closed.
  assert.equal(P.caseLock(sc, c, IL(2026, 10, 15, 10, 59)).ok, false);
  // The same marks on a day with influencers still ask for the testimonial.
  assert.deepEqual(P.closeLock(c, '', 3, { startAt: SHOOT, now: after }).missing, ['סרטון המלצה']);
});

test('the lock of a day Eliel films: Lior\'s "הכונן אצלי" alone is the drive', () => {
  const sc = caseOf(soloEliel);
  const after = IL(2026, 10, 15, 14);
  const c = { 'p18.count': done(IL(2026, 10, 15, 9), P.dayCountNote(2)), 'p18.shot': done(IL(2026, 10, 15, 13), P.shotNote([1, 2])) };
  assert.deepEqual(P.caseLock(sc, c, after).missing, ['לא סימנת שהכונן אצלך']);
  c['p19.took'] = done(IL(2026, 10, 15, 13, 40));
  assert.equal(P.caseLock(sc, c, after).ok, true);
  assert.deepEqual(P.handoffOf(c, '', { eli: false }), { eli: null, lior: new Date(c['p19.took'].at), done: true, at: new Date(c['p19.took'].at), solo: true });
  assert.equal(P.handoffOf(c, '').done, false, 'Eli\'s handoff when he films');
  // Quiet mode, started by Lior, ends with his "הכונן אצלי".
  c['p18.quiet'] = done(IL(2026, 10, 15, 11));
  const q = P.quietWindow(sc, c);
  assert.deepEqual([P.clockText(q.from), P.clockText(q.to), q.by], ['11:00', '13:40', 'lior']);
});

// ── Irit's coordinator and day-before check ──
test('the coordinator of a day without influencers: no influencers, the day\'s photographer', () => {
  const x = shootContexts(soloEliel)[0];
  const k = coordinatorOf(soloEliel, {}, x);
  assert.deepEqual(k.approvals.map((a) => a.key), ['p11.ok.client', 'p11.ok.lior', 'p11.ok.photographer']);
  assert.deepEqual(k.approvals.at(-1).label, 'אליאל הצלם');
  assert.equal(k.contract, null);
  assert.deepEqual(k.needs, []);
  assert.deepEqual(k.missing, ['אישור לקוח', 'אישור ליאור', 'אישור אליאל', 'הכנסה ליומן']);
  assert.deepEqual([k.solo, k.crew, k.typeSet, k.typeName], [true, 'eliel', true, 'בלי משפיענים · ליאור + אליאל']);
  const all = Object.fromEntries(['p11.ok.client', 'p11.ok.lior', 'p11.ok.photographer', 'p11.calendar'].map((key) => [key, done(IL(2026, 10, 7))]));
  assert.equal(coordinatorOf(soloEliel, all, x).fullyClosed, true);
  // With influencers, as before: four approvals and the contract.
  const w = coordinatorOf(withInf, all, shootContexts(withInf)[0]);
  assert.deepEqual(w.missing, ['אישור משפיענים', 'בדיקת המשפיענים בחוזה']);
  assert.equal(w.approvals.at(-1).label, 'אלי הצלם');
});

test('the day-before check of a day without influencers has no influencers to remind', () => {
  const now = IL(2026, 10, 14, 11, 15);
  const ids = (c) => dayBefore(c, {}, null, shootContexts(c)[0], now).items.map((i) => i.id);
  assert.ok(ids(withInf).includes('influencers'));
  assert.ok(!ids(soloEliel).includes('influencers'));
  assert.deepEqual(ids(withInf).filter((i) => i !== 'influencers'), ids(soloEliel));
});

// ── Calendars and invitations ─────────────
test('the calendars: at the shoot\'s own time, named for who goes; not in Eli\'s calendar when Eliel films', () => {
  const now = IL(2026, 10, 10, 10);
  const range = { from: IL(2026, 10, 1), until: IL(2026, 10, 31) };
  const shootOf = (person, c) => feedEvents({ person, clients: [c], now, range }).filter((e) => e.kind === 'shoot');
  assert.equal(shootOf('eli', soloEliel).length, 0);
  const [lior] = shootOf('lior', soloEliel);
  assert.equal(lior.title, 'יום צילום · מספרת רון · בלי משפיענים · ליאור + אליאל');
  assert.equal(+new Date(lior.start), +SHOOT);
  assert.equal(lior.minutes, 180);
  assert.equal(lior.crew, 'eliel');
  assert.match(lior.description, /^שעת הצילום: 11:00\. בלי משפיענים: ליאור \+ אליאל\./);
  const [eli] = shootOf('eli', soloEli);
  assert.match(eli.description, /^ההגעה שלך: 11:00, שעת הצילום\. בלי משפיענים: ליאור ואתה\./);
  assert.equal(+new Date(eli.start), +SHOOT);
  // A day with influencers, as before: the team an hour before.
  const [inf] = shootOf('eli', withInf);
  assert.equal(+new Date(inf.start), +IL(2026, 10, 15, 10));
  assert.equal(inf.crew, undefined);
  assert.deepEqual([shootMinutes('dms'), shootMinutes('natali'), shootMinutes('dms', true)], [390, 240, 180]);
  assert.deepEqual([+shootStart(SHOOT), +shootStart(SHOOT, true)], [+IL(2026, 10, 15, 10), +SHOOT]);
  assert.equal(wordsOf(lior, soloEliel).sub, '11:00 עד 14:00 · בלי משפיענים · ליאור + אליאל');
});

test('"שליחת זימון": Lior alone when Eliel films; Lior and Eli when Eli does; the words of the day', () => {
  const emails = { lior: 'lior@x.test', eli: 'eli@x.test' };
  const inv = (c, crew) => inviteFor({ kind: 'shoot', start: shootStart(SHOOT, !!crew), shootType: c.shoot_type, ...(crew ? { crew } : {}) }, { client: c, emails, site: 'https://app/' });
  const a = inv(soloEliel, 'eliel');
  assert.deepEqual([a.people, a.guests], [['lior'], ['lior@x.test']]);
  const q = new URL(a.url).searchParams;
  assert.match(q.get('details'), /^שעת הצילום: 11:00\. בלי משפיענים · ליאור \+ אליאל\./);
  assert.ok(q.get('dates').startsWith('20261015T080000Z/20261015T110000Z'));
  assert.deepEqual(inv(soloEli, 'eli').people, ['lior', 'eli']);
  assert.deepEqual(inv(withInf, null).people, ['lior', 'eli']);
  assert.match(new URL(inv(withInf, null).url).searchParams.get('details'), /^הגעת המשפיענים: 11:00\. הצוות מגיע שעה לפני\./);
});

// ── The reminders ─────────────────────────
const STAFF = [
  { email: 'owner@x', person: null }, { email: 'irit@x', person: 'irit' }, { email: 'lior@x', person: 'lior' },
  { email: 'ofir@x', person: 'ofir' }, { email: 'ilai@x', person: 'ilai' }, { email: 'nadia@x', person: 'nadia' }, { email: 'eli@x', person: 'eli' },
];
function world(c, extra = {}) {
  const checks = {};
  for (const k of importKeys('shoot')) checks[k] = { state: 'done', at: IL(2026, 9, 1).toISOString(), note: IMPORT_NOTE };
  return { clients: [c], checks: { [c.id]: checks }, tasks: [], access: [], reviews: [], statusNotes: [], messages: [], subscriptions: [], staff: STAFF, cs: checks, ...extra };
}
const due = (w, now) => computeReminders({ ...w, now, log: [] });
const pick = (list, rule, step) => list.filter((r) => r.rule === rule && (!step || r.step === step));
const one = (list, rule, step) => { const x = pick(list, rule, step); assert.equal(x.length, 1, `${rule}.${step}: ${JSON.stringify(list.map((r) => r.key))}`); return x[0]; };
const none = (list, rule, step) => assert.equal(pick(list, rule, step).length, 0, `${rule}.${step || ''} should not be due`);

test('the shoot day\'s reminders: Eliel\'s day rings only Lior at its end; Eli\'s solo day is timed to the shoot\'s own time', () => {
  const eliel = world(soloEliel);
  for (const t of [IL(2026, 10, 15, 9), IL(2026, 10, 15, 10, 45), IL(2026, 10, 15, 11, 15)]) {
    for (const step of ['eli2h', 'eli15', 'arrived', 'begin', 'progress']) none(due(eliel, t), 'shoot', step);
  }
  const end = one(due(eliel, IL(2026, 10, 15, 14)), 'shoot', 'endLior');
  assert.deepEqual([end.person, end.body], ['lior', 'כל הסרטונים של היום, והכונן אצלך.']);
  none(due(eliel, IL(2026, 10, 15, 14)), 'shoot', 'endEli');

  const eli = world(soloEli);
  none(due(eli, IL(2026, 10, 15, 9)), 'shoot', 'eli2h');
  const r = one(due(eli, IL(2026, 10, 15, 10)), 'shoot', 'eli2h');
  assert.equal(r.person, 'eli');
  assert.match(r.body, /^ההגעה שלך ב־11:00, שעת הצילום \(יום בלי משפיענים\)/);
  none(due(eli, IL(2026, 10, 15, 10, 45)), 'shoot', 'eli15');
  none(due(eli, IL(2026, 10, 15, 11)), 'shoot', 'arrived');
  assert.equal(one(due(eli, IL(2026, 10, 15, 11, 15)), 'shoot', 'arrived').person, 'lior');
  one(due(eli, IL(2026, 10, 15, 14)), 'shoot', 'endEli');
  // A day with influencers, as before: two hours before them.
  one(due(world(withInf), IL(2026, 10, 15, 9)), 'shoot', 'eli2h');
  one(due(world(withInf), IL(2026, 10, 15, 10, 45)), 'shoot', 'eli15');
});

test('the briefing to Eli and the day before: not on Eliel\'s day; no influencers to remind', () => {
  const eve = IL(2026, 10, 14, 17);
  none(due(world(soloEliel), eve), 'briefing');
  one(due(world(soloEli), eve), 'briefing', 'lior');
  one(due(world(withInf), eve), 'briefing', 'lior');
  // 10:30 the day before: the client and the crew were reminded; on a day without influencers that is all.
  const sent = (c) => { const w = world(c); w.cs['p15.client'] = done(IL(2026, 10, 14, 9)); w.cs['p15.crew'] = done(IL(2026, 10, 14, 9)); return w; };
  none(due(sent(soloEliel), IL(2026, 10, 14, 10, 30)), 'eve', '1030');
  one(due(sent(withInf), IL(2026, 10, 14, 10, 30)), 'eve', '1030');
  assert.match(one(due(world(soloEliel), IL(2026, 10, 14, 10, 30)), 'eve', '1030').body, /ללקוח ולצוות \(יום בלי משפיענים\)/);
});

test('Eli hears of his shoot days, not of Eliel\'s; a day that passes to Eliel is told to him as off', () => {
  const now = IL(2026, 10, 12, 10);
  const set = one(due(world(soloEli), now), 'shootSet', 'set');
  assert.equal(set.person, 'eli');
  assert.match(set.body, /^ההגעה שלך ב־11:00, שעת הצילום/);
  none(due(world(soloEliel), now), 'shootSet');
  const told = [{ id: 7, key: `shootSet:c1:p17b@${SHOOT.toISOString()}:set@eli`, title: 'נקבע יום צילום: מספרת רון' }];
  const off = one(due(world(soloEliel, { shootTold: told }), now), 'shootSet', 'cancelled');
  assert.equal(off.person, 'eli');
});

// ── The client's message the day before ───
test('the day before a shoot without influencers: its own message, with who comes, checking the same item', () => {
  const c = { ...soloEliel, shoot_at: '2026-10-18T11:00:00+03:00' };
  const checks = Object.fromEntries(importKeys('shoot').map((k) => [k, { state: 'done', at: '2026-10-01T09:00:00+03:00', note: IMPORT_NOTE }]));
  const s = suggestFor(c, checks, [], new Date('2026-10-15T10:00:00+03:00'));
  assert.equal(s.options[0].key, 'eve_solo');
  assert.ok(!s.options.some((o) => o.key === 'eve'));
  const text = messageText(s.options[0], templatesByKey());
  assert.match(text, /מתי: יום א׳ 18\.10 בשעה 11:00\./);
  assert.match(text, /מי מגיע: ליאור \(מנהל יום הצילום\) ואליאל \(הצלם\)/);
  assert.doesNotMatch(text, /משפיענים/);
  assert.deepEqual(unfilledIn(text), []);
  assert.equal(protocolCheckOf({ template_key: 'eve_solo', ref: 'r2.eve_solo' }), 'r2.p15.client');
  assert.ok(!suggestFor(c, { ...checks, 'p15.client': { state: 'done', at: '2026-10-15T09:00:00+03:00' } }, [], new Date('2026-10-15T10:00:00+03:00')).options.some((o) => o.key === 'eve_solo'));
  // A day with influencers keeps its message.
  assert.equal(suggestFor({ ...withInf, shoot_at: '2026-10-18T11:00:00+03:00' }, checks, [], new Date('2026-10-15T10:00:00+03:00')).options[0].key, 'eve');
  assert.equal(crewText('natali'), 'ליאור (מנהל יום הצילום), אלי (הצלם) ונטלי דדון');
  assert.equal(crewText(null, 'eli'), 'ליאור (מנהל יום הצילום) ואלי (הצלם)');
});

test('the photographers\' taken days: Eli\'s are not the days Eliel films, and Eliel\'s are only his', () => {
  const list = [withInf, soloEliel, base({ id: 'c2', shoot_at: '2026-10-20T10:00:00+03:00', shoot_type: null, deliverables: { shoot_crew: 'eli' } })];
  assert.deepEqual(takenFrom(list), { '2026-10-15': 1, '2026-10-20': 1 });
  assert.deepEqual(takenFrom([soloEliel, base({ id: 'c3', shoot_at: '2026-10-21T10:00:00+03:00' })], 'eliel'), { '2026-10-15': 1 });
});

test('Eliel\'s month is kept, marked by the office: no card of his own, no reminder to him, no "not handed over" line', () => {
  assert.deepEqual([A.PHOTOGRAPHERS, A.HANDS_OVER], [['eli', 'eliel'], ['eli']]);
  const now = IL(2026, 10, 20, 10); // after the 15th: the managers' line
  const lines = (me) => flowLines({ viewer: { me, scope: 'office' }, clients: [], checks: {}, stateOf: () => ({ states: [] }), now, extra: { availability: { months: [], changes: [] } } })
    .filter((x) => String(x.id).startsWith('availability'));
  const irit = lines('irit');
  assert.equal(irit.length, 1);
  assert.match(irit[0].text, /^אלי עוד לא מסר זמינות/);
  assert.doesNotMatch(irit[0].text, /אליאל/);
  // The reminders ring only a photographer with an account (Eli), never Eliel.
  const w = world(withInf, { availability: { months: [], changes: [] } });
  const rings = computeReminders({ ...w, now: IL(2026, 10, 15, 10), log: [] }).filter((r) => r.rule === 'availability');
  assert.ok(rings.length > 0);
  assert.ok(rings.every((r) => r.person === 'eli'));
});
