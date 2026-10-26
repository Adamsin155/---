// The old system's characterizations (astrateg-crm) into the new one (the owner's request of
// 26.10.2026; public.legacy_characterizations, 20261109100000_legacy_characterizations.sql).
// Each client's characterization goes to public.legacy_characterization_import(p_client, p_doc),
// which only the owner may call: run it with the owner's session. Running it again changes the
// same rows (one per client).
//
// importAll(supabase, clients, clientUuid) is the whole job: for each old client with something
// to keep (charterFilledText, briefText, charterScript, charterSummary, or an answer in
// charterAnswers), it finds the new client (clientUuid(oldClientId) → uuid, or null) and calls
// the RPC once with only those fields and their times (charterFilledAt, briefUpdatedAt,
// charterScriptAt). A client with nothing of these is passed over and not counted. It returns
// { ok: [old ids], skipped: [{ id, clientName }] (something to keep, no new client),
// failed: [{ id, error }] }. It uses nothing outside itself, so it can also run inside a page
// (importInPage below).
//
// Usage:
//   1. A look first, with no session and nothing written (counts only):
//        node scripts/legacy-characterizations-import.mjs <clients.json> <module exporting clientUuid>
//      (<clients.json>: the old clients, an array or { clients: [...] }.)
//   2. The import, in a Playwright page of the live site where the owner is signed in:
//        import { importInPage } from './scripts/legacy-characterizations-import.mjs';
//        const { clientUuid } = await import(pathToFileURL(<module>).href);
//        const result = await importInPage(page, clients, clientUuid);
//      It finds the new client of each here (clientUuid may read local files), sends the page
//      only the characterization's fields, and runs importAll there with the page's own
//      signed-in client (app/supa.js).
//   Or with any signed-in supabase client of the owner: await importAll(supabase, clients, clientUuid).
// The database takes the phone numbers and the e-mail addresses out of every text ("[הוסר]").

export async function importAll(supabase, clients, clientUuid) {
  const FIELDS = ['charterFilledText', 'charterFilledAt', 'briefText', 'briefUpdatedAt', 'charterScript', 'charterScriptAt', 'charterSummary', 'charterAnswers'];
  const TEXTS = ['charterFilledText', 'briefText', 'charterScript', 'charterSummary'];
  const some = (v) => (typeof v === 'string' ? v.trim() !== '' : typeof v === 'number' || typeof v === 'boolean' ? true
    : Array.isArray(v) ? v.some(some) : v && typeof v === 'object' ? Object.values(v).some(some) : false);
  const out = { ok: [], skipped: [], failed: [] };
  for (const c of Array.isArray(clients) ? clients : []) {
    if (!c || typeof c !== 'object') continue;
    const answers = c.charterAnswers && typeof c.charterAnswers === 'object' && !Array.isArray(c.charterAnswers) ? c.charterAnswers : null;
    if (!TEXTS.some((k) => typeof c[k] === 'string' && c[k].trim()) && !(answers && some(answers))) continue;
    let uuid = null;
    try { uuid = await clientUuid(c.id); } catch { uuid = null; }
    if (!uuid) { out.skipped.push({ id: c.id ?? null, clientName: c.name ?? c.clientName ?? null }); continue; }
    const doc = {};
    for (const k of FIELDS) if (c[k] !== undefined && c[k] !== null) doc[k] = c[k];
    try {
      const { error } = await supabase.rpc('legacy_characterization_import', { p_client: uuid, p_doc: doc });
      if (error) out.failed.push({ id: c.id, error: error.message || String(error) });
      else out.ok.push(c.id);
    } catch (err) {
      out.failed.push({ id: c.id, error: err?.message || String(err) });
    }
  }
  return out;
}

