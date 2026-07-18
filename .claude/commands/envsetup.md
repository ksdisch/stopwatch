---
description: Open this project's .env in your editor and the credential's generation page in Chrome, with a key stub + source comment pre-added so you just paste the value.
argument-hint: <ENV_VAR or "description of the token"> [more tokens...]
allowed-tools: Bash, Read, Write, Edit, WebSearch, WebFetch
---

# /envsetup — open the .env file + the page where I get the token

The user needs to obtain one or more credentials/secrets and save them into this
project's env file. Your job is **not** to fetch or paste the value — the user
does that themselves. Your job is to remove the busywork:

1. Add a labeled stub line for each credential to the env file (with a comment
   linking to where it's generated), so the user just types the value after `=`.
2. Open that env file in their editor.
3. Open a Chrome tab to the page where each credential is generated/found.

Credential(s) requested: **$ARGUMENTS**

If `$ARGUMENTS` is empty, ask the user which token/credential they need to set up,
then proceed.

---

## Step 1 — Resolve each credential to (KEY, URL)

For each token in the arguments (there may be several, space- or comma-separated):

- **KEY** = the conventional env var name in `UPPER_SNAKE_CASE`. If the user gave
  a formal name (`OPENAI_API_KEY`), use it verbatim. If they gave a description
  ("the telegram bot token", "supabase service role key"), map it to the standard
  name (`TELEGRAM_BOT_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`). Check `.env.example` /
  `.env.sample` first — match the project's existing naming if a stub is there.
- **URL** = the canonical page where the user generates or copies this credential.

Fast-path table for common credentials (use these directly; don't web-search them):

| Credential | URL |
|---|---|
| `OPENAI_API_KEY` | https://platform.openai.com/api-keys |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com/settings/keys |
| `GEMINI_API_KEY` / Google AI | https://aistudio.google.com/app/apikey |
| `GROQ_API_KEY` | https://console.groq.com/keys |
| `TELEGRAM_BOT_TOKEN` | https://t.me/BotFather |
| `GITHUB_TOKEN` (PAT) | https://github.com/settings/tokens |
| `STRIPE_SECRET_KEY` | https://dashboard.stripe.com/apikeys |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | https://supabase.com/dashboard/project/_/settings/api |
| `VERCEL_TOKEN` | https://vercel.com/account/tokens |
| `RESEND_API_KEY` | https://resend.com/api-keys |
| `CLERK_*` | https://dashboard.clerk.com/last-active?path=api-keys |
| `TWILIO_*` | https://console.twilio.com |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | https://console.aws.amazon.com/iam/home#/security_credentials |
| `HUGGINGFACE_TOKEN` / `HF_TOKEN` | https://huggingface.co/settings/tokens |
| `NOTION_TOKEN` | https://www.notion.so/my-integrations |

For anything **not** in the table, or if you're unsure of the current URL, use
`WebSearch` to find the official "create / generate API key" page (prefer the
vendor's own domain). For project-scoped dashboards (Supabase, Clerk, etc.), the
generic URL above is fine — the user picks their project once it loads. Don't
invent URLs; if you genuinely can't find one, tell the user and skip the browser
step for that credential.

## Step 2 — Locate (or create) the env file

Run from the project root (current working directory). Pick the target file:

- If `.env.local` exists → use it.
- Else if `.env` exists → use it.
- Else if the project is Next.js / Vite (a `next.config.*` or `vite.config.*`
  exists) → create `.env.local`.
- Else → create `.env`.

Make sure it's git-ignored. If a `.gitignore` exists in the repo and does not
already ignore the chosen env file, append the filename to `.gitignore` and
mention it. (Skip if there's no git repo.)

## Step 3 — Add the stub line(s)

For each (KEY, URL), only if `KEY=` is **not already present** in the env file,
append these two lines to the **end** of the file (preserve all existing
content — never clobber existing values):

```
# KEY — generate at <URL>
KEY=
```

If the key already exists with a value, leave it alone and note that in your
summary (the user may just want the page reopened). If it exists but is empty,
that's fine — don't duplicate it.

When creating a brand-new file, you may add a leading `# Environment variables`
header comment.

## Step 4 — Open the env file in the editor (auto-detect)

Run this single command (Cursor → VS Code → default text editor):

```bash
f="<absolute path to env file>"; if command -v cursor >/dev/null 2>&1; then cursor "$f"; elif command -v code >/dev/null 2>&1; then code "$f"; elif [ -d "/Applications/Cursor.app" ]; then open -a "Cursor" "$f"; elif [ -d "/Applications/Visual Studio Code.app" ]; then open -a "Visual Studio Code" "$f"; elif [ -n "$EDITOR" ]; then "$EDITOR" "$f"; else open -t "$f"; fi
```

## Step 5 — Open the generation page(s) in Chrome

For each resolved URL, run (Chrome if installed, else the default browser):

```bash
url="<URL>"; if [ -d "/Applications/Google Chrome.app" ]; then open -a "Google Chrome" "$url"; else open "$url"; fi
```

Open one tab per credential.

## Step 6 — Report

Tell the user, concisely:
- Which env file you opened (path) and which stub line(s) you added.
- Which page(s) you opened in Chrome and what to grab there.
- Reminder: paste each value after the `=`, save the file. Nothing was committed
  and no values were written by you.

Keep it short — they're about to go paste a token.
