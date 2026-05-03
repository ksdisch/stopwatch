#!/usr/bin/env node
// Mirror the static web app from the repo root into ./www/ for Capacitor.
// The repo root is what GitHub Pages serves; ./www/ is what `cap copy` sees.
// Keep these two outputs identical — only the asset folders below get copied.

import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const out = join(root, 'www');

const FILES = ['index.html', 'manifest.json', 'sw.js'];
const DIRS = ['css', 'js', 'icons'];

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const f of FILES) {
  const src = join(root, f);
  if (!existsSync(src)) {
    console.error(`[sync-www] missing file: ${f}`);
    process.exit(1);
  }
  await cp(src, join(out, f));
}

for (const d of DIRS) {
  const src = join(root, d);
  if (!existsSync(src)) {
    console.error(`[sync-www] missing dir: ${d}`);
    process.exit(1);
  }
  await cp(src, join(out, d), { recursive: true });
}

console.log(`[sync-www] wrote ${out}`);
