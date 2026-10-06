// Exceptional contracts outside the engine (the owner's decisions of 6.10.2026), at
// fixed Israel times (npm test runs this under UTC, New York and Jerusalem):
//   - who decides and what each person's card lists (app/approvals-logic.js);
//   - the reminders (app/reminder-rules.js `contractApproval`, `contractDecided`): the
//     approvers ring at once and once more after 30 office minutes, whoever prepared
//     it is told quietly; the decision rings the preparer and tells the seller quietly;
//   - Stav's "הצעה אחרת" (app/deal-logic.js): the form, what Irit reads, the builder
//     prefilled in custom mode, and the 10-minute contract ladder stopping when the
//     contract went for approval.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeReminders, planDelivery } from '../app/reminder-engine.js';
import { RULE_BY_ID } from '../app/reminder-rules.js';
import { dateIL } from '../app/tz.js';
import {
  APPROVERS, canApprove, seesApprovals, mayDecide, approvalText, approvalLists, inApproval, businessOf, packageOf, deviationsOf,
  reviseUrl, shareText, approvalNudgeAt, APPROVAL_NUDGE_MINUTES, personOfViewer,
} from '../app/approvals-logic.js';
import { validateDeal, dealSummary, prefillFromDeal, statusText, isCustomDeal, contractTitle, pendingDeals } from '../app/deal-logic.js';
import { emptySelection, validateSelection, exceptionOf, buildQuoteModel, computeTotals } from '../app/pricing.js';

const IL = (y, m, d, h = 0, mi = 0) => dateIL(y, m, d, h, mi);
const STAFF = [
  { email: 'owner@x', person: null }, { email: 'irit@x', person: 'irit' }, { email: 'lior@x', person: 'lior' }, { email: 'ofir@x', person: 'ofir' },
  { email: 'ilai@x', person: 'ilai' }, { email: 'nadia@x', person: 'nadia' }, { email: 'stav@x', person: 'stav' }, { email: 'amos@x', person: 'amos' },
];
const world = () => ({ clients: [], checks: {}, tasks: [], access: [], reviews: [], statusNotes: [], messages: [], subscriptions: [], staff: STAFF, deals: [], approvals: [] });
const due = (w, now, log = []) => computeReminders({ ...w, now, log });
const of = (list, rule, step = null) => list.filter((r) => r.rule === rule && (!step || r.step === step));
const people = (list, rule, step) => of(list, rule, step).map((r) => r.person).sort();

const VIEW = {
  owner: { me: null, scope: 'office', error: null }, ofir: { me: 'ofir', scope: 'office', error: null }, lior: { me: 'lior', scope: 'office', error: null },
  irit: { me: 'irit', scope: 'office', error: null }, ilai: { me: 'ilai', scope: 'office', error: null },
  nadia: { me: 'nadia', scope: 'own', error: null }, stav: { me: 'stav', scope: 'sales', error: null }, unknown: { me: null, scope: 'own', error: new Error('x') },
};
const SEL = { ...emptySelection(), docType: 'agreement', custom: { qty: { videos: 30 }, discount: 35000 } };
const quote = (o = {}) => {
  const model = buildQuoteModel(SEL, { name: 'דנה לוי', company: 'קפה דנה', phone: '050-1234567' });
  return {
    id: 'q1', number: 'AST-2026-0042', token: 't1', client_name: 'דנה לוי', business: 'קפה דנה', model, status: 'sent', approval: 'pending', version: 1,
    exceptions: exceptionOf(SEL), created_at: IL(2026, 10, 5, 10).toISOString(), submitted_at: IL(2026, 10, 5, 10).toISOString(),
    created_by_email: 'irit@x', submitted_by_email: 'irit@x', approval_by: null, approval_at: null, approval_note: null, ...o,
  };
};

