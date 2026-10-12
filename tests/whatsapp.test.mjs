// The staff WhatsApp channel (stage 4): the templates as data (Meta's rules), which
// template a reminder takes, the channel choice (agreed, the same number, the
// sending hours), the sender against a fake fetch, the reminders tick with the
// second channel (each reminder once, never outside the hours), the webhook's
// signature and subscription checks, and what a reply button does. Then the second
// provider, Jako: its templates, its sender against a fake fetch (retries, timeouts,
// the key never in an error), the tick through it, and "הסר" heard by asking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  TEMPLATES, FOOTER, BUTTONS, OPEN_BUTTON, SITE_URL, metaDefinition, templateFor, templateMessage, cleanParam, pagePath,
  payloadOf, parsePayload, actionOfText, taskIdOf, simpleTask,
  WA_PROVIDERS, JAKO_SUFFIX, JAKO_ANSWER, templateOf, jakoMessage, jakoUserId, jakoUrlParam,
} from '../app/wa-templates.js';
import { waRecipients, waPlan, replyPlan, isStop, ackText, ownsProcess } from '../app/wa-logic.js';
import { graphSend, graphUrl, GRAPH_VERSION } from '../supabase/functions/_shared/wa-graph.js';
import { makeJako, JAKO_BASE, JAKO_TIMEOUT, JAKO_BUDGET, LIST_AGAIN } from '../supabase/functions/_shared/wa-jako.js';
import { makeWhatsapp } from '../supabase/functions/reminders/whatsapp.js';
import { makeJakoWhatsapp, POLL_EVERY, POLL_MAX } from '../supabase/functions/reminders/wa-poll.js';
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
const jakoNames = Object.keys(TEMPLATES).map((k) => templateOf(k, 'jako').name);
function fakeJakoApi({ listed = jakoNames.map((name) => ({ name, namespace: `ns_${name}`, lang: 'he', status: 'APPROVED' })), chat = () => ({ status: 200, body: { data: [] } }), send = () => ({ status: 200, body: { status: 'ok' } }), list = null } = {}) {
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
  return { fetch, calls, sends: () => of('/subscriber/send-whatsapp-template-by-user-id'), lists: () => of('/whatsapp-template/list'), chats: () => of('/subscriber/chat-messages') };
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

test('Jako\'s templates: the same nine under their own names, no quick replies, and no sentence that promises one', () => {
  const answer = 'אפשר לענות כאן בכפתור, או לפתוח במערכת.';
  const changed = [];
  for (const [key, t] of Object.entries(TEMPLATES)) {
    const def = metaDefinition(key, { provider: 'jako' });
    const meta = metaDefinition(key);
    // Meta's own definition is what it was, quick replies and all.
    assert.deepEqual(meta, metaDefinition(key, { provider: 'meta' }));
    assert.equal(meta.name, t.name);
    assert.deepEqual(meta.components.find((c) => c.type === 'BUTTONS').buttons.map((b) => b.type), [...t.replies.map(() => 'QUICK_REPLY'), 'URL']);
    // Jako's: Meta's rules for a template, as for the others above.
    assert.equal(def.name, `${t.name}${JAKO_SUFFIX}`);
    assert.match(def.name, /^astrateg_[a-z_]+_j$/, key);
    assert.ok(def.name.length <= 60, key);
    assert.deepEqual([def.category, def.language], ['UTILITY', 'he']);
    assert.deepEqual(def.components.map((c) => c.type), ['BODY', 'FOOTER', 'BUTTONS']);
    const body = def.components[0];
    assert.deepEqual([...body.text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])), [1, 2], key);
    assert.ok(!/^\s*\{\{/.test(body.text) && !/\}\}\s*$/.test(body.text), `${key}: a variable at the start or the end`);
    assert.ok(body.text.length + 200 + 700 < 1024, key);
    assert.deepEqual(body.example, { body_text: [t.example] });
    assert.ok(!body.text.includes(answer) && !/בכפתור/.test(body.text), `${key}: promises a reply button`);
    assert.equal(def.components[1].text, FOOTER);
    // One button: the link to the app.
    assert.deepEqual(def.components[2].buttons, [{ type: 'URL', text: OPEN_BUTTON, url: `${SITE_URL}{{1}}`, example: [`${SITE_URL}clients.html`] }]);
    if (t.body.includes(answer)) {
      changed.push(key);
      assert.equal(body.text, t.body.replace(answer, JAKO_ANSWER));
    } else assert.equal(body.text, t.body, key);
  }
  assert.deepEqual(changed, ['new_task', 'due', 'late', 'shoot_day', 'editor_assigned']);
  assert.equal(JAKO_ANSWER, 'לפתיחה ולסימון: הכפתור למטה.');
  // Both sets can exist side by side, and which template a reminder takes is the same.
  assert.equal(new Set([...jakoNames, ...Object.values(TEMPLATES).map((t) => t.name)]).size, 18);
  assert.deepEqual(WA_PROVIDERS, ['meta', 'jako']);
  assert.throws(() => templateOf('due', 'twilio'), /unknown provider/);
  assert.throws(() => templateOf('nope', 'jako'), /unknown template/);
});

