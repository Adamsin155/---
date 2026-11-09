// The owner's write tools of the mcp function (docs/ops.md, section 116), driven whole through its handler
// with a fake database in place of Supabase: only the owner lists and runs them (Lior and Ofir keep the reads
// and the draft); a dry run writes nothing and answers a Hebrew preview; a real call writes through the
// owner's own client (the OAuth token and the gate's key), only what WRITE_GATE lists; the card's rules
// hold; nothing is deleted but a mark that is cleared; no phone, email or company id comes back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeHandler, claimsOf, GATE_HEADER, WRITE_REFUSED } from '../supabase/functions/mcp/handler.js';
import { WRITE_TOOLS, WRITE_GATE, WRITE_NAMES, MCP_WRITE_TOOLS, mayWrite, guardWrite, NOTES_OFF, sendText } from '../supabase/functions/mcp/write-tools.js';
import { mcpGateOf, mcpCallerIsOwner, MCP_GATE_HEADER } from '../supabase/functions/create-quote/http.js';
import { DRAFT_TOOL } from '../app/mcp-draft.js';
import { clientState } from '../app/protocol-logic.js';
import { folderTitle } from '../app/qa-logic.js';

const BASE = 'https://proj.supabase.co';
const NOW = Date.parse('2026-11-12T08:00:00Z');
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const tokenFor = (who) => `${b64({ alg: 'ES256' })}.${b64({
  sub: `id-${who}`, email: `${who}@astrateg.test`, role: 'authenticated', aud: 'authenticated', iss: `${BASE}/auth/v1`, exp: NOW / 1000 + 3600, client_id: 'claude-client',
})}.sig`;
const PEOPLE_ROWS = { owner: { person: null }, owner2: { person: null }, lior: { person: 'lior' }, ofir: { person: 'ofir' } };

const ID = { c1: '11111111-1111-4111-8111-111111111111', c2: '22222222-2222-4222-8222-222222222222', deal: '33333333-3333-4333-8333-333333333333', st1: '44444444-4444-4444-8444-444444444444', st2: '55555555-5555-4555-8555-555555555555', ct1: '66666666-6666-4666-8666-666666666666', note: '77777777-7777-4777-8777-777777777777' };
// Rows hold what must never come out: phones, emails, company ids, notes.
const SECRETS = ['050-1112222', '0501112222', 'ron@private.test', '515151515', 'סיסמה: 1234', '052-9998888', 'deal@private.test', '516161616'];
const client1 = () => ({
  id: ID.c1, name: 'רון כהן', business: 'מספרת רון', address: 'רחוב הסוד 5', package_name: 'Social · נטלי', shoot_type: 'natali', characterizer: 'noam', has_logo: true,
  editor_name: null, deal_at: '2026-10-01T08:00:00Z', char_at: null, shoot_at: null, contract_end: '2027-10-01', status: 'active', quote_id: null,
  created_at: '2026-10-01T08:00:00Z', links: {}, deliverables: { videos: 36, graphics: 36, shoot_days: 2 }, rounds: [{ n: 2, shoot_at: '2027-01-10T07:00:00Z', shoot_type: 'natali', editor: null }],
  editor: 'nadia', editor2: null, protocol_version: 12, archived_at: null, landing: false, landed_at: null, landing_slot: null,
  phone: '050-1112222', notes: 'סיסמה: 1234', contact_email: 'ron@private.test', company_id: '515151515',
});
const client2 = () => ({ ...client1(), id: ID.c2, name: 'דנה לוי', business: 'פיצה דנה', phone: '052-9998888', rounds: [] });

function store() {
  return {
    clients: [client1(), client2()],
    protocol_checks: [],
    client_tasks: [
      { id: ID.ct1, client_id: ID.c1, title: folderTitle(), owner: 'ofir', done_at: null, created_at: '2026-11-01T08:00:00Z' },
    ],
    staff_tasks: [
      { id: ID.st1, assignee: 'nadia', body: 'לערוך את הסרטון של רון', client_id: ID.c1, client_name: 'מספרת רון · רון כהן', created_by: 'owner', status: 'open' },
      { id: ID.st2, assignee: 'owner', body: 'להתקשר לרואה החשבון', client_id: null, client_name: null, created_by: 'irit', status: 'open' },
    ],
    client_gantt: [],
    client_scripts: [],
    client_files: [],
    deal_requests: [{ id: ID.deal, created_at: '2026-11-10T08:00:00Z', seller: 'stav', business_name: 'קפה גלית', contact_name: 'גלית', phone: '052-9998888', company_id: '516161616', business_address: 'הרצל 1', notes: 'deal@private.test', status: 'pending', quote_id: null, taken_by: null }],
    photographer_months: [],
    photographer_changes: [],
    staff_notes: [],
    system_requests: [],
  };
}

