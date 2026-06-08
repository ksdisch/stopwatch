// scripts/check-load-order.mjs — pure Node, no deps.
//
// In a no-build PWA the `<script src="js/*.js">` order in index.html IS the
// dependency graph (ADR-0001). CLAUDE.md mirrors that order in its
// "### Script Load Order" block and states the rule outright: "keep this
// block and index.html in lockstep". That block is hand-maintained, and
// CLAUDE.md is always-loaded context — so when it silently rots, every
// future session reasons from a stale dependency graph.
//
// The sibling check-asset-integrity.mjs already guards index.html <script>
// vs sw.js ASSETS (the offline-cache list). This check guards the THIRD
// hand-maintained list — the CLAUDE.md load-order chain — against the same
// index.html source of truth, comparing the FULL ORDERED SEQUENCE (not just
// the set), so a reorder is caught as well as an add/remove.
//
// It fails (exit 1) on any divergence, printing exactly what drifted:
// modules present on one side only, or the first position where the order
// disagrees. The fix is always one-directional: update the CLAUDE.md chain
// to match index.html (index.html is the runtime graph, CLAUDE.md describes
// it). No-op-safe: exits 1 only on real drift or an unparseable file.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

const indexHtml = readFileSync(resolve(REPO_ROOT, 'index.html'), 'utf8');
const claudeMd = readFileSync(resolve(REPO_ROOT, 'CLAUDE.md'), 'utf8');

// --- index.html: ordered js basenames from <script src="js/X.js"> (strip ?query) ---
const indexOrder = [];
const scriptRe = /<script\s+src="js\/([^"]+?)\.js(?:\?[^"]*)?"/g;
for (let m; (m = scriptRe.exec(indexHtml)); ) {
  indexOrder.push(m[1]);
}

// --- CLAUDE.md: the "→"-delimited chain in the first fenced block after the heading ---
const lines = claudeMd.split('\n');
const headingIdx = lines.findIndex((l) => l.trim() === '### Script Load Order');
if (headingIdx === -1) {
  console.error('[check-load-order] could not find "### Script Load Order" heading in CLAUDE.md — parser or file broken.');
  process.exit(1);
}
let open = headingIdx + 1;
while (open < lines.length && !lines[open].trimStart().startsWith('```')) open++;
if (open >= lines.length) {
  console.error('[check-load-order] no fenced code block after "### Script Load Order" in CLAUDE.md — parser or file broken.');
  process.exit(1);
}
let close = open + 1;
const bodyLines = [];
while (close < lines.length && !lines[close].trimStart().startsWith('```')) {
  bodyLines.push(lines[close]);
  close++;
}
if (close >= lines.length) {
  console.error('[check-load-order] unterminated fenced code block after "### Script Load Order" in CLAUDE.md.');
  process.exit(1);
}
const chainOrder = bodyLines
  .join('\n')
  .split('→')
  .map((s) => s.trim())
  .filter(Boolean);

if (indexOrder.length === 0) {
  console.error('[check-load-order] parsed ZERO <script src="js/*.js"> from index.html — parser or file broken.');
  process.exit(1);
}
if (chainOrder.length === 0) {
  console.error('[check-load-order] parsed ZERO modules from the CLAUDE.md load-order chain — parser or file broken.');
  process.exit(1);
}

const indexSet = new Set(indexOrder);
const chainSet = new Set(chainOrder);
const inChainNotIndex = chainOrder.filter((x) => !indexSet.has(x)).sort();
const inIndexNotChain = indexOrder.filter((x) => !chainSet.has(x)).sort();

// First position where the two ordered sequences disagree (only meaningful
// once the sets match — otherwise the set diff is the actionable signal).
let firstOrderDiff = -1;
const n = Math.min(chainOrder.length, indexOrder.length);
for (let k = 0; k < n; k++) {
  if (chainOrder[k] !== indexOrder[k]) {
    firstOrderDiff = k;
    break;
  }
}
const identical =
  chainOrder.length === indexOrder.length && firstOrderDiff === -1;

console.log(`[check-load-order] index.html <script> modules: ${indexOrder.length}`);
console.log(`[check-load-order] CLAUDE.md load-order chain:   ${chainOrder.length}`);

if (identical) {
  console.log('[check-load-order] OK — CLAUDE.md load-order chain == index.html <script> order.');
  process.exit(0);
}

console.error('\n[check-load-order] DRIFT — CLAUDE.md load-order chain and index.html <script> order disagree:');
if (inIndexNotChain.length) {
  console.error('\n  Loaded by index.html but MISSING from the CLAUDE.md chain:');
  for (const f of inIndexNotChain) console.error(`    - ${f}`);
}
if (inChainNotIndex.length) {
  console.error('\n  In the CLAUDE.md chain but NOT loaded by index.html (stale entry):');
  for (const f of inChainNotIndex) console.error(`    - ${f}`);
}
if (!inIndexNotChain.length && !inChainNotIndex.length && firstOrderDiff !== -1) {
  console.error(
    `\n  Same modules, different ORDER — first divergence at position ${firstOrderDiff + 1}:` +
      `\n    CLAUDE.md chain has: ${chainOrder[firstOrderDiff]}` +
      `\n    index.html has:     ${indexOrder[firstOrderDiff]}`
  );
}
console.error(
  '\n  Fix: update the "### Script Load Order" chain in CLAUDE.md to match the ' +
    'index.html <script> order exactly (index.html is the runtime dependency graph).'
);
process.exit(1);
