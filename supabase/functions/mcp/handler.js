// The mcp function's work, free of Deno APIs so node tests run it whole (tests/mcp.test.mjs);
// index.ts gives it the environment and the Supabase client. Claude accounts of the owners, Lior and
// Ofir read the system and prepare a contract draft, each with their own login (docs/ops.md, section 84):
//
//   POST …/functions/v1/mcp                                     MCP, Streamable HTTP, stateless, spec 2025-11-25
//   GET  …/functions/v1/mcp/.well-known/oauth-protected-resource  where to sign in (RFC 9728)
//
//   - the login is Supabase Auth's OAuth 2.1 server: this function keeps no password and no refresh
//     token. Every request: the token is checked with Supabase (signature, expiry, session), its aud
//     and iss here, and it must carry `client_id`, so an ordinary browser session token is not taken;
//   - every read goes with that person's JWT, so row level security answers what their screens answer,
//     through the same tools and the same walls as "שאלו את המערכת" (../ask/tools.js, imported, never
//     copied): no phone, email, address, notes, vault, logins, payroll; money only for sees_money();
//   - who: the owners, Lior and Ofir (mayUseMcp in app/mcp-logic.js) AND switched on in public.mcp_access
//     (public.mcp_allowed()), asked on every request, so switching someone off works at once. Anything
//     unclear is a no; the answer holds a short code and never a database's words;
//   - prepare_contract_draft writes nothing and sends nothing (app/mcp-draft.js);
//   - public.mcp_usage keeps who, which tool, ok or a short code, and when. Never the arguments,
//     never the answers. The log gets short codes only.
import { TOOLS, runTool, guardDb } from '../ask/tools.js';
import { SYSTEM, makeLimiter } from '../ask/handler.js';
import { PEOPLE, scopeOf } from '../_shared/app/protocol.js';
import { serviceAccountOf, makeDrive } from '../_shared/drive.js';
import { canBuildQuote } from '../_shared/app/manager-rules.js';
import { mayUseMcp } from '../_shared/app/mcp-logic.js';
import { DRAFT_TOOL, DRAFT_SCHEMA, DRAFT_ERRORS, draftDescription, draftAnswer } from '../_shared/app/mcp-draft.js';

export const LATEST_VERSION = '2025-11-25';
export const VERSIONS = [LATEST_VERSION, '2025-06-18', '2025-03-26'];
export const SERVER_VERSION = '1.0.0';
export const RATE_PER_MINUTE = 60;
export const BODY_MAX = 256 * 1024;
export const METADATA_PATH = '/.well-known/oauth-protected-resource';
// What this function asks the database as the person, besides the tools' tables (TABLES in ../ask/tools.js).
// public.mcp_request_gate() lets a connected app's token ask these and nothing else; tests/sql/mcp-gate.test.mjs
// holds the two lists equal.
export const GATE_RPCS = ['is_office', 'my_person', 'mcp_allowed', 'sees_money'];
export const GATE_HEADER = 'x-mcp-gate';

// JSON-RPC's own codes, and two of ours for "who".
export const E = { PARSE: -32700, INVALID: -32600, NO_METHOD: -32601, PARAMS: -32602, INTERNAL: -32603, AUTH: -32001, REFUSED: -32003, LIMIT: -32029 };
export const REFUSED_WORDS = 'החיבור למערכת של אסטרטג לא פתוח לחשבון הזה. אפשר לבקש מהבעלים להפעיל אותו.';

