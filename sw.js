// Offline support: the app shell is cached on install and served cache-first.
// Bump VERSION whenever a cached file changes so phones pick up the update.
const VERSION = 'v1';
const CACHE = `habit-tracker-${VERSION}`;
const SHELL = [
  './',
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/lib.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('habit-tracker-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(request).catch(() => (request.mode === 'navigate' ? caches.match('index.html') : Response.error()));
    }),
  );
});
