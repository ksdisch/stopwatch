---
description: Detect how this project is served, start the dev server in the background, wait until it's ready, and open the running page in Chrome. Pass "live" to open the deployed page (e.g. GitHub Pages) instead.
argument-hint: [live | local | <port> | <url>]
allowed-tools: Bash, Read, Glob, Grep, WebFetch, Monitor
---

# /boot_server — start the server and open the app in Chrome

Get this project running and visible in one shot. Detect how it's served, start
it (in the **background** so it keeps running while the user works), wait until
it's actually ready, then open the page in Chrome.

Run everything from the project root (current working directory).

Argument: **$ARGUMENTS**

## Step 0 — interpret the argument

- empty → **local mode** (start the dev server, open localhost). This is the default.
- `live`, `prod`, or `pages` → **live mode** (skip the server, open the deployed URL).
- `local` → force local mode.
- a bare number (e.g. `3000`) → local mode, but assume/override this port.
- a full URL → just open it in Chrome (Step "Open in Chrome") and stop.

---

## LIVE MODE — open the deployed page

Resolve the deployed URL, in this order, and open the first that works:

1. If `gh` is available and this is a GitHub repo:
   `gh api repos/{owner}/{repo}/pages --jq .html_url` (gives the Pages URL).
2. A `CNAME` file in the repo or `public/`/`docs/` → `https://<contents>`.
3. `package.json` `"homepage"` field.
4. `vercel.json` / `netlify.toml` present → check `vercel ls` / `netlify status`
   if those CLIs exist, else tell the user you can't resolve it automatically.
5. Derive from the git remote: `github.com/<user>/<repo>` →
   `https://<user>.github.io/<repo>/` (or `https://<user>.github.io/` when the
   repo is named `<user>.github.io`).

Open the resolved URL in Chrome (see "Open in Chrome"), report it, and stop.

---

## LOCAL MODE — start the dev server and open it

### 1. Prefer the repo's own launcher (check this FIRST)

Before reaching for the per-framework table below, check whether the repo ships
its own dev launcher. It is the intended way to run the project and usually boots
the **whole stack at once** (e.g. backend + frontend together) — guessing a
single framework command would start only half of it. Use the first that exists:

| Signal | Run |
|---|---|
| `Makefile` with a `dev` (or `start` / `serve` / `up`) target | `make dev` |
| `dev.sh` / `bin/dev` / `scripts/dev.sh` (executable) | `./dev.sh` (the path that exists) |
| `Procfile` / `Procfile.dev` | `overmind start` → `foreman start` → `honcho start` (first that's installed) |
| `docker-compose.yml` / `compose.yaml` (app services, no simpler launcher) | `docker compose up` |

**Read the launcher before running it.** `cat` the script / Makefile target /
Procfile. These often start MULTIPLE servers on different ports — find which one
is the **frontend page to open** (look for hints like "← open this", a
`5173`/`3000`/`8080` web-UI port, or the top-level UI service). That frontend URL
is what you use for the reuse check (step 3), the readiness wait (step 5), and
Chrome (step 6) — don't assume the first port printed.

If a launcher exists, use it and **skip step 2** (the framework table is the
fallback for repos with no launcher).

### 2. Otherwise, detect the start command + expected port

Identify the project type and the command to run. **Node** (a `package.json`
exists): pick the package manager from the lockfile, and pick the script in this
order of preference: `dev` → `start` → `serve` → `preview`.

| Lockfile | Run a script with |
|---|---|
| `pnpm-lock.yaml` | `pnpm <script>` |
| `yarn.lock` | `yarn <script>` |
| `bun.lockb` | `bun run <script>` |
| `package-lock.json` / none | `npm run <script>` |

If it's not Node, detect by these signals and use the matching command:

| Signal | Start command |
|---|---|
| `manage.py` (Django) | `python manage.py runserver` |
| `app.py` / Flask app | `flask run` (or `python app.py`) |
| FastAPI / `uvicorn` dep | `uvicorn main:app --reload` (match the module) |
| `bin/rails` / `config.ru` (Rails) | `bin/rails server` |
| `Gemfile` + Jekyll | `bundle exec jekyll serve` |
| `config.toml`/`hugo.toml` (Hugo) | `hugo server` |
| `Cargo.toml` | `cargo run` |
| `go.mod` | `go run .` (or the documented cmd) |
| Only static `index.html`, no server | `python3 -m http.server 8000` in the dir holding it |

Expected default ports (used for the reuse check and as a fallback if you can't
read the actual port from the server's output):

Next.js/CRA/Remix/Nuxt/Express/Docusaurus `3000` · Vite (React/Vue/Svelte/SvelteKit) `5173` ·
Vue CLI `8080` · Angular `4200` · Astro `4321` · Gatsby/Django/FastAPI/http.server `8000` ·
Flask `5000` · Rails `3000` · Storybook `6006` · Jekyll `4000` · Hugo `1313`.

If you genuinely can't determine how to start it, tell the user what you found
and ask — don't guess wildly.

### 3. Reuse check (do NOT start a second server)

Before starting anything, check whether the expected frontend port is already
serving:

```bash
PORT=<expected port>; if curl -sf -o /dev/null --max-time 1 "http://localhost:$PORT"; then echo "ALIVE on $PORT"; else lsof -nP -iTCP:$PORT -sTCP:LISTEN 2>/dev/null | tail -n +1; fi
```

If it's already responding, **skip starting** and jump straight to "Open in
Chrome" with `http://localhost:<port>`. Mention you reused the running server.

### 4. Start the server in the background

Start it with the Bash tool using **run_in_background: true** so it persists
across turns and doesn't block the session. Keep the returned task handle so you
can report it (and so the user can stop it later).

### 5. Wait until it's actually ready (and get the real URL)

The real port can differ from the default (e.g. Vite jumps to 5174 if 5173 is
taken), so prefer the truth from the server's own startup output:

- Read the background server's output and look for the URL it prints, e.g.
  `Local: http://localhost:5173/`, `running on http://127.0.0.1:8000`,
  `Listening on ...`. Use that exact URL/port if found.
- Otherwise fall back to `http://localhost:<expected frontend port>`.

Then wait for it to respond before opening the browser (first builds can be
slow). A single "wait until ready" is best done with a **`run_in_background`
until-loop** that exits the moment the URL responds OR a fatal error appears in
the log OR it times out — you get one clean notification:

```bash
for i in $(seq 1 60); do
  curl -sf -o /dev/null --max-time 2 "<resolved url>" && { echo "READY after ${i}s"; exit 0; }
  grep -qiE "Traceback \(most recent|ModuleNotFoundError|EADDRINUSE|address already in use|Cannot find package|Cannot find module|failed to load config" "<server log>" && { echo "FATAL"; exit 2; }
  sleep 1
done
echo "TIMEOUT"; exit 1
```

If it never comes up (timeout or fatal), show the last ~20 lines of the server
output so the user can see the error, and stop (don't open a blank tab).

### 6. Open in Chrome

```bash
url="<resolved url>"; if [ -d "/Applications/Google Chrome.app" ]; then open -a "Google Chrome" "$url"; else open "$url"; fi
```

### 7. Report

Briefly tell the user:
- The command you ran (or that you reused an already-running server) and the URL opened.
- That it's running in the background, and how to stop it (the background task / `lsof -ti:<port> | xargs kill`).
- If readiness polling timed out, the error tail instead.

Keep it short — they want to look at the app, not read a wall of text.