// Claude's sites and the office's own. No Origin at all (a server, Claude Code) is fine: the token decides.
export function allowedOrigin(origin) {
  try {
    const u = new URL(origin);
    if (u.protocol !== 'https:' || u.origin !== origin) return false;
    return u.hostname === 'app.astrateg.tech' || ['claude.ai', 'claude.com'].some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`));
  } catch { return false; }
}
function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Headers': 'authorization, content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Expose-Headers': 'www-authenticate, mcp-protocol-version',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
    ...(origin && allowedOrigin(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
  };
}

// What the office is and how to answer, from ask's own lines (kept in one place).
const FROM_ASK = /^(You answer questions|Answer in Hebrew|Passwords and|When the tools hold no money|When several clients|Words:)/;
export const INSTRUCTIONS = [
  ...SYSTEM.split('\n').filter((line) => FROM_ASK.test(line)),
  'The tools read the system with the rights of the person connected: what they cannot see is simply missing.',
  `A closed deal: ${DRAFT_TOOL} gives a link to the contract builder. Never ask for the client's details for it: they are typed on the builder.`,
].join('\n');

// The tools as MCP lists them: ask's own, as they are, and the draft.
export const MCP_READ_TOOLS = TOOLS.map((t) => ({
  name: t.name, description: t.description, inputSchema: t.input_schema, annotations: { readOnlyHint: true },
}));
const draftTool = () => ({ name: DRAFT_TOOL, description: draftDescription(), inputSchema: DRAFT_SCHEMA, annotations: { readOnlyHint: true } });
const READ_NAMES = new Set(TOOLS.map((t) => t.name));

const hasFields = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// The token's claims, for reading. Whether it is genuine is Supabase's answer (getUser), asked after.
export function claimsOf(token) {
  const part = String(token).split('.')[1];
  if (!part) return null;
  try {
    const bin = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    return hasFields(claims) ? claims : null;
  } catch { return null; }
}
const hasAud = (aud) => aud === 'authenticated' || (Array.isArray(aud) && aud.includes('authenticated'));
// The checks on what the token says of itself. `client_id` is what only a token of the OAuth server has.
export function claimsProblem(claims, { issuer, at }) {
  if (!claims) return 'bad_token';
  if (typeof claims.client_id !== 'string' || !claims.client_id) return 'not_oauth';
  if (!hasAud(claims.aud)) return 'bad_audience';
  if (claims.iss !== issuer) return 'bad_issuer';
  if (claims.role !== 'authenticated') return 'bad_role';
  if (!Number.isFinite(claims.exp) || claims.exp * 1000 <= at) return 'expired';
  if (typeof claims.sub !== 'string' || !claims.sub) return 'bad_token';
  return null;
}

// deps: { env(name), serviceKey(), createClient(url, key, opts?), now(), log(message), fetch }
export function makeHandler(deps) {
  const now = deps.now || (() => Date.now());
  const log = deps.log || (() => {});
  const allow = makeLimiter(RATE_PER_MINUTE);
  let admin = null;
  let gateKey = null;
  const adminClient = () => {
    admin ||= deps.createClient(deps.env('SUPABASE_URL'), deps.serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } });
    return admin;
  };
  // The key that opens the database's gate (public.mcp_request_gate()) for this function alone: a token
  // held anywhere else, without it, is refused at the REST API. Read once with the service key; never
  // logged and never sent back.
  async function gateKeyOf() {
    if (gateKey) return gateKey;
    const { data, error } = await adminClient().rpc('mcp_gate_key');
    if (error || typeof data !== 'string' || !data) throw new Error('no gate key');
    gateKey = data;
    return gateKey;
  }

  const baseUrl = () => String(deps.env('SUPABASE_URL') || '').replace(/\/+$/, '');
  const resourceUrl = () => `${baseUrl()}/functions/v1/mcp`;
  const issuer = () => `${baseUrl()}/auth/v1`;

  // Who, which tool, ok or a short code, when. Nothing else, and a failure here fails nothing.
  async function keepUsage(email, tool, code) {
    try {
      const { error } = await adminClient().from('mcp_usage').insert({ email: String(email || '').toLowerCase().slice(0, 200), tool, code, at: new Date(now()).toISOString() });
      if (error) log(`mcp: usage not kept (${String(error.code || 'error').slice(0, 20)})`);
    } catch (err) {
      log(`mcp: usage not kept (${err?.name || 'error'})`);
    }
  }

  return async function handle(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const origin = req.headers.get('origin');
    const CORS = corsHeaders(origin);
    const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', ...headers } });
    const rpcError = (status, id, code, message, data, headers) => json(status, { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data ? { data } : {}) } }, headers);
    const rpcResult = (id, result) => json(200, { jsonrpc: '2.0', id, result });
    const noBody = (status, headers = {}) => new Response(null, { status, headers: { ...CORS, ...headers } });

    // ── Where to sign in: public, and nothing secret in it ──
    if (path.endsWith(`/mcp${METADATA_PATH}`) || path.endsWith(`/mcp${METADATA_PATH}/`)) {
      const open = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'content-type, accept, mcp-protocol-version' };
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: open });
      if (req.method !== 'GET' && req.method !== 'HEAD') return new Response(null, { status: 405, headers: { ...open, Allow: 'GET, OPTIONS' } });
      return new Response(req.method === 'HEAD' ? null : JSON.stringify({
        resource: resourceUrl(),
        authorization_servers: [issuer()],
        bearer_methods_supported: ['header'],
        resource_name: 'Astrateg',
      }), { status: 200, headers: { ...open, 'Content-Type': 'application/json', 'Cache-Control': 'max-age=300' } });
    }
    if (!/\/mcp\/?$/.test(path)) return rpcError(404, null, E.INVALID, 'not found');

    // ── The transport ──
    if (origin && !allowedOrigin(origin)) return rpcError(403, null, E.INVALID, 'origin not allowed');
    if (req.method === 'OPTIONS') return noBody(204);
    if (req.method !== 'POST') return noBody(405, { Allow: 'POST, OPTIONS' });

    // ── Who: the token, before anything is read ──
    const challenge = (error) => ({ 'WWW-Authenticate': `Bearer ${error ? `error="${error}", ` : ''}resource_metadata="${resourceUrl()}${METADATA_PATH}"` });
    const bearer = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.get('authorization') || '');
    if (!bearer) return rpcError(401, null, E.AUTH, 'sign in required', null, challenge());
    const token = bearer[1];
    const claims = claimsOf(token);
    const problem = claimsProblem(claims, { issuer: issuer(), at: now() });
    if (problem) return rpcError(401, null, E.AUTH, 'invalid token', { code: problem === 'not_oauth' ? 'not_oauth' : 'invalid_token' }, challenge('invalid_token'));
    let userClient;
    let user = null;
    try {
      userClient = deps.createClient(deps.env('SUPABASE_URL'), deps.env('SUPABASE_ANON_KEY'), {
        global: { headers: { Authorization: `Bearer ${token}`, [GATE_HEADER]: await gateKeyOf() } },
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const { data, error } = await userClient.auth.getUser(token);
      if (!error) user = data?.user ?? null;
    } catch {
      log('mcp: the token check failed');
      return rpcError(503, null, E.INTERNAL, 'unavailable', { code: 'unavailable' });
    }
    if (!user || user.id !== claims.sub) return rpcError(401, null, E.AUTH, 'invalid token', { code: 'invalid_token' }, challenge('invalid_token'));

    // ── The message ──
    let raw;
    try { raw = await req.text(); } catch { return rpcError(400, null, E.PARSE, 'parse error'); }
    if (raw.length > BODY_MAX) return rpcError(413, null, E.INVALID, 'request too large');
    let msg;
    try { msg = JSON.parse(raw); } catch { return rpcError(400, null, E.PARSE, 'parse error'); }
    if (Array.isArray(msg)) return rpcError(400, null, E.INVALID, 'batches are not supported');
    if (!hasFields(msg) || msg.jsonrpc !== '2.0') return rpcError(400, null, E.INVALID, 'invalid request');
    const hasId = 'id' in msg;
    if (hasId && typeof msg.id !== 'string' && !Number.isFinite(msg.id)) return rpcError(400, null, E.INVALID, 'invalid request');
    if (msg.method === undefined && hasId && ('result' in msg || 'error' in msg)) return noBody(202); // an answer of the client: nothing was asked
    if (typeof msg.method !== 'string' || !msg.method) return rpcError(400, hasId ? msg.id : null, E.INVALID, 'invalid request');
    const id = hasId ? msg.id : null;
    const version = req.headers.get('mcp-protocol-version');
    if (version && !VERSIONS.includes(version)) return rpcError(400, id, E.INVALID, 'unsupported protocol version', { supported: VERSIONS });

    // What goes into mcp_usage as the tool: a name of ours, never words the caller made up.
    const isCall = hasId && msg.method === 'tools/call';
    const asked = isCall && hasFields(msg.params) ? msg.params.name : null;
    const toolName = asked === DRAFT_TOOL || READ_NAMES.has(asked) ? asked : 'unknown';

    // A light limit for each person, before the database is asked anything.
    if (hasId && !allow(user.id, now())) {
      if (isCall) await keepUsage(user.email, toolName, 'rate_limited');
      return rpcError(429, id, E.LIMIT, 'too many requests', { code: 'rate_limited' }, { 'Retry-After': '60' });
    }

    // ── Who: the database decides, on every request ──
    let office; let person; let on; let money;
    try {
      [office, person, on, money] = await Promise.all(GATE_RPCS.map((fn) => userClient.rpc(fn)));
    } catch {
      log('mcp: who could not be asked');
      return rpcError(503, id, E.INTERNAL, 'unavailable', { code: 'unavailable' });
    }
    if (office.error || person.error || on.error) {
      log(`mcp: who could not be read (${String((office.error || person.error || on.error).code || 'error').slice(0, 20)})`);
      return rpcError(503, id, E.INTERNAL, 'unavailable', { code: 'unavailable' });
    }
    const me = person.data ?? null;
    if (!mayUseMcp({ office: office.data, person: me }) || on.data !== true) {
      if (isCall) await keepUsage(user.email, toolName, 'not_allowed');
      return rpcError(403, id, E.REFUSED, REFUSED_WORDS, { code: 'not_allowed' });
    }
    const seesMoney = !money.error && money.data === true;
    const viewer = { me: me && PEOPLE[me] ? me : null, scope: scopeOf(me), error: null };

    if (!hasId) return noBody(202); // a notification

    // ── The methods ──
    switch (msg.method) {
      case 'initialize': {
        if (!hasFields(msg.params)) return rpcError(200, id, E.PARAMS, 'invalid params');
        const wanted = msg.params.protocolVersion;
        return rpcResult(id, {
          protocolVersion: VERSIONS.includes(wanted) ? wanted : LATEST_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'astrateg', title: 'Astrateg', version: SERVER_VERSION },
          instructions: INSTRUCTIONS,
        });
      }
      case 'ping':
        return rpcResult(id, {});
      case 'tools/list':
        return rpcResult(id, { tools: [...MCP_READ_TOOLS, ...(canBuildQuote(viewer) ? [draftTool()] : [])] });
      case 'tools/call': {
        const args = hasFields(msg.params) ? msg.params.arguments ?? {} : null;
        if (!hasFields(msg.params) || typeof asked !== 'string' || !hasFields(args)) {
          await keepUsage(user.email, toolName, 'bad_params');
          return rpcError(200, id, E.PARAMS, 'invalid params');
        }
        if (toolName === 'unknown') {
          await keepUsage(user.email, 'unknown', 'unknown_tool');
          return rpcError(200, id, E.PARAMS, 'unknown tool');
        }
        const out = toolName === DRAFT_TOOL
          ? callDraft(viewer, args)
          : await callRead({ userClient, viewer, seesMoney, deps, now }, toolName, args);
        await keepUsage(user.email, toolName, out.code);
        return rpcResult(id, { content: [{ type: 'text', text: out.text }], ...(out.isError ? { isError: true } : {}) });
      }
      default:
        return rpcError(200, id, E.NO_METHOD, 'method not found');
    }
  };
}

