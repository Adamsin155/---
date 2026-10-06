// generated — edit app/ instead. Source: app/metricool-logic.js. Regenerate: node scripts/sync-functions.mjs
// Metricool and the content Gantt: what the office schedules in Metricool's planner is
// read and marked on each client's Gantt (docs/ops.md, section 27). Pure: no DOM, no
// database, and the network only through a `fetch` that is passed in, so the browser
// (the texts and the brand suggestion), node (tests/metricool.test.mjs) and the edge
// function (supabase/functions/metricool, a copy in _shared/app) run the same code.
//
// ── The API, in one place ───────────────────
// Only what Metricool documents (https://app.metricool.com/resources/apidocs/index.html
// and its swagger.json, read 6.10.2026; help.metricool.com "Basic guide for API integration"):
//   base      https://app.metricool.com/api
//   auth      header X-Mc-Auth: <userToken>, and the query parameters userId and blogId
//   brands    GET /admin/simpleProfiles?userId=…            → [PublicBlog]: id, label, title,
//             ownerUsername, deleted, isDemo, timezone, and a field per connected network
//   posts     GET /v2/scheduler/posts?start=…&end=…&timezone=…&userId=…&blogId=…
//             ("Get the scheduled posts between two dates"; start and end as
//             '2011-12-03T10:15:30', timezone as 'Europe/Madrid')
//             → { data: [ScheduledPost] }: id, uuid, publicationDate { dateTime, timezone },
//             text, draft, media [string], providers [{ network, id, status, publicUrl,
//             detailedStatus }], instagramData.type, facebookData.type, youtubeData.type
//   ProviderStatus.status: PUBLISHED | PUBLISHING | PENDING | AWAITING_CONFIRMATION | ERROR | DRAFT
// ASSUMPTIONS (not stated in the documentation; each has one place here to change):
//   1. FORMAT_RULES   the values of instagramData.type / facebookData.type /
//                     youtubeData.type are plain strings in the schema with no list of
//                     values; a story, a reel or video, and a post or carousel are told
//                     apart by the words below, then by the network, then by the media's
//                     file type.
//   2. rate limits    no number is published. The sync goes one brand at a time with
//                     PAUSE_MS between them, stops the run at the first 429 and carries
//                     on from the least recently synced client at the next tick.
//   3. zonedParts     the posts are asked for in Israel time (`timezone`); a
//                     publicationDate that still names another zone is converted.
//   4. paging         the response has `page.next`, with no word on how to follow it.
//                     When it is set, the listing is treated as partial: nothing is
//                     un-scheduled or removed in that run (INCOMPLETE).
//   5. status of a post on several networks: failed when any network failed, published
//                     when all are, otherwise still scheduled (overallStatus).
import { dayKeyIL, partsIL } from './tz.js';

export const API_BASE = 'https://app.metricool.com/api';
export const PATHS = { brands: '/admin/simpleProfiles', posts: '/v2/scheduler/posts' };
export const AUTH_HEADER = 'X-Mc-Auth';
export const ZONE = 'Asia/Jerusalem';
export const DAYS_BACK = 14;
export const DAYS_AHEAD = 60;
export const PAUSE_MS = 400;        // between two brands
export const RUN_BUDGET_MS = 45000; // one tick stops starting new brands after this
export const TIMEOUT_MS = 15000;    // one request

const pad = (n) => String(n).padStart(2, '0');
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const addDays = (key, n) => { const m = DAY.exec(key); return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n)).toISOString().slice(0, 10); };
const hhmm = (t) => (/^(\d{2}):(\d{2})/.exec(String(t || '')) || [''])[0];

// ── Requests ────────────────────────────────
// The window a sync reads: from DAYS_BACK days ago to DAYS_AHEAD days ahead, Israel days.
export function windowOf(now = new Date()) {
  const today = dayKeyIL(now);
  const from = addDays(today, -DAYS_BACK);
  const to = addDays(today, DAYS_AHEAD);
  return { from, to, start: `${from}T00:00:00`, end: `${to}T23:59:59`, timezone: ZONE };
}
export function brandsUrl({ userId }) {
  const q = new URLSearchParams({ userId: String(userId) });
  return `${API_BASE}${PATHS.brands}?${q}`;
}
export function postsUrl({ userId, blogId, now = new Date() }) {
  const w = windowOf(now);
  const q = new URLSearchParams({ start: w.start, end: w.end, timezone: w.timezone, userId: String(userId), blogId: String(blogId) });
  return `${API_BASE}${PATHS.posts}?${q}`;
}