test('who decides: the owner, Ofir and Lior; never their own contract, except the owner', () => {
  assert.deepEqual(APPROVERS, ['owner', 'ofir', 'lior']);
  for (const k of ['owner', 'ofir', 'lior']) assert.equal(canApprove(VIEW[k]), true, k);
  for (const k of ['irit', 'ilai', 'nadia', 'stav', 'unknown']) assert.equal(canApprove(VIEW[k]), false, k);
  assert.equal(canApprove(null), false);
  assert.equal(personOfViewer(VIEW.owner), 'owner');
  assert.equal(personOfViewer(VIEW.unknown), null);
  // The office sees the contracts in approval; editors and sales see nothing new.
  for (const k of ['owner', 'ofir', 'lior', 'irit', 'ilai']) assert.equal(seesApprovals(VIEW[k]), true, k);
  for (const k of ['nadia', 'stav', 'unknown']) assert.equal(seesApprovals(VIEW[k]), false, k);
  const q = quote();
  assert.equal(mayDecide(q, VIEW.lior, 'lior@x'), true);
  assert.equal(mayDecide(q, VIEW.irit, 'irit@x'), false);
  assert.equal(mayDecide(quote({ submitted_by_email: 'Ofir@X' }), VIEW.ofir, 'ofir@x'), false);
  assert.equal(mayDecide(quote({ submitted_by_email: 'ofir@x' }), VIEW.lior, 'lior@x'), true);
  assert.equal(mayDecide(quote({ submitted_by_email: 'owner@x' }), VIEW.owner, 'owner@x'), true);
  for (const o of [{ approval: 'approved' }, { approval: 'rejected' }, { status: 'cancelled' }, { status: 'signed', approval: 'approved' }]) assert.equal(mayDecide(quote(o), VIEW.owner, 'owner@x'), false);
});

test('the card: approvers get what waits; whoever prepared follows the states, with the words', () => {
  const list = [
    quote({ id: 'a', submitted_at: IL(2026, 10, 5, 11).toISOString() }),
    quote({ id: 'b', submitted_at: IL(2026, 10, 5, 9).toISOString() }),
    quote({ id: 'c', approval: 'approved', approval_by: 'ofir' }),
    quote({ id: 'd', approval: 'rejected', approval_note: 'ההנחה גבוהה מדי' }),
    quote({ id: 'e', approval: 'approved', status: 'signed' }),
    quote({ id: 'f', approval: 'pending', status: 'cancelled' }),
    quote({ id: 'g', approval: 'none' }),
  ];
  const lior = approvalLists(list, VIEW.lior, 'lior@x');
  assert.deepEqual(lior.toDecide.map((q) => q.id), ['b', 'a'], 'oldest first');
  assert.deepEqual(lior.follow.map((q) => q.id), ['d', 'c']);
  const irit = approvalLists(list, VIEW.irit, 'irit@x');
  assert.deepEqual(irit.toDecide, []);
  assert.deepEqual(irit.follow.map((q) => q.id), ['d', 'c', 'a', 'b'], 'sent back first, then ready to send, then waiting');
  assert.equal(irit.mine(list[0]), true);
  assert.deepEqual(list.map(inApproval), [true, true, true, true, false, false, false]);
  assert.equal(approvalText(list[0]), 'ממתין לאישור');
  assert.equal(approvalText(list[2]), 'אושר — אפשר לשלוח');
  assert.equal(approvalText(list[3]), 'לא אושר: ההנחה גבוהה מדי');
  assert.equal(approvalText(list[6]), '');
  const q = quote();
  assert.equal(businessOf(q), 'קפה דנה');
  assert.equal(businessOf({ client_name: 'דנה' }), 'דנה');
  assert.equal(packageOf(q), 'Social all in one · סמיון, מישל ודניס');
  assert.deepEqual(deviationsOf(q), ['30 סרטונים במקום 25', 'הנחה חודשית 350 ₪ (המותר בלי אישור: 200 ₪)']);
  assert.equal(reviseUrl(q), 'index.html?revise=q1');
  assert.equal(shareText(q, 'https://x/q', 72), 'שלום דנה לוי, מצורף הסכם ההתקשרות מאסטרטג (AST-2026-0042) ל־12 חודשים. אפשר לעיין ולחתום כאן בתוך 72 שעות:\nhttps://x/q');
});

