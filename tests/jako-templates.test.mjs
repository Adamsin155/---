// scripts/jako-templates.mjs (docs/ops.md, section 63), against a fake fetch: it is
// never run against Jako here. The default only prints; submitting needs --yes; the
// key comes from the environment or a file, never from an argument, and is never printed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, parseArgs, readKey, definitions, JAKO_BASE } from '../scripts/jako-templates.mjs';
import { jakoDefinition } from '../app/wa-templates.js';

const KEY = 'JAKO-KEY-0123456789-abcdefghij';
function fake(answer = () => ({ status: 200, body: { status: 'ok' } })) {
  const calls = [];
  const fetch = async (url, init) => {
    const u = new URL(url);
    const call = { method: init.method, path: u.pathname, query: Object.fromEntries(u.searchParams), auth: init.headers.Authorization, body: init.body ? JSON.parse(init.body) : null };
    calls.push(call);
    const a = answer(call);
    if (a.throw) throw a.throw;
    return { ok: a.status < 300, status: a.status, json: async () => a.body };
  };
  return { fetch, calls };
}
async function go(args, { env = {}, api = fake(), files = {} } = {}) {
  const lines = [];
  const code = await run({ args, env, fetch: api.fetch, readFile: (p) => { if (!(p in files)) throw new Error('ENOENT'); return files[p]; }, out: (l) => lines.push(l) });
  const text = lines.join('\n');
  assert.ok(!text.includes(KEY), 'the key is never printed');
  return { code, text, lines, calls: api.calls };
}
// A row of Jako's list, as the workspace returns it.
const row = (name, over = {}) => ({ id: 7, name, language: 'he', category: 'UTILITY', status: 'APPROVED', namespace: 'ns', components: [], params: [], rejected_reason: 'NONE', ...over });

