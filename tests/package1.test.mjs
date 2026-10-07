// Package 1 of the protocol audit (7.10.2026; docs/ops.md, section 37), the rules
// without a browser:
//   - the answer clock of the rest of the graphics stops on the client's approval
//     (the bug: ANSWER_CLOCKS.p23 had no `approval`, so Irit was rung "call the
//     client" after the client approved on the status page), in the bar and in the
//     server's reminder;
//   - the files a hand-off stands on: which batch a file belongs to, the lock on
//     "מוכן לבדיקה" and on the final hand-off, who presses it from their own page;
//   - the words follow the owner's decisions: no Drive, Excel or Google Docs where
//     the system holds the thing; the contract has 10 office minutes; p24.folder
//     applies to nobody, its key stays, and the protocol version did not move.
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
import { videoWindow, graphicsWindow, workFiles, uploadGate, uploadedText, uploadStepOf } from '../app/files-logic.js';
import { ilaiWork } from '../app/ilai-logic.js';
import { planAutoAssign } from '../app/auto-assign.js';
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

test('the lock: nothing loaded, an error, nothing uploaded, a fixed version after the client\'s notes', () => {
  const w = { since: at('2026-10-05T12:00:00+03:00'), until: null };
  const one = [file('a', 'deliverable_video', '2026-10-07T10:00:00+03:00')];
  const gate = (o) => uploadGate({ files: one, kind: 'deliverable_video', window: w, none: 'נפתח אחרי שמעלים כאן לפחות סרטון סופי אחד.', ...o });
  assert.deepEqual(gate({ state: { loaded: false, error: null } }), { ok: false, count: 0, reason: 'בודק מה כבר הועלה…' });
  assert.equal(gate({ state: { loaded: true, error: 'x' } }).ok, false);
  assert.deepEqual(gate({ files: [] }), { ok: false, count: 0, reason: 'נפתח אחרי שמעלים כאן לפחות סרטון סופי אחד.' });
  assert.deepEqual(gate({}), { ok: true, count: 1, reason: '' });
  // The client's notes came on the 8th: the final hand-off waits for a file uploaded since.
  const notes = at('2026-10-08T09:00:00+03:00');
  assert.deepEqual(gate({ after: notes }), { ok: false, count: 1, reason: 'נפתח אחרי שמעלים את הגרסה המתוקנת: קובץ שעלה אחרי הערות הלקוח.' });
  assert.equal(gate({ after: notes, files: [...one, file('b', 'deliverable_video', '2026-10-08T15:00:00+03:00')] }).ok, true);
  // A file that was taken out does not open the lock.
  assert.equal(gate({ files: [file('a', 'deliverable_video', '2026-10-07T10:00:00+03:00', { deleted_at: '2026-10-07T11:00:00+03:00' })] }).ok, false);
  assert.deepEqual([uploadedText(0, 12), uploadedText(3, 12), uploadedText(3)], ['עוד לא הועלה כלום', 'הועלו 3 מתוך 12', 'הועלו 3']);
});

