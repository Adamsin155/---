// Shows the notifications of clients.html where only a service worker may
// (Chrome on Android refuses `new Notification`). clients.js registers it on
// the first such refusal and calls showNotification with data.href, the page to
// open. It handles no requests: no fetch handler, no cache, and its scope
// (app/) holds no page.
self.addEventListener('install', () => self.skipWaiting());

// A tap opens the page the notification is about (the same site only), or
// brings forward the window already on it.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  let href = null;
  try { href = new URL(event.notification.data?.href); } catch { return; }
  if (href.origin !== self.location.origin) return;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = wins.find((w) => w.url === href.href);
    if (open) return open.focus();
    return self.clients.openWindow(href.href);
  })());
});