test('Jako\'s message: the number as user_id, the two variables and the page, the first name only, no namespace yet', () => {
  const m = jakoMessage({ template: 'due', to: '972501234567', row: log({ body: 'חסר חוזה\nלבדוק' }) });
  assert.deepEqual(m, {
    user_id: '972501234567', create_if_not_found: 'yes',
    content: { name: 'astrateg_due_j', lang: 'he', params: { 'BODY_{{1}}': 'עסקה חדשה: פיצה', 'BODY_{{2}}': 'חסר חוזה · לבדוק', URL_1: 'client.html?id=c1' } },
    contact: { first_name: 'עירית' },
  });
  assert.equal(jakoUserId('+972 50-123-4567'), '972501234567');
  assert.equal(jakoUrlParam('https://evil.test/x'), 'clients.html');
  // No quick reply parameters for any template, also the one with three buttons at Meta.
  assert.deepEqual(Object.keys(jakoMessage({ template: 'new_task', to: '972501234567', row: log() }).content.params), ['BODY_{{1}}', 'BODY_{{2}}', 'URL_1']);
});

test('the Jako sender: the namespace from Jako\'s list (read once), the key in the header only, "sent" on ok', async () => {
  const api = fakeJakoApi();
  const jako = makeJako({ fetch: api.fetch, apiKey: KEY, wait: noWait });
  const message = jakoMessage({ template: 'due', to: '972501234567', row: log() });
  assert.deepEqual(await jako.send(message), { ok: true });
  const [list] = api.lists();
  assert.deepEqual([list.method, list.query], ['POST', { limit: '100', page: '1' }]);
  const [sent] = api.sends();
  assert.equal(sent.method, 'POST');
  assert.equal(sent.headers.Authorization, `Bearer ${KEY}`);
  assert.deepEqual(sent.body, { ...message, content: { namespace: 'ns_astrateg_due_j', ...message.content } });
  assert.equal(sent.body.user_id, '972501234567');
  assert.ok(!JSON.stringify(sent.body).includes(KEY) && !JSON.stringify(sent.query).includes(KEY));
  // The next sends do not ask for the list again (the instance remembers it).
  await jako.send(jakoMessage({ template: 'digest', to: '972501234567', row: log({ rule: 'digest' }) }));
  await jako.send(message);
  assert.deepEqual([api.lists().length, api.sends().length], [1, 3]);
  assert.equal(JAKO_BASE, 'https://my.jako.co.il/api');
  // Not configured: no key, or a number that is not one. Nothing is asked of Jako.
  const none = fakeJakoApi();
  assert.equal((await makeJako({ fetch: none.fetch, apiKey: '' }).send(message)).error, 'not_configured');
  assert.equal((await makeJako({ fetch: none.fetch, apiKey: KEY }).send({ ...message, user_id: '../x' })).error, 'not_configured');
  assert.equal(none.calls.length, 0);
});

