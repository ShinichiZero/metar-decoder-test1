const CACHE_NAME = 'metar-decoder-v2';
const ASSETS = [
  './',
  './app.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Install: cache static assets (not the HTML shell to avoid staleness)
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate: clear old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for navigations (index.html) and for app.js; cache-first for other static assets
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Handle navigations (SPA page loads) network-first
  if (req.mode === 'navigate' || (req.method === 'GET' && req.headers.get('accept') && req.headers.get('accept').includes('text/html'))) {
    event.respondWith(
      fetch(req).then(networkResp => {
        // Update cache for next time
        caches.open(CACHE_NAME).then(cache => cache.put(req, networkResp.clone()));
        return networkResp;
      }).catch(() => caches.match(req).then(cached => cached || caches.match('./')))
    );
    return;
  }

  // For app.js prefer network to avoid running stale scripts
  if (url.pathname.endsWith('/app.js') || url.pathname.endsWith('app.js')) {
    event.respondWith(
      fetch(req).then(networkResp => {
        caches.open(CACHE_NAME).then(cache => cache.put(req, networkResp.clone()));
        return networkResp;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Fallback: try cache, then network
  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req))
  );
});
