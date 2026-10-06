// Metricool and the content Gantt (app/metricool-logic.js, supabase/functions/metricool/sync.js):
// the requests as Metricool documents them, a post as the sync uses it, which Gantt
// entry a post stands on, what it changes (and what it never changes), the run over
// the clients with a faked fetch, and the reminder to Ilai when a post failed.
// No request ever leaves the machine. Runs under UTC, New York and Jerusalem (npm test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  API_BASE, AUTH_HEADER, brandsUrl, postsUrl, windowOf, getJson, parseBrands, accountName, suggestBrand, nameScore,
  zonedParts, overallStatus, postFormat, normalizePost, parsePosts, planSync, applyOps, COMPATIBLE,
  errorText, ERROR_TEXT, agoText, syncLine, accountLine, PAUSE_MS, snippet,
} from '../app/metricool-logic.js';
import { runSync, listBrands, checkAccount, mayCall, corsHeaders, ACTIONS } from '../supabase/functions/metricool/sync.js';
import { buildEnv, candidates } from '../app/reminder-engine.js';
import { RULES } from '../app/reminder-rules.js';
import { GANTT_KINDS } from '../app/gantt-template.js';
import { entryStatus } from '../app/gantt-logic.js';
import { dateIL } from '../app/tz.js';

const NOW = dateIL(2026, 11, 12, 10, 0); // Thursday 12.11.2026, 10:00 in Israel
const TOKEN = 'TOKEN-never-shown-0123456789';
const CONFIG = { enabled: true, user_token: TOKEN, user_id: '4455' };
const W = windowOf(NOW);

// A ScheduledPost as GET /v2/scheduler/posts returns it.
const post = (id, dateTime, fields = {}) => ({
  id, uuid: `u-${id}`, publicationDate: { dateTime, timezone: 'Asia/Jerusalem' }, text: `טקסט ${id}\nשורה שנייה`, draft: false, media: ['https://cdn.example/a.jpg'],
  providers: [{ network: 'instagram', id: `ig-${id}`, status: 'PENDING' }], instagramData: { type: 'POST' }, ...fields,
});
const reel = (id, dateTime, fields = {}) => post(id, dateTime, { instagramData: { type: 'REEL' }, media: ['https://cdn.example/v.mp4'], ...fields });
const published = (url = 'https://www.instagram.com/reel/abc') => ({ providers: [{ network: 'instagram', status: 'PUBLISHED', publicUrl: url }] });
let seq = 0;
const row = (key, kind, day, time_il, fields = {}) => ({
  id: `r${seq += 1}`, key, kind, title: key, day, time_il, internal: false, state: 'planned', posted_on: null, link: null, edited: false,
  source: 'manual', mc_post_id: null, mc_status: null, mc_at: null, mc_networks: null, mc_error: null, mc_extra: false, ...fields,
});
const norm = (list) => parsePosts({ data: list }).posts;
const sync = (rows, posts, opts = {}) => planSync({ rows, posts: norm(posts), window: W, complete: true, ...opts });
const after = (rows, plan) => applyOps(rows, plan);
const fieldsOf = (plan, r) => plan.update.find((u) => u.id === r.id)?.fields;

// ── The requests ────────────────────────────
test('the requests: the documented base, paths and parameters; the token only in the X-Mc-Auth header', async () => {
  assert.equal(API_BASE, 'https://app.metricool.com/api');
  assert.equal(AUTH_HEADER, 'X-Mc-Auth');
  assert.equal(brandsUrl({ userId: '4455' }), 'https://app.metricool.com/api/admin/simpleProfiles?userId=4455');
  const u = new URL(postsUrl({ userId: '4455', blogId: '777', now: NOW }));
  assert.equal(u.origin + u.pathname, 'https://app.metricool.com/api/v2/scheduler/posts');
  assert.deepEqual(Object.fromEntries(u.searchParams), { start: '2026-10-29T00:00:00', end: '2027-01-11T23:59:59', timezone: 'Asia/Jerusalem', userId: '4455', blogId: '777' });
  assert.deepEqual([W.from, W.to], ['2026-10-29', '2027-01-11']); // 14 days back, 60 ahead
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, init }); return { status: 200, json: async () => ({ data: [] }) }; };
  await getJson(fetch, postsUrl({ userId: '4455', blogId: '777', now: NOW }), TOKEN);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers['X-Mc-Auth'], TOKEN);
  assert.ok(!calls[0].url.includes(TOKEN), 'the token is never in the URL');
});

