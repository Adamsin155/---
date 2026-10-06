// The public pages' secret links (app/link-token.js; docs/ops.md, section 36): the
// office's links carry the token in the fragment, which a browser sends to no server,
// and a link sent before (?t=…) still opens.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tokenFrom, tokenUrl, pageToken } from '../app/link-token.js';
import * as access from '../app/access-logic.js';
import { statusUrl } from '../app/status-logic.js';
import { galleryUrl } from '../app/files-logic.js';
import { shareUrl as scriptsUrl } from '../app/scripts-logic.js';

const TOK = 'A'.repeat(43);
const BASE = 'https://app.astrateg.tech/client.html?id=1#tasks';
const src = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('the links the office sends carry the token after #, never in the query', () => {
  const links = {
    'status.html': statusUrl(BASE, TOK),
    'gallery.html': galleryUrl(BASE, TOK),
    'scripts-view.html': scriptsUrl(BASE, TOK),
  };
  for (const [page, link] of Object.entries(links)) {
    const u = new URL(link);
    assert.equal(link, `https://app.astrateg.tech/${page}#t=${TOK}`, page);
    assert.equal(u.search, '', `${page}: nothing a server or a Referer would carry`);
    assert.equal(tokenFrom(u), TOK, page);
  }
  assert.equal(tokenUrl('status.html', BASE, 'a b/c'), 'https://app.astrateg.tech/status.html#t=a%20b%2Fc');
  // The quote's and the Gantt's links are built next to the page (they need `window` / import.meta).
  assert.match(src('app/supa.js'), /return `\$\{new URL\('q\.html', window\.location\.href\)\.href\}#t=\$\{encodeURIComponent\(token\)\}`;/);
  assert.match(src('app/gantt-data.js'), /export const shareUrl = \(token\) => `\$\{new URL\('\.\.\/gantt\.html', import\.meta\.url\)\.href\}#t=\$\{encodeURIComponent\(token\)\}`;/);
  // No builder of a public link is left with the token in the query.
  for (const f of ['app/supa.js', 'app/gantt-data.js', 'app/status-logic.js', 'app/files-logic.js', 'app/scripts-logic.js']) {
    assert.doesNotMatch(src(f), /\.html\?t=\$\{/, f);
  }
});

test('both forms are read, the fragment first; a link sent before the change still opens', () => {
  assert.equal(tokenFrom({ hash: `#t=${TOK}`, search: '' }), TOK);
  assert.equal(tokenFrom({ hash: '', search: `?t=${TOK}` }), TOK, 'an old link');
  assert.equal(tokenFrom({ hash: '#t=new', search: '?t=old' }), 'new');
  assert.equal(tokenFrom({ hash: '#approvals', search: `?t=${TOK}` }), TOK, 'an old link, after a jump inside the page');
  assert.equal(tokenFrom({ hash: `#t=${TOK}&x=1`, search: '?id=5' }), TOK);
  for (const none of [{}, { hash: '', search: '' }, { hash: '#mine', search: '?id=5' }, undefined]) assert.equal(tokenFrom(none), '');
  // The same reading as the logins form's own copy.
  for (const loc of [{ hash: `#t=${TOK}`, search: '' }, { hash: '', search: `?t=${TOK}` }, { hash: '#t=a', search: '?t=b' }, { hash: '#x', search: '' }]) {
    assert.equal(tokenFrom(loc), access.tokenFrom(loc), JSON.stringify(loc));
  }
});

test('the page keeps its token for the tab, so a jump inside the page and a reload still open it', () => {
  const store = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), size: () => m.size }; };
  const tab = store();
  assert.equal(pageToken({ pathname: '/status.html', hash: `#t=${TOK}`, search: '' }, tab), TOK);
  // The client taps "לאישורים" (#approvals), then the phone reloads the tab.
  assert.equal(pageToken({ pathname: '/status.html', hash: '#approvals', search: '' }, tab), TOK);
  assert.equal(pageToken({ pathname: '/status.html', hash: '', search: '' }, tab), TOK);
  // Another page of the site in the same tab does not get it; a new link replaces it.
  assert.equal(pageToken({ pathname: '/gallery.html', hash: '', search: '' }, tab), '');
  assert.equal(pageToken({ pathname: '/status.html', hash: '', search: '?t=other' }, tab), 'other');
  assert.equal(pageToken({ pathname: '/status.html', hash: '', search: '' }, tab), 'other');
  // Another tab (its own storage) has nothing; no storage at all: the address alone.
  assert.equal(pageToken({ pathname: '/status.html', hash: '', search: '' }, store()), '');
  assert.equal(pageToken({ pathname: '/status.html', hash: `#t=${TOK}`, search: '' }, null), TOK);
  assert.equal(pageToken({ pathname: '/status.html', hash: `#t=${TOK}`, search: '' }, { setItem() { throw new Error('denied'); } }), TOK);
  // Every public page reads its token through this module (the Gantt: the address only).
  for (const f of ['app/client.js', 'app/status.js', 'app/gallery.js', 'app/scripts-view.js']) assert.match(src(f), /const token = pageToken\(\);/, f);
  assert.match(src('app/gantt.js'), /const TOKEN = tokenFrom\(location\) \|\| \(params\.has\('t'\) \? '' : null\);/);
});