// One GET. Throws { code } and nothing else: never the URL (it holds the user id) and
// never the token. Codes: rate_limited (429), auth (401), denied (403), not_found (404),
// metricool_down (5xx), http_<status>, network, timeout, bad_response.
export async function getJson(fetchFn, url, token, { timeoutMs = TIMEOUT_MS } = {}) {
  const fail = (code) => Object.assign(new Error(code), { code });
  let res;
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    res = await fetchFn(url, { method: 'GET', headers: { [AUTH_HEADER]: token, Accept: 'application/json' }, signal: ctl?.signal });
  } catch (err) {
    throw fail(err?.name === 'AbortError' ? 'timeout' : 'network');
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (res.status === 429) throw fail('rate_limited');
  if (res.status === 401) throw fail('auth');
  if (res.status === 403) throw fail('denied');
  if (res.status === 404) throw fail('not_found');
  if (res.status >= 500) throw fail('metricool_down');
  if (res.status < 200 || res.status >= 300) throw fail(`http_${res.status}`);
  try { return await res.json(); } catch { throw fail('bad_response'); }
}

// ── Brands ──────────────────────────────────
const NETWORK_FIELDS = ['instagram', 'facebook', 'tiktok', 'youtube', 'linkedinCompany', 'twitter', 'threads', 'pinterest', 'gmb'];
// The account's brands as the pages use them: { id, label, networks }. Nothing else of
// a brand leaves the function (no tokens, pictures or ids of the networks).
export function parseBrands(json) {
  const list = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : null;
  if (!list) throw Object.assign(new Error('bad_response'), { code: 'bad_response' });
  return list.filter((b) => b && b.id !== undefined && b.id !== null && !b.deleted && !b.isDemo)
    .map((b) => ({
      id: String(b.id),
      label: String(b.label || b.title || b.instagram || b.facebook || `מותג ${b.id}`).trim().slice(0, 120),
      networks: NETWORK_FIELDS.filter((f) => b[f]).map((f) => (f === 'linkedinCompany' ? 'linkedin' : f)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'he'));
}
// The account's name for "בדיקת חיבור": the owner's user name of the first brand.
export const accountName = (json) => {
  const list = Array.isArray(json) ? json : json?.data || [];
  return String(list.find((b) => b?.ownerUsername)?.ownerUsername || '').slice(0, 120) || null;
};

// A suggestion by name: the brand whose name is closest to the client's business or
// contact name, when it is close enough. Words of a company's form do not count.
const NOISE = new Set(['בעמ', 'בע״מ', 'ltd', 'inc', 'the', 'של', 'and', 'studio', 'official']);
const words = (s) => String(s || '').toLowerCase().replace(/[״"'׳`.,()\-–_/|·]+/g, ' ').split(/\s+/).filter((w) => w && !NOISE.has(w.replace(/[״"]/g, '')));
export function nameScore(a, b) {
  const x = words(a);
  const y = words(b);
  if (!x.length || !y.length) return 0;
  const jx = x.join('');
  const jy = y.join('');
  if (jx === jy) return 1;
  if (jx.length >= 3 && jy.length >= 3 && (jx.includes(jy) || jy.includes(jx))) return 0.8;
  const same = x.filter((w) => y.includes(w)).length;
  return same / Math.max(x.length, y.length);
}
// { brand, score } or null. `taken`: brand ids other clients already use.
export function suggestBrand(client, brands, taken = []) {
  const used = new Set(taken.map(String));
  let best = null;
  for (const b of brands) {
    if (used.has(String(b.id))) continue;
    const score = Math.max(nameScore(client?.business, b.label), nameScore(client?.name, b.label) * 0.9);
    if (score >= 0.5 && (!best || score > best.score)) best = { brand: b, score };
  }
  return best;
}

// ── A post ──────────────────────────────────
// A wall-clock time in a zone, as Israel's day and time (assumption 3).
export function zonedParts(dateTime, timezone = ZONE) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(dateTime || ''));
  if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  const offset = (ms, zone) => {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(ms)).reduce((o, x) => { o[x.type] = +x.value; return o; }, {});
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ms;
  };
  let zone = timezone || ZONE;
  let ms;
  try { ms = wall - offset(wall, zone); ms = wall - offset(ms, zone); } catch { zone = ZONE; ms = wall - offset(wall, zone); ms = wall - offset(ms, zone); }
  const at = new Date(ms);
  const il = partsIL(at);
  return { at: at.toISOString(), day: dayKeyIL(at), time: `${pad(il.hour)}:${pad(il.minute)}` };
}

