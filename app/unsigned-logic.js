// Contracts that were sent for signature and are not signed yet (docs/ops.md, section 47).
// Until the client signs there is no client row, so process 1 ("Irit makes sure the
// client actually signed") had nowhere to live: the deal's card leaves Irit's list at
// "חוזה נשלח" and nothing followed the contract. This is the one answer to "which
// contracts wait for a signature", read by the counted line of "המשימות שלי"
// (app/mine-flow.js), the filter of quotes.html (app/dashboard.js), the daily control's
// "חתימות" (app/control-topics.js) and the reminder rule `unsigned`
// (app/reminder-rules.js, also on the server), so their numbers cannot differ.
//
// Pure, no DOM and no network. A row is a public.quotes row with, where the reader has
// them: status, approval, approval_at, created_at, expires_at, signable (model.signable,
// as a boolean or as the text PostgREST returns), valid (model.validHours), business or
// company, client_name, seller_email (the deal's seller, added on the server).
import { parseDate, isBusinessDay, nextWorkMoment } from './protocol-logic.js';
import { partsIL, atTimeIL, addDaysIL, daysBetweenIL } from './tz.js';

// The numbers of the follow-up, as data: each is a one-line change.
export const UNSIGNED = {
  follows: 'irit',        // who makes sure the client signed (process 1 of her protocol)
  ringAfter: 1,           // business days after the sending: she rings, once
  dailyAt: '08:30',       // from the next business morning on: one line a day in her digest
  manager: 'lior',        // who hears when it drags on
  managerAfter: 2,        // business days after the sending: a line in his list
  sellerAfter: 1,         // business days after the sending: the field agent who sold it is told, once
  expiredDays: 2,         // how long after its validity ran out the server still reads it (for the one notice)
};
// Where the contracts are followed up: the list of sent quotes, on the ones that wait.
export const UNSIGNED_FILTER = 'sign';
export const UNSIGNED_URL = `quotes.html#${UNSIGNED_FILTER}`;

const signable = (q) => !(q?.signable === false || q?.signable === 'false' || q?.model?.signable === false);
// A contract a manager has to approve first is not with the client yet (the rule
// `contractApproval` follows it); sent back, it is with whoever prepared it.
const withClient = (q) => !q?.approval || q.approval === 'none' || q.approval === 'approved';
const validHours = (q) => { const v = Number(q?.valid ?? q?.model?.validHours); return Number.isFinite(v) && v > 0 ? v : null; };

// When the client got it to sign: the approval of an exceptional contract, else the
// start of its signing window (a corrected version starts a new one), else its creation.
export function sentForSignatureAt(q) {
  if (q?.approval === 'approved' && parseDate(q.approval_at)) return parseDate(q.approval_at);
  const until = parseDate(q?.expires_at);
  const hours = validHours(q);
  if (until && hours) return new Date(until.getTime() - hours * 36e5);
  return parseDate(q?.created_at);
}
export const expiredAt = (q) => parseDate(q?.expires_at);
const open = (q) => !!q && q.status === 'sent' && signable(q) && withClient(q) && !!sentForSignatureAt(q);
// Sent for signature, not signed, not cancelled, and the client can still sign it.
export const waitsForSignature = (q, now = new Date()) => open(q) && !(expiredAt(q) && expiredAt(q) <= now);
// Its validity ran out with no signature: the client can no longer sign this link.
export const expiredUnsigned = (q, now = new Date()) => open(q) && !!expiredAt(q) && expiredAt(q) <= now;

export const businessOf = (q) => String(q?.business || q?.company || q?.model?.client?.company || q?.client_name || q?.model?.client?.name || '').trim();

// The contracts that wait, the oldest first: [{ quote, since, name }].
export function unsignedList(quotes = [], now = new Date()) {
  return (quotes || []).filter((q) => waitsForSignature(q, now))
    .map((q) => ({ quote: q, since: sentForSignatureAt(q), name: businessOf(q) }))
    .sort((a, b) => a.since - b.since);
}

// The same wall time `n` business days after the office could first act on it, inside office hours.
export function afterBusinessDays(from, n) {
  const start = nextWorkMoment(from);
  const p = partsIL(start);
  let d = atTimeIL(start, 12);
  for (let left = n; left > 0;) { d = addDaysIL(d, 1); if (isBusinessDay(d)) left -= 1; }
  return nextWorkMoment(atTimeIL(d, p.hour, p.minute));
}
// The moments of the follow-up of one contract.
export function unsignedTimes(q) {
  const since = sentForSignatureAt(q);
  if (!since) return null;
  return {
    since,
    ring: afterBusinessDays(since, UNSIGNED.ringAfter),
    manager: afterBusinessDays(since, UNSIGNED.managerAfter),
    seller: afterBusinessDays(since, UNSIGNED.sellerAfter),
    expires: expiredAt(q),
  };
}

// "נשלח היום", "נשלח אתמול", "נשלח לפני 3 ימים".
export function sentWords(since, now = new Date()) {
  const days = daysBetweenIL(since, now);
  if (days <= 0) return 'נשלח היום';
  if (days === 1) return 'נשלח אתמול';
  return days === 2 ? 'נשלח לפני יומיים' : `נשלח לפני ${days} ימים`;
}

// The one sentence of the counted line: how many wait, and since when the oldest.
export function unsignedLine(quotes, now = new Date()) {
  const list = unsignedList(quotes, now);
  if (!list.length) return null;
  const oldest = list[0];
  const text = list.length === 1
    ? `ההסכם של ${oldest.name || 'הלקוח'} מחכה לחתימה (${sentWords(oldest.since, now)})`
    : `${list.length} הסכמים מחכים לחתימת הלקוח (הוותיק ${sentWords(oldest.since, now)})`;
  return { n: list.length, oldest: oldest.since, text, list };
}