test('a failed request is a short code, never the URL, the user id or the token', async () => {
  const codes = { 429: 'rate_limited', 401: 'auth', 403: 'denied', 404: 'not_found', 500: 'metricool_down', 503: 'metricool_down', 418: 'http_418' };
  for (const [status, code] of Object.entries(codes)) {
    const err = await getJson(async () => ({ status: Number(status), json: async () => ({}) }), brandsUrl({ userId: '4455' }), TOKEN).catch((e) => e);
    assert.equal(err.code, code);
    assert.ok(!/4455|TOKEN|metricool\.com/.test(`${err.message} ${JSON.stringify(err)}`), status);
    assert.ok(errorText(code).length > 10 && !/undefined|null/.test(errorText(code)), code);
  }
  assert.equal((await getJson(async () => { throw new TypeError('fetch failed: https://app.metricool.com/x?userId=4455'); }, 'x', TOKEN).catch((e) => e)).code, 'network');
  assert.equal((await getJson(async () => ({ status: 200, json: async () => { throw new SyntaxError('x'); } }), 'x', TOKEN).catch((e) => e)).code, 'bad_response');
  assert.equal((await getJson(async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }, 'x', TOKEN).catch((e) => e)).code, 'timeout');
  for (const code of Object.keys(ERROR_TEXT)) assert.match(ERROR_TEXT[code], /[א-ת]/, code);
});

// ── Brands ──────────────────────────────────
const BRANDS = [
  { id: 101, userId: 4455, label: 'מספרת רון', instagram: 'ron_hair', facebook: 'ronhair', ownerUsername: 'astrateg@example.com', picture: 'https://x/p.png', fbUserId: 'secret-ish' },
  { id: 102, userId: 4455, label: 'Cafe Nadia', tiktok: 'cafenadia', ownerUsername: 'astrateg@example.com' },
  { id: 103, userId: 4455, label: 'ישן', deleted: true },
  { id: 104, userId: 4455, label: 'Demo', isDemo: true },
  { id: 105, userId: 4455, title: 'פיצה נאפולי', linkedinCompany: 'x' },
];
test('the brands: id, name and networks only; deleted and demo brands are left out', () => {
  const list = parseBrands(BRANDS);
  assert.deepEqual(list, [
    { id: '101', label: 'מספרת רון', networks: ['instagram', 'facebook'] },
    { id: '105', label: 'פיצה נאפולי', networks: ['linkedin'] },
    { id: '102', label: 'Cafe Nadia', networks: ['tiktok'] },
  ]);
  assert.equal(accountName(BRANDS), 'astrateg@example.com');
  assert.throws(() => parseBrands({ error: 'x' }), /bad_response/);
});

test('the suggestion by name: the closest brand when it is close enough, never one another client uses', () => {
  const brands = parseBrands(BRANDS);
  assert.equal(suggestBrand({ business: 'מספרת רון בע״מ', name: 'רון כהן' }, brands).brand.id, '101');
  assert.equal(suggestBrand({ business: 'קפה נדיה', name: 'נדיה' }, brands), null); // Hebrew against Latin: no guess
  assert.equal(suggestBrand({ business: 'cafe nadia', name: '' }, brands).brand.id, '102');
  assert.equal(suggestBrand({ business: 'פיצה נאפולי תל אביב', name: 'אבי' }, brands).brand.id, '105');
  assert.equal(suggestBrand({ business: 'מספרת רון', name: '' }, brands, ['101']), null);
  assert.equal(suggestBrand({ business: 'מוסך אדרי', name: 'יוסי' }, brands), null);
  assert.equal(nameScore('מספרת רון', 'מספרת רון'), 1);
  assert.equal(nameScore('', 'x'), 0);
});

// ── A post ──────────────────────────────────
test('a post: Israel day and time whatever zone it comes in, across the clock change', () => {
  assert.deepEqual(zonedParts('2026-11-15T19:00:00', 'Asia/Jerusalem'), { at: '2026-11-15T17:00:00.000Z', day: '2026-11-15', time: '19:00' });
  assert.deepEqual(zonedParts('2026-07-15T19:00:00', 'Asia/Jerusalem'), { at: '2026-07-15T16:00:00.000Z', day: '2026-07-15', time: '19:00' });
  // The same moment written in Madrid's clock, and one that is already the next day in Israel.
  assert.deepEqual(zonedParts('2026-11-15T18:00:00', 'Europe/Madrid'), { at: '2026-11-15T17:00:00.000Z', day: '2026-11-15', time: '19:00' });
  assert.deepEqual(zonedParts('2026-11-15T23:30:00', 'Europe/Madrid'), { at: '2026-11-15T22:30:00.000Z', day: '2026-11-16', time: '00:30' });
  assert.equal(zonedParts('2026-11-15T19:00:00', undefined).time, '19:00');
  assert.equal(zonedParts('2026-11-15T19:00:00', 'Not/AZone').time, '19:00');
  assert.equal(zonedParts('soon', 'Asia/Jerusalem'), null);
});

