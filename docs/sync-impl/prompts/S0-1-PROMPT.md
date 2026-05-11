# Tempo cloud-sync — implement PR S0-1 (Stage 0: Firebase setup)

You're working on Tempo, a vanilla-JS PWA + Capacitor iOS app. The
cloud-sync implementation plan is at `docs/sync-impl/PLAN.md` on `main`.
All Stage A prereqs are complete (PRs #46–#56). This is the first
infrastructure PR.

## Required reading (before any code)

1. `docs/sync-impl/PLAN.md` — find the S0-1 section. That is your spec.
2. `docs/CLOUD-SYNC-STRATEGY.md` v2.0 — per-store merge rules, the four
   synced stores, security model.
3. `docs/sync-review/BACKEND-SELECTION.md` — Firebase / Firestore
   decision, two accepted tradeoffs, region pick.
4. `package.json` + `capacitor.config.json` — current dependency set and
   iOS bundle ID (`com.ksdisch.tempo`).
5. `js/platform.js` — existing Capacitor abstraction layer (this PR
   doesn't touch it, but the auth PR B-2 will extend it).

## What this PR ships

Firebase project config + plugins + security rules. **No behavior change.**
The app boots byte-equivalent on web. iOS still builds. The sync flag
(`tempo_sync_enabled`) stays off.

Concretely:
- `package.json` + lock — add `firebase`, `@capacitor-firebase/authentication`,
  `@capacitor-firebase/firestore`.
- `capacitor.config.json` — Firebase plugin config block.
- `ios/App/App/GoogleService-Info.plist` — Firebase iOS config (I will
  provide this file's contents after creating the Firebase project).
- `ios/App/Podfile` — auto-updated by `npx cap sync`.
- New `firebase.json`, `firestore.rules`, `firestore.indexes.json`.
- New `js/sync-firebase-config.js` — public web config snippet, gated
  behind `tempo_sync_enabled` so it doesn't load on prod.
- New `docs/sync-impl/FIREBASE-SETUP.md` — HIPAA posture, manual setup
  checklist, region pick rationale, budget alert, BAA gap callout.
- `.gitignore` — add `service-account.json` and any Firebase Admin keys.

## Hard rules

- **Audit before code.** First commit on the branch is
  `docs/sync-impl/audits/S0-1-AUDIT.md` listing affected files + manual
  setup steps. STOP after the audit and wait for review.
- **Web boot must not regress.** The config JS is NOT loaded in
  `index.html` until B-2 (auth) wires it behind the feature flag.
- **iOS Cocoapods must resolve.** `npx cap sync` must succeed after the
  dependency adds.
- **No secrets committed.** `GoogleService-Info.plist` and the web config
  snippet contain only public client config (API key, project ID, app ID).
  Admin keys / service accounts must be gitignored.
- Engine-test plan: none for this PR (config-only).

## IMPORTANT: I have NOT yet created the Firebase project

Before you can write `GoogleService-Info.plist` or `js/sync-firebase-config.js`,
I need to create the project in the Firebase Console. Write the audit doc
and the FIREBASE-SETUP.md (with the manual setup checklist I'll follow),
commit those, then STOP. I'll create the project, paste the config values,
and greenlight the code commit with the real values filled in.

## Deliverable

Branch `feat/sync-stage-0-firebase-setup`, PR against `main`. Commits:
1. `docs(sync-impl): S0-1 audit + Firebase setup guide` — audit + setup
   doc. STOP HERE.
2. After greenlight with real config values: `chore(sync): Firebase project
   config + plugins (S0-1)` — the code.

PR title once both commits land:
`chore(sync): Firebase project config + plugins (S0-1)`.
