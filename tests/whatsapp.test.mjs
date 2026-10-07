// The staff WhatsApp channel (stage 4): the templates as data (Meta's rules), which
// template a reminder takes, the channel choice (agreed, the same number, the
// sending hours), the sender against a fake fetch, the reminders tick with the
// second channel (each reminder once, never outside the hours), the webhook's
// signature and subscription checks, and what a reply button does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  TEMPLATES, FOOTER, BUTTONS, OPEN_BUTTON, SITE_URL, metaDefinition, templateFor, templateMessage, cleanParam, pagePath,
  payloadOf, parsePayload, actionOfText, taskIdOf, simpleTask,
} from '../app/wa-templates.js';
import { waRecipients, waPlan, replyPlan, isStop, ackText, ownsProcess } from '../app/wa-logic.js';
import { graphSend, graphUrl, GRAPH_VERSION } from '../supabase/functions/_shared/wa-graph.js';
import { makeWhatsapp } from '../supabase/functions/reminders/whatsapp.js';
import { runTick } from '../supabase/functions/reminders/tick.js';
import {
  verifySignature, verifyChallenge, timingSafeEqual, parseEvents, handleEvents,
} from '../supabase/functions/whatsapp-webhook/webhook.js';
import { dateIL } from '../app/tz.js';

const IL = (y, m, d, h = 0, mi = 0) => dateIL(y, m, d, h, mi);
const TASK = '0b6f3a52-6d8c-4a7e-9d0e-3f1c2b4a5d6e';
const log = (over = {}) => ({ id: 41, key: 'deal:c1:deal:now@irit', rule: 'deal', person: 'irit', level: 'ring', client_id: 'c1', ref: 'p01', title: 'עסקה חדשה: פיצה', body: 'חסר חוזה', url: 'client.html?id=c1#p01', ...over });

