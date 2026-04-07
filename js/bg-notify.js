const BgNotify = (() => {
  function getRegistration() {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      return navigator.serviceWorker.controller;
    }
    return null;
  }

  function requestPermission() {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  function schedule(id, delayMs, title, body) {
    if (delayMs <= 0) return;
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
