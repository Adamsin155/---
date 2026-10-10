// Package 1 of the protocol audit (7.10.2026; docs/ops.md, section 37), the rules
// without a browser:
//   - the answer clock of the rest of the graphics stops on the client's approval
//     (the bug: ANSWER_CLOCKS.p23 had no `approval`, so Irit was rung "call the
//     client" after the client approved on the status page), in the bar and in the
//     server's reminder;
//   - the files a hand-off stands on: which batch a file belongs to, the lock on
//     Ilai's "מוכן לבדיקה", who presses a hand-off from their own page;
//   - the finished videos stay in the client's Google Drive (the owner's decision of
//     7.10.2026, the storage quota): the hand-off stands on the folder's link, or on
//     a video uploaded into the system (optional);
//   - the words follow the owner's decisions: the system for graphics, scripts and
//     the Gantt (no Excel, no Google Docs), Drive for the videos; the contract has 10
//     office minutes; p24.folder and Ofir's folder task are as they were; version 7.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PROCESSES, PROTOCOL_VERSION, LINKS } from '../app/protocol.js';
import { applicableProcesses, clientState, addWorkingMinutes, bulkEligible } from '../app/protocol-logic.js';
import { LATEST } from '../app/protocol-versions.js';
import { ANSWER_CLOCKS, clocksFor } from '../app/clocks.js';
import { clockRows, rowWhat, rowRef } from '../app/now-bar.js';
import { RULES } from '../app/reminder-rules.js';
import { HANDOFFS } from '../app/handoffs.js';
import { DEAL_MINUTES } from '../app/deal-logic.js';
import { videoWindow, graphicsWindow, workFiles, uploadGate, uploadedText, uploadStepOf, videosLinkOf, videosGate, driveLinkProblem } from '../app/files-logic.js';
import { ilaiWork } from '../app/ilai-logic.js';
import { folderTitle, folderItemOf, folderDueOn } from '../app/qa-logic.js';
import { MISSING_WHAT, selfCheck } from '../app/production.js';
import { CHAR_READERS, readsChar } from '../app/intake-ui.js';

const at = (s) => new Date(s);
const done = (keys, when, note = null) => Object.fromEntries(keys.map((k) => [k, { state: 'done', at: when, note, by_email: 'x@astrateg.test' }]));
const keysOf = (id) => PROCESSES.find((p) => p.id === id).items.map((i) => i.key);

// ── The bug ───────────────────────────────
test('every "the client did not answer" clock stops on the client\'s own approval', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(ANSWER_CLOCKS).map(([k, v]) => [k, v.approval])), { p07: 'p07.approved', p23: 'p23.approved', p26: 'p27.approved' });
  for (const [k, v] of Object.entries(ANSWER_CLOCKS)) assert.ok(PROCESSES.some((p) => p.items.some((i) => i.key === v.approval)), `${k}: ${v.approval} is an item`);
});

test('the rest of the graphics: approved on the status page 4 minutes after the sending, no clock and no ring to Irit', () => {
  const c = { id: 'g', name: 'קפה דנה', status: 'active', deal_at: '2026-09-01T09:00:00+03:00', char_at: '2026-09-02T10:00:00+03:00', shoot_at: '2026-10-01T10:00:00+03:00', shoot_type: 'dms', characterizer: 'ofir', has_logo: true, rounds: [] };
  const sent = { ...done(['p23.made', 'p23.ofir', ...keysOf('p23').filter((k) => k.startsWith('p23.q.'))], '2026-10-12T10:00:00+03:00'), ...done(['p23.sent'], '2026-10-12T11:00:00+03:00') };
  const now = at('2026-10-12T11:12:00+03:00'); // two minutes after the 10
  const bar = (checks) => clocksFor('irit', [c], { g: checks }, { now }).filter((x) => x.kind === 'answer').map((x) => [x.proc.id, x.state]);
  assert.deepEqual(bar(sent), [['p23', 'expired']], 'no answer: the clock ran out and Irit calls');
  // The client approves on the status page (approve_item writes p23.approved, by the client).
  const approved = { ...sent, 'p23.approved': { state: 'done', at: '2026-10-12T11:04:00+03:00', note: null, by_email: 'client' } };
  assert.deepEqual(bar(approved), [], 'approved: nothing to call about');
  // An approval from before this sending (sent again after a fix) does not stop the new clock.
  const old = { ...sent, 'p23.approved': { state: 'done', at: '2026-10-12T10:30:00+03:00', note: null, by_email: 'client' } };
  assert.deepEqual(bar(old), [['p23', 'expired']]);
  // The first 9 and the videos behave the same way (they always did).
  const nine = { ...done(['p07.made', ...keysOf('p07').filter((k) => k.startsWith('p07.r.'))], '2026-10-12T10:00:00+03:00'), ...done(['p07.sent'], '2026-10-12T11:00:00+03:00') };
  assert.deepEqual(clocksFor('irit', [c], { g: nine }, { now }).filter((x) => x.kind === 'answer').map((x) => x.proc.id), ['p07']);
  assert.deepEqual(clocksFor('irit', [c], { g: { ...nine, ...done(['p07.approved'], '2026-10-12T11:04:00+03:00') } }, { now }).filter((x) => x.kind === 'answer'), []);
});

