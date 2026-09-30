// The renewals list (station 8, processes 34–35) on year.html: for each client
// whose package ends within 90 days, a results summary built from what the system
// already knows, and a renewal quote prefilled from the current package. Pure, no
// DOM (tests/year.test.mjs).
//
// The renewal message to the client stays manual: an offer to renew is advertising
// under the spam law (system-plan section 7: consent or the existing-client
// exemption, with a removal line), so nothing here sends anything. The quote opens in the builder
// (index.html, app/builder.js) as its draft, and the office sends it as always.
import { DELIVERABLES } from './protocol.js';
import { TIERS, INFLUENCERS, PAID_ADDONS } from './catalog.js';
import { emptySelection, reconcile, validateSelection } from './pricing.js';
import { performanceReport } from './protocol-logic.js';
import { deliverablesPace, shootContexts } from './health.js';
import { daysBetweenIL } from './tz.js';
import { monthOf, cycleFrom, monthState } from './year-logic.js';
import { readSurvey, isNps, severeScore, average } from './surveys.js';

// ── Satisfaction ───────────────────────────
// The client's answers in public.client_surveys (stage 4, decision 28; the shape in
// app/surveys.js): the 1–5 questions after the shoot and the first delivery, and the
// 0–10 recommendation before the renewal. year.html reads this client's rows
// (app/year-data.js loadSurveys); null when the table could not be read.
export function surveySummary(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const answers = rows.map(readSurvey).filter(Boolean);
  const five = answers.filter((r) => !isNps(r.kind));
  const ten = answers.filter((r) => isNps(r.kind));
  if (!five.length && !ten.length) return null;
  const avg = (xs) => Math.round(average(xs.map((r) => r.score)) * 10) / 10;
  const parts = [];
  if (five.length) parts.push(`${avg(five)} מתוך 5 (${five.length === 1 ? 'תשובה אחת' : `${five.length} תשובות`})`);
  if (ten.length) parts.push(`המלצה ${avg(ten)} מתוך 10`);
  return { text: parts.join(' · '), low: answers.some((r) => severeScore(r.kind, r.score)), count: answers.length };
}

// ── Results summary ────────────────────────
// What was delivered against the package, shoot days held, processes closed on
// time, the monthly cycle, and satisfaction. Lines of { key, label, text, warn }.
export function resultsSummary(client, state, checks = {}, { marks = {}, surveys = null, now = new Date() } = {}) {
  const lines = [];
  const pace = deliverablesPace(client, state, checks, now);
  for (const x of pace.items) {
    const d = DELIVERABLES.find((y) => y.key === x.key);
    lines.push({ key: x.key, label: d?.label || x.key, text: `${x.done} מתוך ${x.total}`, warn: !!x.behind });
  }
  const byId = new Map(state.states.map((s) => [s.proc.id, s]));
  const shoots = shootContexts(client);
  const held = shoots.filter((x) => byId.get(`${x.pid}p19`)?.complete).length;
  const planned = Math.max(Number(client.deliverables?.shoot_days) || 0, shoots.length);
  if (planned) lines.push({ key: 'shoots', label: 'ימי צילום', text: `${held} מתוך ${planned}`, warn: false });
  const since = Math.max(1, daysBetweenIL(new Date(client.deal_at || now), now) + 1);
  const perf = performanceReport([client], { [client.id]: checks }, { days: since, now });
  const done = perf.processes.reduce((a, p) => a + p.done, 0);
  const onTime = perf.processes.reduce((a, p) => a + p.onTime, 0);
  lines.push({
    key: 'ontime', label: 'בזמן',
    text: done ? `${Math.round((onTime / done) * 100)}% (${onTime} מתוך ${done} תהליכים)` : 'אין עדיין תהליכים שנסגרו במערכת',
    warn: done > 0 && onTime / done < 0.8,
  });
  const m = monthOf(client, now);
  const from = cycleFrom(client, state);
  if (m && from !== null && m.n >= from) {
    let total = 0;
    let got = 0;
    for (let n = from; n <= m.n; n += 1) {
      const s = monthState(client, n, marks, now, from);
      total += s.total;
      got += s.done;
    }
    lines.push({ key: 'cycle', label: 'מחזור חודשי (טיוטה)', text: `${got} מתוך ${total} פריטים`, warn: false });
  }
  const sat = surveySummary(surveys);
  lines.push({ key: 'satisfaction', label: 'שביעות רצון', text: sat ? sat.text : 'אין עדיין ציונים במערכת', warn: !!sat?.low });
  return lines;
}

