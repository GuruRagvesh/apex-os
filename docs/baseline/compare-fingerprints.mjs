#!/usr/bin/env node
// Lists frontend-side files that changed, appeared or disappeared since the
// baseline in docs/baseline/frontend-fingerprints.json. Read-only.
// Run from the repo root: node docs/baseline/compare-fingerprints.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const base = JSON.parse(fs.readFileSync('docs/baseline/frontend-fingerprints.json', 'utf8'));
const walk = (d, o = []) => {
  if (!fs.existsSync(d)) return o;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', '.next', 'dist'].includes(e.name)) continue;
    const p = path.join(d, e.name);
    e.isDirectory() ? walk(p, o) : o.push(p.split(path.sep).join('/'));
  }
  return o;
};
const now = [...walk('frontend'), ...walk('shared'), ...walk('apps/web'),
  ...walk('platforms').filter((f) => !f.includes('/backend/'))]
  .filter((f) => /\.(tsx?|css|js|mjs|json)$/.test(f));
const hash = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex').slice(0, 16);
const cur = Object.fromEntries(now.map((f) => [f, hash(f)]));
const changed = Object.keys(cur).filter((f) => base.files[f] && base.files[f] !== cur[f]);
const added = Object.keys(cur).filter((f) => !base.files[f]);
const removed = Object.keys(base.files).filter((f) => !cur[f]);
console.log(`Baseline ${base.commit.slice(0, 7)}: ${changed.length} changed, ${added.length} added, ${removed.length} removed`);
for (const [label, list] of [['changed', changed], ['added', added], ['removed', removed]])
  for (const f of list.sort()) console.log(`${label.padEnd(8)} ${f}`);
