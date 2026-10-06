// Data for the content Gantt (gantt.html). Row level security decides who reads and
// writes (supabase/migrations/20261003130000_content_gantt.sql and, since 6.10.2026,
// 20261007100000_gantt_roles_statuses.sql): Ilai and the owner write, the rest of the
// office and whoever sees the client read. Who and when are stamped by the database.
// Until the Gantt's migration is applied the plan reads as null ("not there yet")
// and the page says so. The client's files (public.client_files, the files'
// migration) are read the same way: null until that table is there.
// Metricool (20261007100100_metricool.sql): the client's brand, the last sync and the
// owner's switch read as "not built yet" (undefined) until that migration is applied;
// the account's brands come from the edge function `metricool`, never from the browser
// to Metricool itself.
import { supabase } from './supa.js';
import { isMissingTable } from './year-data.js';

const BASE_COLS = 'id, client_id, key, kind, title, day, time_il, month, num, internal, state, posted_on, file_id, link, note, edited, template_version, by_email, at';
// The sync's columns (20261007100000): who set the state, and the post it stands for.
const SYNC_COLS = 'source, mc_post_id, mc_status, mc_at, mc_networks, mc_error, mc_extra';
let cols = `${BASE_COLS}, ${SYNC_COLS}`;
export const ganttCols = () => cols;
const FILE_COLS = 'id, client_id, kind, label, storage_path, mime, size_bytes, posted_on, link, created_at';
const LINK_COLS = 'id, client_id, created_at, created_by, expires_at, revoked_at, revoked_by';
export const FILES_BUCKET = 'client-files';

const PAGE = 1000;
async function all(build) {
  let out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    out = out.concat(data);
    if (data.length < PAGE) return out;
  }
}
const orNull = async (fn) => {
  try { return await fn(); } catch (err) { if (isMissingTable(err)) return null; throw err; }
};
const missingColumn = (err) => !!err && (err.code === '42703' || err.code === 'PGRST204' || /column .* does not exist/i.test(String(err.message || '')));
const missingFunction = (err) => !!err && (err.code === 'PGRST202' || err.code === '42883' || /could not find the function/i.test(String(err.message || '')));
// Before 20261007100000 the sync's columns are not there: read without them, once.
async function withCols(fn) {
  try { return await fn(); } catch (err) {
    if (!missingColumn(err) || cols === BASE_COLS) throw err;
    cols = BASE_COLS;
    return fn();
  }
}

// The client's plan, by day (null: the table is not there yet).
export const loadGantt = (clientId) => orNull(() => withCols(() => all(() => supabase.from('client_gantt').select(cols)
  .eq('client_id', clientId).order('day').order('key'))));

// The index: every client's entries from `from` to `to` (day keys), and which clients
// have a Gantt at all (the template's last entry, 'end', is in every plan).
// { rows, has: Set of client ids } or null when the table is not there yet.
export async function loadIndex(from, to) {
  const rows = await orNull(() => withCols(() => all(() => supabase.from('client_gantt').select(cols)
    .gte('day', from).lte('day', to).order('day').order('id'))));
  if (rows === null) return null;
  const ends = await all(() => supabase.from('client_gantt').select('client_id').eq('key', 'end').order('client_id'));
  return { rows, has: new Set([...ends.map((r) => r.client_id), ...rows.map((r) => r.client_id)]) };
}

// Applies a planDiff (app/gantt-logic.js): one upsert for what is new or changed
// (only the template's columns, so state, links, files and notes stay), one delete.
const TEMPLATE_COLS = ['kind', 'title', 'day', 'time_il', 'month', 'num', 'internal', 'edited'];
export async function applyPlan(clientId, diff, rows, version) {
  const byId = new Map((rows || []).map((r) => [r.id, r]));
  const pick = (src) => Object.fromEntries(TEMPLATE_COLS.map((k) => [k, src[k] ?? (k === 'edited' || k === 'internal' ? false : null)]));
  const up = [
    ...diff.insert.map((e) => ({ client_id: clientId, key: e.key, ...pick(e), template_version: version })),
    ...diff.update.map((u) => {
      const r = byId.get(u.id);
      return { client_id: clientId, key: u.key, ...pick({ ...r, ...u.fields }), template_version: version };
    }),
  ];
  if (up.length) {
    const { error } = await supabase.from('client_gantt').upsert(up, { onConflict: 'client_id,key' });
    if (error) throw error;
  }
  if (diff.remove.length) {
    const { error } = await supabase.from('client_gantt').delete().in('id', diff.remove);
    if (error) throw error;
  }
}

export async function saveEntry(id, fields) {
  const { data, error } = await supabase.from('client_gantt').update(fields).eq('id', id).select(cols).single();
  if (error) throw error;
  return data;
}
// One state for several entries ("סימון כתוזמנו", and its undo): the rows as they are now.
// A row the database did not change (no permission) is not in the answer.
export async function setStates(ids, state) {
  if (!ids.length) return [];
  const { data, error } = await supabase.from('client_gantt').update({ state }).in('id', ids).select(cols);
  if (error) throw error;
  return data;
}
export async function addEntry(row) {
  const { data, error } = await supabase.from('client_gantt').insert(row).select(cols).single();
  if (error) throw error;
  return data;
}
export async function removeEntry(id) {
  const { error } = await supabase.from('client_gantt').delete().eq('id', id);
  if (error) throw error;
}

