// Sends one message through Meta's WhatsApp Cloud API (stage 4). Hand-written
// (not a copy of app/), no Deno APIs: the caller passes `fetch`, so the reminders
// function, the whatsapp-webhook function and the node tests share it.
// The access token goes only into the Authorization header: it is never logged
// and never part of a returned error (errors carry the HTTP status and Meta's code).
export const GRAPH_VERSION = 'v23.0'; // Meta keeps a version about two years; docs/ops.md says when to move on
export const graphUrl = (phoneNumberId) => `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;

/** @returns {Promise<{ ok: true, id: string } | { ok: false, status: number, error: string }>} */
export async function graphSend({ fetch, token, phoneNumberId, message, timeoutMs = 10000 }) {
  if (!/^\d{5,30}$/.test(String(phoneNumberId || '')) || !token) return { ok: false, status: 0, error: 'not_configured' };
  let res;
  try {
    res = await fetch(graphUrl(phoneNumberId), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
      signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined,
    });
  } catch (err) {
    return { ok: false, status: 0, error: err?.name === 'TimeoutError' ? 'timeout' : 'network' };
  }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  const id = data?.messages?.[0]?.id;
  if (res.ok && typeof id === 'string' && id.length <= 200) return { ok: true, id };
  const code = Number.isInteger(data?.error?.code) ? ` #${data.error.code}` : '';
  return { ok: false, status: res.status, error: `graph ${res.status}${code}` };
}
