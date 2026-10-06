// Data for the office's screens (qa.html, pass.html, decisions.html and Ilai's
// part of "המשימות שלי"). Row level security decides who reads and writes
// (supabase/migrations/20260930150000_office_flows.sql): the pass and the change
// requests are the office's; a decision on an exception is read with its client.
// Who and when are stamped by the database. Until that migration is applied, the
// new tables are missing: each loader then returns null and its screen says so.
import { supabase } from './supa.js';

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
// A table the database does not have yet (its migration not applied): null, not an error.
const missing = (err) => err?.code === '42P01' || err?.code === 'PGRST205' || /does not exist|Could not find the table/i.test(String(err?.message || ''));
async function optional(fn) {
  try { return await fn(); } catch (err) { if (missing(err)) return null; throw err; }
}

// ── The pass over the clients (33) ──────────
const PASS_COLS = 'day, seen, snapshot, completed_at, by_email, at, updated_by, updated_at';
export const loadPasses = (sinceDay) => optional(() => all(() => supabase.from('office_passes').select(PASS_COLS).gte('day', sinceDay).order('day', { ascending: false })));
export async function savePass(row) {
  const { data, error } = await supabase.from('office_passes').upsert(row, { onConflict: 'day' }).select(PASS_COLS).single();
  if (error) throw error;
  return data;
}

// ── Lior's decisions on exceptions ──────────
const DEC_COLS = 'task_id, client_id, reason, decision, next_task_id, by_email, at';
export const loadDecisions = () => optional(() => all(() => supabase.from('task_decisions').select(DEC_COLS).order('at', { ascending: false })));
export async function saveDecision(row) {
  const { data, error } = await supabase.from('task_decisions').upsert(row, { onConflict: 'task_id' }).select(DEC_COLS).single();
  if (error) throw error;
  return data;
}

// ── Change requests ─────────────────────────
const CR_COLS = 'id, client_id, problem, why, proposal, created_by_email, created_at, decision, decided_by_email, decided_at';
export const loadChangeRequests = () => optional(() => all(() => supabase.from('change_requests').select(CR_COLS).order('created_at', { ascending: false })));
export async function addChangeRequest(row) {
  const { data, error } = await supabase.from('change_requests').insert(row).select(CR_COLS).single();
  if (error) throw error;
  return data;
}
export async function decideChangeRequest(id, decision) {
  const { data, error } = await supabase.from('change_requests').update({ decision }).eq('id', id).select(CR_COLS).single();
  if (error) throw error;
  return data;
}

// ── Tasks ───────────────────────────────────
const TASK_COLS = 'id, client_id, title, owner, due_on, done_at, done_by_email, created_by_email, created_at, source, brief, urgent, started_at';
// Tasks someone opened (open, and finished since a moment): "משימות שפתחתי".
export async function loadTasksBy(email, sinceIso) {
  return all(() => supabase.from('client_tasks').select(TASK_COLS).eq('created_by_email', String(email || '').toLowerCase())
    .or(`done_at.is.null,done_at.gte."${sinceIso}"`).order('created_at', { ascending: false }));
}
export async function updateTask(id, fields) {
  const { data, error } = await supabase.from('client_tasks').update(fields).eq('id', id).select(TASK_COLS).single();
  if (error) throw error;
  return data;
}

// The agreement's selection of the clients opened from one (a joint Natali and Semyon day).
export async function loadSelections(quoteIds) {
  const list = [...new Set(quoteIds.filter(Boolean))];
  if (!list.length) return new Map();
  const { data, error } = await supabase.from('quotes').select('id, selection:model->selection').in('id', list);
  if (error) return new Map();
  return new Map(data.map((q) => [q.id, q.selection]));
}

// The logins of the clients (network, status, when; never a password), for Ilai's
// check and Lior's broken logins. Vault users only (the database decides).
export async function loadAccessRows(clientIds = null) {
  return all(() => {
    let q = supabase.from('client_access').select('id, client_id, network, label, username, status, note, updated_by, updated_at').order('client_id');
    if (clientIds) q = q.in('client_id', clientIds);
    return q;
  });
}

// The status of each login for the office's own work (Ilai's access check, process 6):
// the client, the network, the label, the status and when it was set, never a user
// name or a password, and without the vault flag (access_status_for_work, migration
// 20261006100000). Before that migration: the vault's rows, as before (empty for
// whoever has no vault flag).
// Since 20261008100000_client_access_form.sql each row also says `by_client`: the
// client's form set it and nobody of the office saved it since (access_work_statuses).
export async function loadAccessStatusForWork(clientIds = null) {
  const now = await supabase.rpc('access_work_statuses', { p_clients: clientIds });
  if (!now.error && Array.isArray(now.data)) return now.data;
  const { data, error } = await supabase.rpc('access_status_for_work', { p_clients: clientIds });
  if (!error && Array.isArray(data)) return data;
  // The fallback answers nothing to whoever has no vault flag: `viaVault` tells the
  // card that an empty list may only mean "not allowed", not "no logins".
  return Object.assign(await loadAccessRows(clientIds), { viaVault: true });
}

// Ofir's characterization meetings (times only, never a client), for those waiting
// for his check who do not see his other clients: [[start, end], …] in ms. Null
// until the migration is applied.
export async function loadOfirMeetings(sinceIso) {
  const { data, error } = await supabase.rpc('ofir_meetings', { p_since: sinceIso });
  if (error) return null;
  return (data || []).map((r) => [new Date(r.starts_at).getTime(), new Date(r.ends_at).getTime()]);
}
