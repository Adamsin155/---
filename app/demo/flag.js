// The demo link (docs/ops.md, section 65): …/clients.html?demo=1 opens the app for a
// guest, with no sign-in, on the made-up office of app/demo/world.js. Nothing of the
// real office is read and nothing is written to it:
//  - every request of the page is answered in the browser (app/demo/fake.js; app/supa.js
//    sends none to the server while the demo is on);
//  - the demo lives in this tab only (sessionStorage): its "session", the role it is
//    seen as, and what the guest changed. Closing the tab ends it; a real account signed
//    in on the same device (localStorage) is never touched.
// ?demo=1 is the owner's view; ?demo=<role> (irit, lior, ofir, ilai, nadia, eli, stav…)
// opens as that person. app/login-gate.js and app/shell-gate.js read the same keys
// before the first paint (they are plain scripts and cannot import this file).
export const DEMO_KEY = 'astrateg.demo';
export const DEMO_AUTH_KEY = 'sb-demo-auth-token';
export const DEMO_DB_KEY = 'astrateg.demo.db';
export const DEMO_ROLES = ['owner', 'irit', 'lior', 'ofir', 'ilai', 'nirel', 'nadia', 'yariv', 'anna', 'eli', 'stav'];
const EXP = 4102444800; // 2100: the demo's session never runs out

const store = () => { try { return globalThis.sessionStorage || null; } catch { return null; } };

// The role the demo is seen as in this tab, or null when this is not a demo.
export function demoRole() {
  const s = store();
  if (!s) return null;
  try {
    const asked = new URLSearchParams(globalThis.location?.search || '').get('demo');
    if (asked) s.setItem(DEMO_KEY, DEMO_ROLES.includes(asked) ? asked : 'owner');
    const role = s.getItem(DEMO_KEY);
    return DEMO_ROLES.includes(role) ? role : null;
  } catch { return null; }
}

// The owner has no person of the team; the address is what the app shows as the name.
export const DEMO_OWNER = 'הבעלים@astrateg.test';
export const demoEmail = (role) => (role === 'owner' ? DEMO_OWNER : `${role}@astrateg.test`);
export const roleOfEmail = (email) => (email === DEMO_OWNER ? 'owner' : String(email || '').split('@')[0]);
const b64 = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
// A user id per role, the same on every load (the tab's cache and menu are kept under it).
export const demoUserId = (role) => `de000000-0000-4000-8000-${String(DEMO_ROLES.indexOf(role) + 1).padStart(12, '0')}`;
export function demoUser(role) {
  return { id: demoUserId(role), email: demoEmail(role), aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} };
}
export const demoToken = (role) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: demoUserId(role), email: demoEmail(role), role: 'authenticated', exp: EXP })}.demo`;

// The "signed in" session of the demo, where the sign-in client of app/supa.js reads it.
export function plantDemoSession(role) {
  const s = store();
  if (!s) return;
  const session = { access_token: demoToken(role), token_type: 'bearer', expires_in: EXP - Math.floor(Date.now() / 1000), expires_at: EXP, refresh_token: `demo-${role}`, user: demoUser(role) };
  try {
    const kept = JSON.parse(s.getItem(DEMO_AUTH_KEY) || 'null');
    if (kept?.user?.email !== session.user.email) s.setItem(DEMO_AUTH_KEY, JSON.stringify(session));
  } catch { /* no storage: the demo then shows the sign-in screen */ }
}

// Leaving the demo: everything it kept in this tab goes, and the page opens as it would.
export function leaveDemo() {
  const s = store();
  if (!s) return;
  const gone = [];
  for (let i = 0; i < s.length; i += 1) {
    const k = s.key(i) || '';
    if (k === DEMO_KEY || k === DEMO_AUTH_KEY || k.startsWith(`${DEMO_KEY}.`) || k === 'astrateg.shell' || k === 'astrateg.cache' || k.startsWith('astrateg.cache.')) gone.push(k);
  }
  for (const k of gone) s.removeItem(k);
}
