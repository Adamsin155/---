// "שאלו את המערכת" (docs/ops.md, sections 75 and 78): who may ask, what the tools may read, money for the
// owners only, never the vault, and the function's loop with Claude (a fake model).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canAsk, mayAsk, cleanQuestion, cleanHistory, QUESTION_MAX, EXAMPLES, slotRange, errorWords, ERRORS } from '../app/ask-logic.js';
import { scopeOf } from '../app/protocol.js';
import { contractSummary, fileCounts } from '../app/contract-summary.js';
import { clientState } from '../app/protocol-logic.js';
import { TOOLS, TABLES, NEVER, guardDb, runTool, withoutMoney, matchClient, fit, OUTPUT_MAX, DRIVE_OFF } from '../supabase/functions/ask/tools.js';
import { makeHandler, buildRequest, MODEL, MAX_ROUNDS, SYSTEM, contextLine } from '../supabase/functions/ask/handler.js';
import { SITE_ORIGINS as ASK_ORIGINS } from '../supabase/functions/_shared/cors.js';
import { SITE_ORIGINS as AI_ORIGINS, MODEL as CONTRACT_MODEL } from '../supabase/functions/contract-ai/handler.js';
import { fakeClient } from './fake-pgrest.mjs';

const NOW = new Date('2026-11-12T08:00:00Z'); // Thursday 12.11.2026, 10:00 in Israel

// ── Who asks ───────────────────────────────────
// Everyone on the staff since 29.10.2026 ("תוסיף כבר לכולם וזהו"): each reads with their own rights.
test('everyone on the staff asks; nobody who is not staff (the screen and the server)', () => {
  const STAFF = ['irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli', 'stav', 'amos'];
  assert.equal(canAsk({ me: null, scope: 'office', error: null }), true);
  for (const me of STAFF) assert.equal(canAsk({ me, scope: scopeOf(me), error: null }), true, me);
  assert.equal(canAsk({ me: null, scope: 'own', error: null }), false, 'the generic editor account: no person');
  assert.equal(canAsk({ me: null, scope: 'own', error: 'x' }), false);
  assert.equal(canAsk(null), false);
  assert.equal(mayAsk({ office: true, person: null }), true);
  for (const person of STAFF) assert.equal(mayAsk({ office: ['irit', 'lior', 'ofir', 'ilai'].includes(person), person }), true, person);
  assert.equal(mayAsk({ office: false, person: 'editor' }), false, 'the placeholder is nobody');
  assert.equal(mayAsk({ office: false, person: 'someone' }), false);
  assert.equal(mayAsk({ office: false, person: null }), false, 'not staff: my_person() is null too');
  assert.equal(mayAsk({ office: 'true', person: null }), false);
  assert.equal(mayAsk({}), false);
  assert.match(ERRORS.not_allowed, /צוות/);
});

test('the question and the history are cleaned and capped', () => {
  assert.deepEqual(cleanQuestion('  כמה לקוחות?‏ '), { text: 'כמה לקוחות?' });
  assert.equal(cleanQuestion('   ').error, 'question_required');
  assert.equal(cleanQuestion(5).error, 'question_required');
  assert.equal(cleanQuestion('א'.repeat(QUESTION_MAX + 1)).error, 'question_too_long');
  const h = cleanHistory([{ q: 'a', a: 'b' }, { q: 1, a: 'x' }, null, ...Array.from({ length: 6 }, (_, i) => ({ q: `q${i}`, a: 'א'.repeat(5000) }))]);
  assert.equal(h.length, 4);
  assert.equal(h.at(-1).q, 'q5');
  assert.ok(h.every((t) => t.a.length <= 1200));
  assert.deepEqual(cleanHistory('x'), []);
  assert.ok(EXAMPLES.includes('כמה לקוחות פעילים יש?'));
  assert.deepEqual(slotRange('מה עלה לדרייב של <לקוח>?'), [17, 23]);
  assert.equal(slotRange('כמה לקוחות?'), null);
  assert.equal(errorWords('nope'), ERRORS.ai_failed);
});

