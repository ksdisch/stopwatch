// R9: pull in the durable notification store (pure plan() + tempo_notify_db IDB
// CRUD). Same bytes the page loads via <script>; here the SW uses it to persist
// pending notifications so they survive worker eviction.
importScripts('./js/bg-notify-store.js');

const CACHE_NAME = 'stopwatch-v168-doctor-report';
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
  './js/sync-merge-equal.js',
  './js/sync-merge-meds.js',
  './js/sync-merge-history.js',
  './js/sync-merge-rest-log.js',
  './js/sync-merge-presets.js',
  './js/sync-merge-bfrb.js',
  './js/sync-merge-distractions.js',
  './js/sync-merge-mood.js',
  './js/sync-merge-finances.js',
  './js/sync-auth.js',
  './js/audio.js',
  './js/themes.js',
  './js/history.js',
  './js/export.js',
  './js/backup.js',
  './js/analog.js',
  './js/offset-input.js',
  './js/button-fsm.js',
  './js/ui.js',
  './js/cards-ui.js',
  './js/compare-ui.js',
  './js/timer-ui.js',
  './js/bfrb-recovery.js',
  './js/tempo-coach.js',
  './js/pomodoro-ui.js',
  './js/flow-ui.js',
  './js/alert-ui.js',
  './js/history-ui.js',
  './js/interval.js',
  './js/bg-notify.js',
  './js/bg-notify-store.js',
  './js/interval-ui.js',
  './js/cooking-ui.js',
  './js/pomodoro-stats.js',
  './js/dom-utils.js',
  './js/sequence.js',
  './js/analytics.js',
  './js/doctor-report.js',
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
  './js/synthesis-feed.js',
  './js/finances.js',
  './js/home-ui.js',
  './js/physicals-ui.js',
  './js/chickens-ui.js',
  './js/life-building-ui.js',
  './js/rhythm-engine.js',
  './js/rhythm-insights.js',
  './js/rhythm-panel-today.js',
  './js/rhythm-panel-meds-sleep.js',
  './js/rhythm-panel-recovery-trends.js',
  './js/rhythm-panel-focus-minutes.js',
  './js/rhythm-panel-bfrb-frequency.js',
  './js/rhythm-panel-bfrb-triggers.js',
  './js/rhythm-panel-distraction-rollup.js',
  './js/rhythm-panel-event-zoom.js',
  './js/rhythm-panel-correlations.js',
  './js/rhythm-ui.js',
  './js/bfrb-events.js',
  './js/bfrb-risk.js',
  './js/distractions.js',
  './js/todoist.js',
  './js/todoist-ui.js',
  './js/global-bfrb.js',
  './js/mood.js',
  './js/mood-ui.js',
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
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    );
    await self.clients.claim();
    // R9: a newly-activated worker fires any overdue notifications + re-arms
    // upcoming ones from the durable store.
    await _rearm();
  })());
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
  const req = event.request;

  // Only GET requests are cacheable; let everything else hit the network
  // untouched.
  if (req.method !== 'GET') return;

  const sameOrigin = (() => {
    try { return new URL(req.url).origin === self.location.origin; }
    catch (_) { return false; }
  })();

  // F-pwa: stale-while-revalidate + navigation fallback.
  //
  // Old behavior was pure cache-first (`cached || fetch`): a missed
  // CACHE_NAME bump (a documented footgun) silently served stale code with
  // no way to self-heal. Now we serve the cache immediately AND refresh it in
  // the background, so the *next* load picks up fresh files even if a bump was
  // forgotten. Cross-origin requests (Firebase / gstatic CDN) are never
  // written back to avoid caching opaque/3rd-party responses.
  event.respondWith((async () => {
    // ignoreSearch:true so `?v=N` cache-bust query strings on asset
    // references (see index.html's tempo-shell.css / tempo-nav.js links)
    // still hit the pre-cached entry.
    const cached = await caches.match(req, { ignoreSearch: true });

    const fetchAndUpdate = fetch(req).then((resp) => {
      if (sameOrigin && resp && resp.ok) {
        const copy = resp.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
      }
      return resp;
    }).catch(() => null);

    if (cached) {
      // Serve cache now; keep the SW alive long enough to finish revalidating.
      event.waitUntil(fetchAndUpdate);
      return cached;
    }

    const resp = await fetchAndUpdate;
    if (resp) return resp;

    // Offline + uncached: for a navigation, fall back to the app shell so the
    // user gets Tempo (hash-routed SPA) instead of the browser's error page.
    if (req.mode === 'navigate') {
      const shell = await caches.match('./index.html');
      if (shell) return shell;
    }
    return Response.error();
  })());
});

