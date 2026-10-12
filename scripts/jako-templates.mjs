// The nine staff WhatsApp templates, as Jako (my.jako.co.il) takes them: the same
// names with the suffix `_j`, the same bodies, footer and link button, and no quick
// replies (app/wa-templates.js; docs/ops.md, section 63). Run by hand, by whoever
// sets the channel up; nothing in the app or in the tests calls Jako through it.
//
// Usage: node scripts/jako-templates.mjs              print the nine definitions (JSON)
//        node scripts/jako-templates.mjs --status     name, language and status, from Jako's list
//        node scripts/jako-templates.mjs --submit --yes
//                                                     create them at Jako, then ask it to sync with Meta
//
// The API key is read from the environment variable JAKO_API_KEY, or from a file
// given with --key-file <path> (the key alone in it). Never from an argument (it
// would stay in the shell's history), and it is never printed.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TEMPLATES, metaDefinition } from '../app/wa-templates.js';

export const JAKO_BASE = 'https://my.jako.co.il/api';
const TIMEOUT = 20000;

export const definitions = () => Object.keys(TEMPLATES).map((key) => metaDefinition(key, { provider: 'jako' }));

// → { mode: 'print' | 'status' | 'submit', yes, keyFile } or { error }.
export function parseArgs(args) {
  const out = { mode: 'print', yes: false, keyFile: null };
  const modes = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--print' || a === '--status' || a === '--submit') modes.push(a.slice(2));
    else if (a === '--yes') out.yes = true;
    else if (a === '--key-file') {
      if (!args[i + 1] || args[i + 1].startsWith('--')) return { error: '--key-file needs a path' };
      out.keyFile = args[i += 1];
    } else if (/^--(api-)?key(=|$)/.test(a)) return { error: 'the key is not given as an argument: use JAKO_API_KEY or --key-file <path>' };
    else return { error: 'unknown argument (the options: --print, --status, --submit --yes, --key-file <path>)' };
  }
  if (modes.length > 1) return { error: 'one of --print, --status, --submit' };
  if (modes.length) [out.mode] = modes;
  if (out.mode === 'submit' && !out.yes) return { error: '--submit sends nine templates to Meta for approval through Jako: add --yes to go ahead' };
  return out;
}

export function readKey({ env, keyFile, readFile }) {
  let key = '';
  if (keyFile) {
    try { key = String(readFile(keyFile, 'utf8')); } catch { return { error: 'the key file could not be read' }; }
  } else key = String(env.JAKO_API_KEY || '');
  key = key.trim();
  if (key.length < 20 || /\s/.test(key)) return { error: 'no API key: set JAKO_API_KEY, or give --key-file <path>' };
  return { key };
}

/**
 * @param {{ args: string[], env?: Record<string, string | undefined>, fetch?: typeof fetch,
 *   readFile?: (path: string, enc: string) => string, out?: (line: string) => void, base?: string }} opts
 * @returns {Promise<number>} the exit code
 */
export async function run({ args, env = {}, fetch = globalThis.fetch, readFile = readFileSync, out = console.log, base = JAKO_BASE }) {
  const opt = parseArgs(args);
  if (opt.error) { out(opt.error); return 2; }
  if (opt.mode === 'print') { out(JSON.stringify(definitions(), null, 2)); return 0; }
  const k = readKey({ env, keyFile: opt.keyFile, readFile });
  if (k.error) { out(k.error); return 2; }
  // Whatever Jako answers is shown without the key, should it ever be echoed back.
  const safe = (text) => String(text ?? '').split(k.key).join('[key]').replace(/\s+/g, ' ').slice(0, 200);
  const call = async (path, body = null) => {
    try {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${k.key}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(TIMEOUT) : undefined,
      });
      let data = null;
      try { data = await res.json(); } catch { /* not JSON */ }
      return { ok: res.ok, status: res.status, data };
    } catch (err) {
      return { ok: false, status: 0, data: { message: err?.name === 'TimeoutError' ? 'timeout' : 'network error' } };
    }
  };

  if (opt.mode === 'status') {
    const seen = new Map();
    for (let page = 1; page <= 5; page += 1) {
      const res = await call(`/whatsapp-template/list?limit=100&page=${page}`);
      if (!res.ok) { out(`the list could not be read: ${res.status} ${safe(res.data?.message)}`); return 1; }
      const rows = Array.isArray(res.data?.data) ? res.data.data : [];
      for (const r of rows) if (typeof r?.name === 'string') seen.set(r.name, r);
      if (rows.length < 100) break;
    }
    let ready = 0;
    for (const d of definitions()) {
      const r = seen.get(d.name);
      const status = r ? String(r.status ?? 'listed, no status') : 'missing';
      if (r && /^approved$/i.test(String(r.status ?? ''))) ready += 1;
      out(`${d.name}\t${r ? r.lang ?? r.language ?? '?' : '-'}\t${safe(status)}${r && !r.namespace ? '\t(no namespace)' : ''}`);
    }
    out(`${ready} of ${definitions().length} approved`);
    return ready === definitions().length ? 0 : 1;
  }

  // --submit
  let failed = 0;
  for (const d of definitions()) {
    const res = await call('/whatsapp-template/create', d);
    const ok = res.ok && res.data?.status === 'ok';
    if (!ok) failed += 1;
    out(`${d.name}\t${ok ? 'submitted' : `not submitted: ${res.status} ${safe(res.data?.message)}`}`);
  }
  const sync = await call('/whatsapp-template/sync');
  out(sync.ok ? 'sync asked' : `sync failed: ${sync.status} ${safe(sync.data?.message)}`);
  out(failed ? `${failed} of ${definitions().length} were not submitted` : 'all nine submitted: check the approval with --status');
  return failed || !sync.ok ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(await run({ args: process.argv.slice(2), env: process.env }));
}
