// B-3: Backup module — mandatory local export gate before any cloud
// write (F12).
//
// Public API:
//   Backup.exportLocal()           : Promise<{ ok, bytesWritten?, error? }>
//   Backup.importLocal(jsonString) : Promise<{ sessionsImported, settingsRestored }>
//                                    — D-1 hook, ships dormant in B-3.
//
// Scope discipline:
//   - REUSES Export.buildBackupData() — does NOT re-implement the
//     export-key list. The single source of truth for "what's in the
//     backup" lives in js/export.js (EXPORT_SETTINGS_KEYS).
//   - exportLocal() creates a transient <a download> element on the
//     fallback path. This mirrors how js/export.js handles downloads
//     (Export.exportAllData line ~125–134); it's the minimum DOM
//     touch the platform requires and is acceptable here per the
//     audit's seam contract.
//   - No Firebase / Firestore touch. This module is purely the
//     "write the file locally before we touch the cloud" guarantee.
//
// F12 contract:
//   "Local backup is mandatory before any cloud byte moves." The
//   uploader (SyncEngine.pushSnapshot) calls Backup.exportLocal()
//   FIRST and aborts the push if exportLocal returns { ok: false }.
//   The browser API ceiling means we can't *prove* the user saved
//   the file (the user can cancel the share sheet, dismiss the
//   download, etc.); the contract is "we offered it; from here the
//   user is responsible." A throw during the offer counts as failure.

const Backup = (() => {

  // Filename matching js/export.js, but with a timestamp for uniqueness
  // when the user pushes multiple times in one day (e.g. retry path).
  function _filename() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp =
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
      `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    return `tempo-backup-${stamp}.json`;
  }

  async function exportLocal() {
    // Hard dependency on js/export.js. If it's missing (test harness
    // not loading it), surface a clean failure shape so the uploader's
    // F12 check fails predictably instead of throwing a TypeError.
    if (typeof Export === 'undefined' || typeof Export.buildBackupData !== 'function') {
      return { ok: false, error: new Error('Export.buildBackupData unavailable') };
    }

    let payload;
    try {
      payload = await Export.buildBackupData();
    } catch (err) {
      return { ok: false, error: err };
    }

    let blob;
    let json;
    try {
      json = JSON.stringify(payload, null, 2);
      blob = new Blob([json], { type: 'application/json' });
    } catch (err) {
      return { ok: false, error: err };
    }

    const filename = _filename();

    // ── Path A: Web Share API with files (iOS Safari, Android Chrome) ─
    //
    // Preferred on mobile because it opens a native share sheet so the
    // user can route the file to Files, Mail, AirDrop, etc. The user
    // can cancel, which we accept as failure — F12 requires the user
    // to confirm. `navigator.canShare({ files: [...] })` returns false
    // on browsers without file-share support so we cleanly fall
    // through to Path B.
    try {
      if (
        typeof navigator !== 'undefined' &&
        typeof navigator.canShare === 'function' &&
        typeof navigator.share === 'function' &&
        typeof File !== 'undefined'
      ) {
        const file = new File([blob], filename, { type: 'application/json' });
        if (navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: 'Tempo backup' });
            return { ok: true, bytesWritten: blob.size };
          } catch (err) {
            // AbortError = user explicitly dismissed the share sheet.
            // Per the F12 contract, an offer the user dismissed counts
            // as failure — do NOT fall through to a silent download.
            if (err && err.name === 'AbortError') {
              return { ok: false, error: err };
            }
            // Any other error means Web Share API isn't viable in this
            // context (Chrome desktop NotAllowedError when user
            // activation expires across awaits; iOS WKWebView quirks;
            // TypeError on unsupported file payloads; etc.). Fall
            // through to the <a download> Path B below by NOT
            // returning here.
          }
        }
      }
    } catch (err) {
      // canShare itself threw — fall through to <a download> below.
    }

    // ── Path B: <a download> fallback (desktop, older browsers, iOS
    //               Capacitor WebView) ───────────────────────────────────
    //
    // Best-effort path. The browser can't tell us whether the user
    // actually saved the file; we treat creation-of-the-click as
    // success. iOS WKWebView is known to quirk here (see B-3 Risk
    // #12 in the audit) — a follow-up PR may add the Capacitor
    // Filesystem plugin if real-device testing surfaces issues.
    try {
      if (typeof document === 'undefined' || typeof URL === 'undefined') {
        return { ok: false, error: new Error('Document / URL unavailable for download fallback') };
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      // appendChild + click is the cross-browser safe path. Some
      // browsers ignore click() on detached anchors.
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Delay revoke so the browser has time to start the download.
      setTimeout(() => {
        try { URL.revokeObjectURL(url); } catch (_) {}
      }, 2000);
      return { ok: true, bytesWritten: blob.size };
    } catch (err) {
      return { ok: false, error: err };
    }
  }

  // D-1 hook. Shipped dormant in B-3 so the seam exists for the
  // Stage D reconciliation PR. The actual import logic will reuse
  // Export.importAllData (which already handles sessions + settings
  // restoration) plus a F17 imported-bucket migration step that D-1
  // will add.
  async function importLocal(/* jsonString */) {
    throw new Error('Backup.importLocal is a D-1 hook — not yet implemented');
  }

  return { exportLocal, importLocal };
})();

if (typeof window !== 'undefined') {
  window.Backup = Backup;
}
