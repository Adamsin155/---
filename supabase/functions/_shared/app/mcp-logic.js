// generated — edit app/ instead. Source: app/mcp-logic.js. Regenerate: node scripts/sync-functions.mjs
// The connection of Claude accounts to the system (docs/ops.md, section 84): who may connect, the
// consent page's plain words, and the owner's card. This module is the plain part that the pages
// (mcp-consent.html, app/mcp-consent.js, app/mcp-team.js) and the mcp edge function share (a copy
// runs on the server: supabase/functions/_shared/app/, node scripts/sync-functions.mjs).
// The database decides who is switched on (public.mcp_allowed(), the table public.mcp_access);
// the rule here only says who may ever be on it.

// Besides the owners. A copy of the list in public.mcp_allowed() and public.mcp_set_access()
// (supabase/migrations/20261121100000_mcp.sql; tests/sql/mcp.test.mjs holds them equal).
export const MCP_PEOPLE = ['lior', 'ofir'];
// { office } from public.is_office(), { person } from public.my_person() (null for an owner, and
// for anyone who is not staff). Anything unclear is a no.
export const mayUseMcp = ({ office, person } = {}) => (office === true && person === null)
  || (office === true && typeof person === 'string' && MCP_PEOPLE.includes(person));

// ── The consent page ──────────────────────────
// What the connected app gets, in plain words (the page shows these and nothing else).
export const CONSENT_CAN = [
  'לקרוא מהמערכת את מה שאת/ה רואה במסכים שלך: לקוחות, משימות, ימי צילום, גאנט ועריכה',
  'להכין טיוטת חוזה, שנפתחת אצלך במחולל לבדיקה',
];
export const CONSENT_CANNOT = [
  'לא רואה טלפונים, מיילים, כתובות, הערות, סיסמאות או שכר',
  'לא שומר ולא שולח כלום: חוזה נוצר ונשלח רק על ידך, במערכת',
];
export const CONSENT_WORDS = {
  bad_link: 'הקישור הזה לא תקין או שפג תוקפו. חוזרים ל־Claude ומתחברים מחדש.',
  not_allowed: 'החיבור ל־Claude לא פתוח לחשבון הזה. אפשר לבקש מהבעלים להפעיל אותו.',
  failed: 'משהו השתבש. נסו שוב בעוד רגע.',
  denied: 'החיבור בוטל. אפשר לסגור את העמוד.',
};

// The id Supabase put in the address. Anything else is not sent to the server.
export function authorizationIdOf(search) {
  const id = new URLSearchParams(search || '').get('authorization_id');
  return id && /^[A-Za-z0-9_-]{8,128}$/.test(id) ? id : null;
}
// Where Supabase says to go next: only back to a web address, or to a program on this computer
// (Claude Code's own http://localhost). Null for anything else (javascript:, data:…).
export function safeRedirect(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') return u.href;
    if (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return u.href;
  } catch { /* not an address */ }
  return null;
}
// The app's name as Supabase holds it, on one line (it was typed by whoever registered the app).
export const clientNameOf = (details) => {
  const name = String(details?.client?.name ?? '').replace(/[‎‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return name || 'אפליקציה בלי שם';
};
// Where the answers go, by its address: what a person can check against what they meant to connect.
export function clientHostOf(details) {
  try { return new URL(details?.redirect_uri).hostname || null; } catch { return null; }
}

// ── The owner's card (team.html) ──────────────
export const usageWords = (lastUsed, formatWhen) => (lastUsed ? `שימוש אחרון: ${formatWhen(lastUsed)}` : 'עוד לא התחבר/ה');
