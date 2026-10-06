// generated — edit app/ instead. Source: app/access-nudge.js. Regenerate: node scripts/sync-functions.mjs
// The nudge of the client's logins form (app/access-logic.js): the link was made and
// not filled by the end of the business day after it. Irit is reminded quietly
// (app/reminder-rules.js, rule `accessLink`), with a ready message in her queue
// (app/messages-logic.js, the template `access_nudge`); once more two business days
// later, and never again. Pure, Israel time, office days (protocol-logic.js); kept
// apart from access-logic.js so that the client's page loads nothing of the protocol.
import { addBusinessDays, parseDate } from './protocol-logic.js';
import { atTimeIL } from './tz.js';
import { linkState } from './access-logic.js';

export const NUDGE_KEY = 'access_nudge';
export const NUDGE_AT = '18:00';   // the end of the office's day
export const NUDGE_DAYS = [1, 3];  // business days after the link was made
export function nudgeTimes(link) {
  const from = parseDate(link?.created_at);
  if (!from) return [];
  const [h, m] = NUDGE_AT.split(':').map(Number);
  return NUDGE_DAYS.map((n) => atTimeIL(addBusinessDays(from, n), h, m));
}
// The ref of the nth nudge of a link in the messages' record (client_messages.ref).
export const nudgeRef = (link, n) => `${NUDGE_KEY}_${String(link.id).replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase()}_${n}`;
// Which nudge may go out now (1 or 2), or 0: the link still waits, its time came,
// and that nudge was not sent yet.
export function nudgeDue(link, messages = [], now = new Date()) {
  if (linkState(link, now) !== 'waiting') return 0;
  const sent = [1, 2].filter((n) => (messages || []).some((m) => m.ref === nudgeRef(link, n))).length;
  if (sent >= 2) return 0;
  const times = nudgeTimes(link);
  return times[sent] && now >= times[sent] ? sent + 1 : 0;
}