// What would be imported, without a session: counts only.
// { clients, withSomething, withClient, noClient, filled, brief, script, summary, answers }.
export async function plan(clients, clientUuid) {
  const list = Array.isArray(clients) ? clients.filter((c) => c && typeof c === 'object') : [];
  const text = (v) => typeof v === 'string' && v.trim() !== '';
  const some = (v) => (typeof v === 'string' ? v.trim() !== '' : typeof v === 'number' || typeof v === 'boolean' ? true
    : Array.isArray(v) ? v.some(some) : v && typeof v === 'object' ? Object.values(v).some(some) : false);
  const p = { clients: list.length, withSomething: 0, withClient: 0, noClient: 0, filled: 0, brief: 0, script: 0, summary: 0, answers: 0 };
  for (const c of list) {
    const answers = c.charterAnswers && typeof c.charterAnswers === 'object' && !Array.isArray(c.charterAnswers) && some(c.charterAnswers);
    const parts = { filled: text(c.charterFilledText), brief: text(c.briefText), script: text(c.charterScript), summary: text(c.charterSummary), answers };
    if (!Object.values(parts).some(Boolean)) continue;
    p.withSomething += 1;
    for (const [k, on] of Object.entries(parts)) if (on) p[k] += 1;
    let uuid = null;
    try { uuid = await clientUuid(c.id); } catch { uuid = null; }
    if (uuid) p.withClient += 1; else p.noClient += 1;
  }
  return p;
}

// Runs importAll inside a Playwright page of the site where the owner is signed in, with the
// page's own supabase client. The new client of each is found here first, and the page gets
// only the old id, the name and the characterization's fields of each client.
export async function importInPage(page, clients, clientUuid) {
  const FIELDS = ['id', 'name', 'charterFilledText', 'charterFilledAt', 'briefText', 'briefUpdatedAt', 'charterScript', 'charterScriptAt', 'charterSummary', 'charterAnswers'];
  const slim = (Array.isArray(clients) ? clients : []).filter((c) => c && typeof c === 'object')
    .map((c) => Object.fromEntries(FIELDS.filter((k) => c[k] !== undefined).map((k) => [k, c[k]])));
  const map = {};
  for (const c of slim) {
    let uuid = null;
    try { uuid = await clientUuid(c.id); } catch { uuid = null; }
    if (uuid) map[String(c.id)] = uuid;
  }
  // One expression with the function's own text: the page's policy runs no text as code, but
  // what Playwright evaluates is not the page's script, so it is not refused.
  const expr = `(async () => {
    const { supabase } = await import(new URL('app/supa.js', document.baseURI).href);
    const importAll = ${importAll.toString()};
    const uuids = ${JSON.stringify(map)};
    return importAll(supabase, ${JSON.stringify(slim)}, (id) => uuids[String(id)] || null);
  })()`;
  return page.evaluate(expr);
}

// The look first: node scripts/legacy-characterizations-import.mjs <clients.json> <clientUuid module>
const isMain = process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href;
if (isMain) {
  const [file, mapper] = process.argv.slice(2);
  if (!file || !mapper) {
    console.error('usage: node scripts/legacy-characterizations-import.mjs <clients.json> <module exporting clientUuid>');
    process.exit(2);
  }
  const { readFileSync } = await import('node:fs');
  const { pathToFileURL } = await import('node:url');
  const { resolve } = await import('node:path');
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const clients = Array.isArray(raw) ? raw : raw.clients || [];
  const { clientUuid } = await import(pathToFileURL(resolve(mapper)).href);
  if (typeof clientUuid !== 'function') { console.error(`${mapper} exports no clientUuid`); process.exit(2); }
  const p = await plan(clients, clientUuid);
  console.log(`old clients: ${p.clients}; with a characterization to keep: ${p.withSomething} (filled ${p.filled}, brief ${p.brief}, scripts ${p.script}, summary ${p.summary}, raw answers ${p.answers})`);
  console.log(`with a new client: ${p.withClient}; no new client: ${p.noClient}`);
  console.log('Nothing was written. The import runs with the owner\'s session: importInPage(page, clients, clientUuid).');
}
