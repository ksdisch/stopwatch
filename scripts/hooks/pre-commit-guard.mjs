#!/usr/bin/env node
// scripts/hooks/pre-commit-guard.mjs — Claude Code PreToolUse(Bash) hook.
//
// Purpose: enforce the two mechanical invariants that make Tempo ship cleanly,
// at the exact moment Claude tries to commit — so a forgotten cache bump or a
// rotted asset list can never reach `main`:
//   1. scripts/check-sw-bump.mjs       — any changed cached web file requires a
//                                         sw.js CACHE_NAME bump in the same diff.
//   2. scripts/check-asset-integrity.mjs — sw.js ASSETS js-set must equal the
//                                         index.html <script src="js/*"> set.
//
// Wiring: .claude/settings.json registers this on PreToolUse with matcher "Bash".
// It reads the hook payload on stdin, runs ONLY when the Bash command is a
// `git commit`, and exits 2 (block + feed stderr back to Claude) if either
// check fails. Every other Bash command is a sub-millisecond no-op.
//
// Pure Node, no deps. Mirrors the no-op-on-no-git-context behavior of the
// underlying checks, so it is safe on a detached checkout or shallow clone.

import { execFileSync } from 'node:child_process';

function readStdin() {
  return new Promise((resolve) => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { raw += c; });
    process.stdin.on('end', () => resolve(raw));
    // If stdin never arrives (manual run), don't hang.
    setTimeout(() => resolve(raw), 250).unref?.();
  });
}

const raw = await readStdin();
let payload = {};
try { payload = JSON.parse(raw || '{}'); } catch { /* tolerate non-JSON */ }

const command = payload?.tool_input?.command ?? '';

// Gate on real git commits only. Matches `git commit`, `git -c x=y commit`,
// and `... && git commit ...`; ignores incidental mentions in strings/heredocs
// by anchoring to a command boundary.
const isCommit = /(?:^|[\n&|;])\s*git\s+(?:-\S+\s+)*commit\b/.test(command);
if (!isCommit) process.exit(0);

// Run hook logic from the project root the payload reports (falls back to the
// Claude-provided env var, then to process cwd).
const root = payload?.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
try { process.chdir(root); } catch { /* keep current cwd */ }

const CHECKS = [
  'scripts/check-sw-bump.mjs',
  'scripts/check-asset-integrity.mjs',
];

const failures = [];
for (const script of CHECKS) {
  try {
    execFileSync('node', [script], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const out = `${e.stdout?.toString() ?? ''}${e.stderr?.toString() ?? ''}`.trim();
    failures.push(`--- ${script} ---\n${out || '(no output; exited non-zero)'}`);
  }
}

if (failures.length) {
  process.stderr.write(
    `\nCommit blocked by Tempo pre-commit guard.\n\n${failures.join('\n\n')}\n\n` +
    `Fix the above — typically bump CACHE_NAME in sw.js (and update its ASSETS list) ` +
    `in this same commit — then retry. See CLAUDE.md "Service-worker cache bump rule".\n`,
  );
  process.exit(2); // PreToolUse: 2 = block the tool call, surface stderr to Claude.
}

process.exit(0);
