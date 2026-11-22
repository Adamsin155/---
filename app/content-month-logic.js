// The contents of each month against the contract (Irit's request, the owner's decisions of
// 22.11.2026; docs/ops.md, section 145). Pure: no DOM, no database (tests/content-month.test.mjs).
// The browser (the client card, the "חסרים תכנים החודש" list on owner.html and year.html) and the
// reminders (app/reminder-rules.js) read the same rules.
//
// ── The target ────────────────────────────
// What the contract gives in contents (videos and graphics together: clients.deliverables.videos +
// graphics, the numbers "סיכום החוזה" counts) spread over the contract's months: from the deal to
// the contract's end (12 when the end is not known). 72 over 12 months is 6 a month. A total that
// does not divide evenly is spread so the months sum to it, the extra one in the first months
// (50 over 12: 5, 5, then 4 every month). A monthly client (deliverables.videos_month) gets its
// month's own number of videos (app/edit-count.js monthTargetOf) and its graphics spread the same way.
//
// ── Where the count starts ────────────────
// The first month with any counted content of the client in Metricool (public.content_months,
// first_month): the months before it are the characterization and the shoot, when nothing is
// posted yet, and would be "short" for every new client. From it, as many months as the contract
// has. A client with no counted content yet is not checked (and with no Metricool brand at all,
// Ilai and Irit hear of that once: NO_BRAND).
//
// ── What counts ───────────────────────────
// public.content_months (supabase/migrations/20261221100000_content_months.sql): the Gantt's rows
// that stand on a Metricool post, of kinds video / graphic / monthly. One content once: a post to
// several networks is one; a content split into one post per network at the same minute is one.
//   posted   went up in that month
//   planned  went up or is still scheduled for it
import { monthTargetOf, isMonthly, addMonth, monthLabel, isMonthKey } from './edit-count.js';
import { partsIL, dateIL } from './tz.js';
import { isBusinessDay } from './protocol-logic.js';

const pad = (n) => String(n).padStart(2, '0');
const whole = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0);
const DAY = /^(\d{4})-(\d{2})-(\d{2})/;
const keyOfDay = (v) => { const m = DAY.exec(String(v || '')); return m ? `${m[1]}-${m[2]}` : null; };
export const monthOf = (now = new Date()) => { const p = partsIL(now); return `${p.year}-${pad(p.month)}`; };
const monthsApart = (a, b) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));

export const DEFAULT_MONTHS = 12;
// Who hears of what (the owner, 22.11.2026).
export const AHEAD_TO = ['ilai', 'irit'];               // next month is not fully scheduled (from the 20th)
export const MONTH_END_TO = ['ilai', 'irit', 'ofir', 'lior']; // last month went up short (the first days of the month)
export const NO_BRAND_TO = ['ilai', 'irit'];            // a client with no Metricool brand
export const SUMMARY_TO = ['ilai', 'irit', 'ofir', 'lior']; // the month's summary, the 1st at 09:00
export const AHEAD_FROM_DAY = 20;   // from the 20th of a month, next month should be scheduled
export const MONTH_END_DAYS = 7;    // last month's count is told in the first week of the month
export const ALERT_AT = '10:00';
export const SUMMARY_AT = '09:00';
export const NO_BRAND_AFTER_DAYS = 45; // a client this long after the deal is expected to have a brand

// The contract's contents and months.
export const contentTotal = (client) => whole(client?.deliverables?.videos) + whole(client?.deliverables?.graphics);
export function contractMonths(client) {
  const a = keyOfDay(client?.deal_at);
  const b = keyOfDay(client?.contract_end);
  if (!a || !b || b <= a) return DEFAULT_MONTHS;
  const n = monthsApart(a, b) - (Number(String(client.contract_end).slice(8, 10)) < Number(String(client.deal_at).slice(8, 10)) ? 1 : 0);
  return Math.max(1, Math.min(60, n));
}
// `total` over `months`: the share of month number i (0-based), the extra ones first.
export const spread = (total, months, i) => {
  const t = whole(total);
  const m = Math.max(1, whole(months));
  if (i < 0 || i >= m) return null;
  return Math.floor(t / m) + (i < t % m ? 1 : 0);
};
// Whether the client is counted at all: a contract with contents, or a monthly client.
export const hasContents = (client) => contentTotal(client) > 0 || isMonthly(client);