// ── The files a hand-off stands on ────────
const file = (id, kind, when, extra = {}) => ({ id, kind, created_at: when, deleted_at: null, ...extra });

test('a round\'s videos: from its assignment to the next assignment of the same client', () => {
  const client = { id: 'c', rounds: [{ n: 2 }, { n: 3 }] };
  const checks = { ...done(['p22a.assigned'], '2026-10-05T12:00:00+03:00'), ...done(['r2.p22a.assigned'], '2026-11-05T12:00:00+03:00') };
  const w1 = videoWindow(client, checks, 1);
  const w2 = videoWindow(client, checks, 2);
  assert.deepEqual([w1.since.toISOString(), w1.until.toISOString()], [at('2026-10-05T12:00:00+03:00').toISOString(), at('2026-11-05T12:00:00+03:00').toISOString()]);
  assert.deepEqual([w2.since.toISOString(), w2.until], [at('2026-11-05T12:00:00+03:00').toISOString(), null]);
  assert.deepEqual(videoWindow(client, checks, 3), { since: null, until: null }, 'not assigned yet: open');
  const files = [
    file('old', 'deliverable_video', '2026-10-01T10:00:00+03:00'), // before the assignment: not this round's
    file('a', 'deliverable_video', '2026-10-07T10:00:00+03:00'),
    file('gone', 'deliverable_video', '2026-10-07T11:00:00+03:00', { deleted_at: '2026-10-07T12:00:00+03:00' }),
    file('pic', 'deliverable_graphic', '2026-10-07T10:00:00+03:00'),
    file('b', 'deliverable_video', '2026-11-06T10:00:00+03:00'),
  ];
  assert.deepEqual(workFiles(files, 'deliverable_video', w1).map((f) => f.id), ['a']);
  assert.deepEqual(workFiles(files, 'deliverable_video', w2).map((f) => f.id), ['b']);
});

test('the graphics: the first 9 until the client approved them, the rest after (the status page\'s own cut)', () => {
  const files = [file('g1', 'deliverable_graphic', '2026-10-05T10:00:00+03:00'), file('g2', 'deliverable_graphic', '2026-10-06T10:00:00+03:00'), file('g3', 'deliverable_graphic', '2026-10-20T10:00:00+03:00')];
  const approved = { ...done(['p07.made'], '2026-10-05T11:00:00+03:00'), ...done(['p07.approved'], '2026-10-06T12:00:00+03:00') };
  assert.deepEqual(workFiles(files, 'deliverable_graphic', graphicsWindow(approved, 'first')).map((f) => f.id), ['g1', 'g2']);
  assert.deepEqual(workFiles(files, 'deliverable_graphic', graphicsWindow(approved, 'rest')).map((f) => f.id), ['g3']);
  // Not approved yet: every graphic is of the first 9 for the client; the rest starts when the 9 went to review.
  const made = done(['p07.made'], '2026-10-05T11:00:00+03:00');
  assert.deepEqual(workFiles(files, 'deliverable_graphic', graphicsWindow(made, 'first')).map((f) => f.id), ['g1', 'g2', 'g3']);
  assert.deepEqual(workFiles(files, 'deliverable_graphic', graphicsWindow(made, 'rest')).map((f) => f.id), ['g2', 'g3']);
});

