// The mcp function (docs/ops.md, section 84), driven whole through its handler with fakes in place of
// Supabase: the protocol, the sign-in answers, who may connect, the walls of the read tools (ask's own),
// the draft tool that writes nothing, and what is kept of the use. tests/mcp-sdk-check.mjs does one round
// with the official MCP client, from a temporary folder (it is not a dependency of the repo).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeHandler, claimsOf, claimsProblem, allowedOrigin, INSTRUCTIONS, MCP_READ_TOOLS, VERSIONS, LATEST_VERSION, RATE_PER_MINUTE, METADATA_PATH, E } from '../supabase/functions/mcp/handler.js';
import { TOOLS } from '../supabase/functions/ask/tools.js';
import { SYSTEM } from '../supabase/functions/ask/handler.js';
import { mayUseMcp, MCP_PEOPLE, authorizationIdOf, safeRedirect, clientNameOf, clientHostOf } from '../app/mcp-logic.js';
import { DRAFT_TOOL, DRAFT_SCHEMA, DRAFT_PARAM, DRAFT_LINK_MAX, draftAnswer, draftOf, draftFromHash, checkDraftInput, draftLink } from '../app/mcp-draft.js';
import { validateSelection } from '../app/pricing.js';
import { PAID_ADDONS } from '../app/catalog.js';
import { fakeClient } from './fake-pgrest.mjs';

const BASE = 'https://proj.supabase.co';
const RESOURCE = `${BASE}/functions/v1/mcp`;
const NOW = Date.parse('2026-11-12T08:00:00Z');

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
// A token as the OAuth server would give it (signed by nobody: the fake's getUser is the "signature").
const claimsFor = (who, extra = {}) => ({
  sub: `id-${who}`, email: `${who}@astrateg.test`, role: 'authenticated', aud: 'authenticated', iss: `${BASE}/auth/v1`,
  exp: NOW / 1000 + 3600, client_id: 'claude-client', ...extra,
});
const tokenFor = (who, extra) => `${b64({ alg: 'ES256' })}.${b64(claimsFor(who, extra))}.sig`;

// Rows hold what must never come out: phones, emails, notes, addresses.
const CLIENT = {
  id: '11111111-1111-4111-8111-111111111111', name: 'רון כהן', business: 'מספרת רון', quote_id: 'q1', package_name: 'Social · נטלי', shoot_type: 'natali',
  editor: 'nadia', editor2: null, deal_at: '2026-03-15T08:00:00Z', char_at: null, shoot_at: '2026-11-15T07:00:00Z', contract_end: '2027-03-15', status: 'active',
  deliverables: { videos: 36, graphics: 36 }, rounds: [], links: {}, archived_at: null, landing: false, created_at: '2026-03-15T08:00:00Z',
  phone: '050-1112222', contact_email: 'ron@private.test', email: 'ron@private.test', notes: 'סיסמה: 1234', address: 'רחוב הסוד 5',
};
const TABLES_ROWS = {
  clients: [CLIENT],
  quotes: [{ id: 'q1', number: 'AST-1', client_name: 'רון כהן', status: 'signed', created_at: '2026-11-02T08:00:00Z', signed_at: '2026-11-03T08:00:00Z', monthly_gross_agorot: 413000, term_gross_agorot: 4956000 }],
  deal_requests: [{ created_at: '2026-11-05T08:00:00Z', seller: 'stav', business_name: 'פיצה', status: 'signed', signed_at: '2026-11-06T08:00:00Z', discount_agorot: 30000, phone: '050-3334444' }],
};

// Who is who in the fake database; `on` is public.mcp_access.
const PEOPLE_ROWS = {
  owner: { office: true, person: null, money: true },
  lior: { office: true, person: 'lior', money: false },
  ofir: { office: true, person: 'ofir', money: false },
  irit: { office: true, person: 'irit', money: false },
  anna: { office: false, person: 'anna', money: false },
  stranger: { office: false, person: null, money: false },
};

