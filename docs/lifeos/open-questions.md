# Tempo Life-OS — Open Questions

**Status:** living list · **Date:** 2026-06-08

Deliberately deferred items. None block the v1 roadmap; each notes when to revisit.

---

| # | Question | Context / leaning | Revisit when |
|---|---|---|---|
| 1 | **Remote / on-demand AI** | Tier 3 of the runtime (`architecture.md` §1). Needs a `claude` server sidecar or a thin backend so a council can be *triggered* or *queried* from the phone when away from the Mac. Lean: add only if the local-first loop proves too limiting. | After P7 — once the local loop is proven and the "away from desk" pain is real. |
| 2 | **Finance aggregator (Plaid/bank)** | v1 uses manual monthly metrics (`data-sources.md`). Auto-aggregation is richer but adds a backend + recurring cost + a large privacy surface, against the local-first v1. | If manual finance entry stops happening, or once a backend exists for #1. |
| 3 | **Personal-CRM depth for Relationships** | v1 is a light "people I tend" list + context cards (concierge). A full per-interaction CRM was rejected as transactional/creepy. | If drift-detection proves too coarse in practice. |
| 4 | **Product name** | Working name is "Tempo / Tempo Life-OS." Open: does the parent keep the Tempo name (with Tempo's timing features as one feature set), or get a new name with Tempo as a sub-brand? Affects only branding, not architecture. | Before P1 ships anything user-facing with a title. |
| 5 | **Mood / affect capture UX** | ✅ **Resolved 2026-06-09** (P3 design): 1-tap valence (1–5 emoji chips) + optional tag chips/note via a topbar popover (deferred-commit); stored as the 7th synced store `mood_events`. See [`phase-3-plan.md`](phase-3-plan.md) + [`decisions/0008`](decisions/0008-mood-event-store.md). | — resolved. |
| 6 | **DogHood ingest mechanics** | Live Supabase Realtime subscription vs. periodic batch export of `presences`/`invites`. Both work; Realtime is fresher, batch is simpler. | At the start of P4/P5 (whenever Relationships data is wired). |
| 7 | **Final unit names** | "Area" and "Module" are placeholders from discovery (`decisions/0006`). Rename if better fits emerge. | Anytime before they're hard-coded in P0 contracts. |
| 8 | **Bubble-lens build order** | All three size-lenses ship eventually; which is the v1 default and which can lag? Lean: "needs-attention" as the default (matches Kyle's stated intuition). | During P1. |
| 9 | **Career sub-hub retirement** | The career cluster (`job-search-mas` et al.) is temporary; when Kyle is employed it should archive (`integration-plan.md` §3). Define the trigger + what's retained. | When a job offer lands. |
| 10 | **Targets / baselines per Area** | `Neglect` needs a yardstick per Area. Initial targets are user-set; the approve-on-change loop refines them. The *first* set still has to be authored. | Per pillar, as each is built (P2+). |
