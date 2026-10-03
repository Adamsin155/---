// Writing the shoot day's scripts (scripts.html, process 12): the rules of the page,
// with no browser and no database, so they are tested on their own
// (tests/scripts.test.mjs).
//   - how many script slots a client gets: the package's video count (20, 25, 42…),
//     or more when more were written; slot n is "תסריט n";
//   - the inspiration links: https addresses, typed or pasted, several at once;
//   - the status of each script (טיוטה / מוכן / אושר) and the page's progress;
//   - which protocol marks to offer when every script is ready (12);
//   - the draft kept on the phone while the network is away, and when it wins;
//   - the autosave queue: one write at a time, the typing in between saved right
//     after, retries with growing waits when the network fails, never a silent
//     overwrite of a newer save from another device (a conflict is reported);
//   - the share link's address and its WhatsApp message.
// The database's side: supabase/migrations/20261003120000_scripts.sql.
import { PROCESSES } from './protocol.js';

export const STATUS = { draft: 'טיוטה', ready: 'מוכן', approved: 'אושר' };
export const STATUS_ORDER = ['draft', 'ready', 'approved'];
export const MAX_SLOTS = 200;
export const MAX_LINKS = 10;
export const TITLE_MAX = 300;
export const BODY_MAX = 20000;
export const TOKEN = /^[A-Za-z0-9_-]{43}$/;

const clean = (v) => String(v ?? '').trim();

// ── Slots ─────────────────────────────────
// The package's video count, as a whole number (null when missing or odd).
export function videosOf(client) {
  const v = Number(client?.videos ?? client?.deliverables?.videos);
  return Number.isInteger(v) && v > 0 && v <= MAX_SLOTS ? v : null;
}
// How many slots the page opens: the package's count, or the highest script written
// (a script added beyond the package is never hidden), plus any extra slots added now.
export function slotCount(videos, rows = [], extra = 0) {
  const top = rows.reduce((m, r) => Math.max(m, Number(r.n) || 0), 0);
  return Math.min(MAX_SLOTS, Math.max(videos || 0, top) + Math.max(0, extra));
}
export const emptyScript = (n) => ({ n, title: '', body: '', links: [], status: 'draft', version: null, at: null, by_email: null });
// Slots 1..count, each the saved row or an empty one.
export function slotsOf(rows = [], count = 0) {
  const by = new Map(rows.map((r) => [Number(r.n), r]));
  return Array.from({ length: count }, (_, i) => {
    const r = by.get(i + 1);
    return r ? { ...emptyScript(i + 1), ...r, links: Array.isArray(r.links) ? r.links : [] } : emptyScript(i + 1);
  });
}
export const hasText = (s) => !!(clean(s?.title) || clean(s?.body));
export const scriptLabel = (n) => `תסריט ${n}`;

// ── Progress ──────────────────────────────
export function progressOf(slots) {
  const out = { total: slots.length, draft: 0, ready: 0, approved: 0, written: 0 };
  for (const s of slots) {
    out[s.status in STATUS ? s.status : 'draft'] += 1;
    if (hasText(s)) out.written += 1;
  }
  out.done = out.ready + out.approved;
  out.allReady = out.total > 0 && out.done === out.total;
  out.allApproved = out.total > 0 && out.approved === out.total;
  return out;
}
export function progressText(p) {
  if (!p.total) return 'עוד אין תסריטים.';
  const parts = [`מוכנים ${p.done} מתוך ${p.total}`];
  if (p.approved) parts.push(`אושרו ${p.approved}`);
  return parts.join(' · ');
}

// ── Inspiration links ─────────────────────
// One address as typed: "instagram.com/reel/x" gets https://; only http(s), no
// user or password inside, no spaces; null when it is not a link.
export function normalizeLink(v) {
  let s = clean(v);
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    if (!/^[^\s/]+\.[^\s/]+/.test(s)) return null;
    s = `https://${s.replace(/^\/+/, '')}`;
  }
  if (s.length > 500 || !/^https?:\/\/[^\s"<>]+$/i.test(s)) return null;
  try {
    const u = new URL(s);
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password || !u.hostname.includes('.')) return null;
    return s;
  } catch { return null; }
}
// What was pasted (one or several, separated by spaces, commas or new lines):
// { links: the good ones, without duplicates of each other or of `existing`, bad: the rest }.
export function parseLinks(text, existing = []) {
  const links = [];
  const bad = [];
  const seen = new Set(existing);
  for (const part of String(text ?? '').split(/[\s,]+/).filter(Boolean)) {
    const l = normalizeLink(part);
    if (!l) bad.push(part);
    else if (!seen.has(l)) { seen.add(l); links.push(l); }
  }
  return { links, bad };
}
// A short name for a link: the site and the start of the path.
export function linkName(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '');
    const short = path.length > 24 ? `${path.slice(0, 23)}…` : path;
    return `${host}${short}`;
  } catch { return url; }
}

