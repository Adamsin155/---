// A token the OAuth server gave a connected app (a Claude account; docs/ops.md, section 84) carries the
// claim `client_id`. Such a token is for the mcp function alone: every other function that takes a
// user's token refuses it with one line, before anything else.
//   if (isOAuthToken(req.headers.get('authorization'))) return json(403, { error: 'not_allowed' });
// This reads the claim without checking the signature, on purpose: it can only refuse. A forged token
// without the claim still has to pass the function's own check, as before. Anything that is not
// a token with that claim (no header, garbage, a browser session) is simply not one.
export function isOAuthToken(header) {
  try {
    const m = /^Bearer\s+\S+$/i.test(String(header ?? '').trim()) ? String(header).trim().split(/\s+/)[1] : '';
    const part = m.split('.')[1];
    if (!part) return false;
    const bin = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    return typeof claims?.client_id === 'string' && claims.client_id !== '';
  } catch {
    return false;
  }
}
