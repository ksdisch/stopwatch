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
import { buildPhysicalsRecord } from './lib/physicals-synthesizer.mjs';
import { buildChickensRecord } from './lib/chickens-synthesizer.mjs';
import { buildLifeBuildingRecord } from './lib/life-building-synthesizer.mjs';

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

/**
 * synthesizePhysicals({ db, uid, mode }) — Phase 2: the first REAL pillar
 * producer. Reads the live recovery_state mart (latest + history) plus Tempo's
 * synced wellness stores (meds / rest_log / history) via the Admin SDK (reads
 * bypass firestore.rules), rolls them into a normalized physicals synthesis
 * record (4 Areas + composite + the additive `balance{}` stamp the PWA lenses
 * read), validates, and WRITES users/{uid}/synthesis/physicals.
 *
 * Called BEFORE the pillar-read loop so the home roll-up reads the fresh record.
 * Replaces the Phase-1 seed (seed-pillars.mjs no longer seeds physicals). The
 * scoring math is the pure lib/physicals-synthesizer.mjs (testable, no I/O).
 */
async function synthesizePhysicals({ db, uid, mode }) {
  const scoring = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'config', 'physicals.json'), 'utf8'),
  );
  const balanceConfig = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'config', 'balance.json'), 'utf8'),
  );

  // recovery_state mart: two fixed docs (latest + history) — see
  // docs/reference/recovery-state-contract.md.
  const [latestSnap, historySnap] = await Promise.all([
    db.doc(`users/${uid}/recovery_state/latest`).get(),
    db.doc(`users/${uid}/recovery_state/history`).get(),
  ]);
  const recoveryLatest = latestSnap.exists ? latestSnap.data() : null;
  const recoveryHistory = historySnap.exists ? historySnap.data() : null;

  // Tempo's synced wellness stores: collections of per-record docs at
  // users/{uid}/{store}/{docId}. rest_log doc id IS the YYYY-MM-DD date key.
  const [medsSnap, restSnap, histSnap] = await Promise.all([
    db.collection(`users/${uid}/meds`).get(),
    db.collection(`users/${uid}/rest_log`).get(),
    db.collection(`users/${uid}/history`).get(),
  ]);
  const meds = medsSnap.docs.map((d) => d.data());
  const restLog = restSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const history = histSnap.docs.map((d) => d.data());

  const producer = mode === 'daily' ? 'council/physicals-daily' : 'council/physicals-weekly';

  // buildPhysicalsRecord validates + throws on a contract violation internally.
  const record = buildPhysicalsRecord({
    recoveryLatest,
    recoveryHistory,
    meds,
    restLog,
    history,
    scoring,
    balanceConfig: balanceConfig.physicals || {},
    mode,
    producer,
  });

  const physPath = `users/${uid}/synthesis/physicals`;
  await db.doc(physPath).set(record);
  console.log(
    `OK: wrote ${mode} physicals synthesis record to ${physPath} ` +
      `(band=${record.state.band}, score=${record.state.score}, ` +
      `coverage=${record.provenance.coverage.toFixed(2)}, areas=${record.areas.length}).`,
  );
}

/**
 * synthesizeChickens({ db, uid, mode }) — Phase 3: the second REAL pillar
 * producer. Reads Tempo's synced stores (mood_events / bfrb_events / history /
 * rest_log) via the Admin SDK PLUS the `physicals` synthesis RECORD (the
 * borrowed Stress Load Area — the contract's recursion rule: read the sibling's
 * record, never its raw stores), folds in the thin Tier-3 weekly reflection
 * file when present, rolls them into a normalized chickens synthesis record
 * (5 Areas + composite + the additive `balance{}` stamp the PWA lenses read),
 * validates, and WRITES users/{uid}/synthesis/chickens.
 *
 * Called AFTER synthesizePhysicals and BEFORE the pillar-read loop so the home
 * roll-up reads the fresh record. Replaces the Phase-1 seed (seed-pillars.mjs
 * no longer seeds chickens). The scoring math is the pure
 * lib/chickens-synthesizer.mjs (testable, no I/O).
 */
