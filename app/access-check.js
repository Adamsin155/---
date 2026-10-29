// Process 6, "בדיקת הגישות וסידור הרשתות": the check of the client's logins and the page
// setup. Ofir's since 28.10.2026 (the owner: "להוריד מעילאי את כל עניין הגישות לרשתות, זה
// צריך לעבור לאופיר"); until then this lived in Ilai's characterization-day card
// (app/ilai-logic.js). Pure, no DOM: shared by "המשימות שלי" (app/access-check-ui.js), the
// client card's vault (app/client-card.js) and the tests.
import { NEW_STATUS, byClient } from './access-logic.js';

// The six quick checks of the page setup, in the protocol's order (app/protocol.js p06).
export const PAGE_KEYS = ['p06.name', 'p06.bio', 'p06.details', 'p06.phone', 'p06.address', 'p06.look'];
export const PAGE_LABELS = { 'p06.name': 'שם העמוד', 'p06.bio': 'Bio', 'p06.details': 'פרטי עסק', 'p06.phone': 'טלפון', 'p06.address': 'כתובת', 'p06.look': 'מראה העמוד' };
// The items of the check itself (the rest of 6 is the page setup above).
export const ACCESS_KEYS = ['p06.verified', 'p06.newpages', 'p06.metricool'];
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
