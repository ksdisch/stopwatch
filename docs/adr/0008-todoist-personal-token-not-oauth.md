# ADR 0008: Todoist auth uses a user-pasted personal API token, not OAuth 2.0

- **Status:** Accepted (retro-documented 2026-05-30)
- **Date:** 2026-05-28 (shipped with the Pomodoro V1 Todoist integration, PR `bl-2-todoist`)
- **Deciders:** ksdisch
- **Tags:** todoist, auth, integration, no-backend

## Context

The Todoist integration (backlog #2) two-way-syncs tasks between Todoist and Tempo's Pomodoro saved-task list and Flow user-task list: pull tasks in via the REST v2 API, write completions / reopens / creates / renames back. Talking to a third-party API means authenticating, and the question that needed deciding before a line of the client shipped was *how*.

The dominant constraint is the one that drives almost every cross-cutting decision in this repo: **Tempo has no backend.** The web build is static files served from GitHub Pages (push-to-deploy from `main` root); the native build is the same JS running inside a Capacitor WKWebView. There is no confidential server-side environment anywhere in the stack — nowhere to hold a secret, nowhere to terminate a redirect, nowhere to run a token-exchange callback. This is the *same* force that makes Firestore a dumb per-record document store with all merge logic client-side (ADR 0004) and makes the Firebase web config safe to commit in the clear (`js/sync-firebase-config.js:3-6` — "PUBLIC client config… The apiKey identifies the project, it does not grant access").

OAuth 2.0 Authorization Code — the "correct" enterprise pattern — is built around exactly the thing Tempo doesn't have. It requires a confidential client to hold the `client_secret` (a public PWA cannot keep one secret), and a registered, hosted redirect URI to receive the authorization code. PKCE softens the secret problem for public clients but still wants a redirect-handling origin and a token-refresh story; for a single-user task-list integration that is a large amount of moving infrastructure to stand up and operate for one person.

Two facts make the heavyweight path unnecessary here. First, Todoist publishes personal API tokens precisely for this case — a single user can copy a full-account token from Todoist › Settings › Integrations and paste it into a client. Second, the scale is trivial: Todoist's rate limit is 1000 requests / 15 min / token (`js/todoist.js:48`), and this client does no polling at all — every network call is user-action-driven (picker open, "Test connection", a check/uncheck/create/rename write-back, or an offline-queue drain on `online` / `visibilitychange:visible`). A single-user app is nowhere near the ceiling. The same OAuth-vs-token reasoning is recorded verbatim in the backlog: "OAuth 2.0 — rejected because Tempo has no backend to hold the OAuth client secret; personal API token is the standard pattern for PWAs against Todoist" (`CLAUDE.md:174`, backlog row #2).

## Decision

We authenticate every Todoist request with a **user-pasted personal API token**, stored device-local in `localStorage` and never propagated off the device. No OAuth, no redirect, no token exchange, no refresh.

The token lives under one `localStorage` key, `todoist_api_token` (`js/todoist.js:65`, inside the `STORAGE_KEYS` map). The client owns the full lifecycle: `getToken()` reads it, returning `null` for an absent/empty value (`js/todoist.js:87-94`); `setToken(token)` writes it, or removes the key when handed a falsy value (`js/todoist.js:96-104`); `clearToken()` deletes it (`js/todoist.js:106-108`); and `hasToken()` is the configured-or-not predicate the read/network methods guard on (`js/todoist.js:110-112`, e.g. `testConnection` at `:229`, `getProjects`/`getTasks` at `:245`/`:264`, and `drainQueue` at `:525`). The token is applied as a Bearer credential in the single fetch wrapper — `if (token) headers['Authorization'] = 'Bearer ' + token;` (`js/todoist.js:197-198`) — so there is exactly one auth attach-point for the whole client.

The token is held to three storage boundaries that fall straight out of "never sync credentials":

1. **Never synced to Firestore.** `todoist_api_token` is not a member of the `SYNCED_STORES` registry — there is no `todoist` reference anywhere in `js/sync-engine.js`. The integration deliberately keeps Pomodoro/Flow task lists *outside* the Firestore sync set; two devices reconcile against Todoist itself as the source of truth, not against each other.
2. **Never exported or backed up.** `todoist_api_token` (and its three sibling config keys) are absent from `EXPORT_SETTINGS_KEYS` (`js/export.js:74-118`), the explicit allow-list that drives the full-data JSON export and the F12 local backup. The header comment states the intent directly: the token is "excluded from `EXPORT_SETTINGS_KEYS` in `js/export.js` so it cannot leak via the full-data JSON export" (`js/todoist.js:53-57`).
3. **Re-pasted per device.** Because it neither syncs nor rides along in a backup restore, the user pastes the token once on each device they want connected. This is the accepted cost of (1) and (2), not an oversight.

## Consequences

### Positive

- **Zero backend, consistent with the whole app.** No confidential client, no hosted redirect URI, no callback origin, no token-refresh cron. The integration is pure REST/CORS over `fetch`, which is why it needed "zero extra work" on iOS — WKWebView issues the same requests as the web build (`CLAUDE.md:174`).
- **Credentials never leave the device.** The three storage boundaries above mean a Todoist token cannot leak through cloud sync or through a shared/exported backup file. A backup restored onto a friend's device, or synced to another of the user's own devices, carries no Todoist credential.
- **One auth attach-point, easy to audit.** Every request gets its Bearer header from the single `_fetch` wrapper (`js/todoist.js:197-198`); every public method short-circuits on `hasToken()` before touching the network. There is no scattered credential handling to reason about.
- **Idempotent, retry-safe writes need no session refresh.** Because the token is long-lived and stateless, the offline queue (`todoist_pending_ops`) can replay `close`/`reopen`/`create`/`update` ops on reconnect without an OAuth refresh dance — there is no access token to expire mid-drain.

### Negative / tradeoffs

- **No cross-device propagation — the user re-pastes per device.** A direct consequence of "never sync credentials." There is no first-run hand-off; each new device is a fresh paste from Todoist › Settings › Integrations.
- **Plaintext in `localStorage`.** The token sits unencrypted in `localStorage`, readable by any script that runs in the origin (and by anyone with filesystem/devtools access to the device). Acceptable for a single-user personal app where the threat model is "don't leak it through sync or a shared backup," not "defend against local compromise" — but it is not secret-store-grade.
- **Full-account scope, no granularity.** A Todoist personal token grants the bearer's entire account; there are no OAuth scopes to restrict the integration to, say, a single project or read-only access. The hard one-way delete guard (`Todoist.deleteTask` does not exist — `js/todoist.js:17-21`) is the *behavioral* mitigation, since the credential itself offers no scope ceiling.
- **Manual revocation.** Disconnecting is "delete the token in Todoist's settings + `clearToken()` locally"; there is no OAuth consent screen the user can revoke from Todoist's side per-app.

## Alternatives considered

- **OAuth 2.0 Authorization Code (with or without PKCE).** Rejected: requires a confidential client to hold the `client_secret` (a static PWA cannot) and a registered, hosted redirect URI to receive the code. PKCE removes the secret requirement but still needs a redirect-handling origin and a refresh-token story — heavyweight identity infrastructure for a single user's task list, against an app with no server tier at all. This is the same "no backend to hold a secret" wall that ADR 0003/0004 hit.
- **A serverless proxy / cloud function to hold the OAuth secret and broker tokens.** Rejected: this stands up and *operates* infrastructure — a function, a per-user secret store, a deploy/monitor surface — for exactly one user. That directly contradicts the no-backend design that makes the rest of the app cheap to run and free to host. Firestore is already used as a dumb document store specifically to avoid running a service; adding an auth-broker function would reintroduce the server tier the architecture spent effort avoiding.
- **Sync the token across devices via Firestore** (so the user pastes once). Rejected hard: never sync credentials. A token replicated into `SYNCED_STORES` would land in every device's `localStorage` and in the per-user Firestore document, widening the blast radius of a leak for marginal convenience. Keeping it out of both `SYNCED_STORES` *and* `EXPORT_SETTINGS_KEYS` is the deliberate boundary; the per-device re-paste is the priced-in cost.

## References

- `js/todoist.js:40-57` (header: token is device-local, NOT synced, NOT exported), `:48` (1000 req / 15 min rate-limit note), `:65` (`todoist_api_token` key in `STORAGE_KEYS`), `:87-94` (`getToken`), `:96-104` (`setToken`), `:106-108` (`clearToken`), `:110-112` (`hasToken` configured-predicate), `:197-198` (Bearer-token attach in `_fetch`), `:17-21` (no `deleteTask` — one-way hard guard), `:229` / `:245` / `:264` / `:525` (`hasToken` guards on `testConnection` / `getProjects` / `getTasks` / `drainQueue`)
- `js/export.js:74-118` (`EXPORT_SETTINGS_KEYS` allow-list — Todoist keys conspicuously absent)
- `js/sync-firebase-config.js:3-6` (public-client-config precedent — same "no secret to hide" force)
- `js/sync-engine.js:138` (`SYNCED_STORES` registry — no `todoist` member anywhere in the file)
- `CLAUDE.md:174` (backlog row #2 — verbatim OAuth-rejected rationale + token-storage notes)
- Related: ADR 0003 (Firebase/Firestore backend — the "no backend" root cause), ADR 0004 (per-store client-side merge — explicitly cites the Todoist personal-token decision as a sibling consequence of the no-server design, `0004-per-store-merge-strategy.md:61`)
- Related docs: backlog row #10-B (`CLAUDE.md`) — `updateTask` rename write-back, same device-local token model