test('sent for approval: the owner, Ofir and Lior ring at once, outside the daily cap; nothing for editors or sales', () => {
  const w = world();
  w.approvals.push(quote());
  const now = due(w, IL(2026, 10, 5, 10));
  assert.deepEqual(people(now, 'contractApproval', 'now'), ['lior', 'ofir', 'owner']);
  const r = of(now, 'contractApproval', 'now')[0];
  assert.deepEqual([r.level, r.exempt, r.title, r.url], ['ring', 'clock', 'חוזה חריג לאישור: קפה דנה', 'clients.html#mine']);
  assert.match(r.body, /הכין\/ה: עירית · 30 סרטונים במקום 25 · הנחה חודשית 350 ₪/);
  assert.deepEqual(of(now, 'contractApproval', 'again'), []);
  assert.deepEqual(of(now, 'contractDecided'), []);
  assert.ok(now.filter((x) => x.rule.startsWith('contract')).every((x) => ['owner', 'ofir', 'lior'].includes(x.person)));
  // A protocol clock: it goes out even when the person already had six rings today.
  const log = Array.from({ length: 6 }, (_, i) => ({ key: `x${i}`, person: 'lior', level: 'ring', channel: 'push', status: 'sent', exempt: null, sent_at: IL(2026, 10, 5, 9).toISOString() }));
  const plan = planDelivery({ reminders: now, now: IL(2026, 10, 5, 10), log });
  assert.deepEqual(plan.filter((p) => p.person === 'lior').map((p) => [p.channel, p.status]), [['push', 'sent']]);
  assert.ok(RULE_BY_ID.get('contractApproval').event && RULE_BY_ID.get('contractDecided').event);
});

test('nobody decided in 30 office minutes: one more ring to the approvers and a quiet note to Irit; then nothing more', () => {
  const w = world();
  w.approvals.push(quote());
  assert.equal(APPROVAL_NUDGE_MINUTES, 30);
  assert.equal(approvalNudgeAt(quote()).getTime(), IL(2026, 10, 5, 10, 30).getTime());
  assert.deepEqual(of(due(w, IL(2026, 10, 5, 10, 29)), 'contractApproval', 'again'), []);
  const at30 = due(w, IL(2026, 10, 5, 10, 30));
  assert.deepEqual(people(at30, 'contractApproval', 'again'), ['lior', 'ofir', 'owner']);
  assert.equal(of(at30, 'contractApproval', 'again')[0].title, 'עדיין מחכה לאישור: החוזה החריג של קפה דנה');
  const wait = of(at30, 'contractApproval', 'wait');
  assert.deepEqual(wait.map((x) => [x.person, x.level, x.title]), [['irit', 'quiet', 'עוד לא הוחלט על החוזה החריג של קפה דנה']]);
  // Once: everything is in the log, and a day later there is nothing new.
  assert.deepEqual(due(w, IL(2026, 10, 6, 12), at30.map((x) => x.key)).filter((x) => x.rule.startsWith('contract')), []);
  // Office time only: sent at 17:50, the second ring is at 09:20 the next business day.
  const late = world();
  late.approvals.push(quote({ submitted_at: IL(2026, 10, 5, 17, 50).toISOString() }));
  assert.deepEqual(of(due(late, IL(2026, 10, 5, 18, 30)), 'contractApproval', 'again'), []);
  assert.deepEqual(of(due(late, IL(2026, 10, 6, 9, 19)), 'contractApproval', 'again'), []);
  assert.equal(of(due(late, IL(2026, 10, 6, 9, 20)), 'contractApproval', 'again').length, 3);
});