function world({ on = ['owner', 'lior', 'ofir'], env = {}, getUserThrows = false, noAccessFn = false } = {}) {
  const usage = [];
  const writes = [];
  const reads = [];
  const logs = [];
  const state = { on: new Set(on), revoked: new Set(), at: NOW };
  const deps = {
    env: (k) => ({ SUPABASE_URL: BASE, SUPABASE_ANON_KEY: 'anon', ...env })[k],
    serviceKey: () => 'service',
    now: () => state.at,
    log: (m) => logs.push(m),
    createClient: (_url, key, opts) => {
      if (key === 'service') {
        return {
          from: (table) => ({
            insert: async (row) => { writes.push(table); if (table === 'mcp_usage') usage.push(row); return { error: null }; },
          }),
        };
      }
      const token = String(opts?.global?.headers?.Authorization || '').replace(/^Bearer /, '');
      const claims = claimsOf(token);
      const who = claims?.sub?.replace(/^id-/, '');
      const me = PEOPLE_ROWS[who];
      const c = fakeClient(TABLES_ROWS, {
        rpc: {
          is_office: () => me?.office === true,
          my_person: () => me?.person ?? null,
          sees_money: () => me?.money === true,
          ...(noAccessFn ? {} : { mcp_allowed: () => state.on.has(who) }),
        },
      });
      reads.push(c.reads);
      c.auth.getUser = async (t) => {
        if (getUserThrows) throw new Error('network');
        if (t.endsWith('.forged') || state.revoked.has(who) || !me) return { data: { user: null }, error: { message: 'bad jwt' } };
        return { data: { user: { id: claims.sub, email: claims.email } }, error: null };
      };
      return c;
    },
  };
  return { handle: makeHandler(deps), usage, writes, reads, logs, state };
}

