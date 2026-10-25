// The old system's signed documents of a client (public.legacy_contracts,
// 20261105100000_legacy_contracts.sql): the short columns for the client card's list,
// never the document or the signature. The office reads them; for anyone else, before the
// migration, or when the read fails, null (the card then shows no block).
import { supabase } from './supa.js';

export async function loadLegacyContracts(clientId) {
  try {
    const { data, error } = await supabase.from('legacy_contracts')
      .select('id, doc_type, doc_number, signer_name, signed_at, total_amount')
      .eq('client_id', clientId).order('signed_at', { ascending: false });
    if (error || !Array.isArray(data)) return null;
    return data;
  } catch { return null; }
}
