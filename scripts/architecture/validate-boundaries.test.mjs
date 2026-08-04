#!/usr/bin/env node
/**
 * Self-tests for the architecture boundary validator.
 *
 * Builds throwaway repositories in the OS temp directory, runs the real
 * validator against them as a child process, and asserts on its exit code and
 * output. Node built-ins only — no test framework, no dependencies.
 *
 * Every temporary directory is removed in a finally block, including on
 * failure.
 *
 * Exit 0 = all cases pass. Exit 1 = at least one case failed.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const VALIDATOR = join(__dirname, 'validate-boundaries.mjs');
const CONFIG = join(REPO_ROOT, 'architecture-boundaries.json');

let passed = 0;
let failed = 0;

function write(root, relPath, contents) {
  const abs = join(root, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, contents, 'utf8');
}

function runValidator(root) {
  const result = spawnSync(process.execPath, [VALIDATOR, '--root', root], {
    encoding: 'utf8',
  });
  return {
    code: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/**
 * @param {string} name
 * @param {(root: string) => void} build  populates the fake repo
 * @param {{ expectExit: number, expectRule?: string }} expectations
 */
function testCase(name, build, expectations) {
  const root = mkdtempSync(join(tmpdir(), 'apex-arch-'));
  try {
    // Every fake repo needs the real config so rules match production behaviour.
    copyFileSync(CONFIG, join(root, 'architecture-boundaries.json'));
    build(root);

    const { code, stdout, stderr } = runValidator(root);
    const output = `${stdout}\n${stderr}`;

    const problems = [];
    if (code !== expectations.expectExit) {
      problems.push(`expected exit ${expectations.expectExit}, got ${code}`);
    }
    if (expectations.expectRule && !output.includes(expectations.expectRule)) {
      problems.push(`expected rule "${expectations.expectRule}" in output`);
    }

    if (problems.length === 0) {
      console.log(`  PASS  ${name}`);
      passed += 1;
    } else {
      console.error(`  FAIL  ${name}`);
      for (const p of problems) console.error(`          ${p}`);
      console.error(`        --- validator output ---\n${output.trim()}\n`);
      failed += 1;
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log('\n[architecture] validator self-tests\n');

// 1. Accepts a valid public import between components.
testCase(
  'accepts a valid public cross-component import',
  (root) => {
    write(
      root,
      'platforms/operations/tickets/lifecycle/index.ts',
      `export const TICKET = 'ticket';\n`,
    );
    write(
      root,
      'platforms/intelligence/dashboard/summary/backend/services/summary.service.ts',
      `import { TICKET } from '@apex/operations/tickets/lifecycle';\nexport const use = () => TICKET;\n`,
    );
  },
  { expectExit: 0 },
);

// 2. Rejects frontend importing backend.
testCase(
  'rejects frontend importing backend',
  (root) => {
    write(
      root,
      'platforms/workforce/attendance/workday/backend/services/workday.service.ts',
      `export const finalize = () => 'closed';\n`,
    );
    write(
      root,
      'platforms/workforce/attendance/workday/frontend/screens/WorkdayScreen.tsx',
      `import { finalize } from '../../backend/services/workday.service';\nexport const S = () => finalize();\n`,
    );
  },
  { expectExit: 1, expectRule: 'frontend-no-backend' },
);

// 3. Rejects backend importing frontend.
testCase(
  'rejects backend importing frontend',
  (root) => {
    write(
      root,
      'platforms/workforce/attendance/workday/frontend/components/Bar.tsx',
      `export const Bar = () => null;\n`,
    );
    write(
      root,
      'platforms/workforce/attendance/workday/backend/services/workday.service.ts',
      `import { Bar } from '../../frontend/components/Bar';\nexport const use = () => Bar;\n`,
    );
  },
  { expectExit: 1, expectRule: 'backend-no-frontend' },
);

// 4. Rejects shared importing a platform.
testCase(
  'rejects shared importing a platform',
  (root) => {
    write(root, 'platforms/core/identity/authentication/index.ts', `export const A = 1;\n`);
    write(
      root,
      'shared/utilities/helper.ts',
      `import { A } from '@apex/core/identity/authentication';\nexport const B = A;\n`,
    );
  },
  { expectExit: 1, expectRule: 'shared-no-platforms' },
);

// 5. Rejects a cross-component internal import.
testCase(
  'rejects a cross-component internal import',
  (root) => {
    write(
      root,
      'platforms/operations/tickets/lifecycle/backend/services/private.service.ts',
      `export const secret = 'internal';\n`,
    );
    write(
      root,
      'platforms/operations/tickets/review-rework/backend/services/review.service.ts',
      `import { secret } from '@apex/operations/tickets/lifecycle/backend/services/private.service';\nexport const use = () => secret;\n`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 6. Accepts an app composing a public platform entry point.
testCase(
  'accepts an app composing a public platform entry point',
  (root) => {
    write(
      root,
      'platforms/business/sales-crm/leads/index.ts',
      `export const LeadsScreen = () => null;\n`,
    );
    write(
      root,
      'apps/web/app/sales-crm/leads/page.tsx',
      `export { LeadsScreen as default } from '@apex/business/sales-crm/leads';\n`,
    );
  },
  { expectExit: 0 },
);

// ── extra coverage beyond the required six ──────────────────────────────────

// 7. Rejects database importing a platform.
testCase(
  'rejects database importing a platform',
  (root) => {
    write(root, 'platforms/core/users/profiles/index.ts', `export const U = 1;\n`);
    write(
      root,
      'database/client/prisma.service.ts',
      `import { U } from '@apex/core/users/profiles';\nexport const V = U;\n`,
    );
  },
  { expectExit: 1, expectRule: 'database-no-upper-layers' },
);

// 8. Ignores commented-out violations.
testCase(
  'ignores a commented-out violating import',
  (root) => {
    write(
      root,
      'platforms/workforce/attendance/workday/backend/services/workday.service.ts',
      `// import { Bar } from '../../frontend/components/Bar';\n/* import { Baz } from '../../frontend/x'; */\nexport const ok = true;\n`,
    );
  },
  { expectExit: 0 },
);

// 9. Same-component internal imports are allowed.
testCase(
  'allows internal imports within one component',
  (root) => {
    write(
      root,
      'platforms/workforce/attendance/workday/backend/repositories/repo.ts',
      `export const repo = 1;\n`,
    );
    write(
      root,
      'platforms/workforce/attendance/workday/backend/services/workday.service.ts',
      `import { repo } from '../repositories/repo';\nexport const use = () => repo;\n`,
    );
  },
  { expectExit: 0 },
);

// 10. Detects violations in dynamic import() and require().
testCase(
  'detects dynamic import() and require() violations',
  (root) => {
    write(
      root,
      'platforms/workforce/attendance/workday/backend/services/a.service.ts',
      `export const a = 1;\n`,
    );
    write(
      root,
      'platforms/workforce/attendance/workday/frontend/hooks/useThing.ts',
      `export const load = () => import('../../backend/services/a.service');\n`,
    );
  },
  { expectExit: 1, expectRule: 'frontend-no-backend' },
);

// ── Phase 1A: narrow temporary legacy-import exemption ──────────────────────
// platforms/** -> frontend/** is forbidden by default. Sales CRM Leads carries
// an explicit, narrow, temporary exemption (DEBT-P1A-LEADS-LEGACY-FRONTEND).
// These prove the exemption is genuinely narrow and has not weakened the rule.

// 11. The allowlisted Leads legacy import is accepted.
testCase(
  'accepts the allowlisted Sales CRM Leads legacy frontend import',
  (root) => {
    write(
      root,
      'platforms/business/sales-crm/leads/frontend/screens/SalesCrmLeads.tsx',
      `import { salesCrmLeadsApi } from '@/lib/api';\nimport { Lead } from '@/lib/sales-crm/types';\nimport styles from '@/styles/sales-crm/leads.module.css';\nexport default function S() { return null; }\n`,
    );
  },
  { expectExit: 0 },
);

// 12. Another platform importing the SAME frontend path is rejected.
testCase(
  'rejects another platform importing the same allowlisted frontend path',
  (root) => {
    write(
      root,
      'platforms/workforce/attendance/workday/frontend/screens/WorkdayScreen.tsx',
      `import { salesCrmLeadsApi } from '@/lib/api';\nexport default function S() { return null; }\n`,
    );
  },
  { expectExit: 1, expectRule: 'platforms-no-legacy-frontend' },
);

// 13. Leads importing an UNRELATED frontend module is rejected.
testCase(
  'rejects Sales CRM Leads importing an unrelated frontend module',
  (root) => {
    write(
      root,
      'platforms/business/sales-crm/leads/frontend/components/LeadList.tsx',
      `import { WorkdayBar } from '@/components/workday/WorkdayBar';\nexport const L = () => WorkdayBar;\n`,
    );
  },
  { expectExit: 1, expectRule: 'platforms-no-legacy-frontend' },
);

// 14. Platform -> legacy backend remains rejected, with no exemption path.
testCase(
  'rejects platform importing legacy backend even for the exempted component',
  (root) => {
    write(
      root,
      'platforms/business/sales-crm/leads/frontend/api/lead-adapter.ts',
      `import { LeadsService } from '../../../../../../backend/src/modules/business/sales-crm/leads.service';\nexport const a = LeadsService;\n`,
    );
  },
  { expectExit: 1, expectRule: 'platforms-no-legacy-backend' },
);

// 15. The exemption does not leak to a sibling Sales CRM component.
testCase(
  'rejects a sibling Sales CRM component using the Leads exemption',
  (root) => {
    write(
      root,
      'platforms/business/sales-crm/dashboard/frontend/screens/DashboardScreen.tsx',
      `import { Lead } from '@/lib/sales-crm/types';\nexport default function S() { return null; }\n`,
    );
  },
  { expectExit: 1, expectRule: 'platforms-no-legacy-frontend' },
);

// ── summary ─────────────────────────────────────────────────────────────────
console.log(`\n[architecture] ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
