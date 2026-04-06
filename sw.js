const CACHE_NAME = 'stopwatch-v13';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/utils.js',
  './js/stopwatch.js',
  './js/timer.js',
  './js/instance-manager.js',
  './js/pomodoro.js',
  './js/persistence.js',
  './js/audio.js',
  './js/themes.js',
  './js/history.js',
  './js/export.js',
  './js/analog.js',
  './js/offset-input.js',
  './js/ui.js',
  './js/cards-ui.js',
  './js/timer-ui.js',
  './js/pomodoro-ui.js',
  './js/alert-ui.js',
  './js/history-ui.js',
  './js/app.js',
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
