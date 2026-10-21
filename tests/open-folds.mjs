// The client card's reference blocks are closed rows (the status page, the gallery, the
// files, the logins, the history, the contract and the package; the owner, 20.10.2026).
// Suites that read inside them open each row once, as a person taps it: an init script
// of the browser context, on client.html only. A row closed again by the suite stays closed.
export async function openCardFolds(ctx) {
  await ctx.addInitScript(() => {
    if (!/client\.html$/.test(location.pathname)) return;
    const open = (root) => {
      for (const d of root.querySelectorAll?.('details.cc-fold') || []) {
        if (d.dataset.autoOpened) continue;
        d.dataset.autoOpened = '1';
        d.open = true;
      }
    };
    const watch = () => {
      open(document);
      new MutationObserver((list) => { for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1) { if (n.matches('details.cc-fold')) open(n.parentNode); else open(n); } })
        .observe(document.body, { childList: true, subtree: true });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();
  });
}