test('a post: one status over its networks, its kind of content, its public link, a short text', () => {
  const st = (...s) => overallStatus({ providers: s.map((status) => ({ network: 'x', status })) });
  assert.equal(st('PENDING'), 'pending');
  assert.equal(st('PUBLISHING'), 'pending');
  assert.equal(st('AWAITING_CONFIRMATION'), 'pending');
  assert.equal(st('PUBLISHED', 'PUBLISHED'), 'published');
  assert.equal(st('PUBLISHED', 'PENDING'), 'pending');
  assert.equal(st('PUBLISHED', 'ERROR'), 'error');
  assert.equal(st('DRAFT'), 'draft');
  assert.equal(overallStatus({ draft: true, providers: [{ status: 'PENDING' }] }), 'draft');
  assert.equal(postFormat({ instagramData: { type: 'REEL' } }), 'video');
  assert.equal(postFormat({ instagramData: { type: 'STORY' } }), 'story');
  assert.equal(postFormat({ instagramData: { type: 'POST' }, media: ['https://x/a.jpg', 'https://x/b.jpg'] }), 'graphic');
  assert.equal(postFormat({ media: ['https://x/clip.MP4?sig=1'] }), 'video');
  assert.equal(postFormat({ youtubeData: { type: 'SHORT' } }), 'video');
  assert.equal(postFormat({}, ['tiktok']), 'video');
  assert.equal(postFormat({ text: 'x' }, ['linkedin']), 'other');
  const p = normalizePost(reel(9001, '2026-11-15T19:00:00', {
    providers: [{ network: 'facebook', status: 'PUBLISHED', publicUrl: 'https://facebook.com/p/1' }, { network: 'Instagram', status: 'PUBLISHED', publicUrl: 'https://www.instagram.com/reel/xyz' }, { network: 'x', status: 'PUBLISHED', publicUrl: 'javascript:alert(1)' }],
  }));
  assert.deepEqual(p, { id: '9001', at: '2026-11-15T17:00:00.000Z', day: '2026-11-15', time: '19:00', networks: ['facebook', 'instagram', 'x'], text: 'טקסט 9001', status: 'published', url: 'https://www.instagram.com/reel/xyz', format: 'video', error: null });
  const bad = normalizePost(post(9002, '2026-11-15T19:00:00', { providers: [{ network: 'instagram', status: 'ERROR', detailedStatus: 'Media not valid' }] }));
  assert.deepEqual([bad.status, bad.error, bad.url], ['error', 'Media not valid', null]);
  assert.equal(normalizePost({ id: 'abc', publicationDate: { dateTime: '2026-11-15T19:00:00' } }), null);
  assert.equal(normalizePost({ id: 5 }), null);
  assert.equal(snippet('א'.repeat(100)).length, 60);
  assert.deepEqual(parsePosts({ data: [post(1, '2026-11-15T19:00:00'), { id: 'x' }] }).posts.length, 1);
  assert.equal(parsePosts({ data: [], page: { next: 'abc' } }).complete, false);
  assert.equal(parsePosts({ data: [] }).complete, true);
  assert.throws(() => parsePosts({ message: 'no' }), /bad_response/);
  for (const k of Object.values(COMPATIBLE).flat()) assert.ok(GANTT_KINDS[k]?.post, k);
});

// ── Matching and effects ────────────────────
test('a scheduled post marks its entry "תוזמן" with its time; a published one "עלה" with the day and the link; a failed one "שגיאה"', () => {
  const v = row('video.30', 'video', '2026-11-15', '19:00:00');
  const g = row('graphic.30', 'graphic', '2026-11-16', '13:00:00');
  const w = row('video.29', 'video', '2026-11-10', '19:00:00');
  const x = row('graphic.29', 'graphic', '2026-11-11', '13:00:00');
  const rows = [v, g, w, x];
  const plan = sync(rows, [
    reel(1, '2026-11-15T20:30:00'),
    post(2, '2026-11-16T13:00:00'),
    reel(3, '2026-11-10T19:00:00', published('https://www.instagram.com/reel/abc')),
    post(4, '2026-11-11T13:05:00', { providers: [{ network: 'instagram', status: 'ERROR', detailedStatus: 'Token expired' }] }),
  ]);
  assert.deepEqual(fieldsOf(plan, v), { mc_post_id: '1', mc_status: 'pending', mc_at: '2026-11-15T18:30:00.000Z', mc_networks: ['instagram'], source: 'metricool', state: 'scheduled', time_il: '20:30', edited: true });
  assert.deepEqual(fieldsOf(plan, g), { mc_post_id: '2', mc_status: 'pending', mc_at: '2026-11-16T11:00:00.000Z', mc_networks: ['instagram'], source: 'metricool', state: 'scheduled' });
  assert.deepEqual(fieldsOf(plan, w), { mc_post_id: '3', mc_status: 'published', mc_at: '2026-11-10T17:00:00.000Z', mc_networks: ['instagram'], source: 'metricool', state: 'posted', posted_on: '2026-11-10', link: 'https://www.instagram.com/reel/abc' });
  assert.deepEqual(fieldsOf(plan, x), { mc_post_id: '4', mc_status: 'error', mc_at: '2026-11-11T11:05:00.000Z', mc_networks: ['instagram'], mc_error: 'Token expired', source: 'metricool', state: 'error' });
  assert.deepEqual([plan.insert, plan.remove], [[], []]);
  assert.deepEqual(plan.failed.map((f) => f.key), ['graphic.29']);
  assert.deepEqual(plan.stats, { posts: 4, drafts: 0, matched: 4, extras: 0, scheduled: 2, published: 1, errors: 1, changed: 4 });
  // Idempotent: the same listing again changes nothing.
  const next = after(rows, plan);
  const again = planSync({ rows: next, posts: norm([reel(1, '2026-11-15T20:30:00'), post(2, '2026-11-16T13:00:00'), reel(3, '2026-11-10T19:00:00', published('https://www.instagram.com/reel/abc')), post(4, '2026-11-11T13:05:00', { providers: [{ network: 'instagram', status: 'ERROR', detailedStatus: 'Token expired' }] })]), window: W, complete: true });
  assert.deepEqual([again.update, again.insert, again.remove, again.stats.changed], [[], [], [], 0]);
  // As the database returns a time ('HH:MM:SS') and a moment in another notation: still nothing.
  const asDb = next.map((r) => ({ ...r, time_il: r.time_il && r.time_il.length === 5 ? `${r.time_il}:00` : r.time_il, mc_at: r.mc_at ? r.mc_at.replace('.000Z', '+00:00') : r.mc_at }));
  assert.equal(planSync({ rows: asDb, posts: norm([reel(1, '2026-11-15T20:30:00'), post(2, '2026-11-16T13:00:00')]), window: W, complete: false }).stats.changed, 0);
});