test('the Jako sender: a template that is missing or not approved fails that message with a clear code, and is looked for again later', async () => {
  let listed = [
    { name: 'astrateg_due_j', namespace: 'ns_due', lang: 'he', status: 'PENDING' },
    { name: 'astrateg_late_j', namespace: 'ns_late', lang: 'he', status: 'approved' },
    { name: 'astrateg_review_j', lang: 'he', status: 'APPROVED' },
    { name: 'astrateg_digest_j', namespace: 'ns_en', lang: 'en', status: 'APPROVED' },
  ];
  const api = fakeJakoApi({ list: () => ({ status: 200, body: { data: listed } }) });
  let now = 1_000_000;
  const jako = makeJako({ fetch: api.fetch, apiKey: KEY, wait: noWait, clock: () => now });
  const m = (template) => jakoMessage({ template, to: '972501234567', row: log() });
  assert.deepEqual(await jako.send(m('due')), { ok: false, status: 0, error: 'jako not_approved' });
  assert.deepEqual(await jako.send(m('exception')), { ok: false, status: 0, error: 'jako no_template' });
  assert.deepEqual(await jako.send(m('review')), { ok: false, status: 0, error: 'jako no_namespace' });
  assert.equal((await jako.send(m('digest'))).error, 'jako no_template', 'another language is another template');
  assert.deepEqual(await jako.send(m('late')), { ok: true });
  assert.deepEqual([api.lists().length, api.sends().length], [1, 1], 'one list for all of them, and only the approved one was sent');
  // Approved meanwhile: found once the list is read again (not before LIST_AGAIN).
  listed = [{ name: 'astrateg_due_j', namespace: 'ns_due', lang: 'he', status: 'APPROVED' }];
  assert.equal((await jako.send(m('due'))).error, 'jako not_approved');
  now += LIST_AGAIN;
  assert.deepEqual(await jako.send(m('due')), { ok: true });
  assert.equal(api.lists().length, 2);
  // The list itself fails: the messages fail with its code, and nothing is sent blind.
  const down = fakeJakoApi({ list: () => ({ status: 401, body: { message: `bad key ${KEY}` } }) });
  const out = await makeJako({ fetch: down.fetch, apiKey: KEY, wait: noWait }).send(m('due'));
  assert.deepEqual(out, { ok: false, status: 0, error: 'jako list 401' });
  assert.equal(down.sends().length, 0);
  // More templates than one page: the next page is read.
  const many = Array.from({ length: 100 }, (_, i) => ({ name: `other_${i}`, namespace: 'x', lang: 'he', status: 'APPROVED' }));
  const paged = fakeJakoApi({ list: (c) => ({ status: 200, body: { data: c.query.page === '1' ? many : [{ name: 'astrateg_due_j', namespace: 'ns_p2', lang: 'he', status: 'APPROVED' }] } }) });
  assert.deepEqual(await makeJako({ fetch: paged.fetch, apiKey: KEY, wait: noWait }).send(m('due')), { ok: true });
  assert.equal(paged.sends()[0].body.content.namespace, 'ns_p2');
});

