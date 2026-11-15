// "תיקיית הדרייב" on the content Gantt (the owner's request of 15.11.2026; docs/ops.md, section 132):
// Ilai pastes the client's Drive folder link next to "משיכת קישורים מהדרייב", or replaces it. Plain
// logic, so node tests it (tests/drive-folder.test.mjs): the folder's id is read as the drive
// function reads it (supabase/functions/_shared/drive.js, folderIdOf), and the link is kept in one
// form, https://drive.google.com/drive/folders/<id>.

// Links only: a password, token or code in the address is refused (the same as the card's readLinks).
export const SECRET = /\/\/[^/?#@\s]+:[^/?#@\s]*@|[?&#;]([a-z_]*(password|passwd|pass|pwd|token|secret|apikey|api_key|key|auth|sig|signature)|code)=/i;

const ID = /^[\w-]{10,}$/;

// The folder's id in a Drive address, or null (as folderIdOf, but only a full https address).
export function folderIdOf(link) {
  const s = String(link ?? '').trim();
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:' || u.hostname !== 'drive.google.com') return null;
  const m = /\/folders\/([\w-]{10,})/.exec(u.pathname);
  if (m) return m[1];
  const id = u.searchParams.get('id');
  return u.pathname === '/open' && id && ID.test(id) ? id : null;
}

export const folderUrl = (id) => `https://drive.google.com/drive/folders/${id}`;

// What was pasted: { url } in its one form, or { error } in words.
export function readFolderLink(text) {
  const v = String(text ?? '').trim();
  if (!v) return { error: 'הדביקו כאן את הקישור לתיקייה בדרייב.' };
  const secret = { error: 'אפשר לשמור כאן רק קישור. סיסמאות וקודי גישה לא נשמרים במערכת.' };
  // A Drive folder's address: what follows "?" or "#" (?usp=…, ?resourcekey=…) is dropped, so only
  // the address before it is checked for a password; anything else is checked whole.
  if (SECRET.test(v.split(/[?#]/)[0])) return secret;
  const id = /^https:\/\//i.test(v) ? folderIdOf(v) : null;
  if (id) return { url: folderUrl(id) };
  if (SECRET.test(v)) return secret;
  if (!/^https:\/\//i.test(v)) return { error: 'זה לא נראה כמו קישור. העתיקו את הכתובת המלאה, שמתחילה ב־https://' };
  return { error: 'זה לא קישור לתיקייה בדרייב. פתחו את התיקייה ב־Google Drive והעתיקו את הכתובת שלה (drive.google.com/drive/folders/…).' };
}

// The client's links with the new folder: every other key stays; the folder it replaces is kept in drive_old.
export function withFolder(links, url) {
  const out = { ...(links && typeof links === 'object' && !Array.isArray(links) ? links : {}) };
  const old = String(out.drive || '').trim();
  if (old && old !== url) out.drive_old = old;
  out.drive = url;
  return out;
}