test('matching: the same Israel day and a fitting kind; the nearest time wins; one post per entry', () => {
  const a = row('video.1', 'video', '2026-11-15', '19:00');
  const b = row('monthly.9.1', 'monthly', '2026-11-15', '17:00');
  const c = row('graphic.1', 'graphic', '2026-11-15', '13:00');
  const s = row('story.1', 'story', '2026-11-15', '20:00');
  const other = row('video.2', 'video', '2026-11-17', '19:00');
  const internal = row('plan.9', 'plan', '2026-11-15', '16:00', { internal: true });
  const skipped = row('video.3', 'video', '2026-11-15', '18:00', { state: 'skipped' });
  const rows = [a, b, c, s, other, internal, skipped];
  const plan = sync(rows, [
    reel(1, '2026-11-15T18:40:00'),                                   // nearest to video.1 (19:00), not the skipped 18:00
    reel(2, '2026-11-15T17:10:00'),                                   // the monthly content
    post(3, '2026-11-15T16:00:00'),                                   // a graphic: only graphic.1 is left that fits
    post(4, '2026-11-15T20:00:00', { instagramData: { type: 'STORY' } }),
    reel(5, '2026-11-16T19:00:00'),                                   // another day: no entry, an extra row
    post(6, '2026-11-15T09:00:00', { instagramData: { type: 'POST' } }), // a second graphic that day: nothing left that fits
  ]);
  const of = (r) => fieldsOf(plan, r)?.mc_post_id;
  assert.deepEqual([of(a), of(b), of(c), of(s), of(other), of(internal), of(skipped)], ['1', '2', '3', '4', undefined, undefined, undefined]);
  assert.deepEqual(plan.insert.map((i) => [i.key, i.day, i.time_il, i.state, i.title]), [['mc.5', '2026-11-16', '19:00', 'scheduled', 'טקסט 5'], ['mc.6', '2026-11-15', '09:00', 'scheduled', 'טקסט 6']]);
  // Two posts for one entry: the nearer takes it, the other becomes an extra row.
  const one = row('video.9', 'video', '2026-11-18', '19:00');
  const two = sync([one], [reel(7, '2026-11-18T12:00:00'), reel(8, '2026-11-18T19:30:00')]);
  assert.equal(fieldsOf(two, one).mc_post_id, '8');
  assert.deepEqual(two.insert.map((i) => i.key), ['mc.7']);
  // A whole-day entry takes a post when no timed one fits; an entry added by hand takes any kind.
  const allDay = row('ch.1', 'video', '2026-11-19', null);
  const custom = row('custom.1700000000000', 'custom', '2026-11-19', '10:00');
  const three = sync([allDay, custom], [reel(10, '2026-11-19T19:00:00'), post(11, '2026-11-19T10:15:00', { instagramData: undefined, media: [], providers: [{ network: 'linkedin', status: 'PENDING' }] })]);
  assert.deepEqual([fieldsOf(three, allDay).mc_post_id, fieldsOf(three, custom).mc_post_id], ['10', '11']);
  // A draft is not in the planner yet: nothing happens.
  const d = row('video.11', 'video', '2026-11-20', '19:00');
  assert.equal(sync([d], [reel(12, '2026-11-20T19:00:00', { draft: true })]).stats.changed, 0);
});

