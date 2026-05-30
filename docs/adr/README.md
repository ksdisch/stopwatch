# Architecture Decision Records

Numbered, append-only records of the durable, hard-to-reverse decisions behind Tempo.
Once an ADR is **Accepted** it is immutable — to change a decision, add a new ADR that
supersedes it and update the old one's `Status` line to point at the new number.

> ADRs capture **cross-cutting** decisions. The **per-PR** implementation trail lives in
> `docs/audits/` and `docs/sync-impl/audits/`; the binding cloud-sync spec is
> `docs/CLOUD-SYNC-STRATEGY.md`.

| # | Title | Status |
|---|-------|--------|
| [0000](0000-template.md) | Template | — |
| [0001](0001-no-build-script-load-order.md) | No build step; script load order in `index.html` IS the dependency graph | Accepted |
| [0002](0002-drift-free-wall-clock-timing.md) | Drift-free wall-clock timing — elapsed is derived, never tick-accumulated | Accepted |
| [0003](0003-firestore-sync-backend.md) | Firebase/Firestore as the cloud-sync backend | Accepted |
| [0004](0004-per-store-merge-strategy.md) | Per-store, per-record conflict resolution instead of global last-write-wins | Accepted |

## Planned (from `docs/artifacts-plan.md`, Tier 1 → Tier 2)

The next ADR round retro-documents: `0005` mutable-global-proxy primary-instance, `0006`
split localStorage/IndexedDB persistence, `0007` Capacitor native wrapper, `0008` Todoist
personal-token (not OAuth), `0009` deferred native CAS/listener parity. New decisions get
the next free number going forward.

## Conventions

- Filename: `000N-kebab-title.md`.
- Status values: `Proposed` → `Accepted` → (`Superseded by 00MM` | `Deprecated`).
- Start from [`0000-template.md`](0000-template.md).
