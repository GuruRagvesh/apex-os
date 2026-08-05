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

// ── narrow temporary legacy-import exemptions ───────────────────────────────
// platforms/** -> frontend/** is forbidden by default. Phase 2B retired the
// asset exemption entirely, leaving three narrow ones:
//   DEBT-P2B-LEADS-COMPANY-REPOSITORY  (one exact file -> company-repository)
//   DEBT-P2A-SALES-CRM-API-CLIENT      (Leads -> frontend/lib/api.ts)
//   DEBT-P2A-SALES-CRM-AUTH-STORE      (one exact file -> auth.store.ts)
// These prove each is genuinely narrow and has not weakened the rule.

// 11. The allowlisted Leads legacy import is accepted.
testCase(
  'accepts the allowlisted Sales CRM Leads legacy imports',
  (root) => {
    write(
      root,
      'platforms/business/sales-crm/leads/frontend/screens/SalesCrmLeads.tsx',
      `import { salesCrmLeadsApi } from '@/lib/api';\nexport default function S() { return null; }\n`,
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
      `import styles from '@/styles/sales-crm/leads.module.css';\nexport default function S() { return null; }\n`,
    );
  },
  { expectExit: 1, expectRule: 'platforms-no-legacy-frontend' },
);

// 16. Paths that Phase 2A migrated OUT of frontend/ are no longer allowlisted.
// This is the test that would fail if someone re-added the broad Phase 1A
// exemption, or left a stale import behind after the move.
testCase(
  'rejects Leads importing legacy paths that Phase 2A migrated away',
  (root) => {
    write(
      root,
      'platforms/business/sales-crm/leads/frontend/components/LeadDetail.tsx',
      `import { Lead } from '@/lib/sales-crm/types';\nexport const L = () => null;\n`,
    );
  },
  { expectExit: 1, expectRule: 'platforms-no-legacy-frontend' },
);

// 17. A Sales CRM component may consume the shared slice's PUBLIC entry point.
testCase(
  'accepts a Sales CRM component consuming the shared public API',
  (root) => {
    write(root, 'platforms/business/sales-crm/shared/index.ts', `export const X = 1;\n`);
    write(
      root,
      'platforms/business/sales-crm/leads/frontend/components/LeadStats.tsx',
      `import { Role, useAuth } from '@apex/sales-crm-shared';\nexport const L = () => useAuth() && Role;\n`,
    );
  },
  { expectExit: 0 },
);

