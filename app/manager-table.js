// The manager table (owner.html#table): every client in one row, with what the
// contract grants and where the client is. Sorting, filters, search and the CSV
// export. Pure, no DOM (tests/manager.test.mjs); the page is app/owner.js.
// The price columns exist only for a viewer who sees the money (seesFinance in
// app/manager-rules.js: the owner, Irit and Ofir, never Lior); for anyone else they
// are not built at all, so they cannot reach the screen or the CSV.
import { PEOPLE, SHOOT_TYPES, CLIENT_STATUS, STATIONS } from './protocol.js';
import { COLORS, shootContexts } from './health.js';
import { contractSummary, ratio } from './contract-summary.js';
import { parseDate } from './protocol-logic.js';
import { dayKeyIL } from './tz.js';

const COLOR_RANK = { red: 0, yellow: 1, green: 2 };
const dmy = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: '2-digit' });
const ils = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 });
export const dayText = (d) => (d ? dmy.format(d) : '');
export const moneyText = (agorot) => (Number.isFinite(agorot) ? `${ils.format(Math.round(agorot / 100))} ₪` : '');
const nameOf = (k) => PEOPLE[k]?.name || k || '';

// The shoot day to show: the next one ahead, or the last one held.
export function shootOf(client, now = new Date()) {
  const days = shootContexts(client).map((x) => parseDate(x.ctx.shoot_at)).filter(Boolean).sort((a, b) => a - b);
  return days.find((d) => dayKeyIL(d) >= dayKeyIL(now)) || days.at(-1) || null;
}

// One row per client.
//   entry: { client, state, health (null for a client without a colour), station (or null) }
//   finance: manager_client_finance() rows by client id (only for a viewer who sees money)
//   files: fileCounts by client id (app/contract-summary.js), or null
export function tableRow(entry, { checks = {}, finance = null, files = null, now = new Date() } = {}) {
  const c = entry.client;
  const st = entry.station;
  const summary = contractSummary(c, entry.state, checks[c.id] || {}, { files: files ? files[c.id] || {} : null, now });
  const step = st?.current ? { what: st.current.what, who: st.current.who, waiting: st.current.waiting }
    : st?.next ? { what: st.next.what, who: st.next.who, waiting: false } : null;
  const f = finance ? finance[c.id] || null : undefined;
  return {
    id: c.id,
    name: c.business || c.name || '',
    contact: c.business && c.name && c.name !== c.business ? c.name : '',
    package: c.package_name || '',
    shootType: c.shoot_type ? SHOOT_TYPES[c.shoot_type]?.name || '' : '',
    status: c.status,
    statusText: CLIENT_STATUS[c.status] || c.status || '',
    signedAt: parseDate(f?.signed_at) || parseDate(c.deal_at),
    endAt: parseDate(c.contract_end),
    stationIndex: st ? st.index : null,
    station: st ? st.title : '',
    stationKey: st ? st.key : '',
    color: entry.health?.color || null,
    reason: entry.health?.reasons?.[0]?.text || '',
    step: step ? `${step.what}${step.waiting ? ' · ממתין ללקוח' : ''}` : '',
    stepWho: step?.who || '',
    editor: c.editor || (c.editor_name ? 'other' : ''),
    editorName: c.editor ? nameOf(c.editor) : c.editor_name || '',
    shootAt: shootOf(c, now),
    videos: summary.items.find((x) => x.key === 'videos') || null,
    graphics: summary.items.find((x) => x.key === 'graphics') || null,
    shootDays: summary.items.find((x) => x.key === 'shoot_days') || null,
    renewal: summary.renewal,
    summary,
    monthly: f === undefined ? undefined : f?.monthly_gross_agorot ?? null,
    term: f === undefined ? undefined : f?.term_gross_agorot ?? null,
    quote: f?.quote_number || '',
  };
}

