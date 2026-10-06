// The first script of every page (a plain script in <head>, so it runs before the
// page is drawn): the site is never shown inside another site's frame. A page in a
// frame can be covered with something else and the person led to press its buttons
// without seeing them. The hosting (GitHub Pages) cannot send the header that forbids
// framing, and a <meta> policy cannot say it, so the page hides itself instead.
// Security audit of 6.10.2026 (docs/ops.md, section 36).
(function () {
  var framed;
  try { framed = window.top !== window.self; } catch (e) { framed = true; }
  if (!framed) return;
  var root = document.documentElement;
  root.setAttribute('data-framed', '');
  // Through the style object, which a strict style policy allows (not an attribute).
  root.style.setProperty('display', 'none', 'important');
}());
