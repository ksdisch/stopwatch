# Firebase setup guide (PR S0-1)

**Purpose:** Step-by-step checklist for creating the Tempo Firebase project in the console, registering the iOS + web apps, deploying initial security rules, and setting a low-cost trip-wire budget alert. Walk through this once on your primary machine between commit 1 (this PR's audit + setup doc) and commit 2 (the code commit that consumes the values you generate here).

---

## Status / posture summary (read this first)

- **Audience:** you, on your own device, with a browser open to https://console.firebase.google.com.
- **Use case:** single-user personal use. You, two devices, your own medication tracking.
- **HIPAA / BAA gap (accepted tradeoff):** Firestore on the Spark (free) plan **cannot** self-serve a Business Associate Agreement. This caps Tempo's public-launch story — see [HIPAA / BAA posture](#hipaa--baa-posture) below. For your personal use today, this is fine.
- **Region permanence:** Firestore's database region is **chosen once and cannot be changed**. You will pick `us-central1` at step 1, before clicking "Create project."
- **Tempo bundle ID:** `com.ksdisch.tempo` (already in `capacitor.config.json`). Step 4 below must use this exact string.
- **What this PR does NOT ship:** no runtime sync behavior, no auth UI, no `<script>` tag in `index.html`, no engine code. Commit 2 lands the static config files only.

---

## What's public, what's secret

Firebase's security model puts everything behind `firestore.rules` (server-side per-user isolation), **not** behind hiding the API key. Several artifacts you generate below look like secrets but are explicitly safe to commit to a public GitHub repo.

| Artifact | Public or secret? | Safe to commit? |
|---|---|---|
| Web API key (`apiKey` in the web config snippet) | public client config | yes |
| `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId` | public client config | yes |
| iOS bundle ID (`com.ksdisch.tempo`) | public | yes |
| `GoogleService-Info.plist` (downloaded at step 4) | public client config | yes — it ships inside the iOS app bundle anyway |
| `firestore.rules` content | public | yes |
| `firestore.indexes.json` | public | yes |
| **Firebase Admin / service-account JSON keys** | **SECRET — server-side credentials** | **NEVER commit** |
| **`*-firebase-adminsdk-*.json` files of any kind** | **SECRET** | **NEVER commit** |
| Any private key, PEM, or `.firebaserc` containing personal aliases | secret | no |

Tempo runs entirely client-side. **You should never need to download a service-account key.** If the Firebase Console ever offers you one, decline.

---

## Six manual setup steps

These match the six steps in `docs/sync-impl/PLAN.md` § "Backend setup (Firebase project)". Step numbering is preserved so external references like "redo step 4" are unambiguous.

---

### Step 1 — Create the Firebase project

**Location:** https://console.firebase.google.com → **"Add project"**.

1. **Project name:** `tempo-sync` (the display name is changeable later; the auto-generated **project ID** is not).
2. **Analytics:** decline. We don't need it, and it adds a consent surface.
3. Click **"Create project"** and wait for provisioning to complete.
4. **Open Project Settings → General → "Default GCP resource location"** and pick `us-central1`.

> **CRITICAL — REGION IS PERMANENT.** Pick `us-central1` and do not change it. Once Firestore is enabled at step 2, the database region is locked for the lifetime of this project. To change it later you would have to export all data, delete the project, recreate it, and re-import. This is per `docs/sync-review/BACKEND-SELECTION.md` § "Gotchas": "Database region is permanent. Pick `us-central1` or `nam5` once and you're stuck." `us-central1` is the recommendation.

5. Record the **project ID** (e.g., `tempo-sync-abc12`) and the **project number** — you will refer to these later when the implementer needs to confirm which project the config snippet belongs to.

---

### Step 2 — Enable Firestore

**Location:** Firebase Console → **Build → Firestore Database → "Create database"**.

1. **Mode:** select **Production mode**. (Production mode denies all reads/writes by default; we will replace this with `firestore.rules` in commit 2. Test mode is *less* safe — it opens reads/writes to anyone for 30 days.)
2. **Location:** Firestore should auto-select `us-central1` from your project's GCP resource location. If a region picker appears, pick `us-central1` and confirm.
3. Click **"Enable"**.

The console will land you on an empty database view. Leave it — commit 2 will populate it on first push, but only after rules are deployed.

---

### Step 2b — Deploy Tempo's Firestore security rules

> **CRITICAL — Firestore is currently configured with Production-mode default rules that deny ALL reads and writes.** Even after you sign in via the app, the first cloud upload (B-3) will fail with `Missing or insufficient permissions` until you replace the default rules with Tempo's rules. **Do this BEFORE you test cloud sync end-to-end.**

The `firestore.rules` file is committed to the repo (at the project root) but **Firebase does NOT auto-deploy from git**. You have to publish the rules manually. Two paths:

#### Path A — Firebase Console (fastest, ~30 seconds, no CLI install needed)

1. Open https://console.firebase.google.com/project/`<your-project-id>`/firestore/rules (or click **Build → Firestore Database → Rules** tab).
2. You'll see the current rules — likely a restrictive default like `allow read, write: if false;`.
3. Replace the entire content with the snippet from [Security rules](#security-rules) below (also in the repo at `firestore.rules`):

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{userId}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == userId;
       }
     }
   }
   ```

4. Click **Publish** (top right).
5. Wait ~10 seconds for the rules to propagate.

#### Path B — Firebase CLI (preferred if you have it installed)

```bash
npm install -g firebase-tools     # one-time
firebase login                    # one-time, opens browser
firebase use tempo-sync-6f7b2     # set the active project (substitute your project ID)
firebase deploy --only firestore:rules
```

The CLI reads `firestore.rules` from the repo root and pushes it. Idempotent — safe to re-run after every rules edit.

#### How to verify the rules are live

After publishing, the rules page in the Console shows a "Last published" timestamp matching your action. Or open a browser DevTools console while signed in to the app, and run:

```js
await SyncFirestore.setDoc(`users/${SyncAuth.getCurrentUser().uid}/_test/probe`, { ok: true })
```

If the rules are deployed correctly, this resolves silently. If not, it throws `permission-denied`.

---

### Step 3 — Enable Authentication → Google sign-in

**Location:** Firebase Console → **Build → Authentication → "Get started"**.

1. On the **Sign-in method** tab, click **Google** → toggle **Enable**.
2. **Project support email:** `kstan.disch@gmail.com`.
3. Click **Save**.
4. Still in Authentication, open **Settings → Authorized domains**.
5. Confirm `localhost` is already in the list (Firebase adds it by default).
6. Add `ksdisch.github.io` (the production web origin for GitHub Pages).
7. Save.

Cross-device identity: same Google account → same Firebase UID → same Firestore path. This is how Device A (laptop web) and Device B (iPhone Capacitor) will resolve to the same user. No separate user-mapping table needed.

---

### Step 4 — Register the iOS app

**Location:** Firebase Console → **Project Settings → General → "Your apps"** → tap the **iOS+** button.

1. **Apple bundle ID:** `com.ksdisch.tempo` (must match `capacitor.config.json`'s `appId` exactly — copy-paste it).
2. **App nickname:** `Tempo iOS`.
3. **App Store ID:** leave blank for now (we will fill this in once the App Store record exists; not required for development).
4. Click **"Register app"**.
5. **Download `GoogleService-Info.plist`** when prompted.
6. Save the file at `ios/App/App/GoogleService-Info.plist` in your local clone of the Tempo repo. This file is **public client config** (API key, project ID, GCM sender ID, bundle ID) — safe to commit. It ships inside the iOS app bundle and is extractable from any user's installed `.ipa` regardless.
7. **Skip** the console wizard's "Add Firebase SDK" and "Add init code" steps. Those are for non-Capacitor apps; Tempo gets the SDK via the `@capacitor-firebase/*` npm plugins in commit 2.

---

### Step 5 — Register the web app

**Location:** same **Project Settings → General → "Your apps"** screen → tap the **`</>`** (web) button.

1. **App nickname:** `Tempo Web`.
2. **Do NOT enable Firebase Hosting.** Tempo deploys to GitHub Pages.
3. Click **"Register app"**.
4. Firebase will show a `firebaseConfig` JavaScript snippet that looks like:

   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "tempo-sync-abc12.firebaseapp.com",
     projectId: "tempo-sync-abc12",
     storageBucket: "tempo-sync-abc12.appspot.com",
     messagingSenderId: "1234567890",
     appId: "1:1234567890:web:abcdef1234567890"
   };
   ```

5. **Copy that entire snippet.** Hand it off to the implementer (paste it into a comment on the draft PR or hand it over directly via chat). The implementer will paste it into `js/sync-firebase-config.js` in commit 2.

> **Reminder — these values are public client config, not secrets.** The `apiKey` is a misnomer — it identifies the Firebase project, it doesn't grant access. All access control lives in `firestore.rules` (see [Security rules](#security-rules) below), where every request must match `request.auth.uid == userId`. An attacker with the API key but no signed-in Google identity that matches a `userId` in the path gets a permission-denied error from the server. Per [What's public, what's secret](#whats-public-whats-secret) above: the snippet is safe to commit to a public GitHub repo.

---

### Step 6 — Set a $1/month budget alert

**Location:** https://console.cloud.google.com/billing → select the GCP project Firebase auto-created → **Budgets & alerts → Create budget**.

1. **Amount:** `$1.00` USD per month.
2. **Threshold rules:** 50%, 90%, 100% (the defaults).
3. **Email alerts to:** `kstan.disch@gmail.com`.
4. Save.

**Why $1?** Spark plan (Firebase's free tier) is genuinely free at Tempo's scale — `docs/sync-review/BACKEND-SELECTION.md` quantifies it as **~2000× headroom** on write quota (10 writes/day actual vs. 20,000/day cap). If you ever see a $1 charge accrue, it means something *unexpected* is happening: a runaway client looping on writes, a leaked credential being used elsewhere, or a misconfigured `runTransaction` retry storm. The $1 trip-wire is an *early-warning*, not a kill-switch — Spark plan also auto-pauses on quota overrun, so the budget alert is the canary, not the bouncer. (Per `docs/sync-impl/PLAN.md` § "Backend setup": "Spark plan can be paused on quota overrun; budget alert is the early-warning.")

---

## After the six steps — what you hand back to the implementer

When you've completed steps 1–6, signal greenlight (comment on the draft PR or hand off in chat). The implementer needs two artifacts from you:

1. **The iOS plist file.** You saved this at step 4 to `ios/App/App/GoogleService-Info.plist`. The implementer will `git add` it in commit 2.
2. **The web config snippet.** You copied this at step 5. Paste it into a PR comment, or hand it directly to the implementer dispatch. They will paste it verbatim into `js/sync-firebase-config.js` in commit 2.

Also useful to record (for posterity in the PR description):

- The Firebase **project ID** (e.g., `tempo-sync-abc12`).
- The Firebase **project number** (numeric).
- Confirmation that the region is `us-central1`.

The implementer will then:

1. Place `GoogleService-Info.plist` at `ios/App/App/GoogleService-Info.plist`.
2. Paste your web config snippet into `js/sync-firebase-config.js`.
3. Run `npm install firebase @capacitor-firebase/authentication @capacitor-firebase/firestore`.
4. Run `npx cap sync ios` to update `ios/App/Podfile`.
5. Write `firebase.json`, `firestore.rules`, `firestore.indexes.json`.
6. Update `capacitor.config.json` with the Firebase plugin block.
7. Append `.gitignore` with the service-account ignore patterns.
8. Verify web boot byte-equivalence, iOS build, and the existing 114 engine tests.
9. Push commit 2 and flip the PR out of draft.

---

## Security rules

These are the initial `firestore.rules` that commit 2 will deploy. Embedded verbatim from `docs/sync-impl/PLAN.md` § "Backend setup":

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

**What this does in one sentence:** the only request a user can make is to a path under their own UID — `request.auth.uid == userId` enforces per-user isolation, so even with the public API key, an attacker cannot read or write another user's data.

All Tempo sync data lives under `users/{uid}/...`. Per-store paths (for reference; commit 2 doesn't write these yet):

- `users/{uid}/meds/{medId}` — medication records
- `users/{uid}/meds/{medId}/doseLog/{entryId}` — append-only dose subcollection
- `users/{uid}/history/{sessionId}` — session history records
- `users/{uid}/rest_log/{date}` — daily rest log
- `users/{uid}/presets/{presetId}` — quick-presets

Production-mode default + per-user isolation rule = anything not explicitly matched is denied. This is the only access enforcement the server makes; every other invariant (LWW, append-merge, CAS, `schemaVersion`) lives in client code that ships in later PRs (B-1 / B-3 / D-2 / E-1).

---

## HIPAA / BAA posture

**Status:** Spark plan cannot self-serve a Business Associate Agreement. Personal single-user use is fine. Public-launch story with other users' dose data is blocked until either (a) upgrade to a paid GCP plan + sign a BAA through Google Cloud sales engagement, or (b) migrate off Firestore.

This is documented verbatim in `docs/sync-review/BACKEND-SELECTION.md` § "Killer caveat (day 2 surprise)" for Firebase:

> "Firestore *is* a BAA-eligible GCP service, but obtaining the BAA requires direct Google Cloud sales contact and typically a paid commitment. Spark-plan personal projects cannot self-serve a BAA. For Tempo's 'log my own meds' personal use this is a posture call (your data, encrypted at rest, never shared) — but you cannot truthfully market the app as HIPAA-compliant if you ever onboard other users with their own dose data."

**What triggers revisiting this:**

- Onboarding any second user (family member, friend) who logs their own medication doses through Tempo.
- Considering a public launch on the App Store with non-personal use cases.
- Any change in how dose data is shared or aggregated beyond the original device pair.

If any of those happen, the choice is upgrade-to-paid-GCP-plan + signed-BAA, or migrate off Firestore (the second of the two `BACKEND-SELECTION.md` § "Top 2 tradeoffs you accept" — Firestore vendor lock-in means migration is a rewrite, not a port).

---

## Rollback

If S0-1 needs to be reverted for any reason:

1. **Revert the PR** on GitHub. This drops the audit doc, this setup doc, and (after commit 2) the config files. Web boot returns to current `main`'s byte-equivalent state.
2. **Archive the Firebase project** in the Firebase Console — `Project Settings → General → "Delete project"` offers an archive option that preserves the project record for 30 days before permanent deletion. **Archive, do not immediately delete.** This preserves the decision audit for that 30-day window in case you want to undo the rollback.
3. **GCP project recovery:** the underlying GCP project Firebase created can be restored from archive within ~30 days via https://console.cloud.google.com/iam-admin/projects. After that window, the project ID becomes permanently reserved (you cannot reuse the same ID).
4. **Budget alert:** the $1/month budget rule survives project archive. If you delete the GCP project entirely after the 30-day window, the budget alert is removed automatically.

S0-1 is config-only and reversible within the 30-day archive window. The only irreversible decision is the **region pick at step 1** — but reverting S0-1 archives the entire project, so the region pick becomes moot.
