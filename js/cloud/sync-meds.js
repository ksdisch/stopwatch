// Sync engine for `wellness_meds` (medications + dose log).
//
// Firestore layout:
//   /users/{uid}/meds/{medId}              ← med metadata, LWW
//   /users/{uid}/meds/{medId}/doses/{doseId} ← append-only doses
//
// Why subcollection for doses, not embedded array?
//   Two devices logging "took it now" within the same second would both
//   read-modify-write the parent doc and silently drop one entry.
//   Subcollection appends are conflict-free at the storage layer.
//
// doseId = takenAt.toString(36) — same takenAt across devices = same
// logical dose, the second write is a no-op merge.
//
// Bridges to local state:
//   • Push reads MedsManager.all() and writes each med + its doseLog
//     entries up.
//   • Pull reads remote, then rebuilds the local wellness_meds JSON
//     so MedsManager.loadAll() picks it up on the next access.

(function attachMedsSync() {
  const KEY = 'wellness_meds';
  const SCHEMA_VERSION = 1;

  function db() { return window.Cloud && Cloud.getDb(); }
  function userRoot(uid) {
    const d = db();
    if (!d) return null;
    return d.collection('users').doc(uid);
  }

  function readLocalMeds() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return { meds: [] };
      const state = JSON.parse(raw);
      if (state && Array.isArray(state.meds)) return state;
    } catch (_) {}
    return { meds: [] };
  }

  function writeLocalMeds(state) {
    // Wrapped in withApplyingRemote so the localStorage hook doesn't
    // fire a push back to the cloud right after we just pulled.
    Sync.withApplyingRemote(() => {
      localStorage.setItem(KEY, JSON.stringify(state));
    });
    // Tell MedsManager to reload — it owns the in-memory model.
    if (window.MedsManager && typeof MedsManager.loadAll === 'function') {
      try { MedsManager.loadAll(); } catch (_) {}
    }
    // And nudge the UI to repaint if it's open.
    try {
      document.dispatchEvent(new CustomEvent('cloud:meds-applied'));
    } catch (_) {}
  }

  function buildMedDoc(med) {
    return {
      schemaVersion: SCHEMA_VERSION,
      id: med.id,
      name: med.name || '',
      dose: med.dose || '',
      frequency: med.frequency || 'as-needed',
      lastTakenAtCache: typeof med.lastTakenAt === 'number' ? med.lastTakenAt : null,
      deletedAt: null,
    };
  }

  function buildDoseDoc(dose) {
    return {
      schemaVersion: SCHEMA_VERSION,
      takenAt: dose.takenAt,
      deletedAt: null,
    };
  }

  // ── Push ────────────────────────────────────────────────────────────

  async function push(user, evt) {
    const root = userRoot(user.uid);
    if (!root) return;
    const state = readLocalMeds();
    const fb = window.firebase;
    if (!fb) return;

    // Med-level metadata. Use individual writes (not a batch) so a
    // single failure doesn't roll the whole sync back.
    for (const med of state.meds) {
      if (!med || !med.id) continue;
      const medRef = root.collection('meds').doc(med.id);
      await medRef.set(window.Sync.stampDoc(buildMedDoc(med)), { merge: true });

      // Doses subcollection — write each dose under takenAt.toString(36).
      // Idempotent: writing the same dose key twice is a no-op merge.
      if (Array.isArray(med.doseLog)) {
        for (const dose of med.doseLog) {
          if (!dose || typeof dose.takenAt !== 'number') continue;
          const doseId = Math.round(dose.takenAt).toString(36);
          const doseRef = medRef.collection('doses').doc(doseId);
          await doseRef.set(window.Sync.stampDoc(buildDoseDoc(dose)), { merge: true });
        }
      }
    }
  }

  // ── Pull ────────────────────────────────────────────────────────────

  async function pull(user) {
    const root = userRoot(user.uid);
    if (!root) return;
    const remoteMeds = [];
    const medsSnap = await root.collection('meds').get();
    if (medsSnap.empty && readLocalMeds().meds.length === 0) return;

    // Local snapshot for LWW comparisons.
    const local = readLocalMeds();
    const localById = new Map();
    local.meds.forEach(m => localById.set(m.id, m));

    for (const medDoc of medsSnap.docs) {
      const remote = medDoc.data();
      if (!remote || remote.deletedAt) continue;
      const id = remote.id || medDoc.id;
      const localMed = localById.get(id) || null;
      const localStamp = localMed ? Number(localMed._cloudStamp) || 0 : 0;
      const remoteStamp = Number(remote.clientUpdatedAt) || 0;
      // LWW for med-level metadata.
      const winner = remoteStamp > localStamp ? 'remote' : 'local';

      // Doses: union by takenAt-key. Pull all remote doses (excluding
      // tombstones), merge with local doseLog, dedupe by takenAt-key.
      const remoteDoses = [];
      const dosesSnap = await medDoc.ref.collection('doses').get();
      dosesSnap.forEach(d => {
        const data = d.data();
        if (!data || data.deletedAt) return;
        if (typeof data.takenAt === 'number') remoteDoses.push({ takenAt: data.takenAt });
      });

      const mergedDoseMap = new Map();
      const localDoses = (localMed && Array.isArray(localMed.doseLog)) ? localMed.doseLog : [];
      [...localDoses, ...remoteDoses].forEach(d => {
        if (d && typeof d.takenAt === 'number') {
          const k = Math.round(d.takenAt).toString(36);
          if (!mergedDoseMap.has(k)) mergedDoseMap.set(k, { takenAt: d.takenAt });
        }
      });
      const mergedDoses = Array.from(mergedDoseMap.values()).sort((a, b) => a.takenAt - b.takenAt);
      // Cap matches MedsManager's existing 200 limit.
      while (mergedDoses.length > 200) mergedDoses.shift();
      const lastTakenAt = mergedDoses.length ? mergedDoses[mergedDoses.length - 1].takenAt : null;

      const meta = winner === 'remote'
        ? { name: remote.name, dose: remote.dose, frequency: remote.frequency }
        : { name: localMed && localMed.name, dose: localMed && localMed.dose, frequency: localMed && localMed.frequency };

      remoteMeds.push({
        id,
        name: typeof meta.name === 'string' ? meta.name : (localMed ? localMed.name : 'Medication'),
        dose: typeof meta.dose === 'string' ? meta.dose : (localMed ? localMed.dose : ''),
        frequency: typeof meta.frequency === 'string' ? meta.frequency : (localMed ? localMed.frequency : 'as-needed'),
        lastTakenAt,
        doseLog: mergedDoses,
        _cloudStamp: Math.max(remoteStamp, localStamp),
      });
      localById.delete(id);
    }

    // Local-only meds (created on this device, not yet synced) keep
    // existing — push() will upload them on next change.
    localById.forEach(m => {
      remoteMeds.push(Object.assign({}, m, { _cloudStamp: m._cloudStamp || 0 }));
    });

    writeLocalMeds({ meds: remoteMeds });
  }

  // Domain-specific event helpers — used directly by meds.js if it
  // wants to push a single dose without re-walking all meds.
  async function pushSingleDose(user, medId, dose) {
    const root = userRoot(user.uid);
    if (!root || !medId || !dose || typeof dose.takenAt !== 'number') return;
    const doseId = Math.round(dose.takenAt).toString(36);
    const ref = root.collection('meds').doc(medId).collection('doses').doc(doseId);
    await ref.set(window.Sync.stampDoc(buildDoseDoc(dose)), { merge: true });
  }

  if (!window.Sync) return;
  Sync.register({ key: KEY, push, pull });

  // Side-channel for direct dose writes. notifyLocalChange('wellness_meds')
  // walks all meds; the more granular path is a future optimization.
  window.SyncMeds = { pushSingleDose };
})();
