// The client's email and company number in the client's details (the owner's request of
// 28.10.2026), as pure logic. Kept in public.clients.contact_email and company_id
// (20261113100000_client_details_month.sql): the office's columns, like the phone, read
// through public.clients_contact(). The agreement already asked for both
// (model.client.email, model.client.companyId in the quote builder): the migration copies
// them over for a client opened from a signed agreement, and a new one gets them when it
// is opened from it.

// A company number (ח.פ) or an ID number (ת.ז): 9 digits, after taking away spaces, dashes
// and dots. An ID number written with 8 digits (its leading zero dropped) gets it back;
// fewer than 8 are refused, not guessed. Stored as the 9 digits.
export function companyIdValue(v) {
  const s = String(v ?? '').replace(/[\s\-.‐-―־]/g, '');
  if (s === '') return { value: null };
  if (!/^\d+$/.test(s)) return { error: 'ח.פ / ת.ז: ספרות בלבד (9 ספרות; מותר רווח או מקף).' };
  if (s.length === 8) return { value: `0${s}` };
  if (s.length !== 9) return { error: `ח.פ / ת.ז: צריך 9 ספרות, ונכתבו ${s.length}.` };
  return { value: s };
}
// An email, checked loosely: one @, something before it, a dot in what follows, no
// spaces; at most 254 characters. Kept in lower case.
export function emailValue(v) {
  const s = String(v ?? '').trim();
  if (s === '') return { value: null };
  if (s.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return { error: 'האימייל לא נראה תקין. למשל: name@gmail.com' };
  return { value: s.toLowerCase() };
}
// How the card shows a company number: as stored (9 digits).
export const companyIdText = (v) => (v ? String(v) : null);
