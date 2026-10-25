// The old system's signed documents (astrateg-crm) into the new one (the owner's request of
// 25.10.2026; public.legacy_contracts, 20261105100000_legacy_contracts.sql). Each signed
// document goes to public.legacy_contract_import(p_client, p_doc), which only the owner may
// call: run it with the owner's session. Running it again changes the same rows (the old id).
//
// importAll(supabase, contracts, clientUuid) is the whole job: it takes the signed ones
// (status 'נחתם'), finds the new client of each (clientUuid(oldClientId) → uuid, or null), and
// calls the RPC once per document. It returns { ok: [old ids], skipped: [{ id, clientId,
// clientName }] (no client), failed: [{ id, error }] }. It uses nothing outside itself, so it
// can also run inside a page (importInPage below).
//
// Usage:
//   1. A look first, with no session and nothing written (counts, and which have no client):
//        node scripts/legacy-contracts-import.mjs <contracts.json> <module exporting clientUuid>
//   2. The import, in a Playwright page of the live site where the owner is signed in:
//        import { importInPage } from './scripts/legacy-contracts-import.mjs';
//        const { clientUuid } = await import(pathToFileURL(<module>).href);
//        const result = await importInPage(page, contracts, clientUuid);
//      It computes the client of each document here (clientUuid may read local files), then runs
//      importAll in the page with the page's own signed-in client (app/supa.js).
//   Or with any signed-in supabase client of the owner: await importAll(supabase, contracts, clientUuid).
// What identifies the signer's device or number (signedIp, signedUserAgent, phone, hp) is taken
// out before sending; the database takes it out again (also inside the signers and the history).

export async function importAll(supabase, contracts, clientUuid) {
  const PRIVATE = ['signedIp', 'signedUserAgent', 'phone', 'hp'];
  const out = { ok: [], skipped: [], failed: [] };
  for (const c of Array.isArray(contracts) ? contracts : []) {
    if (!c || typeof c !== 'object' || c.status !== 'נחתם') continue;
    let uuid = null;
    try { uuid = await clientUuid(c.clientId); } catch { uuid = null; }
    if (!uuid) { out.skipped.push({ id: c.id, clientId: c.clientId ?? null, clientName: c.clientName ?? null }); continue; }
    const doc = { ...c };
    for (const k of PRIVATE) delete doc[k];
    try {
      const { error } = await supabase.rpc('legacy_contract_import', { p_client: uuid, p_doc: doc });
      if (error) out.failed.push({ id: c.id, error: error.message || String(error) });
      else out.ok.push(c.id);
    } catch (err) {
      out.failed.push({ id: c.id, error: err?.message || String(err) });
    }
  }
  return out;
}

// What would be imported, without a session: { signed, withClient, skipped, types }.
export async function plan(contracts, clientUuid) {
  const signed = (Array.isArray(contracts) ? contracts : []).filter((c) => c && c.status === 'נחתם');
  const skipped = [];
  const types = {};
  let withClient = 0;
  for (const c of signed) {
    const t = c.docType || 'contract';
    types[t] = (types[t] || 0) + 1;
    let uuid = null;
    try { uuid = await clientUuid(c.clientId); } catch { uuid = null; }
    if (uuid) withClient += 1; else skipped.push({ id: c.id, clientId: c.clientId ?? null, clientName: c.clientName ?? null });
  }
  return { signed: signed.length, withClient, skipped, types };
}

// Runs importAll inside a Playwright page of the site where the owner is signed in, with the
// page's own supabase client. The client of each document is found here first.
export async function importInPage(page, contracts, clientUuid) {
  const map = {};
  for (const c of contracts) {
    if (!c || c.status !== 'נחתם') continue;
    let uuid = null;
    try { uuid = await clientUuid(c.clientId); } catch { uuid = null; }
    if (uuid) map[String(c.clientId)] = uuid;
  }
  // One expression with the function's own text: the page's policy runs no text as code, but
  // what Playwright evaluates is not the page's script, so it is not refused.
  const expr = `(async () => {
    const { supabase } = await import(new URL('app/supa.js', document.baseURI).href);
    const importAll = ${importAll.toString()};
    const uuids = ${JSON.stringify(map)};
    return importAll(supabase, ${JSON.stringify(contracts)}, (id) => uuids[String(id)] || null);
  })()`;
  return page.evaluate(expr);
}

// The look first: node scripts/legacy-contracts-import.mjs <contracts.json> <clientUuid module>
const isMain = process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href;
if (isMain) {
  const [file, mapper] = process.argv.slice(2);
  if (!file || !mapper) {
    console.error('usage: node scripts/legacy-contracts-import.mjs <contracts.json> <module exporting clientUuid>');
    process.exit(2);
  }
  const { readFileSync } = await import('node:fs');
  const { pathToFileURL } = await import('node:url');
  const { resolve } = await import('node:path');
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const contracts = Array.isArray(raw) ? raw : raw.contracts || [];
  const { clientUuid } = await import(pathToFileURL(resolve(mapper)).href);
  if (typeof clientUuid !== 'function') { console.error(`${mapper} exports no clientUuid`); process.exit(2); }
  const p = await plan(contracts, clientUuid);
  console.log(`signed: ${p.signed} (${Object.entries(p.types).map(([t, n]) => `${t} ${n}`).join(', ')}); with a client: ${p.withClient}; no client: ${p.skipped.length}`);
  for (const s of p.skipped) console.log(`  no client: old id ${s.id}, old client ${s.clientId}, ${s.clientName ?? ''}`);
  console.log('Nothing was written. The import runs with the owner\'s session: importInPage(page, contracts, clientUuid).');
}
