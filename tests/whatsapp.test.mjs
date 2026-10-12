// The staff WhatsApp channel (stage 4): the templates as data (Meta's rules), which
// template a reminder takes, the channel choice (agreed, the same number, the
// sending hours), the sender against a fake fetch, the reminders tick with the
// second channel (each reminder once, never outside the hours), the webhook's
// signature and subscription checks, and what a reply button does. Then the second
// provider, Jako: its three templates, its sender against a fake fetch (retries,
// timeouts, the key never in an error), the tick through it, "הסר" heard by asking,
// and the reply buttons, which come as a call from Jako's sub flows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  TEMPLATES, FOOTER, BUTTONS, OPEN_BUTTON, SITE_URL, metaDefinition, templateFor, templateMessage, cleanParam, pagePath,
  payloadOf, parsePayload, actionOfText, taskIdOf, simpleTask,
  WA_PROVIDERS, JAKO_TEMPLATES, JAKO_BUTTONS, JAKO_MAX, jakoDefinition, jakoTemplateFor, jakoMessage, jakoFirstName, jakoUserId, jakoUrlParam,
} from '../app/wa-templates.js';
import {
  waRecipients, waPlan, replyPlan, isStop, ackText, ownsProcess,
  hookPhone, hookAction, hookAnswer, jakoOpen, jakoReplyPlan, jakoTitle, nagIdOf, MINE_LINK,
} from '../app/wa-logic.js';
import { hookGate, parseHook, jakoReply, HOOK_HEADER, HOOK_MAX_BODY, PRESS_WINDOW } from '../supabase/functions/whatsapp-webhook/jako-hook.js';
import { graphSend, graphUrl, GRAPH_VERSION } from '../supabase/functions/_shared/wa-graph.js';
import { makeJako, JAKO_BASE, JAKO_TIMEOUT, JAKO_BUDGET, LIST_AGAIN, LEARN_PAUSE } from '../supabase/functions/_shared/wa-jako.js';
import { applyPress, applyReply } from '../supabase/functions/_shared/wa-jako-reply.js';
import { makeWhatsapp } from '../supabase/functions/reminders/whatsapp.js';
import { makeJakoWhatsapp, POLL_EVERY, POLL_MAX, PRESS_GRACE } from '../supabase/functions/reminders/wa-poll.js';
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

// ── The second provider: Jako ───────────────
// docs/ops.md, section 63. Jako's API as a fake fetch: the templates' list (the
// namespaces), the send (no message id comes back) and a contact's chat messages.
const KEY = 'JAKO-KEY-0123456789-abcdefghij';
const FLOWS = { done: 'f100s200', onit: 'f100s201' };
const jakoNames = Object.values(JAKO_TEMPLATES).map((t) => t.name);
// A row of Jako's list, as the workspace returns it.
const listed3 = () => jakoNames.map((name) => ({ id: 1, name, language: 'he', category: 'UTILITY', status: 'APPROVED', namespace: `ns_${name}`, components: [], params: [], rejected_reason: 'NONE' }));
function fakeJakoApi({ listed = listed3(), chat = () => ({ status: 200, body: { data: [] } }), send = () => ({ status: 200, body: { status: 'ok' } }), list = null } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    const u = new URL(url);
    const call = { method: init.method, path: u.pathname.replace(/^\/api/, ''), query: Object.fromEntries(u.searchParams), headers: init.headers, body: init.body ? JSON.parse(init.body) : null };
    calls.push(call);
    let a;
    if (call.path === '/whatsapp-template/list') a = list ? list(call) : { status: 200, body: { data: listed } };
    else if (call.path === '/subscriber/send-whatsapp-template-by-user-id') a = send(call);
    else if (call.path === '/subscriber/chat-messages') a = chat(call);
    else a = { status: 404, body: { message: 'no such path' } };
    if (a.throw) throw a.throw;
    return { ok: a.status < 300, status: a.status, json: async () => a.body };
  };
  const of = (path) => calls.filter((c) => c.path === path);
  // chats: every reading of a chat; polls: those of the reply poll (not the look for a sent message's id).
  return {
    fetch, calls, sends: () => of('/subscriber/send-whatsapp-template-by-user-id'), lists: () => of('/whatsapp-template/list'),
    chats: () => of('/subscriber/chat-messages'), polls: () => of('/subscriber/chat-messages').filter((c) => !c.query.include_bot),
  };
}
const noWait = async () => {};
// console.error, kept for the length of `fn` (nothing a sender logs may name the key or a number).
async function quietly(fn) {
  const lines = [];
  const real = console.error;
  console.error = (...a) => lines.push(a.map(String).join(' '));
  try { await fn(); } finally { console.error = real; }
  return lines.join('\n');
}
const nagRow = (over = {}) => log({ id: 91, key: `nag:-:${TASK}:s3@irit`, rule: 'nag', client_id: null, ref: null, title: 'עוד לא סומן ״בוצע״: להתקשר לפיצה', body: 'מליאור, היום 10:00 · תזכורת כל 10 דקות', url: 'clients.html#mine', ...over });

