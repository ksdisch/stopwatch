---
description: Set up a manual smoke test and hand you the steps. Figures out what to verify (from the argument or recent changes), opens every link/page you'll need in Chrome (auto-booting the local dev server if required), then gives you a precise do-this-see-that checklist with a TL;DR of the main objectives at the end — and saves it as a dated checkbox file under docs/smoke/.
argument-hint: [what to test — feature/route/flow/change; empty = infer from recent changes]
allowed-tools: Bash, Read, Glob, Grep, WebFetch, Monitor
---

# /smoke-test — tee up a manual smoke test, then hand me the steps

You need to verify something **by hand**. Your job here is to remove the setup
friction and tell me exactly what to look for — not to click through the test
yourself. Concretely: figure out what to test, open every page/link I'll need to
do it, then give me a precise, ordered checklist that ends with a TL;DR of the
main objectives.

Run everything from the project root (current working directory).

Argument: **$ARGUMENTS**

---

## Step 1 — figure out WHAT to smoke test

- If **$ARGUMENTS** names a feature / route / flow / change → that's the target.
- If **empty**, infer it, in this order:
  1. the work done **this session** (what we just built or fixed),
  2. else the diff — uncommitted changes, `git diff` vs the base branch, or recent commits,
  3. if still ambiguous, ask me **one** short question naming the 2–3 candidate things to test. Don't guess wildly.

Restate the target in one line, plus the **user-facing surfaces it touches** —
routes, screens, emails, webhooks, external dashboards.

## Step 2 — determine WHICH links/pages are needed

Enumerate every URL/page I must visit to complete the test. Consider:

- **App pages** — the *specific* routes affected (not just the homepage), local or deployed.
- **External services in the flow** — provider dashboards (Stripe, Supabase, Clerk/auth, Twilio, SendGrid, a GitHub OAuth consent screen…), an email inbox (Mailtrap/Gmail), a webhook inspector, a queue/log/admin panel.
- **Where the result is observed** — a DB table view, logs, an admin record.

Pull concrete URLs from the **code/config** (env vars, config files, route
definitions) — don't invent them. If a needed URL can't be resolved, list it as
"open `<X>` yourself" rather than guessing.

## Step 3 — get the app reachable (auto-boot if local)

- **Deployed target** → resolve and use the deployed URL (gh pages / `package.json` homepage / remote-derived — same resolution as `/boot_server` LIVE mode).
- **Local target** → follow the `/boot_server` LOCAL flow; don't reinvent it:
  - **Reuse check** — if the expected port already responds, reuse it.
  - Else start the dev server in the **background** (prefer the repo's own launcher — `make dev` / `dev.sh` / `Procfile` / `docker compose` — else the framework default), **wait until it's actually ready** (poll the URL; bail on a fatal error in the log or a timeout), and capture the **real** port.
- Don't open a blank tab: only open an **app** URL once it's confirmed reachable. External dashboards open regardless.

## Step 4 — open every needed link in Chrome

Open all the URLs from Step 2, one tab each — **app page(s) first**, then the
supporting dashboards / inboxes / logs in the order they're used during the test.

```bash
url="<resolved url>"; if [ -d "/Applications/Google Chrome.app" ]; then open -a "Google Chrome" "$url"; else open "$url"; fi
```

Note which tab is which.

## Step 5 — write the manual test instructions

A **numbered, do-this-see-that checklist**. Each step states:

- the **exact action** — which tab, where to click/type, what input to use (give *real* test data, not placeholders),
- the **expected result** — what proves it worked,
- any **precondition** — test creds, a feature flag, seed data — and what to confirm in the supporting tabs ("confirm the row appears in the Supabase table", "confirm the webhook fired in Stripe").

Cover the **happy path first**, then the key **edge/negative cases** worth a human
look (the ones automated tests don't cover). Keep it tight — only steps that
genuinely need a person.

## Step 6 — TL;DR (the gist / main objectives) — put it LAST

End with a short **TL;DR** block: 2–4 bullets giving the main objectives — what
I'm *really* verifying, the single **pass/fail bar**, and the one or two things
**most likely to be broken**. Someone should be able to read only the TL;DR and
know the point of the test.

## Step 7 — save the checklist + report

- Save the full instructions (steps + TL;DR) to a dated file: **`docs/smoke/$(date +%F)-<target-slug>.md`** (create `docs/smoke/` if missing). Format the steps as GFM checkboxes `- [ ]` so I can tick through them; keep the TL;DR at the bottom.
- Print the same steps + TL;DR in chat.
- Briefly note: which tabs were opened, where the checklist was saved, and — if a local server was started — that it's running in the background and how to stop it (`lsof -ti:<port> | xargs kill`).

Keep the report short — I want to start testing, not read a wall of text.
