// Data for the scripts page (scripts.html). The database decides who reads and
// writes (supabase/migrations/20261003120000_scripts.sql): Lior and the owner, and
// whoever they granted the client to; "approved" only Lior and the owner. Who and
// when, and the version of each script, are stamped by the database.
import { supabase } from './supa.js';

const COLS = 'client_id, round, n, title, body, links, status, version, by_email, at';
const LINK_COLS = 'id, created_at, created_by, expires_at, revoked_at, revoked_by';

// Before the migration: the page says the scripts are not set up yet.
export const missingSetup = (err) => err?.code === '42P01' || err?.code === 'PGRST205' || err?.code === 'PGRST202' || err?.code === '42883'
  || /does not exist|Could not find the (table|function)/i.test(String(err?.message || ''));
// A refusal (row level security, no grant any more, "approved" by someone else):
// trying again will not help.
const refused = (err) => err?.code === '42501' || /row-level security|permission denied|only Lior/i.test(String(err?.message || ''));
// No answer at all (the network): worth trying again.
const offline = (err) => !err?.code && /fetch|network|Load failed|timeout/i.test(String(err?.message || err || ''));

// The client as this page needs it (null: no access): name, business, the package's
// video count, the shoot rounds, and whether this person manages (Lior, the owner).
export async function loadScriptsClient(id) {
  const { data, error } = await supabase.rpc('scripts_client', { p_client: id });
  if (error) throw error;
  return data || null;
}

// Whether this person may write the client's scripts (a grant, for the client card).
// False on any error, also before the migration.
export async function canWriteScripts(clientId) {
  const { data, error } = await supabase.rpc('can_write_scripts', { p_client: clientId });
  return !error && data === true;
}

export async function loadScripts(clientId) {
  const { data, error } = await supabase.from('client_scripts').select(COLS).eq('client_id', clientId).order('round').order('n');
  if (error) throw error;
  return data;
}
async function loadOne(clientId, round, n) {
  const { data, error } = await supabase.from('client_scripts').select(COLS).eq('client_id', clientId).eq('round', round).eq('n', n).maybeSingle();
  if (error) throw error;
  return data;
}

// Saves one script. `version`: the version this text was written on (null: never
// saved). A save made meanwhile from another device makes the write miss: then the
// row as it is now comes back as `err.current` with `err.conflict`, unless it already
// holds exactly this text (a retry of a write whose answer was lost: that is a save).
// Network errors are thrown as they are (the queue tries again); a refusal is `fatal`.
export async function saveScript(clientId, round, n, content, version, same) {
  const fields = { title: content.title, body: content.body, links: content.links, status: content.status };
  const { data, error } = version == null
    ? await supabase.from('client_scripts').insert({ client_id: clientId, round, n, ...fields }).select(COLS)
    : await supabase.from('client_scripts').update(fields).eq('client_id', clientId).eq('round', round).eq('n', n).eq('version', version).select(COLS);
  if (error && error.code !== '23505') {
    if (offline(error)) throw error;
    throw Object.assign(new Error(error.message), { fatal: true, code: error.code, refused: refused(error) });
  }
  if (!error && data?.length) return data[0];
  // Missed: another device saved first (or the row was created there).
  const current = await loadOne(clientId, round, n);
  if (!current) throw Object.assign(new Error('gone'), { fatal: true });
  if (same(current)) return current;
  throw Object.assign(new Error('conflict'), { conflict: true, current });
}

// ── Access for other staff ────────────────
export async function loadGrants(clientId) {
  const { data, error } = await supabase.from('script_grants').select('person, granted_by, at').eq('client_id', clientId).order('at');
  if (error) throw error;
  return data;
}
export async function setGrant(clientId, person, on) {
  const { error } = await supabase.rpc('scripts_grant', { p_client: clientId, p_person: person, p_on: on });
  if (error) throw error;
}

// ── The share link ────────────────────────
// { active, token, last }: the link that works now (and its token, for Lior and the
// owner), or the last one that stopped.
export async function loadShare(clientId) {
  const { data, error } = await supabase.from('script_share_links').select(LINK_COLS).eq('client_id', clientId).order('created_at', { ascending: false }).limit(10);
  if (error) throw error;
  const active = data.find((l) => !l.revoked_at && new Date(l.expires_at) > new Date()) || null;
  let token = null;
  if (active) {
    const r = await supabase.rpc('scripts_share_token', { p_id: active.id });
    if (!r.error) token = r.data || null;
  }
  return { active, token, last: data[0] || null };
}
export async function createShare(clientId) {
  const { data, error } = await supabase.rpc('scripts_share_create', { p_client: clientId });
  if (error) throw error;
  return data;
}
export async function revokeShare(id) {
  const { error } = await supabase.rpc('scripts_share_revoke', { p_id: id });
  if (error) throw error;
}