test('a mark a person made is never changed: only the link to the post is kept, and an empty link filled', () => {
  const manualScheduled = row('video.1', 'video', '2026-11-15', '19:00', { state: 'scheduled', source: 'manual' });
  const manualPosted = row('video.2', 'video', '2026-11-10', '19:00', { state: 'posted', posted_on: '2026-11-09', source: 'manual', link: 'https://mine.example/x' });
  const manualPosted2 = row('graphic.2', 'graphic', '2026-11-10', '13:00', { state: 'posted', posted_on: '2026-11-10', source: 'manual' });
  const rows = [manualScheduled, manualPosted, manualPosted2];
  const plan = sync(rows, [
    reel(1, '2026-11-15T21:00:00', { providers: [{ network: 'instagram', status: 'ERROR', detailedStatus: 'x' }] }),
    reel(2, '2026-11-10T19:00:00', published('https://www.instagram.com/reel/theirs')),
    post(3, '2026-11-10T13:00:00', published('https://www.instagram.com/p/g2')),
  ]);
  for (const r of rows) for (const f of ['state', 'source', 'time_il', 'posted_on', 'edited']) assert.ok(!(f in fieldsOf(plan, r)), `${r.key}.${f}`);
  assert.equal(fieldsOf(plan, manualScheduled).mc_status, 'error'); // known, and Ilai is told (plan.failed)
  assert.ok(!('link' in fieldsOf(plan, manualPosted)));
  assert.equal(fieldsOf(plan, manualPosted2).link, 'https://www.instagram.com/p/g2');
  assert.deepEqual(plan.failed.map((f) => f.key), ['video.1']);
  // The post leaves Metricool: the manual marks stay exactly as they are.
  const next = after(rows, plan);
  const gone = planSync({ rows: next, posts: [], window: W, complete: true });
  for (const u of gone.update) assert.deepEqual(Object.keys(u.fields).filter((k) => !k.startsWith('mc_')), []);
  assert.deepEqual(after(next, gone).map((r) => [r.state, r.source, r.mc_post_id]), [['scheduled', 'manual', null], ['posted', 'manual', null], ['posted', 'manual', null]]);
});

test('a post removed from Metricool un-schedules only what the sync set; not with a partial listing, not outside the window', () => {
  const a = row('video.1', 'video', '2026-11-15', '19:00');
  const b = row('video.2', 'video', '2026-11-10', '19:00');
  const rows = [a, b];
  const first = sync(rows, [reel(1, '2026-11-15T19:00:00'), reel(2, '2026-11-10T19:00:00', published())]);
  const linked = after(rows, first);
  assert.deepEqual(linked.map((r) => [r.state, r.source]), [['scheduled', 'metricool'], ['posted', 'metricool']]);
  // Partial listing (page.next): nothing is taken back.
  assert.equal(planSync({ rows: linked, posts: [], window: W, complete: false }).stats.changed, 0);
  // Complete: the scheduled one goes back to planned; the one that went up stays up.
  const gone = planSync({ rows: linked, posts: [], window: W, complete: true });
  const back = after(linked, gone);
  assert.deepEqual(back.map((r) => [r.state, r.source, r.mc_post_id, r.posted_on]), [['planned', 'manual', null, null], ['posted', 'metricool', null, '2026-11-10']]);
  assert.equal(planSync({ rows: back, posts: [], window: W, complete: true }).stats.changed, 0);
  // Outside the window (a post of three weeks ago is no longer listed): untouched.
  const old = row('video.0', 'video', '2026-10-20', '19:00', { state: 'posted', posted_on: '2026-10-20', source: 'metricool', mc_post_id: '77', mc_status: 'published', mc_at: '2026-10-20T16:00:00.000Z' });
  assert.equal(planSync({ rows: [old], posts: [], window: W, complete: true }).stats.changed, 0);
  // Moved to another day in Metricool: the old entry is un-scheduled, the entry of the new day takes the post.
  const c = row('video.3', 'video', '2026-11-17', '19:00');
  const moved = planSync({ rows: [...linked, c], posts: norm([reel(1, '2026-11-17T19:00:00'), reel(2, '2026-11-10T19:00:00', published())]), window: W, complete: true });
  const m = after([...linked, c], moved);
  assert.deepEqual(m.map((r) => [r.key, r.state, r.mc_post_id]), [['video.1', 'planned', null], ['video.2', 'posted', '2'], ['video.3', 'scheduled', '1']]);
});

