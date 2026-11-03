// Lior's four things (the owner's decision of 3.11.2026; protocol v12; docs/ops.md, section 92).
// Lior's protocol work is four things only, each one short:
//   1. the campaign (30): one item, "הקמפיין עלה", with the campaign's start date and its daily
//      budget (₪), kept on the item's own note as JSON: {"start":"2026-11-05","budget":150};
//   2. the pre-shoot form (36, shown as "11ג"): the date and time, the address, who films and the
//      influencers. It writes the client's own fields of the shoot (shoot_at, address, the shoot
//      type, or deliverables.shoot_crew on a day without influencers; a round's entry in
//      clients.rounds), never columns of its own, and closes its item when all are there;
//   3. the scripts (12): one Google Docs link with all of them, kept in clients.links like the
//      Drive folder (`scripts_doc`); saving it closes the item by itself;
//   4. the Zoom (13): one item.
// Pure: no DOM and no database (the forms are app/lior-four-ui.js), so node tests it.
import { INFLUENCERS } from './catalog.js';
import { PHOTOGRAPHERS, SHOOT_TYPES, crewOf } from './protocol.js';
import { inputValueIL, fromInputIL, partsIL } from './tz.js';

export const CAMPAIGN_KEY = 'p30.live';
export const PRESHOOT_KEY = 'p36.form';
export const SCRIPTS_KEY = 'p12.link';
// The key in clients.links of the Google Docs file with all the scripts.
export const SCRIPTS_DOC = 'scripts_doc';
export const SCRIPTS_DOC_LABEL = 'קובץ התסריטים (Google Docs)';
export const baseKey = (key) => String(key || '').replace(/^r\d+\./, '');
const roundPre = (key) => /^(r\d+\.)/.exec(String(key || ''))?.[1] || '';

// ── 1. The campaign ──
// The budget is whole shekels per day; a campaign of 0 ₪ is not a campaign.
export const BUDGET_MAX = 100000;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
export function campaignProblem({ start, budget } = {}) {
  const s = String(start ?? '').trim();
  const b = String(budget ?? '').trim();
  if (!s) return { field: 'start', text: 'חסר תאריך ההתחלה של הקמפיין.' };
  const m = DAY.exec(s);
  const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (!m || d.getUTCMonth() !== +m[2] - 1 || +m[1] < 2020 || +m[1] > 2100) return { field: 'start', text: 'תאריך ההתחלה לא תקין.' };
  if (!b) return { field: 'budget', text: 'חסר התקציב היומי (₪).' };
  const n = Number(b.replace(/[,\s₪]/g, ''));
  if (!Number.isInteger(n) || n <= 0 || n > BUDGET_MAX) return { field: 'budget', text: 'התקציב היומי: מספר שלם של שקלים, גדול מ־0.' };
  return null;
}
// The note of the item, or null when something is missing.
export function campaignNote({ start, budget } = {}) {
  if (campaignProblem({ start, budget })) return null;
  return JSON.stringify({ start: String(start).trim(), budget: Number(String(budget).replace(/[,\s₪]/g, '')) });
}
// What a note holds ({ start, budget }), or null (a plain note, or none: a mark from before v12).
export function readCampaign(note) {
  let v = null;
  try { v = JSON.parse(note); } catch { return null; }
  if (!v || typeof v !== 'object' || !DAY.test(String(v.start || '')) || !Number.isInteger(v.budget)) return null;
  return { start: v.start, budget: v.budget };
}
// "התחלה: 5.11.2026 · 150 ₪ ליום".
export function campaignWords(v) {
  if (!v) return '';
  const [y, m, d] = v.start.split('-').map(Number);
  return `התחלה: ${d}.${m}.${y} · ${v.budget.toLocaleString('he-IL')} ₪ ליום`;
}