test('Jako\'s three templates follow Meta\'s rules: variables inside the text, short buttons and footer, an example for each variable', () => {
  assert.deepEqual(Object.keys(JAKO_TEMPLATES), ['nodnik', 'reminder', 'summary']);
  assert.deepEqual(jakoNames, ['nodnik', 'astrateg_reminder', 'astrateg_summary']);
  for (const [key, t] of Object.entries(JAKO_TEMPLATES)) {
    assert.match(t.name, /^[a-z_]{1,60}$/, key);
    const vars = [...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
    assert.deepEqual(vars, key === 'nodnik' ? [1, 2] : [1, 2, 3], key);
    assert.ok(!/^\s*\{\{/.test(t.body) && !/\}\}\s*$/.test(t.body), `${key}: a variable at the start or the end`);
    assert.equal(t.example.length, vars.length, key);
    assert.ok(t.example.every((x) => typeof x === 'string' && x.length > 0 && !/\n/.test(x)), key);
    // At the longest variables the filled body is still under Meta's 1024.
    const longest = key === 'nodnik' ? JAKO_MAX.name + JAKO_MAX.task : JAKO_MAX.name + JAKO_MAX.title + JAKO_MAX.details;
    assert.ok(t.body.length + longest < 1024, key);
    for (const r of t.replies) assert.ok(JAKO_BUTTONS[r] && JAKO_BUTTONS[r].length <= 25, r);
    if (t.footer) assert.ok(t.footer.length <= 60);
    const def = jakoDefinition(key);
    assert.deepEqual([def.name, def.category, def.language], [t.name, 'UTILITY', 'he']);
    assert.deepEqual(def.components.map((c) => c.type), t.footer ? ['BODY', 'FOOTER', 'BUTTONS'] : ['BODY', 'BUTTONS']);
    assert.deepEqual(def.components[0], { type: 'BODY', text: t.body, example: { body_text: [t.example] } });
    // Quick replies first, then the link to the app.
    const buttons = def.components.at(-1).buttons;
    assert.deepEqual(buttons.map((b) => b.type), [...t.replies.map(() => 'QUICK_REPLY'), ...(t.link ? ['URL'] : [])]);
    assert.ok(buttons.length >= 1 && buttons.every((b) => b.text.length <= 25));
    if (t.link) assert.deepEqual(buttons.at(-1), { type: 'URL', text: OPEN_BUTTON, url: `${SITE_URL}{{1}}`, example: [`${SITE_URL}clients.html`] });
  }
  // The owner's own template, exactly as it stands at Jako, and never created from here.
  const n = JAKO_TEMPLATES.nodnik;
  assert.equal(n.body, 'היי {{1}}\n\nכאן הנודניק של אסטרטג ⏰.\nמה עם המשימה הזו ?\n\n{{2}}\n\nהאם המשימה כבר בוצעה?\nבמידה ולא נא לבצע בהקדם תודה .');
  assert.deepEqual([n.byHand, n.footer, n.link, n.replies], [true, null, false, ['done', 'onit']]);
  assert.deepEqual(jakoDefinition('nodnik').components.at(-1).buttons, [{ type: 'QUICK_REPLY', text: 'המשימה בוצעה' }, { type: 'QUICK_REPLY', text: 'אני על זה' }]);
  // The two to create: the exact wording.
  assert.equal(JAKO_TEMPLATES.reminder.body, 'היי {{1}}, תזכורת מהמערכת של אסטרטג ⏰\n\n{{2}}\n\n{{3}}\n\nאפשר לענות כאן ״אני על זה״, או לפתוח במערכת ולסמן שם.');
  assert.equal(JAKO_TEMPLATES.summary.body, 'היי {{1}}, זה התקציר שלך מהמערכת של אסטרטג.\n\n{{2}}\n\n{{3}}\n\nהפירוט המלא מחכה לך במערכת, בכפתור למטה.');
  assert.deepEqual([JAKO_TEMPLATES.reminder.footer, JAKO_TEMPLATES.summary.footer], [FOOTER, FOOTER]);
  assert.deepEqual([JAKO_TEMPLATES.reminder.replies, JAKO_TEMPLATES.summary.replies], [['onit'], []]);
  assert.ok(!JAKO_TEMPLATES.reminder.byHand && !JAKO_TEMPLATES.summary.byHand);
  // Meta's nine are what they were (no name is shared, and their definition takes no provider).
  assert.equal(new Set([...jakoNames, ...Object.values(TEMPLATES).map((t) => t.name)]).size, 12);
  assert.deepEqual(metaDefinition('due').components.find((c) => c.type === 'BUTTONS').buttons.map((b) => b.type), ['QUICK_REPLY', 'QUICK_REPLY', 'URL']);
  assert.deepEqual(WA_PROVIDERS, ['meta', 'jako']);
  assert.throws(() => jakoDefinition('due'), /unknown template/);
});

test('which of Jako\'s three a reminder takes: digests the summary, a nagging task and a simple task the nodnik, everything else the reminder', () => {
  const t = (key, rule, extra = {}, task = null) => jakoTemplateFor({ key, rule, person: 'irit', ...extra }, task);
  assert.equal(t('digest:morning:irit:2026-10-05', 'digest'), 'summary');
  assert.equal(jakoTemplateFor({ key: 'digest:owner18:owner:2026-10-08', rule: 'digest', person: 'owner' }), 'summary');
  assert.equal(t('digest:late:irit:2026-10-05:50', 'digest'), 'summary');
  assert.equal(t(`nag:-:${TASK}:s0@irit`, 'nag'), 'nodnik');
  const simple = { id: TASK, owner: 'irit', source: null, brief: null };
  assert.equal(t(`urgent:c1:${TASK}:now@irit`, 'urgent', {}, simple), 'nodnik');
  // Not something a reply may close: a task with a brief, an exception, an approval, a process.
  assert.equal(t(`urgent:c1:${TASK}:now@irit`, 'urgent', {}, { ...simple, brief: { problem: 'x' } }), 'reminder');
  assert.equal(t(`urgent:c1:${TASK}:now@lior`, 'urgent', {}, { ...simple, source: 'escalation' }), 'reminder');
  assert.equal(t('qa:c1:p25@x:now@ofir', 'qa'), 'reminder');
  assert.equal(t('editing:c1:p22:assigned@nadia', 'editing'), 'reminder');
  assert.equal(t('eve:c1:p15:1115@irit', 'eve'), 'reminder');
  assert.equal(t('deal:c1:deal:now@irit', 'deal'), 'reminder');
  // The rows themselves are chosen as for Meta: the hours, the consent, the kinds.
  const irit = { email: 'irit@x', phone: '972501111111' };
  assert.deepEqual(waPlan({ row: log(), kind: 'ring', now: IL(2026, 10, 5, 10), recipient: irit, pick: jakoTemplateFor }), { template: 'reminder', to: '972501111111' });
  assert.deepEqual(waPlan({ row: log(), kind: 'ring', now: IL(2026, 10, 5, 10), recipient: irit }), { template: 'due', to: '972501111111' });
  assert.equal(waPlan({ row: log(), kind: 'ring', now: IL(2026, 10, 5, 20), recipient: irit, pick: jakoTemplateFor }).skip, 'quiet_hours');
  assert.equal(waPlan({ row: log(), kind: 'test', now: IL(2026, 10, 5, 10), recipient: irit, pick: jakoTemplateFor }).skip, 'kind');
});

test('Jako\'s message for each template: the number as user_id, the first name, the variables, the flows of the quick replies and the page', () => {
  const m = jakoMessage({ template: 'reminder', to: '972501234567', row: log({ body: 'חסר חוזה\nלבדוק' }), flows: FLOWS });
  assert.deepEqual(m, {
    user_id: '972501234567', create_if_not_found: 'yes',
    content: { name: 'astrateg_reminder', lang: 'he', params: { 'BODY_{{1}}': 'עירית', 'BODY_{{2}}': 'עסקה חדשה: פיצה', 'BODY_{{3}}': 'חסר חוזה · לבדוק', QUICK_REPLY_1: 'f100s201', URL_2: 'client.html?id=c1' } },
    contact: { first_name: 'עירית' },
  });
  // The nodnik: the task on one line (the title, and the details when they fit), both buttons, no link.
  const n = jakoMessage({ template: 'nodnik', to: '972501234567', row: nagRow(), flows: FLOWS });
  assert.deepEqual(n.content, { name: 'nodnik', lang: 'he', params: { 'BODY_{{1}}': 'עירית', 'BODY_{{2}}': 'עוד לא סומן ״בוצע״: להתקשר לפיצה · מליאור, היום 10:00 · תזכורת כל 10 דקות', QUICK_REPLY_1: 'f100s200', QUICK_REPLY_2: 'f100s201' } });
  const long = jakoMessage({ template: 'nodnik', to: '972501234567', row: nagRow({ body: 'x'.repeat(690) }), flows: FLOWS }).content.params['BODY_{{2}}'];
  assert.equal(long, 'עוד לא סומן ״בוצע״: להתקשר לפיצה', 'details that do not fit are left out, not cut');
  // The summary: the link only. The owner has no name in the system.
  const s = jakoMessage({ template: 'summary', to: '972502222222', row: log({ rule: 'digest', person: 'owner', title: 'סיכום היום', body: 'א\nב', url: 'owner.html' }), flows: FLOWS });
  assert.deepEqual(s.content.params, { 'BODY_{{1}}': 'שלום', 'BODY_{{2}}': 'סיכום היום', 'BODY_{{3}}': 'א · ב', URL_1: 'owner.html' });
  assert.ok(!('contact' in s));
  assert.deepEqual([jakoFirstName('lior'), jakoFirstName('owner'), jakoFirstName(null)], ['ליאור', 'שלום', 'שלום']);
  // Every variable is one line and within its length.
  const big = jakoMessage({ template: 'reminder', to: '972501234567', row: log({ title: 'ת'.repeat(400), body: 'ג\n'.repeat(900) }), flows: FLOWS }).content.params;
  assert.deepEqual([big['BODY_{{2}}'].length, big['BODY_{{3}}'].length], [JAKO_MAX.title, JAKO_MAX.details]);
  assert.ok(Object.values(big).every((v) => !/\n/.test(v)));
  // A flow that is not set goes out empty (the sender then refuses the message).
  assert.equal(jakoMessage({ template: 'reminder', to: '972501234567', row: log(), flows: { done: 'x' } }).content.params.QUICK_REPLY_1, '');
  assert.equal(jakoUserId('+972 50-123-4567'), '972501234567');
  assert.equal(jakoUrlParam('https://evil.test/x'), 'clients.html');
  assert.throws(() => jakoMessage({ template: 'due', to: '972501234567', row: log() }), /unknown template/);
});

test('the Jako sender: the namespace from Jako\'s list (read once), the key in the header only, "sent" on ok', async () => {
  const api = fakeJakoApi();
  const jako = makeJako({ fetch: api.fetch, apiKey: KEY, wait: noWait });
  const message = jakoMessage({ template: 'reminder', to: '972501234567', row: log(), flows: FLOWS });
  assert.deepEqual(await jako.send(message), { ok: true });
  const [list] = api.lists();
  assert.deepEqual([list.method, list.query], ['POST', { limit: '100', page: '1' }]);
  const [sent] = api.sends();
  assert.equal(sent.method, 'POST');
  assert.equal(sent.headers.Authorization, `Bearer ${KEY}`);
  assert.deepEqual(sent.body, { ...message, content: { namespace: 'ns_astrateg_reminder', ...message.content } });
  assert.equal(sent.body.user_id, '972501234567');
  assert.ok(!JSON.stringify(sent.body).includes(KEY) && !JSON.stringify(sent.query).includes(KEY));
  // The next sends do not ask for the list again (the instance remembers it).
  await jako.send(jakoMessage({ template: 'summary', to: '972501234567', row: log({ rule: 'digest' }), flows: FLOWS }));
  await jako.send(jakoMessage({ template: 'nodnik', to: '972501234567', row: nagRow(), flows: FLOWS }));
  assert.deepEqual([api.lists().length, api.sends().map((c) => c.body.content.namespace)], [1, ['ns_astrateg_reminder', 'ns_astrateg_summary', 'ns_nodnik']]);
  assert.equal(JAKO_BASE, 'https://my.jako.co.il/api');
  // Not configured: no key, or a number that is not one. Nothing is asked of Jako.
  const none = fakeJakoApi();
  assert.equal((await makeJako({ fetch: none.fetch, apiKey: '' }).send(message)).error, 'not_configured');
  assert.equal((await makeJako({ fetch: none.fetch, apiKey: KEY }).send({ ...message, user_id: '../x' })).error, 'not_configured');
  // A button whose flow is not set: refused before anything is asked (the summary has no button and goes).
  const noFlow = jakoMessage({ template: 'nodnik', to: '972501234567', row: nagRow(), flows: { done: 'f100s200' } });
  assert.deepEqual(await makeJako({ fetch: none.fetch, apiKey: KEY }).send(noFlow), { ok: false, status: 0, error: 'jako no_flow' });
  assert.equal(none.calls.length, 0);
  assert.deepEqual(await makeJako({ fetch: api.fetch, apiKey: KEY }).send(jakoMessage({ template: 'summary', to: '972501234567', row: log({ rule: 'digest' }) })), { ok: true });
});

test('the Jako sender: a template that is missing or not approved fails that message with a clear code, and is looked for again later', async () => {
  const row = (name, over = {}) => ({ name, language: 'he', status: 'APPROVED', namespace: `ns_${name}`, ...over });
  let listed = [
    row('nodnik', { status: 'PENDING' }),
    row('astrateg_summary', { namespace: undefined }),
    row('astrateg_reminder', { language: 'en' }),
  ];
  const api = fakeJakoApi({ list: () => ({ status: 200, body: { data: listed } }) });
  let now = 1_000_000;
  const jako = makeJako({ fetch: api.fetch, apiKey: KEY, wait: noWait, clock: () => now });
  const m = (template, r = log()) => jakoMessage({ template, to: '972501234567', row: r, flows: FLOWS });
  assert.deepEqual(await jako.send(m('nodnik', nagRow())), { ok: false, status: 0, error: 'jako not_approved' });
  assert.deepEqual(await jako.send(m('summary')), { ok: false, status: 0, error: 'jako no_namespace' });
  assert.deepEqual(await jako.send(m('reminder')), { ok: false, status: 0, error: 'jako no_template' }, 'another language is another template');
  assert.deepEqual([api.lists().length, api.sends().length], [1, 0], 'one list for all of them, and nothing was sent blind');
  // Approved meanwhile: found once the list is read again (not before LIST_AGAIN).
  listed = [row('nodnik'), row('astrateg_reminder', { status: 'REJECTED' })];
  assert.equal((await jako.send(m('nodnik', nagRow()))).error, 'jako not_approved');
  now += LIST_AGAIN;
  assert.deepEqual(await jako.send(m('nodnik', nagRow())), { ok: true });
  assert.equal((await jako.send(m('reminder'))).error, 'jako not_approved');
  assert.equal(api.lists().length, 2);
  // The list itself fails: the messages fail with its code, and nothing is sent blind.
  const down = fakeJakoApi({ list: () => ({ status: 401, body: { message: `bad key ${KEY}` } }) });
  const out = await makeJako({ fetch: down.fetch, apiKey: KEY, wait: noWait }).send(m('reminder'));
  assert.deepEqual(out, { ok: false, status: 0, error: 'jako list 401' });
  assert.equal(down.sends().length, 0);
  // More templates than one page: the next page is read.
  const many = Array.from({ length: 100 }, (_, i) => row(`other_${i}`));
  const paged = fakeJakoApi({ list: (c) => ({ status: 200, body: { data: c.query.page === '1' ? many : [row('astrateg_reminder', { namespace: 'ns_p2' })] } }) });
  assert.deepEqual(await makeJako({ fetch: paged.fetch, apiKey: KEY, wait: noWait }).send(m('reminder')), { ok: true });
  assert.equal(paged.sends()[0].body.content.namespace, 'ns_p2');
});

test('the Jako sender: a 4xx is not tried again, a 5xx or a network error once, a timeout never; no error names the key or the number', async () => {
  const message = jakoMessage({ template: 'reminder', to: '972501234567', row: log(), flows: FLOWS });
  const run = async (answers, opts = {}) => {
    let i = 0;
    const api = fakeJakoApi({ send: () => answers[Math.min(i++, answers.length - 1)] });
    const waits = [];
    let res;
    // (The pauses of the retry only: the look for the sent message's id has its own.)
    const logged = await quietly(async () => { res = await makeJako({ fetch: api.fetch, apiKey: KEY, wait: async (ms) => { if (ms !== LEARN_PAUSE) waits.push(ms); }, ...opts }).send(message); });
    assert.doesNotMatch(JSON.stringify(res) + logged, /JAKO-KEY|9725/);
    return { res, tries: api.sends().length, waits };
  };
  const refused = { status: 400, body: { message: `(#131026) Message undeliverable to 972501234567, key ${KEY}` } };
  const ok = { status: 200, body: { status: 'ok' } };
  // 4xx: once, with Meta's number when Jako quotes one, and nothing else of its message.
  assert.deepEqual(await run([refused, ok]), { res: { ok: false, status: 400, error: 'jako 400 #131026' }, tries: 1, waits: [] });
  assert.deepEqual((await run([{ status: 400, body: { message: 'user 972501234567 not found' } }])).res, { ok: false, status: 400, error: 'jako 400' });
  assert.deepEqual([(await run([{ status: 401, body: {} }, ok])).tries, (await run([{ status: 429, body: {} }, ok])).tries], [1, 1]);
  // 5xx: once more, after a short pause.
  assert.deepEqual(await run([{ status: 503, body: {} }, ok]), { res: { ok: true }, tries: 2, waits: [300] });
  assert.deepEqual(await run([{ status: 502, body: {} }, { status: 500, body: null }, ok]), { res: { ok: false, status: 500, error: 'jako 500' }, tries: 2, waits: [300] });
  // A network error: once more.
  const net = { throw: new TypeError(`fetch failed for ${KEY}`) };
  assert.deepEqual(await run([net, ok]), { res: { ok: true }, tries: 2, waits: [300] });
  assert.deepEqual((await run([net, net, ok])), { res: { ok: false, status: 0, error: 'jako network' }, tries: 2, waits: [300] });
  // A timeout: not again (the message may have gone out).
  const late = { throw: Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' }) };
  assert.deepEqual(await run([late, ok]), { res: { ok: false, status: 0, error: 'jako timeout' }, tries: 1, waits: [] });
  // A 200 that does not say ok is not "sent".
  assert.deepEqual((await run([{ status: 200, body: { status: 'queued?' } }])).res, { ok: false, status: 200, error: 'jako 200 not_ok' });
});

test('the Jako sender is bounded: a call that hangs is cut, and past the tick\'s budget nothing more is asked', async () => {
  const message = jakoMessage({ template: 'reminder', to: '972501234567', row: log(), flows: FLOWS });
  // A provider that never answers: the request is aborted after timeoutMs.
  const api = fakeJakoApi();
  const hang = (url, init) => (new URL(url).pathname.endsWith('/list') ? api.fetch(url, init) : new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))));
  const t0 = Date.now();
  assert.deepEqual(await makeJako({ fetch: hang, apiKey: KEY, timeoutMs: 40 }).send(message), { ok: false, status: 0, error: 'jako timeout' });
  assert.ok(Date.now() - t0 < 2000);
  // The budget: begin() starts it; once it is used up a send fails at once, without a request.
  let now = 0;
  const slow = fakeJakoApi({ send: () => { now += 30000; return { status: 503, body: {} }; } });
  const jako = makeJako({ fetch: slow.fetch, apiKey: KEY, wait: noWait, clock: () => now });
  jako.begin();
  assert.equal((await jako.send(message)).error, 'jako 503');
  assert.equal(slow.sends().length, 2, 'the second try fit in the budget');
  assert.deepEqual(await jako.send(message), { ok: false, status: 0, error: 'jako budget' });
  assert.equal(slow.sends().length, 2);
  jako.begin(); // the next tick
  await jako.send(message);
  assert.equal(slow.sends().length, 4);
  assert.ok(JAKO_TIMEOUT <= 10000 && JAKO_BUDGET <= 60000);
});