test('posts no entry fits become extra rows from Metricool, follow their post, and leave with it', () => {
  const rows = [row('report.9', 'report', '2026-11-17', '12:00')];
  const first = sync(rows, [reel(21, '2026-11-17T18:00:00', { text: '' }), post(22, '2026-11-18T10:00:00')]);
  assert.deepEqual(first.insert.map((i) => [i.key, i.title, i.state, i.mc_post_id]), [['mc.21', 'פוסט ב־Metricool (instagram)', 'scheduled', '21'], ['mc.22', 'טקסט 22', 'scheduled', '22']]);
  let state = after(rows, first);
  assert.deepEqual(state.filter((r) => r.mc_extra).map((r) => [r.kind, r.source, r.internal]), [['custom', 'metricool', false], ['custom', 'metricool', false]]);
  assert.equal(sync(state, [reel(21, '2026-11-17T18:00:00', { text: '' }), post(22, '2026-11-18T10:00:00')]).stats.changed, 0);
  // 21 is published an hour later than planned, 22 is deleted in Metricool.
  const second = sync(state, [reel(21, '2026-11-17T19:00:00', { text: '', ...published('https://www.instagram.com/reel/21') })]);
  state = after(state, second);
  const extra = state.filter((r) => r.mc_extra);
  assert.deepEqual(extra.map((r) => [r.key, r.time_il, r.state, r.posted_on, r.link]), [['mc.21', '19:00', 'posted', '2026-11-17', 'https://www.instagram.com/reel/21']]);
  // An extra row someone marked by hand stays when its post goes, without the link to it.
  const kept = state.map((r) => (r.mc_extra ? { ...r, state: 'skipped', source: 'manual' } : r));
  const third = sync(kept, []);
  assert.deepEqual([third.remove, after(kept, third).filter((r) => r.mc_extra).map((r) => [r.state, r.mc_post_id])], [[], [['skipped', null]]]);
  // On the Gantt a scheduled extra reads as scheduled, and as up once its time has passed.
  assert.equal(entryStatus({ ...first.insert[1], kind: 'custom' }, NOW), 'scheduled');
  assert.equal(entryStatus({ ...first.insert[1], kind: 'custom' }, dateIL(2026, 11, 18, 10, 1)), 'posted');
});

// ── The run ─────────────────────────────────
function world(clients) {
  const rows = new Map(clients.map((c) => [c.id, c.rows || []]));
  const syncs = new Map();
  const applied = [];
  return {
    rows, syncs, applied,
    db: {
      clients: async () => clients.map((c) => ({ id: c.id, metricool_blog_id: c.blog })),
      rows: async (id) => rows.get(id),
      apply: async (id, ops, ok, error, stats) => {
        applied.push({ id, ops, ok, error, stats });
        rows.set(id, applyOps(rows.get(id), ops));
        syncs.set(id, { ok, error, stats: ok ? stats : syncs.get(id)?.stats || {} });
      },
    },
  };
}
const fakeFetch = (byBlog, calls = []) => async (url, init) => {
  const u = new URL(url);
  calls.push({ path: u.pathname, blog: u.searchParams.get('blogId'), user: u.searchParams.get('userId'), auth: init.headers['X-Mc-Auth'] });
  const answer = byBlog[u.searchParams.get('blogId') ?? 'brands'];
  if (typeof answer === 'number') return { status: answer, json: async () => ({}) };
  return { status: 200, json: async () => answer };
};

test('a run: each connected client in turn with a pause between two; counts only; a second run changes nothing', async () => {
  const w = world([
    { id: 'c1', blog: '101', rows: [row('video.1', 'video', '2026-11-15', '19:00')] },
    { id: 'c2', blog: '102', rows: [row('graphic.1', 'graphic', '2026-11-16', '13:00')] },
    { id: 'c3', blog: '103', rows: [] },
  ]);
  const calls = [];
  const sleeps = [];
  const fetch = fakeFetch({ 101: { data: [reel(1, '2026-11-15T19:00:00')] }, 102: { data: [post(2, '2026-11-16T13:00:00')], page: { next: 'more' } }, 103: { data: [] } }, calls);
  const stats = await runSync({ db: w.db, fetch, config: CONFIG, now: NOW, sleep: async (ms) => { sleeps.push(ms); } });
  assert.deepEqual(stats, { clients: 3, synced: 3, failed: 0, changed: 2, stopped: null });
  assert.deepEqual(calls.map((c) => [c.path, c.blog, c.user, c.auth]), [['/api/v2/scheduler/posts', '101', '4455', TOKEN], ['/api/v2/scheduler/posts', '102', '4455', TOKEN], ['/api/v2/scheduler/posts', '103', '4455', TOKEN]]);
  assert.deepEqual(sleeps, [PAUSE_MS, PAUSE_MS]);
  assert.deepEqual([w.rows.get('c1')[0].state, w.rows.get('c2')[0].state], ['scheduled', 'scheduled']);
  assert.deepEqual(w.syncs.get('c2'), { ok: true, error: null, stats: { posts: 1, drafts: 0, matched: 1, extras: 0, scheduled: 1, published: 0, errors: 0, changed: 1, partial: true } });
  const again = await runSync({ db: w.db, fetch, config: CONFIG, now: NOW, sleep: async () => {} });
  assert.deepEqual([again.synced, again.changed], [3, 0]);
  // Nothing of the secret anywhere in what is stored or returned.
  assert.ok(!JSON.stringify([stats, w.applied, [...w.syncs]]).includes(TOKEN));
});

