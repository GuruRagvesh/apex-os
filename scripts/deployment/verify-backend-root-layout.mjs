#!/usr/bin/env node
/**
 * Apex OS — repository-root backend deployment layout verifier.
 *
 * Asserts the filesystem invariants a repository-root Render deployment
 * depends on. Node built-ins only: no dependencies, no install step, no
 * database connection, no application bootstrap.
 *
 * WHY THIS EXISTS
 * ---------------
 * Render's Root Directory currently hides repository siblings from the
 * backend service. A repository-root deployment fixes that, but only if
 * dependencies are installed ONCE at the repository root. An install inside
 * backend/ recreates backend/node_modules, which re-splits package identity
 * and breaks Nest dependency injection at runtime — after a green build.
 *
 * This script fails the build early rather than letting that reach runtime.
 *
 * MODES
 *   --prebuild    run after install, before the backend build.
 *                 Does not require backend/dist/main.js.
 *   --postbuild   run after the backend build.
 *                 Requires backend/dist/main.js.
 *
 * Exit 0 = all invariants hold. Exit 1 = at least one violated.
 *
 * Never prints environment variable values.
 */

import { existsSync, statSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ── mode ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const wantsPre = argv.includes('--prebuild');
const wantsPost = argv.includes('--postbuild');

if (wantsPre && wantsPost) {
  console.error('[layout] --prebuild and --postbuild are mutually exclusive.');
  process.exit(1);
}
if (!wantsPre && !wantsPost) {
  console.error('[layout] A mode is required: --prebuild or --postbuild.');
  console.error('[layout] Refusing to run with an implicit mode — checks must not be silently skipped.');
  process.exit(1);
}
const MODE = wantsPost ? 'postbuild' : 'prebuild';

// ── check harness ───────────────────────────────────────────────────────────
const results = [];

function record(ok, label, detail) {
  results.push({ ok, label, detail });
}

function mustExist(relPath, label, kind = 'any') {
  const abs = join(REPO_ROOT, relPath);
  if (!existsSync(abs)) return record(false, label, `missing: ${relPath}`);
  if (kind !== 'any') {
    const st = statSync(abs);
    const actual = st.isDirectory() ? 'dir' : 'file';
    if (actual !== kind) return record(false, label, `expected ${kind}, found ${actual}: ${relPath}`);
  }
  record(true, label, relPath);
}

function mustNotExist(relPath, label, why) {
  const abs = join(REPO_ROOT, relPath);
  if (existsSync(abs)) return record(false, label, `present but must not be: ${relPath} — ${why}`);
  record(true, label, `absent: ${relPath}`);
}

/**
 * Installed package directories inside a node_modules tree.
 *
 * Dot-entries are deliberately ignored. A correct hoisted install still leaves
 * backend/node_modules/.cache/prisma behind, because backend's postinstall runs
 * `prisma generate` with cwd=backend and Prisma caches its query engines
 * relative to cwd. That directory is a binary cache, not a resolution source —
 * Node never resolves a bare specifier into it. Likewise .bin holds shims.
 *
 * What actually breaks identity is a real package directory here, because that
 * WOULD capture backend's resolution ahead of the repository root.
 */
function installedPackages(nodeModulesAbs) {
  if (!existsSync(nodeModulesAbs)) return [];
  const packages = [];
  for (const entry of readdirSync(nodeModulesAbs)) {
    if (entry.startsWith('.')) continue;
    if (entry.startsWith('@')) {
      const scopeDir = join(nodeModulesAbs, entry);
      if (statSync(scopeDir).isDirectory()) {
        for (const scoped of readdirSync(scopeDir)) packages.push(`${entry}/${scoped}`);
      }
      continue;
    }
    packages.push(entry);
  }
  return packages;
}

// ── invariants ──────────────────────────────────────────────────────────────
console.log(`[layout] mode: ${MODE}`);
console.log(`[layout] repository root: ${REPO_ROOT}`);
console.log('');

// 1-3: manifests present
mustExist('package.json', 'repository root package.json exists', 'file');
mustExist('package-lock.json', 'root package-lock.json exists (authoritative install)', 'file');
mustExist('backend/package.json', 'backend/package.json exists', 'file');

// 4-5: the two invariants that protect package identity
mustNotExist(
  'backend/package-lock.json',
  'backend/package-lock.json does NOT exist',
  'the root lockfile is authoritative; a backend lockfile would fork dependency resolution',
);
// Not "must not exist" — see installedPackages(). The invariant is that it
// installs nothing, because an installed package there captures resolution.
{
  const backendPackages = installedPackages(join(REPO_ROOT, 'backend', 'node_modules'));
  if (backendPackages.length === 0) {
    record(true, 'backend/node_modules installs no packages', 'no backend-local resolution capture');
  } else {
    const shown = backendPackages.slice(0, 8).join(', ');
    const more = backendPackages.length > 8 ? `, +${backendPackages.length - 8} more` : '';
    record(
      false,
      'backend/node_modules installs no packages',
      `${backendPackages.length} package(s) installed under backend/node_modules (${shown}${more}) — ` +
        'a backend-local install splits Nest/Prisma class identity and breaks DI at runtime. ' +
        'Install once at the repository root: npm ci --include=dev',
    );
  }
}

// 6: hoisted install present
mustExist('node_modules', 'root node_modules exists (hoisted workspace install)', 'dir');

// 7: the declaration that makes hoisting happen at all. Without backend in
// workspaces, a root install would not install backend's dependencies and
// every identity guarantee below is vacuous.
{
  const label = 'root package.json declares the backend workspace';
  try {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
    const workspaces = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages;
    if (Array.isArray(workspaces) && workspaces.includes('backend')) {
      record(true, label, `workspaces: ${workspaces.join(', ')}`);
    } else {
      record(false, label, `"backend" missing from workspaces: ${JSON.stringify(workspaces ?? null)}`);
    }
  } catch (err) {
    record(false, label, `could not parse root package.json: ${err.message}`);
  }
}

// 7: bootstrap artifact — postbuild only
if (MODE === 'postbuild') {
  mustExist('backend/dist/main.js', 'backend/dist/main.js exists (bootstrap preserved)', 'file');
} else {
  console.log('[layout] skipping backend/dist/main.js — not expected before build (--prebuild)');
  console.log('');
}

// 8: Prisma schema at its CWD-dependent location
mustExist('backend/prisma/schema.prisma', 'backend/prisma/schema.prisma exists', 'file');

// 9: repository siblings visible — the entire point of the root deployment
for (const dir of ['platforms', 'shared', 'database']) {
  mustExist(dir, `${dir}/ visible from repository root`, 'dir');
}

// ── report ──────────────────────────────────────────────────────────────────
let failed = 0;
for (const r of results) {
  if (r.ok) {
    console.log(`  PASS  ${r.label}`);
  } else {
    console.error(`  FAIL  ${r.label}`);
    console.error(`          ${r.detail}`);
    failed += 1;
  }
}

console.log('');
console.log(`[layout] ${results.length - failed} passed, ${failed} failed`);

if (failed > 0) {
  console.error('');
  console.error('[layout] Deployment layout invariant violated.');
  console.error('[layout] See docs/operations/BACKEND_REPOSITORY_ROOT_DEPLOYMENT.md');
  process.exit(1);
}
process.exit(0);
