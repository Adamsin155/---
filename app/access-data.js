// The office's side of the client's logins form (app/access-logic.js), as data: the
// links of a client (never the token's hash or its Vault id: the database does not
// grant those columns), the token of a link that still waits (for whoever manages
// the links: the owner, Irit, Lior and Ofir), making a link and revoking one.
// supabase/migrations/20261008100000_client_access_form.sql.
import { supabase } from './supa.js';
import { accessUrl, waitingLink } from './access-logic.js';

export const LINK_COLS = 'id, client_id, created_at, created_by, expires_at, revoked_at, revoked_by, submitted_at, attempts, summary, client_note';
// Who makes, copies and revokes a link (can_manage_access_links() in the database decides).
export const LINK_MANAGERS = ['irit', 'lior', 'ofir'];
export const canManageAccessLinks = ({ me = null, scope = 'office', error = null } = {}) => !error && scope === 'office' && (me === null || LINK_MANAGERS.includes(me));
// Who sees a link's state and what the client chose (never a login): the office as the
// database knows it (is_office(): the owner, Irit, Lior, Ofir and Ilai, whose screens are his own work).
export const seesAccessLinks = ({ me = null, scope = 'office', error = null } = {}) => !error && (scope === 'office' || me === 'ilai');

// The table is missing until the migration is applied: the screens then show nothing of the form.
export const missingAccessLinks = (err) => err?.code === '42P01' || err?.code === 'PGRST205'
  || /client_access_links|access_link_|does not exist|Could not find/i.test(String(err?.message || err || ''));

// The links of one client or of several (null: all that the office sees), newest first.
// Returns null when the form is not set up in the database yet.
export async function loadAccessLinks(clientIds = null) {
  let q = supabase.from('client_access_links').select(LINK_COLS).order('created_at', { ascending: false }).limit(1000);
  if (typeof clientIds === 'string') q = q.eq('client_id', clientIds);
  else if (Array.isArray(clientIds)) q = q.in('client_id', clientIds);
  const { data, error } = await q;
  if (error) { if (missingAccessLinks(error)) return null; throw error; }
  return Array.isArray(data) ? data : null;
}

// The token of a link that can still be filled (null otherwise, or when this user may not copy it).
export async function accessLinkToken(id) {
  const { data, error } = await supabase.rpc('access_link_token', { p_id: id });
  return !error && typeof data === 'string' && data ? data : null;
}
// The address of the client's waiting link, to put in a message (null: none, or not for this user).
export async function waitingAccessUrl(links, base = location.href, now = new Date()) {
  const l = waitingLink(links || [], now);
  const token = l ? await accessLinkToken(l.id) : null;
  return token ? accessUrl(base, token) : null;
}

// A new link (the one that waits stops working). { id, token, expiresAt }.
export async function createAccessLink(clientId) {
  const { data, error } = await supabase.rpc('access_link_create', { p_client: clientId });
  if (error) throw error;
  if (!data?.token) throw new Error('the logins form is not set up yet');
  return data;
}
export async function revokeAccessLink(id) {
  const { error } = await supabase.rpc('access_link_revoke', { p_id: id });
  if (error) throw error;
}
// Why a link was not made, in the office's words.
export function createError(err) {
  const msg = String(err?.message || err || '');
  if (/not allowed/.test(msg)) return 'רק הבעלים, עירית, ליאור ואופיר יוצרים קישור.';
  if (/client not open/.test(msg)) return 'ללקוח שהסתיים אין טופס פרטי כניסה.';
  if (missingAccessLinks(err) || /not set up/.test(msg)) return 'טופס פרטי הכניסה עוד לא הוקם במסד הנתונים.';
  return 'הקישור לא נוצר. נסו שוב.';
}