// The columns, in order. `money`: only for a viewer who sees the prices. `sort`: the
// value a column sorts by; `csv`: its text in the export.
const pct = (x) => (x ? x.done / x.total : -1);
const BASE_COLUMNS = [
  { key: 'name', label: 'עסק', sort: (r) => r.name, csv: (r) => r.name },
  { key: 'package', label: 'חבילה', sort: (r) => r.package, csv: (r) => r.package },
  { key: 'signed', label: 'נחתם', sort: (r) => (r.signedAt ? +r.signedAt : null), csv: (r) => dayText(r.signedAt) },
  { key: 'end', label: 'סיום חוזה', sort: (r) => (r.endAt ? +r.endAt : null), csv: (r) => dayText(r.endAt) },
  { key: 'monthly', label: 'חודשי כולל מע״מ', money: true, num: true, sort: (r) => r.monthly, csv: (r) => moneyText(r.monthly) },
  { key: 'term', label: 'סה״כ חוזה', money: true, num: true, sort: (r) => r.term, csv: (r) => moneyText(r.term) },
  { key: 'station', label: 'תחנה', sort: (r) => r.stationIndex, csv: (r) => r.station },
  { key: 'color', label: 'מצב', sort: (r) => (r.color ? COLOR_RANK[r.color] : null), csv: (r) => (r.color ? `${COLORS[r.color]}${r.reason ? ` · ${r.reason}` : ''}` : r.statusText) },
  { key: 'step', label: 'הצעד הבא', sort: (r) => r.step, csv: (r) => [r.step, nameOf(r.stepWho)].filter(Boolean).join(' · ') },
  { key: 'editor', label: 'עורך', sort: (r) => r.editorName, csv: (r) => r.editorName },
  { key: 'shoot', label: 'יום צילום', sort: (r) => (r.shootAt ? +r.shootAt : null), csv: (r) => dayText(r.shootAt) },
  { key: 'videos', label: 'סרטונים', num: true, sort: (r) => pct(r.videos), csv: (r) => ratio(r.summary, 'videos') },
  { key: 'graphics', label: 'גרפיקות', num: true, sort: (r) => pct(r.graphics), csv: (r) => ratio(r.summary, 'graphics') },
  { key: 'renewal', label: 'חלון חידוש', sort: (r) => (r.renewal ? r.renewal.daysLeft : null), csv: (r) => r.renewal?.text || '' },
];
export function columnsFor(showMoney) {
  return BASE_COLUMNS.filter((c) => !c.money || showMoney);
}

// ── Filters and search ──────────────────────
// { station: key|'' , color: 'red'|'yellow'|'green'|'', editor: key|'', status: 'open'|'all'|key, q: text }
export const DEFAULT_FILTERS = { station: '', color: '', editor: '', status: 'open', q: '' };
const norm = (s) => String(s || '').toLowerCase().replace(/[‎‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim();
export function filterRows(rows, f = DEFAULT_FILTERS) {
  const q = norm(f.q);
  return rows.filter((r) => (!f.station || r.stationKey === f.station)
    && (!f.color || r.color === f.color)
    && (!f.editor || r.editor === f.editor)
    && (f.status === 'all' || (f.status === 'open' || !f.status ? r.status === 'active' || r.status === 'ending' : r.status === f.status))
    && (!q || [r.name, r.contact, r.package, r.editorName, r.station, r.quote].some((x) => norm(x).includes(q))));
}

// Empty values go last in either direction; ties by name.
export function sortRows(rows, key = 'color', dir = 'asc', columns = BASE_COLUMNS) {
  const col = columns.find((c) => c.key === key) || BASE_COLUMNS[0];
  const sign = dir === 'desc' ? -1 : 1;
  const empty = (v) => v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v));
  return [...rows].sort((a, b) => {
    const x = col.sort(a);
    const y = col.sort(b);
    if (empty(x) !== empty(y)) return empty(x) ? 1 : -1;
    let c = 0;
    if (!empty(x)) c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'he');
    return c * sign || a.name.localeCompare(b.name, 'he');
  });
}

// The choices each filter offers, from the rows themselves.
export function filterOptions(rows) {
  const editors = new Map();
  for (const r of rows) if (r.editor) editors.set(r.editor, r.editor === 'other' ? 'עורך חיצוני' : r.editorName);
  return {
    stations: STATIONS.map((s) => [s.key, s.title]),
    colors: Object.entries(COLORS),
    editors: [...editors.entries()].sort((a, b) => a[1].localeCompare(b[1], 'he')),
    statuses: [['open', 'פעילים ומסיימים'], ...Object.entries(CLIENT_STATUS), ['all', 'כולם']],
  };
}

// ── CSV ─────────────────────────────────────
// Excel opens it in Hebrew with the BOM. A cell that starts like a formula is kept as text.
const cell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function toCsv(rows, columns) {
  const lines = [columns.map((c) => cell(c.label)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => cell(c.csv(r))).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}
export const csvName = (now = new Date()) => `astrateg-clients-${dayKeyIL(now)}.csv`;