test('relevance: a decision, a cancellation or a signature stops the ladder; a corrected version starts a new one', () => {
  const w = world();
  w.approvals.push(quote());
  const first = due(w, IL(2026, 10, 5, 10)).map((x) => x.key);
  // Decided at 10:10: the 10:30 ring never goes out.
  w.approvals[0] = quote({ approval: 'rejected', approval_by: 'lior', approval_at: IL(2026, 10, 5, 10, 10).toISOString(), approval_note: 'ההנחה גבוהה מדי, עד 300 ₪.' });
  const after = due(w, IL(2026, 10, 5, 10, 40), first);
  assert.deepEqual(of(after, 'contractApproval'), []);
  const told = of(after, 'contractDecided', 'prep');
  assert.deepEqual(told.map((x) => [x.person, x.level, x.exempt, x.title]), [['irit', 'ring', 'clock', 'החוזה של קפה דנה לא אושר: ההנחה גבוהה מדי, עד 300 ₪.']]);
  assert.match(told[0].body, /ליאור החזיר\/ה לתיקון/);
  // Irit corrected it: version 2 waits, and the approvers ring for it again.
  w.approvals[0] = quote({ version: 2, submitted_at: IL(2026, 10, 5, 11).toISOString() });
  const again = due(w, IL(2026, 10, 5, 11), [...first, ...after.map((x) => x.key)]);
  assert.deepEqual(people(again, 'contractApproval', 'now'), ['lior', 'ofir', 'owner']);
  assert.deepEqual(of(again, 'contractDecided'), []);
  // Ofir approves: Irit rings with "אפשר לשלוח".
  w.approvals[0] = quote({ version: 2, approval: 'approved', approval_by: 'ofir', approval_at: IL(2026, 10, 5, 11, 5).toISOString() });
  const ok = of(due(w, IL(2026, 10, 5, 11, 5)), 'contractDecided', 'prep');
  assert.deepEqual(ok.map((x) => [x.person, x.level, x.title]), [['irit', 'ring', 'החוזה של קפה דנה אושר — אפשר לשלוח']]);
  assert.match(ok[0].body, /אישר\/ה אופיר/);
  // Cancelled while waiting, or signed meanwhile: nothing.
  for (const o of [{ status: 'cancelled' }, { status: 'signed' }]) {
    const x = world();
    x.approvals.push(quote(o));
    assert.deepEqual(of(due(x, IL(2026, 10, 5, 10, 40)), 'contractApproval'), [], JSON.stringify(o));
  }
});

test('who prepared it: they do not ring for their own contract, and the owner is not told about his own decision', () => {
  const w = world();
  w.approvals.push(quote({ submitted_by_email: 'ofir@x', created_by_email: 'ofir@x' }));
  const now = due(w, IL(2026, 10, 5, 10, 30));
  assert.deepEqual(people(now, 'contractApproval', 'now'), ['lior', 'owner']);
  assert.deepEqual(people(now, 'contractApproval', 'wait'), ['ofir']);
  // The owner prepared and approved it himself: no ring back to himself, no quiet note.
  const own = world();
  own.approvals.push(quote({ submitted_by_email: 'owner@x', created_by_email: 'owner@x' }));
  const o = due(own, IL(2026, 10, 5, 10, 30));
  assert.deepEqual(people(o, 'contractApproval', 'now'), ['lior', 'ofir']);
  assert.deepEqual(of(o, 'contractApproval', 'wait'), []);
  own.approvals[0] = quote({ submitted_by_email: 'owner@x', approval: 'approved', approval_by: 'owner', approval_at: IL(2026, 10, 5, 10, 35).toISOString() });
  assert.deepEqual(of(due(own, IL(2026, 10, 5, 10, 35)), 'contractDecided'), []);
  // Prepared by someone who is not on the team list: Irit is told.
  const x = world();
  x.approvals.push(quote({ submitted_by_email: 'someone@else', created_by_email: 'someone@else' }));
  assert.deepEqual(people(due(x, IL(2026, 10, 5, 10, 30)), 'contractApproval', 'wait'), ['irit']);
});

