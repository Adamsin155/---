// HTTP helpers of the create-quote function, free of Deno APIs so node tests them
// (tests/create-quote.test.mjs). Deployed together with index.ts.
//
// Only the office's own site may call the function from a browser (any port on
// localhost for local testing), as with the other functions. It used to answer
// `Access-Control-Allow-Origin: *` (security audit, 6.10.2026; docs/ops.md, section 36).
export const SITE_ORIGINS = ['https://adamsin155.github.io', 'https://app.astrateg.tech'];

export function allowedOrigin(origin) {
  if (!origin) return null;
  if (SITE_ORIGINS.includes(origin)) return origin;
  try {
    const u = new URL(origin);
    if (u.protocol === 'http:' && u.hostname === 'localhost' && u.origin === origin) return origin;
  } catch { /* not a URL */ }
  return null;
}

export function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
  const ok = allowedOrigin(origin);
  if (ok) headers['Access-Control-Allow-Origin'] = ok;
  return headers;
}

// Who may create a quote, an agreement or a corrected version: the office only
// (public.is_office(): the owner, Irit, Lior, Ofir and Ilai). Editors, Eli and the
// sales agents have a login (public.is_staff()) but never prepare a quote: the agents
// send a deal request (deal.html) and Irit prepares the contract from it. Before
// 6.10.2026 any staff login could create an agreement, sign it signed-out, and so
// open a client row. `rpc` is the caller's own client: (name) => { data, error }.
export async function callerIsOffice(rpc) {
  const { data, error } = await rpc('is_office');
  return !error && data === true;
}

// "שינויים להצעה הזו" (the owner, 9.11.2026; docs/ops.md, section 118): the package's monthly price
// (selection.custom.price) and its name as the document shows it (selection.custom.packageName), for
// one quote, the catalog unchanged. Only the managers: public.is_manager(), the owners (Adam and Idan,
// staff with no person), Irit, Ofir and Lior. Anyone else of the office (Ilai) is refused, for a
// price typed in "חוזה מותאם אישית" too (the same field). The engine (app/pricing.js) checks the
// values themselves: the price 0 to 100,000 ₪, the name up to 60 characters with no markup, and the
// totals are always computed from them on the server.
export const QUOTE_EDIT_KEYS = ['price', 'packageName'];
export const editsQuote = (sel) => !!sel?.custom && typeof sel.custom === 'object'
  && QUOTE_EDIT_KEYS.some((k) => sel.custom[k] !== undefined && sel.custom[k] !== null);
export async function callerMayEditQuote(rpc) {
  try {
    const { data, error } = await rpc('is_manager');
    return !error && data === true;
  } catch {
    return false;
  }
}

// "הכנת חוזה עם AI" (docs/ops.md, sections 68 and 79): a contract prepared by the contract-ai
// function is marked "הוכן ע״י AI". `aiRun` is the id that function gave back; it counts only for a successful
// run of the caller's own, from the last AI_RUN_HOURS hours, not used for another contract yet
// (the database checks the same in public.quotes_set_hash). What is wrong with it, or null:
// 'not found' | 'used' | 'expired'.
export const AI_RUN_HOURS = 24;
export function aiRunProblem(run, userId, usedBy, now = Date.now()) {
  if (!run || !userId || run.user_id !== userId || run.status !== 'ok') return 'not found';
  if (usedBy > 0) return 'used';
  const at = Date.parse(run.created_at);
  if (!Number.isFinite(at) || now - at > AI_RUN_HOURS * 3600e3) return 'expired';
  return null;
}

// The owner's "send_contract" from Claude (docs/ops.md, section 116). The mcp function sends the key that
// only it holds (public.mcp_gate_key()) with the owner's OAuth token. Here only its shape is looked at:
// it goes on with the person's client to the database, whose gate compares it on every call (a wrong
// one is refused there, so is_office answers no). The key, or null (never throws).
export const MCP_GATE_HEADER = 'x-mcp-gate';
export function mcpGateOf(sent) {
  return typeof sent === 'string' && /^[0-9a-f-]{64,200}$/i.test(sent) ? sent : null;
}
// And only an owner who is switched on for Claude (public.my_person() null, public.mcp_allowed()); asked
// after callerIsOffice. `rpc` is the caller's own client (the key on it, through the database's gate).
export async function mcpCallerIsOwner(rpc) {
  try {
    const [person, on] = await Promise.all([rpc('my_person'), rpc('mcp_allowed')]);
    return !person.error && person.data === null && !on.error && on.data === true;
  } catch {
    return false;
  }
}
