// The content Gantt (gantt.html): the fixed template (app/gantt-template.js) turned
// into one client's dated plan, the merge with what is already stored (dates moved by
// hand stay unless that is confirmed), and the calendar's helpers. Pure, no DOM:
// the page, its share view and the unit tests (tests/gantt.test.mjs) use it alike.
//
// Every day is an Israel calendar day ('YYYY-MM-DD') and every time an Israel wall
// clock ('HH:MM'), as stored in public.client_gantt (day date, time_il time): no
// device or server time zone, and no daylight-saving shift, can move an entry.
import { GANTT_RULES, GANTT_KINDS, KIND_ORDER, POSTS_FROM, TEMPLATE_VERSION } from './gantt-template.js';
import { monthStart, termOf, spreadMonth } from './year-logic.js';
import { addBusinessDays, isBusinessDay, parseDate, roundsOf } from './protocol-logic.js';
import { holidayOn, erevOn } from './holidays.js';
import { dateIL, dayKeyIL, partsIL, dayFromKeyIL } from './tz.js';
import { KINDS as FILE_KINDS, fileNameOf } from './files-logic.js';

// What to call one of the client's files in the item editor: its label, else the name
// it was uploaded under, else its kind (the client's view has no path); never just "קובץ"
// when anything better is known.
export const fileTitle = (f) => String(f?.label || '').trim() || fileNameOf(f?.storage_path) || FILE_KINDS[f?.kind]?.label || 'קובץ';

const pad = (n) => String(n).padStart(2, '0');
const KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{2}):(\d{2})/;

