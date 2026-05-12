// B-3 follow-up patch: Backup.exportLocal() Web Share API fall-through.
//
// The patch in js/backup.js distinguishes between two failure modes when
// navigator.share() rejects:
//   - AbortError (user explicitly dismissed the share sheet) -> failure
//     per F12 contract; do NOT fall through to silent download.
//   - Any other error (Chrome desktop NotAllowedError after user-activation
//     expires across awaits; iOS WKWebView quirks; TypeError on unsupported
//     file payloads; etc.) -> Web Share API isn't viable in this context;
//     fall through to the <a download> Path B fallback.
//
// These tests stub navigator.share + canShare and spy on
// document.body.appendChild to verify the right path is taken.
// Per the export.test.js / analytics.test.js stub-per-case pattern, each
// case restores originals in a try/finally.

(function () {
  // --- Stub helpers -------------------------------------------------------

  // Reusable Export stub. Backup.exportLocal() calls Export.buildBackupData()
  // first; if Export isn't defined or returns junk we never reach the
  // share/download paths. Restore the original at the end of each case.
  function withStubbedExport(fn) {
    const original = window.Export;
    window.Export = {
      buildBackupData: async () => ({
        version: 1,
        exportedAt: '2026-05-12T00:00:00.000Z',
        sessions: [],
        settings: {},
      }),
    };
    return Promise.resolve(fn()).finally(() => {
      window.Export = original;
    });
  }

  // Replace navigator.canShare + navigator.share with stubs that record
  // calls. Restore the originals at the end. We use Object.defineProperty
  // because navigator's own properties are read-only in some browsers but
  // assignment-style replacement still works in the test harness;
  // try/finally guarantees restoration even on assertion failure.
  function stubNavigatorShare(shareImpl, canShareImpl) {
    const origCanShare = navigator.canShare;
    const origShare = navigator.share;
    navigator.canShare = canShareImpl || (() => true);
    navigator.share = shareImpl;
    return () => {
      navigator.canShare = origCanShare;
      navigator.share = origShare;
    };
  }

  // Spy that wraps document.body.appendChild and records when an <a>
  // download element is appended. The Path B fallback uses
  // appendChild(a) + a.click() + a.remove() so we can use appendChild
  // as the canonical observation point.
  function spyOnAnchorAppend() {
    const calls = [];
    const original = document.body.appendChild.bind(document.body);
    document.body.appendChild = function (node) {
      // Only flag anchor downloads — body may legitimately append
      // other nodes during the test harness lifecycle.
      if (node && node.tagName === 'A' && node.download) {
        calls.push({ href: node.href, download: node.download });
      }
      return original(node);
    };
    return {
      calls,
      restore: () => { document.body.appendChild = original; },
    };
  }

  // --- Tests --------------------------------------------------------------

  describe('Backup.exportLocal — Web Share API fall-through', () => {

    it('falls through to <a download> when navigator.share throws a non-AbortError', async () => {
      await withStubbedExport(async () => {
        // Simulate the Chrome-desktop NotAllowedError that occurs when
        // user activation expires across the await of buildBackupData().
        const notAllowed = Object.assign(new Error('Permission denied'), {
          name: 'NotAllowedError',
        });
        const restoreShare = stubNavigatorShare(async () => { throw notAllowed; });
        const spy = spyOnAnchorAppend();
        try {
          const result = await Backup.exportLocal();
          assertEqual(result.ok, true,
            'non-AbortError share rejection should still produce ok=true via Path B');
          assertEqual(typeof result.bytesWritten, 'number');
          assert(result.bytesWritten > 0, 'expected non-zero bytesWritten from Path B');
          assertEqual(spy.calls.length >= 1, true,
            'expected document.body.appendChild(<a download>) to be called (Path B reached)');
        } finally {
          spy.restore();
          restoreShare();
        }
      });
    });

    it('returns {ok: false} when navigator.share throws AbortError (user dismissed)', async () => {
      await withStubbedExport(async () => {
        // Simulate the user tapping "Cancel" on the share sheet.
        const aborted = Object.assign(new Error('User dismissed'), {
          name: 'AbortError',
        });
        const restoreShare = stubNavigatorShare(async () => { throw aborted; });
        const spy = spyOnAnchorAppend();
        try {
          const result = await Backup.exportLocal();
          assertEqual(result.ok, false,
            'AbortError must result in ok=false per F12 contract');
          assert(result.error && result.error.name === 'AbortError',
            'expected the AbortError to be surfaced on result.error');
          assertEqual(spy.calls.length, 0,
            'Path B must NOT be reached after AbortError — F12 says user dismissal = failure');
        } finally {
          spy.restore();
          restoreShare();
        }
      });
    });

  });
})();