const post = (handle, body, { token, headers = {}, raw = false, path = '/mcp' } = {}) => handle(new Request(`http://edge.local${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
  body: raw ? body : JSON.stringify(body),
}));
const rpc = (method, params, id = 1) => ({ jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) });
const callTool = async (handle, who, name, args = {}) => {
  const res = await post(handle, rpc('tools/call', { name, arguments: args }), { token: tokenFor(who) });
  assert.equal(res.status, 200);
  return (await res.json()).result;
};
const textOf = (result) => result.content[0].text;

// ── The protocol ───────────────────────────────
test('initialize: the spec\'s version, and each older one the client asks for', async () => {
  const { handle } = world();
  for (const v of VERSIONS) {
    const res = await post(handle, rpc('initialize', { protocolVersion: v, capabilities: {}, clientInfo: { name: 't', version: '1' } }), { token: tokenFor('owner') });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('mcp-session-id'), null, 'stateless');
    assert.match(res.headers.get('content-type'), /application\/json/);
    const { result, id, jsonrpc } = await res.json();
    assert.equal(jsonrpc, '2.0');
    assert.equal(id, 1);
    assert.equal(result.protocolVersion, v);
    assert.deepEqual(result.capabilities, { tools: { listChanged: false } });
    assert.equal(result.serverInfo.name, 'astrateg');
    assert.equal(typeof result.instructions, 'string');
  }
  const old = await post(handle, rpc('initialize', { protocolVersion: '1999-01-01' }), { token: tokenFor('owner') });
  assert.equal((await old.json()).result.protocolVersion, LATEST_VERSION, 'one it does not know: the newest');
  const bad = await post(handle, rpc('initialize'), { token: tokenFor('owner') });
  assert.equal((await bad.json()).error.code, E.PARAMS);
});

test('the instructions: who the office is, Hebrew answers, Hebrew words; from ask\'s own lines', () => {
  assert.match(INSTRUCTIONS, /Astrateg/);
  assert.match(INSTRUCTIONS, /Answer in Hebrew/);
  assert.match(INSTRUCTIONS, /"פעיל" = active/);
  assert.ok(INSTRUCTIONS.split('\n').filter((l) => SYSTEM.split('\n').includes(l)).length >= 5);
  assert.ok(INSTRUCTIONS.length < 2500, 'short');
});

test('ping, unknown methods, tools/list', async () => {
  const { handle } = world();
  const token = tokenFor('ofir');
  assert.deepEqual((await (await post(handle, rpc('ping'), { token })).json()).result, {});
  const un = await (await post(handle, rpc('resources/list'), { token })).json();
  assert.equal(un.error.code, E.NO_METHOD);
  const { result } = await (await post(handle, rpc('tools/list'), { token })).json();
  const names = result.tools.map((t) => t.name);
  for (const t of TOOLS) assert.ok(names.includes(t.name), t.name);
  assert.ok(names.includes(DRAFT_TOOL));
  for (const t of result.tools) {
    assert.equal(t.inputSchema.type, 'object', t.name);
    assert.equal(t.input_schema, undefined, t.name);
    assert.equal(t.annotations.readOnlyHint, true, t.name);
    assert.equal(typeof t.description, 'string');
  }
  assert.equal(MCP_READ_TOOLS.length, TOOLS.length, 'all of ask\'s tools, drive_files too');
  assert.ok(names.includes('drive_files'));
});

test('notifications and a client\'s answers: 202 with no body', async () => {
  const { handle } = world();
  const token = tokenFor('owner');
  for (const msg of [{ jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } }, { jsonrpc: '2.0', id: 9, result: {} }]) {
    const res = await post(handle, msg, { token });
    assert.equal(res.status, 202);
    assert.equal(await res.text(), '');
  }
});

test('bad JSON, batches, malformed messages: proper JSON-RPC errors', async () => {
  const { handle } = world();
  const token = tokenFor('owner');
  const bad = await post(handle, '{nope', { token, raw: true });
  assert.equal(bad.status, 400);
  const b = await bad.json();
  assert.equal(b.error.code, E.PARSE);
  assert.equal(b.id, null);
  const batch = await post(handle, [rpc('ping'), rpc('ping', undefined, 2)], { token });
  assert.equal(batch.status, 400);
  assert.equal((await batch.json()).error.code, E.INVALID);
  for (const msg of [{ id: 1, method: 'ping' }, { jsonrpc: '1.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', id: {}, method: 'ping' }, { jsonrpc: '2.0', id: null, method: 'ping' }, { jsonrpc: '2.0', id: 1 }, 'x', 5, null]) {
    const res = await post(handle, msg, { token });
    assert.equal(res.status, 400, JSON.stringify(msg));
    assert.equal((await res.json()).error.code, E.INVALID);
  }
  const big = await post(handle, JSON.stringify(rpc('ping', { pad: 'x'.repeat(300 * 1024) })), { token, raw: true });
  assert.equal(big.status, 413);
});

test('GET and every other method: 405; a wrong address: 404; a wrong version header: 400', async () => {
  const { handle } = world();
  for (const method of ['GET', 'PUT']) {
    const res = await handle(new Request('http://edge.local/mcp', { method, headers: { Accept: 'text/event-stream' } }));
    assert.equal(res.status, 405, method);
    assert.match(res.headers.get('allow'), /POST/);
  }
  assert.equal((await handle(new Request('http://edge.local/mcp', { method: 'DELETE' }))).status, 405);
  assert.equal((await post(handle, rpc('ping'), { path: '/mcp/elsewhere', token: tokenFor('owner') })).status, 404);
  const v = await post(handle, rpc('ping'), { token: tokenFor('owner'), headers: { 'MCP-Protocol-Version': '1999-01-01' } });
  assert.equal(v.status, 400);
  assert.equal((await post(handle, rpc('ping'), { token: tokenFor('owner'), headers: { 'MCP-Protocol-Version': '2025-06-18' } })).status, 200);
});

test('Origin: Claude\'s sites and the office\'s; absent is fine; anything else 403', async () => {
  for (const o of ['https://claude.ai', 'https://www.claude.ai', 'https://claude.com', 'https://app.claude.com', 'https://app.astrateg.tech']) assert.equal(allowedOrigin(o), true, o);
  for (const o of ['https://claude.ai.evil.test', 'http://claude.ai', 'https://evilclaude.ai', 'https://astrateg.tech', 'null', 'https://claude.ai:8443/x', '']) assert.equal(allowedOrigin(o), false, o);
  const { handle } = world();
  const token = tokenFor('owner');
  const evil = await post(handle, rpc('ping'), { token, headers: { Origin: 'https://evil.test' } });
  assert.equal(evil.status, 403);
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  const ok = await post(handle, rpc('ping'), { token, headers: { Origin: 'https://claude.ai' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://claude.ai');
  const pre = await handle(new Request('http://edge.local/mcp', { method: 'OPTIONS', headers: { Origin: 'https://claude.ai' } }));
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-headers'), /mcp-protocol-version/);
});

// ── Signing in ─────────────────────────────────
test('no token: 401 and where to sign in; the document is at that address', async () => {
  const { handle, writes } = world();
  const res = await post(handle, rpc('initialize', { protocolVersion: LATEST_VERSION }));
  assert.equal(res.status, 401);
  const www = res.headers.get('www-authenticate');
  assert.equal(www, `Bearer resource_metadata="${RESOURCE}${METADATA_PATH}"`);
  assert.equal((await res.json()).error.code, E.AUTH);
  // As Supabase's gateway hands the path to a function, and with the gateway's prefix too.
  for (const path of [`/mcp${METADATA_PATH}`, `/functions/v1/mcp${METADATA_PATH}`, `/mcp${METADATA_PATH}/`]) {
    const doc = await handle(new Request(`http://edge.local${path}`));
    assert.equal(doc.status, 200, path);
    assert.deepEqual(await doc.json(), {
      resource: RESOURCE, authorization_servers: [`${BASE}/auth/v1`], bearer_methods_supported: ['header'], resource_name: 'Astrateg',
    });
    assert.equal(doc.headers.get('access-control-allow-origin'), '*');
  }
  assert.equal((await handle(new Request(`http://edge.local/mcp${METADATA_PATH}`, { method: 'POST', body: '{}' }))).status, 405);
  assert.deepEqual(writes, []);
  // With the gateway's prefix, the endpoint itself answers too.
  assert.equal((await post(handle, rpc('ping'), { path: '/functions/v1/mcp' })).status, 401);
});

