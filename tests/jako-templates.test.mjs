// scripts/jako-templates.mjs (docs/ops.md, section 63), against a fake fetch: it is
// never run against Jako here. The default only prints; submitting needs --yes; the
// key comes from the environment or a file, never from an argument, and is never printed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, parseArgs, readKey, definitions, JAKO_BASE } from '../scripts/jako-templates.mjs';
import { TEMPLATES, metaDefinition, JAKO_ANSWER } from '../app/wa-templates.js';

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

test('the default prints the nine definitions as JSON, and calls nobody', async () => {
  for (const args of [[], ['--print']]) {
    const r = await go(args, { env: { JAKO_API_KEY: KEY } });
    assert.equal(r.code, 0);
    const defs = JSON.parse(r.text);
    assert.deepEqual(defs, Object.keys(TEMPLATES).map((k) => metaDefinition(k, { provider: 'jako' })));
    assert.deepEqual(defs.map((d) => d.name), [
      'astrateg_digest_j', 'astrateg_new_task_j', 'astrateg_due_j', 'astrateg_late_j', 'astrateg_exception_j', 'astrateg_shoot_day_j', 'astrateg_editor_assigned_j', 'astrateg_owner_digest_j', 'astrateg_review_j',
    ]);
    assert.ok(defs.every((d) => d.components.find((c) => c.type === 'BUTTONS').buttons.every((b) => b.type === 'URL')));
    assert.equal(defs.filter((d) => d.components[0].text.includes(JAKO_ANSWER)).length, 5);
    assert.equal(r.calls.length, 0);
  }
  assert.equal(definitions().length, 9);
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

test('--submit --yes creates the nine at Jako, then asks for a sync; one that is refused does not stop the rest', async () => {
  const api = fake((c) => (c.body?.name === 'astrateg_due_j' ? { status: 400, body: { message: `Template exists. key ${KEY}` } } : { status: 200, body: { status: 'ok' } }));
  const r = await go(['--submit', '--yes', '--key-file', 'k.txt'], { api, files: { 'k.txt': `${KEY}\n` } });
  assert.equal(r.code, 1);
  assert.deepEqual(r.calls.map((c) => c.path), [...Array(9).fill('/api/whatsapp-template/create'), '/api/whatsapp-template/sync']);
  assert.ok(r.calls.every((c) => c.method === 'POST' && c.auth === `Bearer ${KEY}`));
  assert.deepEqual(r.calls.slice(0, 9).map((c) => c.body), definitions());
  assert.equal(r.calls[9].body, null);
  assert.match(r.text, /astrateg_due_j\tnot submitted: 400 Template exists\. key \[key\]/);
  assert.match(r.text, /astrateg_digest_j\tsubmitted/);
  assert.match(r.text, /sync asked\n1 of 9 were not submitted/);
  assert.ok(JAKO_BASE.startsWith('https://my.jako.co.il/'));
  // All through: exit 0. Jako down: said, exit 1, no stack and no key.
  const ok = await go(['--submit', '--yes'], { env: { JAKO_API_KEY: KEY } });
  assert.equal(ok.code, 0);
  assert.match(ok.text, /all nine submitted/);
  const down = await go(['--submit', '--yes'], { env: { JAKO_API_KEY: KEY }, api: fake(() => ({ throw: new TypeError(`fetch failed ${KEY}`) })) });
  assert.equal(down.code, 1);
  assert.match(down.text, /not submitted: 0 network error/);
});

test('--status lists name, language and status for the nine, from Jako\'s list', async () => {
  const listed = [
    ...definitions().slice(0, 7).map((d) => ({ name: d.name, lang: 'he', status: 'APPROVED', namespace: 'ns' })),
    { name: 'astrateg_owner_digest_j', language: 'he', status: 'PENDING', namespace: 'ns' },
    { name: 'someone_elses', lang: 'en', status: 'APPROVED', namespace: 'ns' },
  ];
  const api = fake(() => ({ status: 200, body: { data: listed } }));
  const r = await go(['--status'], { env: { JAKO_API_KEY: KEY }, api });
  assert.equal(r.code, 1, 'not all approved yet');
  assert.deepEqual(r.calls.map((c) => [c.method, c.path, c.query]), [['POST', '/api/whatsapp-template/list', { limit: '100', page: '1' }]]);
  assert.equal(r.lines.length, 10);
  assert.equal(r.lines[0], 'astrateg_digest_j\the\tAPPROVED');
  assert.equal(r.lines[7], 'astrateg_owner_digest_j\the\tPENDING');
  assert.equal(r.lines[8], 'astrateg_review_j\t-\tmissing');
  assert.equal(r.lines[9], '7 of 9 approved');
  assert.ok(!r.text.includes('someone_elses'));
  const all = fake(() => ({ status: 200, body: { data: definitions().map((d) => ({ name: d.name, lang: 'he', status: 'approved', namespace: 'ns' })) } }));
  assert.equal((await go(['--status'], { env: { JAKO_API_KEY: KEY }, api: all })).code, 0);
  const refused = await go(['--status'], { env: { JAKO_API_KEY: KEY }, api: fake(() => ({ status: 401, body: { message: 'Unauthenticated.' } })) });
  assert.deepEqual([refused.code, refused.text], [1, 'the list could not be read: 401 Unauthenticated.']);
});
