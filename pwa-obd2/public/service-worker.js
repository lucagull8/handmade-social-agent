// Service worker minimale: cache degli asset statici per uso offline.
// In dev Vite serve i moduli dinamicamente, quindi la cache è utile
// soprattutto dopo `npm run build`.

const CACHE = 'obd2-diagnosi-v1';
const CORE = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  // Non intercettiamo mai le chiamate a OpenAI o altre API esterne
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Strategia: network-first, fallback cache
  event.respondWith(
    fetch(req).then(resp => {
      const copy = resp.clone();
      caches.open(CACHE).then(cache => cache.put(req, copy)).catch(() => {});
      return resp;
    }).catch(() => caches.match(req).then(r => r || caches.match('/index.html')))
  );
});
