// Platform abstraction for haptics + notifications.
//
// Web build: delegates to navigator.vibrate / Notification / BgNotify (via SW).
// Native build (Capacitor iOS): delegates to @capacitor/haptics +
// @capacitor/local-notifications. Capacitor injects window.Capacitor.Plugins
// into the WebView at native-shell boot, so no import/bundler is needed.
//
// All call sites pass the existing navigator.vibrate-style argument
// (number | number[]) — translation to Capacitor's discrete haptic types
// happens inside Platform.haptic so call sites don't change.

const Platform = (() => {
  const cap = (typeof window !== 'undefined' && window.Capacitor) || null;
  const isNative = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
  const plugins = (cap && cap.Plugins) || {};

  // ── Haptics ──────────────────────────────────────────────────────────────

  // Map a navigator.vibrate-style argument to a Capacitor Haptics call.
  // Patterns observed in the codebase:
  //   single small int (15–40) → light tap (button feedback, phase tick)
  //   single int 50+           → medium tap
  //   [100, 50, 100]           → medium tap (interval threshold)
  //   [200, 100, 200]          → notification.warning (sequence complete)
  //   [200, 100, 200, 100, 200]→ notification.success (alarm)
  //   [30,40,30] / [120,80,120]→ short triplet of light taps (BFRB / recovery)
  function dispatchNativeHaptic(pattern) {
    const Haptics = plugins.Haptics;
    if (!Haptics) return;

    if (typeof pattern === 'number') {
      const style = pattern >= 50 ? 'MEDIUM' : 'LIGHT';
      Haptics.impact({ style }).catch(() => {});
      return;
    }

    if (!Array.isArray(pattern) || pattern.length === 0) return;

    // Single-element array — same as scalar
    if (pattern.length === 1) {
      const ms = pattern[0];
      const style = ms >= 50 ? 'MEDIUM' : 'LIGHT';
      Haptics.impact({ style }).catch(() => {});
      return;
    }

    // 5+ alternating elements → alarm: success notification haptic
    if (pattern.length >= 5) {
      Haptics.notification({ type: 'SUCCESS' }).catch(() => {});
      return;
    }

    // 3-element patterns: peak amplitude tells us alarm vs tick
    if (pattern.length === 3) {
      const peak = Math.max(pattern[0], pattern[2]);
      if (peak >= 200) {
        Haptics.notification({ type: 'WARNING' }).catch(() => {});
        return;
      }
      if (peak >= 100) {
        Haptics.impact({ style: 'MEDIUM' }).catch(() => {});
        return;
      }
      // Short triplet (e.g. BFRB recovery [30,40,30]) — three light taps
      Haptics.impact({ style: 'LIGHT' }).catch(() => {});
      setTimeout(() => Haptics.impact({ style: 'LIGHT' }).catch(() => {}), pattern[0] + pattern[1]);
      return;
    }

    // Fallback for any other shape
    Haptics.impact({ style: 'LIGHT' }).catch(() => {});
  }

  function haptic(pattern) {
    if (isNative) {
      dispatchNativeHaptic(pattern);
      return;
    }
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try { navigator.vibrate(pattern); } catch (_) {}
    }
  }

  // ── Notifications ────────────────────────────────────────────────────────

  // String IDs ('timer', 'pomodoro', 'cooking-3') → stable int IDs for Capacitor.
  function hashStringId(s) {
    let h = 0;
    const str = String(s);
    for (let i = 0; i < str.length; i++) h = ((h << 5) - h) + str.charCodeAt(i) | 0;
    h = Math.abs(h);
    return h || 1; // avoid 0
  }

  // Map of string-id → int-id, so we can cancel by string id later.
  const nativeIdMap = new Map();
  function nativeIdFor(stringId) {
    if (!nativeIdMap.has(stringId)) nativeIdMap.set(stringId, hashStringId(stringId));
    return nativeIdMap.get(stringId);
  }

  function notify(title, opts) {
    opts = opts || {};
    if (isNative) {
      const LN = plugins.LocalNotifications;
      if (!LN) return;
      // Fire ~now (10ms in the future — required by some plugin versions)
      LN.schedule({
        notifications: [{
          id: hashStringId('immediate-' + Date.now() + '-' + Math.random()),
          title: title,
          body: opts.body || '',
          schedule: { at: new Date(Date.now() + 10) },
        }],
      }).catch(() => {});
      return;
    }
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') return;
    try { new Notification(title, opts); } catch (_) {}
  }

  function scheduleNotification(id, delayMs, title, body) {
    if (delayMs <= 0) return;
    if (isNative) {
      const LN = plugins.LocalNotifications;
      if (!LN) return;
      const intId = nativeIdFor(id);
      // Cancel any existing schedule for this id first (replace semantics).
      LN.cancel({ notifications: [{ id: intId }] }).catch(() => {});
      LN.schedule({
        notifications: [{
          id: intId,
          title: title || 'Tempo',
          body: body || 'Time is up!',
          schedule: { at: new Date(Date.now() + delayMs) },
        }],
      }).catch(() => {});
      return;
    }
    // Web path — keep using BgNotify (SW + setTimeout).
    if (typeof BgNotify !== 'undefined' && typeof BgNotify.schedule === 'function') {
      BgNotify.schedule(id, delayMs, title, body);
    }
  }

  function cancelNotification(id) {
    if (isNative) {
      const LN = plugins.LocalNotifications;
      if (!LN) return;
      LN.cancel({ notifications: [{ id: nativeIdFor(id) }] }).catch(() => {});
      return;
    }
    if (typeof BgNotify !== 'undefined' && typeof BgNotify.cancel === 'function') {
      BgNotify.cancel(id);
    }
  }

  function requestNotificationPermission() {
    if (isNative) {
      const LN = plugins.LocalNotifications;
      if (!LN) return Promise.resolve('denied');
      return LN.requestPermissions().then(
        (r) => (r && r.display) || 'denied',
        () => 'denied',
      );
    }
    if (typeof Notification === 'undefined') return Promise.resolve('denied');
    if (Notification.permission === 'granted') return Promise.resolve('granted');
    if (Notification.permission === 'denied') return Promise.resolve('denied');
    try { return Notification.requestPermission(); } catch (_) { return Promise.resolve('denied'); }
  }

  return {
    isNative,
    haptic,
    notify,
    scheduleNotification,
    cancelNotification,
    requestNotificationPermission,
  };
})();
