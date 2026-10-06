// The Metricool function's work, free of Deno APIs so node tests it
// (tests/metricool.test.mjs) with a faked fetch and a faked database:
//   listBrands    the account's brands, for "חיבור למותג ב-Metricool" (the office);
//   checkAccount  "בדיקת חיבור": the token works, the account's name and how many brands;
//   runSync       one tick: every connected client's planner onto its Gantt.
// The rules are app/metricool-logic.js (the copy in ../_shared/app). The token and the
// user id come in as `config` and never leave: not in a result, not in an error (only
// short codes), not in a log line.
import {
  brandsUrl, postsUrl, getJson, parseBrands, accountName, parsePosts, planSync, windowOf, PAUSE_MS, RUN_BUDGET_MS,
} from '../_shared/app/metricool-logic.js';

// Only the office's own site may call the function from a browser.
export const SITE_ORIGINS = ['https://adamsin155.github.io', 'https://app.astrateg.tech'];
export function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
  if (SITE_ORIGINS.includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(String(origin || ''))) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}
export const bearer = (header) => /^Bearer\s+(\S+)$/i.exec(String(header || ''))?.[1] || null;
// brands: the office. check: the owner. sync: pg_cron, with the x-cron-secret header.
export const ACTIONS = new Set(['brands', 'check', 'sync']);
export const OFFICE = ['irit', 'lior', 'ofir', 'ilai'];
// From a staff row ({ person } or null): what this caller may ask for.
export const mayCall = (action, staffRow) => {
  if (!staffRow) return false;
  const owner = staffRow.person === null || staffRow.person === undefined;
  if (action === 'check') return owner;
  if (action === 'brands') return owner || OFFICE.includes(staffRow.person);
  return false;
};

const codeOf = (e) => String(e?.code || 'server_error').slice(0, 60);
const ready = (config) => !!config?.user_token && !!config?.user_id;

export async function listBrands({ fetch, config }) {
  if (!ready(config)) return { status: 409, body: { error: 'not_ready' } };
  try {
    const json = await getJson(fetch, brandsUrl({ userId: config.user_id }), config.user_token);
    return { status: 200, body: { brands: parseBrands(json) } };
  } catch (e) {
    return { status: 502, body: { error: codeOf(e) } };
  }
}

export async function checkAccount({ fetch, config }) {
  if (!ready(config)) return { status: 200, body: { ok: false, error: 'not_ready' } };
  try {
    const json = await getJson(fetch, brandsUrl({ userId: config.user_id }), config.user_token);
    return { status: 200, body: { ok: true, account: accountName(json), brands: parseBrands(json).length } };
  } catch (e) {
    return { status: 200, body: { ok: false, error: codeOf(e) } };
  }
}

// One tick. db: { clients(): [{ id, metricool_blog_id }] least recently synced first,
// rows(clientId): the client's Gantt rows, apply(clientId, ops, ok, error, stats) }.
// One brand at a time with a pause between two; a 429 (or a rejected token) stops the
// run, and the clients not reached wait for the next tick, where they come first.
// Returns counts only: { clients, synced, failed, changed, stopped }.
export async function runSync({ db, fetch, config, now = new Date(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), clock = () => Date.now() }) {
  const stats = { clients: 0, synced: 0, failed: 0, changed: 0, stopped: null };
  if (!config?.enabled) return { ...stats, stopped: 'off' };
  if (!ready(config)) return { ...stats, stopped: 'not_ready' };
  const clients = await db.clients();
  stats.clients = clients.length;
  const started = clock();
  const window = windowOf(now);
  let first = true;
  for (const c of clients) {
    if (clock() - started > RUN_BUDGET_MS) { stats.stopped = 'budget'; break; }
    if (!first) await sleep(PAUSE_MS);
    first = false;
    let listing;
    try {
      listing = parsePosts(await getJson(fetch, postsUrl({ userId: config.user_id, blogId: c.metricool_blog_id, now }), config.user_token));
    } catch (e) {
      const code = codeOf(e);
      stats.failed += 1;
      await db.apply(c.id, {}, false, code, {});
      if (code === 'rate_limited' || code === 'auth') { stats.stopped = code; break; }
      continue;
    }
    try {
      const plan = planSync({ rows: await db.rows(c.id), posts: listing.posts, window, complete: listing.complete });
      await db.apply(c.id, { update: plan.update, insert: plan.insert, remove: plan.remove }, true, null, { ...plan.stats, partial: !listing.complete });
      stats.synced += 1;
      stats.changed += plan.stats.changed;
    } catch (e) {
      stats.failed += 1;
      await db.apply(c.id, {}, false, 'server_error', {}).catch(() => {});
    }
  }
  return stats;
}
