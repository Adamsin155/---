// Process 6, "בדיקת הגישות וסידור הרשתות": the check of the client's logins and the page
// setup. Ofir's since 28.10.2026 (the owner: "להוריד מעילאי את כל עניין הגישות לרשתות, זה
// צריך לעבור לאופיר"); until then this lived in Ilai's characterization-day card
// (app/ilai-logic.js). Pure, no DOM: shared by "המשימות שלי" (app/access-check-ui.js), the
// client card's vault (app/client-card.js) and the tests.
import { NEW_STATUS, byClient } from './access-logic.js';

// Protocol v14 (Ofir: "לאחד"): 6 is one mark, p06.ok. The six quick checks of the page setup and the
// three of the check (verified, new pages, Metricool) are retired; their old marks pass p06.ok.
export const PAGE_KEYS = [];
export const PAGE_LABELS = {};
export const ACCESS_KEYS = ['p06.ok'];
export const AUTO_ACCESS_NOTE = 'נסגר לבד: כל הרשתות בכספת קיבלו סטטוס';

// Whether every login in the vault has a status set after the access came in
// (תקינה, לא עובדת, אין רשת): that is the check of process 6. A login the client's
// own form put there ('new': received, not checked yet), or any status the form set
// that nobody of the office saved since, is not a check: someone still has to try it.
export function accessChecked(rows, accessAt) {
  if (!accessAt || !rows?.length) return false;
  return rows.every((a) => a.status && a.status !== NEW_STATUS && !byClient(a) && new Date(a.updated_at) >= new Date(accessAt));
}
// The logins that came from the client and wait for the check.
export const toCheck = (rows) => (rows || []).filter((a) => a.status === NEW_STATUS);
