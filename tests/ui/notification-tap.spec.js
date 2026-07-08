// tests/ui/notification-tap.spec.js — R9: background notifications survive
// service-worker eviction.
//
// The engine suite (tests/bg-notify-store.test.js) proves the pure plan() +
// IDB CRUD. This spec proves the SW WIRING the engine harness can't reach:
// scheduling persists to tempo_notify_db, a due timer fires + cleans up, and —
// the actual R9 fix — an overdue record left behind by a since-evicted worker
// fires when the SW next rearms.
//
// Unlike the rest of the Proving Ground, this file OPTS the service worker back
// IN (the global config blocks it) — real SW behavior is the whole subject.
//
// NOTE — the "fired" signal is IDB record CONSUMPTION, not getNotifications().
// Playwright's bundled Chromium runs old-headless, where the notification
// platform is disabled: Notification.permission stays 'denied' and
// getNotifications() is always empty regardless of grantPermissions(). But the
// SW's _fire() deletes the durable record whenever it runs, and _fire() is the
// ONLY thing that removes a record here — so a record vanishing from
// tempo_notify_db is the deterministic proof the fire path executed (which
// unconditionally invokes showNotification). Real display is out of scope for
// any web test; on device (permission granted) the same path shows the alert.
const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'allow' });

const FIRE_TIMEOUT = { timeout: 8000 };

// Boot the real app with the SW active and controlling a SETTLED document.
// The first load registers sw.js; when it claims, app.js reloads the tab once
// (F-pwa update-to-reload). We wait for control, then do one manual reload so
// the document is SW-controlled from its first byte and no further
// controllerchange (hence no auto-reload) can race our page.evaluate calls.
async function bootWithSW(page, context) {
  await context.grantPermissions(['notifications']);
  await page.goto('/index.html#/home', { waitUntil: 'load' });
  await page.waitForFunction(
    () => !!(navigator.serviceWorker && navigator.serviceWorker.controller)
  );
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(
    () =>
      typeof BgNotify !== 'undefined' &&
      !!(navigator.serviceWorker && navigator.serviceWorker.controller)
  );
}

// Read all persisted notification records straight from the durable store.
// Opens tempo_notify_db@1 creating the store if absent (schema-identical to
// sw.js/bg-notify-store) so read order vs. the SW's own open never matters.
function readNotifyRecords(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open('tempo_notify_db', 1);
        open.onupgradeneeded = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('pending_notifications')) {
            db.createObjectStore('pending_notifications', { keyPath: 'id' });
          }
        };
        open.onsuccess = () => {
          const db = open.result;
          const req = db
            .transaction('pending_notifications', 'readonly')
            .objectStore('pending_notifications')
            .getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => resolve([]);
        };
        open.onerror = () => resolve([]);
        open.onblocked = () => resolve([]);
      })
  );
}

async function readIds(page) {
  return (await readNotifyRecords(page)).map((r) => r.id);
}

// Write an ALREADY-overdue record directly into the durable store, simulating
// "scheduled before the SW was evicted": the in-memory timer is gone, only the
// persisted record remains.
function seedOverdueRecord(page, id, title, body) {
  return page.evaluate(
    (rec) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('tempo_notify_db', 1);
        open.onupgradeneeded = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('pending_notifications')) {
            db.createObjectStore('pending_notifications', { keyPath: 'id' });
          }
        };
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('pending_notifications', 'readwrite');
          tx.objectStore('pending_notifications').put({
            id: rec.id,
            fireAt: Date.now() - 1000,
            title: rec.title,
            body: rec.body,
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        open.onerror = () => reject(open.error);
        open.onblocked = () => reject(new Error('blocked'));
      }),
    { id, title, body }
  );
}

test('scheduling persists {id, fireAt, title, body} to IndexedDB; cancel removes it', async ({ page, context }) => {
  await bootWithSW(page, context);

  // Far-future delay so it never fires during the test — we're testing the
  // DURABLE write, which the old in-memory Map never did.
  await page.evaluate(() => BgNotify.schedule('persist-test', 60000, 'Later', 'Body'));

  await expect.poll(() => readIds(page)).toContain('persist-test');
  const rec = (await readNotifyRecords(page)).find((r) => r.id === 'persist-test');
  expect(typeof rec.fireAt).toBe('number');
  expect(rec.fireAt).toBeGreaterThan(0);
  expect(rec.title).toBe('Later');
  expect(rec.body).toBe('Body');

  await page.evaluate(() => BgNotify.cancel('persist-test'));
  await expect.poll(() => readIds(page)).not.toContain('persist-test');
});

test('a due notification is persisted, then fired + consumed when its timer elapses', async ({ page, context }) => {
  await bootWithSW(page, context);

  // ~1s out so the record is observably persisted BEFORE it fires (persistence
  // is what the old in-memory-only path never did).
  await page.evaluate(() => BgNotify.schedule('fire-test', 1000, 'Ding', 'Time up'));

  await expect.poll(() => readIds(page)).toContain('fire-test');
  // The SW timer fires → _fire() shows the notification AND clears the durable
  // record. Record-consumption is the deterministic proof (see NOTE at top).
  await expect.poll(() => readIds(page), FIRE_TIMEOUT).not.toContain('fire-test');
});

test('an overdue record left by an evicted SW is fired + consumed on rearm (the R9 fix)', async ({ page, context }) => {
  await bootWithSW(page, context);

  // No in-memory timer exists for this id (as after an eviction) — only the
  // persisted record.
  await seedOverdueRecord(page, 'rearm-test', 'Recovered', 'Body');
  expect(await readIds(page)).toContain('rearm-test');

  // The same nudge the client fires when the user returns to the tab.
  await page.evaluate(() => BgNotify.rearm());

  // rearm() → SW _rearm() → plan() marks it overdue → _fire() shows + clears it.
  await expect.poll(() => readIds(page), FIRE_TIMEOUT).not.toContain('rearm-test');
});
