// Data for the production pages (editor.html, shoot.html). Row level security
// decides what each person reads (an editor: the clients they edit; Nirel: also
// every Natali client and her brief tasks; Eli: the shoots of the last 7 days to the
// next 30); these loaders only choose the columns. The client's own phone and the
// office's notes are never loaded here: the editors and Eli work with the business
// details from the characterization (plan §3, "ולא את הטלפון האישי של הלקוח";
// loaded with app/intake-data.js loadCharacterizations).
import { supabase } from './supa.js';
import { BUCKET, fileNameOf } from './files-logic.js';

const WORK_COLS = 'id, name, business, address, package_name, shoot_type, has_logo, editor, char_at, shoot_at, contract_end, status, links, deliverables, rounds, created_at, protocol_version';
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

// The logo files the office uploaded to the client's files (public.client_files, kind
// 'logo'; the newest live one per client). Whoever sees the client reads them, the
// assigned editor too (20261003110000_client_files.sql; tests/sql/live-run-fixes.test.mjs).
// {} when the table is not there yet or cannot be read: the logo link stays the fallback.
export async function loadLogoFiles(clientIds) {
  if (!clientIds.length) return {};
  const { data, error } = await supabase.from('client_files').select('id, client_id, label, storage_path, mime, created_at')
    .in('client_id', clientIds).eq('kind', 'logo').is('deleted_at', null).order('created_at', { ascending: false }).limit(500);
  if (error) return {};
  const out = {};
  for (const r of data || []) out[r.client_id] ||= r;
  return out;
}
// The scripts of a shoot day, for its photographer, read-only (package 1; docs/ops.md,
// section 37): one database function decides (public.shoot_scripts: Eli, and only a
// client whose shoot day is from yesterday to 30 days ahead; only those rounds).
// null: nothing to read for this client. Throws when the function is not there yet.
export async function loadShootScripts(clientId) {
  const { data, error } = await supabase.rpc('shoot_scripts', { p_client: clientId });
  if (error) throw error;
  return data || null;
}
// A link to download one file, signed for an hour (the bucket is private).
export async function signedDownload(path) {
  const name = fileNameOf(path);
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600, { download: name });
  if (error || !data?.signedUrl) throw error || new Error('no url');
  return { url: data.signedUrl, name };
}