// ── The protocol (process 12) ─────────────
const P12 = PROCESSES.find((p) => p.id === 'p12');
const roundPre = (round) => (round > 1 ? `r${round}.` : '');
// What the page offers to mark once every script is ready: "the scripts were written"
// and "every video has a clear number" (the slots are numbered). Only the ones still
// open; `blockedBy`: the items they wait for (12א's call) that are not done yet.
export function p12Offer({ slots, checks = {}, round = 1 }) {
  const p = progressOf(slots);
  if (!p.allReady) return null;
  const pre = roundPre(round);
  const done = (k) => checks[k]?.state === 'done' || checks[k]?.state === 'na';
  const keys = ['p12.scripts', 'p12.numbered'].filter((k) => P12.items.some((i) => i.key === k)).map((k) => pre + k).filter((k) => !done(k));
  if (!keys.length) return null;
  const blockedBy = [...new Set(P12.items.filter((i) => keys.includes(pre + i.key)).flatMap((i) => i.requires || []).map((k) => pre + k))]
    .filter((k) => checks[k]?.state !== 'done');
  return { keys, blockedBy, count: p.total };
}

// ── The draft on the phone ─────────────────
// Per client, shoot round and script: what was typed and not yet confirmed saved.
export const draftKey = (clientId, round, n) => `scripts.${clientId}.${round}.${n}`;
const FIELDS = ['title', 'body', 'links', 'status'];
export const contentOf = (s) => ({ title: s?.title ?? '', body: s?.body ?? '', links: Array.isArray(s?.links) ? s.links : [], status: s?.status || 'draft' });
export const sameContent = (a, b) => FIELDS.every((k) => JSON.stringify(contentOf(a)[k]) === JSON.stringify(contentOf(b)[k]));
export const draftText = (s, at = new Date()) => JSON.stringify({ ...contentOf(s), at: new Date(at).toISOString() });
export function readDraft(raw) {
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || typeof v.body !== 'string') return null;
    return { ...contentOf(v), at: v.at || null };
  } catch { return null; }
}
// The draft wins over the saved row when it differs and was written after that row
// was saved (a confirmed save clears the draft, so one left over was never saved).
export function draftWins(draft, row) {
  if (!draft || sameContent(draft, row)) return false;
  return !row?.at || !draft.at || new Date(draft.at) >= new Date(row.at);
}

// ── Autosave ──────────────────────────────
// One queue per script. touch() after every change; the write runs `delay` ms after
// the last one. One write at a time: what is typed during a write is written right
// after it. A failed write (the network) is retried after 3, 10, then every 30
// seconds, and at once on flush() (back online, leaving the page). A conflict (a
// newer save from another device) and a refusal stop the queue until touch() or
// flush() again. onState(state, err): 'dirty' | 'saving' | 'saved' | 'offline' |
// 'conflict' | 'error'. `write()` reads the current text itself.
export const RETRIES = [3000, 10000, 30000];
export function createSaver({ write, onState = () => {}, delay = 1200, retries = RETRIES, timers = globalThis }) {
  let timer = null;
  let inflight = null;
  let pending = false;
  let attempt = 0;
  let stopped = false;
  const schedule = (ms) => { timers.clearTimeout(timer); timer = timers.setTimeout(() => { timer = null; run(); }, ms); };
  async function run() {
    if (inflight) { pending = true; return inflight; }
    if (!pending || stopped) return null;
    pending = false;
    onState('saving');
    inflight = (async () => {
      try {
        await write();
        attempt = 0;
        return true;
      } catch (err) {
        pending = true;
        if (err?.conflict) { stopped = true; onState('conflict', err); return false; }
        if (err?.fatal) { stopped = true; onState('error', err); return false; }
        const wait = retries[Math.min(attempt, retries.length - 1)];
        attempt += 1;
        onState('offline', err);
        schedule(wait);
        return false;
      }
    })();
    const ok = await inflight;
    inflight = null;
    if (ok) {
      if (pending) return run();
      onState('saved');
    }
    return ok;
  }
  return {
    touch() { pending = true; stopped = false; onState('dirty'); schedule(delay); },
    flush() { timers.clearTimeout(timer); timer = null; stopped = false; return run(); },
    get dirty() { return pending || !!inflight; },
    get busy() { return !!inflight; },
  };
}
// The words under each script for the saver's state.
export function saveStateText(state, at = null) {
  switch (state) {
    case 'saving': return 'שומר…';
    case 'dirty': return 'עוד לא נשמר';
    case 'offline': return 'אין חיבור: נשמר בטלפון, ננסה שוב לבד';
    case 'conflict': return 'נשמר בינתיים ממכשיר אחר';
    case 'error': return 'לא נשמר';
    case 'saved': return at ? `נשמר · ${at}` : 'נשמר';
    default: return '';
  }
}

// ── The share link ─────────────────────────
export const LINK_DAYS = 180;
export const shareUrl = (base, token) => new URL(`scripts-view.html?t=${encodeURIComponent(token)}`, base).href;
export const shareMessage = (client, url) =>
  `היי, אלה התסריטים ליום הצילום של ${client?.business || client?.name || ''}:\n${url}\nאפשר לפתוח מהטלפון, עם קישורי ההשראה לכל תסריט.`;