// ── Days ──────────────────────────────────
// A day key n calendar days later (noon, so no clock change can slip a day).
export function addDays(key, n) {
  const m = KEY.exec(key);
  return dayKeyIL(dateIL(+m[1], +m[2], +m[3] + n, 12));
}
export const weekdayOf = (key) => { const m = KEY.exec(key); return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay(); };
const noonOf = (key) => { const m = KEY.exec(key); return dateIL(+m[1], +m[2], +m[3], 12); };
export const isHoliday = (key) => !!holidayOn(noonOf(key));
export const isErev = (key) => !!erevOn(noonOf(key));
export const holidayName = (key) => holidayOn(noonOf(key))?.name || erevOn(noonOf(key))?.name || null;
// Shabbat (Friday and Saturday) never; holidays and erev chag as the rule says.
export function allowedDay(key, avoid = []) {
  const w = weekdayOf(key);
  if (w === 5 || w === 6) return false;
  if (avoid.includes('holiday') && isHoliday(key)) return false;
  if (avoid.includes('erev') && isErev(key)) return false;
  return true;
}
// The days from `from` up to (not including) `to`.
export function daysBetween(from, to) {
  const out = [];
  for (let d = from; d < to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}
// The moment an entry stands for: its day at its time in Israel (noon when it has none).
export function entryMoment(e) {
  const m = KEY.exec(e?.day || '');
  if (!m) return null;
  const t = TIME.exec(e.time_il || e.time || '');
  return dateIL(+m[1], +m[2], +m[3], t ? +t[1] : 12, t ? +t[2] : 0);
}
export const timeText = (t) => (TIME.exec(t || '') ? TIME.exec(t)[0] : '');

// ── The client's months ───────────────────
// Package month n as [first day, first day of month n + 1) in day keys.
export function monthRange(client, n) {
  const a = monthStart(client, n);
  const b = monthStart(client, n + 1);
  return a && b ? { n, from: dayKeyIL(a), to: dayKeyIL(b) } : null;
}
// The contract's last day: contract_end, else the end of the catalog's term.
export function contractEndKey(client) {
  const end = parseDate(client?.contract_end);
  if (end) return dayKeyIL(end);
  const of = termOf(client);
  const after = monthStart(client, of + 1);
  return after ? dayKeyIL(after) : null;
}
// The package month a day falls in (0 before the deal; of + 1 after the term).
export function packageMonthOf(client, key) {
  const of = termOf(client);
  for (let n = 1; n <= of + 1; n += 1) {
    const r = monthRange(client, n);
    if (r && key < r.to) return key < r.from ? n - 1 : n;
  }
  return of + 1;
}
// The calendar months the contract touches, from the deal's month to the end's.
export function calendarMonths(client) {
  const deal = parseDate(client?.deal_at);
  const endKey = contractEndKey(client);
  if (!deal || !endKey) return [];
  const a = partsIL(deal);
  const [ey, em] = endKey.split('-').map(Number);
  const out = [];
  for (let y = a.year, m = a.month; (y < ey || (y === ey && m <= em)) && out.length < 130; m += 1) {
    if (m > 12) { m = 1; y += 1; }
    if (y > ey || (y === ey && m > em)) break;
    out.push({ year: y, month: m, key: `${y}-${pad(m)}` });
  }
  return out;
}
// A calendar month as weeks of 7 days, Sunday first: [{ key, inMonth }].
export function monthGrid(year, month) {
  const first = `${year}-${pad(month)}-01`;
  let d = addDays(first, -weekdayOf(first));
  const weeks = [];
  do {
    const week = [];
    for (let i = 0; i < 7; i += 1) { week.push({ key: d, inMonth: d.slice(0, 7) === first.slice(0, 7) }); d = addDays(d, 1); }
    weeks.push(week);
  } while (d.slice(0, 7) === first.slice(0, 7));
  return weeks;
}

// ── Placing one rule ──────────────────────
// The allowed day nearest after `key` inside [from, to), else the nearest before it.
function settle(key, from, to, avoid) {
  for (let d = key; d < to; d = addDays(d, 1)) if (allowedDay(d, avoid)) return d;
  for (let d = addDays(key, -1); d >= from; d = addDays(d, -1)) if (allowedDay(d, avoid)) return d;
  return key;
}
// n (≥ 1) business days after the first day of month m (year-logic's due dates).
const businessDayOf = (client, m, n) => dayKeyIL(addBusinessDays(monthStart(client, m), n));
// n business days before month m starts.
function businessDayBefore(client, m, n) {
  let d = dayKeyIL(monthStart(client, m));
  for (let left = n; left > 0;) { d = addDays(d, -1); if (isBusinessDay(noonOf(d))) left -= 1; }
  return d;
}
// The `week`th `weekday` of package month m (the last one when the month has fewer).
function nthWeekday(range, week, weekday) {
  const hits = daysBetween(range.from, range.to).filter((d) => weekdayOf(d) === weekday);
  return hits[Math.min(week, hits.length) - 1] || range.from;
}
// q units over `months` months: how many fall in each (the earlier get the remainder).
export function share(q, months) {
  const base = Math.floor(q / months);
  const rem = q - base * months;
  return Array.from({ length: months }, (_, i) => base + (i < rem ? 1 : 0));
}
// c units on `slots` (day keys), evenly spaced; more units than slots share days.
export function pick(slots, c) {
  if (!slots.length || c <= 0) return [];
  const out = [];
  for (let j = 0; j < c; j += 1) out.push(slots[Math.min(slots.length - 1, Math.floor(((j + 0.5) * slots.length) / c))]);
  return out;
}
const qtyOf = (fn, d) => Math.max(0, Math.min(500, Math.floor(Number(fn ? fn(d) : 0) || 0)));
const hhmm = (d) => { const p = partsIL(d); return `${pad(p.hour)}:${pad(p.minute)}`; };

// ── The plan ──────────────────────────────
// The client's dated plan from the template: [{ key, kind, title, day, time_il, month,
// num, internal }], by day and time. { error } when the deal's date is missing.
export function generatePlan(client, rules = GANTT_RULES) {
  if (!parseDate(client?.deal_at)) return { error: 'no-deal', entries: [] };
  const d = { videos: 0, graphics: 0, shoot_days: 0, collabs: 0, stories: 0, ch14: 0, monthly: 0, ...(client.deliverables || {}) };
  const of = termOf(client);
  const endKey = contractEndKey(client);
  const from = POSTS_FROM;
  const cycle = [];
  for (let m = from; m <= of; m += 1) cycle.push(m);
  const out = [];
  const add = (rule, key, day, title, month, extra = {}) => out.push({
    key, kind: rule.kind, title, day, time_il: rule.time ?? null, month, num: null, internal: !GANTT_KINDS[rule.kind].client, ...extra,
  });
  for (const rule of rules) {
    if (rule.when && !rule.when(d)) continue;
    const avoid = rule.avoid || [];
    if (rule.place === 'spreadPosts') {
      const q = qtyOf(rule.qty, d);
      if (!q || !cycle.length) continue;
      const per = share(q, cycle.length);
      let n = 0;
      cycle.forEach((m, i) => {
        const r = monthRange(client, m);
        const slots = daysBetween(r.from, r.to).filter((x) => rule.weekdays.includes(weekdayOf(x)) && allowedDay(x, avoid));
        for (const day of pick(slots, per[i])) { n += 1; add(rule, `${rule.key}.${n}`, day, rule.title(n), m, { num: rule.numbered ? n : null }); }
      });
    } else if (rule.place === 'perMonth') {
      const c = Math.min(31, Math.max(0, Math.floor(rule.count(d, of)) || 0));
      for (const m of cycle) {
        const r = monthRange(client, m);
        const start = rule.afterBusinessDay ? businessDayOf(client, m, rule.afterBusinessDay) : r.from;
        const slots = daysBetween(start, r.to).filter((x) => rule.weekdays.includes(weekdayOf(x)) && allowedDay(x, avoid));
        pick(slots, c).forEach((day, j) => add(rule, `${rule.key}.${m}.${j + 1}`, day, rule.title(j + 1, m), m));
      }
    } else if (rule.place === 'businessDay') {
      const months = rule.months === 'first' ? cycle.slice(0, 1) : cycle;
      for (const m of months) {
        const day = rule.before ? businessDayBefore(client, m, rule.before) : businessDayOf(client, m, rule.day);
        add(rule, `${rule.key}.${rule.months === 'first' ? 1 : m}`, day, rule.title(m), m);
      }
    } else if (rule.place === 'nthWeekday') {
      const q = qtyOf(rule.qty, d);
      for (let k = 1; k <= q; k += 1) {
        let m;
        if (rule.spread) m = spreadMonth(k, q, from, of);
        else if (k === 1) m = rule.firstMonth;
        else m = spreadMonth(k - 1, q - 1, from, of); // year-logic's "round" k - 1: shoot day k
        const r = monthRange(client, m);
        if (!r) continue;
        // A shoot day already in the card (the main one, or its round's) is the fact.
        const known = rule.kind === 'shoot' ? (k === 1 ? parseDate(client.shoot_at) : parseDate(roundsOf(client).find((x) => Number(x.n) === k)?.shoot_at)) : null;
        if (known) { add(rule, `${rule.key}.${k}`, dayKeyIL(known), rule.title(k, q), Math.max(1, packageMonthOf(client, dayKeyIL(known))), { time_il: hhmm(known) }); continue; }
        add(rule, `${rule.key}.${k}`, settle(nthWeekday(r, rule.week, rule.weekday), r.from, r.to, avoid), rule.title(k, q), m);
      }
    } else if (rule.place === 'fromEnd') {
      if (!endKey) continue;
      let day = addDays(endKey, rule.days);
      if (rule.business) while (!isBusinessDay(noonOf(day))) day = addDays(day, -1);
      add(rule, rule.key, day, rule.title(), Math.min(of, Math.max(1, packageMonthOf(client, day))));
    }
  }
  // Nothing after the contract's end (a shorter last month), nothing before the deal.
  const dealKey = dayKeyIL(parseDate(client.deal_at));
  // `month` is the package month the day falls in (Ilai's plan of month n is in n - 1).
  const entries = out.filter((e) => e.day >= dealKey && (!endKey || e.day <= endKey))
    .map((e) => ({ ...e, month: Math.min(of, Math.max(1, packageMonthOf(client, e.day))) }))
    .sort(byWhen);
  return { error: null, entries, version: TEMPLATE_VERSION, of, endKey };
}
const kindRank = (k) => { const i = KIND_ORDER.indexOf(k); return i < 0 ? 99 : i; };
export function byWhen(a, b) {
  return (a.day < b.day ? -1 : a.day > b.day ? 1 : 0)
    || String(a.time_il || '99').localeCompare(String(b.time_il || '99'))
    || kindRank(a.kind) - kindRank(b.kind)
    || (a.num || 0) - (b.num || 0)
    || String(a.key).localeCompare(String(b.key));
}

// ── Merging with what is stored ───────────
const FIELDS = ['kind', 'title', 'day', 'time_il', 'month', 'num', 'internal'];
const DATE_FIELDS = new Set(['day', 'time_il']);
const norm = (f, v) => {
  if (v === undefined || v === '' || v === null) return null;
  return f === 'time_il' ? String(v).slice(0, 5) : v;
};
const same = (f, a, b) => norm(f, a) === norm(f, b);
// A row the template did not make: added by hand ('custom.<n>'), or a post found in
// Metricool that matches no item ('mc.<post id>', app/metricool-logic.js).
export const isCustom = (row) => row?.kind === 'custom' || /^(custom|mc)\./.test(String(row?.key || ''));
// What "עדכון מהתבנית" does to the stored rows. A row moved by hand (edited) keeps its
// day and time unless `overwrite`; posted state, links, files and notes are never
// touched. A row the template no longer makes is removed only when nothing was done
// with it (not posted, no link, no file, no note, not moved). Custom rows stay.
// Returns { insert: [entry], update: [{ id, key, fields }], remove: [id], keptEdited: [row], orphans: [row] }.
export function planDiff(rows, generated, { overwrite = false } = {}) {
  const byKey = new Map((rows || []).map((r) => [r.key, r]));
  const made = new Set();
  const out = { insert: [], update: [], remove: [], keptEdited: [], orphans: [] };
  for (const g of generated) {
    made.add(g.key);
    const r = byKey.get(g.key);
    if (!r) { out.insert.push({ ...g, edited: false }); continue; }
    if (isCustom(r)) continue;
    const fields = {};
    for (const f of FIELDS) {
      if (DATE_FIELDS.has(f) && r.edited && !overwrite) continue;
      if (!same(f, r[f], g[f])) fields[f] = g[f] ?? null;
    }
    const movedByHand = r.edited && (!same('day', r.day, g.day) || !same('time_il', r.time_il, g.time_il));
    if (r.edited && overwrite) fields.edited = false;
    if (movedByHand && !overwrite) out.keptEdited.push(r);
    if (Object.keys(fields).length) out.update.push({ id: r.id, key: r.key, fields });
  }
  for (const r of rows || []) {
    if (made.has(r.key) || isCustom(r)) continue;
    const used = r.state !== 'planned' || r.link || r.file_id || (r.note && String(r.note).trim()) || r.edited;
    if (used) out.orphans.push(r); else out.remove.push(r.id);
  }
  return out;
}

// ── Showing it ────────────────────────────
// What is stored (public.client_gantt.state): planned → scheduled (it sits in
// Metricool's planner and goes up by itself) → posted; error (the publishing failed)
// and skipped. Who set it is `source`: 'manual' (a person here) or 'metricool' (the sync).
export const STATES = ['planned', 'scheduled', 'posted', 'error', 'skipped'];
// What is shown, never stored:
//   scheduled  in the planner, its time still ahead;
//   posted     marked up, or scheduled and its time has passed (the content went up by
//              itself; the row keeps the fact that it was scheduled);
//   missing    "חסר", the only problem state: a post whose time has passed and that is
//              neither scheduled nor posted;
//   error      the publishing failed; today | planned | past | skipped as before.
export function entryStatus(e, now = new Date()) {
  if (e.state === 'posted') return 'posted';
  if (e.state === 'skipped') return 'skipped';
  if (e.state === 'error') return 'error';
  const at = entryMoment(e);
  if (e.state === 'scheduled') return at && at <= now ? 'posted' : 'scheduled';
  if (!at) return 'planned';
  const today = dayKeyIL(now);
  const post = GANTT_KINDS[e.kind]?.post;
  if (e.day === today) return post && at < now ? 'missing' : 'today';
  if (e.day < today) return post ? 'missing' : 'past';
  return 'planned';
}
export const STATUS_TEXT = { planned: 'מתוכנן', today: 'היום', scheduled: 'תוזמן', missing: 'חסר', posted: 'עלה', error: 'שגיאה', skipped: 'בוטל', past: 'עבר' };
// The client's link shows מתוכנן / תוזמן / עלה only: never "חסר" and never "שגיאה".
export const clientStatus = (s) => (s === 'missing' || s === 'error' ? 'planned' : s);
export const CLIENT_STATUS_TEXT = { ...STATUS_TEXT, missing: STATUS_TEXT.planned, error: STATUS_TEXT.planned };
// One tap on an item: planned (or missing, or failed) → scheduled → posted → planned.
export const nextState = (state) => ({ planned: 'scheduled', error: 'scheduled', scheduled: 'posted', posted: 'planned', skipped: 'planned' }[state] || 'scheduled');
// "סימון כתוזמנו" for a day, a week or a month: the posts in [from, to] (day keys) that
// are still only planned. What is up, cancelled, failed or already scheduled stays.
export const toSchedule = (entries, from, to) => entries.filter((e) => GANTT_KINDS[e.kind]?.post && e.state === 'planned' && e.day >= from && e.day <= to);
// The Israel week (Sunday to Saturday) a day is in: { from, to, days }.
export function weekOf(key) {
  const from = addDays(key, -weekdayOf(key));
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  return { from, to: days[6], days };
}

// Per kind and package month: { kind, months: [{ n, planned, posted, scheduled, missing }] },
// kinds in order. `planned` is everything not cancelled; the rest by entryStatus
// (a failed post counts with the missing ones: both need someone).
export function yearGlance(client, entries, now = new Date()) {
  const of = termOf(client);
  const kinds = [...new Set(entries.map((e) => e.kind))].sort((a, b) => kindRank(a) - kindRank(b));
  return kinds.map((kind) => {
    const months = [];
    for (let n = 1; n <= of; n += 1) months.push({ n, planned: 0, posted: 0, scheduled: 0, missing: 0 });
    for (const e of entries) {
      if (e.kind !== kind || e.state === 'skipped') continue;
      const n = packageMonthOf(client, e.day);
      const cell = months[Math.min(of, Math.max(1, n)) - 1];
      const s = entryStatus(e, now);
      cell.planned += 1;
      if (s === 'posted') cell.posted += 1;
      else if (s === 'scheduled') cell.scheduled += 1;
      else if (GANTT_KINDS[kind]?.post && (s === 'missing' || s === 'error')) cell.missing += 1;
    }
    return { kind, months };
  });
}
// Counts of the posts in a list: all, up, scheduled ahead, missing ("חסרים": past their
// time and neither scheduled nor up) and failed.
export function totals(entries, now = new Date()) {
  const out = { posts: 0, posted: 0, scheduled: 0, missing: 0, errors: 0 };
  for (const e of entries) {
    if (!GANTT_KINDS[e.kind]?.post || e.state === 'skipped') continue;
    const s = entryStatus(e, now);
    out.posts += 1;
    if (s === 'posted') out.posted += 1;
    else if (s === 'scheduled') out.scheduled += 1;
    else if (s === 'missing') out.missing += 1;
    else if (s === 'error') out.errors += 1;
  }
  return out;
}
// The next post still ahead (planned or scheduled), from now on.
export function nextPost(entries, now = new Date()) {
  return entries.filter((e) => GANTT_KINDS[e.kind]?.post && ['planned', 'today', 'scheduled'].includes(entryStatus(e, now)) && entryMoment(e) >= now).sort(byWhen)[0] || null;
}

// ── The index (gantt.html without a client) ─
// One line per client: its package month, the posts of that package month (up,
// scheduled, missing, failed) and the next post. `entries` are the client's rows of
// about a month around today (null: the client has no Gantt yet).
export function clientSummary(client, entries, now = new Date()) {
  const today = dayKeyIL(now);
  const of = termOf(client);
  const n = parseDate(client?.deal_at) ? packageMonthOf(client, today) : 0;
  const range = n >= 1 && n <= of ? monthRange(client, n) : null;
  const rows = entries || [];
  const inMonth = range ? rows.filter((e) => e.day >= range.from && e.day < range.to) : [];
  return { client, has: entries !== null, month: n, of, range, ...totals(inMonth, now), next: nextPost(rows, now) };
}
// "Missing first": the missing and the failed, then clients with a Gantt, then by the
// next post, then by name. 'name': by the business name only.
export function bySummary(a, b, sort = 'missing') {
  const label = (s) => String(s.client.business || s.client.name || '');
  const name = label(a).localeCompare(label(b), 'he');
  if (sort === 'name') return name;
  const when = (s) => (s.next ? `${s.next.day} ${s.next.time_il || '99'}` : '9999');
  return (b.missing + b.errors) - (a.missing + a.errors) || Number(b.has) - Number(a.has) || when(a).localeCompare(when(b)) || name;
}
// "השבוע": the posts of the Israel week of `now` across clients, by day:
// [{ day, items: [{ entry, client, status }] }] for the days that have any.
// entriesByClient: Map client id -> rows.
export function weekAgenda(clients, entriesByClient, now = new Date()) {
  const week = weekOf(dayKeyIL(now));
  const byId = new Map(clients.map((c) => [c.id, c]));
  const items = [];
  for (const [id, entries] of entriesByClient) {
    const client = byId.get(id);
    if (!client) continue;
    for (const e of entries) {
      if (!GANTT_KINDS[e.kind]?.post || e.state === 'skipped' || e.day < week.from || e.day > week.to) continue;
      items.push({ entry: e, client, status: entryStatus(e, now) });
    }
  }
  items.sort((a, b) => byWhen(a.entry, b.entry) || String(a.client.id).localeCompare(String(b.client.id)));
  return week.days.map((day) => ({ day, items: items.filter((x) => x.entry.day === day) })).filter((d) => d.items.length);
}
// Entries of one day key, in order.
export function entriesByDay(entries) {
  const m = new Map();
  for (const e of [...entries].sort(byWhen)) { if (!m.has(e.day)) m.set(e.day, []); m.get(e.day).push(e); }
  return m;
}
// A link that may be shown and opened: https only.
export const safeLink = (v) => (/^https:\/\/[^\s"<>]+$/.test(String(v || '').trim()) ? String(v).trim() : null);
export const DAY_KEY = KEY;
export const TIME_KEY = /^([01]\d|2[0-3]):[0-5]\d$/;
export { dayFromKeyIL };