test('the seller of the deal hears quietly about the decision; only when it concerns his deal', () => {
  const w = world();
  w.approvals.push(quote({ seller_email: 'stav@x', approval: 'approved', approval_by: 'lior', approval_at: IL(2026, 10, 5, 12).toISOString() }));
  const got = due(w, IL(2026, 10, 5, 12));
  assert.deepEqual(of(got, 'contractDecided', 'seller').map((x) => [x.person, x.level, x.title]), [['stav', 'quiet', 'החוזה של קפה דנה אושר']]);
  assert.equal(of(got, 'contractDecided', 'prep').length, 1);
  w.approvals[0] = quote({ seller_email: 'amos@x', approval: 'rejected', approval_by: 'owner', approval_note: 'x', approval_at: IL(2026, 10, 5, 12).toISOString() });
  assert.deepEqual(of(due(w, IL(2026, 10, 5, 12)), 'contractDecided', 'seller').map((x) => [x.person, x.title]), [['amos', 'החוזה של קפה דנה לא אושר — בתיקון']]);
  // No deal behind it: nobody but the preparer.
  w.approvals[0] = quote({ approval: 'approved', approval_by: 'lior', approval_at: IL(2026, 10, 5, 12).toISOString() });
  assert.deepEqual(of(due(w, IL(2026, 10, 5, 12)), 'contractDecided', 'seller'), []);
  // While it waits the seller hears nothing (his list shows "ממתין לאישור מנהל").
  w.approvals[0] = quote({ seller_email: 'stav@x' });
  assert.ok(due(w, IL(2026, 10, 5, 10, 40)).every((x) => x.person !== 'stav'));
});

// ── Stav's "הצעה אחרת" ─────────────────────
const FORM = { kind: 'custom', business_name: ' פיצה  רון ', contact_name: 'רון כהן', phone: '050-7654321', description: '  15 סרטונים ו־10 גרפיקות,\nבלי משפיענים  ', videos: '15', graphics: 10, shoot_days: '', price: '2500', term_months: '6', notes: 'דחוף' };

test('another offer: the form is checked, the row carries the seller\'s words and numbers and no package', () => {
  const v = validateDeal(FORM);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.deepEqual(v.row, {
    business_name: 'פיצה רון', contact_name: 'רון כהן', phone: '050-7654321', notes: 'דחוף', tier: null, influencer: null, paid: [], free: {}, discount_agorot: 0,
    custom: { description: '15 סרטונים ו־10 גרפיקות,\nבלי משפיענים', videos: 15, graphics: 10, price_agorot: 250000, term_months: 6 },
  });
  // The term defaults to 12; quantities are optional.
  assert.deepEqual(validateDeal({ ...FORM, videos: '', graphics: '', term_months: '' }).row.custom, { description: '15 סרטונים ו־10 גרפיקות,\nבלי משפיענים', price_agorot: 250000, term_months: 12 });
  const bad = (patch, field) => { const r = validateDeal({ ...FORM, ...patch }); assert.equal(r.ok, false, JSON.stringify(patch)); assert.ok(r.errors[field], `${field}: ${JSON.stringify(r.errors)}`); };
  bad({ description: '  ' }, 'description');
  bad({ description: 'א'.repeat(2001) }, 'description');
  for (const p of ['', '0', '-5', '12.5', 'abc', '100001']) bad({ price: p }, 'price');
  for (const t of ['0', '37', '6.5']) bad({ term_months: t }, 'term_months');
  bad({ videos: '201' }, 'videos');
  bad({ graphics: '-1' }, 'graphics');
  bad({ shoot_days: '13' }, 'shoot_days');
  bad({ business_name: '' }, 'business_name');
  // A built-in deal is checked as before, and carries no `custom`.
  const built = validateDeal({ business_name: 'x', contact_name: 'y', phone: '050-7654321', tier: 'social', influencer: 'natali', discount: 100 });
  assert.equal(built.ok, true);
  assert.ok(!('custom' in built.row));
  assert.equal(validateDeal({ business_name: 'x', contact_name: 'y', phone: '050-7654321', tier: 'social', influencer: 'natali', discount: 250 }).ok, false, 'a seller still gives up to 200 ₪');
});