test('the default prints the three definitions to create as JSON, and calls nobody', async () => {
  for (const args of [[], ['--print']]) {
    const r = await go(args, { env: { JAKO_API_KEY: KEY } });
    assert.equal(r.code, 0);
    assert.match(r.lines[0], /^# To create at Jako: the 3 below/);
    const defs = JSON.parse(r.text.slice(r.text.indexOf('[')));
    assert.deepEqual(defs, [jakoDefinition('nodnik'), jakoDefinition('reminder'), jakoDefinition('summary')]);
    assert.deepEqual(defs.map((d) => [d.name, d.language, d.category]), [['astrateg_nodnik', 'he', 'UTILITY'], ['astrateg_reminder', 'he', 'UTILITY'], ['astrateg_summary', 'he', 'UTILITY']]);
    assert.deepEqual(defs.map((d) => d.components.at(-1).buttons.map((b) => b.type)), [['QUICK_REPLY', 'QUICK_REPLY'], ['QUICK_REPLY', 'URL'], ['URL']]);
    assert.equal(r.calls.length, 0);
  }
  assert.equal(definitions().length, 3);
});

test('submitting needs --yes and a key from the environment or a file, never from an argument', async () => {
  let r = await go(['--submit'], { env: { JAKO_API_KEY: KEY } });
  assert.deepEqual([r.code, r.calls.length], [2, 0]);
  assert.match(r.text, /--yes/);
  r = await go(['--submit', '--yes']);
  assert.deepEqual([r.code, r.calls.length], [2, 0]);
  assert.match(r.text, /JAKO_API_KEY/);
  for (const args of [['--submit', '--yes', '--key', KEY], ['--status', `--api-key=${KEY}`], ['--status', KEY], ['--submit', '--status', '--yes'], ['--status', '--key-file']]) {
    r = await go(args, { env: { JAKO_API_KEY: KEY } });
    assert.deepEqual([r.code, r.calls.length], [2, 0], args.join(' ').replace(KEY, '…'));
  }
  assert.match((await go(['--status', '--key-file', 'nope.txt'])).text, /could not be read/);
  assert.deepEqual(parseArgs(['--status', '--key-file', 'k.txt']), { mode: 'status', yes: false, keyFile: 'k.txt' });
  assert.deepEqual(readKey({ env: {}, keyFile: 'k.txt', readFile: () => `${KEY}\r\n` }), { key: KEY });
  assert.ok(readKey({ env: { JAKO_API_KEY: 'short' }, keyFile: null, readFile: () => '' }).error);
  assert.ok(readKey({ env: {}, keyFile: 'k.txt', readFile: () => `two words ${KEY}` }).error);
});

test('--submit --yes creates the three at Jako, then asks for a sync; one that is refused does not stop the other', async () => {
  const api = fake((c) => (c.body?.name === 'astrateg_reminder' ? { status: 400, body: { message: `Template exists. key ${KEY}` } } : { status: 200, body: { status: 'ok' } }));
  const r = await go(['--submit', '--yes', '--key-file', 'k.txt'], { api, files: { 'k.txt': `${KEY}\n` } });
  assert.equal(r.code, 1);
  assert.deepEqual(r.calls.map((c) => c.path), ['/api/whatsapp-template/create', '/api/whatsapp-template/create', '/api/whatsapp-template/create', '/api/whatsapp-template/sync']);
  assert.ok(r.calls.every((c) => c.method === 'POST' && c.auth === `Bearer ${KEY}`));
  assert.deepEqual(r.calls.slice(0, 3).map((c) => c.body), definitions());
  assert.equal(r.calls[3].body, null);
  assert.match(r.text, /astrateg_reminder\tnot submitted: 400 Template exists\. key \[key\]/);
  assert.match(r.text, /astrateg_summary\tsubmitted/);
  assert.match(r.text, /sync asked\n1 of 3 were not submitted/);
  assert.ok(JAKO_BASE.startsWith('https://my.jako.co.il/'));
  // Both through: exit 0. Jako down: said, exit 1, no stack and no key.
  const ok = await go(['--submit', '--yes'], { env: { JAKO_API_KEY: KEY } });
  assert.equal(ok.code, 0);
  assert.match(ok.text, /all 3 submitted/);
  const down = await go(['--submit', '--yes'], { env: { JAKO_API_KEY: KEY }, api: fake(() => ({ throw: new TypeError(`fetch failed ${KEY}`) })) });
  assert.equal(down.code, 1);
  assert.match(down.text, /not submitted: 0 network error/);
});

test('--status lists the three with language and status, and says which is missing or not APPROVED', async () => {
  const listed = [
    row('astrateg_nodnik', { status: 'PENDING' }),
    row('astrateg_summary'),
    row('astrateg_summary', { language: 'en', status: 'REJECTED' }), // another language is another template
    row('someone_elses'),
  ];
  const api = fake(() => ({ status: 200, body: { data: listed } }));
  const r = await go(['--status'], { env: { JAKO_API_KEY: KEY }, api });
  assert.equal(r.code, 1, 'not all approved yet');
  assert.deepEqual(r.calls.map((c) => [c.method, c.path, c.query]), [['POST', '/api/whatsapp-template/list', { limit: '100', page: '1' }]]);
  assert.deepEqual(r.lines, [
    'astrateg_nodnik\the\tPENDING',
    'astrateg_reminder\t-\tMISSING',
    'astrateg_summary\the\tAPPROVED',
    'not ready (missing or not APPROVED): astrateg_nodnik, astrateg_reminder',
  ]);
  // A rejection's reason is shown; an approved template without a namespace cannot be sent.
  const bad = fake(() => ({ status: 200, body: { data: [row('astrateg_nodnik', { status: 'REJECTED', rejected_reason: 'INVALID_FORMAT' }), row('astrateg_reminder', { namespace: null }), row('astrateg_summary')] } }));
  const b = await go(['--status'], { env: { JAKO_API_KEY: KEY }, api: bad });
  assert.deepEqual(b.lines.slice(0, 2), ['astrateg_nodnik\the\tREJECTED\t(INVALID_FORMAT)', 'astrateg_reminder\the\tAPPROVED\t(no namespace)']);
  assert.equal(b.code, 1);
  const all = fake(() => ({ status: 200, body: { data: [row('astrateg_nodnik'), row('astrateg_reminder'), row('astrateg_summary')] } }));
  const a = await go(['--status'], { env: { JAKO_API_KEY: KEY }, api: all });
  assert.deepEqual([a.code, a.lines.at(-1)], [0, 'all 3 approved']);
  const refused = await go(['--status'], { env: { JAKO_API_KEY: KEY }, api: fake(() => ({ status: 401, body: { message: 'Unauthenticated.' } })) });
  assert.deepEqual([refused.code, refused.text], [1, 'the list could not be read: 401 Unauthenticated.']);
});
