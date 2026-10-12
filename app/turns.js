// Giving the page a turn in the middle of long work (docs/ops.md, section 59): a screen
// that works out forty clients, or builds a long list, in one go holds the page for a
// second on a phone, and a tap in that second does nothing. Work done a few at a time,
// with a turn between, lets the tap (and the frame) in.
// No timer is involved: a timer is clamped by the browser, and the browser suites stop
// the page's clock. `scheduler.yield` where there is one (Chrome); a message to oneself
// everywhere else (Safari on the iPhone has no `scheduler`).

let port = null;
const waiting = [];
function channel() {
  if (port || typeof MessageChannel !== 'function') return port;
  const ch = new MessageChannel();
  ch.port1.onmessage = () => { waiting.shift()?.(); };
  port = ch.port2;
  return port;
}

// Resolves after the page had its turn: what was queued before it (a tap, a frame, an
// answer of the database) runs first.
export function nextTurn() {
  if (typeof globalThis.scheduler?.yield === 'function') return globalThis.scheduler.yield();
  return new Promise((done) => {
    if (!channel()) { setTimeout(done, 0); return; }
    waiting.push(done);
    port.postMessage(0);
  });
}

// For a long loop: `const pause = pacer(); … const p = pause(); if (p) await p;`. It gives
// the turn only once the loop has held the page for `ms` (null otherwise, so a short loop
// stays one piece), and the count starts again when the loop gets the page back.
const clock = () => (typeof performance?.now === 'function' ? performance.now() : Date.now());
export function pacer(ms = 12) {
  let since = clock();
  return () => {
    if (clock() - since < ms) return null;
    return nextTurn().then(() => { since = clock(); });
  };
}
