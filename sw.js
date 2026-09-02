const CACHE = 'bedeh-bestan-v27';
const ASSETS = ['./', './index.html', './styles.css', './backend-gate.css', './ui-cleanup.css', './record-wizard-v2.css', './layout-stability.css', './product-enhancements.css', './app.js', './product-core.js', './record-wizard-v2.js', './backend-client.js', './workflow-client.js', './shared-workflow.js', './creator-inbox.js', './ui-cleanup.js', './product-enhancements.js', './pwa-boot.js', './manifest.webmanifest', './icon.svg', './offline.html'];

self.addEventListener('install', (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  // Public configuration must be fresh after a deploy. Serving a stale anon key
  // or project URL makes the client look disconnected even when Supabase is up.
  if (requestUrl.origin === self.location.origin && requestUrl.pathname.endsWith('/runtime-config.js')) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }));
    return;
  }
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then((response) => { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put('./index.html', copy)); return response; }).catch(() => caches.match('./offline.html')));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => { if (new URL(event.request.url).origin === self.location.origin) { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(event.request, copy)); } return response; })));
});