// ── The templates ───────────────────────────
test('every template follows Meta\'s rules: variables inside the text, short buttons and footer, examples for each variable', () => {
  assert.ok(Object.keys(TEMPLATES).length >= 6 && Object.keys(TEMPLATES).length <= 9);
  for (const [key, t] of Object.entries(TEMPLATES)) {
    assert.match(t.name, /^astrateg_[a-z_]+$/, key);
    const vars = [...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
    assert.deepEqual(vars, [1, 2], key);
    assert.ok(!/^\s*\{\{/.test(t.body) && !/\}\}\s*$/.test(t.body), `${key}: a variable at the start or the end`);
    assert.equal(t.example.length, 2, key);
    // At the longest variables (200 + 700) the body is still under Meta's 1024.
    assert.ok(t.body.length + 200 + 700 < 1024, key);
    for (const r of t.replies) assert.ok(BUTTONS[r].length <= 25, r);
    const def = metaDefinition(key);
    assert.equal(def.category, 'UTILITY');
    assert.equal(def.language, 'he');
    const buttons = def.components.find((c) => c.type === 'BUTTONS').buttons;
    // Quick replies first, then the link to the app.
    assert.deepEqual(buttons.map((b) => b.type), [...t.replies.map(() => 'QUICK_REPLY'), 'URL']);
    assert.equal(buttons.at(-1).url, `${SITE_URL}{{1}}`);
    assert.equal(buttons.at(-1).text, OPEN_BUTTON);
  }
  assert.ok(FOOTER.length <= 60 && /הסר/.test(FOOTER));
  // "בוצע" only on simple items; approvals and quality control have no quick replies.
  assert.deepEqual(Object.entries(TEMPLATES).filter(([, t]) => t.replies.includes('done')).map(([k]) => k), ['new_task']);
  assert.deepEqual(TEMPLATES.review.replies, []);
  for (const k of ['תקציר', 'משימה חדשה', 'מועד', 'איחור', 'חריגה', 'יום צילום', 'עורך שויך', 'תקציר בעלים']) {
    assert.ok(Object.values(TEMPLATES).some((t) => t.label === k), k);
  }
});

test('a variable is one clean line (no line breaks, tabs or runs of spaces), clipped, never empty', () => {
  assert.equal(cleanParam('באיחור: פיצה\nהיום: בורגר\n\nועוד'), 'באיחור: פיצה · היום: בורגר · ועוד');
  assert.equal(cleanParam('a\tb     c'), 'a b c');
  assert.equal(cleanParam(''), 'הפרטים במערכת.');
  assert.equal(cleanParam('x'.repeat(900)).length, 700);
  assert.ok(cleanParam('x'.repeat(900)).endsWith('…'));
  assert.equal(pagePath('client.html?id=c1#p01'), 'client.html?id=c1');
  assert.equal(pagePath('clients.html#mine'), 'clients.html');
  assert.equal(pagePath('https://evil.test/x'), 'clients.html');
  assert.equal(pagePath('prep.html?id=c1#requests'), 'prep.html?id=c1');
});

test('which template a reminder takes', () => {
  const t = (key, rule, extra = {}, task = null) => templateFor({ key, rule, person: 'irit', ...extra }, task);
  assert.equal(t('digest:morning:irit:2026-10-05', 'digest'), 'digest');
  assert.equal(templateFor({ key: 'digest:owner18:owner:2026-10-08', rule: 'digest', person: 'owner' }), 'owner_digest');
  assert.equal(t('qa:c1:p25@x:now@ofir', 'qa'), 'review');
  assert.equal(t('approved:c1:p25:irit@irit', 'approved'), 'review');
  assert.equal(t('editing:c1:p22:assigned@nadia', 'editing'), 'editor_assigned');
  assert.equal(t('editing:c1:p22:nostart@nadia', 'editing'), 'late');
  const simple = { id: TASK, owner: 'irit', source: null, brief: null };
  assert.equal(t(`urgent:c1:${TASK}:now@irit`, 'urgent', {}, simple), 'new_task');
  assert.equal(t(`urgent:c1:${TASK}:now@irit`, 'urgent', {}, { ...simple, brief: { problem: 'x' } }), 'due');
  assert.equal(t(`urgent:c1:${TASK}:now@lior`, 'urgent', {}, { ...simple, source: 'escalation' }), 'exception');
  assert.equal(t(`urgent:c1:${TASK}:lior@lior`, 'urgent', {}, simple), 'exception');
  assert.equal(t(`exception:c1:${TASK}:nobody@lior`, 'exception'), 'exception');
  assert.equal(t('eve:c1:p15:1115@irit', 'eve'), 'shoot_day');
  assert.equal(t('deal:c1:deal:now@irit', 'deal'), 'due');
  assert.equal(taskIdOf({ rule: 'urgent', key: `urgent:c1:${TASK}:now@irit` }), TASK);
  assert.equal(taskIdOf({ rule: 'deal', key: 'deal:c1:deal:now@irit' }), null);
  assert.ok(simpleTask(simple) && !simpleTask({ ...simple, source: 'escalation' }) && !simpleTask({ ...simple, source: 'pause' }) && !simpleTask(null));
});

test('the Cloud API message: the variables, a payload per quick reply naming the reminder, and the page for the link', () => {
  const m = templateMessage({ template: 'due', to: '972501234567', row: log() });
  assert.equal(m.messaging_product, 'whatsapp');
  assert.equal(m.to, '972501234567');
  assert.deepEqual(m.template.language, { code: 'he' });
  assert.equal(m.template.name, 'astrateg_due');
  const [body, onit, help, link] = m.template.components;
  assert.deepEqual(body.parameters, [{ type: 'text', text: 'עסקה חדשה: פיצה' }, { type: 'text', text: 'חסר חוזה' }]);
  assert.deepEqual([onit.sub_type, onit.index, onit.parameters[0].payload], ['quick_reply', '0', 'wa1:onit:41']);
  assert.deepEqual([help.index, help.parameters[0].payload], ['1', 'wa1:help:41']);
  assert.deepEqual([link.sub_type, link.index, link.parameters[0].text], ['url', '2', 'client.html?id=c1']);
  // A digest: its lines on one line, only the link.
  const d = templateMessage({ template: 'digest', to: '972501234567', row: log({ rule: 'digest', title: 'תקציר בוקר', body: 'באיחור: פיצה\nהיום: בורגר', url: 'clients.html#mine' }) });
  assert.equal(d.template.components[0].parameters[1].text, 'באיחור: פיצה · היום: בורגר');
  assert.deepEqual(d.template.components.slice(1).map((c) => c.sub_type), ['url']);
  assert.deepEqual(parsePayload('wa1:help:41'), { action: 'help', logId: 41 });
  assert.equal(parsePayload('wa1:drop:41'), null);
  assert.equal(parsePayload(payloadOf('done', 7)).action, 'done');
  assert.equal(actionOfText('צריך עזרה'), 'help');
});

// ── Who gets WhatsApp, and when ─────────────
test('the channel choice: agreed, and the number is still the one agreed to (the owner\'s is on the consent)', () => {
  const r = waRecipients([
    { email: 'irit@x', person: 'irit', status: 'granted', consent_phone: '972501111111', staff_phone: '972501111111' },
    { email: 'lior@x', person: 'lior', status: 'granted', consent_phone: '972502222222', staff_phone: '972509999999' }, // changed since
    { email: 'ofir@x', person: 'ofir', status: 'declined', consent_phone: '972503333333', staff_phone: '972503333333' },
    { email: 'owner@x', person: 'owner', status: 'granted', consent_phone: '972504444444', staff_phone: null },
    { email: 'nadia@x', person: 'nadia', status: 'granted', consent_phone: '031234567', staff_phone: '031234567' },
  ]);
  assert.deepEqual([...r.keys()].sort(), ['irit', 'owner']);
  assert.deepEqual(r.get('owner'), { email: 'owner@x', phone: '972504444444' });
  const irit = r.get('irit');
  const mon10 = IL(2026, 10, 5, 10);
  assert.deepEqual(waPlan({ row: log(), kind: 'ring', now: mon10, recipient: irit }), { template: 'due', to: '972501111111' });
  assert.deepEqual(waPlan({ row: log(), kind: 'ring', now: mon10, recipient: null }), { skip: 'no_consent' });
  // Rings, updates (level 'quiet': pushed like a ring since 7.10.2026, so copied like
  // one, with the template a ring of that rule gets) and digests; never a test, nor a
  // line that is not pushed by itself (a digest line, the owner's board).
  assert.deepEqual(waPlan({ row: log({ level: 'quiet' }), kind: 'ring', now: mon10, recipient: irit }), { template: 'due', to: '972501111111' });
  assert.equal(waPlan({ row: log({ level: 'digest' }), kind: 'ring', now: mon10, recipient: irit }).skip, 'kind');
  assert.equal(waPlan({ row: log({ level: 'board' }), kind: 'ring', now: mon10, recipient: irit }).skip, 'kind');
  assert.equal(waPlan({ row: log(), kind: 'test', now: mon10, recipient: irit }).skip, 'kind');
  assert.equal(waPlan({ row: log({ rule: 'digest', level: 'digest' }), kind: 'digest', now: mon10, recipient: irit }).template, 'digest');
  // The consent's hours: not at 20:00 (a shoot-day ring goes by push alone), not on
  // Saturday, not after 13:00 on erev chag, and from 08:30.
  const shoot = log({ key: 'briefing:c1:p16:2000@lior', rule: 'briefing' });
  assert.equal(waPlan({ row: shoot, kind: 'ring', now: IL(2026, 10, 5, 20), recipient: irit }).skip, 'quiet_hours');
  assert.equal(waPlan({ row: log(), kind: 'ring', now: IL(2026, 10, 10, 11), recipient: irit }).skip, 'quiet_hours');
  assert.equal(waPlan({ row: log(), kind: 'ring', now: IL(2027, 4, 21, 14), recipient: irit }).skip, 'quiet_hours'); // erev Pesach 2027
  assert.equal(waPlan({ row: log(), kind: 'ring', now: IL(2026, 10, 5, 8, 29), recipient: irit }).skip, 'quiet_hours');
  assert.ok(waPlan({ row: log(), kind: 'ring', now: IL(2026, 10, 5, 8, 30), recipient: irit }).template);
});

// ── The sender ──────────────────────────────
test('the sender posts the message with the token in the header only, and returns Meta\'s id or a short error', async () => {
  const calls = [];
  const answer = { status: 200, body: { messages: [{ id: 'wamid.ABC' }] } };
  const fetch = async (url, init) => { calls.push({ url, init }); return { ok: answer.status < 300, status: answer.status, json: async () => answer.body }; };
  const message = templateMessage({ template: 'due', to: '972501234567', row: log() });
  const ok = await graphSend({ fetch, token: 'SECRET-TOKEN-1234567890', phoneNumberId: '1234567890', message });
  assert.deepEqual(ok, { ok: true, id: 'wamid.ABC' });
  assert.equal(calls[0].url, `https://graph.facebook.com/${GRAPH_VERSION}/1234567890/messages`);
  assert.equal(calls[0].url, graphUrl('1234567890'));
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer SECRET-TOKEN-1234567890');
  assert.deepEqual(JSON.parse(calls[0].init.body), message);
  Object.assign(answer, { status: 400, body: { error: { code: 131047, message: 'Re-engagement message to +972501234567, token SECRET-TOKEN-1234567890' } } });
  const bad = await graphSend({ fetch, token: 'SECRET-TOKEN-1234567890', phoneNumberId: '1234567890', message });
  assert.deepEqual(bad, { ok: false, status: 400, error: 'graph 400 #131047' });
  assert.doesNotMatch(JSON.stringify(bad), /SECRET|9725/);
  const down = await graphSend({ fetch: async () => { throw new TypeError('fetch failed'); }, token: 't'.repeat(30), phoneNumberId: '1234567890', message });
  assert.deepEqual(down, { ok: false, status: 0, error: 'network' });
  assert.equal((await graphSend({ fetch, token: '', phoneNumberId: '1234567890', message })).error, 'not_configured');
  assert.equal((await graphSend({ fetch, token: 't', phoneNumberId: '../x', message })).error, 'not_configured');
});

// ── The tick with the second channel ────────
const STAFF = [{ email: 'owner@x', person: null }, { email: 'irit@x', person: 'irit' }, { email: 'lior@x', person: 'lior' }, { email: 'ofir@x', person: 'ofir' }];
function fakeDb({ clients = [], subs = [] } = {}) {
  let clock = new Date();
  const db = {
    log: [], nextId: 1, subs,
    at(now) { clock = now; return db; },
    async load() { return { clients, checks: [], tasks: [], staff: STAFF, access: [], reviews: [], statusNotes: [], messages: [], subscriptions: db.subs, log: db.log.map((r) => ({ ...r })) }; },
    async known(keys) { const set = new Set(keys); return new Set(db.log.map((r) => r.key).filter((k) => set.has(k))); },
    async insertLog(rows) {
      const out = [];
      for (const r of rows) {
        if (db.log.some((x) => x.key === r.key)) continue;
        const row = { id: db.nextId++, created_at: clock.toISOString(), claimed_at: clock.toISOString(), attempts: 0, read_at: null, digest_key: null, ...r };
        db.log.push(row);
        out.push({ ...row });
      }
      return out;
    },
    async reclaim(before) {
      const out = [];
      for (const r of db.log) if (r.status === 'pending' && new Date(r.claimed_at) < before) { Object.assign(r, { claimed_at: clock.toISOString(), attempts: r.attempts + 1 }); out.push({ ...r }); }
      return out;
    },
    async updateLog(ids, patch) { for (const r of db.log) if (ids.includes(r.id)) Object.assign(r, patch); },
    async subscriptionOk() {}, async subscriptionFailed() {}, async removeSubscription() {},
  };
  return db;
}
function fakeWa({ recipients, answer = () => ({ ok: true, id: `wamid.${Math.random().toString(36).slice(2)}` }) }) {
  const rows = [];
  const sent = [];
  const db = {
    async claim(row) { if (rows.some((r) => r.log_id === row.log_id)) return null; const r = { id: rows.length + 1, created_at: new Date().toISOString(), ...row }; rows.push(r); return { id: r.id }; },
    async update(id, patch) { Object.assign(rows.find((r) => r.id === id), patch); },
    async expire(before) { let n = 0; for (const r of rows) if (r.status === 'pending' && new Date(r.created_at) < before) { Object.assign(r, { status: 'failed', error: 'lost' }); n += 1; } return n; },
  };
  const send = async (m) => { sent.push(m); return answer(m); };
  return { wa: makeWhatsapp({ db, send, recipients: waRecipients(recipients) }), rows, sent };
}
const deal = (at, name = 'פיצה') => ({
  id: 'c1', name, status: 'active', shoot_type: 'dms', characterizer: 'ofir', has_logo: true, rounds: [], contract_end: '2027-12-31', deal_at: at.toISOString(),
});
const push = async () => ({ ok: true, status: 201 });
const IRIT_OK = [{ email: 'irit@x', person: 'irit', status: 'granted', consent_phone: '972501111111', staff_phone: '972501111111' }];

test('a ring goes by push and, for whoever agreed, once by WhatsApp; not again on the next tick', async () => {
  const db = fakeDb({ clients: [deal(IL(2026, 10, 5, 10))], subs: [{ id: 's1', email: 'irit@x', endpoint: 'https://push.test/p', p256dh: 'x', auth: 'y', fail_count: 0 }] });
  const { wa, rows, sent } = fakeWa({ recipients: IRIT_OK });
  const t0 = IL(2026, 10, 5, 10);
  const stats = await runTick({ db: db.at(t0), push, wa, now: t0 });
  assert.equal(stats.pushed, 1);
  assert.equal(stats.waSent, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, '972501111111');
  assert.equal(sent[0].template.name, 'astrateg_due');
  const logRow = db.log.find((r) => r.key === 'deal:c1:deal:now@irit');
  assert.deepEqual([rows[0].log_id, rows[0].status, rows[0].template, rows[0].person], [logRow.id, 'sent', 'due', 'irit']);
  assert.match(rows[0].wa_message_id, /^wamid\./);
  // Lior's step at 10:30 is pushed only (he did not agree).
  const t1 = IL(2026, 10, 5, 10, 1);
  await runTick({ db: db.at(t1), push, wa, now: t1 });
  assert.equal(sent.length, 1);
  // The same reminder taken again (a stopped tick) finds its claim: not sent twice.
  await wa.deliver({ sends: [{ row: logRow, kind: 'ring' }], env: { tasks: [] }, now: t1, stats: {} });
  assert.equal(sent.length, 1);
});

test('outside the hours nothing goes on WhatsApp; the 08:30 digest does; a failed send is recorded', async () => {
  const db = fakeDb({ clients: [deal(IL(2026, 10, 4, 22), 'לילה')] });
  let fail = true;
  const { wa, rows, sent } = fakeWa({ recipients: IRIT_OK, answer: () => (fail ? { ok: false, status: 400, error: 'graph 400 #132000' } : { ok: true, id: 'wamid.D' }) });
  const night = IL(2026, 10, 4, 22);
  const s1 = await runTick({ db: db.at(night), push, wa, now: night });
  assert.equal(sent.length, 0);
  assert.equal(s1.waSent, 0);
  const morning = IL(2026, 10, 5, 8, 30);
  const s2 = await runTick({ db: db.at(morning), push, wa, now: morning });
  const digest = sent.find((m) => m.template.name === 'astrateg_digest');
  assert.ok(digest, JSON.stringify(sent.map((m) => m.template.name)));
  assert.equal(digest.template.components[0].parameters[0].text, 'תקציר בוקר');
  assert.doesNotMatch(digest.template.components[0].parameters[1].text, /\n/);
  assert.equal(s2.waFailed, 1);
  assert.deepEqual([rows[0].status, rows[0].error], ['failed', 'graph 400 #132000']);
  fail = false;
});

// The owner's rule of 7.10.2026: an update is pushed like a ring, so it is copied like
// one; a batch of lateness notes is a digest. No new template: the nine there were.
test('an update and a batch of lateness notes go on WhatsApp with the templates there already were, once each', async () => {
  const { wa, rows, sent } = fakeWa({ recipients: IRIT_OK });
  const now = IL(2026, 10, 5, 10);
  const update = log({ id: 51, key: 'stationChange:c1:p11:irit@irit', rule: 'stationChange', level: 'quiet', ref: null, title: 'פיצה עבר/ה לשלב צילום', body: 'לשלוח בקבוצה: היי' });
  const done = log({ id: 52, key: 'task:c1:t7:created@irit', rule: 'task', level: 'quiet', ref: null, title: 'משימה חדשה: פיצה', body: 'לשלוח חשבונית' });
  const batch = log({ id: 53, key: 'digest:late:irit:2026-10-05:50', rule: 'digest', level: 'digest', ref: null, client_id: null, title: '3 איחורים חדשים', body: 'א · 12 · תסריטים · ליאור\nב · 7 · גרפיקות · עילאי\nג · 8 · Highlights · אופיר', url: 'clients.html#mine' });
  const stats = {};
  await wa.deliver({ sends: [{ row: update, kind: 'ring' }, { row: done, kind: 'ring' }, { row: batch, kind: 'digest' }], env: { tasks: [] }, now, stats });
  assert.equal(stats.waSent, 3);
  assert.deepEqual(rows.map((r) => [r.log_id, r.template]).sort(), [[51, 'due'], [52, 'due'], [53, 'digest']]);
  const b = sent.find((m) => m.template.name === 'astrateg_digest');
  assert.equal(b.template.components[0].parameters[0].text, '3 איחורים חדשים');
  assert.doesNotMatch(b.template.components[0].parameters[1].text, /\n/);
  assert.deepEqual(new Set(sent.map((m) => m.template.name)), new Set(['astrateg_due', 'astrateg_digest']));
  assert.equal(Object.keys(TEMPLATES).length, 9);
  // Again (a tick taken again): each finds its claim.
  await wa.deliver({ sends: [{ row: update, kind: 'ring' }, { row: batch, kind: 'digest' }], env: { tasks: [] }, now, stats: {} });
  assert.equal(sent.length, 3);
  // Outside the consent's hours an update is not copied, like a ring.
  const night = fakeWa({ recipients: IRIT_OK });
  await night.wa.deliver({ sends: [{ row: { ...update, id: 61 }, kind: 'ring' }], env: { tasks: [] }, now: IL(2026, 10, 5, 20), stats: {} });
  assert.equal(night.sent.length, 0);
});

// ── Replies ─────────────────────────────────
test('what a button does: "אני על זה" starts the person\'s task or claims their process, "צריך עזרה" goes to Lior, "בוצע" closes a simple task', () => {
  const task = { id: TASK, owner: 'irit', done_at: null, source: null, brief: null };
  const urgent = log({ key: `urgent:c1:${TASK}:now@irit`, rule: 'urgent', ref: null, title: 'משימה דחופה: פיצה' });
  const m = (template) => ({ id: 5, log_id: urgent.id, template });
  assert.deepEqual(replyPlan({ action: 'onit', log: urgent, message: m('new_task'), task }), { op: 'task_start', task: TASK });
  assert.deepEqual(replyPlan({ action: 'onit', log: urgent, message: m('new_task'), task: { ...task, owner: 'ilai' } }), { op: 'none', why: 'not_owner' });
  assert.deepEqual(replyPlan({ action: 'done', log: urgent, message: m('new_task'), task }), { op: 'task_done', task: TASK });
  assert.deepEqual(replyPlan({ action: 'done', log: urgent, message: m('new_task'), task: { ...task, brief: { route: 'irit' } } }), { op: 'none', why: 'not_simple' });
  // A button the message did not have (a forged payload) does nothing.
  assert.deepEqual(replyPlan({ action: 'done', log: urgent, message: m('due'), task }), { op: 'none', why: 'no_button' });
  assert.deepEqual(replyPlan({ action: 'onit', log: log({ rule: 'qa' }), message: m('review') }), { op: 'none', why: 'no_button' });
  // A process: only its owner claims it, as in the app (editors through 'editor').
  assert.deepEqual(replyPlan({ action: 'onit', log: log(), message: m('due') }), { op: 'claim', item: 'p01.claim' });
  assert.deepEqual(replyPlan({ action: 'onit', log: log({ person: 'lior' }), message: m('due') }), { op: 'none', why: 'not_owner' });
  const client = { id: 'c1', editor: 'yariv', rounds: [{ n: 2, editor: 'nadia', shoot_at: '2026-11-01T08:00:00Z' }] };
  assert.deepEqual(replyPlan({ action: 'onit', log: log({ person: 'nadia', ref: 'r2.p22' }), message: m('editor_assigned'), client }), { op: 'claim', item: 'r2.p22.claim' });
  assert.deepEqual(replyPlan({ action: 'onit', log: log({ person: 'nadia', ref: 'p22' }), message: m('editor_assigned'), client }), { op: 'none', why: 'not_owner' });
  assert.ok(ownsProcess('p22', 'yariv', client) && !ownsProcess('p22', 'yariv') && !ownsProcess('r3.p22', 'nadia', client));
  assert.ok(ownsProcess('p01', 'irit') && !ownsProcess('p01', 'lior') && !ownsProcess('p99', 'irit') && !ownsProcess('x', 'irit'));
  const help = replyPlan({ action: 'help', log: log(), message: m('due') });
  assert.deepEqual(help, { op: 'help', title: 'צריך עזרה (עירית): עסקה חדשה: פיצה' });
  assert.deepEqual(replyPlan({ action: 'help', log: log({ client_id: null }), message: m('due') }), { op: 'none', why: 'no_client' });
  assert.deepEqual(replyPlan({ action: 'onit', log: null, message: null }), { op: 'none', why: 'unknown' });
  for (const w of ['הסר', ' הסירו ', 'עצור', 'STOP', 'Stop.', 'הסר!']) assert.ok(isStop(w), w);
  for (const w of ['הסרט מוכן', 'לא', '']) assert.ok(!isStop(w), w);
  assert.match(ackText('help'), /ליאור/);
  assert.equal(ackText('duplicate'), null);
  assert.match(ackText('none'), /לא נרשם שינוי/);
});

// ── The webhook ─────────────────────────────
const SECRET = 'app-secret-for-tests-0123456789';
const sign = (body, secret = SECRET) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

test('the webhook signature: HMAC-SHA256 of the raw body with the app secret, compared in constant time', async () => {
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
  assert.equal(await verifySignature({ secret: SECRET, body, header: sign(body) }), true);
  assert.equal(await verifySignature({ secret: SECRET, body: new TextEncoder().encode(body), header: sign(body).toUpperCase().replace('SHA256=', 'sha256=') }), true);
  assert.equal(await verifySignature({ secret: SECRET, body: `${body} `, header: sign(body) }), false, 'the body changed');
  assert.equal(await verifySignature({ secret: 'another-secret-0000000000', body, header: sign(body) }), false);
  assert.equal(await verifySignature({ secret: SECRET, body, header: sign(body).replace('sha256=', 'sha1=') }), false);
  assert.equal(await verifySignature({ secret: SECRET, body, header: 'sha256=' }), false);
  assert.equal(await verifySignature({ secret: SECRET, body, header: null }), false);
  assert.equal(await verifySignature({ secret: '', body, header: sign(body, '') }), false, 'no secret, nothing passes');
  assert.ok(timingSafeEqual('abc', 'abc') && !timingSafeEqual('abc', 'abd') && !timingSafeEqual('abc', 'abcd') && !timingSafeEqual('', 'a'));
});

test('the subscription check echoes the challenge only for the right token', () => {
  const p = (o) => new URLSearchParams(o);
  assert.deepEqual(verifyChallenge(p({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-token-1234567', 'hub.challenge': '1158201444' }), 'verify-token-1234567'), { status: 200, body: '1158201444' });
  assert.equal(verifyChallenge(p({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '1' }), 'verify-token-1234567').status, 403);
  assert.equal(verifyChallenge(p({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-token-1234567', 'hub.challenge': '<script>' }), 'verify-token-1234567').status, 403);
  assert.equal(verifyChallenge(p({ 'hub.mode': 'subscribe', 'hub.verify_token': '', 'hub.challenge': '1' }), '').status, 403);
});

const change = (value, phoneNumberId = '1234567890') => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: phoneNumberId }, ...value } }] }],
});

test('the events of a POST: delivery updates, buttons (payload or text), "הסר"; another number is ignored', () => {
  const ev = parseEvents(change({
    statuses: [
      { id: 'wamid.1', status: 'delivered', timestamp: '1791187200', recipient_id: '972501111111' },
      { id: 'wamid.2', status: 'failed', timestamp: '1791187200', errors: [{ code: 131026, title: 'undeliverable' }] },
      { id: 'wamid.3', status: 'deleted' },
    ],
    messages: [
      { id: 'in.1', from: '972501111111', type: 'button', context: { id: 'wamid.1' }, button: { payload: 'wa1:onit:41', text: 'אני על זה' } },
      { id: 'in.2', from: '972501111111', type: 'button', context: { id: 'wamid.1' }, button: { text: 'צריך עזרה' } },
      { id: 'in.3', from: '972501111111', type: 'text', text: { body: 'הסר' } },
      { id: 'in.4', from: '972501111111', type: 'text', text: { body: 'תודה' } },
    ],
  }), '1234567890');
  assert.deepEqual(ev.statuses.map((s) => [s.id, s.status, s.error]), [['wamid.1', 'delivered', null], ['wamid.2', 'failed', 'meta #131026']]);
  assert.equal(ev.statuses[0].at.toISOString(), new Date(1791187200e3).toISOString());
  assert.deepEqual(ev.replies, [
    { id: 'in.1', from: '972501111111', context: 'wamid.1', action: 'onit', logId: 41 },
    { id: 'in.2', from: '972501111111', context: 'wamid.1', action: 'help', logId: null },
  ]);
  assert.deepEqual(ev.stops, [{ id: 'in.3', from: '972501111111' }]);
  assert.deepEqual(parseEvents(change({ statuses: [{ id: 'w', status: 'read' }] }, '999'), '1234567890'), { statuses: [], replies: [], stops: [] });
  assert.deepEqual(parseEvents({ object: 'page' }, '1234567890'), { statuses: [], replies: [], stops: [] });
});

test('replies are applied through the database once, with a short answer; a reply naming another reminder does nothing', async () => {
  const applied = [];
  const answers = [];
  const seen = new Set();
  const task = { id: TASK, owner: 'irit', done_at: null, source: null, brief: null };
  const urgent = log({ id: 41, key: `urgent:c1:${TASK}:now@irit`, rule: 'urgent', ref: null });
  const db = {
    async status() { return true; },
    async messageByWaId(id) { return id === 'wamid.1' ? { id: 5, log_id: 41, person: 'irit', phone: '972501111111', template: 'new_task' } : null; },
    async logRow(id) { return id === 41 ? urgent : null; },
    async task(id) { return id === TASK ? task : null; },
    async client() { return null; },
    async apply({ inbound, message, from, plan }) {
      applied.push({ inbound, message, from, plan });
      if (seen.has(inbound)) return 'duplicate';
      seen.add(inbound);
      return { task_start: 'started', help: 'help', withdraw: 'withdrawn' }[plan.op] || 'none';
    },
  };
  const send = async (m) => { answers.push(m); return { ok: true, id: 'x' }; };
  const events = parseEvents(change({
    messages: [
      { id: 'in.1', from: '972501111111', type: 'button', context: { id: 'wamid.1' }, button: { payload: 'wa1:onit:41' } },
      { id: 'in.1', from: '972501111111', type: 'button', context: { id: 'wamid.1' }, button: { payload: 'wa1:onit:41' } },
      { id: 'in.2', from: '972501111111', type: 'button', context: { id: 'wamid.1' }, button: { payload: 'wa1:help:99' } },
      { id: 'in.3', from: '972501111111', type: 'text', text: { body: 'הסר' } },
    ],
  }), '1234567890');
  const done = await handleEvents({ db, events, send });
  assert.deepEqual(applied.map((a) => [a.inbound, a.message, a.plan.op]), [['in.1', 5, 'task_start'], ['in.1', 5, 'task_start'], ['in.2', 5, 'none'], ['in.3', null, 'withdraw']]);
  assert.deepEqual(applied[0].plan, { op: 'task_start', task: TASK });
  assert.equal(applied[2].plan.why, 'mismatch');
  assert.deepEqual(done.replies.map((r) => r.result), ['started', 'duplicate', 'none']);
  // One answer per applied reply (none for the repeat), as text to the sender.
  assert.deepEqual(answers.map((a) => [a.to, a.type]), [['972501111111', 'text'], ['972501111111', 'text'], ['972501111111', 'text']]);
  assert.match(answers[0].text.body, /אני על זה/);
  assert.match(answers[2].text.body, /הופסקו/);
  // While WhatsApp is off (no sender), replies are still applied, silently.
  await handleEvents({ db, events: parseEvents(change({ messages: [{ id: 'in.9', from: '972501111111', type: 'text', text: { body: 'stop' } }] }), '1234567890'), send: null });
  assert.equal(applied.at(-1).plan.op, 'withdraw');
});
