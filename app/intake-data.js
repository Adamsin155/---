// Data for the intake screens (intake.html, prep.html) and the client card: the
// characterization as content, the focus call's answers, and client requests.
// Row level security decides what each person reads and writes
// (supabase/migrations/20260930160000_intake.sql): whoever sees a client reads its
// characterization and focus call; only the office writes them. Who saved and when
// are stamped by the database.
import { supabase } from './supa.js';

const CHAR_COLS = 'client_id, fields, completed_at, completed_by, by_email, at';
const BRIEF_COLS = 'client_id, round, fields, by_email, at';
const TASK_COLS = 'id, client_id, title, owner, due_on, done_at, done_by_email, created_by_email, created_at, source, brief, urgent, started_at';

// Until the migration is applied the tables are missing: the screens work without
// them (nothing saved yet) and say so where it matters.
export const missingTable = (err) => err?.code === '42P01' || err?.code === 'PGRST205' || /does not exist|Could not find the table/i.test(String(err?.message || ''));

export async function loadCharacterization(clientId) {
  const { data, error } = await supabase.from('characterizations').select(CHAR_COLS).eq('client_id', clientId).maybeSingle();
  if (error) throw error;
  return data;
}

// The characterizations and focus calls of several clients at once (the editors'
// page): only the content, not who saved it. Without the table (before the
// migration) or without access: nothing, and the page says what is missing.
export async function loadCharacterizations(ids) {
  if (!ids.length) return {};
  const { data, error } = await supabase.from('characterizations').select('client_id, fields').in('client_id', ids);
  if (error || !Array.isArray(data)) return {};
  return Object.fromEntries(data.map((r) => [r.client_id, r]));
}
// { clientId: { round: row } }
export async function loadBriefsOf(ids) {
  if (!ids.length) return {};
  const { data, error } = await supabase.from('content_briefs').select('client_id, round, fields').in('client_id', ids);
  if (error || !Array.isArray(data)) return {};
  const out = {};
  for (const r of data) (out[r.client_id] ||= {})[r.round] = r;
  return out;
}

// Saves the fields (merging is the caller's); `complete` stamps the first completion.
export async function saveCharacterization(clientId, fields, complete) {
  const row = { client_id: clientId, fields, completed_at: complete ? new Date().toISOString() : null };
  const { data, error } = await supabase.from('characterizations').upsert(row, { onConflict: 'client_id' }).select(CHAR_COLS).single();
  if (error) throw error;
  return data;
}

export async function loadBriefs(clientId) {
  const { data, error } = await supabase.from('content_briefs').select(BRIEF_COLS).eq('client_id', clientId).order('round');
  if (error) throw error;
  return data;
}

export async function saveBrief(clientId, round, fields) {
  const { data, error } = await supabase.from('content_briefs')
    .upsert({ client_id: clientId, round, fields }, { onConflict: 'client_id,round' }).select(BRIEF_COLS).single();
  if (error) throw error;
  return data;
}

// Client requests and the tasks that tell Irit to update the client: the open ones,
// and those finished in the last `days` days (to show what was just done).
export async function loadRequestTasks(days = 14) {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const { data, error } = await supabase.from('client_tasks').select(TASK_COLS)
    .in('source', ['request', 'tell']).or(`done_at.is.null,done_at.gte.${since}`).order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

// A new task (the database stamps who opened it and when).
export async function insertTask(task) {
  const { data, error } = await supabase.from('client_tasks').insert(task).select(TASK_COLS).single();
  if (error) throw error;
  return data;
}

// The vault's statuses of every client (no user names, no passwords): broken logins
// are shoot-day blockers. Row level security returns only the clients whose vault
// one may use; without it, nothing (the blockers then just leave access out).
export async function loadAccessStatuses() {
  const { data, error } = await supabase.from('client_access').select('id, client_id, network, status, updated_at').neq('status', 'ok');
  if (error) return [];
  return data;
}