// The tick with Jako as the second channel: the same rows, the same hours, once each.
function fakeJakoWa({ recipients = IRIT_OK, api = fakeJakoApi(), due = [], stop = async () => 'withdrawn', flows = FLOWS, clock = Date.now, refuseId = false, replyDb = null } = {}) {
  const rows = [];
  const db = {
    async claim(row) { if (rows.some((r) => r.log_id === row.log_id)) return null; const r = { id: rows.length + 1, created_at: new Date().toISOString(), ...row }; rows.push(r); return { id: r.id }; },
    async update(id, patch) {
      if (refuseId && patch.wa_message_id) throw Object.assign(new Error('duplicate key'), { code: '23505' });
      Object.assign(rows.find((r) => r.id === id), patch);
    },
    async expire() { return 0; },
  };
  const poll = { asked: [], done: [], stops: [] };
  const pollDb = {
    async due(max, everyMs) { poll.asked.push([max, everyMs]); return typeof due === 'function' ? due() : due; },
    async done(email, until) { poll.done.push([email, until.toISOString()]); },
    async stop(args) { poll.stops.push(args); return stop(args); },
  };
  const list = waRecipients(recipients);
  const wa = makeJakoWhatsapp({ db, pollDb, jako: makeJako({ fetch: api.fetch, apiKey: KEY, wait: noWait, clock }), recipients: list, flows, replyDb });
  return { wa, rows, api, poll, list };
}

