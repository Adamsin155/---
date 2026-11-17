// What a file in a client's Google Drive folder is to the office, by its type and its folder's
// name (moved here from supabase/functions/_shared/drive.js on 17.11.2026, so that the app's
// "כל הסרטונים הועלו לדרייב" check (app/drive-guard-logic.js) and the functions that read the Drive
// (drive, drive-scan, ask) count the same files the same way; docs/ops.md, section 140).
// Pure; the functions get a copy (node scripts/sync-functions.mjs).

export const FOLDER_MIME = 'application/vnd.google-apps.folder';

// What kind of file, by its type: 'folder', 'video', 'image', 'doc', 'other'.
export function kindOf(mimeType) {
  const m = String(mimeType || '');
  if (m === FOLDER_MIME) return 'folder';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('application/vnd.google-apps.') || m === 'application/pdf' || m.startsWith('text/')) return 'doc';
  return 'other';
}

// What a file is to the office, by its type and the name of its folder (the folders are not
// uniform: "סרטונים מוכנים", "גלם יום 1/סופי", "יום צילום 3"…): 'graphic' (not a video, in a
// graphics or highlights folder), 'raw' (footage and photos of a shoot), 'video' (an edited
// video), 'other'.
export const GRAPHIC_FOLDER = /גרפיק|היילייט/;
export const READY_FOLDER = /סופי|מוכנ|ערוכ|סגיר|מתוקן/;
export const RAW_FOLDER = /גלם|מצלמה|רחפן|בירול|יום צילום|ראיונות|מאחורי הקלעים/;
export function fileClass(mimeType, path) {
  const p = String(path || '');
  const k = kindOf(mimeType);
  if (k === 'video') return !READY_FOLDER.test(p) && RAW_FOLDER.test(p) ? 'raw' : 'video';
  if (GRAPHIC_FOLDER.test(p)) return 'graphic';
  if (k === 'image' && (RAW_FOLDER.test(p) || /תמונות/.test(p))) return 'raw';
  return 'other';
}
