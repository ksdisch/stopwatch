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

  function getRegistration() {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      return navigator.serviceWorker.controller;
    }
    return null;
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
    const sw = getRegistration();
    if (sw) {
      sw.postMessage({
        type: 'scheduleNotification',
        id: id,
        delayMs: delayMs,
        title: title,
        body: body,
      });
    }
  }

  function cancel(id) {
    if (isNative()) {
      Platform.cancelNotification(id);
      return;
    }
    const sw = getRegistration();
    if (sw) {
      sw.postMessage({
        type: 'cancelNotification',
        id: id,
      });
    }
  }

  return { schedule, cancel, requestPermission };
})();