// Where process 34 stands: not started, started (how many of its items), done.
export function renewalStage(state, checks = {}) {
  const s = state.states.find((x) => x.proc.id === 'p34');
  if (!s) return { key: 'none', text: '' };
  const items = s.proc.items.filter((i) => !i.optional);
  const got = items.filter((i) => ['done', 'na'].includes(checks[i.key]?.state)).length;
  if (s.complete) return { key: 'done', text: 'תהליך 34 הושלם' };
  if (!got) return { key: 'new', text: 'תהליך 34 עוד לא התחיל', late: s.status === 'overdue' };
  return { key: 'started', text: `תהליך 34: ${got} מתוך ${items.length}`, late: s.status === 'overdue' };
}

// ── The renewal quote ──────────────────────
// The builder's draft (app/builder.js keeps it in this tab's session storage).
export const QUOTE_DRAFT_KEY = 'astrateg-draft';
export const BUILDER_URL = './';

// The current package as a builder selection: the signed agreement's own selection
// when there is one, otherwise read from the package's name and the shoot type.
export function selectionFor(client, model = null) {
  const base = emptySelection();
  const from = model?.selection;
  if (from && TIERS.some((t) => t.id === from.tier) && INFLUENCERS[from.influencer]) {
    const sel = {
      ...base, ...from, docType: 'quote',
      paid: (Array.isArray(from.paid) ? from.paid : []).filter((id) => PAID_ADDONS.some((a) => a.id === id)),
      free: { ...base.free, ...(from.free || {}) },
    };
    const { selection } = reconcile(sel);
    try { validateSelection(selection); return selection; } catch { /* fall back to the package only */ }
    return reconcile({ ...base, tier: from.tier, influencer: from.influencer, docType: 'quote' }).selection;
  }
  const name = String(client?.package_name || '');
  // The longest tier name first: "Social + TV all in one" also holds "all in one".
  const tier = [...TIERS].sort((a, b) => b.name.length - a.name.length).find((t) => name.includes(t.name))?.id || null;
  const influencer = client?.shoot_type === 'natali' ? 'natali' : client?.shoot_type === 'dms' ? 'simeon'
    : Object.values(INFLUENCERS).find((i) => name.includes(i.name))?.id || null;
  if (!tier && !influencer) return null;
  return reconcile({ ...base, tier: tier || base.tier, influencer: influencer || base.influencer, docType: 'quote' }).selection;
}

// The builder's draft for a renewal: the package, and the client's details from the
// agreement (else the card's name and business). Null when the package is unknown.
export function renewalDraft(client, model = null) {
  const state = selectionFor(client, model);
  if (!state) return null;
  const c = model?.client || {};
  const s = (v) => (typeof v === 'string' ? v : '');
  return {
    state,
    client: {
      'c-name': s(c.name) || s(client.name), 'c-company': s(c.company) || s(client.business),
      'c-companyid': s(c.companyId), 'c-phone': s(c.phone), 'c-email': s(c.email), 'c-notes': '',
    },
  };
}

// The package in words, for the list ("Social + TV all in one · נטלי דדון").
export function packageText(client, model = null) {
  const sel = selectionFor(client, model);
  if (!sel) return client?.package_name || '';
  const tier = TIERS.find((t) => t.id === sel.tier)?.name;
  return [tier, INFLUENCERS[sel.influencer]?.name].filter(Boolean).join(' · ');
}
