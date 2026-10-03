// Data for the content Gantt (gantt.html). Row level security decides who reads and
// writes (supabase/migrations/20261003130000_content_gantt.sql): the office (Ilai
// too) writes, whoever sees the client reads. Who and when are stamped by the
// database. Until that migration is applied the plan reads as null ("not there yet")
// and the page says so. The client's files (public.client_files, the files'
// migration) are read the same way: null until that table is there.
import { supabase } from './supa.js';
import { isMissingTable } from './year-data.js';

export const GANTT_COLS = 'id, client_id, key, kind, title, day, time_il, month, num, internal, state, posted_on, file_id, link, note, edited, template_version, by_email, at';
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

// The client's plan, by day (null: the table is not there yet).
export const loadGantt = (clientId) => orNull(() => all(() => supabase.from('client_gantt').select(GANTT_COLS)
  .eq('client_id', clientId).order('day').order('key')));

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
  const { data, error } = await supabase.from('client_gantt').update(fields).eq('id', id).select(GANTT_COLS).single();
  if (error) throw error;
  return data;
}
export async function addEntry(row) {
  const { data, error } = await supabase.from('client_gantt').insert(row).select(GANTT_COLS).single();
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