test('an ordinary browser session\'s token is not taken (no client_id), though it is genuine', async () => {
  const { handle, reads } = world();
  const res = await post(handle, rpc('tools/list'), { token: tokenFor('owner', { client_id: undefined }) });
  assert.equal(res.status, 401);
  assert.match(res.headers.get('www-authenticate'), /error="invalid_token"/);
  assert.equal((await res.json()).error.data.code, 'not_oauth');
  assert.deepEqual(reads, [], 'not even a client for it');
  for (const client_id of ['', null, 5]) assert.equal(claimsProblem(claimsFor('owner', { client_id }), { issuer: `${BASE}/auth/v1`, at: NOW }), 'not_oauth');
});

test('every bad token: 401, and the same words', async () => {
  const { handle } = world();
  const cases = [
    'garbage', 'a.b.c', `x.${Buffer.from('[1]').toString('base64url')}.y`,
    tokenFor('owner', { exp: NOW / 1000 - 1 }),
    tokenFor('owner', { exp: undefined }),
    tokenFor('owner', { aud: 'other-api' }),
    tokenFor('owner', { iss: 'https://evil.test/auth/v1' }),
    tokenFor('owner', { role: 'service_role' }),
    tokenFor('owner', { sub: undefined }),
    `${tokenFor('owner').slice(0, -3)}forged`,
  ];
  for (const token of cases) {
    const res = await post(handle, rpc('ping'), { token });
    assert.equal(res.status, 401, token);
    const { error } = await res.json();
    assert.equal(error.message, 'invalid token');
    assert.match(res.headers.get('www-authenticate'), /error="invalid_token".*resource_metadata=/);
  }
  assert.equal((await post(handle, rpc('ping'), { token: tokenFor('owner', { aud: ['authenticated', 'x'] }) })).status, 200, 'aud as a list');
  // Someone else's id inside the token: Supabase's user is the answer.
  const swapped = await post(handle, rpc('ping'), { token: `${b64({})}.${b64(claimsFor('owner', { sub: 'id-nobody' }))}.sig` });
  assert.equal(swapped.status, 401);
});

test('when Supabase cannot be asked: no entry, no details', async () => {
  const { handle, logs } = world({ getUserThrows: true });
  const res = await post(handle, rpc('tools/list'), { token: tokenFor('owner') });
  assert.equal(res.status, 503);
  const text = await res.text();
  assert.doesNotMatch(text, /network|Error|stack/);
  assert.ok(logs.length);
});

// ── Who ────────────────────────────────────────
test('the rule of who: the owners, Lior and Ofir; anything unclear is a no', () => {
  assert.deepEqual(MCP_PEOPLE, ['lior', 'ofir']);
  assert.equal(mayUseMcp({ office: true, person: null }), true);
  assert.equal(mayUseMcp({ office: true, person: 'lior' }), true);
  assert.equal(mayUseMcp({ office: true, person: 'ofir' }), true);
  for (const x of [{ office: true, person: 'irit' }, { office: true, person: 'ilai' }, { office: false, person: null }, { office: false, person: 'lior' }, { office: 'true', person: null }, {}, undefined]) assert.equal(mayUseMcp(x), false, JSON.stringify(x));
});

test('anyone else: a clear refusal in Hebrew, even if the table had them on', async () => {
  const { handle } = world({ on: ['owner', 'lior', 'ofir', 'irit', 'anna', 'stranger'] });
  for (const who of ['irit', 'anna', 'stranger']) {
    for (const msg of [rpc('initialize', { protocolVersion: LATEST_VERSION }), rpc('tools/list'), rpc('tools/call', { name: 'team', arguments: {} })]) {
      const res = await post(handle, msg, { token: tokenFor(who) });
      assert.equal(res.status, 403, who);
      const { error } = await res.json();
      assert.equal(error.data.code, 'not_allowed');
      assert.match(error.message, /לא פתוח לחשבון הזה/);
    }
  }
});

