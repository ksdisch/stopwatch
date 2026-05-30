// tests/rules/firestore-rules.test.mjs — security-rules unit tests.
//
// WHAT THIS IS:
//   The first NON-browser test suite in the repo. The engine tests run in a
//   browser (tests/index.html, scripts/run-tests.mjs); these run under Node's
//   built-in runner (`node --test`) against the Firebase Firestore EMULATOR,
//   using @firebase/rules-unit-testing to exercise firestore.rules directly.
//
// WHAT IT GUARDS (the two guarantees firestore.rules encodes):
//   1. Per-user isolation — a signed-in user may read/write only their own
//      users/{uid}/** documents (firestore.rules:15-17 catch-all).
//   2. recovery_state is READ-ONLY for clients — the external personal-health-elt
//      Admin-SDK pipeline writes it (bypassing rules); every client write is
//      denied by `allow write: if false` (firestore.rules:11-14). Block ORDER is
//      load-bearing: the recovery_state match is declared BEFORE the catch-all so
//      its narrower write rule governs. See docs/reference/recovery-state-contract.md
//      and docs/runbooks/firestore-rules-publish.md.
//
// HOW TO RUN:
//   npm run test:rules
//   (wraps `firebase emulators:exec --only firestore` around `node --test`; needs
//    Java for the emulator. CI installs it — see .github/workflows/ci.yml
//    `firestore-rules` job. The emulator auto-sets FIRESTORE_EMULATOR_HOST, which
//    initializeTestEnvironment auto-detects.)
//
// The projectId is `demo-tempo`: the `demo-` prefix runs the emulator in offline
// demo mode, so these tests never touch the real `tempo-sync-6f7b2` project.

import { readFileSync } from 'node:fs';
import { before, after, beforeEach, test } from 'node:test';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-tempo',
    firestore: {
      // Load the SAME committed rules file the deploy publishes.
      rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'),
    },
  });
});

after(async () => {
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  // Each test starts from an empty datastore so seeding can't leak across cases.
  await testEnv.clearFirestore();
});

// A Firestore handle for a signed-in user (uid) or an anonymous one (uid omitted).
function clientFor(uid) {
  return uid
    ? testEnv.authenticatedContext(uid).firestore()
    : testEnv.unauthenticatedContext().firestore();
}

// Seed a document the way the Admin SDK / another device would — bypassing rules.
// Used to plant data a client should be able to READ but never WRITE.
async function seedBypassingRules(path, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path), data);
  });
}

// ── Catch-all: a user owns their own users/{uid}/** subtree ──────────────────

test('owner can write and read their own users/{uid} document', async () => {
  const alice = clientFor('alice');
  await assertSucceeds(setDoc(doc(alice, 'users/alice/meds/m1'), { name: 'Vyvanse' }));
  await assertSucceeds(getDoc(doc(alice, 'users/alice/meds/m1')));
});

test('owner can write a nested synced-store document (history sessions)', async () => {
  const alice = clientFor('alice');
  await assertSucceeds(
    setDoc(doc(alice, 'users/alice/history/sessions/s1'), { type: 'flow' })
  );
});

// ── Per-user isolation: no cross-user reads or writes ────────────────────────

test('a user cannot read another user\'s document', async () => {
  await seedBypassingRules('users/bob/meds/m1', { name: 'secret' });
  const alice = clientFor('alice');
  await assertFails(getDoc(doc(alice, 'users/bob/meds/m1')));
});

test('a user cannot write into another user\'s subtree', async () => {
  const alice = clientFor('alice');
  await assertFails(setDoc(doc(alice, 'users/bob/meds/m1'), { name: 'evil' }));
});

// ── Unauthenticated access is denied everywhere ──────────────────────────────

test('an unauthenticated client cannot read or write user data', async () => {
  await seedBypassingRules('users/alice/meds/m1', { name: 'x' });
  const anon = clientFor(); // no uid
  await assertFails(getDoc(doc(anon, 'users/alice/meds/m1')));
  await assertFails(setDoc(doc(anon, 'users/alice/meds/m2'), { name: 'y' }));
});

// ── recovery_state: client-write denial (the read-only feed) ─────────────────

test('owner CANNOT write their own recovery_state feed (allow write: if false)', async () => {
  const alice = clientFor('alice');
  await assertFails(
    setDoc(doc(alice, 'users/alice/recovery_state/latest'), { day: '2026-05-30' })
  );
});

test('owner CAN read their own recovery_state feed (Admin-SDK-seeded)', async () => {
  // Simulate the personal-health-elt pipeline's Admin-SDK push.
  await seedBypassingRules('users/alice/recovery_state/latest', {
    day: '2026-05-30',
    recovery_signal: 'well_recovered',
  });
  const alice = clientFor('alice');
  await assertSucceeds(getDoc(doc(alice, 'users/alice/recovery_state/latest')));
});

test('a user cannot read another user\'s recovery_state feed', async () => {
  await seedBypassingRules('users/alice/recovery_state/history', { rows: [] });
  const bob = clientFor('bob');
  await assertFails(getDoc(doc(bob, 'users/alice/recovery_state/history')));
});