// A fake of supabase-js for the person's client: the PostgREST requests it would make, recorded with the
// headers it was made with, and the effect on the rows.
function fakeUserClient(db, headers, log, opts) {
  const who = claimsOf(String(headers.Authorization).replace(/^Bearer /, ''))?.sub?.replace(/^id-/, '');
  const me = PEOPLE_ROWS[who];
  const record = (r) => log.push({ ...r, token: headers.Authorization, gate: headers[GATE_HEADER] });
  function query(table) {
    let op = 'select'; let values = null; let conflict = null; let cols = null; let single = false; let max = Infinity;
    const filters = [];
    const q = {
      select(c) { cols = c; return q; },
      insert(v) { op = 'insert'; values = v; return q; },
      upsert(v, o) { op = 'upsert'; values = v; conflict = o?.onConflict; return q; },
      update(v) { op = 'update'; values = v; return q; },
      delete() { op = 'delete'; return q; },
      eq(k, v) { filters.push((r) => r[k] === v); return q; },
      in(k, vs) { filters.push((r) => vs.includes(r[k])); return q; },
      is(k, v) { filters.push((r) => (r[k] ?? null) === v); return q; },
      gte(k, v) { filters.push((r) => r[k] != null && String(r[k]) >= String(v)); return q; },
      lte(k, v) { filters.push((r) => r[k] != null && String(r[k]) <= String(v)); return q; },
      order() { return q; },
      limit(n) { max = n; return q; },
      single() { single = true; return q; },
      maybeSingle() { single = true; return q; },
      then(ok, bad) {
        const method = { select: 'GET', insert: 'POST', upsert: 'POST', update: 'PATCH', delete: 'DELETE' }[op];
        record({ method, path: `/${table}`, values, conflict });
        if (opts.missing?.includes(table)) return Promise.resolve({ data: null, error: { code: 'PGRST205' } }).then(ok, bad);
        if (!(table in db)) return Promise.resolve({ data: null, error: { code: 'PGRST205' } }).then(ok, bad);
        const pick = (r) => (cols ? Object.fromEntries(cols.split(',').map((s) => s.trim()).map((n) => [n, r[n] ?? null])) : r);
        let out;
        if (op === 'select') out = db[table].filter((r) => filters.every((f) => f(r))).slice(0, max);
        else if (op === 'insert' || op === 'upsert') {
          out = [];
          for (const v of [].concat(values)) {
            const keys = conflict ? conflict.split(',') : [];
            const hit = keys.length ? db[table].find((r) => keys.every((k) => r[k] === v[k])) : null;
            if (hit) { Object.assign(hit, v, { by_email: `${who}@astrateg.test`, at: new Date(NOW).toISOString() }); out.push(hit); } else {
              const row = { id: `new-${db[table].length + 1}`, ...v, by_email: `${who}@astrateg.test`, at: new Date(NOW).toISOString(), created_by: me?.person ?? 'owner' };
              db[table].push(row);
              out.push(row);
            }
          }
        } else if (op === 'update') {
          out = db[table].filter((r) => filters.every((f) => f(r)));
          for (const r of out) Object.assign(r, values);
        } else {
          out = db[table].filter((r) => filters.every((f) => f(r)));
          db[table] = db[table].filter((r) => !out.includes(r));
        }
        const data = single ? (out[0] ? pick(out[0]) : null) : out.map(pick);
        return Promise.resolve({ data, error: null }).then(ok, bad);
      },
    };
    return q;
  }
  const rpcs = {
    is_office: () => !!me,
    my_person: () => me?.person ?? null,
    mcp_allowed: () => !!me,
    sees_income: () => me?.person === null,
    staff_task_create: (a) => { db.staff_tasks.push({ id: 'new-task', assignee: a.p_assignee, body: a.p_body, client_id: a.p_client, status: 'open', created_by: 'owner' }); return 'new-task'; },
    staff_task_create_brief: (a) => rpcs.staff_task_create(a),
    staff_task_done: (a) => { const t = db.staff_tasks.find((x) => x.id === a.p_id); t.status = 'done'; return t; },
    staff_task_cancel: (a) => { const t = db.staff_tasks.find((x) => x.id === a.p_id); t.status = 'cancelled'; return t; },
    staff_note_delete: (a) => { const n = db.staff_notes.find((x) => x.id === a.p_id); n.deleted_at = new Date(NOW).toISOString(); return n; },
    date_change_note: () => null,
    photographer_taken: () => opts.taken || [],
    photographer_taken_by: () => [],
    clients_private: (a) => db.clients.filter((c) => a.p_ids.includes(c.id)).map((c) => ({ id: c.id, phone: c.phone, notes: c.notes, closed_reason: null })),
    clients_contact: (a) => db.clients.filter((c) => a.p_ids.includes(c.id)).map((c) => ({ id: c.id, contact_email: c.contact_email, company_id: c.company_id })),
    deal_take: () => ({ ok: true, taken_by: 'owner' }),
  };
  return {
    from: (t) => query(t),
    rpc: async (fn, args) => {
      if (!['is_office', 'my_person', 'mcp_allowed', 'sees_income'].includes(fn)) record({ method: 'POST', path: `/rpc/${fn}`, args });
      if (opts.missing?.includes(fn)) return { data: null, error: { code: 'PGRST202' } };
      return fn in rpcs ? { data: rpcs[fn](args || {}), error: null } : { data: null, error: { code: 'PGRST202' } };
    },
    auth: { getUser: async () => ({ data: { user: me ? { id: `id-${who}`, email: `${who}@astrateg.test` } : null }, error: null }) },
  };
}

