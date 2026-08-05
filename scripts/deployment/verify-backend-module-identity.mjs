#!/usr/bin/env node
/**
 * Apex OS — backend module identity verifier.
 *
 * Proves that backend code and future repository-root platform code resolve
 * the SAME physical package installation for every dependency whose identity
 * Nest and Prisma depend on.
 *
 * WHY THIS EXISTS
 * ---------------
 * Node resolves packages by walking ancestor node_modules directories. If
 * both <root>/node_modules and backend/node_modules exist:
 *
 *   backend/dist/main.js          -> backend/node_modules/@nestjs/common
 *   platforms/**\/*.js            -> <root>/node_modules/@nestjs/common
 *
 * Those are two different physical copies, so `Injectable` is two different
 * classes and the reflect-metadata keys do not match. Nest dependency
 * injection then fails AT RUNTIME even though the TypeScript build passed.
 * The same split applied to @prisma/client yields two PrismaClient
 * constructors and two generated clients.
 *
 * This verifier makes that failure mode a build-time error.
 *
 * Node built-ins only. Does not instantiate PrismaClient. Does not connect to
 * a database. Never prints environment variable values.
 *
 * Exit 0 = one identity per package from every location. Exit 1 = split.
 */

import { createRequire } from 'node:module';
import { existsSync, realpathSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Packages whose class identity must be singular for Nest/Prisma to work. */
const PACKAGES = [
  '@nestjs/common',
  '@nestjs/core',
  'reflect-metadata',
  'rxjs',
  '@prisma/client',
];

/**
 * Logical source locations that must agree.
 *
 * The platform location is SYNTHETIC — platforms/business/sales-crm/leads/
 * backend/ does not exist yet (its backend slice is deferred). Node's
 * createRequire only needs a path to anchor the ancestor walk; the file need
 * not exist. That lets this verifier prove the future layout without creating
 * repository files.
 */
const LOCATIONS = [
  { name: 'repository root', file: join(REPO_ROOT, 'index.js'), synthetic: false },
  { name: 'backend/', file: join(REPO_ROOT, 'backend', 'index.js'), synthetic: false },
  {
    name: 'platforms/business/sales-crm/leads/backend/ (synthetic)',
    file: join(REPO_ROOT, 'platforms', 'business', 'sales-crm', 'leads', 'backend', 'index.js'),
    synthetic: true,
  },
];

const rel = (p) => relative(REPO_ROOT, p) || '.';

/** Resolve a package's entry point from a location, normalized via realpath. */
function resolveFrom(locationFile, pkg) {
  try {
    const req = createRequire(locationFile);
    return { ok: true, path: realpathSync(req.resolve(pkg)) };
  } catch (err) {
    return { ok: false, error: err.code || err.message.split('\n')[0] };
  }
}

/**
 * The node_modules root that owns a resolved path, e.g.
 *   <repo>/node_modules/@nestjs/common/index.js -> <repo>/node_modules
 *   <repo>/backend/node_modules/rxjs/index.js   -> <repo>/backend/node_modules
 */
function owningNodeModules(resolvedPath) {
  const marker = `${sep}node_modules${sep}`;
  const idx = resolvedPath.lastIndexOf(marker);
  if (idx === -1) return null;
  return resolvedPath.slice(0, idx + marker.length - 1);
}

console.log('[identity] repository root:', REPO_ROOT);
console.log('[identity] proving one physical package identity per dependency');
console.log('');

let failed = 0;
const problems = [];

/**
 * Installed package directories inside a node_modules tree.
 *
 * Dot-entries are ignored on purpose. A correct hoisted install still leaves
 * backend/node_modules/.cache/prisma behind — backend's postinstall runs
 * `prisma generate` with cwd=backend and Prisma caches query engines relative
 * to cwd. That is a binary cache, not a resolution source. Only a real package
 * directory captures a bare specifier ahead of the repository root.
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

// ── structural precondition ─────────────────────────────────────────────────
// A backend-local install is the direct cause of split identity. Flag it first
// so the diagnosis is obvious rather than inferred from five package failures.
const backendPackages = installedPackages(join(REPO_ROOT, 'backend', 'node_modules'));
if (backendPackages.length > 0) {
  const shown = backendPackages.slice(0, 8).join(', ');
  const more = backendPackages.length > 8 ? `, +${backendPackages.length - 8} more` : '';
  console.error(`  FAIL  backend/node_modules installs no packages`);
  console.error(`          ${backendPackages.length} installed: ${shown}${more}`);
  console.error('          A backend-local install captures backend resolution and splits');
  console.error('          package identity from repository-root platform code.');
  console.error('          Install once at the repository root: npm ci --include=dev');
  console.error('');
  failed += 1;
  problems.push(`${backendPackages.length} package(s) under backend/node_modules`);
} else {
  console.log('  PASS  backend/node_modules installs no packages (no resolution capture)');
  console.log('');
}

// ── per-package identity ────────────────────────────────────────────────────
for (const pkg of PACKAGES) {
  const resolutions = LOCATIONS.map((loc) => ({ loc, res: resolveFrom(loc.file, pkg) }));

  const unresolved = resolutions.filter((r) => !r.res.ok);
  if (unresolved.length > 0) {
    console.error(`  FAIL  ${pkg}`);
    for (const u of unresolved) {
      console.error(`          unresolved from ${u.loc.name}: ${u.res.error}`);
    }
    failed += 1;
    problems.push(`${pkg} unresolved`);
    continue;
  }

  const paths = resolutions.map((r) => r.res.path);
  const distinct = [...new Set(paths)];
  const owners = [...new Set(paths.map(owningNodeModules).filter(Boolean))];

  if (distinct.length === 1) {
    console.log(`  PASS  ${pkg}`);
    console.log(`          single identity: ${rel(distinct[0])}`);
  } else {
    console.error(`  FAIL  ${pkg} — ${distinct.length} distinct physical installations`);
    for (const { loc, res } of resolutions) {
      console.error(`          ${loc.name}`);
      console.error(`            -> ${rel(res.path)}`);
    }
    console.error(`          owning node_modules roots: ${owners.map(rel).join(', ')}`);
    failed += 1;
    problems.push(`${pkg} split across ${distinct.length} installs`);
  }

  // @prisma/client additionally must map to a single generated client root.
  if (pkg === '@prisma/client') {
    const generatedRoots = [...new Set(
      owners.map((o) => join(o, '.prisma', 'client')).filter((p) => existsSync(p)),
    )];
    if (generatedRoots.length > 1) {
      console.error(`  FAIL  @prisma/client — ${generatedRoots.length} generated client roots`);
      for (const g of generatedRoots) console.error(`          ${rel(g)}`);
      console.error('          The build could generate one client while runtime imports another.');
      failed += 1;
      problems.push('multiple generated Prisma clients');
    } else if (generatedRoots.length === 1) {
      console.log(`          generated client: ${rel(generatedRoots[0])}`);
    } else {
      console.log('          generated client: not yet generated (run prisma generate)');
    }
  }
  console.log('');
}

// ── report ──────────────────────────────────────────────────────────────────
if (failed === 0) {
  console.log('[identity] OK — every dependency resolves to one physical installation');
  console.log('[identity] from repository root, backend/, and the future platform location');
  process.exit(0);
}

console.error(`[identity] ${failed} identity problem(s): ${problems.join('; ')}`);
console.error('[identity] Nest DI and Prisma would fail at RUNTIME despite a green build.');
console.error('[identity] See docs/operations/BACKEND_REPOSITORY_ROOT_DEPLOYMENT.md');
process.exit(1);
