// A tiny in-memory stand-in for supabase-js's query builder (from().select().eq()…), for the
// unit tests of the edge functions that read as the caller (tests/ask.test.mjs,
// tests/drive.test.mjs). Only what those functions use: select with named columns, eq, in, is,
// gte, lte, lt, order, limit, maybeSingle, update. `tables` is { name: rows[] }, or a function
// (name) => rows[] (the "row level security" of a test). Every read is recorded in `reads`.
export function fakeClient(tables, { rpc = {}, user = { id: 'u1', email: 'x@astrateg.test' } } = {}) {
  const reads = [];
  const rowsOf = (t) => (typeof tables === 'function' ? tables(t) : tables[t]) || [];
  function query(table) {
    const filters = [];
    let cols = null;
    let order = null;
    let max = Infinity;
    let single = false;
    const q = {
      select(c) { cols = c; reads.push({ table, cols: c }); return q; },
      eq(k, v) { filters.push((r) => r[k] === v); return q; },
      in(k, vs) { filters.push((r) => vs.includes(r[k])); return q; },
      is(k, v) { filters.push((r) => (r[k] ?? null) === v); return q; },
      gte(k, v) { filters.push((r) => r[k] != null && String(r[k]) >= String(v)); return q; },
      lte(k, v) { filters.push((r) => r[k] != null && String(r[k]) <= String(v)); return q; },
      lt(k, v) { filters.push((r) => r[k] != null && String(r[k]) < String(v)); return q; },
      order(k, o = {}) { order = [k, o.ascending !== false]; return q; },
      limit(n) { max = n; return q; },
      maybeSingle() { single = true; return q; },
      then(ok, bad) {
        let out = rowsOf(table).filter((r) => filters.every((f) => f(r)));
        if (order) out = [...out].sort((a, b) => (String(a[order[0]] ?? '') < String(b[order[0]] ?? '') ? -1 : String(a[order[0]] ?? '') > String(b[order[0]] ?? '') ? 1 : 0) * (order[1] ? 1 : -1));
        out = out.slice(0, max);
        const names = cols ? cols.split(',').map((s) => s.trim()) : null;
        const pick = (r) => (names ? Object.fromEntries(names.map((n) => [n, r[n] ?? null])) : r);
        const data = single ? (out[0] ? pick(out[0]) : null) : out.map(pick);
        return Promise.resolve({ data, error: null }).then(ok, bad);
      },
    };
    return q;
  }
  return {
    reads,
    from: (t) => query(t),
    rpc: async (name) => (name in rpc ? { data: typeof rpc[name] === 'function' ? rpc[name]() : rpc[name], error: null } : { data: null, error: { message: 'no such function' } }),
    auth: { getUser: async () => ({ data: { user } }) },
  };
}