test('a run: off or without secrets nothing is called; 429 stops it; one brand\'s failure does not stop the rest', async () => {
  const mk = () => world([{ id: 'c1', blog: '101', rows: [] }, { id: 'c2', blog: '102', rows: [] }, { id: 'c3', blog: '103', rows: [] }]);
  for (const config of [{ ...CONFIG, enabled: false }, { enabled: true, user_token: null, user_id: '1' }, { enabled: true, user_token: TOKEN, user_id: null }, null]) {
    const calls = [];
    const w = mk();
    const r = await runSync({ db: w.db, fetch: fakeFetch({}, calls), config, now: NOW, sleep: async () => {} });
    assert.deepEqual([calls.length, w.applied.length, r.synced], [0, 0, 0]);
    assert.ok(['off', 'not_ready'].includes(r.stopped));
  }
  // 429 on the second brand: the run stops, the third is not asked.
  let w = mk();
  let calls = [];
  let r = await runSync({ db: w.db, fetch: fakeFetch({ 101: { data: [] }, 102: 429, 103: { data: [] } }, calls), config: CONFIG, now: NOW, sleep: async () => {} });
  assert.deepEqual([r.synced, r.failed, r.stopped, calls.length], [1, 1, 'rate_limited', 2]);
  assert.deepEqual(w.applied.map((a) => [a.id, a.ok, a.error]), [['c1', true, null], ['c2', false, 'rate_limited']]);
  // A rejected token stops at once; a brand that is gone or a bad answer only fails that client.
  w = mk(); calls = [];
  r = await runSync({ db: w.db, fetch: fakeFetch({ 101: 401 }, calls), config: CONFIG, now: NOW, sleep: async () => {} });
  assert.deepEqual([r.stopped, calls.length, w.applied[0].error], ['auth', 1, 'auth']);
  w = mk(); calls = [];
  r = await runSync({ db: w.db, fetch: fakeFetch({ 101: 404, 102: { nonsense: true }, 103: { data: [] } }, calls), config: CONFIG, now: NOW, sleep: async () => {} });
  assert.deepEqual([r.synced, r.failed, r.stopped, w.applied.map((a) => a.error)], [1, 2, null, ['not_found', 'bad_response', null]]);
  // A slow run stops starting new brands once the time for one tick is used.
  w = mk(); calls = [];
  let t = 0;
  r = await runSync({ db: w.db, fetch: fakeFetch({ 101: { data: [] }, 102: { data: [] }, 103: { data: [] } }, calls), config: CONFIG, now: NOW, sleep: async () => {}, clock: () => (t += 30000) });
  assert.deepEqual([r.stopped, calls.length], ['budget', 1]);
});

test('the brands and the connection check: only names and counts come back, never the token or the user id', async () => {
  const calls = [];
  const fetch = fakeFetch({ brands: BRANDS }, calls);
  const b = await listBrands({ fetch, config: CONFIG });
  assert.equal(b.status, 200);
  assert.deepEqual(b.body.brands.map((x) => x.id), ['101', '105', '102']);
  const c = await checkAccount({ fetch, config: CONFIG });
  assert.deepEqual(c, { status: 200, body: { ok: true, account: 'astrateg@example.com', brands: 3 } });
  assert.deepEqual(calls.map((x) => [x.path, x.user, x.blog]), [['/api/admin/simpleProfiles', '4455', null], ['/api/admin/simpleProfiles', '4455', null]]);
  for (const out of [b, c]) assert.ok(!/TOKEN|4455|secret-ish|picture/.test(JSON.stringify(out)));
  assert.deepEqual(await checkAccount({ fetch: fakeFetch({ brands: 401 }), config: CONFIG }), { status: 200, body: { ok: false, error: 'auth' } });
  assert.deepEqual(await checkAccount({ fetch, config: { user_token: null, user_id: null } }), { status: 200, body: { ok: false, error: 'not_ready' } });
  assert.deepEqual(await listBrands({ fetch, config: {} }), { status: 409, body: { error: 'not_ready' } });
  assert.deepEqual(await listBrands({ fetch: fakeFetch({ brands: 429 }), config: CONFIG }), { status: 502, body: { error: 'rate_limited' } });
});

test('who may call what: the brands for the office, the check for the owner, the sync for nobody signed in', () => {
  const who = (person) => ({ person });
  assert.deepEqual(['brands', 'check', 'sync'].map((a) => mayCall(a, who(null))), [true, true, false]);
  for (const p of ['irit', 'lior', 'ofir', 'ilai']) assert.deepEqual(['brands', 'check', 'sync'].map((a) => mayCall(a, who(p))), [true, false, false], p);
  for (const p of ['nadia', 'eli', 'stav', 'nirel']) assert.deepEqual(['brands', 'check', 'sync'].map((a) => mayCall(a, who(p))), [false, false, false], p);
  assert.equal(mayCall('brands', null), false);
  assert.deepEqual([...ACTIONS].sort(), ['brands', 'check', 'sync']);
  assert.equal(corsHeaders('https://adamsin155.github.io')['Access-Control-Allow-Origin'], 'https://adamsin155.github.io');
  assert.equal(corsHeaders('https://evil.example')['Access-Control-Allow-Origin'], undefined);
});

