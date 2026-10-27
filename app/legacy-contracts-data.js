// The old system's documents of a client (public.legacy_contracts,
// 20261105100000_legacy_contracts.sql; their state since 20261110100000_batch_2710.sql):
// the short columns for the client card's list, never the document or the signature. The
// office reads them; for anyone else, before the migration, or when the read fails, null
// (the card then shows no block). Before the state's migration the list is read without it
// (every row then is a signed one).
import { supabase } from './supa.js';

const COLS = 'id, doc_type, doc_number, signer_name, signed_at, total_amount';

export async function loadLegacyContracts(clientId) {
  const read = (cols) => supabase.from('legacy_contracts').select(cols)
    .eq('client_id', clientId).order('signed_at', { ascending: false });
  try {
    let { data, error } = await read(`${COLS}, status`);
    if (error && /status/.test(String(error.message || ''))) ({ data, error } = await read(COLS));
    if (error || !Array.isArray(data)) return null;
    return data;
  } catch { return null; }
}
