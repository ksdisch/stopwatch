const CACHE_NAME = 'stopwatch-v107-rhythm-timeline-meds';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './css/tempo-shell.css',
  './js/utils.js',
  './js/platform.js',
  './js/schema.js',
  './js/tempo-nav.js',
  './js/stopwatch.js',
  './js/timer.js',
  './js/instance-manager.js',
  './js/pomodoro.js',
  './js/flow.js',
  './js/persistence.js',
  './js/sync-firebase-config.js',
  './js/sync-flag.js',
  './js/sync-firestore.js',
  './js/sync-buffer.js',
  './js/sync-engine.js',
  './js/sync-toast.js',
  './js/sync-manual-dedupe.js',
  './js/sync-merge-meds.js',
  './js/sync-merge-history.js',
  './js/sync-merge-rest-log.js',
  './js/sync-merge-presets.js',
  './js/sync-merge-bfrb.js',
  './js/sync-merge-distractions.js',
  './js/sync-auth.js',
  './js/audio.js',
  './js/themes.js',
  './js/history.js',
  './js/export.js',
  './js/backup.js',
  './js/analog.js',
  './js/offset-input.js',
  './js/ui.js',
  './js/cards-ui.js',
  './js/compare-ui.js',
  './js/timer-ui.js',
  './js/bfrb-recovery.js',
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
  './js/presets.js',
  './js/presets-ui.js',
  './js/meds.js',
  './js/meds-ui.js',
  './js/exercise-ui.js',
  './js/mindful-ui.js',
  './js/wellness-cooking-ui.js',
  './js/recovery-ui.js',
  './js/recovery-feed.js',
  './js/rhythm-engine.js',
  './js/rhythm-insights.js',
  './js/rhythm-panel-meds-sleep.js',
  './js/rhythm-panel-recovery-trends.js',
  './js/rhythm-panel-focus-minutes.js',
  './js/rhythm-panel-bfrb-frequency.js',
  './js/rhythm-panel-distraction-rollup.js',
  './js/rhythm-panel-event-zoom.js',
  './js/rhythm-panel-correlations.js',
  './js/rhythm-ui.js',
  './js/bfrb-events.js',
  './js/distractions.js',
  './js/todoist.js',
  './js/todoist-ui.js',
  './js/global-bfrb.js',
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
  // E-1a: ?nosw=1 referrer-based bypass — test harness pages
  // (tests/index.html?nosw=1) get fresh code on every reload; main app at
  // /index.html unaffected because its referrer never carries the param.
  if (event.request.referrer) {
    try {
      const ref = new URL(event.request.referrer);
      if (ref.searchParams.has('nosw')) {
        event.respondWith(fetch(event.request));
        return;
      }
    } catch (_) {
      // malformed referrer — fall through to the existing cache logic
    }
  }
  event.respondWith(
    // ignoreSearch:true so `?v=N` cache-bust query strings on asset
    // references (see index.html's tempo-shell.css / tempo-nav.js links)
    // still hit the pre-cached entry instead of falling through to the
    // network every time.
    caches.match(event.request, { ignoreSearch: true })
      .then((cached) => cached || fetch(event.request))
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
