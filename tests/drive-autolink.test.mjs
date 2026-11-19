// The clients' Drive folders found and connected by themselves (the owner, 19.11.2026; docs/ops.md,
// section 143): app/drive-autolink-logic.js, the drive-link function's run (with a fake Drive, a fake
// Claude and a fake database) and the reminder rule driveAsk. Invented businesses only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  autolinkWork, autolinkPayload, autolinkRequest, checkAnswer, autolinkActions, askKeyOf, askWords, answerOf, AUTOLINK_MODEL, folderLink,
} from '../app/drive-autolink-logic.js';
import { MODEL } from '../supabase/functions/contract-ai/handler.js';
import { runAutolink } from '../supabase/functions/drive-link/run.js';
import { RULE_BY_ID, DRIVE_ASK } from '../app/reminder-rules.js';
import { buildEnv } from '../app/reminder-engine.js';

const F = (n) => `folder${String(n).padStart(6, '0')}x`; // a Drive id: 10+ letters
const client = (id, business, over = {}) => ({ id, business, name: over.name ?? '', status: 'active', archived_at: null, links: {}, ...over });
const CLIENTS = [
  client('a', 'לאב מובייל', { name: 'אופיר' }),
  client('b', 'נוריה אירועים', { name: 'שחר' }),
  client('c', 'קפה הים', { links: { drive: folderLink(F(3)) } }), // linked already
  client('d', 'מאפיית השקד', { status: 'ended', links: { drive: folderLink(F(4)) } }), // an old client: its folder stays its own
  client('e', 'גלידה טובה', { archived_at: '2026-10-01T00:00:00Z' }), // archived: not looked for
  client('f', 'דרים סקין'),
];
const FOLDERS = [
  { id: F(1), name: 'LAB MOBILE' },
  { id: F(2), name: 'נורית אירועים' },
  { id: F(3), name: 'קפה הים' },
  { id: F(4), name: 'מאפיית השקד' },
  { id: F(5), name: '  Dream skin   שדרות ' },
  { id: F(6), name: 'נוריה' },
  { id: 'bad', name: 'not an id' },
];

test('the model is the same as contract-ai\'s', () => {
  assert.equal(AUTOLINK_MODEL, MODEL);
  assert.equal(autolinkRequest({ clients: [], folders: [] }).model, MODEL);
});

test('who and which folders: current clients with no link; folders nobody (not even an old client) is linked to', () => {
  const w = autolinkWork(CLIENTS, FOLDERS);
  assert.deepEqual(w.clients.map((c) => c.id), ['a', 'b', 'f']);
  assert.deepEqual(w.folders.map((f) => f.id), [F(1), F(2), F(5), F(6)]);
  assert.equal(w.folders[2].name, 'Dream skin שדרות', 'names cleaned');
});

test('only names go to Claude: references, the business, the client\'s name, the folder names', () => {
  const p = autolinkPayload(autolinkWork(CLIENTS, FOLDERS));
  assert.deepEqual(p.clients[0], { ref: 'c1', business: 'לאב מובייל', name: 'אופיר' });
  assert.deepEqual(p.folders[0], { ref: 'f1', name: 'LAB MOBILE' });
  const all = JSON.stringify(autolinkRequest(p));
  for (const k of ['phone', 'email', 'notes', 'links', F(1)]) assert.ok(!all.includes(k), k);
  assert.match(autolinkRequest(p).system[0].text, /נוריה" is not "נורית/);
});

test('the answer is checked: unknown references dropped, a folder sure for two clients is asked about for both', () => {
  const w = autolinkWork(CLIENTS, FOLDERS);
  const out = checkAnswer({ matches: [
    { client: 'c1', sure: 'f1', maybe: ['f9'] },
    { client: 'c2', sure: null, maybe: ['f2', 'f4', 'f2', 'zz'] },
    { client: 'c3', sure: 'f3', maybe: [] },
    { client: 'c9', sure: 'f1', maybe: [] },
  ] }, w);
  assert.deepEqual(out.map((x) => [x.client.id, x.sure?.id || null, x.maybe.map((f) => f.id)]), [
    ['a', F(1), []],
    ['b', null, [F(2), F(6)]],
    ['f', F(5), []],
  ]);
  const twice = checkAnswer({ matches: [{ client: 'c1', sure: 'f3', maybe: [] }, { client: 'c3', sure: 'f3', maybe: ['f1'] }] }, w);
  assert.deepEqual(twice.map((x) => [x.client.id, x.sure, x.maybe.map((f) => f.id)]), [['a', null, [F(5)]], ['f', null, [F(5), F(1)]]]);
  assert.deepEqual(checkAnswer(null, w), []);
  assert.deepEqual(checkAnswer({ matches: [{ client: 'c1', sure: null, maybe: [] }] }, w), []);
});