const PENDING = new Set(['PENDING', 'PUBLISHING', 'AWAITING_CONFIRMATION']);
// One status for a post that goes to several networks (assumption 5).
export function overallStatus(raw) {
  const st = (raw?.providers || []).map((p) => String(p?.status || '').toUpperCase()).filter(Boolean);
  if (raw?.draft || (st.length && st.every((s) => s === 'DRAFT'))) return 'draft';
  if (st.includes('ERROR')) return 'error';
  if (st.length && st.every((s) => s === 'PUBLISHED')) return 'published';
  if (!st.length || st.some((s) => PENDING.has(s) || s === 'PUBLISHED')) return 'pending';
  return 'draft';
}
// Assumption 1: what kind of content a post is.
export const FORMAT_RULES = {
  story: /STORY|STORIES/,
  video: /REEL|VIDEO|SHORT|CLIP/,
  graphic: /POST|CAROUSEL|IMAGE|PHOTO|ALBUM|FEED/,
  videoNetworks: ['tiktok', 'youtube'],
  videoFile: /\.(mp4|mov|m4v|webm|avi)(\?|#|$)/i,
};
export function postFormat(raw, networks = []) {
  const types = [raw?.instagramData?.type, raw?.facebookData?.type, raw?.youtubeData?.type].filter(Boolean).map((t) => String(t).toUpperCase());
  if (types.some((t) => FORMAT_RULES.story.test(t))) return 'story';
  if (types.some((t) => FORMAT_RULES.video.test(t))) return 'video';
  const media = Array.isArray(raw?.media) ? raw.media.map(String) : [];
  if (media.some((u) => FORMAT_RULES.videoFile.test(u))) return 'video';
  if (networks.some((n) => FORMAT_RULES.videoNetworks.includes(n))) return 'video';
  if (types.some((t) => FORMAT_RULES.graphic.test(t)) || media.length) return 'graphic';
  return 'other';
}
const https = (v) => (/^https:\/\/[^\s"<>]+$/.test(String(v || '').trim()) && String(v).trim().length <= 2000 ? String(v).trim() : null);
export const snippet = (text, n = 60) => {
  const line = String(text || '').split(/\r?\n/).map((s) => s.trim()).find(Boolean) || '';
  return line.length > n ? `${line.slice(0, n - 1).trimEnd()}…` : line;
};
// A ScheduledPost as the sync uses it; null when it has no id or no time.
// { id, at, day, time, networks, text, status: pending | published | draft | error, url, format, error }
export function normalizePost(raw) {
  if (!raw || raw.id === undefined || raw.id === null || !/^\d{1,13}$/.test(String(raw.id))) return null;
  const when = zonedParts(raw.publicationDate?.dateTime, raw.publicationDate?.timezone);
  if (!when) return null;
  const providers = Array.isArray(raw.providers) ? raw.providers : [];
  const networks = [...new Set(providers.map((p) => String(p?.network || '').toLowerCase()).filter((n) => /^[a-z0-9_]{1,30}$/.test(n)))];
  const status = overallStatus(raw);
  const failed = providers.find((p) => String(p?.status || '').toUpperCase() === 'ERROR');
  const urls = providers.map((p) => https(p?.publicUrl)).filter(Boolean);
  return {
    id: String(raw.id), ...when, networks, text: snippet(raw.text), status,
    url: urls.find((u) => /instagram\./.test(u)) || urls[0] || null,
    format: postFormat(raw, networks),
    error: status === 'error' ? String(failed?.detailedStatus || failed?.network || '').slice(0, 300) || null : null,
  };
}
// The body of GET /v2/scheduler/posts → { posts, complete } (assumption 4).
export function parsePosts(json) {
  const list = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : null;
  if (!list) throw Object.assign(new Error('bad_response'), { code: 'bad_response' });
  const posts = list.map(normalizePost).filter(Boolean);
  return { posts, complete: !json?.page?.next };
}

// ── Matching posts to the Gantt ─────────────
// Which kinds of entry a post of each format may stand on; an entry someone added by
// hand ('custom') takes any. Earlier in a list is preferred at the same distance.
export const COMPATIBLE = {
  video: ['video', 'monthly', 'collab'],
  graphic: ['graphic', 'monthly', 'highlight'],
  story: ['story'],
  other: [],
};
const minutes = (t) => { const m = /^(\d{2}):(\d{2})/.exec(String(t || '')); return m ? +m[1] * 60 + +m[2] : null; };
function cost(post, row) {
  const kinds = COMPATIBLE[post.format] || [];
  let rank = kinds.indexOf(row.kind);
  if (rank < 0) { if (row.kind !== 'custom') return null; rank = kinds.length + 1; }
  const a = minutes(post.time);
  const b = minutes(row.time_il);
  // An entry with no time of its own is a whole-day one: it matches, after any timed one.
  return (b === null ? 24 * 60 : Math.abs(a - b)) + rank * 0.01;
}
const sameList = (a, b) => (a || []).join(',') === (b || []).join(',');
const sameMoment = (a, b) => (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);
const inWindow = (day, w) => !!day && day >= w.from && day <= w.to;
const MC_NONE = { mc_post_id: null, mc_status: null, mc_at: null, mc_networks: null, mc_error: null };
const extraKey = (post) => `mc.${post.id}`;
const extraTitle = (post) => post.text || `פוסט ב־Metricool${post.networks.length ? ` (${post.networks.join(', ')})` : ''}`;

// What a post means for the entry it stands on. A mark a person made (source 'manual',
// any state but planned) is never changed: only the link to the post is kept, and the
// post's public link fills an empty one.
function effects(row, post) {
  const want = { mc_post_id: post.id, mc_status: post.status, mc_at: post.at, mc_networks: post.networks, mc_error: post.error };
  const manual = row.source !== 'metricool' && row.state !== 'planned';
  if (!manual) {
    want.source = 'metricool';
    if (post.status === 'pending') {
      want.state = 'scheduled';
      if (hhmm(row.time_il) !== post.time) { want.time_il = post.time; want.edited = true; }
    } else if (post.status === 'published') {
      want.state = 'posted';
      want.posted_on = post.day;
      if (!row.link && post.url) want.link = post.url;
    } else if (post.status === 'error') {
      want.state = 'error';
    }
  } else if (post.status === 'published' && !row.link && post.url) {
    want.link = post.url;
  }
  return diff(row, want);
}
// Only what differs from the row: a second run with nothing new writes nothing.
function diff(row, want) {
  const out = {};
  for (const [k, v] of Object.entries(want)) {
    const cur = row[k] ?? null;
    const same = k === 'mc_at' ? sameMoment(cur, v) : k === 'mc_networks' ? sameList(cur, v) : k === 'time_il' ? hhmm(cur) === hhmm(v)
      : k === 'posted_on' ? String(cur || '') === String(v || '') : cur === (v ?? null);
    if (!same) out[k] = v ?? null;
  }
  return out;
}

// One client's sync: the client's Gantt rows and the brand's posts of the window →
// { update: [{ id, fields }], insert: [row], remove: [id], stats, failed: [{ id, key, title, day }] }.
//  - a post stands on one entry: the one it already stood on while it is on the same
//    Israel day; otherwise the nearest in time among the entries of that day whose
//    kind fits (COMPATIBLE), each entry taking one post;
//  - a post no entry fits becomes an extra row ('mc.<post id>', kind 'custom',
//    mc_extra), so the calendar shows what is really scheduled;
//  - a post that left Metricool (or moved to another day) un-schedules only what the
//    sync itself had set, and removes only an extra row nobody touched; and only when
//    the listing was complete and the post's time is inside the window.
export function planSync({ rows = [], posts = [], window, complete = true }) {
  const live = posts.filter((p) => p.status !== 'draft');
  const byId = new Map(live.map((p) => [p.id, p]));
  const linked = new Map(); // row id -> post
  const taken = new Set();  // post ids
  const out = { update: [], insert: [], remove: [], failed: [] };
  const push = (row, fields) => { if (Object.keys(fields).length) out.update.push({ id: row.id, fields }); };

  // 1. Links that still hold.
  for (const r of rows) {
    if (!r.mc_post_id) continue;
    const p = byId.get(String(r.mc_post_id));
    if (p && !taken.has(p.id) && (r.mc_extra || (p.day === r.day && r.state !== 'skipped'))) { linked.set(r.id, p); taken.add(p.id); }
  }
  // 2. New matches: every fitting pair of the same day, nearest first.
  const free = rows.filter((r) => !linked.has(r.id) && !r.mc_extra && !r.internal && r.state !== 'skipped');
  const pairs = [];
  for (const p of live) {
    if (taken.has(p.id)) continue;
    for (const r of free) {
      if (r.day !== p.day) continue;
      const c = cost(p, r);
      if (c !== null) pairs.push({ p, r, c });
    }
  }
  pairs.sort((a, b) => a.c - b.c || a.p.at.localeCompare(b.p.at) || a.p.id.localeCompare(b.p.id) || String(a.r.key).localeCompare(String(b.r.key)));
  for (const { p, r } of pairs) {
    if (taken.has(p.id) || linked.has(r.id)) continue;
    linked.set(r.id, p);
    taken.add(p.id);
  }
  // 3. What each link means; what a lost link means.
  const stats = { posts: posts.length, drafts: posts.length - live.length, matched: 0, extras: 0, scheduled: 0, published: 0, errors: 0 };
  for (const r of rows) {
    const p = linked.get(r.id);
    if (p) {
      if (r.mc_extra) {
        stats.extras += 1;
        const want = { mc_post_id: p.id, mc_status: p.status, mc_at: p.at, mc_networks: p.networks, mc_error: p.error };
        if (r.source === 'metricool') Object.assign(want, extraFields(p), { title: r.title === extraTitle(p) || !p.text ? r.title : extraTitle(p) });
        push(r, diff(r, want));
      } else {
        stats.matched += 1;
        push(r, effects(r, p));
      }
      stats[p.status === 'pending' ? 'scheduled' : p.status === 'published' ? 'published' : 'errors'] += 1;
      if (p.status === 'error') out.failed.push({ id: r.id, key: r.key, title: r.title, day: r.day });
      continue;
    }
    if (!r.mc_post_id && !r.mc_status) continue;
    // The post is gone. Without a complete listing, or outside the window, nothing is known.
    const known = complete && inWindow(r.mc_at ? dayKeyIL(new Date(r.mc_at)) : r.day, window);
    if (!known) continue;
    if (r.mc_extra) { if (r.source === 'metricool') out.remove.push(r.id); else push(r, diff(r, MC_NONE)); continue; }
    const fields = { ...MC_NONE };
    if (r.source === 'metricool' && (r.state === 'scheduled' || r.state === 'error')) { fields.state = 'planned'; fields.source = 'manual'; }
    push(r, diff(r, fields));
  }
  // 4. Posts no entry fits.
  const have = new Set(rows.map((r) => r.key));
  for (const p of live) {
    if (taken.has(p.id) || have.has(extraKey(p))) continue;
    stats.extras += 1;
    stats[p.status === 'pending' ? 'scheduled' : p.status === 'published' ? 'published' : 'errors'] += 1;
    out.insert.push({ key: extraKey(p), title: extraTitle(p), ...extraFields(p), mc_post_id: p.id, mc_status: p.status, mc_at: p.at, mc_networks: p.networks, mc_error: p.error });
    if (p.status === 'error') out.failed.push({ id: null, key: extraKey(p), title: extraTitle(p), day: p.day });
  }
  stats.changed = out.update.length + out.insert.length + out.remove.length;
  return { ...out, stats };
}
function extraFields(p) {
  const state = p.status === 'published' ? 'posted' : p.status === 'error' ? 'error' : 'scheduled';
  return { day: p.day, time_il: p.time, state, posted_on: state === 'posted' ? p.day : null, link: p.url };
}

// The same changes on rows in memory, as public.gantt_sync_apply writes them (the unit
// tests and the browser suites' fake database).
export function applyOps(rows, ops, { newId = () => `mc-${Math.random().toString(36).slice(2)}` } = {}) {
  const gone = new Set(ops.remove || []);
  const out = rows.filter((r) => !(gone.has(r.id) && r.mc_extra && r.source === 'metricool')).map((r) => {
    const u = (ops.update || []).find((x) => x.id === r.id);
    if (!u) return r;
    const next = { ...r, ...u.fields };
    next.posted_on = next.state === 'posted' ? next.posted_on || null : null;
    return next;
  });
  for (const i of ops.insert || []) {
    if (out.some((r) => r.key === i.key)) continue;
    out.push({ id: newId(), kind: 'custom', month: null, num: null, internal: false, file_id: null, note: null, edited: true, source: 'metricool', mc_extra: true, ...i });
  }
  return out;
}

// ── Words ───────────────────────────────────
// A sync's (or a check's) error code in plain Hebrew.
export const ERROR_TEXT = {
  rate_limited: 'Metricool ביקש להאט. הסנכרון ימשיך לבד בעוד רבע שעה.',
  auth: 'Metricool דחה את הטוקן. צריך לבדוק את metricool_user_token ואת metricool_user_id ב־Vault.',
  denied: 'אין לחשבון גישה למותג הזה ב־Metricool. כדאי לבחור את המותג מחדש.',
  not_found: 'המותג לא נמצא ב־Metricool. כדאי לבחור את המותג מחדש.',
  metricool_down: 'Metricool לא ענה (תקלה אצלם). ננסה שוב בסנכרון הבא.',
  network: 'לא הצלחנו להגיע ל־Metricool. ננסה שוב בסנכרון הבא.',
  timeout: 'Metricool לא ענה בזמן. ננסה שוב בסנכרון הבא.',
  bad_response: 'Metricool החזיר תשובה שלא הבנו. ננסה שוב בסנכרון הבא.',
  not_ready: 'חסר סוד של Metricool ב־Vault.',
  off: 'החיבור ל־Metricool כבוי.',
  not_allowed: 'אין לך הרשאה לפעולה הזו.',
  not_signed_in: 'צריך להתחבר מחדש.',
  server_error: 'משהו השתבש אצלנו. נסו שוב בעוד רגע.',
};
export const errorText = (code) => ERROR_TEXT[code] || (/^http_\d+$/.test(String(code)) ? `Metricool החזיר שגיאה (${String(code).slice(5)}).` : ERROR_TEXT.server_error);
// "לפני 4 דקות", "לפני שעה", "לפני 3 שעות", "אתמול", "לפני 5 ימים".
export function agoText(at, now = new Date()) {
  const min = Math.max(0, Math.round((now.getTime() - new Date(at).getTime()) / 60000));
  if (min < 1) return 'עכשיו';
  if (min === 1) return 'לפני דקה';
  if (min < 60) return `לפני ${min} דקות`;
  const h = Math.round(min / 60);
  if (h === 1) return 'לפני שעה';
  if (h === 2) return 'לפני שעתיים';
  if (h < 24) return `לפני ${h} שעות`;
  const d = Math.round(h / 24);
  return d === 1 ? 'אתמול' : d === 2 ? 'לפני יומיים' : `לפני ${d} ימים`;
}
// The line on a client's Gantt. { text, tone: 'ok' | 'warn' | 'off' }.
//   enabled: the owner's switch (null: not known / not built yet); brand: the client's
//   brand name (null: not connected); sync: its client_gantt_sync row (null: none yet).
export function syncLine({ enabled, blogId = null, brand = null, sync = null }, now = new Date()) {
  if (enabled === null || enabled === undefined) return null;
  if (!blogId) return { tone: 'off', text: 'הלקוח לא מחובר למותג ב־Metricool. הסימון ידני.' };
  const name = brand ? `״${brand}״` : 'המותג';
  if (!enabled) return { tone: 'off', text: `מחובר ל${name} ב־Metricool. הסנכרון כבוי, והסימון ידני.` };
  if (!sync) return { tone: 'off', text: `מחובר ל${name} ב־Metricool. הסנכרון הראשון ירוץ ברבע השעה הקרובה.` };
  if (!sync.ok) return { tone: 'warn', text: `הסנכרון מ־Metricool נכשל ${agoText(sync.at, now)}. ${errorText(sync.error)}` };
  return { tone: 'ok', text: `סונכרן מ־Metricool ${agoText(sync.at, now)}` };
}
// The line on the index and on the owner's card, from public.metricool_settings().
export function accountLine(s, now = new Date()) {
  if (!s) return null;
  if (!s.enabled) return { tone: 'off', text: `החיבור ל־Metricool כבוי: מסמנים ״תוזמן״ ו״עלה״ ביד.${s.mapped ? ` ${s.mapped} לקוחות כבר מחוברים למותג.` : ''}` };
  if (!s.mapped) return { tone: 'off', text: 'Metricool פועל, ועוד אין לקוח שמחובר למותג.' };
  const last = s.lastAt ? ` הסנכרון האחרון ${agoText(s.lastAt, now)}.` : ' הסנכרון הראשון ירוץ ברבע השעה הקרובה.';
  if (s.failed) return { tone: 'warn', text: `Metricool פועל: ${s.mapped} לקוחות מחוברים, ${s.failed} נכשלו בסנכרון האחרון.${last} ${errorText(s.lastError)}` };
  return { tone: 'ok', text: `Metricool פועל: ${s.mapped} לקוחות מחוברים.${last}` };
}