test('with Jako a ring goes by push and once by WhatsApp, as "sent" with no message id; outside the hours nothing; a failed send is recorded and the tick goes on', async () => {
  const db = fakeDb({ clients: [deal(IL(2026, 10, 5, 10))], subs: [{ id: 's1', email: 'irit@x', endpoint: 'https://push.test/p', p256dh: 'x', auth: 'y', fail_count: 0 }] });
  const { wa, rows, api } = fakeJakoWa();
  const t0 = IL(2026, 10, 5, 10);
  const stats = await runTick({ db: db.at(t0), push, wa, now: t0 });
  assert.deepEqual([stats.pushed, stats.waSent, stats.waFailed], [1, 1, 0]);
  const [sent] = api.sends();
  assert.deepEqual([sent.body.user_id, sent.body.content.name, sent.body.content.namespace], ['972501111111', 'astrateg_reminder', 'ns_astrateg_reminder']);
  assert.deepEqual([sent.body.content.params['BODY_{{1}}'], sent.body.content.params['BODY_{{2}}'], sent.body.content.params.QUICK_REPLY_1], ['עירית', 'עסקה חדשה: פיצה', 'f100s201']);
  const logRow = db.log.find((r) => r.key === 'deal:c1:deal:now@irit');
  // The row keeps which of the three it went out with: a reply is matched by it.
  assert.deepEqual([rows[0].log_id, rows[0].status, rows[0].template, rows[0].person, rows[0].provider, rows[0].wa_message_id], [logRow.id, 'sent', 'reminder', 'irit', 'jako', undefined]);
  // The same reminder taken again finds its claim: not sent twice.
  await wa.deliver({ sends: [{ row: logRow, kind: 'ring' }], env: { tasks: [] }, now: t0, stats: {} });
  assert.equal(api.sends().length, 1);
  // Meta's channel is what it was: its own template, and its rows unmarked (the column's default says 'meta').
  const meta = fakeWa({ recipients: IRIT_OK });
  await meta.wa.deliver({ sends: [{ row: log({ id: 77 }), kind: 'ring' }], env: { tasks: [] }, now: t0, stats: {} });
  assert.ok(!('provider' in meta.rows[0]) && meta.sent[0].messaging_product === 'whatsapp');
  assert.deepEqual([meta.rows[0].template, meta.sent[0].template.name], ['due', 'astrateg_due']);

  // A nagging task and a simple task go out as the nodnik, a digest as the summary.
  const mix = fakeJakoWa();
  const simple = { id: TASK, owner: 'irit', source: null, brief: null };
  await mix.wa.deliver({ sends: [
    { row: nagRow(), kind: 'ring' },
    { row: log({ id: 92, key: `urgent:c1:${TASK}:now@irit`, rule: 'urgent', ref: null }), kind: 'ring' },
    { row: log({ id: 93, key: 'digest:morning:irit:2026-10-05', rule: 'digest', level: 'digest', title: 'תקציר בוקר', body: 'א\nב' }), kind: 'digest' },
  ], env: { tasks: [simple] }, now: t0, stats: {} });
  assert.deepEqual(mix.rows.map((r) => [r.log_id, r.template]).sort(), [[91, 'nodnik'], [92, 'nodnik'], [93, 'summary']]);
  const nod = mix.api.sends().find((c) => c.body.content.params['BODY_{{2}}'].startsWith('עוד לא סומן'));
  assert.deepEqual([nod.body.content.name, nod.body.content.params.QUICK_REPLY_1, nod.body.content.params.QUICK_REPLY_2], ['nodnik', 'f100s200', 'f100s201']);

  // 20:00: push only. 08:30: the digest, with Jako refusing it → failed, with the code; the next message still goes.
  const night = fakeJakoWa();
  await night.wa.deliver({ sends: [{ row: log({ id: 61 }), kind: 'ring' }], env: { tasks: [] }, now: IL(2026, 10, 5, 20), stats: {} });
  assert.equal(night.api.sends().length, 0);
  let n = 0;
  const bad = fakeJakoWa({ api: fakeJakoApi({ send: () => ((n += 1) === 1 ? { status: 400, body: { message: '(#132001) Template name does not exist for 972501111111' } } : { status: 200, body: { status: 'ok' } }) }) });
  const s = {};
  const text = await quietly(() => bad.wa.deliver({ sends: [{ row: log({ id: 71, rule: 'digest', level: 'digest', title: 'תקציר בוקר', body: 'א\nב' }), kind: 'digest' }, { row: log({ id: 72 }), kind: 'ring' }], env: { tasks: [] }, now: IL(2026, 10, 5, 8, 30), stats: s }));
  assert.deepEqual([s.waSent, s.waFailed, s.waErrors], [1, 1, 0]);
  assert.deepEqual(bad.rows.map((r) => [r.status, r.error || null]).sort(), [['failed', 'jako 400 #132001'], ['sent', null]]);
  assert.doesNotMatch(JSON.stringify(bad.rows.map((r) => r.error)) + text, /JAKO-KEY|9725/);
  // The flows are not set: a message with a button fails with its code, the summary still goes.
  const bare = fakeJakoWa({ flows: {} });
  const s2 = {};
  await bare.wa.deliver({ sends: [{ row: log({ id: 73 }), kind: 'ring' }, { row: log({ id: 74, rule: 'digest', level: 'digest' }), kind: 'digest' }], env: { tasks: [] }, now: t0, stats: s2 });
  assert.deepEqual([s2.waSent, s2.waFailed], [1, 1]);
  assert.deepEqual(bare.rows.map((r) => [r.template, r.status, r.error || null]).sort(), [['reminder', 'failed', 'jako no_flow'], ['summary', 'sent', null]]);
});

test('"הסר" with Jako: the tick asks what each person wrote since the last time, a stop word withdraws the consent before this tick\'s messages, and nothing written is kept', async () => {
  const now = IL(2026, 10, 5, 10);
  const since = new Date(now.getTime() - 5 * 6e4);
  const ts = (d) => Math.floor(d.getTime() / 1000);
  const two = [...IRIT_OK, { email: 'ofir@x', person: 'ofir', status: 'granted', consent_phone: '972503333333', staff_phone: '972503333333' }];
  const due = [{ email: 'irit@x', person: 'irit', phone: '972501111111', since: since.toISOString() }, { email: 'ofir@x', person: 'ofir', phone: '972503333333', since: since.toISOString() }];
  const chat = (c) => ({ status: 200, body: { data: c.query.user_id === '972501111111' ? [
    { id: 900, type: 'out', msg_type: 'text', content: 'הסר', ts: ts(now) - 30 }, // ours, not hers
    { id: 901, type: 'in', msg_type: 'text', content: 'הסר', ts: ts(since) - 3600 }, // before the window (written before she agreed again)
    { id: 902, type: 'in', msg_type: 'image', content: 'הסר', ts: ts(now) - 60 },
    { id: 903, type: 'in', msg_type: 'text', content: 'תודה, ראיתי', ts: ts(now) - 50 },
    { id: 904, type: 'in', msg_type: 'text', content: ' הסר. ', ts: ts(now) - 40 },
  ] : [{ id: 11, type: 'in', msg_type: 'text', content: 'הסרט מוכן', ts: ts(now) - 10 }] } });
  const f = fakeJakoWa({ recipients: two, api: fakeJakoApi({ chat }), due });
  const stats = {};
  const sends = [{ row: log({ id: 81 }), kind: 'ring' }, { row: log({ id: 82, person: 'ofir', key: 'deal:c1:deal:now@ofir' }), kind: 'ring' }];
  await f.wa.deliver({ sends, env: { tasks: [] }, now, stats });
  assert.deepEqual(f.poll.asked, [[POLL_MAX, POLL_EVERY]]);
  assert.deepEqual([POLL_MAX, POLL_EVERY], [5, 5 * 6e4]);
  const asked = f.api.chats().find((c) => c.query.user_id === '972501111111');
  assert.deepEqual([asked.method, asked.query], ['GET', { user_id: '972501111111', start_time: String(ts(since)), end_time: String(ts(now)), limit: '100' }]);
  assert.equal(asked.headers.Authorization, `Bearer ${KEY}`);
  // Her stop: applied once by its id, from her number; she is out of this tick's messages, Ofir is not.
  assert.deepEqual(f.poll.stops, [{ inbound: 'jako:irit:904', from: '972501111111' }]);
  assert.deepEqual([stats.waPolled, stats.waStops, stats.waPollErrors, stats.waSent], [2, 1, 0, 1]);
  assert.deepEqual(f.api.sends().map((c) => c.body.user_id), ['972503333333']);
  assert.deepEqual([...f.list.keys()], ['ofir']);
  // Read up to two minutes ago: the newest of the chat is looked at again next time (PRESS_GRACE).
  const read = new Date(now.getTime() - PRESS_GRACE).toISOString();
  assert.deepEqual(f.poll.done.sort(), [['irit@x', read], ['ofir@x', read]]);
  // Nothing anyone wrote reaches the database.
  assert.doesNotMatch(JSON.stringify([f.poll, f.rows.map((r) => ({ ...r, phone: '' }))]), /תודה|הסרט|הסר/);

  // A stop the database already applied (or whose consent is gone) removes nobody.
  const dup = fakeJakoWa({ api: fakeJakoApi({ chat }), due: [due[0]], stop: async () => 'duplicate' });
  const s2 = {};
  await dup.wa.deliver({ sends: [sends[0]], env: { tasks: [] }, now, stats: s2 });
  assert.deepEqual([s2.waStops, s2.waSent], [0, 1]);

  // Jako does not answer: counted, not marked as read (the next poll asks from the same moment), and the messages still go.
  const down = fakeJakoWa({ api: fakeJakoApi({ chat: () => ({ status: 503, body: {} }) }), due: [due[0]] });
  const s3 = {};
  await down.wa.deliver({ sends: [sends[0]], env: { tasks: [] }, now, stats: s3 });
  assert.deepEqual([s3.waPolled, s3.waPollErrors, s3.waSent, down.poll.done.length, down.api.polls().length], [0, 1, 1, 0, 1]);
  // A contact Jako does not know yet (nobody wrote, nothing was sent): nothing to read.
  const fresh = fakeJakoWa({ api: fakeJakoApi({ chat: () => ({ status: 400, body: { message: 'user not found' } }) }), due: [due[0]] });
  const s4 = {};
  await fresh.wa.deliver({ sends: [], env: { tasks: [] }, now, stats: s4 });
  assert.deepEqual([s4.waPolled, s4.waPollErrors, fresh.poll.done.length], [1, 0, 1]);
  // Nobody is due: Jako is not asked at all. The database failing to say who is due does not stop the messages.
  const idle = fakeJakoWa();
  await idle.wa.deliver({ sends: [sends[0]], env: { tasks: [] }, now, stats: {} });
  assert.deepEqual([idle.api.polls().length, idle.api.sends().length], [0, 1]);
  const broken = fakeJakoWa({ due: () => { throw Object.assign(new Error('boom 972501111111'), { code: '42P01' }); } });
  const s5 = {};
  const logged = await quietly(() => broken.wa.deliver({ sends: [sends[0]], env: { tasks: [] }, now, stats: s5 }));
  assert.deepEqual([s5.waPollErrors, s5.waSent], [1, 1]);
  assert.doesNotMatch(logged, /9725|JAKO-KEY/);
  // The window never reaches back more than Jako keeps (a month), whatever the database says.
  const old = fakeJakoWa({ due: [{ ...due[0], since: '2026-01-01T00:00:00Z' }] });
  await old.wa.deliver({ sends: [], env: { tasks: [] }, now, stats: {} });
  assert.equal(Number(old.api.chats()[0].query.start_time), ts(now) - 29 * 86400);
});

