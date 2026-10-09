// Where a person stands when they open the app or sign in (the owner's rule, 9.10.2026;
// docs/ops.md, section 54): on THEIR home, never on a place the browser remembered.
//  - A visit is one life of a tab (or one launch of the installed app): this tab's
//    sessionStorage. What belongs to a place lives there and dies with it: the profile
//    ("מבט מנהל"), "תצוגה מלאה", the person filter of a client's card, the station of
//    the messages page (visitStore below; app/manager-rules.js keeps the profile).
//  - The page a visit began on is a deep link the person opened on purpose (a
//    notification, a link to a client): a sign-in on it continues to it, if it is
//    theirs to open. A sign-in on any other page goes to the role's home.
//  - Signing out ends the visit's claim on a place and forgets the choices above.
// No imports: the sign-out (app/supa.js) and every sign-in form load this. The rule
// itself is afterSignIn in app/shell-rules.js; node tests both.
const VISIT = 'astrateg.visit';
const OUT = 'out';
// What a place remembers, as "astrateg.<key>" in this tab. The profile is one of them.
export const PLACE_KEYS = ['profile', 'mine.full', 'card.all', 'focus', 'messages.station'];
// Where the same choices were kept before 9.10.2026 (this browser, for every tab): removed.
const OLD_LOCAL = ['astrateg.profile', 'astrateg.mode', 'astrateg.mine.full', 'astrateg.card.all', 'astrateg.focus', 'astrateg.messages.station'];

const session = () => { try { return globalThis.sessionStorage || null; } catch { return null; } };
const local = () => { try { return globalThis.localStorage || null; } catch { return null; } };
const addressOf = (loc) => `${String(loc?.pathname || '').split('/').pop() || 'index.html'}${loc?.search || ''}`;

// The choices of a place: this tab only.
export const visitStore = {
  get(k, s = session()) { try { return s?.getItem(`astrateg.${k}`) ?? null; } catch { return null; } },
  set(k, v, s = session()) { try { if (v === '' || v == null) s?.removeItem(`astrateg.${k}`); else s?.setItem(`astrateg.${k}`, v); } catch { /* no storage */ } },
};

// Called once when a page loads: notes the page a visit began on. Returns whether this
// page is that one (also after a reload of it), which is what "opened on purpose" means.
export function beginVisit(loc = globalThis.location, s = session()) {
  const here = addressOf(loc);
  try {
    const was = s.getItem(VISIT);
    if (was === null) { s.setItem(VISIT, here); return true; }
    return was !== OUT && was === here;
  } catch { return false; } // no storage: nothing is known to be on purpose, so home
}
// The person signed out (or someone else signed in): no page of this visit is "theirs on
// purpose" any more, and the choices of the place are forgotten.
export function forgetPlace(s = session(), l = local()) {
  try { if (s) { s.setItem(VISIT, OUT); for (const k of PLACE_KEYS) s.removeItem(`astrateg.${k}`); } } catch { /* no storage */ }
  try { if (l) for (const k of OLD_LOCAL) l.removeItem(k); } catch { /* no storage */ }
}

// Whether this page load began the visit (read once, before anything else of the page runs).
export const ENTRY = typeof document === 'undefined' ? false : beginVisit();

// The page said "אין לך גישה…" (every staff page has the same box; a client's card and
// the scripts page mark their state line).
export const refusedHere = (doc = globalThis.document) => {
  const box = doc.getElementById('no-access');
  return (!!box && !box.hidden) || !!doc.querySelector('#state.no-access');
};

// After the server said yes to a sign-in form: where this person goes (afterSignIn in
// app/shell-rules.js). Null when the person is not one of the staff or could not be
// identified: the page then says so itself, as before.
export async function signInPlan(email, { entry = ENTRY, loc = globalThis.location } = {}) {
  try {
    const [shell, rules] = await Promise.all([import('./shell.js'), import('./shell-rules.js')]);
    const viewer = await shell.viewerFor(email);
    if (!viewer || viewer.error) return null;
    return rules.afterSignIn(viewer, { pathname: loc.pathname, hash: loc.hash, search: loc.search, entry });
  } catch { return null; }
}
