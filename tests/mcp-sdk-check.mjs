// One round with the official MCP client against the mcp function's handler, over a local HTTP shim
// and with fakes in place of Supabase (docs/ops.md, section 84). The SDK is not a dependency of the
// repo: install it in a temporary folder and point at it.
//   npm i --prefix <tmp> @modelcontextprotocol/sdk
//   MCP_SDK_DIR=<tmp>/node_modules/@modelcontextprotocol/sdk node tests/mcp-sdk-check.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { makeHandler, METADATA_PATH } from '../supabase/functions/mcp/handler.js';
import { fakeClient } from './fake-pgrest.mjs';

const dir = process.env.MCP_SDK_DIR;
if (!dir) { console.log('MCP_SDK_DIR not set: skipped'); process.exit(0); }
const load = (rel) => import(pathToFileURL(join(dir, 'dist/esm', rel)).href);
const { Client } = await load('client/index.js');
const { StreamableHTTPClientTransport } = await load('client/streamableHttp.js');

const BASE = 'https://proj.supabase.co';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const TOKEN = `${b64({ alg: 'ES256' })}.${b64({ sub: 'u1', email: 'owner@astrateg.test', role: 'authenticated', aud: 'authenticated', iss: `${BASE}/auth/v1`, exp: Math.floor(Date.now() / 1000) + 3600, client_id: 'c1' })}.sig`;
const usage = [];
const handle = makeHandler({
  env: (k) => ({ SUPABASE_URL: BASE, SUPABASE_ANON_KEY: 'anon' })[k],
  serviceKey: () => 'service',
  createClient: (_u, key) => {
    if (key === 'service') return { from: () => ({ insert: async (row) => { usage.push(row); return { error: null }; } }) };
    const c = fakeClient({ clients: [{ id: 'c', name: 'רון', status: 'active', phone: '050-1112222' }] }, { rpc: { is_office: true, my_person: null, sees_money: true, mcp_allowed: true } });
    c.auth.getUser = async () => ({ data: { user: { id: 'u1', email: 'owner@astrateg.test' } }, error: null });
    return c;
  },
});

const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const out = await handle(new Request(`http://edge.local${req.url}`, { method: req.method, headers: req.headers, ...(hasBody ? { body: Buffer.concat(chunks) } : {}) }));
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(out.body ? Buffer.from(await out.arrayBuffer()) : undefined);
});
await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
const url = new URL(`http://127.0.0.1:${server.address().port}/mcp`);

// Signed out: the challenge the client would follow.
const open = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
assert.equal(open.status, 401);
assert.ok(open.headers.get('www-authenticate').includes(METADATA_PATH));

const client = new Client({ name: 'check', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } }));
assert.equal(client.getServerVersion().name, 'astrateg');
assert.match(client.getInstructions(), /Answer in Hebrew/);
await client.ping();
const { tools } = await client.listTools();
assert.ok(tools.length >= 12);
assert.ok(tools.every((t) => t.annotations.readOnlyHint === true));
const found = await client.callTool({ name: 'find_clients', arguments: {} });
assert.equal(JSON.parse(found.content[0].text).count, 1);
assert.doesNotMatch(found.content[0].text, /050-1112222/);
const draft = await client.callTool({ name: 'prepare_contract_draft', arguments: { package: 'podcast-natali' } });
assert.match(JSON.parse(draft.content[0].text).link, /^https:\/\/app\.astrateg\.tech\/#mcp-draft=/);
const refused = await client.callTool({ name: 'prepare_contract_draft', arguments: { phone: '050' } });
assert.equal(refused.isError, true);
await assert.rejects(client.callTool({ name: 'nope', arguments: {} }), /unknown tool/);
await client.close();
server.closeAllConnections();
server.close();
assert.deepEqual(usage.map((u) => u.tool), ['find_clients', 'prepare_contract_draft', 'prepare_contract_draft', 'unknown']);
console.log(`the official client: ${tools.length} tools, all checks passed`);