// The client's files that are not deleted (null: no files table yet).
export const loadFiles = (clientId) => orNull(() => all(() => supabase.from('client_files').select(FILE_COLS)
  .eq('client_id', clientId).is('deleted_at', null).order('created_at', { ascending: false })));

// A short-lived link to a file in the private bucket (null when it cannot be made).
const signed = new Map();
export async function fileUrl(path) {
  if (!path) return null;
  const hit = signed.get(path);
  if (hit && hit.until > Date.now()) return hit.url;
  try {
    const { data, error } = await supabase.storage.from(FILES_BUCKET).createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) return null;
    signed.set(path, { url: data.signedUrl, until: Date.now() + 50 * 60e3 });
    return data.signedUrl;
  } catch {
    return null;
  }
}

// ── The client's read-only link ───────────
// The link now in use, with its token (null: none; undefined: not there yet).
export async function loadShare(clientId) {
  const rows = await orNull(() => all(() => supabase.from('client_gantt_links').select(LINK_COLS)
    .eq('client_id', clientId).is('revoked_at', null).order('created_at', { ascending: false })));
  if (rows === null) return undefined;
  const active = rows.find((r) => new Date(r.expires_at) > new Date());
  if (!active) return null;
  const { data } = await supabase.rpc('gantt_link_token', { p_id: active.id });
  return { ...active, token: data || null };
}
export async function createShare(clientId) {
  const { data, error } = await supabase.rpc('gantt_link_create', { p_client: clientId });
  if (error) throw error;
  return { id: data.id, token: data.token, expires_at: data.expiresAt };
}
export async function revokeShare(id) {
  const { error } = await supabase.rpc('gantt_link_revoke', { p_id: id });
  if (error) throw error;
}
export const shareUrl = (token) => new URL(`../gantt.html?t=${encodeURIComponent(token)}`, import.meta.url).href;

// The client's view, by its token (anonymous): { state, client, entries }.
export async function loadShared(token) {
  const { data, error } = await supabase.rpc('get_gantt', { p_token: token });
  if (error) throw error;
  return data;
}

// ── Metricool ─────────────────────────────
// The owner's switch and the account's state for the office: { enabled, owner, canEdit,
// secrets, mapped, synced, failed, lastAt, lastError }. null: not for this person;
// undefined: not built yet (the migration is not applied) or not reachable.
export async function metricoolSettings() {
  try {
    const { data, error } = await supabase.rpc('metricool_settings');
    if (error) return undefined;
    return data && typeof data === 'object' ? data : null;
  } catch { return undefined; }
}
// The brands of the clients ({ id: { blogId, brand } }; undefined: no such columns yet).
export async function loadBrands(clientId = null) {
  let q = supabase.from('clients').select('id, metricool_blog_id, metricool_brand');
  q = clientId ? q.eq('id', clientId) : q.not('metricool_blog_id', 'is', null);
  const { data, error } = await q;
  if (error) return undefined;
  return Object.fromEntries((data || []).map((r) => [r.id, { blogId: r.metricool_blog_id || null, brand: r.metricool_brand || null }]));
}
// The last sync of the clients ({ id: { at, ok, error, stats } }; {} when none or not built).
export async function loadSyncs(clientId = null) {
  try {
    let q = supabase.from('client_gantt_sync').select('client_id, at, ok, error, stats');
    if (clientId) q = q.eq('client_id', clientId);
    const { data, error } = await q;
    if (error) return {};
    return Object.fromEntries((data || []).map((r) => [r.client_id, r]));
  } catch { return {}; }
}
// Through the edge function. The answer of a refusal is a short code (app/metricool-logic.js errorText).
async function callMetricool(action) {
  const { data, error } = await supabase.functions.invoke('metricool', { body: { action } });
  if (!error) return data;
  let code = 'server_error';
  try { code = (await error.context?.json?.())?.error || code; } catch { /* no body */ }
  throw Object.assign(new Error(code), { code });
}
// The account's brands: [{ id, label, networks }].
export const fetchBrands = async () => (await callMetricool('brands'))?.brands || [];
// "בדיקת חיבור" (the owner): { ok, account, brands } or { ok: false, error }.
export const checkMetricool = () => callMetricool('check');
// Connects a client to a brand (null: disconnects). Ilai or the owner; the database checks.
export async function setBrand(clientId, blogId, brand = null) {
  const { data, error } = await supabase.rpc('gantt_set_brand', { p_client: clientId, p_blog_id: blogId, p_brand: brand });
  if (error) throw error;
  return { blogId: data?.blogId || null, brand: data?.brand || null };
}
export async function setMetricoolEnabled(on) {
  const { data, error } = await supabase.rpc('metricool_set_enabled', { p_on: on });
  if (error) throw error;
  return data;
}
export { missingFunction };
