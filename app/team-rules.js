// The team screen's plain rules (team.html, app/team.js), without the page, so
// node can test them. The staff-admin function enforces the same on the server
// (supabase/functions/staff-admin/rules.js); this only shapes the screens.

// Who opens the team screen besides the owner (staff.person is null).
export const TEAM_MANAGERS = ['irit', 'lior'];
// The office accounts (public.is_office() in the database). A copy of OFFICE_PERSONS
// in supabase/functions/staff-admin/rules.js, which decides (the unit tests compare them).
export const OFFICE_PERSONS = ['irit', 'lior', 'ofir', 'ilai'];
// Whose sign-in link only the owner makes (linkByOwnerOnly in the function's rules):
// the owner's, an office account's and any account with the vault. A manager still
// makes a link for their own account.
export const linkOnlyByOwner = (caller, row) => !!row && !caller?.owner && row.email !== caller?.email
  && (row.person === null || row.person === undefined || OFFICE_PERSONS.includes(row.person) || !!row.vault);

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

// WhatsApp numbers for the handoff buttons (app/handoffs.js). An Israeli mobile
// number in international digits (972501234567), or null when it is not one.
// A copy of normPhone in supabase/functions/staff-admin/rules.js, which decides;
// this only checks the field before sending (the unit tests compare the two).
export function normPhone(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw.length > 32 || !/^\+?[\d\s().-]+$/.test(raw)) return null;
  let d = raw.replace(/\D/g, '');
  // An international prefix (+ or 00) must be Israel's.
  if (d.startsWith('00')) d = d.slice(2);
  if ((raw.startsWith('+') || /^\D*00/.test(raw)) && !d.startsWith('972')) return null;
  if (d.startsWith('972')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  return /^5\d{8}$/.test(d) ? `972${d}` : null;
}

// A stored number as people write it here: 972501234567 → 050-123-4567.
export function formatPhone(stored) {
  const d = String(stored || '').replace(/\D/g, '');
  const m = /^972(5\d)(\d{3})(\d{4})$/.exec(d);
  return m ? `0${m[1]}-${m[2]}-${m[3]}` : d ? `+${d}` : '';
}

// Which rows have a number on the team screen (the screen opens only for the owner,
// Irit and Lior, who set anyone's): everyone's but the owner's, which keeps none,
// since no handoff goes to the owner and all staff read the staff list. The
// function checks the same.
export const hasPhone = (row) => !!row && row.person !== null && row.person !== undefined;
export const canEditPhone = (caller, row) => !!caller && hasPhone(row);