// ── The walls ──────────────────────────────────
test('no table of the vault, the logins or the links; no rpc; every read names its columns', () => {
  for (const t of TABLES) assert.ok(!NEVER.test(t), t);
  for (const t of ['client_access', 'client_access_links', 'client_access_log', 'vault_code', 'vault_unlocks', 'staff', 'payout_deals', 'client_gallery_links', 'whatsapp_consents']) {
    assert.ok(!TABLES.includes(t), t);
  }
  const db = guardDb(fakeClient({}));
  assert.throws(() => db.from('client_access'), /not allowed/);
  assert.throws(() => db.from('vault_code'), /not allowed/);
  assert.equal(db.rpc, undefined, 'no rpc at all: no access_reveal, no vault_unlock');
  assert.throws(() => db.from('clients').select('*'), /name the columns/);
  // The source never names them either.
  const code = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const src = code('../supabase/functions/ask/tools.js') + code('../supabase/functions/ask/handler.js');
  for (const word of ['client_access', 'access_reveal', 'vault_unlock', 'vault_open', 'secret_id', "'phone", 'contact_email', ', notes']) {
    assert.ok(!src.includes(word), word);
  }
});

test('money: out of everything for anyone but the owners', () => {
  const v = withoutMoney({ a: 1, monthly_price_ils: 3500, quotes: { count: 2, signed_monthly_total_ils: 7000, rows: [{ number: 'A', term_total_ils: 1, discount_ils: 2 }] } });
  assert.deepEqual(v, { a: 1, quotes: { count: 2, rows: [{ number: 'A' }] } });
});

