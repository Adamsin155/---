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

// "הכנת חוזה עם AI" (the owner's decision of 25.10.2026; docs/ops.md, section 68): a contract
// prepared by the contract-ai function and reviewed by the office goes to the client without a
// manager's approval. `aiRun` is the id that function gave back; it counts only for a successful
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
