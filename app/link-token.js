// The secret of a public page's link (the quote, the status page, the gallery, the
// scripts, the client's Gantt). Since 6.10.2026 the office's links carry it in the
// address's fragment, "page.html#t=<token>": a browser never sends a fragment to the
// server that hosts the page, nor in a Referer, so the secret reaches no log of the
// host. A link sent before that ("page.html?t=<token>") keeps working: both are read,
// the fragment first. The same reading as tokenFrom() in app/access-logic.js (the
// logins form, which has its own copy so that its page loads nothing else).
export function tokenFrom({ hash = '', search = '' } = {}) {
  const fromHash = new URLSearchParams(String(hash).replace(/^#/, '')).get('t');
  return fromHash || new URLSearchParams(String(search)).get('t') || '';
}

// A link to `page` with the token in the fragment.
export const tokenUrl = (page, base, token) => `${new URL(page, base).href}#t=${encodeURIComponent(token)}`;

// The token of this page. The fragment is not cleared from the address bar: a reload,
// or the phone bringing the tab back, must still open the page. Jumping to a part of
// the page ("#approvals") replaces the fragment, so the token is also remembered for
// this tab only (sessionStorage, gone when the tab closes) and used when the address
// no longer carries one.
const keyOf = (loc) => `link-token:${String(loc?.pathname || '')}`;
export function pageToken(loc = globalThis.location, store = safeSession()) {
  const token = tokenFrom(loc || {});
  try {
    if (token) store?.setItem(keyOf(loc), token);
    else return store?.getItem(keyOf(loc)) || '';
  } catch { /* no storage: the address is all there is */ }
  return token;
}
function safeSession() {
  try { return globalThis.sessionStorage; } catch { return null; }
}
