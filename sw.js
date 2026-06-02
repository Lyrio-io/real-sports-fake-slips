// Service worker for Real Sports Fake Slips
// Provides PWA install, lock-screen notifications, and network-first delivery
// of index.html so new deploys reach the user without manual cache-busting.

const RUNTIME = 'rsfs-runtime-v1';

self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // Drop any stale runtime caches from older versions
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== RUNTIME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Network-first for HTML so the latest deploy always wins. Fall back to cache
// only if the network truly fails (offline / Cloudflare hiccup).
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Same-origin navigation / index.html only — let everything else (Tailwind CDN, ESPN, Odds API) pass through untouched.
  if (url.origin !== self.location.origin) return;
  const isHtml = req.mode === 'navigate' || req.destination === 'document' || url.pathname === '/' || url.pathname.endsWith('.html');
  if (!isHtml) return;
  e.respondWith((async () => {
    try {
      const fresh = await fetch(req, { cache: 'no-store' });
      const cache = await caches.open(RUNTIME);
      cache.put(req, fresh.clone());
      return fresh;
    } catch (err) {
      const cache = await caches.open(RUNTIME);
      const cached = await cache.match(req);
      if (cached) return cached;
      throw err;
    }
  })());
});

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
