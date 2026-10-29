// The two reading functions of 20261117100000_speed_pages.sql, said in JS (docs/ops.md,
// section 77). No DOM and no network: app/protocol-data.js unpacks their answers with it,
// and the tests (tests/speed-pages.test.mjs, tests/sql/speed-pages.test.mjs, the fake of
// tests/roles-world.mjs) check them against it.

// An item "ends in" s: it is s, or ends in "." and s (r2.p27.notes ends in p27.notes and in notes).
export const endsIn = (key, s) => key === s || String(key).endsWith(`.${s}`);

// public.protocol_checks_compact(): { v: [value, ...], c: [[client_id, [[item_key, s, n, e, a], ...]], ...] }
// back to what loadChecks() always returned: { clientId: { itemKey: row } }, each row with
// the columns (and in the order) the table gives.
export function expandChecks(compact) {
  const v = compact?.v;
  const c = compact?.c;
  if (!Array.isArray(v) || !Array.isArray(c)) throw new Error('protocol_checks_compact: unexpected answer');
  const out = {};
  for (const [clientId, rows] of c) {
    const mine = (out[clientId] ||= {});
    for (const [key, s, n, e, a] of rows) {
      mine[key] = { client_id: clientId, item_key: key, state: v[s], note: v[n], by_email: v[e], at: v[a] };
    }
  }
  return out;
}

// The compact form of rows (the JS of the SQL function; for the fakes of the suites).
export function compactChecks(rows) {
  const vals = new Map();
  const at = (x) => { const k = JSON.stringify(x ?? null); if (!vals.has(k)) vals.set(k, x ?? null); return k; };
  const sorted = [...rows].sort((a, b) => (a.client_id < b.client_id ? -1 : a.client_id > b.client_id ? 1 : a.item_key < b.item_key ? -1 : a.item_key > b.item_key ? 1 : 0));
  const keys = sorted.map((r) => [at(r.state), at(r.note), at(r.by_email), at(r.at)]);
  const list = [...vals.keys()].sort();
  const index = new Map(list.map((k, i) => [k, i]));
  const c = [];
  sorted.forEach((r, i) => {
    if (c.at(-1)?.[0] !== r.client_id) c.push([r.client_id, []]);
    c.at(-1)[1].push([r.item_key, ...keys[i].map((k) => index.get(k))]);
  });
  return { v: list.map((k) => vals.get(k)), c };
}

// public.protocol_log_brief(): of `rows` (the history one reads), those since `since` that
// are the newest of their client or end in one of `suffixes`, and those of any time that end
// in one of `history`; oldest first, without the id.
export function briefOfLog(rows, { since, suffixes = [], history = [] } = {}) {
  const from = new Date(since).getTime();
  const t = (r) => new Date(r.at).getTime();
  const inWindow = rows.filter((r) => t(r) >= from);
  const newest = new Map();
  for (const r of inWindow) {
    const n = newest.get(r.client_id);
    if (!n || t(r) > t(n) || (t(r) === t(n) && r.id > n.id)) newest.set(r.client_id, r);
  }
  const picked = new Set(newest.values());
  for (const r of inWindow) if (suffixes.some((s) => endsIn(r.item_key, s))) picked.add(r);
  if (history.length) for (const r of rows) if (history.some((s) => endsIn(r.item_key, s))) picked.add(r);
  return [...picked].sort((a, b) => t(a) - t(b) || a.id - b.id)
    .map((r) => ({ client_id: r.client_id, item_key: r.item_key, action: r.action, note: r.note ?? null, by_email: r.by_email, at: r.at }));
}