test('a person switched off is refused at once, with the same token; on again, at once', async () => {
  const { handle, state, usage } = world();
  const token = tokenFor('lior');
  assert.equal((await post(handle, rpc('tools/call', { name: 'team', arguments: {} }), { token })).status, 200);
  state.on.delete('lior');
  for (const msg of [rpc('tools/call', { name: 'team', arguments: {} }), rpc('tools/list'), rpc('ping'), { jsonrpc: '2.0', method: 'notifications/initialized' }]) {
    const res = await post(handle, msg, { token });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error.data.code, 'not_allowed');
  }
  assert.deepEqual(usage.map((u) => u.code), ['ok', 'not_allowed']);
  state.on.add('lior');
  assert.equal((await post(handle, rpc('ping'), { token })).status, 200);
});

test('a session ended at Supabase is refused at once', async () => {
  const { handle, state } = world();
  const token = tokenFor('ofir');
  assert.equal((await post(handle, rpc('ping'), { token })).status, 200);
  state.revoked.add('ofir');
  assert.equal((await post(handle, rpc('ping'), { token })).status, 401);
});

test('before the migration (no public.mcp_allowed): nobody in, and no database words', async () => {
  const { handle } = world({ noAccessFn: true });
  const res = await post(handle, rpc('tools/list'), { token: tokenFor('owner') });
  assert.equal(res.status, 503);
  assert.doesNotMatch(await res.text(), /no such function/);
});

test('the limit: per person, and it says so', async () => {
  const { handle, state, usage } = world();
  const owner = tokenFor('owner');
  for (let i = 0; i < RATE_PER_MINUTE; i += 1) assert.equal((await post(handle, rpc('ping'), { token: owner })).status, 200);
  const res = await post(handle, rpc('tools/call', { name: 'team', arguments: {} }), { token: owner });
  assert.equal(res.status, 429);
  assert.equal((await res.json()).error.data.code, 'rate_limited');
  assert.deepEqual(usage.map((u) => [u.tool, u.code]), [['team', 'rate_limited']]);
  assert.equal((await post(handle, rpc('ping'), { token: tokenFor('ofir') })).status, 200, 'someone else is not held');
  state.at += 61000;
  assert.equal((await post(handle, rpc('ping'), { token: owner })).status, 200, 'a minute later');
});

// ── The walls ──────────────────────────────────
const SECRET = /050-1112222|050-3334444|private\.test|רחוב הסוד|סיסמה: 1234/;
test('no phone, email, address or notes from any tool, for anyone', async () => {
  for (const who of ['owner', 'lior', 'ofir']) {
    const { handle, reads } = world();
    for (const [name, args] of [
      ['find_clients', { name: 'רון' }], ['client_details', { client: 'רון' }], ['tasks', {}], ['shoot_days', {}], ['editors_progress', {}],
      ['content_gantt', {}], ['sales', { from: '2026-11-01', to: '2026-11-30' }], ['drive_files', { client: 'רון' }], ['content_owed', {}], ['app_guide', {}], ['team', {}],
    ]) {
      const result = await callTool(handle, who, name, args);
      assert.doesNotMatch(textOf(result), SECRET, `${who} ${name}`);
      assert.doesNotMatch(textOf(result), /@/, `no address of anyone: ${who} ${name}`);
    }
    for (const r of reads.flat()) {
      // (created_by_email and by_email are the staff member who acted, read for the card's own calculation and never returned.)
      assert.doesNotMatch(r.cols.replace(/created_by_email|by_email/g, ''), /\*|phone|email|address|notes|password/i, r.table);
      assert.doesNotMatch(r.table, /access|vault|payout|staff$|log$/, r.table);
    }
  }
});

