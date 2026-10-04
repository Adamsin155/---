// The manager's data (supabase/migrations/20261003140000_manager_features.sql): the
// prices of the agreements (the managers only; anyone else gets no rows), the files
// uploaded as deliverables (public.client_files, when it exists), and the archive
// (the owner and Ofir). The database checks who calls; this only asks.
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
const byClient = (rows) => Object.fromEntries((rows || []).map((r) => [r.client_id, r]));

// The prices, by client id. null when the function is missing or refused (the table
// then shows no price columns' values, never someone else's).
export async function loadFinance() {
  const { data, error } = await supabase.rpc('manager_client_finance');
  if (error) return null;
  return byClient(data);
}

// Deliverables uploaded as files, by client id: [{ client_id, kind }]. The table is
// another module's (public.client_files); without it, or without access, null.
export async function loadDeliverableFiles(clientId = null) {
  try {
    const rows = await all(() => {
      let q = supabase.from('client_files').select('client_id, kind').like('kind', 'deliverable_%').is('deleted_at', null).order('client_id');
      if (clientId) q = q.eq('client_id', clientId);
      return q;
    });
    return rows;
  } catch {
    return null;
  }
}

// ── The archive (the owner and Ofir) ─────────
async function call(fn, args) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data;
}
export const archiveClient = (id) => call('archive_client', { p_client: id });
export const restoreClient = (id) => call('restore_client', { p_client: id });
export const purgeClient = (id, confirm) => call('purge_client', { p_client: id, p_confirm: confirm });
export async function loadArchived() {
  return (await call('archived_clients', {})) || [];
}
