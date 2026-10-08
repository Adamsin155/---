// The two links only Irit sends to the client, in one press from her own list
// (protocol v8: 5ב the logins form, 7א the status page; docs/ops.md, section 49). Until
// now each was made and copied inside the client card. The press here does the same
// thing with the same functions: it finds the client's link that still works, makes one
// when there is none, and copies the ready message with the link in it.
//   access  public.access_link_create / access_link_token (app/access-data.js)
//   status  public.status_link_create / status_link_token (app/status-link-ui.js)
// Nothing is kept here: the link's own tables are the source, as in the card.
import { supabase } from './supa.js';
import { accessUrl, accessLinkMessage, linkState, waitingLink } from './access-logic.js';
import { loadAccessLinks, accessLinkToken, createAccessLink, createError } from './access-data.js';
import { statusUrl, statusLinkMessage } from './status-logic.js';

export const LINK_KINDS = {
  access: { button: 'העתקת הקישור', what: 'הקישור לטופס פרטי הכניסה' },
  status: { button: 'העתקת הקישור', what: 'הקישור לדף הסטטוס' },
};

// → { url, message, made (a new link was made now), filled (the client already filled the form) }
async function accessLink(client, base, now) {
  const links = await loadAccessLinks(client.id);
  if (links === null) throw new Error('טופס פרטי הכניסה עוד לא הוקם במסד הנתונים.');
  const waiting = waitingLink(links, now);
  let token = waiting ? await accessLinkToken(waiting.id) : null;
  let made = false;
  if (!token) {
    // The client already filled it and nothing waits: the step is done; no new link is made by a copy.
    if (links.some((l) => linkState(l, now) === 'filled')) return { url: null, message: null, made: false, filled: true };
    try { token = (await createAccessLink(client.id)).token; } catch (err) { throw new Error(createError(err)); }
    made = true;
  }
  const url = accessUrl(base, token);
  return { url, message: accessLinkMessage(client, url), made, filled: false };
}

async function statusLink(client, base, now) {
  const read = async () => {
    const { data, error } = await supabase.from('client_status_links').select('id, created_at, expires_at, revoked_at').eq('client_id', client.id).order('created_at', { ascending: false }).limit(20);
    if (error) throw new Error('לא הצלחנו לקרוא את הקישור לדף הסטטוס.');
    return (data || []).find((l) => !l.revoked_at && new Date(l.expires_at) > now) || null;
  };
  const tokenOf = async (l) => {
    const { data, error } = await supabase.rpc('status_link_token', { p_id: l.id });
    return !error && typeof data === 'string' && data ? data : null;
  };
  let active = await read();
  let token = active ? await tokenOf(active) : null;
  let made = false;
  if (!token) {
    const { error } = await supabase.rpc('status_link_create', { p_client: client.id });
    if (error) throw new Error(/not allowed/.test(error.message) ? 'רק עירית, ליאור והבעלים יוצרים את הקישור.' : /client not open/.test(error.message) ? 'ללקוח שהסתיים אין דף סטטוס.' : 'הקישור לא נוצר. נסו שוב.');
    made = true;
    active = await read();
    token = active ? await tokenOf(active) : null;
    if (!token) throw new Error('הקישור נוצר, אבל לא הצלחנו לקרוא אותו. פתחו את כרטיס הלקוח.');
  }
  const url = statusUrl(base, token);
  return { url, message: statusLinkMessage(client, url), made, filled: false };
}

export const clientLink = (kind, client, { base = location.href, now = new Date() } = {}) => (kind === 'access' ? accessLink(client, base, now) : statusLink(client, base, now));

// Copies the ready message. The clipboard is asked for inside the press itself (Safari
// refuses it after a wait), with the text as a promise; where that is not there, the
// text is written once it is known. → { ok, copied, made, filled, message, error }
export async function copyClientLink(kind, client, opts = {}) {
  const getting = clientLink(kind, client, opts);
  const out = { ok: false, copied: false, made: false, filled: false, message: null, error: null };
  const text = getting.then((r) => { if (!r.message) throw new Error('no link'); return r.message; });
  let wrote = null;
  try {
    if (navigator.clipboard?.write && typeof window.ClipboardItem === 'function') {
      wrote = navigator.clipboard.write([new window.ClipboardItem({ 'text/plain': text.then((t) => new Blob([t], { type: 'text/plain' })) })]);
      wrote.catch(() => {});
    }
  } catch { wrote = null; }
  text.catch(() => {});
  let r;
  try { r = await getting; } catch (err) { return { ...out, error: err?.message || 'הקישור לא נוצר. נסו שוב.' }; }
  Object.assign(out, { ok: true, made: r.made, filled: r.filled, message: r.message });
  if (r.filled) return out;
  if (wrote) { try { await wrote; out.copied = true; } catch { /* tried below */ } }
  if (!out.copied) { try { await navigator.clipboard.writeText(r.message); out.copied = true; } catch { /* shown for a manual copy */ } }
  return out;
}