function world(opts = {}) {
  const db = store();
  const log = [];
  const usage = [];
  const fetched = [];
  const deps = {
    env: (k) => ({ SUPABASE_URL: BASE, SUPABASE_ANON_KEY: 'anon' })[k],
    serviceKey: () => 'service',
    now: () => NOW,
    log: () => {},
    fetch: async (url, init) => {
      fetched.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      if (opts.quoteFails) return new Response(JSON.stringify({ error: 'x' }), { status: 500 });
      return new Response(JSON.stringify({ id: 'q-new', token: 'tok-123', number: 'AST-77', created_at: new Date(NOW).toISOString() }), { status: 200 });
    },
    createClient: (_url, key, o) => {
      if (key === 'service') {
        return {
          rpc: async (fn) => (fn === 'mcp_gate_key' ? { data: 'the-gate-key', error: null } : { data: null, error: {} }),
          from: (t) => ({ insert: async (row) => { if (t === 'mcp_usage') usage.push(row); return { error: null }; } }),
        };
      }
      return fakeUserClient(db, o.global.headers, log, opts);
    },
  };
  return { handle: makeHandler(deps), db, log, usage, fetched };
}
const call = async (w, who, name, args) => {
  const res = await w.handle(new Request('http://edge.local/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenFor(who)}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  }));
  assert.equal(res.status, 200);
  const { result } = await res.json();
  return { ...JSON.parse(result.content[0].text), isError: !!result.isError };
};
const list = async (w, who) => (await (await w.handle(new Request('http://edge.local/mcp', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenFor(who)}` },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
}))).json()).result.tools;
const writes = (w) => w.log.filter((r) => r.method !== 'GET' && !/^\/rpc\/(photographer_taken|photographer_taken_by|clients_private|clients_contact)$/.test(r.path));
const noSecrets = (text) => { for (const s of SECRETS) assert.ok(!String(text).includes(s), `leaked: ${s}`); };

// ── Who ────────────────────────────────────────
test('the owners list the write tools; Lior and Ofir do not, and keep the reads and the draft', async () => {
  const w = world();
  for (const who of ['owner', 'owner2']) {
    const names = (await list(w, who)).map((t) => t.name);
    for (const n of WRITE_NAMES) assert.ok(names.includes(n), `${who}: ${n}`);
  }
  for (const who of ['lior', 'ofir']) {
    const tools = await list(w, who);
    assert.ok(tools.some((t) => t.name === DRAFT_TOOL), `${who} keeps the draft`);
    assert.ok(tools.some((t) => t.name === 'find_clients'), `${who} keeps the reads`);
    assert.ok(!tools.some((t) => WRITE_NAMES.has(t.name)), `${who} sees no write tool`);
  }
  assert.equal(mayWrite({ office: true, person: null }), true);
  for (const x of [{ office: true, person: 'lior' }, { office: true, person: 'ofir' }, { office: false, person: null }, {}, { office: true }]) assert.equal(mayWrite(x), false);
});

test('Lior and Ofir calling a write tool: refused in Hebrew, nothing asked or written, kept as not_allowed', async () => {
  const w = world();
  for (const who of ['lior', 'ofir']) {
    for (const t of WRITE_TOOLS) {
      const out = await call(w, who, t.name, { dry_run: false, client: 'רון', text: 'x', person: 'נדיה', item: 'p03.who', state: 'done', which: 'shoot', at: '2026-12-01T10:00', contract: { package: 'podcast-natali' }, action: 'add' });
      assert.equal(out.isError, true);
      assert.equal(out.error, WRITE_REFUSED);
    }
  }
  assert.deepEqual(w.log, [], 'not one request');
  assert.ok(w.usage.length >= 16 && w.usage.every((u) => u.code === 'not_allowed' && WRITE_NAMES.has(u.tool)));
  // They still read and draft.
  const team = await call(w, 'lior', 'team', {});
  assert.ok(Array.isArray(team.people));
  const draft = await call(w, 'ofir', DRAFT_TOOL, { package: 'podcast-natali' });
  assert.ok(draft.link);
});

test('every write tool: annotated as a write, says what it changes and to dry-run first; no delete tool', () => {
  assert.equal(MCP_WRITE_TOOLS.length, 8);
  for (const t of MCP_WRITE_TOOLS) {
    assert.equal(t.annotations.readOnlyHint, false, t.name);
    assert.equal(typeof t.annotations.destructiveHint, 'boolean', t.name);
    assert.match(t.description, /^WRITES/, t.name);
    assert.match(t.description, /dry_run: true/, t.name);
    assert.ok(t.inputSchema.required.includes('dry_run'), t.name);
    assert.equal(t.inputSchema.additionalProperties, false, t.name);
    assert.doesNotMatch(t.name, /delete|remove|drop/, t.name);
    for (const field of Object.keys(t.inputSchema.properties)) assert.doesNotMatch(field, /phone|email|password|vault|salary|payout|company_id/, `${t.name}.${field}`);
  }
  for (const n of ['mark_protocol_item', 'update_client', 'set_client_date', 'close_task']) assert.equal(MCP_WRITE_TOOLS.find((t) => t.name === n).annotations.destructiveHint, true, n);
  assert.deepEqual(WRITE_GATE.delete, ['protocol_checks'], 'the one delete: a mark cleared, as the card does');
});

// ── Every tool: a dry run writes nothing, and then the real call writes as the owner ──
const CASES = [
  // (v13: p03.who left the protocol; the access arriving, 5, is an item every client has.)
  ['mark_protocol_item', { client: 'רון', item: 'p05.access', state: 'done' }, (db) => db.protocol_checks.some((r) => r.item_key === 'p05.access' && r.state === 'done')],
  ['update_client', { client: 'רון', package_name: 'Podcast · נטלי', characterizer: 'אופיר' }, (db) => db.clients[0].package_name === 'Podcast · נטלי' && db.clients[0].characterizer === 'ofir'],
  ['set_client_date', { client: 'רון', which: 'characterization', at: '2026-11-20T10:00' }, (db) => db.clients[0].char_at === '2026-11-20T08:00:00.000Z'],
  ['give_task', { person: 'יריב', text: 'לסיים את הסרטון', client: 'רון' }, (db) => db.staff_tasks.some((t) => t.assignee === 'yariv' && t.client_id === ID.c1)],
  ['close_task', { text: 'רואה החשבון' }, (db) => db.staff_tasks.find((t) => t.id === ID.st2).status === 'done'],
  ['staff_note', { action: 'add', person: 'נדיה', text: 'לא לגעת בלקוח מסעדת בוכרה' }, (db) => db.staff_notes.some((n) => n.person === 'nadia')],
  ['send_contract', { deal: 'קפה גלית', contract: { package: 'podcast-natali', months: 6 } }, (db) => db.deal_requests[0].quote_id === 'q-new'],
  ['request_system_change', { text: 'להוסיף כפתור הדפסה בכרטיס הלקוח' }, (db) => db.system_requests.length === 1],
];
for (const [name, args, done] of CASES) {
  test(`${name}: the dry run writes nothing and previews in Hebrew; the real call writes with the owner's token`, async () => {
    const w = world();
    const before = JSON.stringify(w.db);
    for (const dry of [{ dry_run: true }, {}]) {
      const p = await call(w, 'owner', name, { ...args, ...dry });
      assert.equal(p.isError, false, JSON.stringify(p));
      assert.equal(p.dry_run, true);
      assert.equal(p.nothing_was_changed, true);
      assert.match(p.preview, /[א-ת]/);
      noSecrets(JSON.stringify(p));
    }
    assert.deepEqual(writes(w), [], 'a dry run: no write at all');
    assert.equal(JSON.stringify(w.db), before);
    assert.deepEqual(w.fetched, []);
    const out = await call(w, 'owner', name, { ...args, dry_run: false });
    assert.equal(out.isError, false, JSON.stringify(out));
    assert.equal(out.done, true);
    noSecrets(JSON.stringify(out));
    assert.ok(done(w.db), 'the change is in');
    const made = writes(w);
    assert.ok(made.length || w.fetched.length, 'something was written');
    for (const r of made) {
      assert.equal(r.token, `Bearer ${tokenFor('owner')}`, 'the owner\'s own token, never the service key');
      assert.equal(r.gate, 'the-gate-key');
      const [, table] = /^\/(?:rpc\/)?(.+)$/.exec(r.path);
      const list = r.path.startsWith('/rpc/') ? WRITE_GATE.rpcs : { POST: WRITE_GATE.insert, PATCH: WRITE_GATE.update, DELETE: WRITE_GATE.delete }[r.method];
      assert.ok(list.includes(table), `${r.method} ${r.path} is on the gate's list`);
    }
    assert.deepEqual(w.usage.map((u) => [u.tool, u.code]), [[name, 'preview'], [name, 'preview'], [name, 'ok']]);
    for (const u of w.usage) assert.deepEqual(Object.keys(u).sort(), ['at', 'code', 'email', 'tool']);
  });
}

// ── The card's rules ───────────────────────────
test('mark: what waits, a form, a call, "לא רלוונטי" without a reason, and an approval are refused as on the card', async () => {
  const w = world();
  const r = (args) => call(w, 'owner', 'mark_protocol_item', { client: 'רון', dry_run: false, ...args });
  // (v13: "נקבעה פגישה" left; "לקבוע אפיון" closes by the date itself, and without it waits.)
  assert.equal((await r({ item: 'p03.date', state: 'done' })).code, 'blocked', 'the meeting\'s date is missing');
  assert.equal((await r({ item: 'p03.scheduled', state: 'done' })).code, 'not_found', 'a retired item');
  assert.equal((await r({ item: 'p07.approved', state: 'done' })).code, 'blocked', 'sent to the client first');
  // (v13: the daily follow-up, p14.day, left the protocol: there is no daily answer to refuse any more.)
  assert.equal((await r({ item: 'p14.day', state: 'done' })).code, 'not_found', 'a retired item');
  assert.equal((await r({ item: 'p12.link', state: 'done' })).code, 'via_form');
  assert.equal((await r({ item: 'p05.access', state: 'na' })).code, 'reason_required');
  assert.equal((await r({ item: 'p05.access', state: 'clear' })).code, 'nothing_to_change');
  assert.equal((await r({ item: 'p05.access', state: 'na', note: 'הטלפון 050-1112222' })).code, 'personal_details');
  assert.equal((await r({ item: 'nothing like this', state: 'done' })).code, 'not_found');
  assert.equal((await r({ item: 'p05.access', state: 'maybe' })).code, 'bad_input');
  assert.deepEqual(writes(w), []);
  // Optional: "לא נדרש" with no reason; then cleared (the one delete), and a done one must be cleared before "na".
  assert.equal((await r({ item: 'p05.menu', state: 'na' })).done, true);
  assert.equal((await r({ item: 'p05.access', state: 'done' })).done, true);
  assert.equal((await r({ item: 'p05.access', state: 'na', note: 'x' })).code, 'is_done');
  assert.equal((await r({ item: 'p05.access', state: 'done' })).code, 'nothing_to_change');
  assert.equal((await r({ item: 'p05.access', state: 'clear' })).done, true);
  assert.ok(!w.db.protocol_checks.some((x) => x.item_key === 'p05.access'));
  assert.deepEqual(writes(w).map((x) => x.method), ['POST', 'POST', 'DELETE']);
  // Several items with the same words: the keys come back.
  const many = await r({ item: 'אישר', state: 'done' });
  assert.equal(many.code, 'ambiguous');
  assert.ok(many.candidates.every((c) => /^(r\d+\.)?p\d/.test(c.key)));
});

test('mark: the Gantt\'s old item is gone (v13); item 24 closes Ofir\'s folder task with it', async () => {
  const w = world();
  const items = clientState(w.db.clients[0], {}, new Date(NOW)).states.flatMap((s) => s.proc.items.map((i) => i.key));
  // (v13: "הגאנט מלא" (p29.filled, with the Gantt's guard) left the protocol: the system closes 28 by
  // itself, p28.auto, once every content row of the Gantt is scheduled.)
  assert.ok(!items.includes('p29.filled') && items.includes('p28.auto') && items.includes('p24.folder'), 'the fixture has these processes');
  assert.equal((await call(w, 'owner', 'mark_protocol_item', { client: 'רון', item: 'p29.filled', state: 'done', dry_run: false })).code, 'not_found');
  const p = await call(w, 'owner', 'mark_protocol_item', { client: 'רון', item: 'p24.folder', state: 'done', dry_run: false });
  assert.equal(p.done, true, JSON.stringify(p));
  assert.ok(w.db.client_tasks[0].done_at, 'the folder task is closed with the item');
});

test('update_client: only its fields; ended waits for process 35; cancelled needs a reason; editors and characterizers from the lists', async () => {
  const w = world();
  const u = (args) => call(w, 'owner', 'update_client', { client: 'רון', dry_run: false, ...args });
  assert.equal((await u({ phone: '050' })).code, 'unknown_field');
  assert.equal((await u({ notes: 'x' })).code, 'unknown_field');
  assert.equal((await u({ status: 'ended' })).code, 'p35_open');
  assert.equal((await u({ status: 'cancelled' })).code, 'reason_required');
  assert.equal((await u({ editor: 'מישהו' })).code, 'bad_input');
  assert.equal((await u({ characterizer: 'נדיה' })).code, 'bad_input');
  assert.equal((await u({ name: '' })).code, 'bad_input');
  assert.equal((await u({ business: 'ron@private.test' })).code, 'personal_details');
  assert.equal((await u({ package_name: 'Social · נטלי' })).code, 'nothing_to_change');
  assert.deepEqual(writes(w), []);
  assert.equal((await u({ status: 'cancelled', cancel_reason: 'הלקוח חזר בו' })).done, true);
  assert.deepEqual(writes(w)[0].values, { status: 'cancelled', closed_reason: 'הלקוח חזר בו' });
  assert.equal((await u({ editor: 'יריב' })).done, true);
  assert.deepEqual(writes(w)[1].values, { editor: 'yariv' });
});

test('set_client_date: a first meeting marks "נקבעה פגישה"; a shoot day\'s concerns, its reason and its note; a round', async () => {
  const w = world();
  const s = (args) => call(w, 'owner', 'set_client_date', { client: 'רון', dry_run: false, ...args });
  assert.equal((await s({ which: 'characterization', at: '2026-13-01T10:00' })).code, 'bad_input');
  assert.equal((await s({ which: 'characterization', at: '20.11 10:00' })).code, 'bad_input');
  assert.equal((await s({ which: 'shoot', at: '2026-12-01T10:00', crew: 'nobody' })).code, 'bad_input');
  assert.equal((await s({ which: 'shoot', at: '2026-12-01T10:00', round: 5 })).code, 'not_found');
  assert.equal((await s({ which: 'characterization', at: '2026-11-20T10:00' })).done, true);
  assert.equal(w.db.clients[0].characterizer, 'noam');
  assert.ok(w.db.protocol_checks.some((r) => r.item_key === 'p03.scheduled' && r.state === 'done'));
  // Moving it marks nothing again.
  const n = w.db.protocol_checks.length;
  assert.equal((await s({ which: 'characterization', at: '2026-11-22T10:00', characterizer: 'אופיר' })).done, true);
  assert.equal(w.db.protocol_checks.length, n);
  assert.equal(w.db.clients[0].characterizer, 'ofir');
  // A shoot day one business day after the meeting: said, and the note kept with the date.
  const p = await s({ which: 'shoot', at: '2026-11-23T10:00', dry_run: true });
  assert.match(p.preview, /ימי עסקים/);
  assert.equal((await s({ which: 'shoot', at: '2026-11-23T10:00' })).done, true);
  const note = w.log.find((r) => r.path === '/rpc/date_change_note');
  assert.equal(note.args.p_field, 'shoot_at');
  assert.match(note.args.p_note, /^אושר למרות/);
  // A day the photographer already films: a reason is needed, and kept.
  const w2 = world({ taken: [{ day: '2026-12-14', n: 1 }] });
  const s2 = (args) => call(w2, 'owner', 'set_client_date', { client: 'רון', dry_run: false, which: 'shoot', ...args });
  assert.equal((await s2({ at: '2026-12-14T10:00' })).code, 'reason_required');
  assert.equal((await s2({ at: '2026-12-14T10:00', reason: 'הלקוח טס' })).done, true);
  assert.match(w2.log.find((r) => r.path === '/rpc/date_change_note').args.p_note, /סיבה: הלקוח טס/);
  // A round that exists: its own entry, the crew kept.
  assert.equal((await s2({ at: '2027-01-12T09:00', round: 2 })).done, true);
  assert.equal(w2.db.clients[0].rounds[0].shoot_at, '2027-01-12T07:00:00.000Z');
  assert.equal(w2.db.clients[0].rounds[0].shoot_type, 'natali');
});

test('tasks: Nirel needs her brief; the owner\'s own task is done, another\'s is cancelled (only its assignee marks done); several: the ids', async () => {
  const w = world();
  assert.equal((await call(w, 'owner', 'give_task', { person: 'ניראל', text: 'גרפיקה', dry_run: false })).code, 'bad_input');
  assert.equal((await call(w, 'owner', 'give_task', { person: 'מישהו', text: 'x', dry_run: false })).code, 'bad_input');
  assert.equal((await call(w, 'owner', 'give_task', { person: 'נדיה', text: 'להתקשר ל־0501112222', dry_run: false })).code, 'personal_details');
  const brief = { problem: 'א', change: 'ב', keep: 'ג', result: 'ד' };
  assert.equal((await call(w, 'owner', 'give_task', { person: 'ניראל', text: 'גרפיקה', brief, dry_run: false })).done, true);
  assert.equal(w.log.at(-1).path, '/rpc/staff_task_create_brief');
  const other = await call(w, 'owner', 'close_task', { text: 'הסרטון של רון', dry_run: true });
  assert.match(other.preview, /תבוטל/);
  assert.equal((await call(w, 'owner', 'close_task', { task_id: ID.st1, dry_run: false })).done, true);
  assert.equal(w.db.staff_tasks[0].status, 'cancelled');
  assert.equal(w.log.at(-1).path, '/rpc/staff_task_cancel');
  w.db.staff_tasks.push({ id: '88888888-8888-4888-8888-888888888888', assignee: 'owner', body: 'להתקשר לרואה החשבון שוב', status: 'open' });
  const many = await call(w, 'owner', 'close_task', { text: 'רואה החשבון', dry_run: false });
  assert.equal(many.code, 'ambiguous');
  assert.equal(many.candidates.length, 2);
  assert.ok(many.candidates.every((c) => c.task_id));
  assert.equal((await call(w, 'owner', 'close_task', { task_id: 'not-a-uuid', dry_run: false })).code, 'bad_input');
});

test('staff_note: list and remove (it comes off the screens; nothing is deleted); before its migration: a clear "not yet"', async () => {
  const w = world();
  w.db.staff_notes.push({ id: ID.note, person: 'nadia', body: 'לא לגעת בלקוח', created_by: 'irit', created_at: '2026-11-09T08:00:00Z', deleted_at: null });
  const l = await call(w, 'owner', 'staff_note', { action: 'list', dry_run: true });
  assert.equal(l.notes[0].note_id, ID.note);
  assert.equal((await call(w, 'owner', 'staff_note', { action: 'remove', note_id: ID.note, dry_run: false })).done, true);
  assert.ok(w.db.staff_notes[0].deleted_at, 'soft: the row stays');
  assert.equal(w.db.staff_notes.length, 1);
  const off = world({ missing: ['staff_notes', 'staff_note_delete'] });
  for (const args of [{ action: 'add', person: 'נדיה', text: 'x' }, { action: 'list' }, { action: 'remove', note_id: ID.note }]) {
    const o = await call(off, 'owner', 'staff_note', { ...args, dry_run: false });
    if (args.action === 'add') assert.equal(o.code, 'not_available'); else assert.equal(o.error, NOTES_OFF);
  }
});

test('send_contract: the details from the system go to create-quote and never come back; the deal is taken and linked', async () => {
  const w = world();
  const out = await call(w, 'owner', 'send_contract', { deal: 'קפה גלית', contract: { package: 'podcast-natali', months: 6 }, dry_run: false });
  assert.equal(out.done, true);
  const [req] = w.fetched;
  assert.equal(req.url, `${BASE}/functions/v1/create-quote`);
  assert.equal(req.headers.Authorization, `Bearer ${tokenFor('owner')}`);
  assert.equal(req.headers[GATE_HEADER], 'the-gate-key');
  assert.deepEqual(req.body.client, { name: 'גלית', company: 'קפה גלית', companyId: '516161616', address: 'הרצל 1', phone: '052-9998888', email: '', notes: 'deal@private.test' });
  assert.equal(req.body.selection.tier !== undefined, true);
  assert.equal(out.number, 'AST-77');
  assert.equal(out.sign_link, 'https://app.astrateg.tech/q.html#t=tok-123');
  assert.match(out.whatsapp, /^https:\/\/wa\.me\/\?text=/, 'no number in the link');
  assert.equal(out.message, sendText({ name: 'גלית', number: 'AST-77', link: out.sign_link, agreement: true, months: 6, hours: 168 }));
  noSecrets(JSON.stringify(out));
  assert.deepEqual(w.log.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.path}`), ['POST /rpc/deal_take', 'PATCH /deal_requests']);
  // An existing client: name, company id and phone from the card, through the office's functions.
  const w2 = world();
  const c = await call(w2, 'owner', 'send_contract', { client: 'רון', contract: { package: 'podcast-natali' }, dry_run: false });
  assert.equal(c.done, true);
  assert.deepEqual(w2.fetched[0].body.client, { name: 'רון כהן', company: 'מספרת רון', companyId: '515151515', address: 'רחוב הסוד 5', phone: '050-1112222', email: 'ron@private.test', notes: '' });
  noSecrets(JSON.stringify(c));
  // No company id: refused before anything is created.
  const w3 = world();
  w3.db.deal_requests[0].company_id = null;
  assert.equal((await call(w3, 'owner', 'send_contract', { deal: 'קפה גלית', contract: { package: 'podcast-natali' }, dry_run: false })).code, 'details_missing');
  assert.deepEqual(w3.fetched, []);
  // Personal details in the contract's text, both or neither of deal and client, create-quote failing.
  assert.equal((await call(w3, 'owner', 'send_contract', { deal: 'קפה גלית', contract: { package: 'podcast-natali', specialClauses: ['טלפון 0529998888'] }, dry_run: true })).code, 'personal_details');
  assert.equal((await call(w3, 'owner', 'send_contract', { contract: { package: 'podcast-natali' }, dry_run: true })).code, 'bad_input');
  const w4 = world({ quoteFails: true });
  assert.equal((await call(w4, 'owner', 'send_contract', { deal: 'קפה גלית', contract: { package: 'podcast-natali' }, dry_run: false })).code, 'quote_failed');
});

test('the write tools\' database client: only the listed tables, operations and rpcs', () => {
  const asked = [];
  const db = guardWrite({ from: (t) => ({ select: () => asked.push(['select', t]), insert: () => asked.push(['insert', t]), upsert: () => asked.push(['upsert', t]), update: () => asked.push(['update', t]), delete: () => asked.push(['delete', t]) }), rpc: (fn) => asked.push(['rpc', fn]) });
  for (const t of ['client_access', 'staff', 'payout_deals', 'vault_code', 'mcp_access', 'quotes']) {
    for (const op of ['insert', 'update', 'delete']) assert.throws(() => db.from(t)[op]({}), /not allowed/, `${op} ${t}`);
  }
  assert.throws(() => db.from('clients').delete(), /not allowed/);
  assert.throws(() => db.from('clients').insert({}), /not allowed/);
  assert.throws(() => db.from('client_access').select('id'), /not allowed/);
  assert.throws(() => db.from('clients').select('*'), /name the columns/);
  for (const fn of ['access_reveal', 'vault_unlock', 'mcp_set_access', 'staff_admin', 'quote_cancel']) assert.throws(() => db.rpc(fn), /not allowed/);
  db.from('protocol_checks').insert({}, { onConflict: 'client_id,item_key' });
  db.from('protocol_checks').delete();
  assert.deepEqual(asked, [['upsert', 'protocol_checks'], ['delete', 'protocol_checks']]);
});

// ── create-quote takes a connected app's token only from the mcp function, only an owner's ──
test('create-quote: the key the mcp function holds, then an owner who is switched on; otherwise refused as before', async () => {
  // The real key's shape (two uuids); the database's gate compares it (tests/sql/mcp-write.test.mjs).
  const key = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeeeaaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  assert.equal(mcpGateOf(key), key);
  for (const sent of [null, undefined, '', 'short', 'x'.repeat(80), `${key}\n`, `${key} or 1=1`, 5, {}]) assert.equal(mcpGateOf(sent), null, String(sent));
  const rpcOf = (person, on) => async (fn) => ({ data: fn === 'my_person' ? person : on, error: null });
  assert.equal(await mcpCallerIsOwner(rpcOf(null, true)), true);
  assert.equal(await mcpCallerIsOwner(rpcOf('lior', true)), false);
  assert.equal(await mcpCallerIsOwner(rpcOf('ofir', true)), false);
  assert.equal(await mcpCallerIsOwner(rpcOf(null, false)), false);
  assert.equal(await mcpCallerIsOwner(async () => ({ data: null, error: { code: 'x' } })), false);
  assert.equal(MCP_GATE_HEADER, GATE_HEADER);
  const src = readFileSync(new URL('../supabase/functions/create-quote/index.ts', import.meta.url), 'utf8');
  const gate = src.indexOf('mcpGateOf(');
  assert.ok(src.includes('[MCP_GATE_HEADER]: viaMcp'), 'the key goes on to the database with the person\'s client');
  const refusal = src.indexOf("if (isOAuthToken(req.headers.get('authorization'))) return json(403, { error: 'not_allowed' });");
  const who = src.search(/auth\.getUser\(/);
  assert.ok(gate > 0 && gate < refusal && refusal < who, 'the key first, then the refusal of any other app, then who');
  assert.match(src, /if \(viaMcp && !\(await mcpCallerIsOwner\(/);
  assert.ok(src.indexOf('mcpCallerIsOwner(') > src.indexOf('callerIsOffice('), 'after the office check');
});