// ── Jako's reply buttons: the call from its sub flows ──
const HOOK = 'hook-secret-0123456789abcdef';
test('the reply endpoint\'s door: 503 unless the provider is Jako with a secret in Vault, 401 with no body for a wrong or missing secret', () => {
  const gate = (over = {}) => hookGate({ provider: 'jako', secret: HOOK, given: HOOK, method: 'POST', ...over });
  assert.equal(gate(), null);
  assert.deepEqual(gate({ provider: 'meta' }), { status: 503, body: 'not ready' });
  assert.deepEqual(gate({ provider: undefined }), { status: 503, body: 'not ready' });
  assert.deepEqual(gate({ secret: null }), { status: 503, body: 'not ready' });
  assert.deepEqual(gate({ secret: 'short', given: 'short' }), { status: 503, body: 'not ready' });
  assert.deepEqual(gate({ given: null }), { status: 401, body: '' });
  assert.deepEqual(gate({ given: '' }), { status: 401, body: '' });
  assert.deepEqual(gate({ given: `${HOOK}x` }), { status: 401, body: '' });
  assert.deepEqual(gate({ given: HOOK.toUpperCase() }), { status: 401, body: '' });
  assert.equal(gate({ method: 'GET' }).status, 405);
  assert.deepEqual([HOOK_HEADER, HOOK_MAX_BODY <= 8192], ['x-astrateg-hook', true]);
});

test('the reply\'s body: the button as a word or as its text, the number from user_id or phone in any spelling, other fields ignored', () => {
  assert.deepEqual(parseHook({ action: 'done', user_id: '972501111111', phone: '+972 50-111-1111' }), { action: 'done', phones: ['972501111111'] });
  assert.deepEqual(parseHook({ action: 'אני על זה', phone: '050-111-1111' }), { action: 'onit', phones: ['972501111111'] });
  assert.deepEqual(parseHook({ action: ' המשימה בוצעה ', user_id: '972501111111', phone: '0502222222', ref: 'x', task: 'whatever', extra: { a: 1 } }), { action: 'done', phones: ['972501111111', '972502222222'] });
  for (const bad of [null, [], 'done', {}, { action: 'done' }, { action: 'help', user_id: '972501111111' }, { action: 'done', user_id: 'abc', phone: '12' }, { action: 'בוצע?', phone: '0501111111' }]) assert.equal(parseHook(bad), null, JSON.stringify(bad));
  assert.deepEqual([hookPhone('+972501111111'), hookPhone('0501111111'), hookPhone(972501111111), hookPhone('x'), hookPhone('')], ['972501111111', '972501111111', '972501111111', null, null]);
  assert.deepEqual([hookAction('onit'), hookAction('done'), hookAction('המשימה בוצעה'), hookAction('stop')], ['onit', 'done', 'done', null]);
});
// The database as the replies see it (../supabase/functions/_shared/wa-jako-reply.js): the
// messages sent through Jako (newest last here; `wa` is the id learned after the send), their
// reminders and items, and public.whatsapp_jako_reply's bookkeeping (each inbound id once).
function fakeHookDb({ messages, logs, tasks = {}, nags = {}, apply = null }) {
  const applied = [];
  const inbound = new Set();
  const db = {
    asked: [],
    async last({ phones, templates, since }) {
      db.asked.push({ phones, templates, since });
      return [...messages].reverse().find((m) => phones.includes(m.phone) && templates.includes(m.template) && new Date(m.sent_at) >= since) || null;
    },
    async byWaId(mid) { return messages.find((m) => m.wa === mid) || null; },
    async logRow(id) { return logs[id] || null; },
    async task(id) { return tasks[id] || null; },
    async nag(id) { return nags[id] || null; },
    async client() { return null; },
    async answered(id) { return inbound.has(id); },
    async apply(args) {
      if (inbound.has(args.inbound)) return 'duplicate';
      applied.push(args);
      inbound.add(args.inbound);
      if (apply) return apply(args);
      const { plan } = args;
      if (plan.op === 'nag_done') { nags[plan.task].status = 'done'; return 'done'; }
      if (plan.op === 'task_done') { tasks[plan.task].done_at = 'now'; return 'done'; }
      if (plan.op === 'task_start') { if (tasks[plan.task].started_at) return 'unchanged'; tasks[plan.task].started_at = 'now'; return 'started'; }
      if (plan.op === 'claim') return 'claimed';
      return plan.why || 'none';
    },
  };
  return { db, applied, inbound };
}
const NAG2 = '1c7f4b63-7e9d-4b8f-8e1f-4a2d3c5b6e7f';
const NAG3 = '2d8a5c74-8fae-4c9a-9f2a-5b3e4d6c7f8a';
// Irit's morning: a process reminder, two nagging tasks (the second rang twice), a digest; and one message to Ofir.
function replyWorld(now, over = {}) {
  const at = (min) => new Date(now.getTime() - min * 6e4).toISOString();
  const msg = (id, log_id, template, min, extra = {}) => ({ id, log_id, person: 'irit', email: 'irit@x', phone: '972501111111', template, sent_at: at(min), wa: `wamid.OUT${id}`, ...extra });
  return fakeHookDb({
    messages: [
      msg(1, 10, 'nodnik', 26 * 60), // yesterday: outside the 24 hours
      msg(2, 20, 'reminder', 90), // a process reminder (p01)
      msg(3, 30, 'nodnik', 40), // nagging task NAG2
      msg(4, 31, 'nodnik', 30), // nagging task TASK
      msg(5, 32, 'nodnik', 20), // nagging task TASK again: the last nodnik
      msg(6, 40, 'summary', 10), // a digest: no button
      msg(7, 50, 'nodnik', 5, { person: 'ofir', email: 'ofir@x', phone: '972503333333' }),
    ],
    logs: {
      10: nagRow({ id: 10 }), 20: log({ id: 20 }), 30: nagRow({ id: 30, key: `nag:-:${NAG2}:s1@irit` }),
      31: nagRow({ id: 31, key: `nag:-:${TASK}:s2@irit` }), 32: nagRow({ id: 32, key: `nag:-:${TASK}:s3@irit` }),
      40: log({ id: 40, rule: 'digest' }), 50: nagRow({ id: 50, person: 'ofir', key: `nag:-:${NAG3}:s9@ofir` }),
    },
    nags: {
      [TASK]: { id: TASK, assignee: 'irit', status: 'open', body: 'להתקשר ללקוח פיצה\nולתאם יום צילום' }, [NAG2]: { id: NAG2, assignee: 'irit', status: 'open', body: 'לשלוח חשבונית' },
      [NAG3]: { id: NAG3, assignee: 'ofir', status: 'open', body: 'לבדוק את הכונן' },
    },
    ...over,
  });
}
// The person's chat at Jako, as `incoming` returns it: the presses, newest first.
const press = (mid, title, replyTo, at) => ({ mid, title, replyTo, at });
const chatOf = (presses, calls = []) => async (args) => { calls.push(args); return { ok: true, missing: false, messages: [], presses: [...presses].sort((a, b) => b.at - a.at), full: false }; };