// A small office: three clients, tasks, a quote.
const C1 = {
  id: '11111111-1111-4111-8111-111111111111', name: 'רון כהן', business: 'מספרת רון', quote_id: 'q1', package_name: 'Social · נטלי', shoot_type: 'natali',
  editor: 'nadia', editor2: null, deal_at: '2026-03-15T08:00:00Z', char_at: null, shoot_at: '2026-11-15T07:00:00Z', contract_end: '2027-03-15', status: 'active',
  deliverables: { videos: 36, graphics: 36, shoot_days: 1, videos_month: 8, videos_month_except: { '2026-11': 12 } }, rounds: [{ n: 2, shoot_at: '2026-11-17T08:00:00Z', editor: 'yariv' }],
  links: { drive: 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?usp=sharing' }, archived_at: null, landing: false, created_at: '2026-03-15T08:00:00Z',
  phone: '050-0000000', contact_email: 'ron@example.test', notes: 'סיסמה: 1234', address: 'רחוב',
};
const C2 = { ...C1, id: '22222222-2222-4222-8222-222222222222', name: 'קפה נדיה', business: null, quote_id: null, deliverables: { videos: 20 }, rounds: [], links: {}, shoot_at: '2026-12-01T08:00:00Z', editor: 'yariv' };
const C3 = { ...C1, id: '33333333-3333-4333-8333-333333333333', name: 'עסק שהסתיים', business: null, status: 'ended', links: {}, rounds: [], shoot_at: '2026-03-01T08:00:00Z' };
const TABLE_ROWS = {
  clients: [C1, C2, C3],
  client_tasks: [
    { client_id: C1.id, title: 'להשלים חומר', owner: 'lior', due_on: '2026-11-10', done_at: null, urgent: false, created_at: '2026-11-01' },
    { client_id: C2.id, title: 'שיחה', owner: 'irit', due_on: '2026-11-20', done_at: null, urgent: false, created_at: '2026-11-01' },
  ],
  staff_tasks: [{ assignee: 'irit', body: 'להתקשר', client_name: 'רון כהן', client_id: C1.id, status: 'open', created_at: '2026-11-11T08:00:00Z', done_at: null, created_by: null }],
  protocol_checks: [{ client_id: C1.id, item_key: 'p22.edited', state: 'done', at: '2026-11-11T08:00:00Z' }],
  editor_progress: [{ client_id: C1.id, editor: 'nadia', round: 1, edited: 20 }],
  editor_progress_month: [{ client_id: C1.id, editor: 'nadia', month: '2026-11', edited: 5 }],
  client_gantt: [{ client_id: C1.id, kind: 'video', title: 'רילס', day: '2026-11-15', state: 'planned', month: 8, posted_on: null, internal: false, link: null }],
  deal_requests: [{ created_at: '2026-11-05T08:00:00Z', seller: 'stav', business_name: 'פיצה', status: 'signed', signed_at: '2026-11-06T08:00:00Z', discount_agorot: 30000 }],
  quotes: [{ id: 'q1', number: 'AST-1', client_name: 'רון כהן', status: 'signed', created_at: '2026-11-02T08:00:00Z', signed_at: '2026-11-03T08:00:00Z', monthly_gross_agorot: 413000, term_gross_agorot: 4956000 }],
};
const ctxFor = (seesMoney, extra = {}) => {
  const raw = fakeClient(TABLE_ROWS);
  return { raw, ctx: { db: guardDb(raw), seesMoney, drive: null, now: () => NOW, ...extra } };
};
const call = async (ctx, name, input = {}) => JSON.parse((await runTool(ctx, name, input)).content);

test('find_clients: the current clients by default, filters, never phones or notes', async () => {
  const { ctx, raw } = ctxFor(false);
  const all = await call(ctx, 'find_clients');
  assert.equal(all.count, 2);
  assert.equal((await call(ctx, 'find_clients', { status: 'all' })).count, 3);
  assert.equal((await call(ctx, 'find_clients', { status: 'ended' })).count, 1);
  assert.equal((await call(ctx, 'find_clients', { editor: 'נדיה' })).count, 1);
  assert.equal((await call(ctx, 'find_clients', { monthly: true })).count, 1);
  assert.ok(!JSON.stringify(all).includes('050-'));
  for (const r of raw.reads) assert.ok(!/phone|contact_email|notes|address/.test(r.cols), r.cols);
});

test('client_details: what the client is owed this month, edited, late tasks; money for the owners only', async () => {
  const lior = ctxFor(false);
  const d = await call(lior.ctx, 'client_details', { client: 'רון' });
  assert.equal(d.monthly_client.videos_this_month, 12, 'November has its own number');
  assert.equal(d.owed_for_the_whole_agreement.videos, 36);
  assert.equal(d.edited.this_month[0].edited, 5);
  assert.equal(d.late_tasks.length, 1);
  assert.equal(d.rounds[0].round, 2);
  assert.equal(d.agreements, undefined, 'Lior: no agreement, no price');
  assert.ok(!lior.raw.reads.some((r) => r.table === 'quotes'), 'Lior: the quotes are not even read');
  assert.ok(!JSON.stringify(d).includes('1234'), 'the notes are never read');
  const owner = ctxFor(true);
  const o = await call(owner.ctx, 'client_details', { client: 'מספרת רון' });
  assert.equal(o.agreements[0].monthly_price_ils, 4130);
  // Two clients with the same words: a question back.
  const amb = matchClient([C1, { ...C1, id: 'x', name: 'דנה כהן', business: 'סטודיו דנה' }], 'כהן');
  assert.ok(amb.error && amb.candidates.length >= 1);
});

test('sales: counts for Lior, amounts only for the owners', async () => {
  const lior = await call(ctxFor(false).ctx, 'sales', { from: '2026-11-01', to: '2026-11-30' });
  assert.equal(lior.quotes.count, 1);
  assert.equal(lior.field_deals.by_seller['סתיו'], 1);
  assert.ok(!/413|4130|300|discount|price|total/.test(JSON.stringify(lior)), JSON.stringify(lior));
  const liorRun = ctxFor(false);
  await call(liorRun.ctx, 'sales', {});
  assert.ok(liorRun.raw.reads.every((r) => !/agorot/.test(r.cols)), 'the money columns are not asked for');
  const owner = await call(ctxFor(true).ctx, 'sales', { from: '2026-11-01', to: '2026-11-30' });
  assert.equal(owner.quotes.signed_monthly_total_ils, 4130);
});

test('tasks, shoot days, editors, the Gantt, the team', async () => {
  const { ctx } = ctxFor(false);
  const late = await call(ctx, 'tasks', { late_only: true });
  assert.equal(late.client_tasks.count, 1);
  assert.equal(late.client_tasks.rows[0].who, 'ליאור');
  const irit = await call(ctx, 'tasks', { person: 'עירית' });
  assert.equal(irit.client_tasks.count, 1);
  assert.equal(irit.staff_tasks.count, 1);
  const week = await call(ctx, 'shoot_days');
  assert.deepEqual([week.from, week.to], ['2026-11-08', '2026-11-14']);
  const next = await call(ctx, 'shoot_days', { from: '2026-11-15', to: '2026-11-20' });
  assert.deepEqual(next.days.map((x) => [x.day, x.round ?? null]), [['2026-11-15', null], ['2026-11-17', 2]]);
  const eds = await call(ctx, 'editors_progress', { editor: 'נדיה' });
  assert.equal(eds.editors[0].edited_this_month_sum, 5);
  const g = await call(ctx, 'content_gantt', { month: '2026-11' });
  assert.equal(g.count, 1);
  assert.equal((await call(ctx, 'team')).people.some((p) => p.name === 'אופיר'), true);
  assert.equal((await runTool(ctx, 'nope', {})).isError, true);
});

test('drive_files: "הדרייב עוד לא מחובר" without the key; the listing with it', async () => {
  const off = await call(ctxFor(false).ctx, 'drive_files', { client: 'רון' });
  assert.equal(off.error, DRIVE_OFF);
  const drive = { email: 'robot@x.iam.gserviceaccount.com', list: async (id) => { assert.equal(id, '1AbCdEfGhIjKlMnOp'); return { files: [
    { name: '15.11 רילס.mp4', mimeType: 'video/mp4', createdTime: '2026-11-10T10:00:00Z', link: 'https://drive.google.com/file/d/v1/view', path: '' },
    { name: 'לוגו.png', mimeType: 'image/png', createdTime: '2026-10-01T10:00:00Z', link: 'https://drive.google.com/file/d/i1/view', path: 'גרפיקות' },
  ], truncated: false }; } };
  const on = await call(ctxFor(false, { drive }).ctx, 'drive_files', { client: 'רון' });
  assert.equal(on.counts.video, 1);
  assert.equal(on.files[0].name, '15.11 רילס.mp4');
  const since = await call(ctxFor(false, { drive }).ctx, 'drive_files', { client: 'רון', since: '2026-11-01' });
  assert.equal(since.files.length, 1);
  const none = await call(ctxFor(false, { drive }).ctx, 'drive_files', { client: 'קפה נדיה' });
  assert.match(none.error, /אין קישור/);
  const shut = { email: 'robot@x', list: async () => { throw Object.assign(new Error('no_access'), { code: 'no_access' }); } };
  assert.match((await call(ctxFor(false, { drive: shut }).ctx, 'drive_files', { client: 'רון' })).error, /לשתף אותה/);
});

test('a long answer is shortened, never cut mid-JSON', () => {
  const text = fit({ rows: Array.from({ length: 500 }, (_, i) => ({ name: `לקוח ${i}`, x: 'א'.repeat(60) })) });
  assert.ok(text.length <= OUTPUT_MAX);
  assert.ok(JSON.parse(text).rows_cut > 0);
});

// ── The function ───────────────────────────────
class APIConnectionTimeoutError extends Error {}
class AuthenticationError extends Error {}
const Errors = { APIConnectionTimeoutError, AuthenticationError };

function rig({ person = null, office = true, money = person === null, key = 'sk-test', replies = [] } = {}) {
  const sent = [];
  const logs = [];
  const client = fakeClient(TABLE_ROWS, { rpc: { is_office: office, my_person: person, sees_money: money } });
  const handle = makeHandler({
    env: (n) => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon', ANTHROPIC_API_KEY: key })[n],
    createClient: () => client,
    makeClient: () => ({ beta: { messages: { create: async (req) => { sent.push(structuredClone(req)); const r = replies.shift(); if (r instanceof Error) throw r; return r; } } } }),
    Errors,
    now: () => NOW.getTime(),
    log: (m) => logs.push(m),
  });
  const ask = (body, origin = 'http://localhost:8393') => handle(new Request('https://x/functions/v1/ask', {
    method: 'POST', headers: { Authorization: 'Bearer t', origin, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
  return { ask, sent, logs };
}
const toolUse = (name, input, id = 't1') => ({ stop_reason: 'tool_use', content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'tool_use', id, name, input }] });
const final = (text) => ({ stop_reason: 'end_turn', model: MODEL, content: [{ type: 'text', text }] });

test('the function: refuses anyone who is not staff, before any model call', async () => {
  for (const [person, office] of [[null, false], ['editor', false], ['stranger', false]]) {
    const r = rig({ person, office, replies: [final('x')] });
    const res = await r.ask({ question: 'כמה לקוחות?' });
    assert.equal(res.status, 403, String(person));
    assert.equal(r.sent.length, 0);
  }
});

test('the function: a tool round, then the answer; the history goes as text; nothing logged', async () => {
  const r = rig({ person: 'lior', replies: [toolUse('find_clients', {}), final('יש 2 לקוחות פעילים.')] });
  const res = await r.ask({ question: 'כמה לקוחות פעילים יש?', history: [{ q: 'שלום', a: 'היי' }] });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:8393');
  const body = await res.json();
  assert.equal(body.answer, 'יש 2 לקוחות פעילים.');
  assert.deepEqual(body.tools, ['find_clients']);
  assert.equal(r.sent.length, 2);
  const [first, second] = r.sent;
  assert.equal(first.model, MODEL);
  assert.equal(first.output_config.effort, 'low');
  assert.match(first.messages[0].content, /שואל: ליאור/);
  assert.match(first.messages[0].content, /לא רואה כספים/);
  assert.match(first.messages[0].content, /שאלה: שלום/);
  assert.equal(first.system[0].text, SYSTEM, 'the cached prefix never changes');
  assert.deepEqual(first.tools.map((t) => t.name), TOOLS.map((t) => t.name));
  // The model's whole turn goes back (thinking included), then every result in one message.
  assert.equal(second.messages[1].role, 'assistant');
  assert.equal(second.messages[1].content[0].type, 'thinking');
  assert.equal(second.messages[2].content[0].type, 'tool_result');
  assert.equal(JSON.parse(second.messages[2].content[0].content).count, 2);
  assert.deepEqual(r.logs, []);
});

test('the function: the rounds are capped, the last one has no tools', async () => {
  const replies = Array.from({ length: MAX_ROUNDS }, (_, i) => toolUse('team', {}, `t${i}`));
  replies.push(final('סיימתי.'));
  const r = rig({ replies });
  const res = await r.ask({ question: 'מי בצוות?' });
  assert.equal((await res.json()).answer, 'סיימתי.');
  assert.equal(r.sent.length, MAX_ROUNDS + 1);
  assert.deepEqual(r.sent.at(-1).tool_choice, { type: 'none' });
  assert.equal(r.sent[0].tool_choice, undefined);
});

test('the function: no key, a bad question, a timeout, a refusal, the rate', async () => {
  assert.equal((await (await rig({ key: '' }).ask({ question: 'x' })).json()).error, 'ai_not_configured');
  assert.equal((await rig().ask({ question: '  ' })).status, 400);
  const t = rig({ replies: [new APIConnectionTimeoutError('slow')] });
  const tr = await t.ask({ question: 'x' });
  assert.equal(tr.status, 504);
  assert.deepEqual(t.logs, ['ask: ai_timeout (Error)']);
  assert.equal((await (await rig({ replies: [{ stop_reason: 'refusal', content: [] }] }).ask({ question: 'x' })).json()).error, 'ai_refused');
  const many = rig({ replies: Array.from({ length: 20 }, () => final('ok')) });
  const codes = [];
  for (let i = 0; i < 12; i += 1) codes.push((await many.ask({ question: `ש${i}` })).status);
  assert.deepEqual(codes.slice(0, 10), Array(10).fill(200));
  assert.equal(codes[10], 429);
});

test('the same model, sites and request shape as contract-ai', () => {
  assert.equal(MODEL, CONTRACT_MODEL);
  assert.deepEqual(ASK_ORIGINS, AI_ORIGINS);
  const req = buildRequest([{ role: 'user', content: 'x' }]);
  assert.equal(req.fallbacks, 'default');
  assert.deepEqual(req.betas, ['server-side-fallback-2026-07-01']);
  assert.ok(req.tools.at(-1).cache_control);
  assert.ok(!('thinking' in req) && !('temperature' in req));
  assert.match(contextLine(NOW, { seesMoney: true }), /יום חמישי 2026-11-12.*הבעלים.*רואה כספים/);
});

// ── content_owed: every client at once, with the card's own numbers ───
test('content_owed: what each client is still owed, the same numbers as the card\'s summary, the most owed first', async () => {
  const C2b = { ...C2, deliverables: { videos: 20, graphics: 10, done: { videos: 5 } } };
  const C4 = { ...C1, id: '44444444-4444-4444-8444-444444444444', name: 'הכול נמסר', business: null, quote_id: null, rounds: [], deliverables: { videos: 2, done: { videos: 2 } } };
  const tables = {
    ...TABLE_ROWS,
    clients: [C1, C2b, C3, C4],
    client_files: [
      { client_id: C1.id, kind: 'deliverable_video', deleted_at: null },
      { client_id: C1.id, kind: 'deliverable_video', deleted_at: null },
      { client_id: C1.id, kind: 'deliverable_graphic', deleted_at: '2026-11-01T00:00:00Z' },
      { client_id: C2.id, kind: 'contract', deleted_at: null },
    ],
  };
  const raw = fakeClient(tables);
  const ctx = { db: guardDb(raw), seesMoney: false, drive: null, now: () => NOW };
  const out = await call(ctx, 'content_owed');
  // The card: contractSummary(client, clientState(client, checks, now), checks, { files, now }).
  const card = (c) => {
    const checks = Object.fromEntries(TABLE_ROWS.protocol_checks.filter((k) => k.client_id === c.id).map((k) => [k.item_key, k]));
    return contractSummary(c, clientState(c, checks, NOW), checks, { files: fileCounts(tables.client_files, c.id), now: NOW });
  };
  assert.equal(out.clients, 3, 'the current clients (the ended one is out)');
  assert.equal(out.clients_owing, 2, 'the one with everything delivered is not owing');
  assert.deepEqual(out.rows.map((r) => r.name), ['רון כהן (מספרת רון)', 'קפה נדיה']);
  for (const [row, c] of [[out.rows[0], C1], [out.rows[1], C2b]]) {
    assert.deepEqual(row.items, card(c).items.map((x) => ({ what: x.short, done: x.done, in_agreement: x.total, left: x.left })), c.name);
  }
  assert.equal(out.rows[0].items.find((x) => x.what === 'סרטונים').done, 2, 'two deliverable files, the deleted graphic not counted');
  assert.deepEqual(out.rows[1].left, { סרטונים: 15, גרפיקות: 10 });
  // The monthly client: this month's videos against what its editors wrote.
  assert.deepEqual(out.rows[0].this_month, { label: 'נובמבר 2026', videos: 12, edited: 5, left: 7 });
  assert.equal(out.left_overall['סרטונים'], card(C1).items.find((x) => x.key === 'videos').left + 15);
  assert.ok(out.files_counted);
  // Everyone, a short list, a filter.
  assert.equal((await call(ctx, 'content_owed', { only_owing: false })).rows.length, 3);
  const one = await call(ctx, 'content_owed', { limit: 1 });
  assert.equal(one.rows.length, 1);
  assert.equal(one.more, 1);
  assert.deepEqual((await call(ctx, 'content_owed', { editor: 'יריב' })).rows.map((r) => r.name), ['קפה נדיה']);
  // The same answer for the owners: there is no money in it at all.
  const owner = await call({ ...ctx, seesMoney: true }, 'content_owed');
  assert.deepEqual(owner, out);
  // The card's columns only: never the phone, the notes or the contact.
  for (const r of raw.reads) assert.ok(!/phone|contact_email|notes|address/.test(r.cols), r.cols);
  // Without the files table: counted as the card does when it cannot read them.
  const noFiles = fakeClient((t) => (t === 'client_files' ? null : tables[t]));
  noFiles.from = ((from) => (t) => { if (t === 'client_files') return { select: () => ({ order: () => ({ range: () => Promise.reject(new Error('42P01')) }) }) }; return from(t); })(noFiles.from);
  const nf = await call({ ...ctx, db: guardDb(noFiles) }, 'content_owed');
  assert.equal(nf.files_counted, false);
  assert.ok(TOOLS.some((t) => t.name === 'content_owed'));
  assert.match(SYSTEM, /content_owed/);
});

test('content_owed: the marks of a big office are read page by page', async () => {
  const many = Array.from({ length: 2500 }, (_, i) => ({ client_id: C2.id, item_key: `x.${i}`, state: 'done', at: '2026-11-01T00:00:00Z', note: null, by_email: null }));
  const raw = fakeClient({ ...TABLE_ROWS, protocol_checks: many, client_files: [] });
  await call({ db: guardDb(raw), seesMoney: false, drive: null, now: () => NOW }, 'content_owed');
  assert.equal(raw.reads.filter((r) => r.table === 'protocol_checks').length, 3);
});

// ── "איפה…" / "איך…" (docs/ops.md, section 78) ───
test('the function: a how-to goes to app_guide, with the guide of whoever asked (from the database, not the page)', async () => {
  const guideOfReply = async (person, office, question) => {
    const r = rig({ person, office, replies: [toolUse('app_guide', { topic: question }), final('בתפריט ← …')] });
    const res = await r.ask({ question });
    assert.equal(res.status, 200, String(person));
    assert.deepEqual((await res.json()).tools, ['app_guide']);
    return { guide: JSON.parse(r.sent[1].messages[2].content[0].content), first: r.sent[0].messages[0].content };
  };
  // An editor: her own screens, no manager profile, her name in the context line.
  const nadia = await guideOfReply('nadia', false, 'איפה אני רואה את הלקוחות שלי?');
  assert.deepEqual(nadia.guide.manager, []);
  assert.ok(nadia.guide.mine.some((s) => s.label === 'הלקוחות שלי בעריכה'));
  assert.match(nadia.first, /שואל: נדיה/);
  assert.match(nadia.first, /לא רואה כספים/);
  // Ofir: the sent quotes behind "מבט מנהל".
  const ofir = await guideOfReply('ofir', true, 'איפה רואים את העסקאות של החודש?');
  assert.ok(ofir.guide.manager.some((s) => s.id === 'quotes'));
  // The owner: the manager profile, the evening summary.
  const owner = await guideOfReply(null, true, 'מה יש במבט מנהל?');
  assert.ok(owner.guide.howto.some((h) => /סיכום היום/.test(h.path)));
  // A field agent: the deal page and the bot, nothing else.
  const stav = await guideOfReply('stav', false, 'איך שולחים עסקה?');
  assert.deepEqual(stav.guide.mine.map((s) => s.id), ['deal', 'ask']);
  assert.match(stav.first, /שואל: סתיו/);
});

test('the instructions: app_guide for where/how, the clicks and the link, never a screen the person lacks, "מבט מנהל" first', () => {
  assert.match(SYSTEM, /app_guide/);
  assert.match(SYSTEM, /בתפריט ← הצעות שנשלחו/);
  assert.match(SYSTEM, /Never describe a screen/);
  assert.match(SYSTEM, /"מבט מנהל" button/);
  assert.match(SYSTEM, /app_links/);
  assert.ok(TOOLS.map((t) => t.name).includes('app_guide'));
});

test('a client\'s own pages: client_details and a search by name give the card and the Gantt', async () => {
  const { ctx } = ctxFor(false);
  const d = await call(ctx, 'client_details', { client: 'רון' });
  assert.deepEqual(d.app_links, { card: `https://app.astrateg.tech/client.html?id=${C1.id}`, gantt: `https://app.astrateg.tech/gantt.html?id=${C1.id}` });
  const found = await call(ctx, 'find_clients', { name: 'רון' });
  assert.equal(found.clients[0].app_links.gantt, `https://app.astrateg.tech/gantt.html?id=${C1.id}`);
  assert.equal((await call(ctx, 'find_clients')).clients[0].app_links, undefined, 'a plain list stays short');
});