// The read tools: ask's own, with ask's own walls. { text, isError, code } (the code for mcp_usage).
async function callRead({ userClient, viewer, seesMoney, deps, now }, name, args) {
  const sa = serviceAccountOf(deps.env('GOOGLE_DRIVE_SERVICE_ACCOUNT'));
  const ctx = {
    viewer,
    db: guardDb(userClient),
    seesMoney,
    drive: sa ? makeDrive(sa, { fetch: deps.fetch || globalThis.fetch }) : null,
    now: () => new Date(now()),
  };
  const r = await runTool(ctx, name, args);
  return { text: r.content, isError: !!r.isError, code: r.isError ? 'tool_error' : 'ok' };
}

// The draft: for whoever builds a contract. It touches no database and sends nothing.
function callDraft(viewer, args) {
  if (!canBuildQuote(viewer)) return { text: JSON.stringify({ error: 'הכנת חוזה פתוחה למי שבונה חוזים במחולל.', code: 'not_allowed' }), isError: true, code: 'not_allowed' };
  const out = draftAnswer(args);
  if (out.error) {
    return {
      text: JSON.stringify({ error: DRAFT_ERRORS[out.error] || DRAFT_ERRORS.bad_input, code: out.error, fields: out.fields, details: out.details }),
      isError: true,
      code: String(out.error).slice(0, 32),
    };
  }
  return { text: JSON.stringify(out), isError: false, code: 'ok' };
}