test('the database client handed to the tools has no rpc and no other tables (ask\'s guardDb)', () => {
  const src = readFileSync(new URL('../supabase/functions/mcp/handler.js', import.meta.url), 'utf8');
  assert.match(src, /db: guardDb\(userClient\)/);
  assert.match(src, /from '\.\.\/ask\/tools\.js'/, 'imported, never copied');
  assert.doesNotMatch(src, /\.from\('(?!mcp_usage)/, 'the only table this file touches itself');
});

test('money: the owners see it; Lior and Ofir do not (their rows and their words)', async () => {
  const { handle } = world();
  const asOwner = JSON.parse(textOf(await callTool(handle, 'owner', 'sales', { from: '2026-11-01', to: '2026-11-30' })));
  assert.equal(asOwner.quotes.rows[0].monthly_price_ils, 4130);
  assert.equal(asOwner.quotes.signed_term_total_ils, 49560);
  for (const who of ['lior', 'ofir']) {
    const w = world();
    const text = textOf(await callTool(w.handle, who, 'sales', { from: '2026-11-01', to: '2026-11-30' }));
    assert.doesNotMatch(text, /_ils|4130|49560|agorot|discount/);
    const quoteRead = w.reads.flat().find((r) => r.table === 'quotes');
    assert.doesNotMatch(quoteRead.cols, /agorot/, 'not even asked for');
  }
});

test('drive_files without the secret: says so, no crash; an unknown tool or bad arguments: JSON-RPC errors', async () => {
  const { handle } = world();
  const d = JSON.parse(textOf(await callTool(handle, 'owner', 'drive_files', { client: 'רון' })));
  assert.equal(d.error, 'הדרייב עוד לא מחובר');
  const w = world();
  const bad = await post(w.handle, rpc('tools/call', { name: 'nope', arguments: {} }), { token: tokenFor('owner') });
  assert.equal((await bad.json()).error.code, E.PARAMS);
  assert.deepEqual(w.usage, [{ email: 'owner@astrateg.test', tool: 'unknown', code: 'unknown_tool', at: new Date(NOW).toISOString() }], 'the word the caller made up is not kept');
  for (const params of [undefined, { arguments: {} }, { name: 'team', arguments: 'x' }, { name: 'team', arguments: [] }]) {
    const res = await post(w.handle, rpc('tools/call', params), { token: tokenFor('owner') });
    assert.equal((await res.json()).error.code, E.PARAMS, JSON.stringify(params));
  }
});

// ── What is kept ───────────────────────────────
test('the usage row: who, tool, code, when. No arguments, no results, and no extra keys', async () => {
  const { handle, usage, writes } = world();
  const secretWord = 'מילה-פרטית-בארגומנטים';
  await callTool(handle, 'ofir', 'find_clients', { name: secretWord });
  await callTool(handle, 'ofir', DRAFT_TOOL, { package: 'podcast-natali', specialClauses: [secretWord] });
  assert.equal(usage.length, 2);
  assert.deepEqual(Object.keys(usage[0]).sort(), ['at', 'code', 'email', 'tool']);
  assert.deepEqual(usage.map((u) => u.tool), ['find_clients', DRAFT_TOOL]);
  assert.deepEqual(usage.map((u) => u.code), ['ok', 'ok']);
  assert.ok(!JSON.stringify(usage).includes(secretWord));
  assert.deepEqual([...new Set(writes)], ['mcp_usage'], 'the only write in the whole function');
  // Nothing but notifications and tool calls count: initialize and list leave no row.
  const w2 = world();
  await post(w2.handle, rpc('tools/list'), { token: tokenFor('owner') });
  assert.deepEqual(w2.usage, []);
});

test('the log: short codes only; a usage row that fails fails nothing', async () => {
  const logs = [];
  const handle = makeHandler({
    env: (k) => ({ SUPABASE_URL: BASE, SUPABASE_ANON_KEY: 'anon' })[k],
    serviceKey: () => { throw new Error('no key here: abc'); },
    now: () => NOW,
    log: (m) => logs.push(m),
    createClient: (_u, _k, opts) => {
      const c = fakeClient(TABLES_ROWS, { rpc: { is_office: true, my_person: null, sees_money: true, mcp_allowed: true } });
      c.auth.getUser = async () => ({ data: { user: { id: claimsOf(opts.global.headers.Authorization.slice(7)).sub, email: 'o@astrateg.test' } } });
      return c;
    },
  });
  const res = await post(handle, rpc('tools/call', { name: 'team', arguments: {} }), { token: tokenFor('owner') });
  assert.equal(res.status, 200);
  assert.equal(logs.length, 1);
  assert.doesNotMatch(logs[0], /abc|astrateg/);
});

// ── The draft ──────────────────────────────────
const DEAL = { package: 'podcast-natali', months: 6, quantities: [{ key: 'videos', value: 20 }], specialClauses: ['ללא Highlights'] };

test('the schema has no field for who the client is, at any depth', () => {
  const text = JSON.stringify(Object.keys(DRAFT_SCHEMA.properties));
  for (const word of ['name', 'business', 'company', 'phone', 'email', 'address', 'client', 'id']) {
    assert.ok(!Object.keys(DRAFT_SCHEMA.properties).some((k) => k.toLowerCase().includes(word)), `${word} in ${text}`);
  }
  assert.equal(DRAFT_SCHEMA.additionalProperties, false);
  assert.deepEqual(Object.keys(DRAFT_SCHEMA.properties.extraLines.items.properties), ['label', 'qty', 'monthly']);
});

test('the tool refuses personal fields and text with an email or a long number', async () => {
  const { handle, usage } = world();
  for (const extra of [{ name: 'דנה' }, { client: { name: 'דנה' } }, { phone: '0501112222' }, { email: 'a@b.c' }, { companyId: '515000000' }, { address: 'x' }, { business: 'y' }]) {
    const r = await callTool(handle, 'lior', DRAFT_TOOL, { ...DEAL, ...extra });
    assert.equal(r.isError, true);
    const out = JSON.parse(textOf(r));
    assert.equal(out.code, 'unknown_field');
    assert.doesNotMatch(textOf(r), /דנה|0501112222|a@b\.c|515000000/, 'the value is not echoed');
  }
  for (const text of ['לחזור לדנה 050-1112222', 'לשלוח ל a@b.co', 'ח.פ 515000000', 'טל׳ 03 123 45 67']) {
    const r = await callTool(handle, 'lior', DRAFT_TOOL, { ...DEAL, specialClauses: [text] });
    assert.equal(JSON.parse(textOf(r)).code, 'personal_details', text);
    const r2 = await callTool(handle, 'lior', DRAFT_TOOL, { mode: 'free', monthlyPrice: 490000, extraLines: [{ label: text }] });
    assert.equal(JSON.parse(textOf(r2)).code, 'personal_details', text);
  }
  // Inside a list as well.
  const r3 = await callTool(handle, 'lior', DRAFT_TOOL, { mode: 'free', extraLines: [{ label: 'x', phone: '1' }] });
  assert.equal(JSON.parse(textOf(r3)).code, 'unknown_field');
  assert.ok(usage.every((u) => !JSON.stringify(u).includes('דנה')));
  // An amount of a clause is not a phone.
  assert.equal(checkDraftInput({ ...DEAL, specialClauses: ['תשלום של 4,900 ₪ ב־12 תשלומים'] }).error, undefined);
});

test('the tool answers: totals, what is set, a link; writes nothing to the database', async () => {
  const { handle, reads, writes } = world();
  const r = await callTool(handle, 'ofir', DRAFT_TOOL, DEAL);
  assert.equal(r.isError, undefined);
  const out = JSON.parse(textOf(r));
  assert.match(out.status, /לא נשמר ולא נשלח/);
  assert.equal(out.months, 6);
  assert.equal(out.custom_contract, true);
  assert.equal(out.vat_percent, 18);
  assert.equal(out.monthly_with_vat_ils, Math.round(out.monthly_before_vat_ils * 1.18));
  assert.equal(out.whole_term_with_vat_ils, out.monthly_with_vat_ils * 6);
  assert.ok(out.set.some((s) => /סרטונים/.test(s)));
  assert.ok(out.differs_from_package.length >= 2);
  assert.ok(out.link.startsWith(`https://app.astrateg.tech/#${DRAFT_PARAM}=`), 'after the #: never sent to a server');
  assert.deepEqual(reads.flat(), [], 'no table read at all');
  assert.deepEqual([...new Set(writes)], ['mcp_usage'], 'only the usage row');
  const src = readFileSync(new URL('../app/mcp-draft.js', import.meta.url), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(src, /supabase|fetch\(|\.insert|\.rpc/);
});

test('for every person of the tool; totals are the engine\'s, also for Lior and Ofir (as on the builder)', async () => {
  const { handle } = world();
  const seen = [];
  for (const who of ['owner', 'lior', 'ofir']) seen.push(JSON.parse(textOf(await callTool(handle, who, DRAFT_TOOL, { package: 'podcast-natali' }))).monthly_with_vat_ils);
  assert.equal(new Set(seen).size, 1);
  assert.ok(seen[0] > 0);
});

test('a package is required in catalog mode (never a guess); a wrong one is refused', () => {
  assert.equal(draftAnswer({}).error, 'package_required');
  assert.equal(draftAnswer({ package: 'nope' }).error, 'package_required');
  assert.equal(draftAnswer({ mode: 'other' }).error, 'bad_input');
  assert.equal(draftAnswer({ package: 'podcast-natali', docType: 'nope' }).error, 'bad_input');
  assert.equal(draftAnswer({ package: 'podcast-natali', influencer: 'natali' }).error, 'field_of_other_mode');
  assert.equal(draftAnswer({ mode: 'free', package: 'podcast-natali' }).error, 'field_of_other_mode');
  for (const v of [null, 5, 'x', []]) assert.equal(draftAnswer(v).error, 'bad_input');
});

test('exceptions: a discount over the regular limit goes to a custom contract, as the builder sends it', () => {
  const d = draftOf({ package: 'podcast-natali', discount: 100000 });
  assert.equal(d.error, undefined);
  const out = draftAnswer({ package: 'social-simeon', discount: 100000 });
  assert.equal(out.custom_contract, true);
  assert.equal(out.monthly_discount_ils, 1000);
  assert.ok(out.differs_from_package.some((t) => /הנחה/.test(t)));
  assert.equal(draftAnswer({ package: 'social-simeon', discount: 10000 }).custom_contract, false, 'a regular discount');
  // Clamped, and said, as contract-ai does.
  const far = draftAnswer({ package: 'podcast-natali', months: 500 });
  assert.ok(far.months < 500);
  assert.ok(far.to_check.some((t) => /מחוץ לטווח/.test(t)));
  // An add-on the package does not allow is left out, and said.
  const star = PAID_ADDONS.find((a) => a.eligibility === 'natali');
  const addon = draftAnswer({ package: 'social-simeon', addons: [star.id] });
  assert.equal(addon.error, undefined);
  assert.ok(addon.to_check.some((t) => t.includes(star.name)));
  // Unknown ones too.
  assert.ok(draftAnswer({ package: 'social-simeon', addons: ['nope'] }).to_check.some((t) => /לא מוכרת/.test(t)));
});

test('a free-hand contract: exactly as written, nothing mapped on a package', () => {
  const out = draftAnswer({ mode: 'free', docType: 'quote', influencer: 'none', monthlyPrice: 490000, monthlyShoot: true, monthlyContents: 8, extraLines: [{ label: 'דפי נחיתה', qty: 2 }] });
  assert.equal(out.error, undefined);
  assert.equal(out.custom_contract, true);
  assert.equal(out.monthly_before_vat_ils, 4900);
  assert.match(out.package, /בלי משפיענים/);
  assert.match(out.document, /הצעת מחיר/);
  assert.ok(out.set.some((s) => /דפי נחיתה/.test(s)));
  const noPrice = draftAnswer({ mode: 'free', influencer: 'none' });
  assert.ok(noPrice.to_check.some((s) => /מחיר/.test(s)), 'asks, never invents');
});

test('the link: the builder gets back what passes the same check, and nothing else', () => {
  const { link } = draftAnswer(DEAL);
  const hash = link.slice(link.indexOf('#'));
  const back = draftFromHash(hash);
  assert.deepEqual(back.input, { ...DEAL, mode: 'catalog' });
  const again = draftOf(back.input);
  validateSelection(again.selection.custom ? { ...again.selection, discount: 0 } : again.selection);
  assert.equal(draftAnswer(back.input).monthly_with_vat_ils, draftAnswer(DEAL).monthly_with_vat_ils);
  assert.deepEqual(draftFromHash(''), {});
  assert.deepEqual(draftFromHash('#mine'), {});
  const enc = (o) => `#${DRAFT_PARAM}=${Buffer.from(JSON.stringify(o)).toString('base64url')}`;
  for (const hashed of [`#${DRAFT_PARAM}=`, `#${DRAFT_PARAM}=@@@`, enc({ ...DEAL, client: { name: 'דנה' } }), enc({ ...DEAL, phone: '050' }), enc([1]), enc({ package: 'nope' }), enc({ mode: 'free', specialClauses: ['a@b.co'] }), `#${DRAFT_PARAM}=${'A'.repeat(DRAFT_LINK_MAX + 1)}`]) {
    assert.deepEqual(draftFromHash(hashed), { bad: true }, hashed.slice(0, 40));
  }
  assert.ok(draftLink({ ...DEAL, mode: 'catalog', specialClauses: Array(12).fill('א'.repeat(250)) }).length < DRAFT_LINK_MAX, 'the longest allowed fits');
});

// ── The consent page's plain rules ─────────────
test('the consent page: the id, where it may send you, the app\'s name', () => {
  assert.equal(authorizationIdOf('?authorization_id=abc-DEF_12345'), 'abc-DEF_12345');
  for (const s of ['', '?x=1', '?authorization_id=', '?authorization_id=a', '?authorization_id=../../x', `?authorization_id=${'a'.repeat(200)}`]) assert.equal(authorizationIdOf(s), null, s);
  assert.equal(safeRedirect('https://claude.ai/api/mcp/auth_callback?code=1'), 'https://claude.ai/api/mcp/auth_callback?code=1');
  assert.equal(safeRedirect('http://localhost:33418/callback?code=1'), 'http://localhost:33418/callback?code=1');
  assert.equal(safeRedirect('http://127.0.0.1:1234/cb'), 'http://127.0.0.1:1234/cb');
  for (const u of ['javascript:alert(1)', 'data:text/html,x', 'http://evil.test/cb', 'not a url', '', null, undefined]) assert.equal(safeRedirect(u), null, String(u));
  assert.equal(clientNameOf({ client: { name: ' Claude‮  x ' } }), 'Claude x');
  assert.equal(clientNameOf({}), 'אפליקציה בלי שם');
  assert.equal(clientHostOf({ redirect_uri: 'https://claude.ai/cb' }), 'claude.ai');
  assert.equal(clientHostOf({}), null);
});
