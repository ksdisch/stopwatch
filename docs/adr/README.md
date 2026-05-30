# Architecture Decision Records

Numbered, append-only records of the durable, hard-to-reverse decisions behind Tempo.
Once an ADR is **Accepted** it is immutable — to change a decision, add a new ADR that
supersedes it and update the old one's `Status` line to point at the new number.

> ADRs capture **cross-cutting** decisions. The **per-PR** implementation trail lives in
> `docs/audits/` and `docs/sync-impl/audits/`; the binding cloud-sync spec is
> `docs/CLOUD-SYNC-STRATEGY.md`. For the system-wide picture these ADRs slot into, see
> [`../ARCHITECTURE.md`](../ARCHITECTURE.md).

| # | Title | Status |
|---|-------|--------|
| [0000](0000-template.md) | Template | — |
| [0001](0001-no-build-script-load-order.md) | No build step; script load order in `index.html` IS the dependency graph | Accepted |
| [0002](0002-drift-free-wall-clock-timing.md) | Drift-free wall-clock timing — elapsed is derived, never tick-accumulated | Accepted |
| [0003](0003-firestore-sync-backend.md) | Firebase/Firestore as the cloud-sync backend | Accepted |
| [0004](0004-per-store-merge-strategy.md) | Per-store, per-record conflict resolution instead of global last-write-wins | Accepted |
| [0005](0005-mutable-global-proxy-primary-instance.md) | Mutable global proxy for the primary stopwatch / timer instance | Accepted |
| [0006](0006-split-localstorage-indexeddb-persistence.md) | Split localStorage / IndexedDB persistence topology — and two separate IndexedDB databases | Accepted |
| [0007](0007-capacitor-native-wrapper.md) | Wrap the existing no-build web app in a Capacitor iOS shell, not a React Native rewrite or PWA-only | Accepted |
| [0008](0008-todoist-personal-token-not-oauth.md) | Todoist auth uses a user-pasted personal API token, not OAuth 2.0 | Accepted |
| [0009](0009-defer-native-cas-listener-parity.md) | Defer native CAS + real-time listener parity — ship web-first, run a degraded native path | Accepted |

The next decision gets number `0010`.

## Conventions

- Filename: `000N-kebab-title.md`.
- Status values: `Proposed` → `Accepted` → (`Superseded by 00MM` | `Deprecated`).
- Start from [`0000-template.md`](0000-template.md).
