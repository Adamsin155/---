// Data for Gal's screen (bookkeeper.html; docs/ops.md, section 137). One function of the database
// (supabase/migrations/20261215100000_bookkeeper_gal.sql) and nothing else: she reads no table.
// Until the migration is in, the function is missing: `null`, and the page says so.
import { supabase } from './supa.js';

const missing = (error, status) => status === 404 || ['PGRST202', '42883'].includes(error?.code);

// [{ contact_name, business, company_id, phone, email, status, monthly_agorot, total_agorot, months, source, why }],
// or null before the migration.
export async function loadBookkeeperClients() {
  const { data, error, status } = await supabase.rpc('bookkeeper_clients');
  if (error) { if (missing(error, status)) return null; throw error; }
  return data || [];
}
