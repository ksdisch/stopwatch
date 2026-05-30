// scripts/check-asset-integrity.mjs — pure Node, no deps.
//
// The PWA's offline cache is a hand-maintained list: sw.js holds
// `const ASSETS = [ ... ]` (sw.js:2-77) enumerating every cached web file,
// while index.html loads the runtime via `<script src="js/*.js">` tags
// (index.html ~lines 1030-1119). Those two lists must agree for the js
// set: a script the page loads but sw.js doesn't cache breaks offline
// silently; a script cached but no longer loaded is dead weight (and a
// signal the asset list rotted).
//
// This check parses both, compares the js-file sets, and fails (exit 1)
// on any symmetric difference — printing exactly which files are on one
// side only. Query suffixes (e.g. `js/history.js?v=2` in index.html) are
// stripped before comparison; sw.js lists the same files as `./js/...`
// with no query.
//
// Known live finding (2026-05-30): index.html:1033 loads js/schema.js but
// it is ABSENT from sw.js ASSETS — a genuine pre-existing offline-cache
// gap this check surfaces. Bump sw.js's ASSETS (and CACHE_NAME) to close it.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

const indexHtml = readFileSync(resolve(REPO_ROOT, 'index.html'), 'utf8');
const swJs = readFileSync(resolve(REPO_ROOT, 'sw.js'), 'utf8');

// --- index.html: every <script src="js/....js"> (strip any ?query) ---
const indexSet = new Set();
const scriptRe = /<script\s+src="(js\/[^"]+?\.js)(?:\?[^"]*)?"/g;
for (let m; (m = scriptRe.exec(indexHtml)); ) {
  indexSet.add(m[1]);
}

// --- sw.js: every './js/....js' entry in the ASSETS array ---
const swSet = new Set();
const assetRe = /['"]\.\/(js\/[^'"]+?\.js)['"]/g;
for (let m; (m = assetRe.exec(swJs)); ) {
  swSet.add(m[1]);
}

if (indexSet.size === 0) {
  console.error('[check-assets] parsed ZERO <script src="js/*.js"> from index.html — parser or file broken.');
  process.exit(1);
}
if (swSet.size === 0) {
  console.error('[check-assets] parsed ZERO ./js/*.js from sw.js ASSETS — parser or file broken.');
  process.exit(1);
}

const inIndexNotSw = [...indexSet].filter((f) => !swSet.has(f)).sort();
const inSwNotIndex = [...swSet].filter((f) => !indexSet.has(f)).sort();

console.log(`[check-assets] index.html js scripts: ${indexSet.size}`);
console.log(`[check-assets] sw.js ASSETS js files: ${swSet.size}`);

if (inIndexNotSw.length === 0 && inSwNotIndex.length === 0) {
  console.log('[check-assets] OK — index.html <script> set == sw.js ASSETS js set.');
  process.exit(0);
}

console.error('\n[check-assets] MISMATCH — offline cache and runtime script list disagree:');
if (inIndexNotSw.length) {
  console.error('\n  Loaded by index.html but NOT cached in sw.js ASSETS (breaks offline):');
  for (const f of inIndexNotSw) console.error(`    - ${f}`);
}
if (inSwNotIndex.length) {
  console.error('\n  Cached in sw.js ASSETS but NOT loaded by index.html (stale entry):');
  for (const f of inSwNotIndex) console.error(`    - ${f}`);
}
console.error(
  '\n  Fix: reconcile the sw.js ASSETS list with the index.html <script> tags ' +
    '(and bump CACHE_NAME).'
);
process.exit(1);
