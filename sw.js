// Service worker for Real Sports Fake Slips
// Provides PWA install + lock-screen notifications.
// Notifications are fired by the page (Notification API) and the SW handles clicks.

self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

// When a notification is clicked, focus an existing window or open one.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if (c.url && 'focus' in c) return c.focus(); }
    if (self.clients.openWindow) return self.clients.openWindow('/');
  })());
});
