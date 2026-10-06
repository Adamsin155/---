// Stored addresses never run as script or lead to another site (security audit of
// 6.10.2026; docs/ops.md, section 36): the element builder leaves out an address with
// a dangerous scheme, the client card turns only https:// links into links, and a
// notification opens a page of this site only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { safeUrlAttr } from '../app/quote-doc.js';
import { safeLink } from '../app/gantt-logic.js';
import { sitePage } from '../app/push-logic.js';

const src = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('h(): href, src and the like take no javascript:, vbscript: or data: address', () => {
  for (const ok of ['client.html?id=1#tasks', '#top', '', './x.html', '../quotes.html', '/x', 'https://drive.google.com/x', 'http://localhost:8080/access.html#t=abc',
    'mailto:a@b.co?subject=x', 'tel:+972501234567', 'blob:https://app.astrateg.tech/1234', 'webcal://x.example/feed.ics', 'whatsapp://send?text=x',
    'https://wa.me/972501234567?text=a:b']) {
    assert.equal(safeUrlAttr('href', ok), true, ok);
  }
  for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'java\nscript:alert(1)', '\u0001javascript:alert(1)',
    'vbscript:msgbox(1)', 'data:text/html,<script>alert(1)</script>', 'data:image/svg+xml,<svg onload=alert(1)>', 'file:///etc/passwd', 'intent://x', 'ms-msdt:x']) {
    assert.equal(safeUrlAttr('href', bad), false, JSON.stringify(bad));
    assert.equal(safeUrlAttr('src', bad), false, JSON.stringify(bad));
  }
  // A picture drawn in the page (the signature) is a data: address in src, never in a link.
  assert.equal(safeUrlAttr('src', 'data:image/png;base64,iVBORw0KGgo='), true);
  assert.equal(safeUrlAttr('href', 'data:image/png;base64,iVBORw0KGgo='), false);
  assert.equal(safeUrlAttr('src', 'data:image/svg+xml;base64,PHN2Zz4='), false);
  // The builder asks before it sets one of these attributes.
  assert.match(src('app/quote-doc.js'), /if \(URL_ATTRS\.has\(k\) && !safeUrlAttr\(k, v\)\) continue;/);
});

test('the client card: only an https:// link becomes a link, when shown and when saved', () => {
  assert.equal(safeLink('https://drive.google.com/drive/folders/abc'), 'https://drive.google.com/drive/folders/abc');
  for (const bad of ['javascript:alert(1)', 'http://drive.google.com/x', '//evil.example', 'drive.google.com/x', 'https://a b', 'https://x"y', 'https://x<y', '', null, undefined, 5]) {
    assert.equal(safeLink(bad), null, String(bad));
  }
  const card = src('app/client-card.js');
  // No link of the card is read into an href without safeLink.
  assert.doesNotMatch(card, /href: links\[l\.key\]\s*\|\||href: client\.links/);
  assert.match(card, /const links = Object\.fromEntries\(LINKS\.map\(\(l\) => \[l\.key, safeLink\(client\.links\?\.\[l\.key\]\)\]\)\);/);
  assert.match(card, /const link = PROC_LINK\[pid\] && safeLink\(client\.links\?\.\[PROC_LINK\[pid\]\]\);/);
  assert.match(card, /if \(!safeLink\(v\)\) \{ input\.setAttribute\('aria-invalid', 'true'\); return \{ error: 'זה לא נראה כמו קישור/);
  assert.equal(card.match(/client\.links\?\.\[/g).length, 2, 'every read of a card link goes through safeLink (a new one needs it too)');
});

test('a notification opens a page of this site only', () => {
  const base = 'https://adamsin155.github.io/---/';
  assert.equal(sitePage('clients.html#mine', base), `${base}clients.html#mine`);
  assert.equal(sitePage('client.html?id=3f0c&p=p12#access', base), `${base}client.html?id=3f0c&p=p12#access`);
  assert.equal(sitePage('gantt.html?id=1&m=2026-10&d=2026-10-06', 'http://localhost:8080/'), 'http://localhost:8080/gantt.html?id=1&m=2026-10&d=2026-10-06');
  for (const bad of ['//evil.example/x', '/\\evil.example', '\\\\evil.example', 'https://evil.example/clients.html', 'javascript:alert(1)', 'JAVASCRIPT:alert(1)',
    'clients.html\\@evil.example', '../x.html', '/clients.html', 'x/clients.html', 'clients.html?a b', 'clients', '', null, undefined]) {
    assert.equal(sitePage(bad, base), null, String(bad));
  }
  assert.equal(sitePage('clients.html', 'not a url'), null);
  // The inbox uses it, and no longer resolves whatever is stored.
  const push = src('app/push.js');
  assert.match(push, /const open = sitePage\(r\.url, new URL\('\.\.\/', import\.meta\.url\)\.href\);/);
  assert.doesNotMatch(push, /new URL\(r\.url/);
  // The same rule as the database's check on new rows (reminder_log_url_page).
  const sql = src('supabase/migrations/20261014100000_security_hardening.sql');
  assert.ok(sql.includes("url ~ '^[a-z0-9-]+\\.html([?#][^\\s\\\\]*)?$'"));
  assert.ok(src('app/push-logic.js').includes('/^[a-z0-9-]+\\.html([?#][^\\s\\\\]*)?$/'));
});