test('the Jako sender: a 4xx is not tried again, a 5xx or a network error once, a timeout never; no error names the key or the number', async () => {
  const message = jakoMessage({ template: 'due', to: '972501234567', row: log() });
  const run = async (answers, opts = {}) => {
    let i = 0;
    const api = fakeJakoApi({ send: () => answers[Math.min(i++, answers.length - 1)] });
    const waits = [];
    let res;
    const logged = await quietly(async () => { res = await makeJako({ fetch: api.fetch, apiKey: KEY, wait: async (ms) => { waits.push(ms); }, ...opts }).send(message); });
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
  const message = jakoMessage({ template: 'due', to: '972501234567', row: log() });
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
function fakeJakoWa({ recipients = IRIT_OK, api = fakeJakoApi(), due = [], stop = async () => 'withdrawn' } = {}) {
  const rows = [];
  const db = {
    async claim(row) { if (rows.some((r) => r.log_id === row.log_id)) return null; const r = { id: rows.length + 1, created_at: new Date().toISOString(), ...row }; rows.push(r); return { id: r.id }; },
    async update(id, patch) { Object.assign(rows.find((r) => r.id === id), patch); },
    async expire() { return 0; },
  };
  const poll = { asked: [], done: [], stops: [] };
  const pollDb = {
    async due(max, everyMs) { poll.asked.push([max, everyMs]); return typeof due === 'function' ? due() : due; },
    async done(email, until) { poll.done.push([email, until.toISOString()]); },
    async stop(args) { poll.stops.push(args); return stop(args); },
  };
  const list = waRecipients(recipients);
  const wa = makeJakoWhatsapp({ db, pollDb, jako: makeJako({ fetch: api.fetch, apiKey: KEY, wait: noWait }), recipients: list });
  return { wa, rows, api, poll, list };
}

test('with Jako a ring goes by push and once by WhatsApp, as "sent" with no message id; outside the hours nothing; a failed send is recorded and the tick goes on', async () => {
  const db = fakeDb({ clients: [deal(IL(2026, 10, 5, 10))], subs: [{ id: 's1', email: 'irit@x', endpoint: 'https://push.test/p', p256dh: 'x', auth: 'y', fail_count: 0 }] });
  const { wa, rows, api } = fakeJakoWa();
  const t0 = IL(2026, 10, 5, 10);
  const stats = await runTick({ db: db.at(t0), push, wa, now: t0 });
  assert.deepEqual([stats.pushed, stats.waSent, stats.waFailed], [1, 1, 0]);
  const [sent] = api.sends();
  assert.deepEqual([sent.body.user_id, sent.body.content.name, sent.body.content.namespace], ['972501111111', 'astrateg_due_j', 'ns_astrateg_due_j']);
  assert.equal(sent.body.content.params['BODY_{{1}}'], 'עסקה חדשה: פיצה');
  const logRow = db.log.find((r) => r.key === 'deal:c1:deal:now@irit');
  assert.deepEqual([rows[0].log_id, rows[0].status, rows[0].template, rows[0].person, rows[0].provider, rows[0].wa_message_id], [logRow.id, 'sent', 'due', 'irit', 'jako', undefined]);
  // The same reminder taken again finds its claim: not sent twice.
  await wa.deliver({ sends: [{ row: logRow, kind: 'ring' }], env: { tasks: [] }, now: t0, stats: {} });
  assert.equal(api.sends().length, 1);
  // Meta's channel does not mark its rows (the column's default says 'meta').
  const meta = fakeWa({ recipients: IRIT_OK });
  await meta.wa.deliver({ sends: [{ row: log({ id: 77 }), kind: 'ring' }], env: { tasks: [] }, now: t0, stats: {} });
  assert.ok(!('provider' in meta.rows[0]) && meta.sent[0].messaging_product === 'whatsapp');

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
  assert.deepEqual(f.poll.done.sort(), [['irit@x', now.toISOString()], ['ofir@x', now.toISOString()]]);
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
  assert.deepEqual([s3.waPolled, s3.waPollErrors, s3.waSent, down.poll.done.length, down.api.chats().length], [0, 1, 1, 0, 1]);
  // A contact Jako does not know yet (nobody wrote, nothing was sent): nothing to read.
  const fresh = fakeJakoWa({ api: fakeJakoApi({ chat: () => ({ status: 400, body: { message: 'user not found' } }) }), due: [due[0]] });
  const s4 = {};
  await fresh.wa.deliver({ sends: [], env: { tasks: [] }, now, stats: s4 });
  assert.deepEqual([s4.waPolled, s4.waPollErrors, fresh.poll.done.length], [1, 0, 1]);
  // Nobody is due: Jako is not asked at all. The database failing to say who is due does not stop the messages.
  const idle = fakeJakoWa();
  await idle.wa.deliver({ sends: [sends[0]], env: { tasks: [] }, now, stats: {} });
  assert.deepEqual([idle.api.chats().length, idle.api.sends().length], [0, 1]);
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