test('another offer: what Irit reads, the two new statuses, and the builder opens in custom mode from it', () => {
  const d = { ...validateDeal(FORM).row, id: 'd9', status: 'pending', created_at: IL(2026, 10, 5, 10).toISOString() };
  assert.equal(isCustomDeal(d), true);
  assert.equal(isCustomDeal({ tier: 'social' }), false);
  assert.equal(contractTitle(d), 'להכין חוזה ל־פיצה רון');
  assert.equal(dealSummary(d), 'הצעה אחרת · 2,500 ₪ לחודש · 6 חודשים · 15 סרטונים · 10 גרפיקות · 15 סרטונים ו־10 גרפיקות, בלי משפיענים');
  assert.equal(statusText({ status: 'approval' }), 'ממתין לאישור מנהל');
  assert.equal(statusText({ status: 'rejected' }), 'לא אושר');
  const pre = prefillFromDeal(d);
  assert.equal(pre.selection.docType, 'agreement');
  assert.deepEqual(pre.selection.custom, { terms: '15 סרטונים ו־10 גרפיקות,\nבלי משפיענים', qty: { videos: 15, graphics: 10 }, price: 250000, termMonths: 6 });
  assert.deepEqual(pre.client, { 'c-name': 'רון כהן', 'c-company': 'פיצה רון', 'c-phone': '050-7654321', 'c-notes': 'דחוף' });
  // As it is, the server takes it, and it is an exceptional contract with his numbers.
  validateSelection(pre.selection);
  assert.deepEqual(exceptionOf(pre.selection).map((e) => e.text), ['15 סרטונים במקום 25', '10 גרפיקות במקום 35', 'מחיר חודשי 2,500 ₪ במקום 3,900 ₪', 'תקופה 6 חודשים במקום 12', 'תנאים מיוחדים']);
  assert.equal(computeTotals(pre.selection).termNet, 250000 * 6);
});

test('the 10-minute contract ladder stops when Irit sent the contract for approval; the approvers\' ladder takes over', () => {
  const w = world();
  const d = { ...validateDeal(FORM).row, id: 'd9', status: 'pending', created_by_email: 'stav@x', created_at: IL(2026, 10, 5, 10).toISOString() };
  w.deals.push(d);
  const first = due(w, IL(2026, 10, 5, 10));
  assert.deepEqual(of(first, 'dealNew', 'now').map((x) => [x.person, x.title]), [['irit', 'להכין חוזה ל־פיצה רון']]);
  assert.match(of(first, 'dealNew', 'now')[0].body, /מסתיו: הצעה אחרת · 2,500 ₪ לחודש/);
  // 10:06: she sent it for approval. The deal waits for a manager, not for her.
  w.deals[0] = { ...d, status: 'approval', quote_id: 'q1' };
  w.approvals.push(quote({ seller_email: 'stav@x', submitted_at: IL(2026, 10, 5, 10, 6).toISOString() }));
  const later = due(w, IL(2026, 10, 5, 10, 15), first.map((x) => x.key));
  assert.deepEqual(of(later, 'dealNew'), [], 'no "10 minutes passed", no ring to Ofir about Irit');
  assert.deepEqual(people(later, 'contractApproval', 'now'), ['lior', 'ofir', 'owner']);
  assert.deepEqual(pendingDeals(w.deals), []);
  // Not approved: still not Irit's 10-minute clock (she got the decision's ring).
  w.deals[0] = { ...d, status: 'rejected', quote_id: 'q1' };
  assert.deepEqual(of(due(w, IL(2026, 10, 5, 11)), 'dealNew'), []);
});
