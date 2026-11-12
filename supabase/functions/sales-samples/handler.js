// Our videos for the sales CRM's AI brief before a meeting (the owner's request of 5.11.2026): when a
// meeting is set with, say, a garage, the brief shows two of our videos made for clients of the same
// field. The CRM (its own Supabase project, crm.astrateg.tech) asks here, server to server; no browser
// ever calls this function. Free of Deno APIs so node tests run it (tests/sales-samples.test.mjs).
//
//   POST {}                          → 200 { clients: [{ id, name, business }] }
//        the clients that have a Drive folder in their card (archived ones left out): only the name
//        and the business, for the CRM's AI to pick those of the same field. No phone, no money, no notes.
//   POST { client_ids: [id, id] }    → 200 { samples: [{ id, name, business, videos: [{ name, link }] }] }
//        up to 3 clients; for each, its newest finished videos (up to 3) from its Drive folder, read by
//        the robot account (../_shared/drive.js: names and links only). A folder it cannot open: no videos.
//   POST { showcase: true }          → 200 { clients: [{ id, name, business, reels: [{ title, link, posted_on }],
//        pages: [{ network, username }] }] }
//        for the field agents' showcase on a tablet (the owner, 12.11.2026): per client (archived ones left
//        out), its newest posted videos that have a link in the content Gantt (up to 12), and the handles of
//        its Instagram, TikTok and Facebook pages from the access list. Only the network and the user name are
//        read there, never the password; a user name that is an e-mail or a phone (a login) is left out.
//        Clients with neither are left out.
//
// The gate: the header x-crm-key equals the secret CRM_SAMPLES_KEY (the same value is the CRM's
// STAFF_SAMPLES_KEY). Without the secret: 503, nothing is read. The Drive robot is the secret
// GOOGLE_DRIVE_SERVICE_ACCOUNT, as for the drive function.
import { serviceAccountOf, makeDrive, folderIdOf, fileClass } from '../_shared/drive.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_CLIENTS = 3;
export const VIDEOS_PER_CLIENT = 3;
const MIN_KEY = 32;

// Equal strings, in a time that does not depend on where they differ.
export function sameKey(a, b) {
  const x = String(a ?? '');
  const y = String(b ?? '');
  if (x.length < MIN_KEY || x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i += 1) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}

// A client's finished videos, newest first: raw footage, graphics and documents left out.
export function finishedVideos(files, max = VIDEOS_PER_CLIENT) {
  return (files || [])
    .filter((f) => fileClass(f.mimeType, f.path) === 'video' && f.link)
    .sort((a, b) => String(b.createdTime || '').localeCompare(String(a.createdTime || '')))
    .slice(0, max)
    .map((f) => ({ name: f.name, link: f.link }));
}

export const REELS_PER_CLIENT = 12;
// Most reels that went up are 'custom' entries; graphics, stories, shoots and the office's own rows are not.
const REEL_KINDS = ['video', 'custom', 'monthly', 'collab', 'highlight', 'ch14'];
const PAGE_NETWORKS = ['instagram', 'tiktok', 'facebook'];
// A page's handle as people see it (letters, digits, dot, underscore, dash): an e-mail or a phone, which is a
// login, is not one.
export function pageHandle(username) {
  const u = String(username ?? '').trim().replace(/^@/, '');
  return /^[A-Za-z0-9._-]{2,60}$/.test(u) && !/^[0-9._-]+$/.test(u) ? u : null;
}

const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// deps: { env(name), createClient(url, key, opts?), fetch, log(message) }
export function makeHandler(deps) {
  const log = deps.log || (() => {});
  return async function handle(req) {
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (req.method !== 'POST') return json(405, { error: 'method not allowed' });
    const secret = deps.env('CRM_SAMPLES_KEY') || '';
    if (!secret) return json(503, { error: 'not_configured' });
    if (!sameKey(req.headers.get('x-crm-key'), secret)) return json(401, { error: 'unauthorized' });
    let body = {};
    try { body = (await req.json()) || {}; } catch { body = {}; }
    const db = deps.createClient(deps.env('SUPABASE_URL'), deps.env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

    if (body.showcase === true) {
      const { data: cs, error: e1 } = await db.from('clients').select('id, name, business, archived_at');
      const { data: gs, error: e2 } = await db.from('client_gantt').select('client_id, kind, title, posted_on, link, internal')
        .eq('state', 'posted').in('kind', REEL_KINDS).order('posted_on', { ascending: false });
      const { data: as, error: e3 } = await db.from('client_access').select('client_id, network, username').in('network', PAGE_NETWORKS);
      if (e1 || e2 || e3) { log('sales-samples: showcase failed'); return json(502, { error: 'db' }); }
      const clients = [];
      for (const c of cs || []) {
        if (c.archived_at) continue;
        const reels = (gs || []).filter((g) => g.client_id === c.id && !g.internal && /^https:\/\/[^\s"<>]+$/.test(g.link || ''))
          .slice(0, REELS_PER_CLIENT)
          .map((g) => ({ title: clean(g.title, 200), link: g.link, posted_on: g.posted_on }));
        const pages = [];
        for (const a of (as || []).filter((x) => x.client_id === c.id)) {
          const username = pageHandle(a.username);
          if (username && !pages.some((p) => p.network === a.network)) pages.push({ network: a.network, username });
        }
        if (reels.length || pages.length) clients.push({ id: c.id, name: clean(c.name, 120), business: clean(c.business, 160) || null, reels, pages });
      }
      return json(200, { clients });
    }

    if (body.client_ids === undefined) {
      const { data, error } = await db.from('clients').select('id, name, business, links, archived_at');
      if (error) { log('sales-samples: clients failed'); return json(502, { error: 'db' }); }
      const clients = (data || [])
        .filter((c) => !c.archived_at && folderIdOf(c.links?.drive))
        .map((c) => ({ id: c.id, name: clean(c.name, 120), business: clean(c.business, 160) || null }));
      return json(200, { clients });
    }

    const ids = Array.isArray(body.client_ids) ? [...new Set(body.client_ids.map(String))] : [];
    if (!ids.length || ids.length > MAX_CLIENTS || !ids.every((id) => UUID.test(id))) return json(400, { error: 'bad_ids' });
    const sa = serviceAccountOf(deps.env('GOOGLE_DRIVE_SERVICE_ACCOUNT'));
    if (!sa) return json(503, { error: 'drive_not_connected' });
    const { data, error } = await db.from('clients').select('id, name, business, links, archived_at').in('id', ids);
    if (error) { log('sales-samples: clients failed'); return json(502, { error: 'db' }); }
    const drive = makeDrive(sa, { fetch: deps.fetch || globalThis.fetch });
    const samples = [];
    for (const id of ids) {
      const c = (data || []).find((r) => r.id === id);
      const folder = c && !c.archived_at ? folderIdOf(c.links?.drive) : null;
      if (!folder) continue;
      let videos = [];
      try {
        videos = finishedVideos((await drive.list(folder, { maxFiles: 200 })).files);
      } catch (e) {
        log(`sales-samples: drive ${String(e?.code || 'error')}`);
      }
      samples.push({ id, name: clean(c.name, 120), business: clean(c.business, 160) || null, videos });
    }
    return json(200, { samples });
  };
}
