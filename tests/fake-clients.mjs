// The browser suites' fake Supabase, answering for public.clients as the database
// does since supabase/migrations/20260930210000_hardening.sql:
//   - a read (or a write's returned row) that names an office-only column (phone,
//     notes, closed_reason), or asks for every column ('*'), is refused with 42501,
//     for everyone, as PostgREST does with a column privilege;
//   - the rows sent back never carry those columns;
//   - public.clients_private(p_ids) gives them to the office (the owner, Irit, Lior,
//     Ofir, Ilai), and nothing to anyone else.
// Each suite wraps its own handler: ctx.route(URL, withClientColumns(fakeSupabase,
// { clients: () => db.clients, staff: () => staff })).
export const CLIENT_PRIVATE = ['phone', 'notes', 'closed_reason'];
const OFFICE = new Set(['irit', 'lior', 'ofir', 'ilai']);
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

export const publicClient = (c) => Object.fromEntries(Object.entries(c).filter(([k]) => !CLIENT_PRIVATE.includes(k)));
const emailOf = (headers) => {
  const token = /^Bearer (.+)$/.exec(headers.authorization || '')?.[1] || '';
  try { return JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64url').toString('utf8'))?.email || null; } catch { return null; }
};
// The columns a PostgREST select asks for ('a,b,c', 'alias:col').
const selected = (url) => (url.searchParams.get('select') || '*').split(',').map((s) => s.trim().split(':').pop().split('->')[0]);

function strip(body) {
  if (typeof body !== 'string' || !body) return body;
  let v;
  try { v = JSON.parse(body); } catch { return body; }
  if (Array.isArray(v)) return JSON.stringify(v.map((r) => (r && typeof r === 'object' ? publicClient(r) : r)));
  if (v && typeof v === 'object' && 'id' in v) return JSON.stringify(publicClient(v));
  return body;
}

export function withClientColumns(handler, { clients, staff }) {
  return async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'OPTIONS') return handler(route);
    const email = emailOf(req.headers());
    const me = email ? (staff() || []).find((s) => s.email === email) : undefined;
    const office = !!me && (me.person === null || OFFICE.has(me.person));
    if (url.pathname === '/rest/v1/rpc/clients_private') {
      if (!email) return route.fulfill({ status: 401, contentType: 'application/json', headers: CORS, body: JSON.stringify({ code: '42501', message: 'permission denied for function clients_private' }) });
      const body = req.postData() ? JSON.parse(req.postData()) : {};
      const ids = Array.isArray(body.p_ids) ? new Set(body.p_ids) : null;
      const rows = office ? (clients() || []).filter((c) => !ids || ids.has(c.id))
        .map((c) => ({ id: c.id, phone: c.phone ?? null, notes: c.notes ?? null, closed_reason: c.closed_reason ?? null })) : [];
      return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(rows) });
    }
    if (url.pathname !== '/rest/v1/clients') return handler(route);
    const cols = selected(url);
    const returns = req.method() === 'GET' || req.method() === 'HEAD' || url.searchParams.has('select');
    if (returns && cols.some((c) => c === '*' || CLIENT_PRIVATE.includes(c))) {
      return route.fulfill({ status: 403, contentType: 'application/json', headers: CORS, body: JSON.stringify({ code: '42501', message: 'permission denied for table clients' }) });
    }
    const proxy = {
      request: () => route.request(),
      continue: (...a) => route.continue(...a),
      abort: (...a) => route.abort(...a),
      fallback: (...a) => route.fallback(...a),
      fulfill: (opts = {}) => route.fulfill(opts.json !== undefined ? { ...opts, json: JSON.parse(strip(JSON.stringify(opts.json))) } : { ...opts, body: strip(opts.body) }),
    };
    return handler(proxy);
  };
}
