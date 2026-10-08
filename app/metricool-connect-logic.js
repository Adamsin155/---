// "לקוחות שלא מחוברים ל-Metricool" (the owner's request of 6.10.2026; docs/ops.md,
// section 33): one card in Ilai's "המשימות שלי" with every active client that has no
// Metricool brand, the oldest deal first. A client leaves the list when it is
// connected to its brand (clients.metricool_blog_id, public.gantt_set_brand), or when
// Ilai or the owner says it has no brand and needs none (clients.metricool_none,
// public.metricool_set_none). It reads only what is stored on the client: nothing
// here depends on the sync or on its switch.
// Pure, no DOM and no network: the card (app/metricool-connect-ui.js) and the unit
// tests read the same rules. The database decides who may write
// (public.can_edit_gantt(): Ilai and the owner).
import { suggestBrand } from './metricool-logic.js';
import { partsIL } from './tz.js';

const OWNER = 'owner';
// Who connects a client to its brand, and so who has the card. The same two as
// public.can_edit_gantt(); tests/sql/metricool-none.test.mjs holds the two lists equal.
export const CONNECTORS = [OWNER, 'ilai'];
const personOfViewer = (viewer) => {
  if (!viewer || viewer.error) return null;
  if (viewer.me) return viewer.me;
  return viewer.scope === 'office' ? OWNER : null;
};
export const canConnect = (viewer) => CONNECTORS.includes(personOfViewer(viewer));
// Where the card is shown (8.10.2026). Connecting the clients is Ilai's task: his
// "המשימות שלי" always has the card. The owners may connect too, but it is not their
// own task: not in their personal "המשימות שלי" (#mine), only in the manager profile's
// "עבודת הצוות" (#team), where it was.
export const showsCard = (viewer, personal = false) => canConnect(viewer) && !(personal && personOfViewer(viewer) === OWNER);

// The first rows shown; the rest wait behind "הצג עוד".
export const CONNECT_CAP = 8;

const inWork = (c) => (c.status === 'active' || c.status === 'ending') && !c.archived_at;
const time = (v) => { const t = v ? new Date(v).getTime() : NaN; return Number.isNaN(t) ? Infinity : t; };
const byName = (a, b) => clientLabel(a).localeCompare(clientLabel(b), 'he');

// "העסק · איש הקשר", as everywhere a client is named in one line.
export const clientLabel = (c) => (c?.business && c.business !== c.name ? `${c.business} · ${c.name}` : c?.name || c?.business || '');

// The list: active (or ending), not archived, no brand, not marked "no brand needed".
// The oldest deal first; a client with no deal date last.
export function unconnected(clients) {
  return (clients || []).filter((c) => inWork(c) && !c.metricool_blog_id && !c.metricool_none)
    .sort((a, b) => (time(a.deal_at) - time(b.deal_at)) || byName(a, b));
}
// The clients marked "no brand needed", for the way back.
export function withoutBrand(clients) {
  return (clients || []).filter((c) => inWork(c) && !c.metricool_blog_id && c.metricool_none).sort(byName);
}
// The brands other clients already use (any client: one brand, one client).
export const takenBy = (clients, clientId) => (clients || []).filter((c) => c.id !== clientId && c.metricool_blog_id).map((c) => String(c.metricool_blog_id));

// The select of one client: every brand of the account, the ones another client uses
// marked and not choosable, and the one suggested by the name chosen in advance.
// → { options: [{ id, label, taken, suggested }], pick: id or '' }
export function brandChoices(client, brands, taken = []) {
  const used = new Set(taken.map(String));
  const hint = suggestBrand(client, brands || [], [...used]);
  const options = (brands || []).map((b) => ({ id: String(b.id), label: b.label, taken: used.has(String(b.id)), suggested: hint?.brand.id === b.id }));
  return { options, pick: hint ? String(hint.brand.id) : '' };
}
export const optionText = (o) => `${o.label}${o.taken ? ' (מחובר ללקוח אחר)' : o.suggested ? ' (הצעה לפי השם)' : ''}`;

// "עסקה מ־12.3.2026" (the day in Israel): why the row is where it is.
export function sinceText(dealAt) {
  const d = dealAt ? new Date(dealAt) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  const p = partsIL(d);
  return `עסקה מ־${p.day}.${p.month}.${p.year}`;
}

export const cardTitle = (n) => `לקוחות שלא מחוברים ל־Metricool (${n})`;
export const withoutTitle = (n) => `סומנו ״אין מותג״ (${n})`;
export const ganttUrl = (clientId) => `gantt.html?id=${encodeURIComponent(clientId)}`;

// What the database answered, in words.
export function explainConnect(err) {
  const msg = `${err?.message || ''} ${err?.code || ''}`;
  if (/brand_taken/.test(msg)) return 'המותג הזה כבר מחובר ללקוח אחר.';
  if (/connected:/.test(msg)) return 'הלקוח כבר מחובר למותג. הרשימה רועננה.';
  if (/client not found/.test(msg)) return 'הלקוח לא נמצא. הרשימה רועננה.';
  if (/not allowed|42501|permission denied/.test(msg)) return 'רק עילאי והבעלים מחברים לקוח למותג.';
  return 'לא נשמר. נסו שוב.';
}