test('the videos are handed on with the Drive link, or with a video uploaded here; no "newer file" rule after the client\'s notes', () => {
  const w = { since: at('2026-10-05T12:00:00+03:00'), until: null };
  const one = [file('a', 'deliverable_video', '2026-10-07T10:00:00+03:00')];
  const link = 'https://drive.google.com/drive/folders/abc';
  assert.deepEqual(videosGate({ link, files: [], window: w }), { ok: true, link, count: 0, reason: '' });
  assert.deepEqual(videosGate({ link: null, files: one, window: w }), { ok: true, link: null, count: 1, reason: '' });
  assert.deepEqual(videosGate({ link: null, files: [], window: w }), { ok: false, link: null, count: 0, reason: 'נפתח עם קישור לסרטונים בדרייב של הלקוח (או סרטון שהועלה לכאן).' });
  assert.equal(videosGate({ link: null, files: [], window: w, state: { loaded: false, error: null } }).reason, 'בודק מה כבר הועלה…');
  // The link does not wait for the files to load, and a file taken out does not count.
  assert.equal(videosGate({ link, files: [], window: w, state: { loaded: false, error: null } }).ok, true);
  assert.equal(videosGate({ link: null, files: [file('a', 'deliverable_video', '2026-10-07T10:00:00+03:00', { deleted_at: '2026-10-07T11:00:00+03:00' })], window: w }).ok, false);
  // Where the link comes from: the editor's hand-off (the note of p24.drive), else the card's.
  const card = { links: { drive: 'https://drive.google.com/drive/folders/card' } };
  assert.equal(videosLinkOf(card, {}), 'https://drive.google.com/drive/folders/card');
  assert.equal(videosLinkOf(card, { 'p24.drive': { state: 'done', note: link } }), link);
  assert.equal(videosLinkOf({ links: {} }, { 'r2.p24.drive': { state: 'done', note: link } }, 'r2.'), link);
  assert.equal(videosLinkOf({ links: {} }, { 'p24.drive': { state: 'done', note: 'בסימון כל התהליך' } }), null);
  assert.equal(videosLinkOf({ links: { drive: 'http://drive.google.com/x' } }, {}), null, 'https only');
  assert.equal(videosLinkOf(null, null), null);
  assert.deepEqual([driveLinkProblem(''), driveLinkProblem('drive.google.com/x'), driveLinkProblem('https://drive.google.com/x?token=1'), driveLinkProblem(link)],
    ['הדביקו את הקישור לתיקיית הסרטונים בדרייב.', 'קישור מלא, שמתחיל ב־https://.', 'קישור בלי סיסמה או קוד.', null]);
});

test('Ilai\'s lock on the graphics: nothing loaded, an error, nothing uploaded', () => {
  const g = [file('g', 'deliverable_graphic', '2026-10-07T10:00:00+03:00')];
  const gate = (o) => uploadGate({ files: g, kind: 'deliverable_graphic', window: null, none: 'נפתח אחרי שמעלים כאן לפחות גרפיקה אחת.', ...o });
  assert.deepEqual(gate({ state: { loaded: false, error: null } }), { ok: false, count: 0, reason: 'בודק מה כבר הועלה…' });
  assert.equal(gate({ state: { loaded: true, error: 'x' } }).ok, false);
  assert.deepEqual(gate({ files: [] }), { ok: false, count: 0, reason: 'נפתח אחרי שמעלים כאן לפחות גרפיקה אחת.' });
  assert.deepEqual(gate({}), { ok: true, count: 1, reason: '' });
  assert.deepEqual([uploadedText(0, 12), uploadedText(3, 12), uploadedText(3)], ['עוד לא הועלה כלום', 'הועלו 3 מתוך 12', 'הועלו 3']);
});

