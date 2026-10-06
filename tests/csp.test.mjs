// Every page's <head> (security audit of 6.10.2026; docs/ops.md, section 36): a
// Content-Security-Policy that lets in only the site's own files and the office's
// Supabase project, no Referer to other sites, and the frame guard as the first
// script. A page added later fails here until it has all three. That the policy
// breaks nothing is checked in the browser suites (tests/*-e2e.mjs fail on any
// console error, and a refused load is one).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { SUPABASE_URL } from '../app/supa.js';

const ROOT = new URL('../', import.meta.url);
const PAGES = [...readdirSync(ROOT).filter((f) => f.endsWith('.html')).sort(), 'payouts/index.html'];
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');
const policyOf = (html) => /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)?.[1] ?? null;
const parse = (policy) => Object.fromEntries(policy.split(';').map((d) => d.trim().split(/\s+/)).map(([name, ...values]) => [name, values]));

const SITE = {
  'default-src': ["'none'"],
  'script-src': ["'self'"],
  // Bars and colours are set as style attributes from the scripts (h(..., { style })).
  'style-src': ["'self'", "'unsafe-inline'"],
  // The logo; a signature drawn in the page (data:); a preview of a file being uploaded (blob:); the client's files.
  'img-src': ["'self'", 'data:', 'blob:', SUPABASE_URL],
  'media-src': ["'self'", 'blob:', SUPABASE_URL],
  'font-src': ["'self'", 'data:'],
  // The database, the functions and the uploads (also the resumable ones) are all on the project's host.
  'connect-src': ["'self'", SUPABASE_URL],
  'manifest-src': ["'self'"],
  'worker-src': ["'self'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
  'object-src': ["'none'"],
};
// The client's logins form keeps its own, stricter policy (no inline style, no files, no worker).
const ACCESS = {
  'default-src': ["'none'"], 'script-src': ["'self'"], 'style-src': ["'self'"], 'img-src': ["'self'"], 'font-src': ["'self'"],
  'connect-src': [SUPABASE_URL], 'base-uri': ["'none'"], 'form-action': ["'none'"],
};

test('there are pages to check, and the project host is the one the app talks to', () => {
  assert.ok(PAGES.length >= 26, String(PAGES.length));
  assert.equal(SUPABASE_URL, 'https://czncjzziqrqtezpwxxpz.supabase.co');
});

test('every page has the policy: its own files and the office\'s Supabase project, nothing else', () => {
  for (const page of PAGES) {
    const policy = policyOf(read(page));
    assert.ok(policy, `${page}: no Content-Security-Policy`);
    assert.deepEqual(parse(policy), page === 'access.html' ? ACCESS : SITE, page);
    // Nothing that would let a script in from elsewhere, or run text as script.
    const p = parse(policy);
    for (const bad of ["'unsafe-eval'", '*', 'https:', 'http:', "'unsafe-hashes'"]) for (const [name, values] of Object.entries(p)) assert.ok(!values.includes(bad), `${page}: ${name} ${bad}`);
    assert.ok(!p['script-src'].includes("'unsafe-inline'"), page);
    assert.ok(!p['script-src'].includes('data:') && !p['script-src'].includes('blob:'), page);
  }
});

test('no page has code or a handler written into it, or loads anything from another site', () => {
  for (const page of PAGES) {
    const html = read(page);
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    for (const [, attrs, body] of scripts) {
      assert.match(attrs, /\bsrc="/, `${page}: an inline script`);
      assert.equal(body.trim(), '', `${page}: code inside a script tag`);
    }
    assert.equal((html.match(/\son[a-z]+\s*=\s*["']/g) || []).length, 0, `${page}: an inline event handler`);
    assert.equal((html.match(/<style\b/g) || []).length, 0, `${page}: a style block`);
    assert.equal((html.match(/<(iframe|object|embed|base)\b/g) || []).length, 0, `${page}: a frame, an object or a base`);
    const outside = [...html.matchAll(/<(?:script|link|img|video|audio|source)\b[^>]*\b(?:src|href)="((?:https?:)?\/\/[^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(outside, [], `${page}: loads from another site`);
    assert.equal((html.match(/javascript:/gi) || []).length, 0, page);
  }
});

test('the frame guard is the first script of every page, and no Referer leaves any page', () => {
  const guard = read('app/frame-guard.js');
  assert.match(guard, /try \{ framed = window\.top !== window\.self; \} catch \(e\) \{ framed = true; \}/);
  assert.match(guard, /root\.style\.setProperty\('display', 'none', 'important'\);/);
  assert.doesNotMatch(guard, /\b(import|export|let|const|=>)\b/, 'a plain script that any browser runs before the page is drawn');
  for (const page of PAGES) {
    const html = read(page);
    const first = /<script\b([^>]*)>/.exec(html);
    const src = page.startsWith('payouts/') ? '../app/frame-guard.js' : 'app/frame-guard.js';
    assert.equal(first?.[1].trim(), `src="${src}"`, `${page}: the first script (not a module, not deferred)`);
    assert.ok(html.indexOf(first[0]) < html.indexOf('</head>'), `${page}: in the head`);
    assert.ok(html.indexOf(first[0]) < html.indexOf('rel="stylesheet"') || !html.includes('rel="stylesheet"'), `${page}: before the styles`);
    assert.match(html, /<meta name="referrer" content="no-referrer">/, `${page}: referrer`);
    // The policy stands before anything the page loads.
    assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('rel="stylesheet"'), `${page}: the policy before the styles`);
  }
});

test('what the policy allows is what the scripts use: no other host, no code from text', () => {
  const dir = new URL('app/', ROOT);
  const files = [...readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => `app/${f}`), ...readdirSync(new URL('payouts/', dir)).filter((f) => f.endsWith('.js')).map((f) => `app/payouts/${f}`), 'sw.js'];
  for (const f of files) {
    const code = read(f).replace(/\/\/[^\n]*/g, '');
    assert.doesNotMatch(code, /\beval\(|new Function\(|\.innerHTML\s*=|insertAdjacentHTML|document\.write\(|\.srcdoc\b/, `${f}: text run as code or markup`);
    assert.doesNotMatch(code, /new (Worker|SharedWorker|WebSocket|EventSource)\(/, `${f}: a channel the policy does not allow`);
  }
});
