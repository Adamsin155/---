// The Metricool line of the client card (the owner, 20.10.2026), near the content
// Gantt's chip: "מחובר ל־<מותג>", "לא מחובר" (with the way to connect, on the client's
// Gantt, for Ilai and the owner: gantt.html's "חיבור למותג ב־Metricool"), and "N פרסומים
// נכשלו" (the Gantt's entries in the state 'error'). For Ilai, the owners and the office.
// The brand columns and the Gantt are the Gantt's (app/gantt-data.js, read only here);
// before their migrations the line is not shown. docs/ops.md, section 27.
import { supabase } from './supa.js';
import { loadBrands, loadNoBrand } from './gantt-data.js';

// Who sees the line: the office (the owners, Irit, Lior, Ofir) and Ilai.
export const seesMetricool = ({ me = null, scope = 'own', error = null } = {}) => !error && (scope === 'office' || me === 'ilai');
// Who connects a brand (public.gantt_set_brand): Ilai and the owner.
export const connectsMetricool = ({ me = null, scope = 'own', error = null } = {}) => !error && (me === 'ilai' || (me === null && scope === 'office'));

// The words of the line. `brand` undefined: the columns are not there yet (no line).
// { text, tone ('ok' | 'warn' | 'plain'), failed (words or null), connect (bool) }
export function metricoolWords({ brand, none = false, failed = 0 } = {}) {
  if (brand === undefined) return null;
  const fail = failed > 0 ? (failed === 1 ? 'פרסום אחד נכשל' : `${failed} פרסומים נכשלו`) : null;
  if (brand?.blogId) return { text: `מחובר ל־${brand.brand || 'מותג'}`, tone: fail ? 'warn' : 'ok', failed: fail, connect: false };
  if (none) return { text: 'סומן שאין ללקוח מותג', tone: 'plain', failed: fail, connect: false };
  return { text: 'לא מחובר', tone: 'warn', failed: fail, connect: true };
}

// The client's brand, the "no brand" mark and how many of its Gantt's entries failed.
export async function loadMetricool(clientId) {
  const [brands, none, failed] = await Promise.all([
    loadBrands(clientId).catch(() => undefined),
    loadNoBrand(clientId),
    countFailed(clientId),
  ]);
  return { brand: brands === undefined ? undefined : brands[clientId] || { blogId: null, brand: null }, none, failed };
}
async function countFailed(clientId) {
  try {
    const { data, error } = await supabase.from('client_gantt').select('id').eq('client_id', clientId).eq('state', 'error').limit(500);
    return error ? 0 : (data || []).length;
  } catch { return 0; }
}
