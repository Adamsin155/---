// The team screen's plain rules (team.html, app/team.js), without the page, so
// node can test them. The staff-admin function enforces the same on the server
// (supabase/functions/staff-admin/rules.js); this only shapes the screens.

// Who opens the team screen besides the owner (staff.person is null).
export const TEAM_MANAGERS = ['irit', 'lior'];

// From viewerOf() in protocol-ui.js: { me, scope, error }. The owner has no person
// and the office scope; someone the app could not identify gets nothing.
export const isOwnerView = (v) => !!v && !v.error && !v.me && v.scope === 'office';
export const canManageTeam = (v) => isOwnerView(v) || (!!v && !v.error && TEAM_MANAGERS.includes(v.me));

// How long a sign-in link works, in words (Supabase's email link lifetime, 1 hour by default).
export const LINK_VALID_FOR = 'שעה';

// 'active' (has signed in), 'pending' (has a login, never signed in), 'none' (no login yet).
export function loginState(row) {
  if (!row?.has_login) return 'none';
  return row.last_sign_in_at ? 'active' : 'pending';
}

// The WhatsApp message that carries the link (sent with whatsappLink('', text), so
// no phone number: the sender picks the chat).
export function linkMessage({ name, link, type }) {
  const hi = name ? `היי ${name},` : 'היי,';
  const what = type === 'invite'
    ? 'זה הקישור האישי שלך לכניסה הראשונה למערכת של אסטרטג. פותחים אותו, בוחרים סיסמה, ומעכשיו נכנסים עם כתובת המייל והסיסמה.'
    : 'זה קישור אישי לבחירת סיסמה חדשה למערכת של אסטרטג. פותחים אותו ובוחרים סיסמה חדשה.';
  return `${hi}\n${what}\nהקישור תקף ל${LINK_VALID_FOR} ומיועד רק לך.\n\n${link}`;
}
