// generated — edit app/ instead. Source: app/contract-end.js. Regenerate: node scripts/sync-functions.mjs
// A contract whose end date arrived while the client is still "active" (protocol v10;
// docs/ops.md, section 58). Until now nothing happened on that day: the renewal (34) is
// asked for 60 days before, the end of the engagement (35) appears only once somebody
// changed the client's status by hand, and a client could stay "active" with a contract
// that ended. From the end date on, Lior gets one ring that morning (the rule
// `contractEnd` in app/reminder-rules.js) and a card on "המשימות שלי" with two actions:
//   - "נרשם חידוש": the new end date of the contract (the client card's own field,
//     contract_end). With a date ahead the client is no longer in this list;
//   - "סיום התקשרות": the client's status becomes "מסיים התקשרות" (the client card's own
//     field, status), which is what process 35 needs to appear.
// Nothing changes by itself: both are Lior's press. Pure: no DOM, no network, Israel time.
import { clientLabel, inLanding, parseDate } from './protocol-logic.js';
import { dayKeyIL, daysBetweenIL } from './tz.js';

// Who decides, and when he is rung: each a one-line change.
export const CONTRACT_END = {
  who: 'lior',
  ringAt: '09:45',     // "that morning" (after the window the morning digest swallows)
  renewMonths: 12,     // the date the renewal dialog offers: this many months after the old end
};

// The clients whose contract ended and nobody recorded what follows, the earliest end first:
//   [{ cid, client, name, endAt, endKey ('YYYY-MM-DD'), today (it ended this very day), days }]
// Not a client in landing (nothing of it is asked for until it is activated).
export function contractsEnded(clients = [], now = new Date()) {
  const today = dayKeyIL(now);
  const out = [];
  for (const c of clients) {
    if (c?.status !== 'active' || inLanding(c)) continue;
    const endAt = parseDate(c.contract_end);
    if (!endAt) continue;
    const endKey = dayKeyIL(endAt);
    if (endKey > today) continue;
    out.push({ cid: c.id, client: c, name: clientLabel(c), endAt, endKey, today: endKey === today, days: Math.max(0, daysBetweenIL(endAt, now)) });
  }
  return out.sort((a, b) => a.endAt - b.endAt);
}

// The end date the renewal dialog offers: the old end plus CONTRACT_END.renewMonths, as 'YYYY-MM-DD'.
export function renewedEnd(contractEnd, months = CONTRACT_END.renewMonths) {
  const end = parseDate(contractEnd);
  if (!end) return '';
  const [y, m, d] = dayKeyIL(end).split('-').map(Number);
  const total = (m - 1) + months;
  const ny = y + Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}
// A renewal's date is acceptable when it is a real day after today.
export const validRenewal = (value, now = new Date()) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !!parseDate(value) && value > dayKeyIL(now);