test('a sent message\'s id is read back from the person\'s chat: the newest outgoing row from the send on, each id for one message, one more look a second later', async () => {
  let now = 1_800_000_000_000;
  const sec = () => Math.floor(now / 1000);
  let chat = [];
  const api = fakeJakoApi({ chat: () => ({ status: 200, body: { data: chat } }), send: () => { chat = [{ id: 501, mid: 'wamid.NEW', type: 'out', msg_type: 'template', sender_id: 'bot', ts: sec() }, ...chat]; return { status: 200, body: { status: 'ok' } }; } });
  const waits = [];
  const jako = makeJako({ fetch: api.fetch, apiKey: KEY, wait: async (ms) => { waits.push(ms); }, clock: () => now });
  const message = jakoMessage({ template: 'reminder', to: '972501234567', row: log(), flows: FLOWS });
  // Before: an older outgoing message, her own typed message, and a row without an id.
  chat = [{ id: 400, mid: 'wamid.OLD', type: 'out', msg_type: 'text', ts: sec() - 60 }, { id: 401, mid: 'wamid.HERS', type: 'in', msg_type: 'text', content: 'תודה', ts: sec() }, { id: 402, type: 'out', ts: sec() }];
  assert.deepEqual(await jako.send(message), { ok: true, id: 'wamid.NEW' });
  const [asked] = api.chats();
  assert.deepEqual([asked.method, asked.query], ['GET', { user_id: '972501234567', include_bot: '1', start_time: String(sec() - 5), limit: '10' }]);
  assert.deepEqual([api.chats().length, waits], [1, []]);
  // The next message to her does not take the same id, also when its own row is not there: one more look, then none.
  const api2 = fakeJakoApi({ chat: () => ({ status: 200, body: { data: chat } }) });
  const jako2 = makeJako({ fetch: api2.fetch, apiKey: KEY, wait: async (ms) => { waits.push(ms); }, clock: () => now });
  assert.deepEqual(await jako2.send(message), { ok: true, id: 'wamid.NEW' });
  assert.deepEqual(await jako2.send(message), { ok: true }, 'the id already belongs to the message before');
  assert.deepEqual([api2.chats().length, waits], [3, [LEARN_PAUSE]]);
  // Not there at once, there a second later.
  let looks = 0;
  const slow = fakeJakoApi({ chat: () => ({ status: 200, body: { data: (looks += 1) === 1 ? [] : [{ id: 9, mid: 'wamid.LATE', type: 'out', ts: sec() }] } }) });
  assert.deepEqual(await makeJako({ fetch: slow.fetch, apiKey: KEY, wait: noWait, clock: () => now }).send(message), { ok: true, id: 'wamid.LATE' });
  // The chat cannot be read: the message is sent all the same, without an id. A failed send is not looked for.
  const blind = fakeJakoApi({ chat: () => ({ status: 500, body: {} }) });
  assert.deepEqual(await makeJako({ fetch: blind.fetch, apiKey: KEY, wait: noWait }).send(message), { ok: true });
  const failed = fakeJakoApi({ send: () => ({ status: 400, body: {} }) });
  await makeJako({ fetch: failed.fetch, apiKey: KEY, wait: noWait }).send(message);
  assert.equal(failed.chats().length, 0);
  // Two messages to one person in the same tick go one after the other: each gets its own id.
  now += 60000;
  let n = 0;
  let rows = [];
  const two = fakeJakoApi({ chat: () => ({ status: 200, body: { data: rows } }), send: () => { n += 1; rows = [{ id: 600 + n, mid: `wamid.T${n}`, type: 'out', ts: sec() }, ...rows]; return { status: 200, body: { status: 'ok' } }; } });
  const j = makeJako({ fetch: two.fetch, apiKey: KEY, wait: noWait, clock: () => now });
  assert.deepEqual(await Promise.all([j.send(message), j.send(message)]), [{ ok: true, id: 'wamid.T1' }, { ok: true, id: 'wamid.T2' }]);
  assert.deepEqual(two.calls.filter((c) => c.path !== '/whatsapp-template/list').map((c) => c.method), ['POST', 'GET', 'POST', 'GET']);
  // The tick keeps it on the message's row: that is what a press is matched by.
  now = IL(2026, 10, 5, 10).getTime();
  rows = [];
  const f = fakeJakoWa({ api: two, clock: () => now });
  await f.wa.deliver({ sends: [{ row: log({ id: 95 }), kind: 'ring' }], env: { tasks: [] }, now: new Date(now), stats: {} });
  assert.deepEqual([f.rows[0].status, f.rows[0].wa_message_id], ['sent', 'wamid.T3']);
  // An id the database refuses does not leave a sent message unrecorded.
  const g = fakeJakoWa({ api: two, clock: () => now, refuseId: true });
  const s = {};
  await g.wa.deliver({ sends: [{ row: log({ id: 96 }), kind: 'ring' }], env: { tasks: [] }, now: new Date(now), stats: s });
  assert.deepEqual([g.rows[0].status, g.rows[0].wa_message_id, s.waSent, s.waErrors], ['sent', undefined, 1, 0]);
});

test('a press is matched to the very message it answers: with two tasks open, the button on the OLDER message closes the older task', async () => {
  const now = IL(2026, 10, 5, 12);
  const ago = (s) => new Date(now.getTime() - s * 1000);
  const w = replyWorld(now);
  const calls = [];
  // She pressed "המשימה בוצעה" on message 3 (the invoice), though message 5 (the phone call) came after it.
  const chat = chatOf([press('wamid.P1', 'המשימה בוצעה', 'wamid.OUT3', ago(4))], calls);
  const out = await jakoReply({ db: w.db, chat, body: { action: 'done', user_id: '972501111111', phone: '+972501111111' }, now });
  assert.deepEqual(out, { ok: true, text: 'סומן בוצע: לשלוח חשבונית. אם זו לא המשימה הנכונה, אפשר לבטל במערכת.', result: 'done', match: 'exact' });
  assert.deepEqual(w.applied, [{ inbound: 'wamid.P1', message: 3, from: '972501111111', plan: { op: 'nag_done', task: NAG2 } }]);
  assert.deepEqual([(await w.db.nag(NAG2)).status, (await w.db.nag(TASK)).status], ['done', 'open'], 'the newer task is not touched');
  assert.deepEqual([calls.length, calls[0].userId, calls[0].since.toISOString(), calls[0].until.toISOString()], [1, '972501111111', new Date(now.getTime() - PRESS_WINDOW).toISOString(), now.toISOString()]);
  assert.equal(w.db.asked.length, 0, 'the last message is not looked for');
  // The sub flow calls again for the same press: said, nothing more.
  assert.deepEqual(await jakoReply({ db: w.db, chat, body: { action: 'done', user_id: '972501111111' }, now }), { ok: true, text: 'כבר סומן.', result: 'duplicate' });
  assert.equal(w.applied.length, 1);
  // Then she presses "אני על זה" on message 5, and "המשימה בוצעה" on it a moment later: each press is its own.
  const later = chatOf([press('wamid.P1', 'המשימה בוצעה', 'wamid.OUT3', ago(60)), press('wamid.P2', 'אני על זה', 'wamid.OUT5', ago(20)), press('wamid.P3', 'המשימה בוצעה', 'wamid.OUT5', ago(3))]);
  const onit = await jakoReply({ db: w.db, chat: later, body: { action: 'אני על זה', phone: '050-111-1111' }, now });
  assert.deepEqual([onit.result, onit.match, onit.text], ['noted', 'exact', 'קיבלתי, נרשם ״אני על זה״: להתקשר ללקוח פיצה ולתאם יום צילום. התזכורות ימשיכו עד שיסומן בוצע.']);
  assert.equal((await w.db.nag(TASK)).status, 'open', 'a nagging task keeps ringing after "אני על זה"');
  assert.equal((await jakoReply({ db: w.db, chat: later, body: { action: 'done', user_id: '972501111111' }, now })).result, 'done');
  assert.deepEqual(w.applied.map((a) => [a.inbound, a.message, a.plan.op]), [['wamid.P1', 3, 'nag_done'], ['wamid.P2', 5, 'none'], ['wamid.P3', 5, 'nag_done']]);
  // A press on a message whose task is closed by now: nothing changes.
  const w2 = replyWorld(now);
  (await w2.db.nag(NAG2)).status = 'cancelled';
  assert.deepEqual(await jakoReply({ db: w2.db, chat, body: { action: 'done', user_id: '972501111111' }, now }), { ok: false, text: 'המשימה הזאת כבר סגורה.', result: 'closed', match: 'exact' });
  assert.equal(w2.applied.length, 0);
  // A press that answers someone else's message is not hers (the id is matched together with the number).
  const w3 = replyWorld(now);
  const foreign = chatOf([press('wamid.P9', 'המשימה בוצעה', 'wamid.OUT7', ago(2))]);
  const f = await jakoReply({ db: w3.db, chat: foreign, body: { action: 'done', user_id: '972501111111' }, now });
  assert.deepEqual([f.match, w3.applied[0].message, (await w3.db.nag(NAG3)).status], ['last', 5, 'open']);
});