// The target of month `key` for a client whose count starts at `first` ('YYYY-MM'); null outside.
export function targetOf(client, first, key) {
  if (!isMonthKey(first) || !isMonthKey(key) || !hasContents(client)) return null;
  const months = contractMonths(client);
  const i = monthsApart(first, key);
  if (i < 0 || i >= months) return null;
  if (isMonthly(client)) return (monthTargetOf(client, key) || 0) + spread(whole(client?.deliverables?.graphics), months, i);
  return spread(contentTotal(client), months, i);
}

// public.content_months rows → Map client id → { first, months: { 'YYYY-MM': { posted, planned } } }.
export function byClient(rows) {
  const out = new Map();
  for (const r of rows || []) {
    if (!r?.client_id) continue;
    const c = out.get(r.client_id) || { first: isMonthKey(r.first_month) ? r.first_month : null, months: {} };
    if (isMonthKey(r.month)) c.months[r.month] = { posted: whole(r.posted), planned: whole(r.planned) };
    out.set(r.client_id, c);
  }
  return out;
}
// The range a page or the reminders read: last month to next month.
export const rangeOf = (now = new Date()) => { const cur = monthOf(now); return { from: addMonth(cur, -1), to: addMonth(cur, 1), cur }; };

// One client's month: { key, label, target, posted, planned, missing (to the target, by what is
// planned), short (posted below the target for a month that ended; planned below it otherwise) }.
export function monthOfClient(client, data, key, now = new Date()) {
  const target = targetOf(client, data?.first, key);
  if (target === null) return null;
  const m = data?.months?.[key] || { posted: 0, planned: 0 };
  const ended = key < monthOf(now);
  const have = ended ? m.posted : m.planned;
  return { key, label: monthLabel(key).split(' ')[0], target, posted: m.posted, planned: m.planned, scheduled: Math.max(0, m.planned - m.posted), missing: Math.max(0, target - have), short: have < target, ended };
}

// The card's lines (last month, this month, next month, those inside the count):
//   "אוקטובר: עלו 4 מתוך 6"; "נובמבר: עלו 4 מתוך 6 · עוד 1 מתוזמן"; "דצמבר: מתוזמנים 5 מתוך 6".
export function cardLines(client, data, now = new Date()) {
  const { from, cur, to } = rangeOf(now);
  return [from, cur, to].map((key) => monthOfClient(client, data, key, now)).filter(Boolean).map((m) => {
    let text;
    if (m.key < cur) text = `${m.label}: עלו ${m.posted} מתוך ${m.target}`;
    else if (m.key === cur) text = `${m.label}: עלו ${m.posted} מתוך ${m.target}${m.scheduled ? ` · עוד ${m.scheduled === 1 ? 'אחד מתוזמן' : `${m.scheduled} מתוזמנים`}` : ''}`;
    else text = `${m.label}: מתוזמנים ${m.planned} מתוך ${m.target}`;
    return { ...m, text, tone: m.short ? 'warn' : 'ok' };
  });
}
// Why a client has no lines: words for the card, or null when it has lines.
export function cardNote(client, data, { mapped = true } = {}) {
  if (!hasContents(client)) return 'בכרטיס לא הוזן כמה תכנים בחוזה.';
  if (!mapped) return 'הלקוח לא מחובר למותג ב־Metricool, ולכן אין ספירה.';
  if (!data?.first) return 'עוד לא עלה ולא תוזמן אף תוכן ב־Metricool. הספירה מתחילה בחודש של התוכן הראשון.';
  return null;
}

// The clients short in month `key` (this month by default), the biggest gap first:
// [{ client, month }] where month is monthOfClient(...).
export function shortList(clients, map, now = new Date(), key = monthOf(now)) {
  const out = [];
  for (const c of clients || []) {
    const m = monthOfClient(c, map?.get(c.id), key, now);
    if (m && m.missing > 0) out.push({ client: c, month: m });
  }
  return out.sort((a, b) => b.month.missing - a.month.missing || String(a.client.business || a.client.name || '').localeCompare(String(b.client.business || b.client.name || ''), 'he'));
}
// Every counted client of month `key`, the short ones first (the 1st-of-month summary).
export function monthTable(clients, map, key, now = new Date()) {
  const rows = [];
  for (const c of clients || []) {
    const m = monthOfClient(c, map?.get(c.id), key, now);
    if (m) rows.push({ client: c, month: m });
  }
  const name = (x) => String(x.client.business || x.client.name || '');
  return rows.sort((a, b) => b.month.missing - a.month.missing || name(a).localeCompare(name(b), 'he'));
}

