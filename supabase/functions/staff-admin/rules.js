// The rules of the staff-admin function (team.html → "צוות וכניסות"), kept free of
// Deno APIs so node can test them (tests/staff-admin.test.mjs) and the function can
// import them. Who may do what:
//  - The owner (staff.person is null): everything.
//  - Irit and Lior (TEAM_MANAGERS): list the team, add a staff row for someone who
//    is not a manager, and make sign-in links for anyone but the owner.
//  - Only the owner sets the vault flag, removes a row, or creates or changes the
//    owner's row or a manager's row (a manager can make links for others, so that
//    power is granted by the owner alone).

// Keep in step with STAFF_PEOPLE in app/protocol.js and TEAM_MANAGERS in
// app/team-rules.js (the unit tests compare them). A copy, because the deployed
// function cannot import files from outside its folder.
export const PERSONS = ['irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli'];
export const TEAM_MANAGERS = ['irit', 'lior'];

// Pages a sign-in link may open. The link is only for the office's own site.
export const LINK_PAGES = ['https://adamsin155.github.io/---/clients.html', 'https://app.astrateg.com/clients.html'];
export const SITE_ORIGINS = ['https://adamsin155.github.io', 'https://app.astrateg.com'];

// Error codes (the page turns them into Hebrew).
export const ERR = {
  notSignedIn: 'not_signed_in',
  notAllowed: 'not_allowed',
  ownerOnly: 'owner_only',
  badRequest: 'bad_request',
  unknownAction: 'unknown_action',
  badEmail: 'bad_email',
  badPerson: 'bad_person',
  badRedirect: 'bad_redirect',
  personTaken: 'person_taken',
  ownRole: 'own_role',
  cannotRemoveSelf: 'cannot_remove_self',
  notFound: 'not_found',
  notStaff: 'not_staff',
  tooSoon: 'too_soon',
  linkFailed: 'link_failed',
  server: 'server_error',
};

const fail = (status, error) => ({ ok: false, status, error });

// A clean, lower-case email, or null when it is not one.
export function normEmail(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v || v.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return null;
  return v;
}

export const isOwnerRow = (row) => !!row && (row.person === null || row.person === undefined);
export const isManagerRow = (row) => isOwnerRow(row) || TEAM_MANAGERS.includes(row?.person);

// 'owner', 'manager' or null (not allowed to use the function at all).
export function roleOf(row) {
  if (!row) return null;
  if (isOwnerRow(row)) return 'owner';
  return TEAM_MANAGERS.includes(row.person) ? 'manager' : null;
}

// The Authorization header's token, or null.
export function bearer(header) {
  const m = /^Bearer\s+(\S+)$/i.exec(String(header || '').trim());
  return m ? m[1] : null;
}

// The link page to use when it is on the allowlist (exact address, no query or
// fragment); any port on localhost for local testing. Null otherwise.
export function allowedRedirect(value) {
  let u;
  try { u = new URL(String(value ?? '')); } catch { return null; }
  if (u.username || u.password || u.search || u.hash) return null;
  if (LINK_PAGES.includes(u.href)) return u.href;
  if (u.protocol === 'http:' && u.hostname === 'localhost' && u.pathname === '/clients.html') return u.href;
  return null;
}

export function allowedOrigin(origin) {
  if (!origin) return null;
  if (SITE_ORIGINS.includes(origin)) return origin;
  try {
    const u = new URL(origin);
    if (u.protocol === 'http:' && u.hostname === 'localhost' && u.origin === origin) return origin;
  } catch { /* not a URL */ }
  return null;
}

export function corsHeaders(origin, requested) {
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': /^[\w\s,-]{1,400}$/.test(requested || '') ? requested : 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
  const ok = allowedOrigin(origin);
  if (ok) headers['Access-Control-Allow-Origin'] = ok;
  return headers;
}

// Add or change a staff row. `input` is the request body: { email, person?, vault? };
// `personTaken` says whether another row already has that person.
export function planUpsert({ role, callerEmail, existing, input, personTaken = false }) {
  const email = normEmail(input?.email);
  if (!email) return fail(400, ERR.badEmail);
  const hasPerson = Object.prototype.hasOwnProperty.call(input, 'person');
  const person = hasPerson ? (input.person ?? null) : existing ? (existing.person ?? null) : undefined;
  if (person === undefined) return fail(400, ERR.badPerson);
  if (person !== null && !PERSONS.includes(person)) return fail(400, ERR.badPerson);
  if (input.vault !== undefined && typeof input.vault !== 'boolean') return fail(400, ERR.badRequest);
  if (role !== 'owner') {
    if (role !== 'manager') return fail(403, ERR.notAllowed);
    if (input.vault !== undefined) return fail(403, ERR.ownerOnly);
    if (existing && isManagerRow(existing)) return fail(403, ERR.ownerOnly);
    if (isManagerRow({ person })) return fail(403, ERR.ownerOnly);
    if (!existing && personTaken) return fail(409, ERR.personTaken);
  } else if (existing && existing.email === callerEmail && person !== (existing.person ?? null)) {
    // The owner does not change their own role here (that would lock them out).
    return fail(409, ERR.ownRole);
  }
  const vault = input.vault ?? existing?.vault ?? false;
  return { ok: true, insert: !existing, row: { email, person, vault } };
}

export function planRemove({ role, callerEmail, existing }) {
  if (role !== 'owner') return fail(403, ERR.ownerOnly);
  if (!existing) return fail(404, ERR.notFound);
  if (existing.email === callerEmail) return fail(409, ERR.cannotRemoveSelf);
  return { ok: true };
}

// A sign-in link only for someone on the staff list; the owner's only by the owner.
export function planLink({ role, target, redirectTo }) {
  if (role !== 'owner' && role !== 'manager') return fail(403, ERR.notAllowed);
  if (!target) return fail(404, ERR.notStaff);
  if (isOwnerRow(target) && role !== 'owner') return fail(403, ERR.ownerOnly);
  const page = allowedRedirect(redirectTo);
  if (!page) return fail(400, ERR.badRedirect);
  return { ok: true, page };
}

// No login yet: an invite (creates the account). Otherwise: choose a new password.
export const linkTypeFor = (authUser) => (authUser ? 'recovery' : 'invite');

// The link sent by WhatsApp opens the office's page with the token's hash in the
// fragment (never sent to a server). The page spends it only when the person
// submits a password, so a link preview that fetches the address cannot use it up.
export function buildLoginLink(page, type, tokenHash) {
  return `${page}#${new URLSearchParams({ type, token_hash: tokenHash })}`;
}

// One row of the team list: the staff row with what the page needs from the auth
// user. Never tokens, never the user's metadata.
export function summarize(row, authUser = null, lastLink = null) {
  return {
    email: row.email,
    person: row.person ?? null,
    vault: !!row.vault,
    created_at: row.created_at ?? null,
    has_login: !!authUser,
    confirmed: !!authUser?.email_confirmed_at,
    last_sign_in_at: authUser?.last_sign_in_at ?? null,
    invited_at: authUser?.invited_at ?? null,
    last_link_at: lastLink?.at ?? null,
    last_link_by: lastLink?.by_email ?? null,
  };
}

// Supabase error → our code (rate limits have their own).
export function linkErrorCode(err) {
  const msg = String(err?.message || err || '');
  if (err?.status === 429 || /rate limit|security purposes|only request this/i.test(msg)) return ERR.tooSoon;
  return ERR.linkFailed;
}
