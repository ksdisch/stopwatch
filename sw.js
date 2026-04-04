const CACHE_NAME = 'stopwatch-v3';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/utils.js',
  './js/analog.js',
  './js/app.js',
  './js/stopwatch.js',
  './js/ui.js',
  './js/persistence.js',
  './js/offset-input.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
