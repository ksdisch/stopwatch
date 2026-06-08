// PHASE 1 — the real Home Synthesizer (replaces the Phase-0 dummy smoke).
//
// The council runtime's entry point. launchd fires run-synthesis.sh → node
// boots → firebase-admin authenticates via the service-account key
// (GOOGLE_APPLICATION_CREDENTIALS) → the Admin SDK READS the five domain-pillar
// synthesis records (users/{TEMPO_UID}/synthesis/{pillarId}), rolls them up via
// the pure Home Synthesizer into the `home` Balance record, and WRITES it back
// to users/{TEMPO_UID}/synthesis/home — bypassing firestore.rules (Admin SDK is
// privileged — same mental model as personal-health-elt → recovery_state; see
// docs/reference/recovery-state-contract.md).
//
// Two modes (passed via SYNTH_MODE env or `--mode <daily|weekly>`):
//   - weekly (default): the Sunday-evening recap — carries 1..3 cross-pillar
//     moves (nudges). Producer "council/weekly-recap".
//   - daily: the nightly passive glance — no nudges. Producer
//     "council/nightly-glance".
//
// The roll-up reads only the children's RECORDS, never their raw data
// (docs/contracts/synthesis-record.md). The Balance math + record envelope are
// pure modules under lib/ (testable via node --test); this file is the I/O shell.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import admin from 'firebase-admin';

import { validateSynthesisRecord } from './lib/synthesis-record.mjs';
import { buildHomeRecord } from './lib/home-synthesizer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The five domain-pillar nodeIds the home rolls up (docs/lifeos/pillars.md).
const PILLAR_NODES = [
  'life_building',
  'physicals',
  'chickens',
  'relationships',
  'growth',
];

/**
 * resolveMode() — read SYNTH_MODE from env, allow a `--mode <daily|weekly>`
 * argv override, default to "weekly". Any unrecognized value falls back to
 * "weekly" (the safe, nudge-carrying recap).
 */
function resolveMode() {
  let mode = process.env.SYNTH_MODE || 'weekly';
  const argv = process.argv.slice(2);
  const flagIdx = argv.indexOf('--mode');
  if (flagIdx !== -1 && argv[flagIdx + 1]) {
    mode = argv[flagIdx + 1];
  }
  return mode === 'daily' ? 'daily' : 'weekly';
}

async function main() {
  // TEMPO_UID is required — the Firebase Auth uid whose synthesis subcollection
  // we read from + write to. GOOGLE_APPLICATION_CREDENTIALS is read by
  // applicationDefault() (run-synthesis.sh sources it from council/.env.secrets).
  const uid = process.env.TEMPO_UID;
  if (!uid) {
    console.error('FATAL: TEMPO_UID env var is required (the Firebase Auth uid to write under).');
    process.exit(1);
  }

  const mode = resolveMode();
  const producer = mode === 'daily' ? 'council/nightly-glance' : 'council/weekly-recap';

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
  const db = admin.firestore();

  // Load the Balance config (importance + target per pillar).
  const config = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'config', 'balance.json'), 'utf8'),
  );

  // Read the five pillar records (nodeId == node for single-segment pillars).
  // A missing pillar doc is fine — the home rolls up whatever exists; coverage
  // and confidence reflect the gap.
  //
  // Cross-runtime contract (Phase-2 handoff): this job only WRITES `home`; it
  // never re-stamps the pillars. The additive `balance:{importance,neglect,
  // priority}` that the PWA bubble-map Importance/Neglect lenses read is written
  // by whoever produces the PILLAR records — today seed-pillars.mjs, later the
  // real Area/Hub synthesizers. Those producers MUST stamp `balance` (via
  // lib/balance.mjs) or the device's Importance/Neglect lenses silently go flat.
  const pillarRecords = [];
  for (const node of PILLAR_NODES) {
    const snap = await db.doc(`users/${uid}/synthesis/${node}`).get();
    if (snap.exists) {
      pillarRecords.push(snap.data());
    }
  }
  console.log(`OK: read ${pillarRecords.length}/${PILLAR_NODES.length} pillar records (mode=${mode}).`);

  // Roll the pillars up into the home Balance record. buildHomeRecord validates
  // internally and THROWS on a contract violation — caught by the outer handler.
  const record = buildHomeRecord({ pillarRecords, config, mode, producer });

  // Belt-and-suspenders: validate again before the write (the producer-side
  // contract gate — fail loudly here, never blank a card on the device).
  const { valid, errors } = validateSynthesisRecord(record);
  if (!valid) {
    console.error('FATAL: synthesis record failed contract validation:');
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  // users/{uid}/synthesis/home — nodeId 'home' is the root (no '/' to encode).
  const homePath = `users/${uid}/synthesis/home`;
  await db.doc(homePath).set(record);

  console.log(
    `OK: wrote ${mode} home synthesis record to ${homePath} ` +
      `(band=${record.state.band}, score=${record.state.score}, ` +
      `confidence=${record.confidence}, nudges=${record.nudges.length}).`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('FATAL: council synthesize run threw:', err);
  process.exit(1);
});
