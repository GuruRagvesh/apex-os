#!/usr/bin/env node
/**
 * Apex OS — API response contract verifier.
 *
 * WHY THIS EXISTS
 * ---------------
 * The shared authenticated client installs a response interceptor:
 *
 *   api.interceptors.response.use((response) => response.data, ...)
 *
 * so `await api.get(...)` already resolves to the response BODY, not an
 * AxiosResponse. Reading `.data` off it a second time yields `undefined`.
 *
 * That is not a theoretical hazard. Every function in the attendance frontend
 * did exactly this, so every attendance API call resolved to `undefined`. The
 * visible symptom was that `punchEnabled` was permanently false -- the server
 * answered `{"enabled": true}`, the client read `undefined?.enabled`, and
 * WorkdayBar took the legacy Workday path with no punch evidence. Nothing
 * failed loudly; typecheck passed, the build passed, and the feature simply
 * did not exist at runtime.
 *
 * TypeScript cannot catch it: the interceptor changes the runtime type while
 * axios's declared type still says AxiosResponse, so `.data` type-checks.
 *
 * The repository convention is `unwrap`, aliased to `r`, which the interceptor
 * makes an identity function carrying only the type:
 *
 *   return r(api.get('/thing'));
 *
 * Node built-ins only. Reads files, touches nothing else.
 *
 * Exit 0 = no double-unwrap. Exit 1 = at least one.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOTS = ['frontend', 'platforms', 'apps', 'shared'];
const SKIP = new Set(['node_modules', '.next', 'dist', 'build', '.git']);

/** The client whose interceptor makes a second `.data` wrong. */
const SHARED_CLIENT = /from ['"]@apex\/shared-auth['"]/;

/**
 * `.data` read off the result of an `api.*` call.
 *
 * Both spellings that appeared in practice: the awaited-variable form, and
 * reading straight off the call expression.
 */
const OFFENDERS = [
  // const res = await api.get(...);  ...  return res.data;
  /const\s+(\w+)\s*=\s*await\s+api\.\w+\([\s\S]*?\);[\s\S]{0,400}?\1\.data\b/g,
  // (await api.get(...)).data
  /\(\s*await\s+api\.\w+\([\s\S]*?\)\s*\)\s*\.data\b/g,
  // api.get(...).then((r) => r.data)
  /api\.\w+\([\s\S]*?\)\s*\.then\(\s*\(?\s*(\w+)\s*\)?\s*=>\s*\1\.data\b/g,
];

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const violations = [];
let scanned = 0;

for (const root of ROOTS) {
  for (const file of walk(join(REPO_ROOT, root))) {
    const src = readFileSync(file, 'utf8');
    // Only files that actually use the shared client are governed by its
    // interceptor. A local axios instance may legitimately read `.data`.
    if (!SHARED_CLIENT.test(src)) continue;
    scanned++;

    // Comments explain the rule; they are not violations of it.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    for (const pattern of OFFENDERS) {
      pattern.lastIndex = 0;
      if (pattern.test(code)) {
        violations.push(relative(REPO_ROOT, file));
        break;
      }
    }
  }
}

if (violations.length === 0) {
  console.log(`[api-contract] OK — ${scanned} file(s) use the shared client, none double-unwrap`);
  process.exit(0);
}

console.error(`[api-contract] ${violations.length} file(s) read .data off an already-unwrapped response:`);
for (const v of violations) console.error(`  ${v}`);
console.error('[api-contract] The shared client interceptor returns response.data, so a second');
console.error('[api-contract] .data is undefined. Use `unwrap as r`: return r(api.get(...));');
process.exit(1);