test('asked once per set of folders: not again while open, nor after "אף אחת"; a new set is asked', () => {
  const w = autolinkWork(CLIENTS, FOLDERS);
  const checked = checkAnswer({ matches: [{ client: 'c1', sure: 'f1', maybe: [] }, { client: 'c2', sure: null, maybe: ['f4', 'f2'] }] }, w);
  const key = askKeyOf([{ id: F(6) }, { id: F(2) }]);
  assert.equal(key, `${F(2)},${F(6)}`);
  const first = autolinkActions(checked, new Map());
  assert.deepEqual(first.map((a) => [a.act, a.client.id]), [['link', 'a'], ['ask', 'b']]);
  assert.equal(first[1].key, key);
  assert.deepEqual(first[1].candidates, [{ id: F(6), name: 'נוריה' }, { id: F(2), name: 'נורית אירועים' }]);
  for (const status of ['ask', 'none']) {
    assert.deepEqual(autolinkActions(checked, new Map([['b', { status, ask_key: key }]])).map((a) => a.client.id), ['a'], status);
  }
  assert.deepEqual(autolinkActions(checked, new Map([['b', { status: 'none', ask_key: F(2) }]])).map((a) => a.client.id), ['a', 'b']);
});

test('the words of the question', () => {
  const w = askWords('נוריה אירועים', [{ id: F(2), name: 'נורית אירועים' }, { id: F(6), name: 'נוריה' }]);
  assert.equal(w.title, 'איזו תיקייה בדרייב של נוריה אירועים?');
  assert.match(w.body, /״נורית אירועים״ או ״נוריה״/);
});

function fakes({ answer, main = 'mainfolder0001', states = [] } = {}) {
  const db = { links: [], asks: [], asked: 0, clients: CLIENTS.map((c) => ({ ...c, links: { ...c.links } })) };
  const store = {
    mainFolder: async () => main,
    clients: async () => db.clients,
    states: async () => states,
    async link(id, folder, name) {
      const c = db.clients.find((x) => x.id === id);
      if (c.links.drive) return false; // never over a link (public.drive_link_auto)
      c.links.drive = folderLink(folder);
      db.links.push([id, folder, name]);
      return true;
    },
    async ask(row) { db.asks.push(row); },
  };
  const drive = { folders: async (id) => { assert.equal(id, main); return FOLDERS; } };
  const ai = { async ask(req) { db.asked += 1; db.req = req; return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(answer) }] }; } };
  return { db, store, drive, ai };
}

test('a run: the sure ones are linked, the unsure one is kept for Irit, nothing else', async () => {
  const { db, store, drive, ai } = fakes({ answer: { matches: [
    { client: 'c1', sure: 'f1', maybe: [] },
    { client: 'c2', sure: null, maybe: ['f2', 'f4'] },
    { client: 'c3', sure: 'f3', maybe: [] },
  ] } });
  const stats = await runAutolink({ store, drive, ai });
  assert.deepEqual(stats, { clients: 3, folders: 4, linked: 2, asked: 1, skipped: null });
  assert.deepEqual(db.links, [['a', F(1), 'LAB MOBILE'], ['f', F(5), 'Dream skin שדרות']]);
  assert.deepEqual(db.asks.map((r) => [r.client_id, r.status, r.ask_key, r.candidates.length]), [['b', 'ask', `${F(2)},${F(6)}`, 2]]);
  assert.equal(db.clients.find((c) => c.id === 'c').links.drive, folderLink(F(3)), 'a link that was there is kept');
});

test('a run with nothing to do, no folder set, no key, or a broken answer', async () => {
  assert.equal((await runAutolink({ ...fakes({ main: null }), ai: {} })).skipped, 'no_folder');
  const f = fakes({ answer: {} });
  assert.equal((await runAutolink({ store: f.store, drive: f.drive, ai: null })).skipped, 'no_ai');
  const bad = fakes();
  bad.ai.ask = async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] });
  assert.equal((await runAutolink(bad)).skipped, 'ai_no_answer');
  const fail = fakes();
  fail.ai.ask = async () => { throw Object.assign(new Error('x'), { status: 529 }); };
  const logs = [];
  assert.equal((await runAutolink({ ...fail, log: (m) => logs.push(m) })).skipped, 'ai_failed');
  assert.match(logs[0], /529/);
  const none = fakes({ answer: { matches: [] } });
  none.db.clients.forEach((c) => { c.links.drive ||= folderLink('linkedalready'); });
  assert.deepEqual(await runAutolink(none), { clients: 0, folders: 4, linked: 0, asked: 0, skipped: null });
  assert.equal(none.db.asked, 0, 'Claude is not asked when nobody needs a folder');
  assert.equal(answerOf({ stop_reason: 'refusal', content: [] }), null);
});

test('the rule driveAsk: Irit and the owners, once per client and set; not when the card got a link', () => {
  const rule = RULE_BY_ID.get(DRIVE_ASK.id);
  const now = new Date('2026-11-19T09:00:00+02:00');
  const ask = { client_id: 'b', status: 'ask', ask_key: `${F(2)},${F(6)}`, candidates: [{ id: F(2), name: 'נורית אירועים' }, { id: F(6), name: 'נוריה' }], updated_at: '2026-11-19T08:30:00+02:00' };
  const staff = [{ email: 'o@x.test', person: null }, { email: 'i@x.test', person: 'irit' }];
  const env = buildEnv({ clients: CLIENTS, staff, now, driveAsks: [ask, { ...ask, client_id: 'c' }] });
  const inst = rule.instances(env);
  assert.deepEqual(inst.map((i) => i.id), [`b@${F(2)},${F(6)}`], 'the linked client c is not asked about');
  const step = rule.steps[0];
  assert.deepEqual(step.to(inst[0], env), ['irit', 'owner']);
  assert.equal(step.level, 'ring');
  assert.match(step.title(inst[0]), /^איזו תיקייה בדרייב של נוריה אירועים/);
  assert.match(inst[0].url, /#drive-pick$/);
});