// ── Background Notification Scheduling (R9: survives SW eviction) ──
//
// The DURABLE source of truth is BgNotifyStore (IndexedDB, imported at the top
// of this file). `pendingTimers` holds only the in-memory setTimeout handles
// for the fast path while the SW stays alive — they die on eviction, but the
// IDB records don't, and `_rearm()` re-creates the timers (and fires any
// overdue) whenever the SW next wakes.
const pendingTimers = new Map();

function _showNotif(rec) {
  return self.registration.showNotification(rec.title || 'Timer', {
    body: rec.body || 'Time is up!',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    vibrate: [200, 100, 200, 100, 200],
    tag: rec.id,
    requireInteraction: true,
  });
}

// Fire now: drop the in-memory timer, delete the durable record FIRST (so a
// concurrent rearm on another wake can't double-fire — and the `tag` coalesces
// any residual duplicate anyway), then show.
function _fire(rec) {
  const t = pendingTimers.get(rec.id);
  if (t) { clearTimeout(t); pendingTimers.delete(rec.id); }
  return Promise.resolve(self.BgNotifyStore.remove(rec.id).catch(() => {}))
    .then(() => _showNotif(rec))
    .catch(() => {}); // a denied/blocked platform must not leave an unhandled rejection
}

// Arm the in-memory fast-path timer for a still-upcoming record.
function _armTimer(rec, delayMs) {
  const existing = pendingTimers.get(rec.id);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => { _fire(rec); }, Math.max(0, delayMs));
  pendingTimers.set(rec.id, t);
}

// Replay the durable store against the wall clock: fire overdue records,
// (re)arm upcoming ones. Runs on every SW wake — activate, top-level spin-up
// after an eviction, and the client's rearmNotifications nudge.
async function _rearm() {
  let records;
  try { records = await self.BgNotifyStore.all(); }
  catch (_) { return; }
  const { fire, arm } = self.BgNotifyStore.plan(records, Date.now());
  for (const rec of fire) { _fire(rec); }
  for (const item of arm) { _armTimer(item.record, item.delayMs); }
}

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || !data.type) return;

  if (data.type === 'scheduleNotification') {
    const rec = {
      id: data.id,
      fireAt: Date.now() + Math.max(0, data.delayMs),
      title: data.title,
      body: data.body,
    };
    // Durable first (survives eviction), then arm the in-memory fast path.
    event.waitUntil(
      self.BgNotifyStore.put(rec)
        .catch(() => {})
        .then(() => { _armTimer(rec, rec.fireAt - Date.now()); })
    );
  }

  if (data.type === 'cancelNotification') {
    const t = pendingTimers.get(data.id);
    if (t) { clearTimeout(t); pendingTimers.delete(data.id); }
    event.waitUntil(self.BgNotifyStore.remove(data.id).catch(() => {}));
  }

  if (data.type === 'rearmNotifications') {
    event.waitUntil(_rearm());
  }
});

// Fire-overdue / re-arm on cold spin-up too: the SW global is re-evaluated
// every time the browser restarts an evicted worker, and neither install nor
// activate re-runs then — this top-level call is the only "on startup" hook.
_rearm();

// M11: handle taps on background notifications. Without this, the
// `requireInteraction: true` alarms above are a no-op when tapped and leave a
// sticky notification on screen. Close the notification, then focus an existing
// Tempo window if one is open, otherwise open a fresh one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if ('focus' in client) return client.focus();
    }
    if (clients.openWindow) return clients.openWindow('./');
  })());
});
