// The client's Google Drive folder as the drive function lists it (supabase/functions/drive;
// docs/ops.md, section 74): names, types, dates and links, read-only. Used by "משיכת קישורים
// מהדרייב" in the content Gantt (app/gantt-drive.js) and by the check of "כל הסרטונים הועלו
// לדרייב" (app/drive-guard.js, 17.11.2026). The words of each refusal are here, once.
import { supabase } from './supa.js';

export const ERRORS = {
  drive_not_connected: 'הדרייב עוד לא מחובר. אחרי שהבעלים יחבר אותו, הכפתור יעבוד.',
  no_folder: 'אין קישור לתיקיית הדרייב בכרטיס הלקוח.',
  not_a_folder: 'הקישור לדרייב בכרטיס אינו קישור לתיקייה.',
  drive_auth: 'החיבור לדרייב נדחה. צריך לבדוק את ההגדרה.',
  not_allowed: 'את הגאנט מעדכנים עילאי, עירית, אופיר, ליאור ובעל המשרד.',
};
export const errorOf = (code, robot, words = ERRORS) => (code === 'drive_no_access'
  ? `אין גישה לתיקייה. צריך לשתף אותה (צפייה) עם ${robot || 'חשבון הרובוט של אסטרטג'}.`
  : words[code] || ERRORS[code] || 'הדרייב לא ענה כרגע. נסו שוב בעוד רגע.');

// The folder's files: { files, truncated }, or { error (in words), code }. Never throws.
//   words: the refusals' words for this screen (the Gantt's by default).
export async function listDriveFiles(clientId, { words = ERRORS } = {}) {
  try {
    const call = () => supabase.functions.invoke('drive', { body: { client_id: clientId } });
    let { data, error } = await call();
    if (error && error.context?.status === 401) { await supabase.auth.refreshSession().catch(() => null); ({ data, error } = await call()); }
    if (error) {
      let body = {};
      try { body = await error.context.json(); } catch { /* no body */ }
      const code = String(body.error || '');
      return { error: errorOf(code, body.robot, words), code };
    }
    return Array.isArray(data?.files) ? { files: data.files, truncated: data.truncated === true } : { error: errorOf('', null, words), code: '' };
  } catch {
    return { error: errorOf('', null, words), code: '' };
  }
}
