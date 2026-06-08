// Background notification scheduler.
//
// Web: posts a message to the service worker which fires
// self.registration.showNotification() after a setTimeout.
//
// Native (Capacitor iOS): delegates to Platform.scheduleNotification, which
// calls @capacitor/local-notifications under the hood. Native notifications
// fire at the OS level even when the WebView is suspended — that's the whole
// reason for the Capacitor wrapper.
//
// Existing call sites (app.js, cooking-ui.js, etc.) keep using BgNotify.*
// unchanged.

const BgNotify = (() => {
  function isNative() {
    return typeof Platform !== 'undefined' && Platform.isNative;
  }

  // Post a message to the active service worker. Prefers the live controller
  // (fast path) but falls back to navigator.serviceWorker.ready — F-pwa: on
  // the very first page load the SW hasn't claimed the page yet, so
  // `controller` is null and a timer started before any reload would schedule
  // NOTHING. `ready` resolves to the registration whose `.active` worker can
  // receive the message even pre-claim.
  function postToSW(message) {
    if (!('serviceWorker' in navigator)) return;
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage(message);
      return;
    }
    navigator.serviceWorker.ready
      .then((reg) => {
        const target = (reg && reg.active) || navigator.serviceWorker.controller;
        if (target) target.postMessage(message);
      })
      .catch(() => {});
  }

  function requestPermission() {
    if (typeof Platform !== 'undefined' && typeof Platform.requestNotificationPermission === 'function') {
      Platform.requestNotificationPermission();
      return;
    }
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  function schedule(id, delayMs, title, body) {
    if (delayMs <= 0) return;
    if (isNative()) {
      Platform.scheduleNotification(id, delayMs, title, body);
      return;
    }
    requestPermission();
    postToSW({
      type: 'scheduleNotification',
      id: id,
      delayMs: delayMs,
      title: title,
      body: body,
    });
  }

  function cancel(id) {
    if (isNative()) {
      Platform.cancelNotification(id);
      return;
    }
    postToSW({
      type: 'cancelNotification',
      id: id,
    });
  }

  return { schedule, cancel, requestPermission };
})();
