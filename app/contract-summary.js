// The contract summary at the top of the client card and in the manager table:
// what the signed agreement grants (clients.deliverables, set at signing by
// public.package_deliverables, or typed by the office) against what was done.
// "Done" is the most of three counts, never their sum (they count the same work):
//   - the protocol (app/health.js deliverablesPace: the videos of every shoot whose
//     videos the client approved, the first 9 graphics and the rest once approved;
//     shoot days held, process 19),
//   - the card's counter ("נמסרו", clients.deliverables.done),
//   - files uploaded as deliverables (public.client_files, kind deliverable_*, not
//     deleted), when that table exists and can be read.
// Pure, no DOM (tests/contract-summary.test.mjs). No prices: the money is the
// managers' (app/manager-rules.js seesFinance) and never comes here.
import { deliverablesPace, shootContexts, contractMonth } from './health.js';
import { parseDate } from './protocol-logic.js';
import { addDaysIL, atTimeIL, daysBetweenIL } from './tz.js';

export const RENEWAL_WINDOW_DAYS = 90; // as RENEWAL_DAYS in app/year-logic.js (the renewals list)

// Each counted entitlement: its words, in order. `f`: a feminine noun (בוצעה / אחת).
export const ITEMS = [
  { key: 'videos', short: 'סרטונים', many: 'סרטונים', one: 'סרטון אחד' },
  { key: 'graphics', short: 'גרפיקות', many: 'גרפיקות', one: 'גרפיקה אחת', f: true },
  { key: 'shoot_days', short: 'ימי צילום', many: 'ימי צילום', one: 'יום צילום אחד' },
  { key: 'collabs', short: 'קולאבים', many: 'קולאבים', one: 'קולאב אחד' },
  { key: 'stories', short: 'סטורי', many: 'סטורי אצל המשפיענים', one: 'סטורי אחד אצל המשפיענים' },
  { key: 'ch14', short: 'ערוץ 14', many: 'אייטמים בערוץ 14', one: 'אייטם אחד בערוץ 14' },
  { key: 'monthly', short: 'צלם חודשי', many: 'תכנים מהצלם החודשי', one: 'תוכן אחד מהצלם החודשי' },
];
// What an agreement grants without a count.
export const FLAGS = [
  { key: 'simeon_join', text: 'סמיון מצטרף ליום הצילום עם נטלי (ללא קולאב וללא סטוריז)' },
];

// Files uploaded as deliverables, by kind: deliverable_video(s), deliverable_graphic(s)…
const FILE_KIND = {
  video: 'videos', videos: 'videos', graphic: 'graphics', graphics: 'graphics', collab: 'collabs', collabs: 'collabs',
  story: 'stories', stories: 'stories', ch14: 'ch14', monthly: 'monthly',
};
export function fileCounts(rows, clientId = null) {
  const out = {};
  for (const r of rows || []) {
    if (clientId && r.client_id !== clientId) continue;
    if (r.deleted_at) continue;
    const m = /^deliverable_([a-z0-9]+)$/.exec(String(r.kind || ''));
    const key = m && FILE_KIND[m[1]];
    if (key) out[key] = (out[key] || 0) + 1;
  }
  return out;
}

const n = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0);

// "בוצעו 10 סרטונים מתוך 30 שבחוזה"
export function itemText(item, done, total) {
  const over = done > total ? ` (${done - total} מעבר לחוזה)` : '';
  if (done === 0) return `עוד לא בוצעו ${item.many} · ${total} בחוזה`;
  if (done === 1) return `${item.f ? 'בוצעה' : 'בוצע'} ${item.one} מתוך ${total} שבחוזה${over}`;
  return `בוצעו ${done} ${item.many} מתוך ${total} שבחוזה${over}`;
}

// The renewal window: the 90 days before the contract ends (the renewals list).
//   { state: 'later' | 'open' | 'ended', opensAt, endAt, daysLeft, text }
const dmy = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', year: '2-digit' });
export function renewalWindow(client, now = new Date()) {
  const end = parseDate(client?.contract_end);
  if (!end) return null;
  const today = atTimeIL(now, 0);
  const left = daysBetweenIL(today, end);
  const opensAt = addDaysIL(end, -RENEWAL_WINDOW_DAYS);
  if (left < 0) return { state: 'ended', opensAt, endAt: end, daysLeft: left, text: 'החוזה הסתיים' };
  if (left <= RENEWAL_WINDOW_DAYS) return { state: 'open', opensAt, endAt: end, daysLeft: left, text: left === 0 ? 'חלון החידוש פתוח · החוזה מסתיים היום' : `חלון החידוש פתוח · עוד ${left === 1 ? 'יום אחד' : `${left} ימים`}` };
  return { state: 'later', opensAt, endAt: end, daysLeft: left, text: `נפתח ב־${dmy.format(opensAt)}` };
}

// The summary of one client.
//   state: clientState(client, checks, now); files: fileCounts(...) of this client, or null.
// Returns { items: [{ key, short, done, total, left, over, text, sources }], flags: [text],
//   empty, month, renewal }.
export function contractSummary(client, state, checks = {}, { files = null, now = new Date() } = {}) {
  const d = client?.deliverables || {};
  const counted = d.done || {};
  // The protocol's own count: deliverablesPace without the card's counter (it takes the most of both).
  const pace = state ? deliverablesPace({ ...client, deliverables: { ...d, done: {} } }, state, checks, now) : { items: [] };
  const fromProtocol = Object.fromEntries(pace.items.map((x) => [x.key, x.done]));
  // Shoot days held: process 19 closed for the shoot (the main one or a round's).
  if (state) {
    const byId = new Map(state.states.map((s) => [s.proc.id, s]));
    fromProtocol.shoot_days = shootContexts(client).filter((x) => byId.get(`${x.pid}p19`)?.complete).length;
  }
  const totals = { ...d, shoot_days: n(d.shoot_days) + n(d.photo_days) };
  const items = [];
  for (const it of ITEMS) {
    const total = n(totals[it.key]);
    if (!total) continue;
    const sources = { protocol: n(fromProtocol[it.key]), counter: n(counted[it.key]), files: files ? n(files[it.key]) : null };
    const done = Math.max(sources.protocol, sources.counter, sources.files || 0);
    items.push({
      key: it.key, short: it.short, done, total, left: Math.max(0, total - done), over: Math.max(0, done - total),
      text: itemText(it, done, total), sources,
    });
  }
  // Lines added by hand to a custom contract (deliverables.extra, set at signing): shown
  // with what is included, never counted (6.10.2026).
  const extras = (Array.isArray(d.extra) ? d.extra : []).filter((x) => x && String(x.label || "").trim())
    .map((x) => (n(x.qty) > 0 ? `${String(x.label).trim()} × ${n(x.qty)}` : String(x.label).trim()));
  const flags = [...FLAGS.filter((f) => n(d[f.key]) > 0).map((f) => f.text), ...extras];
  return {
    items, flags, extras, empty: !items.length && !flags.length,
    month: client?.deal_at ? contractMonth(client, now) : null,
    renewal: renewalWindow(client, now),
  };
}

// "10/30" for a table cell, or '' when the agreement grants none.
export function ratio(summary, key) {
  const x = summary?.items.find((i) => i.key === key);
  return x ? `${x.done}/${x.total}` : '';
}