test('the fallback, only when the press cannot be matched: the last message with that button in 24 hours, and the stored plan says so', async () => {
  const now = IL(2026, 10, 5, 12);
  const body = { action: 'done', user_id: '972501111111', ref: 'לשלוח חשבונית', task: 'ignored' };
  const expectLast = async (chat, inbound) => {
    const w = replyWorld(now);
    const out = await jakoReply({ db: w.db, chat, body, now });
    assert.deepEqual(out, { ok: true, text: 'סומן בוצע: להתקשר ללקוח פיצה ולתאם יום צילום. אם זו לא המשימה הנכונה, אפשר לבטל במערכת.', result: 'done', match: 'last' });
    assert.deepEqual(w.applied, [{ inbound, message: 5, from: '972501111111', plan: { op: 'nag_done', task: TASK, match: 'last' } }]);
    assert.deepEqual(w.db.asked[0].templates, ['nodnik'], 'only a template that has the button');
    assert.equal(w.db.asked[0].since.toISOString(), new Date(now.getTime() - 24 * 3600e3).toISOString());
    return w;
  };
  // No key to read the chat with; the chat does not answer; the press is not there yet.
  await expectLast(null, 'jako:done:5');
  await expectLast(async () => ({ ok: false, status: 503, error: 'jako 503' }), 'jako:done:5');
  await expectLast(async () => { throw new Error('boom'); }, 'jako:done:5');
  await expectLast(chatOf([]), 'jako:done:5');
  await expectLast(chatOf([press('wamid.PX', 'אני על זה', 'wamid.OUT3', new Date(now.getTime() - 5000))]), 'jako:done:5'); // another button
  // The press is there, but the id of the message it answers was never learned: the last message, and the press is the key (so it is not applied again).
  const w = await expectLast(chatOf([press('wamid.P5', 'המשימה בוצעה', 'wamid.UNKNOWN', new Date(now.getTime() - 5000))]), 'wamid.P5');
  assert.deepEqual(await jakoReply({ db: w.db, chat: chatOf([press('wamid.P5', 'המשימה בוצעה', 'wamid.UNKNOWN', new Date(now.getTime() - 5000))]), body, now }), { ok: true, text: 'כבר סומן.', result: 'duplicate' });
  // In the fallback, the same button on the same message again: said, nothing more. Its task is closed by now for the other button.
  const v = replyWorld(now);
  await jakoReply({ db: v.db, body, now });
  assert.deepEqual(await jakoReply({ db: v.db, body: { action: 'המשימה בוצעה', phone: '050-111-1111' }, now }), { ok: true, text: 'כבר סומן.', result: 'duplicate', match: 'last' });
  assert.deepEqual(await jakoReply({ db: v.db, body: { action: 'onit', user_id: '972501111111' }, now }), { ok: false, text: 'המשימה הזאת כבר סגורה.', result: 'closed', match: 'last' });
  assert.equal(v.applied.length, 1);
  assert.deepEqual(v.db.asked.at(-1).templates, ['nodnik', 'reminder']);
  // Someone else's number gets their own last message; an unknown number, or one with nothing in 24 hours, nothing.
  const w3 = replyWorld(now);
  assert.equal((await jakoReply({ db: w3.db, body: { action: 'done', phone: '0503333333' }, now })).result, 'done');
  assert.deepEqual([w3.applied[0].message, w3.applied[0].from, w3.applied[0].plan.task], [7, '972503333333', NAG3]);
  const none = { ok: false, text: 'לא מצאתי משימה פתוחה. אפשר לסמן במערכת: https://app.astrateg.tech/clients.html#mine', result: 'nothing' };
  assert.deepEqual(await jakoReply({ db: w3.db, body: { action: 'done', user_id: '972509999999' }, now }), none);
  const stale = fakeHookDb({ messages: [{ id: 1, log_id: 10, person: 'irit', email: 'irit@x', phone: '972501111111', template: 'nodnik', sent_at: new Date(now.getTime() - 26 * 3600e3).toISOString() }], logs: { 10: nagRow({ id: 10 }) }, nags: { [TASK]: { id: TASK, assignee: 'irit', status: 'open', body: 'x' } } });
  assert.deepEqual(await jakoReply({ db: stale.db, body, now }), none);
  assert.equal(stale.applied.length, 0);
  // A body that is not understood: answered, nothing looked up.
  const w4 = replyWorld(now);
  const calls = [];
  assert.deepEqual(await jakoReply({ db: w4.db, chat: chatOf([], calls), body: { action: 'maybe', user_id: '972501111111' }, now }), { ok: false, text: 'לא הצלחתי להבין את התשובה. אפשר לסמן במערכת: https://app.astrateg.tech/clients.html#mine', result: 'bad' });
  assert.equal((await jakoReply({ db: w4.db, body: null, now })).result, 'bad');
  assert.deepEqual([w4.db.asked.length, w4.applied.length, calls.length], [0, 0, 0]);
  // A message whose reminder is another person's is nobody's to answer.
  const mixed = fakeHookDb({ messages: [{ id: 1, log_id: 10, person: 'irit', email: 'irit@x', phone: '972501111111', template: 'nodnik', sent_at: now.toISOString() }], logs: { 10: nagRow({ id: 10, person: 'lior' }) }, nags: { [TASK]: { id: TASK, assignee: 'lior', status: 'open', body: 'x' } } });
  assert.equal((await jakoReply({ db: mixed.db, body, now })).result, 'nothing');
});

test('a press is applied once, whichever sees it first: the sub flow\'s call and then the chat poll, or the poll and then the call', async () => {
  const now = IL(2026, 10, 5, 12);
  const ago = (s) => new Date(now.getTime() - s * 1000);
  const ts = (d) => Math.floor(d.getTime() / 1000);
  const body = { action: 'done', user_id: '972501111111' };
  // Jako's chat for Irit: she pressed "המשימה בוצעה" on message 3 five minutes ago, and "אני על זה" on message 5 just now.
  const rowsOf = () => [
    { id: 71, mid: 'wamid.P1', type: 'in', msg_type: 'postback', payload: { title: 'המשימה בוצעה', reply_to_mid: 'wamid.OUT3' }, content: 'המשימה בוצעה', ts: ts(ago(300)), user_ns: 'f1u2', sender_id: 'f1u2' },
    { id: 72, mid: 'wamid.P2', type: 'in', msg_type: 'postback', payload: { title: 'אני על זה', reply_to_mid: 'wamid.OUT5' }, content: 'אני על זה', ts: ts(ago(30)), user_ns: 'f1u2', sender_id: 'f1u2' },
    { id: 73, mid: 'wamid.X', type: 'in', msg_type: 'postback', payload: { title: 'כפתור של זרימה אחרת', reply_to_mid: 'wamid.OUT5' }, content: 'כפתור של זרימה אחרת', ts: ts(ago(200)) },
    { id: 74, mid: 'wamid.T', type: 'in', msg_type: 'text', payload: { text: 'תודה' }, content: 'תודה', ts: ts(ago(250)) },
    { id: 75, mid: 'wamid.OUT5', type: 'out', msg_type: 'text', sender_id: 'bot', payload: { text: '…' }, content: '…', ts: ts(ago(1200)) },
  ];
  const due = [{ email: 'irit@x', person: 'irit', phone: '972501111111', since: ago(600).toISOString() }];
  const pollWith = (w) => {
    const api = fakeJakoApi({ chat: () => ({ status: 200, body: { data: rowsOf() } }) });
    const f = fakeJakoWa({ api, due, replyDb: w.db });
    return { f, api, chat: makeJako({ fetch: api.fetch, apiKey: KEY, wait: noWait }).incoming };
  };

  // The call first: applied with its answer; the poll then finds the press handled.
  const w = replyWorld(now);
  const a = pollWith(w);
  const out = await jakoReply({ db: w.db, chat: a.chat, body, now });
  assert.deepEqual([out.result, out.match, out.text], ['done', 'exact', 'סומן בוצע: לשלוח חשבונית. אם זו לא המשימה הנכונה, אפשר לבטל במערכת.']);
  const s1 = {};
  await a.f.wa.deliver({ sends: [], env: { tasks: [] }, now, stats: s1 });
  assert.deepEqual([s1.waPolled, s1.waPresses, s1.waPollErrors], [1, 0, 0]);
  assert.deepEqual(w.applied.map((x) => [x.inbound, x.message]), [['wamid.P1', 3]]);
  // (The press of half a minute ago is left for its own call for now: the poll takes a press only after two minutes.)
  assert.equal(PRESS_GRACE, 2 * 6e4);
  assert.deepEqual(a.f.poll.done, [['irit@x', new Date(now.getTime() - PRESS_GRACE).toISOString()]]);

  // The poll first (no call came: the sub flow failed): applied all the same, to the exact message; a late call changes nothing.
  const v = replyWorld(now);
  const b = pollWith(v);
  const s2 = {};
  await b.f.wa.deliver({ sends: [], env: { tasks: [] }, now, stats: s2 });
  assert.deepEqual([s2.waPolled, s2.waPresses], [1, 1]);
  assert.deepEqual(v.applied, [{ inbound: 'wamid.P1', message: 3, from: '972501111111', plan: { op: 'nag_done', task: NAG2 } }]);
  assert.equal((await v.db.nag(NAG2)).status, 'done');
  assert.deepEqual(await jakoReply({ db: v.db, chat: b.chat, body, now }), { ok: true, text: 'כבר סומן.', result: 'duplicate' });
  // The next poll, two minutes on: the other press is ripe now and nobody called for it; the first is not applied again.
  const later = new Date(now.getTime() + PRESS_GRACE);
  const s3 = {};
  await b.f.wa.deliver({ sends: [], env: { tasks: [] }, now: later, stats: s3 });
  assert.equal(s3.waPresses, 1);
  assert.deepEqual(v.applied.map((x) => [x.inbound, x.message, x.plan.op]), [['wamid.P1', 3, 'nag_done'], ['wamid.P2', 5, 'none']]);
  await b.f.wa.deliver({ sends: [], env: { tasks: [] }, now: later, stats: {} });
  assert.equal(v.applied.length, 2);
  // Nothing of the chat is kept but the ids of the presses.
  assert.doesNotMatch(JSON.stringify([v.applied, b.f.poll]), /תודה|כפתור של זרימה/);
  // The poll never guesses: a press whose message is not known is left alone (its call, if it comes, falls back).
  const u = fakeHookDb({ messages: [], logs: {} });
  const c = pollWith(u);
  const s4 = {};
  await c.f.wa.deliver({ sends: [], env: { tasks: [] }, now, stats: s4 });
  assert.deepEqual([s4.waPresses, u.applied.length, s4.waPollErrors], [0, 0, 0]);
  // Without the replies' database (as before) the poll only hears "הסר".
  const plain = fakeJakoWa({ api: fakeJakoApi({ chat: () => ({ status: 200, body: { data: rowsOf() } }) }), due });
  const s5 = {};
  await plain.wa.deliver({ sends: [], env: { tasks: [] }, now, stats: s5 });
  assert.deepEqual([s5.waPolled, s5.waPresses], [1, 0]);
});