async function synthesizeChickens({ db, uid, mode }) {
  const scoring = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'config', 'chickens.json'), 'utf8'),
  );
  const balanceConfig = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'config', 'balance.json'), 'utf8'),
  );

  // Tempo's synced stores (collections of per-record docs) + the physicals
  // RECORD read back from Firestore (decoupled from synthesizePhysicals's
  // in-process result on purpose). NOTE: if physicals threw this run, this
  // read returns the PRIOR (stale) physicals record — acceptable: a stale
  // Stress Load read degrades gracefully rather than nulling the Area.
  const [moodSnap, bfrbSnap, histSnap, restSnap, physSnap] = await Promise.all([
    db.collection(`users/${uid}/mood_events`).get(),
    db.collection(`users/${uid}/bfrb_events`).get(),
    db.collection(`users/${uid}/history`).get(),
    db.collection(`users/${uid}/rest_log`).get(),
    db.doc(`users/${uid}/synthesis/physicals`).get(),
  ]);
  const moodEvents = moodSnap.docs.map((d) => d.data());
  const bfrbEvents = bfrbSnap.docs.map((d) => d.data());
  const history = histSnap.docs.map((d) => d.data());
  const restLog = restSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const physicalsRecord = physSnap.exists ? physSnap.data() : null;

  // Thin Tier-3 reflection ({weekKey: {rating, note}}) — a local gitignored
  // file written during the Monday ritual. Missing/malformed is fine: it only
  // ever folds into confidence/headline, never a scored Area.
  let reflection = null;
  try {
    reflection = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'data', 'reflections', 'chickens.json'), 'utf8'),
    );
  } catch {
    reflection = null;
  }

  const producer = mode === 'daily' ? 'council/chickens-daily' : 'council/chickens-weekly';

  // buildChickensRecord validates + throws on a contract violation internally.
  const record = buildChickensRecord({
    moodEvents,
    bfrbEvents,
    history,
    restLog,
    physicalsRecord,
    reflection,
    scoring,
    balanceConfig: balanceConfig.chickens || {},
    mode,
    producer,
  });

  const chickensPath = `users/${uid}/synthesis/chickens`;
  await db.doc(chickensPath).set(record);
  console.log(
    `OK: wrote ${mode} chickens synthesis record to ${chickensPath} ` +
      `(band=${record.state.band}, score=${record.state.score}, ` +
      `coverage=${record.provenance.coverage.toFixed(2)}, areas=${record.areas.length}).`,
  );
}

/**
 * synthesizeLifeBuilding({ db, uid, mode }) — Phase 5 slice 1: the Life
 * Building pillar producer. Reads Tempo's synced 'finances' store (monthly
 * snapshots at users/{uid}/finances/{month}) via the Admin SDK (reads bypass
 * firestore.rules), rolls them into a normalized life_building synthesis record
 * (Finances Area + composite + the additive `balance{}` stamp the PWA lenses
 * read), validates, and WRITES users/{uid}/synthesis/life_building.
 *
 * Called AFTER chickens and BEFORE the pillar-read loop so the home roll-up
 * reads the fresh record. Replaces the Phase-1 seed (seed-pillars.mjs no
 * longer seeds life_building). The scoring math is the pure
 * lib/life-building-synthesizer.mjs (testable, no I/O).
 */
async function synthesizeLifeBuilding({ db, uid, mode }) {
  const scoring = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'config', 'life-building.json'), 'utf8'),
  );
  const balanceConfig = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'config', 'balance.json'), 'utf8'),
  );

  // Tempo's synced 'finances' store: collection of per-month docs at
  // users/{uid}/finances/{month}. Doc id IS the YYYY-MM month key.
  const finSnap = await db.collection(`users/${uid}/finances`).get();
  const financesDocs = finSnap.docs.map((d) => ({ month: d.id, ...d.data() }));

  const producer = mode === 'daily' ? 'council/life-building-daily' : 'council/life-building-weekly';

  // buildLifeBuildingRecord validates + throws on a contract violation internally.
  const record = buildLifeBuildingRecord({
    financesDocs,
    config: scoring,
    balanceConfig: balanceConfig.life_building || {},
    mode,
    producer,
    now: Date.now(),
  });

  const lbPath = `users/${uid}/synthesis/life_building`;
  await db.doc(lbPath).set(record);
  console.log(
    `OK: wrote ${mode} life_building synthesis record to ${lbPath} ` +
      `(band=${record.state.band}, score=${record.state.score}, ` +
      `coverage=${record.provenance.coverage.toFixed(2)}, areas=${record.areas.length}).`,
  );
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

  // Phase 2: synthesize the REAL physicals pillar from the published mart +
  // Tempo's synced stores and WRITE it BEFORE the pillar-read loop, so the home
  // roll-up below reads the fresh record (not the retired seed).
  //
  // Phase 3: a physicals failure is logged but NON-FATAL — chickens (which
  // borrows the physicals RECORD for its Stress Load Area) then reads the
  // PRIOR record from Firestore, which degrades gracefully (stale, not blank),
  // and the home roll-up still runs.
  try {
    await synthesizePhysicals({ db, uid, mode });
  } catch (err) {
    console.error('ERROR: physicals synthesis failed (chickens/home continue on the prior record):', err);
  }

  // Phase 3: synthesize the REAL chickens pillar (mood / mindfulness / BFRB /
  // focus + the borrowed physicals stress read) AFTER physicals and BEFORE the
  // pillar-read loop, so the home roll-up reads the fresh record. Same
  // NON-FATAL posture as physicals: a chickens failure (contract-validation
  // throw, Firestore error) must not blank the entire home refresh — the
  // roll-up reads the prior chickens record from Firestore instead.
  try {
    await synthesizeChickens({ db, uid, mode });
  } catch (err) {
    console.error('ERROR: chickens synthesis failed (home continues on the prior record):', err);
  }

  // Phase 5 slice 1: synthesize the REAL life_building pillar from Tempo's
  // synced 'finances' store. Placed AFTER chickens and BEFORE the pillar-read
  // loop so the home roll-up reads the fresh record. Same NON-FATAL posture as
  // physicals/chickens: a life_building failure logs + continues on the prior
  // Firestore record, so the home refresh never blanks.
  try {
    await synthesizeLifeBuilding({ db, uid, mode });
  } catch (err) {
    console.error('ERROR: life_building synthesis failed (home continues on the prior record):', err);
  }

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