test('outside the office the hand-off marks are pressed where the files go up, never in bulk', () => {
  assert.deepEqual(uploadStepOf('p24.notify', 'nadia', 'c1'), { href: 'editor.html#c-c1', text: 'מסמנים ב״הלקוחות שלי בעריכה״, עם הקישור לסרטונים בדרייב.' });
  assert.equal(uploadStepOf('r2.p27.final', 'nirel', 'c1').href, 'editor.html#c-c1');
  assert.equal(uploadStepOf('p07.made', 'ilai', 'c1').href, 'clients.html#mine');
  assert.equal(uploadStepOf('p23.made', 'ilai', 'c1').href, 'clients.html#mine');
  for (const who of ['irit', 'lior', 'ofir', null, undefined, 'eli']) assert.equal(uploadStepOf('p24.notify', who, 'c1'), null, String(who));
  assert.equal(uploadStepOf('p22.edited', 'nadia', 'c1'), null);
  assert.equal(uploadStepOf('p07.made', 'nadia', 'c1'), null);
  for (const key of ['p07.made', 'p23.made', 'p24.notify', 'p27.final']) {
    assert.equal(PROCESSES.flatMap((p) => p.items).find((i) => i.key === key).noBulk, true, key);
  }
  const c = { id: 'c', status: 'active', editor: 'nadia', shoot_type: 'dms', rounds: [], deal_at: '2026-09-01T09:00:00+03:00', char_at: '2026-09-02T10:00:00+03:00', shoot_at: '2026-10-01T10:00:00+03:00' };
  const checks = { ...done(['p22a.assigned'], '2026-10-05T12:00:00+03:00'), ...done(keysOf('p22'), '2026-10-06T12:00:00+03:00') };
  const p24 = clientState(c, checks, at('2026-10-06T13:00:00+03:00')).states.find((s) => s.proc.id === 'p24');
  assert.ok(!bulkEligible(p24, 'nadia', c, checks).some((i) => i.key === 'p24.notify'));
});

test('Ilai keeps a card for the first 9 graphics after the characterization day', () => {
  const c = { id: 'c', name: 'קפה דנה', status: 'active', characterizer: 'ofir', has_logo: true, shoot_type: 'dms', rounds: [], deal_at: '2026-10-01T09:00:00+03:00', char_at: '2026-10-05T10:00:00+03:00' };
  const checks = { c: { ...done(keysOf('p04'), '2026-10-05T12:00:00+03:00'), 'p04.ended': { state: 'done', at: '2026-10-05T11:30:00+03:00', note: 'האפיון הסתיים · לוגו: יש' } } };
  const stateAt = (now) => (cl) => clientState(cl, checks[cl.id], now);
  const day = at('2026-10-05T13:00:00+03:00');
  assert.deepEqual(ilaiWork({ clients: [c], stateOf: stateAt(day), checks, now: day }).first, [], 'on the day itself the day\'s card holds them');
  const later = at('2026-10-07T10:00:00+03:00');
  assert.deepEqual(ilaiWork({ clients: [c], stateOf: stateAt(later), checks, now: later }).first.map((x) => [x.client.id, x.state.proc.id]), [['c', 'p07']]);
  // Handed over: the card stays while the graphics are with Ofir for his check (protocol v9: it says where
  // they are and how long he has), comes back as a list of fixes if he returns them, and goes when he approved.
  checks.c['p07.made'] = { state: 'done', at: '2026-10-07T11:00:00+03:00' };
  const noon = at('2026-10-07T12:00:00+03:00');
  const firstAt = () => ilaiWork({ clients: [c], stateOf: stateAt(noon), checks, now: noon }).first.map((x) => x.qa.stage);
  assert.deepEqual(firstAt(), ['ofir']);
  checks.c['p07.return.1'] = { state: 'done', at: '2026-10-07T11:05:00+03:00', note: JSON.stringify({ v: 1, issues: [{ ref: '3', text: 'טלפון שגוי' }], due: '2026-10-07T15:00:00.000Z' }) };
  assert.deepEqual(firstAt(), ['fixing']);
  checks.c['p07.fixed.1'] = { state: 'done', at: '2026-10-07T11:40:00+03:00' };
  assert.deepEqual(firstAt(), ['ofir']);
  checks.c['p07.ofir'] = { state: 'done', at: '2026-10-07T11:45:00+03:00' };
  assert.deepEqual(firstAt(), []);
});

