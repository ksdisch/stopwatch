// PHASE 1 SEED — writes CLEARLY-SEED pillar synthesis records so the home
// synthesizer (synthesize.mjs) and the PWA bubble map have non-trivial data to
// roll up before the real Area/Hub synthesizers exist.
//
// Mirrors synthesize.mjs's boot: require TEMPO_UID, applicationDefault()
// credential (GOOGLE_APPLICATION_CREDENTIALS → the service-account key), Admin
// SDK writes bypass firestore.rules. Writes to users/{uid}/synthesis/{pillarId}
// for the still-mock domain-pillars (life_building / chickens / relationships /
// growth — see docs/lifeos/pillars.md).
//
// PHASE 2: `physicals` is NO LONGER seeded here — it has a real producer
// (synthesize.mjs → lib/physicals-synthesizer.mjs reading the recovery_state
// mart + Tempo's synced stores). The remaining four are seeded until their own
// phases land real synthesizers.
//
// Each record is a VALID synthesis record (validated before write) and is
// clearly synthetic: producer "council/seed", provenance.sources ["seed"]. On
// top of the frozen contract each record carries an ADDITIVE `balance`
// snapshot ({ importance, neglect, priority }) computed via balance.mjs +
// balance.json — additive-only, contract-safe (additionalProperties: true) —
// so the PWA bubble lenses (Importance / Neglect / Priority) read it directly
// instead of duplicating the Balance engine on the client.
//
// Idempotent: set() by nodeId overwrites in place. Run ONCE at the Phase-1 gate
// (it writes to production Firestore and needs the credential the integrator
// supplies). Do NOT run this from CI / tests.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import admin from 'firebase-admin';

import {
  buildSynthesisRecord,
  validateSynthesisRecord,
} from './lib/synthesis-record.mjs';
import { neglect, priority, bandForScore } from './lib/balance.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load the Balance config (importance + target per pillar).
const balanceConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'config', 'balance.json'), 'utf8'),
);

// The five seed pillar records. score → band derived; each carries its own
// short headline + 1..3 signals + a single short move (own nudge).
const SEED_PILLARS = [
  {
    node: 'chickens',
    score: 68,
    headline: 'SEED — Chickens steady: focus holding, stress contained.',
    signals: ['Flow blocks on track', 'BFRB events low', 'Mood capture thin'],
    nudges: [{ text: 'Add a 5-min mindful reset before deep work', priority: 1 }],
  },
  {
    node: 'life_building',
    score: 52,
    headline: 'SEED — Life Building strained: admin backlog growing.',
    signals: ['Overdue admin tasks up', 'Habit adherence slipping', 'Finance check overdue'],
    nudges: [{ text: 'Clear the 3 oldest overdue admin tasks', priority: 1 }],
  },
  {
    node: 'relationships',
    score: 34,
    headline: 'SEED — Relationships depleted: contact cadence slipping.',
    signals: ['No date night in 2 weeks', 'Two close friends drifting', 'Low logged connection time'],
    nudges: [{ text: 'Plan a date night with Marlee this week', priority: 1 }],
  },
  {
    node: 'growth',
    score: 73,
    headline: 'SEED — Growth steady: review queue healthy, learning retained.',
    signals: ['Review queue clear', 'Mastery trend up', 'Reading log thin'],
    nudges: [{ text: 'Schedule one focused study block', priority: 1 }],
  },
];

async function main() {
  const uid = process.env.TEMPO_UID;
  if (!uid) {
    console.error('FATAL: TEMPO_UID env var is required (the Firebase Auth uid to write under).');
    process.exit(1);
  }

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });

  // Today's ISO date (UTC) — the window for each seed record (same derivation
  // synthesize.mjs uses).
  const today = new Date().toISOString().slice(0, 10);

  const db = admin.firestore();

  for (const seed of SEED_PILLARS) {
    const cfg = balanceConfig[seed.node] || {};
    const importance = typeof cfg.importance === 'number' ? cfg.importance : 3;
    const target = typeof cfg.target === 'number' ? cfg.target : 70;

    // Snapshot neglect (no prior history in Phase 1) + priority via the engine.
    const neglectValue = neglect({ score: seed.score, target, priorNeglect: 0 });
    const priorityValue = priority(importance, neglectValue);

    const record = buildSynthesisRecord({
      node: seed.node,
      producer: 'council/seed',
      window: today,
      state: { band: bandForScore(seed.score), score: seed.score },
      headline: seed.headline,
      signals: seed.signals,
      nudges: seed.nudges,
      provenance: { sources: ['seed'], coverage: 1 },
      confidence: 'medium',
      // ADDITIVE balance snapshot (contract allows additionalProperties: true)
      // so the PWA bubble lenses read importance/neglect/priority directly.
      balance: {
        importance,
        neglect: neglectValue,
        priority: priorityValue,
      },
    });

    const { valid, errors } = validateSynthesisRecord(record);
    if (!valid) {
      console.error(`FATAL: seed record for ${seed.node} failed contract validation:`);
      for (const err of errors) console.error(`  - ${err}`);
      process.exit(1);
    }

    // nodeId for a single-segment pillar is the node itself (no '/' to encode).
    const docPath = `users/${uid}/synthesis/${seed.node}`;
    await db.doc(docPath).set(record); // idempotent overwrite by nodeId.
    console.log(`OK: wrote seed pillar record to ${docPath}`);
  }

  console.log(`OK: seeded ${SEED_PILLARS.length} pillar records under users/${uid}/synthesis/.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('FATAL: council seed-pillars run threw:', err);
  process.exit(1);
});
