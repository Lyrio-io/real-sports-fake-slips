// Service worker for Real Sports Fake Slips
// Provides PWA install + lock-screen notifications.
// Notifications are fired by the page (Notification API) and the SW handles clicks.

self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

// When a notification is clicked, focus an existing window or open one.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const targetUrl = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url && 'focus' in c) {
        try { if (c.navigate && targetUrl !== '/') await c.navigate(targetUrl); } catch (_) {}
        return c.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
  })());
});

// Web Push events (iOS 16.4+ home-screen PWAs support this when paired with a VAPID server).
// No push server here today, but if the browser delivers a push payload we still surface it.
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) { data = { title: 'RSFS', body: e.data ? e.data.text() : '' }; }
  const title = data.title || 'Real Sports Fake Slips';
  const opts = {
    body: data.body || '',
    tag: data.tag || 'rsfs',
    data: { url: data.url || '/' },
    requireInteraction: false,
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});