// 18. Reaching into the shared slice's internals through its alias is rejected.
// Without componentAliases in architecture-boundaries.json the validator would
// treat this as a bare package and silently allow it.
testCase(
  'rejects a Sales CRM component importing shared slice internals via the alias',
  (root) => {
    write(root, 'platforms/business/sales-crm/shared/index.ts', `export const X = 1;\n`);
    write(
      root,
      'platforms/business/sales-crm/leads/frontend/components/LeadFilters.tsx',
      `import { useAuth } from '@apex/sales-crm-shared/frontend/api/auth-adapter';\nexport const L = () => useAuth();\n`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 19. A NON-Sales-CRM platform cannot reach into the shared slice's internals.
testCase(
  'rejects a non-Sales-CRM platform importing Sales CRM shared internals',
  (root) => {
    write(root, 'platforms/business/sales-crm/shared/index.ts', `export const X = 1;\n`);
    write(
      root,
      'platforms/workforce/attendance/workday/backend/services/workday.service.ts',
      `import { Role } from '@apex/business/sales-crm/shared/shared/types';\nexport const r = Role;\n`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 20. The auth-store exemption applies to the exact adapter file only.
testCase(
  'accepts the Sales CRM auth adapter importing the legacy auth store',
  (root) => {
    write(
      root,
      'platforms/business/sales-crm/shared/frontend/api/auth-adapter.ts',
      `import { useAuthStore } from '@/store/auth.store';\nexport const useAuth = () => useAuthStore();\n`,
    );
  },
  { expectExit: 0 },
);

// 21. A sibling file in the SAME folder cannot reuse the auth-store exemption.
testCase(
  'rejects a sibling shared file reusing the auth-store exemption',
  (root) => {
    write(
      root,
      'platforms/business/sales-crm/shared/frontend/api/audit-log.ts',
      `import { useAuthStore } from '@/store/auth.store';\nexport const a = () => useAuthStore();\n`,
    );
  },
  { expectExit: 1, expectRule: 'platforms-no-legacy-frontend' },
);

// 22. Another platform cannot reuse the auth-store exemption either.
testCase(
  'rejects another platform importing the legacy auth store',
  (root) => {
    write(
      root,
      'platforms/workforce/attendance/workday/frontend/hooks/useMe.ts',
      `import { useAuthStore } from '@/store/auth.store';\nexport const m = () => useAuthStore();\n`,
    );
  },
  { expectExit: 1, expectRule: 'platforms-no-legacy-frontend' },
);

// 23. The existing Leads public API remains valid through its own alias.
testCase(
  'accepts an app composing the Leads public API through its alias',
  (root) => {
    write(root, 'platforms/business/sales-crm/leads/index.ts', `export const SalesCrmLeads = () => null;\n`);
    write(
      root,
      'apps/web/app/sales-crm/leads/page.tsx',
      `export { SalesCrmLeads as default } from '@apex/sales-crm-leads';\n`,
    );
  },
  { expectExit: 0 },
);

// 24. Reaching into the Leads slice's internals through its alias is rejected.
testCase(
  'rejects reaching into Leads internals through its alias',
  (root) => {
    write(root, 'platforms/business/sales-crm/leads/index.ts', `export const X = 1;\n`);
    write(
      root,
      'apps/web/app/sales-crm/leads/page.tsx',
      `import LeadList from '@apex/sales-crm-leads/frontend/components/LeadList';\nexport default LeadList;\n`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 25. Dynamic import() of shared slice internals is checked too.
testCase(
  'detects dynamic import() reaching into shared slice internals',
  (root) => {
    write(root, 'platforms/business/sales-crm/shared/index.ts', `export const X = 1;\n`);
    write(
      root,
      'platforms/business/sales-crm/leads/frontend/components/LeadTabs.tsx',
      `export const load = () => import('@apex/sales-crm-shared/shared/constants/permissions');\n`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 26. require() of the legacy auth store from a non-exempt file is checked too.
testCase(
  'detects require() of the legacy auth store from a non-exempt file',
  (root) => {
    write(
      root,
      'platforms/business/sales-crm/shared/shared/constants/permissions.ts',
      `const { useAuthStore } = require('@/store/auth.store');\nexport const p = useAuthStore;\n`,
    );
  },
  { expectExit: 1, expectRule: 'platforms-no-legacy-frontend' },
);

// ── Phase 2B: asset ownership and public style subpaths ─────────────────────
// leads.module.css and the two controls became Leads-internal; primitives
// .module.css became a shared asset published by an EXACT declared subpath,
// because a CSS module cannot go through the JS barrel without changing its
// bundle position and therefore its cascade order.

// 27. Leads may import its own internal assets internally.
testCase(
  'accepts Leads importing its own internal stylesheet and controls',
  (root) => {
    write(root, 'platforms/business/sales-crm/leads/frontend/styles/leads.module.css', `.x { color: red; }\n`);
    write(root, 'platforms/business/sales-crm/leads/frontend/components/CountryCodeSelect.tsx', `export default function C() { return null; }\n`);
    write(
      root,
      'platforms/business/sales-crm/leads/frontend/components/LeadCreate.tsx',
      `import CountryCodeSelect from './CountryCodeSelect';\nimport styles from '../styles/leads.module.css';\nexport const L = () => [CountryCodeSelect, styles];\n`,
    );
  },
  { expectExit: 0 },
);

// 28. An external component cannot reach Leads' internal stylesheet.
testCase(
  'rejects an external component importing the Leads internal stylesheet',
  (root) => {
    write(root, 'platforms/business/sales-crm/leads/index.ts', `export const X = 1;\n`);
    write(
      root,
      'platforms/business/sales-crm/dashboard/frontend/screens/DashboardScreen.tsx',
      `import styles from '@apex/sales-crm-leads/frontend/styles/leads.module.css';\nexport default function S() { return styles; }\n`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 29. An external component cannot reach a Leads internal control either.
testCase(
  'rejects an external component importing a Leads internal control',
  (root) => {
    write(root, 'platforms/business/sales-crm/leads/index.ts', `export const X = 1;\n`);
    write(
      root,
      'platforms/business/sales-crm/settings/frontend/screens/SettingsScreen.tsx',
      `import CountryCodeSelect from '@apex/sales-crm-leads/frontend/components/CountryCodeSelect';\nexport default CountryCodeSelect;\n`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 30. A Sales CRM component may consume the APPROVED shared style subpath.
testCase(
  'accepts a Sales CRM component consuming the approved shared style subpath',
  (root) => {
    write(root, 'platforms/business/sales-crm/shared/frontend/styles/primitives.module.css', `.y { color: blue; }\n`);
    write(
      root,
      'platforms/business/sales-crm/leads/frontend/components/LeadStats.tsx',
      `import ui from '@apex/sales-crm-shared/styles/primitives.module.css';\nexport const L = () => ui;\n`,
    );
  },
  { expectExit: 0 },
);

// 31. An UNAPPROVED shared internal style path is still rejected. This is what
//     keeps publicStyleSubpaths an exact allowlist rather than a directory.
testCase(
  'rejects an unapproved shared internal style path',
  (root) => {
    write(root, 'platforms/business/sales-crm/shared/frontend/styles/secret.module.css', `.z { color: green; }\n`);
    write(
      root,
      'platforms/business/sales-crm/leads/frontend/components/LeadList.tsx',
      `import s from '@apex/sales-crm-shared/styles/secret.module.css';\nexport const L = () => s;\n`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 32. A non-Sales-CRM platform cannot consume Sales CRM internals.
testCase(
  'rejects a non-Sales-CRM platform importing Sales CRM internals',
  (root) => {
    write(root, 'platforms/business/sales-crm/shared/index.ts', `export const X = 1;\n`);
    write(
      root,
      'platforms/workforce/attendance/workday/frontend/screens/WorkdayScreen.tsx',
      `import ui from '@apex/sales-crm-shared/frontend/api/auth-adapter';\nexport default function S() { return ui; }\n`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 33. The legacy asset paths Phase 2B migrated away are no longer allowlisted.
testCase(
  'rejects Leads importing legacy asset paths that Phase 2B migrated away',
  (root) => {
    write(
      root,
      'platforms/business/sales-crm/leads/frontend/components/LeadDetail.tsx',
      `import styles from '@/styles/sales-crm/leads.module.css';\nexport const L = () => styles;\n`,
    );
  },
  { expectExit: 1, expectRule: 'platforms-no-legacy-frontend' },
);

// 34. ...including the legacy control paths.
testCase(
  'rejects Leads importing the legacy control paths',
  (root) => {
    write(
      root,
      'platforms/business/sales-crm/leads/frontend/components/LeadCreate.tsx',
      `import C from '@/components/sales-crm/ui/CompanyAutocomplete';\nexport const L = () => C;\n`,
    );
  },
  { expectExit: 1, expectRule: 'platforms-no-legacy-frontend' },
);

// 35. The company-repository exemption applies to the exact adapter file only.
testCase(
  'accepts CompanyAutocomplete importing the legacy company repository',
  (root) => {
    write(
      root,
      'platforms/business/sales-crm/leads/frontend/components/CompanyAutocomplete.tsx',
      `import { LocalStorageCompanyRepository } from '@/lib/sales-crm/company/company-repository';\nexport const C = () => LocalStorageCompanyRepository;\n`,
    );
  },
  { expectExit: 0 },
);

// 36. A sibling Leads component cannot reuse the company-repository exemption.
testCase(
  'rejects a sibling Leads component reusing the company-repository exemption',
  (root) => {
    write(
      root,
      'platforms/business/sales-crm/leads/frontend/components/LeadCreate.tsx',
      `import { LocalStorageCompanyRepository } from '@/lib/sales-crm/company/company-repository';\nexport const L = () => LocalStorageCompanyRepository;\n`,
    );
  },
  { expectExit: 1, expectRule: 'platforms-no-legacy-frontend' },
);

// 37. The SAME public stylesheet, spelled through the component's internal
//     folder, is rejected. Approval matches the original specifier, not the
//     resolved file, so a second spelling of a public asset is not public.
testCase(
  'rejects the public stylesheet spelled through the internal folder path',
  (root) => {
    write(root, 'platforms/business/sales-crm/shared/frontend/styles/primitives.module.css', `.y { color: blue; }\n`);
    write(
      root,
      'platforms/business/sales-crm/leads/frontend/components/LeadFilters.tsx',
      `import ui from '@apex/sales-crm-shared/frontend/styles/primitives.module.css';\nexport const L = () => ui;\n`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 38. ...including by dynamic import().
testCase(
  'detects dynamic import() of the internal-folder spelling',
  (root) => {
    write(root, 'platforms/business/sales-crm/shared/frontend/styles/primitives.module.css', `.y { color: blue; }\n`);
    write(
      root,
      'platforms/business/sales-crm/leads/frontend/components/LeadTabs.tsx',
      `export const load = () => import('@apex/sales-crm-shared/frontend/styles/primitives.module.css');\n`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 39. ...and by require().
testCase(
  'detects require() of the internal-folder spelling',
  (root) => {
    write(root, 'platforms/business/sales-crm/shared/frontend/styles/primitives.module.css', `.y { color: blue; }\n`);
    write(
      root,
      'platforms/business/sales-crm/leads/frontend/components/LeadList.tsx',
      `const ui = require('@apex/sales-crm-shared/frontend/styles/primitives.module.css');\nexport default ui;\n`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 40. A declared specifier that does NOT resolve to its declared path is not
//     public either — this is what stops a drifting alias from widening the
//     allowlist. Here the component root exists but the stylesheet sits
//     somewhere else, so the specifier resolves past the declared file.
testCase(
  'rejects a public style specifier that resolves somewhere unexpected',
  (root) => {
    write(root, 'platforms/business/sales-crm/shared/frontend/styles/primitives.module.css', `.y { color: blue; }\n`);
    write(
      root,
      'platforms/business/sales-crm/leads/frontend/components/LeadStats.tsx',
      `import ui from '@apex/sales-crm-shared/styles/primitives.module.css/extra';\nexport const L = () => ui;\n`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 38. require() of a Leads internal asset from outside is checked too.
testCase(
  'detects require() of a Leads internal asset from another component',
  (root) => {
    write(root, 'platforms/business/sales-crm/leads/index.ts', `export const X = 1;\n`);
    write(
      root,
      'platforms/business/sales-crm/analytics/frontend/screens/AnalyticsScreen.tsx',
      `const styles = require('@apex/sales-crm-leads/frontend/styles/leads.module.css');\nexport default styles;\n`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// ── real-repository debt counts ─────────────────────────────────────────────
// Every case above runs against a throwaway fixture. These run against THIS
// repository, so a new exempted import cannot be added without updating the
// expected number here. That is the point: tracked debt should only ever go
// down by a deliberate edit, never drift up quietly.
function testRealRepoDebtCounts(expected) {
  const { code, stdout, stderr } = runValidator(REPO_ROOT);
  const output = `${stdout}\n${stderr}`;
  const problems = [];

  if (code !== 0) problems.push(`expected the repository to have no violations, got exit ${code}`);

  for (const [id, want] of Object.entries(expected)) {
    const m = output.match(new RegExp(`${id}\\s+\\((\\d+) import\\(s\\)\\)`));
    if (!m) {
      problems.push(`${id} not reported`);
      continue;
    }
    const got = Number(m[1]);
    if (got !== want) problems.push(`${id}: expected ${want} import(s), got ${got}`);
  }

  // No debt identifier may appear that we did not expect.
  const reported = [...output.matchAll(/^\s{2}(DEBT-[A-Z0-9-]+)\s+\(/gm)].map((m) => m[1]);
  for (const id of reported) {
    if (!(id in expected)) problems.push(`unexpected debt identifier reported: ${id}`);
  }

  const total = Object.values(expected).reduce((a, b) => a + b, 0);
  const totalMatch = output.match(/(\d+) allowlisted legacy import\(s\)/);
  if (totalMatch && Number(totalMatch[1]) !== total) {
    problems.push(`total debt: expected ${total}, got ${totalMatch[1]}`);
  }

  const name = `real repository debt is exactly ${total} (${Object.entries(expected).map(([k, v]) => `${k.replace('DEBT-', '')}=${v}`).join(', ')})`;
  if (problems.length === 0) {
    console.log(`  PASS  ${name}`);
    passed += 1;
  } else {
    console.error(`  FAIL  ${name}`);
    for (const p of problems) console.error(`          ${p}`);
    console.error(`        --- validator output ---\n${output.trim()}\n`);
    failed += 1;
  }
}

testRealRepoDebtCounts({
  'DEBT-P2A-SALES-CRM-API-CLIENT': 6,
  'DEBT-P2B-LEADS-COMPANY-REPOSITORY': 1,
  'DEBT-P2A-SALES-CRM-AUTH-STORE': 1,
});

// ── summary ─────────────────────────────────────────────────────────────────
console.log(`\n[architecture] ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
