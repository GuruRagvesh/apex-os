#!/usr/bin/env node
/**
 * Apex OS architecture boundary validator.
 *
 * Scans the new architecture roots (apps/, platforms/, database/, shared/) and
 * reports imports that violate the dependency rules in
 * architecture-boundaries.json.
 *
 * Phase 0: frontend/, backend/ and e2e/ are legacy-active roots serving
 * production and are deliberately NOT scanned. They enter enforcement as their
 * modules migrate.
 *
 * Node built-ins only. No dependencies, no install step.
 *
 * Exit 0 = clean. Exit 1 = violations found.
 *
 * Usage:
 *   node scripts/architecture/validate-boundaries.mjs [--root <dir>] [--json]
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname, sep, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(__dirname, '..', '..');

// ── argument parsing ────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { root: DEFAULT_ROOT, json: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--root' && argv[i + 1]) {
      args.root = resolve(argv[i + 1]);
      i += 1;
    } else if (argv[i] === '--json') {
      args.json = true;
    }
  }
  return args;
}

// ── config ──────────────────────────────────────────────────────────────────
function loadConfig(root) {
  const configPath = join(root, 'architecture-boundaries.json');
  if (!existsSync(configPath)) {
    throw new Error(`architecture-boundaries.json not found at ${configPath}`);
  }
  return JSON.parse(readFileSync(configPath, 'utf8'));
}

// ── file discovery ──────────────────────────────────────────────────────────
function collectFiles(root, config) {
  const { extensions, ignoreDirectories, ignoreFilePatterns } = config.scan;
  const ignoreDirs = new Set(ignoreDirectories);
  const out = [];

  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (ignoreDirs.has(entry)) continue;
        walk(full);
      } else if (st.isFile()) {
        if (ignoreFilePatterns.some((p) => entry.endsWith(p))) continue;
        if (extensions.some((e) => entry.endsWith(e))) out.push(full);
      }
    }
  }

  for (const enforced of config.enforcedRoots) {
    const dir = join(root, enforced);
    if (existsSync(dir)) walk(dir);
  }
  return out;
}

// ── import extraction ───────────────────────────────────────────────────────
// Handles: static import, export-from, dynamic import(), require().
const IMPORT_PATTERNS = [
  /\bimport\s+[^'"();]*?\bfrom\s*['"]([^'"]+)['"]/g, // import x from 'y'
  /\bimport\s*['"]([^'"]+)['"]/g,                     // import 'y'
  /\bexport\s+[^'"();]*?\bfrom\s*['"]([^'"]+)['"]/g,  // export … from 'y'
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,           // import('y')
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,          // require('y')
];

function stripComments(source) {
  // Remove block and line comments so commented-out imports are not flagged.
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function extractImports(source) {
  const clean = stripComments(source);
  const specifiers = new Set();
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(clean)) !== null) {
      if (match[1]) specifiers.add(match[1]);
    }
  }
  return [...specifiers];
}

// ── path resolution ─────────────────────────────────────────────────────────
function toPosix(p) {
  return p.split(sep).join(posix.sep);
}

/**
 * Resolve an import specifier to a repo-relative posix path, or null when the
 * specifier is external (a bare package) or otherwise not analysable.
 */
