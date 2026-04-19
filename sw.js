const CACHE_NAME = 'stopwatch-v40';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/utils.js',
  './js/stopwatch.js',
  './js/timer.js',
  './js/instance-manager.js',
  './js/pomodoro.js',
  './js/flow.js',
  './js/persistence.js',
  './js/audio.js',
  './js/themes.js',
  './js/history.js',
  './js/export.js',
  './js/analog.js',
  './js/offset-input.js',
  './js/ui.js',
  './js/cards-ui.js',
  './js/compare-ui.js',
  './js/timer-ui.js',
  './js/pomodoro-ui.js',
  './js/flow-ui.js',
  './js/alert-ui.js',
  './js/history-ui.js',
  './js/interval.js',
  './js/bg-notify.js',
  './js/interval-ui.js',
  './js/cooking-ui.js',
  './js/pomodoro-stats.js',
  './js/dom-utils.js',
  './js/sequence.js',
  './js/analytics.js',
  './js/focus-ui.js',
  './js/sequence-ui.js',
  './js/analytics-ui.js',
  './js/lap-chart.js',
  './js/presets.js',
  './js/presets-ui.js',
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

// ── Background Notification Scheduling ──
const pendingNotifications = new Map();

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || !data.type) return;

  if (data.type === 'scheduleNotification') {
    // Cancel any existing notification with the same ID
    if (pendingNotifications.has(data.id)) {
      clearTimeout(pendingNotifications.get(data.id));
    }
    const timeoutId = setTimeout(() => {
      pendingNotifications.delete(data.id);
      self.registration.showNotification(data.title || 'Timer', {
        body: data.body || 'Time is up!',
        icon: './icons/icon-192.png',
        badge: './icons/icon-192.png',
        vibrate: [200, 100, 200, 100, 200],
        tag: data.id,
        requireInteraction: true,
      });
    }, Math.max(0, data.delayMs));
    pendingNotifications.set(data.id, timeoutId);
  }

  if (data.type === 'cancelNotification') {
    if (pendingNotifications.has(data.id)) {
      clearTimeout(pendingNotifications.get(data.id));
      pendingNotifications.delete(data.id);
    }
  }
});
