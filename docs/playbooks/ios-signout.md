# Playbook: iOS "Sign out" doesn't actually sign the user out

- **Status:** FIX LANDED (2026-07-07) — Option B guard in `js/platform.js`; **on-device verification pending** (the [Diagnosis](#diagnosis) recipe doubles as the verify recipe).
- **Platform:** iOS Capacitor shell only. Web sign-out works correctly.
- **First documented:** surfaced 2026-05-20 during the PR #86 smoke test; canonical entry in `../../CLAUDE.md` "Remaining Tech Debt" (`../../CLAUDE.md:189`).
- **Severity:** low-to-moderate. No data loss; the account stays signed in but the user *believes* they signed out. The [workaround](#workaround-do-this-today) fully pauses sync.

## Symptom

On the **iOS build**, tapping **"Sign out"** in the Cloud Sync settings drawer dismisses the popup and clears the visible status row, but `SyncAuth.getCurrentUser()` keeps returning the signed-in account. The drawer re-renders right back into the signed-in state, and sync stays live.

The same flow on the **web build is correct** — sign-out clears the user and the drawer flips to the signed-out state. The divergence is native-only.

What you observe:

- Drawer dismisses, no error toast.
- `SyncAuth.getCurrentUser()` (`js/sync-auth.js:165-167`, returns the cached `_currentUser`) is still non-null after the tap.
- `renderCloudSyncUI()` (called at `js/tempo-nav.js:506`) paints the signed-in layout again.

## Status

**Fix landed 2026-07-07, on-device verification pending.** The Option B guard
(`_authSignOutGuard` in `js/platform.js`) arms on native sign-out, swallows
non-null `authStateChange` re-emits while armed, and disarms on the SDK's own
null emit (teardown confirmation), an explicit `signIn`, or app relaunch (it is
an in-memory flag). Worst case, if the plugin's `signOut()` genuinely fails,
the device *behaves* signed-out until relaunch — consistent with `SyncAuth`'s
existing signed-out-locally semantics (its empty `catch` already force-clears
local state on plugin failure).

- The bug **predates PR #86** — that PR had zero auth-code diff, it only surfaced the behavior during a smoke test (`../../CLAUDE.md:189`).
- It is **likely present since B-2** — commit `1db244c` ("feat(sync): Google sign-in + settings drawer Cloud Sync section (B-2)", 2026-05-11), which introduced the sign-in flow and the drawer Cloud Sync section. Confirm with `git show -s --format='%h %ad %s' --date=short 1db244c`.
- This sits in the same **"native lags web"** family as the deferred native CAS + listener parity (see `../adr/0009-defer-native-cas-listener-parity.md`): the web/native seam (`../adr/0007-capacitor-native-wrapper.md`) has two divergent code paths, and the native one is the one that misbehaves.

## Why the code path *looks* correct

The whole sign-out chain is structurally sound. Read top-down, nothing is obviously wrong — which is why this is a race, not a logic bug:

1. **Drawer handler** — the `#cloud-sync-signout-btn` click handler `await`s `SyncAuth.signOut()`, clears the status row, then re-renders (`js/tempo-nav.js:497-508`; the `await SyncAuth.signOut()` call is at `js/tempo-nav.js:500`).
2. **`SyncAuth.signOut()`** — always lands at `_setUser(null)` (`js/sync-auth.js:149-161`). Even when `Platform.auth.signOut()` throws, the `catch` is deliberately empty and execution falls through to `_setUser(null)` (`js/sync-auth.js:156-160`). `_setUser(null)` fans out to local listeners and emits `auth-change` with `null` (`js/sync-auth.js:48-60`).
3. **Native `authSignOut`** — `Platform.auth.signOut` routes to `authSignOut()` (wired at `js/platform.js:434`). The native branch calls `await fa.signOut()` (the `@capacitor-firebase/authentication` plugin) inside a swallow-everything `try/catch`, then **always** calls `_emitAuth(null)` regardless of plugin success or failure (`js/platform.js:399-408`). `_emitAuth(null)` clears `_authCachedUser` and notifies subscribers (`js/platform.js:227-233`).

So both caches get cleared: `SyncAuth._currentUser` via `_setUser(null)`, and `Platform`'s `_authCachedUser` via `_emitAuth(null)`. The accessors that gate sync — `SyncAuth.getCurrentUser()` (`js/sync-auth.js:165-167`) and `authGetCurrentUser()` (`js/platform.js:418-420`) — both read those caches. On paper the user is gone.

## Root-cause hypothesis

A **re-emit races back in and restores the user a moment after sign-out**.

When `Platform.auth.init()` runs on native, it subscribes to the plugin's `authStateChange` event and re-emits whatever user the plugin reports (`js/platform.js:296-303`):

```js
fa.addListener('authStateChange', (event) => {
  const u = event && event.user ? _normalizeUser(event.user) : null;
  _emitAuth(u);
});
```

The hypothesis: `@capacitor-firebase/authentication`'s `signOut()` (`js/platform.js:405`) **resolves on the JS side before the Firebase iOS SDK has fully torn down its Keychain-cached auth state**. The native SDK then fires an `authStateChange` carrying the *still-cached* user, the listener at `js/platform.js:298-301` re-`_emitAuth(...)`s it, and `_authCachedUser` (and, via the `onAuthChange` subscriber wired in `SyncAuth.init`, `_currentUser`) is repopulated with the account we just cleared.

The ordering is the tell:

1. `_emitAuth(null)` — explicit sign-out clear (`js/platform.js:406`).
2. `authStateChange` fires with the stale Keychain user → `_emitAuth(user)` (`js/platform.js:300`).

The second emit wins because it lands last. On web there is no equivalent stale Keychain layer — `onAuthStateChanged` fires `_emitAuth(null)` cleanly after `signOut()` (`js/platform.js:322-327`, `:412-415`), so the web build never sees the re-emit.

This is a hypothesis, not a confirmed diagnosis — it has not been reproduced under an attached debugger. The [Diagnosis](#diagnosis) recipe is how you confirm it.

## Workaround (do this today)

**Toggle "Enable cloud sync" OFF in the Cloud Sync settings drawer.**

This pauses all sync without needing auth tear-down (`../../CLAUDE.md:189`). The master flag (`tempo_sync_enabled`, owned by `SyncFlag`) gates every sync path — with it off, the still-cached user is inert: no polling, no writeback, no listeners. The account technically stays signed in at the Firebase iOS SDK / Keychain layer, but Tempo does nothing with it.

Use this when an operator needs to actually stop syncing on a device (e.g., handing the phone to someone else, or switching accounts) and the Sign-out button isn't taking.

## Diagnosis

Confirm the re-emit race with Safari Web Inspector against the live iPhone WebView:

1. On the Mac, **Safari → Develop → [your iPhone] → Tempo** to attach the Web Inspector to the Capacitor WebView. (Requires the iPhone connected and Web Inspector enabled in iOS Settings → Safari → Advanced.)
2. In the inspector console, instrument the emit path — wrap or log every `_emitAuth` call so you can see its argument and order. The function is `js/platform.js:227-233`; the native listener that may re-fire is `js/platform.js:298-301`.
3. **Tap "Sign out"** in the drawer.
4. **Watch the `_emitAuth` call order.** The signature of the bug:
   - a `_emitAuth(null)` (from `authSignOut`, `js/platform.js:406`), immediately followed by
   - a `_emitAuth(<user>)` (from the `authStateChange` re-emit, `js/platform.js:300`) carrying the account you just cleared.

If you see the null emit followed by a non-null re-emit, the hypothesis holds. If the null emit is the *last* one and `getCurrentUser()` is still non-null, the problem is elsewhere (e.g. the plugin's `getCurrentUser()` rehydrate at `js/platform.js:306-314` firing late) and this playbook's root-cause section needs revising.

## The fix (landed 2026-07-07)

**Option B — suppress the stale re-emit**, implemented in the native branches of
`js/platform.js`:

- `authSignOut` arms `_authSignOutGuard` **before** `await fa.signOut()` — the
  stale event can be delivered while JS is suspended at that await, so arming
  after would leave a window.
- The `authStateChange` listener swallows **non-null** emits while the guard is
  armed; a **null** emit is the SDK's own teardown confirmation and disarms it.
  State-based, not time-based: no one-shot counter or timing window to tune,
  and multiple stale re-emits are all swallowed.
- The cold-boot rehydrate (`fa.getCurrentUser()`) also respects the guard, so a
  late-resolving rehydrate can't resurrect a just-signed-out user.
- `authSignIn` disarms the guard up front — an explicit sign-in must never be
  masked.

**Option A (await a real tear-down) was ruled out as unavailable:** checked
`@capacitor-firebase/authentication@6.3.1` — `signOut(): Promise<void>` is the
plugin's only teardown hook (no Keychain-clear API; `deleteUser()` destroys the
account, `revokeAccessToken()` is Apple-token plumbing). `await fa.signOut()`
was already the maximal await, so suppression is the whole available fix.

The change is confined to `js/platform.js` and **still requires Xcode + a
physical iPhone to confirm** — the bug cannot be reproduced in the web test
harness (`tests/index.html`), since it is native-Keychain-specific; the change
shipped on `node --check` + reasoning per the #169 R3 precedent (same
constraint that defers the sibling native parity work,
`../adr/0009-defer-native-cas-listener-parity.md`). Expected post-fix signature
under the [Diagnosis](#diagnosis) recipe: `_emitAuth(null)` from `authSignOut`,
any stale non-null `authStateChange` swallowed (no `_emitAuth` call), drawer
stays signed-out.

## See also

- `../adr/0007-capacitor-native-wrapper.md` — the web/native seam this bug lives in (the `Platform` abstraction).
- `../adr/0009-defer-native-cas-listener-parity.md` — sibling "native lags web" theme: native runs a degraded path because the hard half can't be verified in the web harness.
- `../../CLAUDE.md` — the canonical tech-debt entry for this bug (`../../CLAUDE.md:189`).
- `sync-divergence.md` — sibling sync playbook (same Tier 3 batch).
- `js/sync-auth.js`, `js/platform.js`, `js/tempo-nav.js` — the three files the sign-out chain threads through.
