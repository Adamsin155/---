// Every browser suite watches its pages for what the Content-Security-Policy refused
// (docs/ops.md, section 36): a policy that silently breaks an upload, the signature
// pad, a video, printing or the service worker is worse than none, so a refused load
// or a refused style fails the suite that met it. The browser reports a refusal as a
// console error that names the policy; the page is also asked directly
// (the `securitypolicyviolation` event), which catches a refusal with no console line.
import assert from 'node:assert/strict';

export const cspViolations = [];

export function watchCsp(page) {
  page.on('console', (m) => {
    const text = m.text();
    if (/Content Security Policy|Content-Security-Policy/.test(text)) cspViolations.push(`${page.url().split(/[?#]/)[0]}: ${text.slice(0, 300)}`);
  });
  // Before any script of the page: the event is heard from the first load on.
  page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`Content Security Policy violation: ${e.violatedDirective} blocked ${e.blockedURI || 'inline'} (${e.sourceFile || ''}:${e.lineNumber || 0})`);
    });
  }).catch(() => { /* the page closed first */ });
}

// At the end of a suite.
export function noCspViolations() {
  assert.deepEqual([...new Set(cspViolations)], [], 'the Content-Security-Policy refused something a page needs');
}