// ── The words follow the owner's decisions ──
// Every text staff can read in the protocol, the reminders and the hand-offs.
function protocolTexts() {
  const out = [];
  for (const p of PROCESSES) {
    for (const k of ['title', 'sla', 'what', 'rule', 'ownerNote']) if (p[k]) out.push([`${p.id}.${k}`, p[k]]);
    for (const g of Object.values(p.guidance || {})) out.push([`${p.id}.guidance`, g]);
    for (const i of p.items) out.push([i.key, i.label]);
  }
  return out;
}
const OUTSIDE = /דרייב|Drive|Google Docs|Excel|גיליון|בירוק/i;
test('the protocol: the system for the Gantt and the scripts (no Excel, no Google Docs); Drive only for the videos and the archive', () => {
  const hits = protocolTexts().filter(([, text]) => OUTSIDE.test(text)).map(([k]) => k);
  // 24 and 27: the finished videos are in the client's Drive (the owner's decision of 7.10.2026). 35: the archive.
  // (29ב, protocol v10: one of the 13 points of Ilai's final check is that the videos are in the client's Drive.)
  assert.deepEqual(hits, ['p24.title', 'p24.folder', 'p24.drive', 'p27.sla', 'p27.final', 'p29b.c.vfiles', 'p35.drive']);
  assert.ok(!protocolTexts().some(([, text]) => /Google Docs|Excel|גיליון|בירוק/i.test(text)));
  const text = (key) => protocolTexts().find(([k]) => k === key)[1];
  assert.match(text('p09.file'), /גאנט התוכן של הלקוח במערכת/);
  assert.match(text('p12.docs'), /בעמוד התסריטים במערכת/);
  assert.match(text('p18.order'), /במונה של יום הצילום/);
  assert.match(text('p24.drive'), /הועלו לדרייב של הלקוח/);
  assert.match(text('p27.final'), /בדרייב של הלקוח/);
  assert.equal(text('p24.title'), 'העלאה לדרייב והעברה לאופיר');
  // The card's links: the videos' Drive folder is asked for once Ofir opened it; the old sheet never; the scripts link is the system's.
  const link = (k) => LINKS.find((l) => l.key === k);
  assert.deepEqual([link('drive').after, link('gantt').after, link('scripts').hint], ['p24.folder', null, null]);
  assert.equal(link('drive').label, 'תיקיית הסרטונים ב־Drive');
});

