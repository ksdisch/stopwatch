// PHASE 0 SMOKE — Phase 1 replaces the dummy body with the real Home
// Synthesizer reading pillar records.
//
// The council runtime's entry point. Phase 0 proves the full chain end to end:
// launchd fires run-synthesis.sh → node boots → firebase-admin authenticates
// via the service-account key (GOOGLE_APPLICATION_CREDENTIALS) → the Admin SDK
// writes a DUMMY 'home' synthesis record to users/{TEMPO_UID}/synthesis/home,
// bypassing firestore.rules (Admin SDK is privileged — same mental model as
// the personal-health-elt → recovery_state pipeline; see
// docs/reference/recovery-state-contract.md).
//
// In Phase 1 the dummy body below is swapped for the real Home Synthesizer that
// reads the per-pillar synthesis records and rolls them up into 'home'. The
// build/validate/write scaffolding stays.

import admin from 'firebase-admin';

import {
  buildSynthesisRecord,
  validateSynthesisRecord,
} from './lib/synthesis-record.mjs';

async function main() {
  // TEMPO_UID is required — it is the Firebase Auth uid whose synthesis
  // subcollection we write to. GOOGLE_APPLICATION_CREDENTIALS is read by
  // firebase-admin's applicationDefault() and points at the service-account
  // key file (run-synthesis.sh sources it from council/.env.secrets).
  const uid = process.env.TEMPO_UID;
  if (!uid) {
    console.error('FATAL: TEMPO_UID env var is required (the Firebase Auth uid to write under).');
    process.exit(1);
  }

  // applicationDefault() reads GOOGLE_APPLICATION_CREDENTIALS. firebase-admin
  // throws a clear error here if the var is unset or the key file is missing.
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });

  // Today's ISO date (UTC) — the window for this single-shot smoke record.
  const today = new Date().toISOString().slice(0, 10);

  // Build the clearly-DUMMY 'home' record. Everything here is synthetic; the
  // producer string and the provenance source make that unmistakable.
  const record = buildSynthesisRecord({
    node: 'home',
    producer: 'council/phase0-smoke',
    window: today,
    state: { band: 'steady', score: 72 },
    headline: 'Phase 0 smoke — local council reached Firestore.',
    signals: ['launchd fired', 'admin SDK authenticated', 'write path verified'],
    nudges: [],
    provenance: { sources: ['none — synthetic'], coverage: 1 },
    confidence: 'low',
  });

  const { valid, errors } = validateSynthesisRecord(record);
  if (!valid) {
    console.error('FATAL: synthesis record failed contract validation:');
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  // users/{uid}/synthesis/home — nodeId 'home' is the root (no '/' to encode).
  const path = `users/${uid}/synthesis/home`;
  await admin.firestore().doc(path).set(record);

  console.log(`OK: wrote Phase 0 smoke synthesis record to ${path}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('FATAL: council synthesize run threw:', err);
  process.exit(1);
});
