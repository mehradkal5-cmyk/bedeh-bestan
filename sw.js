const CACHE = 'bedeh-bestan-v28';
const ASSETS = ['./', './index.html', './styles.css', './backend-gate.css', './ui-cleanup.css', './record-wizard-v2.css', './layout-stability.css', './product-enhancements.css', './app.js', './product-core.js', './record-wizard-v2.js', './backend-client.js', './workflow-client.js', './shared-workflow.js', './creator-inbox.js', './ui-cleanup.js', './product-enhancements.js', './pwa-boot.js', './manifest.webmanifest', './icon.svg', './offline.html'];

self.addEventListener('install', (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })))).then(() => self.skipWaiting())));
self.addEventListener('activate', (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('bedeh-bestan-') && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  // Never intercept Supabase, external assets, signed receipts or other private data.
  if (requestUrl.origin !== self.location.origin) return;
  // Public configuration must be fresh after a deploy. Serving a stale anon key
  // or project URL makes the client look disconnected even when Supabase is up.
  if (requestUrl.pathname === '/runtime-config.js') {
    event.respondWith(fetch(event.request, { cache: 'no-store' }));
    return;
  }
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(async () => (await caches.open(CACHE)).match('/offline.html')));
    return;
  }
  const publicPaths = ASSETS.map((asset) => new URL(asset, self.location.origin).pathname);
  if (!publicPaths.includes(requestUrl.pathname)) return;
  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(event.request);
    if (cached) return cached;
    const response = await fetch(event.request);
    // A missing JS/CSS asset must never poison the cache with an SPA HTML fallback.
    const isCode = /\.(js|css)$/.test(requestUrl.pathname);
    const isHtml = (response.headers.get('content-type') || '').includes('text/html');
    if (response.ok && !(isCode && isHtml)) await cache.put(event.request, response.clone());
    return response;
  }));
});
