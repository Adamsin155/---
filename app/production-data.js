// Data for the production pages (editor.html, shoot.html). Row level security
// decides what each person reads (an editor: the clients they edit; Nirel: also
// every Natali client and her brief tasks; Eli: the shoots of the last 7 days to the
// next 30); these loaders only choose the columns. The client's own phone and the
// office's notes are never loaded here: the editors and Eli work with the business
// details from the characterization (plan §3, "ולא את הטלפון האישי של הלקוח").
import { supabase } from './supa.js';

const WORK_COLS = 'id, name, business, address, package_name, shoot_type, has_logo, editor, char_at, shoot_at, contract_end, status, links, deliverables, rounds, created_at';
const TASK_COLS = 'id, client_id, title, owner, due_on, done_at, done_by_email, created_by_email, created_at, source, brief, urgent, started_at';

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

export async function loadWorkClients() {
  return all(() => supabase.from('clients').select(WORK_COLS)
    .in('status', ['active', 'ending']).order('shoot_at', { ascending: true, nullsFirst: false }));
}

// The characterization of each client (address, business phone, logo link…), when
// the characterization form has saved one (public.characterizations). Without the
// table, or without access, there is nothing: the page asks to report what is missing.
export async function loadCharacterizations(ids) {
  if (!ids.length) return {};
  const { data, error } = await supabase.from('characterizations').select('client_id, fields').in('client_id', ids);
  if (error || !Array.isArray(data)) return {};
  return Object.fromEntries(data.map((r) => [r.client_id, r]));
}

// Tasks with how they ended (client_tasks.result, migration 20260930140000). Before
// that migration: without it.
export async function loadMyTasks(person) {
  const read = (cols) => all(() => supabase.from('client_tasks').select(cols).eq('owner', person).is('done_at', null).order('created_at', { ascending: true }));
  try {
    return await read(`${TASK_COLS}, result`);
  } catch (err) {
    if (err?.code !== '42703') throw err;
    return read(TASK_COLS);
  }
}
// Open tasks on the given clients (the editing pause tasks to close on resume).
export async function loadOpenTasksOf(clientIds) {
  if (!clientIds.length) return [];
  return all(() => supabase.from('client_tasks').select(TASK_COLS).in('client_id', clientIds).is('done_at', null).order('created_at'));
}

// Finishing a task with its result; the database stamps who and when.
export async function finishTask(id, result) {
  const { data, error } = await supabase.from('client_tasks')
    .update({ result, done_at: new Date().toISOString() }).eq('id', id).select(TASK_COLS).single();
  if (error) throw error;
  return data;
}
