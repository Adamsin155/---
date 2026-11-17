// "כל הסרטונים הועלו לדרייב של הלקוח" (step 24, p24.drive; rN.p24.drive of a shoot round or of a
// monthly round) is taken only when the client's Drive folder really has the videos (the owner,
// 17.11.2026: "אני לא רוצה שמישהו ילחץ סיימתי הכל וזה יעשה ככה בלי לוודא שבאמת הכל עלה לדרייב").
// Before the mark is written, the folder is listed live (the drive function) and its edited
// videos are counted; fewer than the shoot needs, or a check that cannot be made, and nothing is
// saved. Pure, no DOM (tests/drive-guard.test.mjs); the reading is app/drive-guard.js, the
// central place every screen's write goes through is app/protocol-data.js; docs/ops.md, section 140.
//
//   needed   round 1 (the client's own shoot): its part of the package (app/tracking-logic.js
//            shootPart: the two editors' split total, else the package's videos over its shoot
//            days); shoot round N: the parts of the shoots 1..N together, never above the
//            package's videos; a monthly round: that month's number (app/edit-count.js
//            monthTargetOf). A monthly client's first shoot with no package number: this month's.
//            Not known at all (no number anywhere): at least one video.
//   counted  the folder's video files that are not footage (app/drive-class.js fileClass: a video in
//            a "גלם" / "יום צילום" folder is 'raw', unless the folder says "סופי" / "ערוכ"…),
//            added on or after the deal day (Israel); a monthly round: added in its month.
import { roundsOf, isMonthlyRound } from './protocol-logic.js';
import { isMonthly, monthKey, monthTargetOf } from './edit-count.js';
import { shootsOf, shootPart, dealDayOf } from './package-parts.js';
import { fileClass } from './drive-class.js';
import { dayKeyIL } from './tz.js';

// The mark this is about: "p24.drive" or "rN.p24.drive".
export const isDriveKey = (key) => /^(r\d+\.)?p24\.drive$/.test(String(key || ''));
const roundOf = (key) => Number(/^r(\d+)\./.exec(String(key || ''))?.[1] || 1);
const whole = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

// What the mark needs: { needed, month } — needed: how many edited videos (null: not known);
// month: 'YYYY-MM' for a monthly round (only that month's files count), else null.
export function neededFor(client, key, now = new Date()) {
  const n = roundOf(key);
  if (n > 1) {
    const r = roundsOf(client).find((x) => Number(x.n) === n);
    if (r && isMonthlyRound(r)) return { needed: monthTargetOf(client, r.month), month: r.month };
  }
  let sum = 0;
  let known = false;
  for (const s of shootsOf(client)) {
    if (s.n > n) continue;
    const part = shootPart(s.ctx);
    if (part) { sum += part; known = true; }
  }
  const of = whole(client?.deliverables?.videos);
  if (known) return { needed: of ? Math.min(of, sum) : sum, month: null };
  if (isMonthly(client)) return { needed: monthTargetOf(client, monthKey(now)), month: null };
  return { needed: null, month: null };
}

// How many edited videos the listing holds (files: the drive function's { name, mimeType,
// createdTime, path }), added on or after the client's deal day; `month`: only that Israel month.
export function editedOnDrive(files, client, { month = null } = {}) {
  const from = dealDayOf(client);
  let n = 0;
  for (const f of files || []) {
    if (fileClass(f?.mimeType, f?.path, f?.name) !== 'video') continue;
    const t = Date.parse(f.createdTime || '');
    if (!Number.isFinite(t)) continue;
    const day = dayKeyIL(new Date(t));
    if ((from && day < from) || (month && day.slice(0, 7) !== month)) continue;
    n += 1;
  }
  return n;
}

export const CLOSING = 'אפשר לסמן רק אחרי שכולם עלו לדרייב.';
// "בדרייב יש 31 סרטונים ערוכים מתוך 48. אפשר לסמן רק אחרי שכולם עלו לדרייב."
export function shortText(count, needed, { month = false, truncated = false } = {}) {
  const when = month ? ' החודש' : '';
  const have = count === 0 ? `בדרייב עוד אין סרטונים ערוכים${when} (צריך ${needed}).`
    : count === 1 ? `בדרייב יש סרטון ערוך אחד${when} מתוך ${needed}.`
      : `בדרייב יש ${count} סרטונים ערוכים${when} מתוך ${needed}.`;
  const more = truncated ? ' (התיקייה גדולה מאוד ולא כל הקבצים נבדקו.)' : '';
  return `${have}${more} ${CLOSING}`;
}

// The verdict on a listing: { ok: true, count, needed } or { ok: false, count, needed, say }.
export function driveVerdict(client, key, { files = [], truncated = false } = {}, now = new Date()) {
  const { needed: n, month } = neededFor(client, key, now);
  const needed = n && n > 0 ? n : 1;
  const count = editedOnDrive(files, client, { month });
  if (count >= needed) return { ok: true, count, needed };
  return { ok: false, count, needed, say: shortText(count, needed, { month: !!month, truncated }) };
}

// When the check itself cannot be made (no folder, no access, the Drive not connected): the
// reason in words (app/drive-files.js errorOf), after one sentence that says nothing was marked.
export const cannotCheck = (reason) => `לא סומן: אי אפשר לבדוק עכשיו שכל הסרטונים בדרייב. ${reason}`;