test('the reminders and the hand-offs: the videos are "בדרייב", never "תיק הלקוח במערכת"; no Google Docs or Excel', () => {
  for (const f of ['reminder-rules.js', 'handoffs.js', 'ilai-card.js', 'editor.js', 'wa-templates.js', 'production.js']) {
    const code = readFileSync(new URL(`../app/${f}`, import.meta.url), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.doesNotMatch(code, /Google Docs|Excel|תיק הלקוח במערכת|בתיק הלקוח ואצל|הסרטונים בתיק הלקוח/, f);
  }
  assert.ok(HANDOFFS.some((x) => x.to.some((t) => /בדרייב של הלקוח ומוכנים לבקרת האיכות/.test(t.text || ''))));
  assert.ok(HANDOFFS.some((x) => x.to.some((t) => /הגרסאות הסופיות של \{client\} בדרייב של הלקוח/.test(t.text || ''))));
  assert.match(selfCheck(false).find(([k]) => k === 'p24.drive')[1], /בדרייב של הלקוח/);
});

test('the contract has 10 office minutes, in the words, the clock and the reminder', () => {
  const p01 = PROCESSES.find((p) => p.id === 'p01');
  assert.equal(DEAL_MINUTES, 10);
  assert.equal(p01.due.minutes, DEAL_MINUTES);
  assert.match(p01.sla, /עד 10 דקות עבודה/);
  for (const id of ['p02', 'p03']) assert.equal(PROCESSES.find((p) => p.id === id).due.minutes, 5, id);
  const steps = RULES.find((r) => r.id === 'deal').steps;
  assert.deepEqual(steps.map((s) => s.id), ['now', 'due', 'contract', 'lior', 'board']);
  const contract = steps.find((s) => s.id === 'contract');
  assert.equal(contract.from, 'contractDue');
  assert.equal(contract.title({ name: 'פיצה' }), 'עברו 10 דקות בלי חוזה: פיצה');
  assert.equal(contract.when({ missing: ['קבוצה'] }), false);
  assert.equal(steps.find((s) => s.id === 'due').when({ missing: ['חוזה'] }), false, 'only the contract is missing: no ring at 5 minutes');
  assert.equal(addWorkingMinutes(at('2026-10-05T10:00:00+03:00'), DEAL_MINUTES).toISOString(), at('2026-10-05T10:10:00+03:00').toISOString());
});

test('the bar: a new deal is two rows, the group and the meeting date at 5 minutes and the contract at 10', () => {
  const c = { id: 'n', name: 'פיצה נאפולי', deal_at: '2026-10-05T10:00:00+03:00', status: 'active' };
  const rows = clockRows(clocksFor('irit', [c], {}, { now: at('2026-10-05T10:01:00+03:00') }));
  assert.deepEqual(rows.map((r) => [rowWhat(r, r), rowRef(r), r.deadline.toISOString()]), [
    ['עסקה חדשה: קבוצה ומועד אפיון', 'תהליכים 2, 3', at('2026-10-05T10:05:00+03:00').toISOString()],
    ['עסקה חדשה: חוזה', 'תהליך 1', at('2026-10-05T10:10:00+03:00').toISOString()],
  ]);
});

test('p24.folder is Ofir\'s item as before (the videos are in Drive), and the version did not move', () => {
  assert.equal(PROTOCOL_VERSION, 10); // 10 since 10.10.2026 (docs/ops.md, section 58); this feature itself did not move it
  assert.equal(LATEST, 10);
  const c = { id: 'c', status: 'active', editor: 'nadia', shoot_type: 'dms', rounds: [{ n: 2, editor: 'yariv', shoot_at: '2026-11-01T10:00:00+02:00', start_at: '2026-10-20T10:00:00+03:00' }], deal_at: '2026-09-01T09:00:00+03:00', char_at: '2026-09-02T10:00:00+03:00', shoot_at: '2026-10-01T10:00:00+03:00' };
  const items = applicableProcesses(c).flatMap((p) => p.items);
  assert.deepEqual(items.filter((i) => /p24\./.test(i.key)).map((i) => i.key), ['p24.folder', 'p24.drive', 'p24.dropbox', 'p24.notify', 'r2.p24.folder', 'r2.p24.drive', 'r2.p24.dropbox', 'r2.p24.notify']);
  assert.deepEqual(items.find((i) => i.key === 'p24.folder').owners, ['ofir']);
  // 24 is complete only with the folder too.
  const checks = { ...done(['p22a.assigned'], '2026-10-05T12:00:00+03:00'), ...done(keysOf('p22'), '2026-10-06T12:00:00+03:00'), ...done(['p24.drive', 'p24.notify'], '2026-10-06T13:00:00+03:00') };
  const p24 = (cs) => clientState(c, cs, at('2026-10-06T14:00:00+03:00')).states.find((s) => s.proc.id === 'p24');
  assert.equal(p24(checks).complete, false);
  assert.equal(p24({ ...checks, ...done(['p24.folder'], '2026-10-05T13:00:00+03:00') }).complete, true);
});

test('the assignment opens Ofir\'s Drive folder task, as before (since protocol v9 from his own dialog, not by the server)', () => {
  // The task Ofir's dialog opens when he assigns (app/qa.js): its title is what ties it to the item 24 asks of him.
  assert.equal(folderTitle(), 'פתיחת תיקייה מסודרת בדרייב לעריכה (24)');
  assert.equal(folderItemOf({ title: folderTitle() }), 'p24.folder');
  assert.equal(folderItemOf({ title: folderTitle(2) }), 'r2.p24.folder');
  // Due at the close of editing day 1 (the assignment day is not counted).
  assert.equal(folderDueOn(at('2026-10-01T16:05:00+03:00')), '2026-10-04');
});

test('a failed upload (optional now) can still be reported with "חסר…"', () => {
  assert.deepEqual(MISSING_WHAT.map(([k]) => k), ['logo', 'phone', 'footage', 'upload']);
});

test('the characterization is read, outside the office, by Ilai and Nirel only', () => {
  assert.deepEqual(CHAR_READERS, ['ilai', 'nirel']);
  for (const who of ['nadia', 'yariv', 'anna', 'eli', 'stav', null, undefined]) assert.equal(readsChar(who), false, String(who));
});
