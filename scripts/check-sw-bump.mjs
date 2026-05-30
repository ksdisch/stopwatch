// scripts/check-sw-bump.mjs — pure Node, no deps.
//
// The PWA is cache-first. A user only sees changed web files after the
// service-worker cache key rotates: `const CACHE_NAME = '...'` (sw.js:1).
// The project rule (CLAUDE.md "Service worker cache bump rule"): ANY PR
// that ships a change to a cached web file MUST bump CACHE_NAME in the
// same PR — otherwise installed clients serve stale content until the old
// SW expires. This check enforces that rule mechanically.
//
// Logic: diff the working ref against a base ref (env BASE_REF, else argv[2],
// else origin/main). If any cached web file changed
//   - index.html
//   - manifest.json
//   - sw.js
//   - css/*.css
//   - js/*.js
// then require that the CACHE_NAME line in sw.js ALSO appears changed in
// the diff. Missing bump => exit 1 with a pointed message.
//
// No-op (exit 0) when there is no usable git context (not a repo, or the
// base ref can't be resolved) — so the script is safe to run locally on a
// detached checkout or a shallow clone without the base fetched.

import { execFileSync } from 'node:child_process';

const BASE_REF = process.env.BASE_REF || process.argv[2] || 'origin/main';

const CACHED_GLOBS = [
  /^index\.html$/,
  /^manifest\.json$/,
  /^sw\.js$/,
  /^css\/[^/]+\.css$/,
  /^js\/[^/]+\.js$/,
];

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

function tryGit(args) {
  try {
    return { ok: true, out: git(args) };
  } catch (err) {
    return { ok: false, err };
  }
}

// --- Guard: must be inside a git work tree ---
const insideRepo = tryGit(['rev-parse', '--is-inside-work-tree']);
if (!insideRepo.ok || insideRepo.out.trim() !== 'true') {
  console.log('[check-sw-bump] not a git work tree — skipping (no-op).');
  process.exit(0);
}

// --- Guard: base ref must resolve ---
const baseResolved = tryGit(['rev-parse', '--verify', `${BASE_REF}^{commit}`]);
if (!baseResolved.ok) {
  console.log(`[check-sw-bump] base ref "${BASE_REF}" not found — skipping (no-op).`);
  console.log('  (fetch the base, or pass BASE_REF/argv; CI uses fetch-depth: 0.)');
  process.exit(0);
}

// --- Files changed vs base ---
const nameDiff = tryGit(['diff', '--name-only', `${BASE_REF}...HEAD`]);
if (!nameDiff.ok) {
  console.log(`[check-sw-bump] could not diff against "${BASE_REF}" — skipping (no-op).`);
  process.exit(0);
}

const changedFiles = nameDiff.out.split('\n').map((s) => s.trim()).filter(Boolean);
const changedCached = changedFiles.filter((f) => CACHED_GLOBS.some((re) => re.test(f)));

if (changedCached.length === 0) {
  console.log('[check-sw-bump] OK — no cached web file changed vs ' + BASE_REF + '; CACHE_NAME bump not required.');
  process.exit(0);
}

console.log('[check-sw-bump] cached web file(s) changed vs ' + BASE_REF + ':');
for (const f of changedCached) console.log(`    - ${f}`);

// --- Did the CACHE_NAME line change in the diff? ---
const swDiff = tryGit(['diff', `${BASE_REF}...HEAD`, '--', 'sw.js']);
const swDiffText = swDiff.ok ? swDiff.out : '';
// A bump shows up as a changed (added) line touching CACHE_NAME.
const bumped = /^\+.*\bCACHE_NAME\b/m.test(swDiffText);

if (bumped) {
  console.log('[check-sw-bump] OK — CACHE_NAME was bumped in sw.js.');
  process.exit(0);
}

console.error(
  '\n[check-sw-bump] FAIL — a cached web file changed but sw.js CACHE_NAME was NOT bumped.\n' +
    '  Installed clients will serve stale content until the old SW expires.\n' +
    "  Fix: bump the CACHE_NAME string in sw.js (sw.js:1) in this same PR."
);
process.exit(1);