// ── Words ───────────────────────────────────
test('the line on the Gantt: connected or not, on or off, how long ago, the error in plain Hebrew', () => {
  const at = (min) => new Date(NOW.getTime() - min * 60000).toISOString();
  assert.equal(syncLine({ enabled: null }, NOW), null);
  assert.deepEqual(syncLine({ enabled: true, blogId: null }, NOW), { tone: 'off', text: 'הלקוח לא מחובר למותג ב־Metricool. הסימון ידני.' });
  assert.match(syncLine({ enabled: false, blogId: '101', brand: 'מספרת רון' }, NOW).text, /מחובר ל״מספרת רון״ ב־Metricool\. הסנכרון כבוי/);
  assert.match(syncLine({ enabled: true, blogId: '101', brand: 'מספרת רון', sync: null }, NOW).text, /הסנכרון הראשון/);
  assert.deepEqual(syncLine({ enabled: true, blogId: '101', sync: { ok: true, at: at(4) } }, NOW), { tone: 'ok', text: 'סונכרן מ־Metricool לפני 4 דקות' });
  const bad = syncLine({ enabled: true, blogId: '101', sync: { ok: false, at: at(20), error: 'denied' } }, NOW);
  assert.equal(bad.tone, 'warn');
  assert.match(bad.text, /הסנכרון מ־Metricool נכשל לפני 20 דקות\. אין לחשבון גישה למותג הזה/);
  assert.deepEqual([0, 1, 4, 59, 60, 120, 300, 1440, 2880, 7200].map((m) => agoText(at(m), NOW)), ['עכשיו', 'לפני דקה', 'לפני 4 דקות', 'לפני 59 דקות', 'לפני שעה', 'לפני שעתיים', 'לפני 5 שעות', 'אתמול', 'לפני יומיים', 'לפני 5 ימים']);
  assert.match(accountLine({ enabled: false, mapped: 0 }, NOW).text, /כבוי: מסמנים ״תוזמן״ ו״עלה״ ביד/);
  assert.match(accountLine({ enabled: true, mapped: 0 }, NOW).text, /עוד אין לקוח שמחובר/);
  assert.deepEqual(accountLine({ enabled: true, mapped: 7, failed: 0, lastAt: at(4) }, NOW), { tone: 'ok', text: 'Metricool פועל: 7 לקוחות מחוברים. הסנכרון האחרון לפני 4 דקות.' });
  assert.equal(accountLine({ enabled: true, mapped: 7, failed: 2, lastAt: at(4), lastError: 'rate_limited' }, NOW).tone, 'warn');
  assert.equal(accountLine(null, NOW), null);
  assert.match(errorText('http_418'), /418/);
  assert.equal(errorText('whatever'), ERROR_TEXT.server_error);
});

// ── The reminder ────────────────────────────
test('a post that failed in Metricool rings Ilai once, named by the business first, with the way to the Gantt', () => {
  const rule = RULES.find((r) => r.id === 'metricoolFailed');
  assert.ok(rule);
  const client = { id: 'c1', name: 'רון כהן', business: 'מספרת רון', status: 'active', deal_at: '2026-03-15T08:00:00Z', links: {}, deliverables: {}, rounds: [] };
  const fail = { id: 'g1', client_id: 'c1', key: 'video.30', title: 'סרטון 30', day: '2026-11-11', mc_post_id: '4', mc_status: 'error', at: dateIL(2026, 11, 12, 9, 50).toISOString() };
  const env = buildEnv({ clients: [client], staff: [{ email: 'ilai@x', person: 'ilai' }], now: NOW, ganttFailures: [fail, { ...fail, id: 'g2', client_id: 'gone' }, { ...fail, id: 'g3', mc_status: 'published' }] });
  const inst = rule.instances(env);
  assert.deepEqual(inst.map((i) => i.id), ['g1@4']);
  const step = rule.steps[0];
  assert.deepEqual([step.to, step.level], ['ilai', 'ring']);
  assert.equal(step.title(inst[0], env), 'הפרסום של מספרת רון · רון כהן נכשל ב-Metricool');
  assert.match(step.body(inst[0], env), /סרטון 30 · 11\.11\.2026/);
  assert.equal(inst[0].url, 'gantt.html?id=c1&m=2026-11&d=2026-11-11');
  // Through the engine: one ring to Ilai for it.
  const due = candidates(env).filter((s) => s.rule === 'metricoolFailed');
  assert.deepEqual(due.map((s) => [s.person, s.level, s.title]), [['ilai', 'ring', 'הפרסום של מספרת רון · רון כהן נכשל ב-Metricool']]);
  assert.equal(buildEnv({ clients: [client], staff: [], now: NOW }).ganttFailures.length, 0);
});
