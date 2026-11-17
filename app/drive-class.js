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
// A video still named as the camera or the drone wrote it ("C6397.MP4", "DJI_20260623104354_0131_D.MP4",
// "P1028411.MP4", "GX010023.MP4", "MVI_1234.MOV", "DSC05339.MP4"): footage, wherever it lies (17.11.2026:
// live folders kept footage at the root, or in a folder named after the business, which the folder
// rule alone counted as edited videos). An edited video gets a name of its own; in a folder that says
// "סופי" / "מוכנ" / "ערוכ"… it is edited whatever its name.
export const CAMERA_NAME = /^(?:C\d{4}|DJI_\d{6,}\w*|P\d{7}|GX\d{6}|GH\d{6}|GOPR\d{4}|MVI_\d{4}|DSC\d{5}|MAH\d{5}|PXL_\d{8}_\d+\w*)\.(?:mp4|mov|mts|m4v)$/i;
//   name: the file's name (optional: without it only the folder decides, as before).
export function fileClass(mimeType, path, name = '') {
  const p = String(path || '');
  const k = kindOf(mimeType);
  if (k === 'video') {
    if (READY_FOLDER.test(p)) return 'video';
    return RAW_FOLDER.test(p) || CAMERA_NAME.test(String(name || '').trim()) ? 'raw' : 'video';
  }
  if (GRAPHIC_FOLDER.test(p)) return 'graphic';
  if (k === 'image' && (RAW_FOLDER.test(p) || /תמונות/.test(p))) return 'raw';
  return 'other';
}
