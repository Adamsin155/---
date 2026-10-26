// The old system's characterization of a client (public.legacy_characterizations,
// 20261109100000_legacy_characterizations.sql). Every member of staff reads it (the owner,
// 26.10.2026), the sales agents do not. Before the migration, or when the read fails: null
// (or no rows), and the screens show no block.
import { supabase } from './supa.js';

const COLS = 'client_id, filled_text, filled_at, brief_text, brief_at, script_text, script_at, summary_text, answers';

export async function loadLegacyChar(clientId) {
  if (!clientId) return null;
  try {
    const { data, error } = await supabase.from('legacy_characterizations').select(COLS).eq('client_id', clientId).limit(1);
    if (error || !Array.isArray(data)) return null;
    return data[0] || null;
  } catch { return null; }
}

// Several clients at once (the editors' page): { client_id → row }.
export async function loadLegacyChars(ids) {
  if (!ids?.length) return {};
  try {
    const { data, error } = await supabase.from('legacy_characterizations').select(COLS).in('client_id', ids);
    if (error || !Array.isArray(data)) return {};
    return Object.fromEntries(data.map((r) => [r.client_id, r]));
  } catch { return {}; }
}