// ── 3. The scripts' Google Docs link ──
// Only an https:// address of docs.google.com (a document, as the owner asked).
export function scriptsDocProblem(value) {
  const v = String(value ?? '').trim();
  if (!v) return 'הדביקו את הקישור לקובץ התסריטים.';
  let u = null;
  try { u = new URL(v); } catch { /* not an address */ }
  if (!u || u.protocol !== 'https:') return 'זה לא נראה כמו קישור. העתיקו את הכתובת המלאה, שמתחילה ב־https://';
  if (u.hostname !== 'docs.google.com') return 'זה לא קישור של Google Docs. הקישור צריך להתחיל ב־https://docs.google.com/';
  if (/[?&#;]([a-z_]*(password|token|secret|key|auth)|code)=/i.test(v)) return 'אפשר לשמור כאן רק קישור. סיסמאות וקודי גישה לא נשמרים במערכת.';
  return null;
}
export const scriptsDocOf = (client) => {
  const v = client?.links?.[SCRIPTS_DOC];
  return typeof v === 'string' && v ? v : null;
};
// The item keys the saved link closes: the client's own, and each round that has begun (a round
// starts when it was added: its start_at), whose item is still open. One file holds all the
// scripts, so it answers every shoot that is already being prepared.
export function scriptsKeysToClose(client, checks = {}, now = new Date()) {
  if (!scriptsDocOf(client)) return [];
  const keys = [SCRIPTS_KEY];
  for (const r of Array.isArray(client?.rounds) ? client.rounds : []) {
    const at = r?.start_at ? new Date(r.start_at) : null;
    if (Number.isInteger(Number(r?.n)) && at && !Number.isNaN(at.getTime()) && at <= now) keys.push(`r${r.n}.${SCRIPTS_KEY}`);
  }
  return keys.filter((k) => !['done', 'na'].includes(checks[k]?.state));
}
export const SCRIPTS_AUTO_NOTE = 'נסגר לבד: נשמר הקישור לקובץ התסריטים';

// ── 2. The pre-shoot form ──
// The influencers to choose from, one per day (the shoot type of that influencer).
export const INFLUENCER_CHOICES = Object.values(INFLUENCERS).filter((i) => SHOOT_TYPES[i.shootType]).map((i) => [i.shootType, i.name]);
export const PHOTOGRAPHER_CHOICES = Object.values(PHOTOGRAPHERS).map((p) => [p.key, p.name]);
export const DEFAULT_PHOTOGRAPHER = 'eli';

// The shoot the form is about: the client's own (round null) or a round's entry.
export function shootOf(client, round = null) {
  if (!round) return client || {};
  return (Array.isArray(client?.rounds) ? client.rounds : []).find((r) => Number(r.n) === Number(round)) || {};
}
// The form's values for a shoot, as it holds them now.
export function preShootValues(client, round = null) {
  const s = shootOf(client, round);
  const crew = round ? (PHOTOGRAPHERS[s.shoot_crew] && !s.shoot_type ? s.shoot_crew : null) : crewOf(client);
  const type = SHOOT_TYPES[s.shoot_type] ? s.shoot_type : '';
  return {
    at: s.shoot_at ? inputValueIL(new Date(s.shoot_at)) : '',
    address: client?.address || '',
    photographer: crew || DEFAULT_PHOTOGRAPHER,
    influencers: type ? 'yes' : crew ? 'no' : '',
    influencer: type,
  };
}
// Why the form cannot be saved (null: it can). Every field is asked for; with influencers, which.
export function preShootProblem(v = {}) {
  if (!fromInputIL(v.at)) return { field: 'at', text: 'חסרים התאריך והשעה של יום הצילום.' };
  if (!String(v.address || '').trim()) return { field: 'address', text: 'חסרה הכתובת של יום הצילום.' };
  if (v.influencers !== 'yes' && v.influencers !== 'no') return { field: 'influencers', text: 'יש משפיענים ביום הצילום? בחרו כן או לא.' };
  if (v.influencers === 'yes' && !SHOOT_TYPES[v.influencer]) return { field: 'influencer', text: 'בחרו אילו משפיענים מגיעים.' };
  if (v.influencers === 'no' && !PHOTOGRAPHERS[v.photographer]) return { field: 'photographer', text: 'בחרו מי מצלם.' };
  return null;
}
// What the form writes, for updateClient: the client's own shoot, or the whole rounds list with
// that round's entry changed. With influencers the type is written and the crew taken away (a day
// with influencers is always filmed by Eli: photographerOf); without them, the photographer.
export function preShootPatch(client, round, v) {
  const at = fromInputIL(v.at)?.toISOString() || null;
  const address = String(v.address || '').trim() || null;
  const withInf = v.influencers === 'yes';
  const out = {};
  if (address !== (client?.address ?? null)) out.address = address;
  if (!round) {
    out.shoot_at = at;
    const d = { ...(client?.deliverables || {}) };
    if (withInf) {
      out.shoot_type = v.influencer;
      if (Object.prototype.hasOwnProperty.call(d, 'shoot_crew')) { delete d.shoot_crew; out.deliverables = d; }
    } else {
      out.shoot_type = null;
      out.deliverables = { ...d, shoot_crew: v.photographer };
    }
    return out;
  }
  out.rounds = (Array.isArray(client?.rounds) ? client.rounds : []).map((r) => {
    if (Number(r.n) !== Number(round)) return r;
    const { shoot_crew: _old, ...rest } = r;
    return withInf ? { ...rest, shoot_at: at, shoot_type: v.influencer } : { ...rest, shoot_at: at, shoot_type: null, shoot_crew: v.photographer };
  });
  return out;
}
// Whether the shoot holds everything the form asks (then its item is done).
export const preShootComplete = (client, round = null) => !preShootProblem(preShootValues(client, round));
export const PRESHOOT_NOTE = 'הטופס המקדים נשמר';
// The round of an item key (`r2.p36.form`: 2; the client's own: null).
export const roundOfKey = (key) => { const m = /^r(\d+)\./.exec(String(key || '')); return m ? Number(m[1]) : null; };
export const keyFor = (base, round) => (round ? `r${round}.${base}` : base);
export { roundPre };
// "יום ג׳ 5.11 · 10:00" style words of a saved shoot, for the summary line.
export function preShootWords(client, round = null) {
  const v = preShootValues(client, round);
  if (!v.at) return '';
  const p = partsIL(fromInputIL(v.at));
  const who = v.influencers === 'yes' ? (INFLUENCER_CHOICES.find(([k]) => k === v.influencer)?.[1] || '') : `בלי משפיענים · ${PHOTOGRAPHERS[v.photographer]?.name || ''}`;
  return [`${p.day}.${p.month} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`, v.address, who].filter(Boolean).join(' · ');
}