test('outside the office the hand-off marks are pressed where the files go up, never in bulk', () => {
  assert.deepEqual(uploadStepOf('p24.notify', 'nadia', 'c1'), { href: 'editor.html#c-c1', text: 'מסמנים ב״הלקוחות שלי בעריכה״, אחרי שמעלים שם את הסרטונים.' });
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
  checks.c['p07.made'] = { state: 'done', at: '2026-10-07T11:00:00+03:00' };
  assert.deepEqual(ilaiWork({ clients: [c], stateOf: stateAt(at('2026-10-07T12:00:00+03:00')), checks, now: at('2026-10-07T12:00:00+03:00') }).first, []);
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
test('the protocol names the system, not Drive, Excel or Google Docs; what stays is the archive and Dropbox', () => {
  const hits = protocolTexts().filter(([, text]) => OUTSIDE.test(text)).map(([k]) => k);
  // Process 35: the client's materials stay in Drive when the work ends (the archive outside the system).
  assert.deepEqual(hits, ['p35.drive']);
  const text = (key) => protocolTexts().find(([k]) => k === key)[1];
  assert.match(text('p09.file'), /גאנט התוכן של הלקוח במערכת/);
  assert.match(text('p12.docs'), /בעמוד התסריטים במערכת/);
  assert.match(text('p18.order'), /במונה של יום הצילום/);
  assert.match(text('p24.drive'), /תיק הלקוח במערכת/);
  assert.match(text('p27.final'), /תיק הלקוח במערכת/);
  assert.equal(text('p24.title'), 'העלאה לתיק הלקוח והעברה לאופיר');
  // The card's links: Drive and the old sheet are never asked for; the scripts link is the system's.
  const link = (k) => LINKS.find((l) => l.key === k);
  assert.deepEqual([link('drive').after, link('gantt').after, link('scripts').hint], [null, null, null]);
  assert.match(link('drive').label, /ארכיון/);
});

test('the reminders and the hand-offs say "תיק הלקוח", never Drive', () => {
  for (const f of ['reminder-rules.js', 'handoffs.js', 'ilai-card.js', 'editor.js', 'wa-templates.js']) {
    const code = readFileSync(new URL(`../app/${f}`, import.meta.url), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    // Dropbox stays where the office put a Dropbox link in the card; the archive link is named so.
    assert.doesNotMatch(code.replace(/ארכיון ב־Drive/g, ''), /דרייב|Google Docs|Excel|['"`][^'"`\n]*Drive[^'"`\n]*['"`]/, f);
  }
  assert.ok(HANDOFFS.some((x) => x.to.some((t) => /בתיק הלקוח במערכת/.test(t.text || ''))));
  assert.match(selfCheck(false).find(([k]) => k === 'p24.drive')[1], /לתיק הלקוח/);
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

test('p24.folder applies to no client; its key stays and the version did not move', () => {
  assert.equal(PROTOCOL_VERSION, 7);
  assert.equal(LATEST, 7);
  assert.ok(PROCESSES.find((p) => p.id === 'p24').items.some((i) => i.key === 'p24.folder'), 'the key is still in the data');
  const c = { id: 'c', status: 'active', editor: 'nadia', shoot_type: 'dms', rounds: [{ n: 2, editor: 'yariv', shoot_at: '2026-11-01T10:00:00+02:00', start_at: '2026-10-20T10:00:00+03:00' }], deal_at: '2026-09-01T09:00:00+03:00', char_at: '2026-09-02T10:00:00+03:00', shoot_at: '2026-10-01T10:00:00+03:00' };
  const keys = applicableProcesses(c).flatMap((p) => p.items.map((i) => i.key));
  assert.deepEqual(keys.filter((k) => /p24\./.test(k)), ['p24.drive', 'p24.dropbox', 'p24.notify', 'r2.p24.drive', 'r2.p24.dropbox', 'r2.p24.notify']);
  // 24 closes on the editor's own items, with no folder mark; an old folder mark changes nothing.
  const checks = { ...done(['p22a.assigned'], '2026-10-05T12:00:00+03:00'), ...done(keysOf('p22'), '2026-10-06T12:00:00+03:00'), ...done(['p24.drive', 'p24.notify'], '2026-10-06T13:00:00+03:00') };
  const p24 = (cs) => clientState(c, cs, at('2026-10-06T14:00:00+03:00')).states.find((s) => s.proc.id === 'p24');
  assert.equal(p24(checks).complete, true);
  assert.equal(p24({ ...checks, ...done(['p24.folder'], '2026-10-05T13:00:00+03:00') }).complete, true);
});

test('nobody is asked for a Drive folder: the automatic assignment opens no task', () => {
  const c = { id: 'c', name: 'קפה', status: 'active', shoot_type: 'dms', rounds: [], deal_at: '2026-09-01T09:00:00+03:00', char_at: '2026-09-02T10:00:00+03:00', shoot_at: '2026-10-01T10:00:00+03:00', created_at: '2026-09-01T09:00:00+03:00' };
  const checks = { c: done(PROCESSES.filter((p) => ['p17', 'p18', 'p19', 'p21'].includes(p.id)).flatMap((p) => p.items.map((i) => i.key)), '2026-10-01T16:00:00+03:00') };
  const now = at('2026-10-01T16:05:00+03:00');
  const plan = planAutoAssign({ clients: [c], stateOf: (x) => clientState(x, checks[x.id], now), checks, tasks: [], now });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].task, null);
});

test('a failed upload is reported with "חסר…": it is on the list', () => {
  assert.deepEqual(MISSING_WHAT.map(([k]) => k), ['logo', 'phone', 'footage', 'upload']);
});

test('the characterization is read, outside the office, by Ilai and Nirel only', () => {
  assert.deepEqual(CHAR_READERS, ['ilai', 'nirel']);
  for (const who of ['nadia', 'yariv', 'anna', 'eli', 'stav', null, undefined]) assert.equal(readsChar(who), false, String(who));
});