function resolveSpecifier(specifier, fileRel, aliasMap) {
  // Legacy frontend alias: '@/x' resolves to 'frontend/x'. Resolved so that
  // platforms/** -> frontend/** imports are VISIBLE to the rules below rather
  // than silently skipped as if they were external packages.
  if (specifier.startsWith('@/')) {
    return `frontend/${specifier.slice(2)}`;
  }

  // Alias form: @apex/<layer>/...
  for (const [prefix, target] of Object.entries(aliasMap)) {
    if (specifier === prefix || specifier.startsWith(`${prefix}/`)) {
      const rest = specifier.slice(prefix.length).replace(/^\//, '');
      return rest ? `${target}/${rest}` : target;
    }
  }

  // Relative form
  if (specifier.startsWith('.')) {
    const resolved = posix.normalize(posix.join(posix.dirname(fileRel), specifier));
    return resolved.startsWith('..') ? null : resolved;
  }

  // Root-absolute form used by some tsconfig setups: 'platforms/...', 'shared/...'
  const firstSegment = specifier.split('/')[0];
  if (['apps', 'platforms', 'database', 'shared'].includes(firstSegment)) {
    return specifier;
  }

  // Bare package or unresolvable — not our concern.
  return null;
}

function buildAliasMap(config) {
  const map = {
    '@apex/apps': 'apps',
    '@apex/platforms': 'platforms',
    '@apex/database': 'database',
    '@apex/shared': 'shared',
  };
  for (const platform of config.platforms) {
    map[`@apex/${platform}`] = `platforms/${platform}`;
  }
  return map;
}

// ── classification ──────────────────────────────────────────────────────────
function layerOf(pathRel) {
  return pathRel.split('/')[0] || null;
}

/**
 * Component root for a platforms path, e.g.
 * platforms/workforce/attendance/workday/backend/x.ts
 *   → platforms/workforce/attendance/workday
 * Returns null when the path is not deep enough to be inside a component.
 */
function componentRootOf(pathRel, depth) {
  const parts = pathRel.split('/');
  if (parts[0] !== 'platforms') return null;
  if (parts.length < depth + 2) return null; // need platform/module/component + something
  return parts.slice(0, depth + 1).join('/');
}

function segmentsOf(pathRel) {
  return pathRel.split('/');
}

// ── legacy-import exemptions ────────────────────────────────────────────────
/**
 * platforms/** -> frontend/** is forbidden by default. A migration phase may
 * carry a narrow, temporary, per-component exemption declared in
 * architecture-boundaries.json. Returns the matching exemption or null.
 *
 * An exemption matches only when BOTH the importing file is inside the named
 * component AND the target is inside one of that exemption's allowed paths.
 */
function findLegacyExemption(fileRel, targetRel, config) {
  const legacy = config.legacyFrontendImports;
  if (!legacy || !Array.isArray(legacy.exceptions)) return null;

  for (const exception of legacy.exceptions) {
    if (!fileRel.startsWith(exception.from)) continue;
    for (const allowed of exception.allowedTargets) {
      let isMatch;
      if (allowed.endsWith('/')) {
        // Directory prefix.
        isMatch = targetRel.startsWith(allowed);
      } else {
        // Exact file. Import specifiers are usually extensionless
        // ('@/lib/api' -> 'frontend/lib/api'), so match both directions.
        isMatch =
          targetRel === allowed ||
          targetRel.startsWith(`${allowed}.`) ||
          allowed.startsWith(`${targetRel}.`);
      }
      if (isMatch) return exception;
    }
  }
  return null;
}

// ── rule evaluation ─────────────────────────────────────────────────────────
function checkFile(fileRel, source, config, aliasMap) {
  const violations = [];
  const debts = [];
  const fromLayer = layerOf(fileRel);
  const fromSegments = segmentsOf(fileRel);
  const componentDepth = 3; // platform/module/component
  const internalSegments = ['frontend', 'backend', 'shared', 'tests'];
  const publicNames = config.publicEntryPoints.filenames;

  const fromIsFrontend = fromSegments.includes('frontend');
  const fromIsBackend = fromSegments.includes('backend');
  const fromComponent = componentRootOf(fileRel, componentDepth);

  for (const specifier of extractImports(source)) {
    const targetRel = resolveSpecifier(specifier, fileRel, aliasMap);
    if (!targetRel) continue; // external package

    const toLayer = layerOf(targetRel);
    const toSegments = segmentsOf(targetRel);

    const add = (ruleId, message) =>
      violations.push({ file: fileRel, specifier, resolved: targetRel, rule: ruleId, message });

    // 0. platforms/ importing the legacy application roots.
    //    frontend/ may be allowed by a narrow, temporary, per-component
    //    exemption. backend/ never is.
    if (fromLayer === 'platforms' && (toLayer === 'frontend' || toLayer === 'backend')) {
      if (toLayer === 'backend') {
        add(
          'platforms-no-legacy-backend',
          'platforms/ must not import backend/. There is no exemption mechanism for this.',
        );
        continue;
      }
      const exemption = findLegacyExemption(fileRel, targetRel, config);
      if (!exemption) {
        add(
          'platforms-no-legacy-frontend',
          'platforms/ must not import frontend/. If this is a migration-phase dependency, it needs an explicit narrow exemption in architecture-boundaries.json.',
        );
      } else {
        // Allowed, but deliberately surfaced as tracked debt rather than
        // passing silently.
        debts.push({ file: fileRel, specifier, resolved: targetRel, id: exemption.id });
      }
      continue;
    }

    // 1. frontend must not import backend
    if (fromIsFrontend && toSegments.includes('backend')) {
      add('frontend-no-backend', 'Frontend code must not import backend code.');
      continue;
    }

    // 2. backend must not import frontend
    if (fromIsBackend && toSegments.includes('frontend')) {
      add('backend-no-frontend', 'Backend code must not import frontend code.');
      continue;
    }

    // 3. shared must not import apps or platforms
    if (fromLayer === 'shared' && (toLayer === 'apps' || toLayer === 'platforms')) {
      add('shared-no-platforms', `shared/ must not import ${toLayer}/.`);
      continue;
    }

    // 4. database must not import apps, platforms or shared
    if (fromLayer === 'database' && ['apps', 'platforms', 'shared'].includes(toLayer)) {
      add('database-no-upper-layers', `database/ must not import ${toLayer}/.`);
      continue;
    }

    // 5. platforms must not import apps
    if (fromLayer === 'platforms' && toLayer === 'apps') {
      add('platforms-no-apps', 'platforms/ must not import apps/.');
      continue;
    }

    // 6. an app must not import another app's internals
    if (fromLayer === 'apps' && toLayer === 'apps') {
      const fromApp = fromSegments[1];
      const toApp = toSegments[1];
      if (fromApp && toApp && fromApp !== toApp) {
        add('app-internal-isolation', `apps/${fromApp} must not import apps/${toApp} internals.`);
        continue;
      }
    }

    // 7. cross-component imports must use the public entry point
    if (toLayer === 'platforms') {
      const toComponent = componentRootOf(targetRel, componentDepth);
      if (toComponent && toComponent !== fromComponent) {
        const remainder = targetRel.slice(toComponent.length).replace(/^\//, '');
        const isPublic = remainder === '' || publicNames.includes(remainder);
        const reachesInternal = internalSegments.includes(remainder.split('/')[0]);
        if (!isPublic && reachesInternal) {
          add(
            'component-public-entry',
            `Cross-component import must use the public entry point of ${toComponent}, not its internal ${remainder.split('/')[0]}/ folder.`,
          );
          continue;
        }
        if (!isPublic && remainder !== '') {
          add(
            'component-public-entry',
            `Cross-component import must target ${toComponent} or its index file, not ${remainder}.`,
          );
        }
      }
    }
  }

  return { violations, debts };
}

// ── main ────────────────────────────────────────────────────────────────────
function main() {
  const args = parseArgs(process.argv);
  let config;
  try {
    config = loadConfig(args.root);
  } catch (err) {
    console.error(`[architecture] ${err.message}`);
    process.exit(1);
  }

  const aliasMap = buildAliasMap(config);
  const files = collectFiles(args.root, config);
  const violations = [];
  const debts = [];

  for (const abs of files) {
    const rel = toPosix(relative(args.root, abs));
    let source;
    try {
      source = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const result = checkFile(rel, source, config, aliasMap);
    violations.push(...result.violations);
    debts.push(...result.debts);
  }

  if (args.json) {
    console.log(JSON.stringify({ scanned: files.length, violations, debts }, null, 2));
    process.exit(violations.length === 0 ? 0 : 1);
  }

  console.log(`[architecture] scanned ${files.length} file(s) in ${config.enforcedRoots.join(', ')}`);
  console.log(`[architecture] legacy-active roots not yet enforced: ${config.legacyActiveRoots.roots.join(', ')}`);

  if (debts.length > 0) {
    const byId = new Map();
    for (const d of debts) byId.set(d.id, (byId.get(d.id) ?? 0) + 1);
    console.log('');
    console.log(`[architecture] ${debts.length} allowlisted legacy import(s) — tracked migration debt, not clean:`);
    for (const [id, count] of byId) {
      const ex = (config.legacyFrontendImports?.exceptions ?? []).find((e) => e.id === id);
      console.log(`  ${id}  (${count} import(s))`);
      if (ex) console.log(`    removal phase: ${ex.removalPhase}`);
    }
  }

  if (violations.length === 0) {
    console.log('');
    console.log('[architecture] OK — no boundary violations found.');
    process.exit(0);
  }

  console.error(`\n[architecture] ${violations.length} boundary violation(s):\n`);
  for (const v of violations) {
    console.error(`  ${v.file}`);
    console.error(`    imports : ${v.specifier}`);
    console.error(`    resolved: ${v.resolved}`);
    console.error(`    rule    : ${v.rule}`);
    console.error(`    reason  : ${v.message}\n`);
  }
  console.error('See docs/architecture/PUBLIC_API_CONVENTIONS.md');
  process.exit(1);
}

main();