// ── The alerts' days (app/reminder-rules.js) ──
// A case exists only on a business day of its window, anchored at that day's hour, so it goes out
// at the first business day's hour in the window (also when the system went live mid-window).
// Its key holds the month: once a month per client.
const dayOf = (now) => partsIL(now).day;
const at = (now, hhmm) => { const p = partsIL(now); const [h, m] = hhmm.split(':').map(Number); return dateIL(p.year, p.month, p.day, h, m); };
// The alerts start on 1.12.2026 (the owner, 22.11.2026): until then Irit and Ilai go over the
// list and fix. The first month-end alert is about December (early January), not November.
export const ALERTS_FROM_MONTH = '2026-12';
export const alertsStarted = (now) => monthOf(now) >= ALERTS_FROM_MONTH;
export const aheadDue = (now) => alertsStarted(now) && isBusinessDay(now) && dayOf(now) >= AHEAD_FROM_DAY ? { key: addMonth(monthOf(now), 1), at: at(now, ALERT_AT) } : null;
export const monthEndDue = (now) => alertsStarted(now) && addMonth(monthOf(now), -1) >= ALERTS_FROM_MONTH && isBusinessDay(now) && dayOf(now) <= MONTH_END_DAYS ? { key: addMonth(monthOf(now), -1), at: at(now, ALERT_AT) } : null;
export const summaryDue = (now) => alertsStarted(now) && isBusinessDay(now) && dayOf(now) <= MONTH_END_DAYS ? { key: monthOf(now), at: at(now, SUMMARY_AT) } : null;
// A client long enough after the deal to have a Metricool brand, and with none (nor marked "ללקוח
// אין מותג", clients.metricool_none).
export function noBrand(client, now = new Date()) {
  if (!hasContents(client) || client?.metricool_blog_id || client?.metricool_none) return false;
  const deal = Date.parse(String(client?.deal_at || ''));
  return Number.isFinite(deal) && now.getTime() - deal >= NO_BRAND_AFTER_DAYS * 864e5;
}
// Whether the client's last Metricool sync can be trusted for "scheduled" (it ran, and read the
// whole listing): client_gantt_sync rows (ok, stats.partial).
export const syncTrusted = (row) => !!row && row.ok === true && !(row.stats && row.stats.partial);

// ── Words ─────────────────────────────────
const nameOf = (c) => String(c?.business || c?.name || '').trim() || 'לקוח';
export const aheadWords = (client, m) => ({
  title: `חסר בתזמון ל${m.label}: ${nameOf(client)} ${m.planned}/${m.target}`,
  body: `מתוזמנים ${m.planned} מתוך ${m.target} התכנים שמגיעים לו ב${m.label} לפי החוזה. חסרים ${m.missing}.`,
});
export const monthEndWords = (client, m) => ({
  title: `עלו פחות ב${m.label}: ${nameOf(client)} ${m.posted}/${m.target}`,
  body: `לקוח ${nameOf(client)}: עלו ${m.posted} מתוך ${m.target} ב${m.label}. חסרים ${m.target - m.posted}.`,
});
export const noBrandWords = (client) => ({
  title: `לא מחובר ל־Metricool: ${nameOf(client)}`,
  body: 'בלי מותג ב־Metricool אי אפשר לספור כמה תכנים עלו לו בכל חודש. לחבר בגאנט שלו, או לסמן ״ללקוח אין מותג״.',
});
// The 1st of the month: one message with the month's table, short first.
export function summaryWords(rows, key) {
  const label = monthLabel(key).split(' ')[0];
  const short = rows.filter((r) => r.month.missing > 0);
  const title = short.length ? `התכנים של ${label}: ${short.length === 1 ? 'לקוח אחד חסר' : `${short.length} לקוחות חסרים`}` : `התכנים של ${label}: הכול מתוזמן`;
  const line = (r) => `${nameOf(r.client)} ${r.month.planned}/${r.month.target}`;
  const lines = short.slice(0, 8).map(line);
  if (short.length > 8) lines.push(`ועוד ${short.length - 8} חסרים`);
  const ok = rows.length - short.length;
  if (ok) lines.push(`${ok === 1 ? 'לקוח אחד מתוזמן' : `${ok} לקוחות מתוזמנים`} במלואו.`);
  return { title, body: `מתוזמנים מול החוזה ל${label}:\n${lines.join('\n')}` };
}