test('through Jako "המשימה בוצעה" closes only what a reply may close, and "אני על זה" records what the app\'s own does', async () => {
  const now = IL(2026, 10, 5, 12);
  const sent_at = new Date(now.getTime() - 6e5).toISOString();
  const m = (template, log_id = 10) => [{ id: 1, log_id, person: 'irit', email: 'irit@x', phone: '972501111111', template, sent_at, wa: 'wamid.OUT1' }];
  const urgent = log({ id: 10, key: `urgent:c1:${TASK}:now@irit`, rule: 'urgent', ref: null, title: 'משימה דחופה: פיצה' });
  const task = () => ({ id: TASK, owner: 'irit', done_at: null, started_at: null, source: null, brief: null });
  const pressed = (title) => chatOf([press('wamid.P1', title, 'wamid.OUT1', new Date(now.getTime() - 3000))]);
  // A simple task: done closes it, by name.
  let w = fakeHookDb({ messages: m('nodnik'), logs: { 10: urgent }, tasks: { [TASK]: task() } });
  assert.deepEqual(await jakoReply({ db: w.db, chat: pressed('המשימה בוצעה'), body: { action: 'done', user_id: '972501111111' }, now }), { ok: true, text: 'סומן בוצע: משימה דחופה: פיצה. אם זו לא המשימה הנכונה, אפשר לבטל במערכת.', result: 'done', match: 'exact' });
  assert.deepEqual(w.applied[0].plan, { op: 'task_done', task: TASK });
  // A task that got a brief since: not a reply's to close. Nothing changes, and the answer says where.
  w = fakeHookDb({ messages: m('nodnik'), logs: { 10: urgent }, tasks: { [TASK]: { ...task(), brief: { route: 'irit' } } } });
  const no = await jakoReply({ db: w.db, chat: pressed('המשימה בוצעה'), body: { action: 'done', user_id: '972501111111' }, now });
  assert.deepEqual(no, { ok: false, text: 'את זה מסמנים במערכת: משימה דחופה: פיצה: https://app.astrateg.tech/clients.html#mine', result: 'not_simple', match: 'exact' });
  assert.deepEqual(w.applied[0].plan, { op: 'none', why: 'not_simple' });
  assert.equal((await w.db.task(TASK)).done_at, null);
  // "אני על זה" on a task starts it, as in the app.
  w = fakeHookDb({ messages: m('reminder'), logs: { 10: urgent }, tasks: { [TASK]: task() } });
  const on = await jakoReply({ db: w.db, chat: pressed('אני על זה'), body: { action: 'onit', user_id: '972501111111' }, now });
  assert.deepEqual([on.ok, on.result, w.applied[0].plan], [true, 'started', { op: 'task_start', task: TASK }]);
  assert.match(on.text, /^קיבלתי, נרשם ״אני על זה״: משימה דחופה: פיצה\. התזכורות ימשיכו/);
  // On a process: the claim of the app, for its owner only.
  w = fakeHookDb({ messages: m('reminder'), logs: { 10: log({ id: 10 }) } });
  assert.deepEqual([(await jakoReply({ db: w.db, chat: pressed('אני על זה'), body: { action: 'onit', user_id: '972501111111' }, now })).result, w.applied[0].plan], ['claimed', { op: 'claim', item: 'p01.claim' }]);
  w = fakeHookDb({ messages: m('reminder'), logs: { 10: log({ id: 10 }) }, apply: () => 'taken' });
  assert.deepEqual(await jakoReply({ db: w.db, chat: pressed('אני על זה'), body: { action: 'onit', user_id: '972501111111' }, now }), { ok: false, text: 'מישהו אחר כבר לקח את זה: עסקה חדשה: פיצה. הפרטים במערכת.', result: 'taken', match: 'exact' });
  // A button the message did not have (a press on a digest, say) does nothing.
  w = fakeHookDb({ messages: m('summary'), logs: { 10: log({ id: 10, rule: 'digest' }) } });
  assert.deepEqual([(await jakoReply({ db: w.db, chat: pressed('אני על זה'), body: { action: 'onit', user_id: '972501111111' }, now })).result, w.applied[0].plan], ['no_button', { op: 'none', why: 'no_button' }]);
  // The plans themselves: a nagging task is its assignee's.
  const nag = { id: TASK, assignee: 'irit', status: 'open', body: 'x' };
  assert.deepEqual(jakoReplyPlan({ action: 'done', log: nagRow(), message: { template: 'nodnik' }, nag }), { op: 'nag_done', task: TASK });
  assert.deepEqual(jakoReplyPlan({ action: 'done', log: nagRow(), message: { template: 'reminder' }, nag }), { op: 'none', why: 'no_button' });
  assert.deepEqual(jakoReplyPlan({ action: 'done', log: nagRow(), message: { template: 'nodnik' }, nag: { ...nag, assignee: 'lior' } }), { op: 'none', why: 'not_open' });
  assert.deepEqual(jakoReplyPlan({ action: 'onit', log: null, message: null }), { op: 'none', why: 'unknown' });
  assert.ok(jakoOpen({ action: 'onit', log: log() }) && !jakoOpen({ action: 'done', log: log() }));
  assert.equal(nagIdOf(nagRow()), TASK);
  assert.equal(jakoTitle({ log: log({ title: 'ת'.repeat(200) }) }).length, 80);
  assert.equal(MINE_LINK, 'https://app.astrateg.tech/clients.html#mine');
  // applyPress alone: not one of our buttons, or no id → not ours to decide.
  assert.equal(await applyPress({ db: w.db, press: press('wamid.Z', 'כפתור אחר', 'wamid.OUT1', now), phones: ['972501111111'] }), null);
  assert.equal(await applyPress({ db: w.db, press: press('wamid.Z', 'אני על זה', null, now), phones: ['972501111111'] }), null);
  assert.equal(await applyPress({ db: w.db, press: press('wamid.Z', 'אני על זה', 'wamid.OUT1', now), phones: ['972509999999'] }), null);
  assert.equal((await applyReply({ db: w.db, action: 'onit', message: null, inbound: 'x' })).result, 'nothing');
  // Every answer is short, and none speaks to one gender.
  for (const r of ['done', 'started', 'claimed', 'noted', 'unchanged', 'duplicate', 'taken', 'closed', 'nothing', 'bad', 'error', 'not_simple', 'whatever']) {
    const a = hookAnswer(r, 'כותרת');
    assert.ok(typeof a.ok === 'boolean' && a.text.length > 5 && a.text.length < 200 && !/\n/.test(a.text), r);
    assert.doesNotMatch(a.text, /את\/ה|פתח\/י|סמן\/י/, r);
  }
});
