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

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execSync } from 'node:child_process';

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
// platforms/** -> frontend/** is forbidden by default. Phase 2C retired the
// API-client exemption, leaving three narrow ones, each scoped to one file:
//   DEBT-P2B-LEADS-COMPANY-REPOSITORY  (CompanyAutocomplete -> company-repository)
//   DEBT-P2C-LEADS-GLOBAL-USERS-API    (SalesCrmLeads screen -> usersApi)
//   DEBT-P2A-SALES-CRM-AUTH-STORE      (auth-adapter -> auth.store.ts)
// These prove each is genuinely narrow and has not weakened the rule.

// 11. The Leads screen may still reach the application-wide users API.
testCase(
  'accepts the Leads screen importing the application-wide users API',
  (root) => {
    write(
      root,
      'platforms/business/sales-crm/leads/frontend/screens/SalesCrmLeads.tsx',
      `import { usersApi } from '@/lib/api';\nexport default function S() { return usersApi; }\n`,
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

// 20. The Sales CRM auth adapter no longer reaches the legacy store - it now
//     consumes @apex/core-identity, so DEBT-P2A-SALES-CRM-AUTH-STORE is gone.
testCase(
  'rejects the Sales CRM auth adapter importing the legacy auth store',
  (root) => {
    write(
      root,
      'platforms/business/sales-crm/shared/frontend/api/auth-adapter.ts',
      `import { useAuthStore } from '@/store/auth.store';\nexport const useAuth = () => useAuthStore();\n`,
    );
  },
  { expectExit: 1, expectRule: 'platforms-no-legacy-frontend' },
);

testCase(
  'accepts the Sales CRM auth adapter consuming Core Identity',
  (root) => {
    write(root, 'platforms/core/identity/authentication/index.ts', `export const useAuthStore = () => null;
`);
    write(
      root,
      'platforms/business/sales-crm/shared/frontend/api/auth-adapter.ts',
      `import { useAuthStore } from '@apex/core-identity';
export const useAuth = () => useAuthStore();
`,
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
//     keeps publicSubpaths an exact allowlist rather than a directory.
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

// ── Phase 2C: shared-auth HTTP client boundary ──────────────────────────────
// The authenticated axios singleton moved to shared/auth, and the Sales CRM
// Leads API moved to the Sales CRM shared component. shared/auth publishes a
// public entry point; its internals are private like a platform component's.

// 41. Leads consumes salesCrmLeadsApi through the narrow /api subpath.
//     The root barrel deliberately does NOT carry it — that would drag axios
//     into every consumer that only wants types, constants, permissions,
//     mock data or styles.
testCase(
  'accepts Leads importing salesCrmLeadsApi from the /api subpath',
  (root) => {
    write(root, 'platforms/business/sales-crm/shared/frontend/api/index.ts', `export const salesCrmLeadsApi = {};\n`);
    write(
      root,
      'platforms/business/sales-crm/leads/frontend/components/LeadList.tsx',
      `import { salesCrmLeadsApi } from '@apex/sales-crm-shared/api';\nexport const L = () => salesCrmLeadsApi;\n`,
    );
  },
  { expectExit: 0 },
);

// 41b. Reaching the API through the component's internal folder is rejected,
//      even though it resolves to the same code as the /api subpath.
testCase(
  'rejects the Sales CRM API spelled through the internal folder path',
  (root) => {
    write(root, 'platforms/business/sales-crm/shared/frontend/api/index.ts', `export const salesCrmLeadsApi = {};\n`);
    write(
      root,
      'platforms/business/sales-crm/leads/frontend/components/LeadStats.tsx',
      `import { salesCrmLeadsApi } from '@apex/sales-crm-shared/frontend/api';\nexport const L = () => salesCrmLeadsApi;\n`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 41c. A deeper path under the approved /api subpath is still private —
//      publicSubpaths is an exact specifier allowlist, not a directory.
testCase(
  'rejects a deeper path under the approved /api subpath',
  (root) => {
    write(root, 'platforms/business/sales-crm/shared/frontend/api/index.ts', `export const salesCrmLeadsApi = {};\n`);
    write(
      root,
      'platforms/business/sales-crm/leads/frontend/components/LeadFilters.tsx',
      `import { salesCrmLeadsApi } from '@apex/sales-crm-shared/api/sales-crm-leads-api';\nexport const L = () => salesCrmLeadsApi;\n`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 41d. ...by dynamic import() too.
testCase(
  'detects dynamic import() of an internal Sales CRM API path',
  (root) => {
    write(root, 'platforms/business/sales-crm/shared/frontend/api/index.ts', `export const salesCrmLeadsApi = {};\n`);
    write(
      root,
      'platforms/business/sales-crm/leads/frontend/components/LeadDetail.tsx',
      `export const load = () => import('@apex/sales-crm-shared/frontend/api/sales-crm-leads-api');\n`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 41e. ...and by require().
testCase(
  'detects require() of an internal Sales CRM API path',
  (root) => {
    write(root, 'platforms/business/sales-crm/shared/frontend/api/index.ts', `export const salesCrmLeadsApi = {};\n`);
    write(
      root,
      'platforms/business/sales-crm/leads/frontend/components/ColumnManager.tsx',
      `const { salesCrmLeadsApi } = require('@apex/sales-crm-shared/frontend/api/sales-crm-leads-api');\nexport default salesCrmLeadsApi;\n`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 42. Leads may NOT reach the API adapter through its internal path.
testCase(
  'rejects Leads importing the Sales CRM API adapter through an internal path',
  (root) => {
    write(root, 'platforms/business/sales-crm/shared/index.ts', `export const X = 1;\n`);
    write(
      root,
      'platforms/business/sales-crm/leads/frontend/components/LeadTabs.tsx',
      `import { salesCrmLeadsApi } from '@apex/sales-crm-shared/frontend/api/sales-crm-leads-api';\nexport const L = () => salesCrmLeadsApi;\n`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 43. Sales CRM shared may consume the shared-auth public entry point.
testCase(
  'accepts Sales CRM shared importing the authenticated client public API',
  (root) => {
    write(root, 'shared/auth/index.ts', `export const api = {};\n`);
    write(
      root,
      'platforms/business/sales-crm/shared/frontend/api/sales-crm-leads-api.ts',
      `import { api } from '@apex/shared-auth';\nexport const salesCrmLeadsApi = { getAll: () => api };\n`,
    );
  },
  { expectExit: 0 },
);

// 44. ...but not shared-auth internals.
testCase(
  'rejects Sales CRM shared importing shared-auth internals',
  (root) => {
    write(root, 'shared/auth/index.ts', `export const api = {};\n`);
    write(
      root,
      'platforms/business/sales-crm/shared/frontend/api/sales-crm-leads-api.ts',
      `import { api } from '@apex/shared-auth/frontend/authenticated-api-client';\nexport const s = api;\n`,
    );
  },
  { expectExit: 1, expectRule: 'shared-module-public-entry' },
);

// 45. Reaching shared-auth internals by dynamic import() is checked too.
testCase(
  'detects dynamic import() of shared-auth internals',
  (root) => {
    write(root, 'shared/auth/index.ts', `export const api = {};\n`);
    write(
      root,
      'platforms/business/sales-crm/leads/frontend/components/LeadDetail.tsx',
      `export const load = () => import('@apex/shared-auth/frontend/authenticated-api-client');\n`,
    );
  },
  { expectExit: 1, expectRule: 'shared-module-public-entry' },
);

// 46. ...and by require().
testCase(
  'detects require() of shared-auth internals',
  (root) => {
    write(root, 'shared/auth/index.ts', `export const api = {};\n`);
    write(
      root,
      'platforms/business/sales-crm/leads/frontend/components/LeadFilters.tsx',
      `const { api } = require('@apex/shared-auth/frontend/authenticated-api-client');\nexport default api;\n`,
    );
  },
  { expectExit: 1, expectRule: 'shared-module-public-entry' },
);

// 47. shared/auth must not import a platform — that inverts the graph.
testCase(
  'rejects shared-auth importing a platform',
  (root) => {
    write(root, 'platforms/business/sales-crm/shared/index.ts', `export const X = 1;\n`);
    write(
      root,
      'shared/auth/frontend/authenticated-api-client.ts',
      `import { X } from '@apex/sales-crm-shared';\nexport const api = X;\n`,
    );
  },
  { expectExit: 1, expectRule: 'shared-no-platforms' },
);

// 48. shared/auth must not import legacy frontend feature code either.
testCase(
  'rejects shared-auth importing legacy frontend feature code',
  (root) => {
    write(
      root,
      'shared/auth/frontend/authenticated-api-client.ts',
      `import { useAuthStore } from '@/store/auth.store';\nexport const api = useAuthStore;\n`,
    );
  },
  { expectExit: 1, expectRule: 'shared-no-legacy-frontend' },
);

// 49. A Leads component other than the screen may NOT import frontend/lib/api.ts.
//     The Phase 2A API-client exemption covered the whole component; its
//     replacement covers exactly one file.
testCase(
  'rejects a Leads component importing frontend/lib/api.ts after Phase 2C',
  (root) => {
    write(
      root,
      'platforms/business/sales-crm/leads/frontend/components/LeadInfoPanel.tsx',
      `import { salesCrmLeadsApi } from '@/lib/api';\nexport const L = () => salesCrmLeadsApi;\n`,
    );
  },
  { expectExit: 1, expectRule: 'platforms-no-legacy-frontend' },
);

// ── Operations Projects: component boundary ─────────────────────────────────
// The first compartmentalised slice outside Sales CRM. Its two screens are
// published through @apex/operations-projects; everything under frontend/ is
// private, and the thin Next.js route adapters are the only consumers.

// 50. A thin route adapter may compose the Projects public entry.
testCase(
  'accepts a thin route importing the Projects public entry',
  (root) => {
    write(root, 'platforms/operations/projects/project-management/index.ts', `export const ProjectsScreen = () => null;\n`);
    write(
      root,
      'apps/web/app/projects/page.tsx',
      `import { ProjectsScreen } from '@apex/operations-projects';\nexport default function P() { return ProjectsScreen; }\n`,
    );
  },
  { expectExit: 0 },
);

// 50b. A route may import the exact declared screen subpath. Each route uses
//      its own screen rather than the barrel, so /projects does not also load
//      ProjectDetailScreen — measured at ~8 kB when it did.
testCase(
  'accepts a route importing the exact declared screen subpath',
  (root) => {
    write(root, 'platforms/operations/projects/project-management/frontend/screens/ProjectsScreen.tsx', `export default function S() { return null; }\n`);
    write(
      root,
      'apps/web/app/projects/page.tsx',
      `import ProjectsScreen from '@apex/operations-projects/screens/ProjectsScreen';\nexport default ProjectsScreen;\n`,
    );
  },
  { expectExit: 0 },
);

// 50c. An UNDECLARED file in the same screens folder stays private —
//      publicSubpaths is an exact specifier allowlist, not a directory.
testCase(
  'rejects an undeclared screen beside the declared ones',
  (root) => {
    write(root, 'platforms/operations/projects/project-management/frontend/screens/SecretScreen.tsx', `export default function S() { return null; }\n`);
    write(
      root,
      'apps/web/app/projects/page.tsx',
      `import SecretScreen from '@apex/operations-projects/screens/SecretScreen';\nexport default SecretScreen;\n`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 51. Another component cannot reach a Projects screen.
testCase(
  'rejects another component importing a Projects internal screen',
  (root) => {
    write(root, 'platforms/operations/projects/project-management/index.ts', `export const X = 1;\n`);
    write(
      root,
      'platforms/operations/tickets/lifecycle/frontend/screens/TicketsScreen.tsx',
      `import { ProjectsScreen } from '@apex/operations-projects/frontend/screens/ProjectsScreen';\nexport default ProjectsScreen;\n`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 52. ...by dynamic import() too.
testCase(
  'detects dynamic import() of a Projects internal path',
  (root) => {
    write(root, 'platforms/operations/projects/project-management/index.ts', `export const X = 1;\n`);
    write(
      root,
      'platforms/intelligence/dashboard/summary/frontend/screens/SummaryScreen.tsx',
      `export const load = () => import('@apex/operations-projects/frontend/screens/ProjectDetailScreen');\n`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 53. ...and by require().
testCase(
  'detects require() of a Projects internal path',
  (root) => {
    write(root, 'platforms/operations/projects/project-management/index.ts', `export const X = 1;\n`);
    write(
      root,
      'platforms/core/users/profiles/frontend/screens/ProfileScreen.tsx',
      `const S = require('@apex/operations-projects/frontend/index');\nexport default S;\n`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 54. Projects frontend must not import backend code.
testCase(
  'rejects Projects frontend importing backend code',
  (root) => {
    write(
      root,
      'platforms/operations/projects/project-management/frontend/screens/ProjectsScreen.tsx',
      `import { ProjectsService } from '../../backend/services/projects.service';\nexport default ProjectsService;\n`,
    );
  },
  { expectExit: 1, expectRule: 'frontend-no-backend' },
);

// 55. Projects must not reach into another platform's internals.
//     Note the target is deliberately another platform's FRONTEND: a frontend
//     file importing backend code trips the more specific frontend-no-backend
//     rule first (covered separately by case 54), which would mask the
//     component-boundary check this case exists to prove.
testCase(
  'rejects Projects importing another platform internals',
  (root) => {
    write(root, 'platforms/workforce/attendance/workday/index.ts', `export const X = 1;\n`);
    write(
      root,
      'platforms/operations/projects/project-management/frontend/screens/ProjectDetailScreen.tsx',
      `import { WorkdayBar } from '@apex/workforce/attendance/workday/frontend/components/WorkdayBar';\nexport default WorkdayBar;\n`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 56. shared/ must not import Projects — that inverts the graph.
testCase(
  'rejects a shared module importing Projects',
  (root) => {
    write(root, 'platforms/operations/projects/project-management/index.ts', `export const X = 1;\n`);
    write(
      root,
      'shared/utilities/project-helper.ts',
      `import { X } from '@apex/operations-projects';\nexport const h = X;\n`,
    );
  },
  { expectExit: 1, expectRule: 'shared-no-platforms' },
);

// 57. The Projects legacy exemption is scoped to the screens folder only.
testCase(
  'accepts a Projects screen importing its allowlisted legacy dependencies',
  (root) => {
    write(
      root,
      'platforms/operations/projects/project-management/frontend/screens/ProjectsScreen.tsx',
      `import { projectsApi } from '@/lib/api';\nimport { cn } from '@/lib/utils';\nimport { TicketRow } from '@/components/tickets/ticket-row';\nexport default function S() { return null; }\n`,
    );
  },
  { expectExit: 0 },
);

// 58. A Projects file OUTSIDE the screens folder cannot reuse that exemption.
testCase(
  'rejects a Projects file outside screens/ reusing the legacy exemption',
  (root) => {
    write(
      root,
      'platforms/operations/projects/project-management/frontend/api/projects-adapter.ts',
      `import { projectsApi } from '@/lib/api';\nexport const a = projectsApi;\n`,
    );
  },
  { expectExit: 1, expectRule: 'platforms-no-legacy-frontend' },
);

// 59. A legacy path NOT on the Projects allowlist is rejected.
testCase(
  'rejects a Projects screen importing an unallowlisted legacy path',
  (root) => {
    write(
      root,
      'platforms/operations/projects/project-management/frontend/screens/ProjectsScreen.tsx',
      `import { WorkdayBar } from '@/components/workday/WorkdayBar';\nexport default function S() { return WorkdayBar; }\n`,
    );
  },
  { expectExit: 1, expectRule: 'platforms-no-legacy-frontend' },
);

// 60. Projects must not import the legacy backend root — no exemption exists.
testCase(
  'rejects Projects importing the legacy backend root',
  (root) => {
    write(
      root,
      'platforms/operations/projects/project-management/frontend/screens/ProjectsScreen.tsx',
      `import { ProjectsService } from '../../../../../../backend/src/modules/operations/projects/projects.service';\nexport default ProjectsService;\n`,
    );
  },
  { expectExit: 1, expectRule: 'platforms-no-legacy-backend' },
);

// ── Intelligence Dashboard: component boundary ──────────────────────────────
// Only the screen is published; the eight widgets under it are private.

// 61. A thin route adapter may compose the Dashboard public entry.
testCase(
  'accepts a thin route importing the Dashboard public entry',
  (root) => {
    write(root, 'platforms/intelligence/dashboard/overview/index.ts', `export const DashboardScreen = () => null;
`);
    write(
      root,
      'apps/web/app/dashboard/page.tsx',
      `import { DashboardScreen } from '@apex/intelligence-dashboard';
export default DashboardScreen;
`,
    );
  },
  { expectExit: 0 },
);

// 62. Its widgets are internal — no external component may reach them.
testCase(
  'rejects an external component importing a Dashboard widget',
  (root) => {
    write(root, 'platforms/intelligence/dashboard/overview/index.ts', `export const X = 1;
`);
    write(
      root,
      'platforms/operations/projects/project-management/frontend/screens/ProjectsScreen.tsx',
      `import { TeamPressurePanel } from '@apex/intelligence-dashboard/frontend/components/TeamPressurePanel';
export default TeamPressurePanel;
`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 63. ...by dynamic import() too.
testCase(
  'detects dynamic import() of a Dashboard internal path',
  (root) => {
    write(root, 'platforms/intelligence/dashboard/overview/index.ts', `export const X = 1;
`);
    write(
      root,
      'platforms/business/sales-crm/leads/frontend/components/LeadList.tsx',
      `export const load = () => import('@apex/intelligence-dashboard/frontend/screens/DashboardScreen');
`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 64. ...and by require().
testCase(
  'detects require() of a Dashboard internal path',
  (root) => {
    write(root, 'platforms/intelligence/dashboard/overview/index.ts', `export const X = 1;
`);
    write(
      root,
      'platforms/core/users/profiles/frontend/screens/ProfileScreen.tsx',
      `const W = require('@apex/intelligence-dashboard/frontend/components/HomeSkeleton');
export default W;
`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 65. Dashboard frontend must not import backend code.
testCase(
  'rejects Dashboard frontend importing backend code',
  (root) => {
    write(
      root,
      'platforms/intelligence/dashboard/overview/frontend/screens/DashboardScreen.tsx',
      `import { DashboardService } from '../../backend/services/dashboard.service';
export default DashboardService;
`,
    );
  },
  { expectExit: 1, expectRule: 'frontend-no-backend' },
);

// 66. shared/ must not import the Dashboard component.
testCase(
  'rejects a shared module importing the Dashboard component',
  (root) => {
    write(root, 'platforms/intelligence/dashboard/overview/index.ts', `export const X = 1;
`);
    write(
      root,
      'shared/utilities/dash-helper.ts',
      `import { X } from '@apex/intelligence-dashboard';
export const h = X;
`,
    );
  },
  { expectExit: 1, expectRule: 'shared-no-platforms' },
);

// 67. The Dashboard legacy exemption covers its allowlisted targets only.
testCase(
  'accepts a Dashboard file importing its allowlisted legacy dependencies',
  (root) => {
    write(
      root,
      'platforms/intelligence/dashboard/overview/frontend/screens/DashboardScreen.tsx',
      `import { dashboardApi } from '@/lib/api';
import { WorkdayBar } from '@/components/workday/WorkdayBar';
import { companyToday } from '@/lib/company-date';
export default function S() { return null; }
`,
    );
  },
  { expectExit: 0 },
);

// 68. An unallowlisted legacy path is still rejected for the Dashboard.
testCase(
  'rejects a Dashboard file importing an unallowlisted legacy path',
  (root) => {
    write(
      root,
      'platforms/intelligence/dashboard/overview/frontend/screens/DashboardScreen.tsx',
      `import { salesCrmLeadsApi } from '@/lib/sales-crm/api-connector';
export default function S() { return null; }
`,
    );
  },
  { expectExit: 1, expectRule: 'platforms-no-legacy-frontend' },
);

// 69. Another platform cannot reuse the Dashboard exemption.
testCase(
  'rejects another platform reusing the Dashboard legacy exemption',
  (root) => {
    write(
      root,
      'platforms/core/users/profiles/frontend/screens/ProfileScreen.tsx',
      `import { WorkdayBar } from '@/components/workday/WorkdayBar';
export default WorkdayBar;
`,
    );
  },
  { expectExit: 1, expectRule: 'platforms-no-legacy-frontend' },
);

// 69b/69c. Paths that moved into shared/ui are no longer allowlisted for the
//          components that used to import them, so the old coupling cannot
//          silently reappear.
testCase(
  'rejects Projects importing a UI primitive that moved to shared-ui',
  (root) => {
    write(
      root,
      'platforms/operations/projects/project-management/frontend/screens/ProjectsScreen.tsx',
      `import { EmptyState } from '@/components/ui/empty-state';
export default EmptyState;
`,
    );
  },
  { expectExit: 1, expectRule: 'platforms-no-legacy-frontend' },
);

testCase(
  'rejects Dashboard importing a UI primitive that moved to shared-ui',
  (root) => {
    write(
      root,
      'platforms/intelligence/dashboard/overview/frontend/screens/DashboardScreen.tsx',
      `import { CommandModal } from '@/components/ui/CommandModal';
export default CommandModal;
`,
    );
  },
  { expectExit: 1, expectRule: 'platforms-no-legacy-frontend' },
);

// ── shared/ui: design-system module boundary ────────────────────────────────
// shared/ui sits below every platform. It publishes primitives through one
// entry and may depend on nothing above or beside it.

// 70. Platform frontend code may consume the shared/ui public entry.
testCase(
  'accepts platform frontend importing the shared-ui public entry',
  (root) => {
    write(root, 'shared/ui/index.ts', `export const EmptyState = () => null;
`);
    write(
      root,
      'platforms/operations/projects/project-management/frontend/screens/ProjectsScreen.tsx',
      `import { EmptyState } from '@apex/shared-ui';
export default EmptyState;
`,
    );
  },
  { expectExit: 0 },
);

// 71. Platform code may NOT reach shared/ui internals.
testCase(
  'rejects platform code importing shared-ui internals',
  (root) => {
    write(root, 'shared/ui/index.ts', `export const X = 1;
`);
    write(
      root,
      'platforms/intelligence/dashboard/overview/frontend/screens/DashboardScreen.tsx',
      `import { CommandModal } from '@apex/shared-ui/frontend/components/CommandModal';
export default CommandModal;
`,
    );
  },
  { expectExit: 1, expectRule: 'shared-module-public-entry' },
);

// 72. ...by dynamic import() too.
testCase(
  'detects dynamic import() of shared-ui internals',
  (root) => {
    write(root, 'shared/ui/index.ts', `export const X = 1;
`);
    write(
      root,
      'platforms/business/sales-crm/leads/frontend/components/LeadList.tsx',
      `export const load = () => import('@apex/shared-ui/frontend/components/breadcrumb');
`,
    );
  },
  { expectExit: 1, expectRule: 'shared-module-public-entry' },
);

// 73. ...and by require().
testCase(
  'detects require() of shared-ui internals',
  (root) => {
    write(root, 'shared/ui/index.ts', `export const X = 1;
`);
    write(
      root,
      'platforms/operations/projects/project-management/frontend/screens/ProjectDetailScreen.tsx',
      `const B = require('@apex/shared-ui/frontend/index');
export default B;
`,
    );
  },
  { expectExit: 1, expectRule: 'shared-module-public-entry' },
);

// 74. shared/ui must not import a platform — that inverts the graph.
testCase(
  'rejects shared-ui importing a platform',
  (root) => {
    write(root, 'platforms/intelligence/dashboard/overview/index.ts', `export const X = 1;
`);
    write(
      root,
      'shared/ui/frontend/components/KpiCapsuleStrip.tsx',
      `import { X } from '@apex/intelligence-dashboard';
export const K = X;
`,
    );
  },
  { expectExit: 1, expectRule: 'shared-no-platforms' },
);

// 75. shared/ui must not import backend code.
testCase(
  'rejects shared-ui importing backend code',
  (root) => {
    write(
      root,
      'shared/ui/frontend/components/CommandModal.tsx',
      `import { DashboardService } from '../../../../backend/src/modules/platform/dashboard/dashboard.service';
export const C = DashboardService;
`,
    );
  },
  { expectExit: 1, expectRule: 'shared-no-legacy-backend' },
);

// 76. shared/ui must not import a legacy feature screen or store. This is the
//     rule that kept skeleton/multi-select/status-badge OUT of this module:
//     they still need `cn` from frontend/lib/utils.ts, and there is no
//     exemption mechanism for shared/ -> frontend/.
testCase(
  'rejects shared-ui importing a legacy store',
  (root) => {
    write(
      root,
      'shared/ui/frontend/components/user-avatar.tsx',
      `import { useAuthStore } from '@/store/auth.store';
export const U = useAuthStore;
`,
    );
  },
  { expectExit: 1, expectRule: 'shared-no-legacy-frontend' },
);

// 77. ...including a legacy shared helper such as lib/utils.
testCase(
  'rejects shared-ui importing frontend lib helpers',
  (root) => {
    write(
      root,
      'shared/ui/frontend/components/skeleton.tsx',
      `import { cn } from '@/lib/utils';
export const S = cn;
`,
    );
  },
  { expectExit: 1, expectRule: 'shared-no-legacy-frontend' },
);

// 78. shared/auth and shared/ui are independent modules: neither may reach
//     into the other's internals.
testCase(
  'rejects shared-ui reaching into shared-auth internals',
  (root) => {
    write(root, 'shared/auth/index.ts', `export const api = {};
`);
    write(
      root,
      'shared/ui/frontend/components/cold.tsx',
      `import { api } from '@apex/shared-auth/frontend/authenticated-api-client';
export const C = api;
`,
    );
  },
  { expectExit: 1, expectRule: 'shared-module-public-entry' },
);

// 79. A declared shared-ui component subpath is public. Routes use these
//     rather than the barrel: importing the barrel for one primitive pulled
//     all eleven and cost ~50 kB First Load JS on six routes when measured.
testCase(
  'accepts a platform importing an exact shared-ui component subpath',
  (root) => {
    write(root, 'shared/ui/frontend/components/empty-state.tsx', `export const EmptyState = () => null;
`);
    write(
      root,
      'platforms/operations/projects/project-management/frontend/screens/ProjectsScreen.tsx',
      `import { EmptyState } from '@apex/shared-ui/components/empty-state';
export default EmptyState;
`,
    );
  },
  { expectExit: 0 },
);

// 80. An UNDECLARED component beside the declared ones stays private —
//     publicSubpaths is an exact specifier allowlist, not a directory.
testCase(
  'rejects an undeclared shared-ui component subpath',
  (root) => {
    write(root, 'shared/ui/frontend/components/secret.tsx', `export const Secret = () => null;
`);
    write(
      root,
      'platforms/operations/projects/project-management/frontend/screens/ProjectsScreen.tsx',
      `import { Secret } from '@apex/shared-ui/components/secret';
export default Secret;
`,
    );
  },
  { expectExit: 1, expectRule: 'shared-module-public-entry' },
);

// 81. The same component spelled through the internal folder is rejected,
//     even though it resolves to the same file.
testCase(
  'rejects a shared-ui component spelled through the internal folder path',
  (root) => {
    write(root, 'shared/ui/frontend/components/breadcrumb.tsx', `export const Breadcrumb = () => null;
`);
    write(
      root,
      'platforms/intelligence/dashboard/overview/frontend/screens/DashboardScreen.tsx',
      `import { Breadcrumb } from '@apex/shared-ui/frontend/components/breadcrumb';
export default Breadcrumb;
`,
    );
  },
  { expectExit: 1, expectRule: 'shared-module-public-entry' },
);

// ── Workforce Leave: component boundary ─────────────────────────────────────
// One screen is published; LeavesApprover and the contracts are internal.

// 82. A thin route may compose the Leave public entry.
testCase(
  'accepts a thin route importing the Leave public entry',
  (root) => {
    write(root, 'platforms/workforce/leave/applications/index.ts', `export const LeaveScreen = () => null;
`);
    write(
      root,
      'apps/web/app/leave/page.tsx',
      `import { LeaveScreen } from '@apex/workforce-leave';
export default LeaveScreen;
`,
    );
  },
  { expectExit: 0 },
);

// 83. External code cannot reach Leave internals.
testCase(
  'rejects external code importing a Leave internal screen',
  (root) => {
    write(root, 'platforms/workforce/leave/applications/index.ts', `export const X = 1;
`);
    write(
      root,
      'platforms/intelligence/dashboard/overview/frontend/screens/DashboardScreen.tsx',
      `import LeavesApprover from '@apex/workforce-leave/frontend/components/LeavesApprover';
export default LeavesApprover;
`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 84. ...by dynamic import() too.
testCase(
  'detects dynamic import() of a Leave internal path',
  (root) => {
    write(root, 'platforms/workforce/leave/applications/index.ts', `export const X = 1;
`);
    write(
      root,
      'platforms/operations/projects/project-management/frontend/screens/ProjectsScreen.tsx',
      `export const load = () => import('@apex/workforce-leave/shared/contracts/leave.types');
`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 85. ...and by require().
testCase(
  'detects require() of a Leave internal path',
  (root) => {
    write(root, 'platforms/workforce/leave/applications/index.ts', `export const X = 1;
`);
    write(
      root,
      'platforms/business/sales-crm/leads/frontend/components/LeadList.tsx',
      `const S = require('@apex/workforce-leave/frontend/index');
export default S;
`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 86. Leave frontend must not import backend code.
testCase(
  'rejects Leave frontend importing backend code',
  (root) => {
    write(
      root,
      'platforms/workforce/leave/applications/frontend/screens/LeaveScreen.tsx',
      `import { LeaveService } from '../../backend/services/leave.service';
export default LeaveService;
`,
    );
  },
  { expectExit: 1, expectRule: 'frontend-no-backend' },
);

// 87. Leave must not reach into another platform's internals — attendance and
//     workday in particular are out of scope for this phase.
testCase(
  'rejects Leave importing workday internals',
  (root) => {
    write(root, 'platforms/workforce/attendance/workday/index.ts', `export const X = 1;
`);
    write(
      root,
      'platforms/workforce/leave/applications/frontend/screens/LeaveScreen.tsx',
      `import { WorkdayBar } from '@apex/workforce/attendance/workday/frontend/components/WorkdayBar';
export default WorkdayBar;
`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 88. shared/ must not import Leave — that inverts the graph.
testCase(
  'rejects a shared module importing Leave',
  (root) => {
    write(root, 'platforms/workforce/leave/applications/index.ts', `export const X = 1;
`);
    write(
      root,
      'shared/utilities/leave-helper.ts',
      `import { X } from '@apex/workforce-leave';
export const h = X;
`,
    );
  },
  { expectExit: 1, expectRule: 'shared-no-platforms' },
);

// 89. Leave may consume Shared UI through its declared public subpath.
testCase(
  'accepts Leave importing a shared-ui component subpath',
  (root) => {
    write(root, 'shared/ui/frontend/components/empty-state.tsx', `export const EmptyState = () => null;
`);
    write(
      root,
      'platforms/workforce/leave/applications/frontend/screens/LeaveScreen.tsx',
      `import { EmptyState } from '@apex/shared-ui/components/empty-state';
export default EmptyState;
`,
    );
  },
  { expectExit: 0 },
);

// 90. The Leave exemption covers its three allowlisted targets only.
testCase(
  'accepts a Leave screen importing its allowlisted legacy dependencies',
  (root) => {
    write(
      root,
      'platforms/workforce/leave/applications/frontend/screens/LeaveScreen.tsx',
      `import { leaveApi } from '@/lib/api';
import { cn } from '@/lib/utils';
export default function S() { return null; }
`,
    );
  },
  { expectExit: 0 },
);

// 91. An unallowlisted legacy path is still rejected for Leave.
testCase(
  'rejects a Leave screen importing an unallowlisted legacy path',
  (root) => {
    write(
      root,
      'platforms/workforce/leave/applications/frontend/screens/LeaveScreen.tsx',
      `import { WorkdayBar } from '@/components/workday/WorkdayBar';
export default WorkdayBar;
`,
    );
  },
  { expectExit: 1, expectRule: 'platforms-no-legacy-frontend' },
);

// 92. A Leave file outside frontend/ cannot reuse the exemption — the shared
//     contracts layer must stay framework- and legacy-free.
testCase(
  'rejects a Leave shared-contracts file reusing the legacy exemption',
  (root) => {
    write(
      root,
      'platforms/workforce/leave/applications/shared/contracts/leave.types.ts',
      `import { leaveApi } from '@/lib/api';
export const t = leaveApi;
`,
    );
  },
  { expectExit: 1, expectRule: 'platforms-no-legacy-frontend' },
);

// ── shared/utilities: cross-cutting helpers ─────────────────────────────────
// Bottom of the graph, below shared/ui. cn, formatDate and getInitials were
// extracted from frontend/lib/utils.ts; the domain vocabulary stayed behind.

// 93. Platform code may consume the shared-utilities public entry.
testCase(
  'accepts platform code importing the shared-utilities public entry',
  (root) => {
    write(root, 'shared/utilities/index.ts', `export const cn = (...a) => a.join(' ');
`);
    write(
      root,
      'platforms/workforce/leave/applications/frontend/screens/LeaveScreen.tsx',
      `import { cn } from '@apex/shared-utilities';
export default cn;
`,
    );
  },
  { expectExit: 0 },
);

// 94. Platform code may NOT reach shared-utilities internals.
testCase(
  'rejects platform code importing shared-utilities internals',
  (root) => {
    write(root, 'shared/utilities/index.ts', `export const cn = () => '';
`);
    write(
      root,
      'platforms/operations/projects/project-management/frontend/screens/ProjectsScreen.tsx',
      `import { cn } from '@apex/shared-utilities/class-names';
export default cn;
`,
    );
  },
  { expectExit: 1, expectRule: 'shared-module-public-entry' },
);

// 95. ...by dynamic import() too.
testCase(
  'detects dynamic import() of shared-utilities internals',
  (root) => {
    write(root, 'shared/utilities/index.ts', `export const cn = () => '';
`);
    write(
      root,
      'platforms/intelligence/dashboard/overview/frontend/screens/DashboardScreen.tsx',
      `export const load = () => import('@apex/shared-utilities/date');
`,
    );
  },
  { expectExit: 1, expectRule: 'shared-module-public-entry' },
);

// 96. ...and by require().
testCase(
  'detects require() of shared-utilities internals',
  (root) => {
    write(root, 'shared/utilities/index.ts', `export const cn = () => '';
`);
    write(
      root,
      'platforms/business/sales-crm/leads/frontend/components/LeadList.tsx',
      `const t = require('@apex/shared-utilities/text');
export default t;
`,
    );
  },
  { expectExit: 1, expectRule: 'shared-module-public-entry' },
);

// 97. shared/utilities must not import a platform.
testCase(
  'rejects shared-utilities importing a platform',
  (root) => {
    write(root, 'platforms/workforce/leave/applications/index.ts', `export const X = 1;
`);
    write(
      root,
      'shared/utilities/date.ts',
      `import { X } from '@apex/workforce-leave';
export const d = X;
`,
    );
  },
  { expectExit: 1, expectRule: 'shared-no-platforms' },
);

// 98. shared/utilities must not import the legacy frontend root — this is the
//     rule that kept skeleton/multi-select/status-badge out of shared/ui until
//     cn moved here.
testCase(
  'rejects shared-utilities importing legacy frontend code',
  (root) => {
    write(
      root,
      'shared/utilities/text.ts',
      `import { ROLE_LABELS } from '@/lib/utils';
export const t = ROLE_LABELS;
`,
    );
  },
  { expectExit: 1, expectRule: 'shared-no-legacy-frontend' },
);

// 99. shared/ui may consume shared/utilities through its public entry — the
//     dependency that unblocked the three primitives.
testCase(
  'accepts shared-ui importing shared-utilities publicly',
  (root) => {
    write(root, 'shared/utilities/index.ts', `export const cn = () => '';
`);
    write(
      root,
      'shared/ui/frontend/components/skeleton.tsx',
      `import { cn } from '@apex/shared-utilities';
export const Skeleton = () => cn();
`,
    );
  },
  { expectExit: 0 },
);

// 100. ...but not its internals.
testCase(
  'rejects shared-ui reaching into shared-utilities internals',
  (root) => {
    write(root, 'shared/utilities/index.ts', `export const cn = () => '';
`);
    write(
      root,
      'shared/ui/frontend/components/skeleton.tsx',
      `import { cn } from '@apex/shared-utilities/class-names';
export const S = cn;
`,
    );
  },
  { expectExit: 1, expectRule: 'shared-module-public-entry' },
);

// 101. The three unblocked primitives are published by exact subpath.
testCase(
  'accepts a route importing the newly published skeleton subpath',
  (root) => {
    write(root, 'shared/ui/frontend/components/skeleton.tsx', `export const Skeleton = () => null;
`);
    write(
      root,
      'apps/web/app/tickets/page.tsx',
      `import { Skeleton } from '@apex/shared-ui/components/skeleton';
export default Skeleton;
`,
    );
  },
  { expectExit: 0 },
);

// 102. Their old legacy paths are no longer importable from a platform.
testCase(
  'rejects a platform importing a primitive that moved to shared-ui',
  (root) => {
    write(
      root,
      'platforms/operations/projects/project-management/frontend/screens/ProjectsScreen.tsx',
      `import { Skeleton } from '@/components/ui/skeleton';
export default Skeleton;
`,
    );
  },
  { expectExit: 1, expectRule: 'platforms-no-legacy-frontend' },
);

// ── Core Users: administration component boundary ───────────────────────────
// Admin-facing user directory and detail screens. This component administers
// users; it does NOT own identity - the auth store stays with core/identity.

// 103. A thin route may import the exact declared screen subpath.
testCase(
  'accepts a thin route importing an exact Core Users screen subpath',
  (root) => {
    write(root, 'platforms/core/users/administration/frontend/screens/UsersScreen.tsx', `export default function S() { return null; }
`);
    write(
      root,
      'apps/web/app/users/page.tsx',
      `import UsersScreen from '@apex/core-users/screens/UsersScreen';
export default UsersScreen;
`,
    );
  },
  { expectExit: 0 },
);

// 104. An undeclared screen beside the declared ones stays private.
testCase(
  'rejects an undeclared Core Users screen subpath',
  (root) => {
    write(root, 'platforms/core/users/administration/frontend/screens/SecretScreen.tsx', `export default function S() { return null; }
`);
    write(
      root,
      'apps/web/app/users/page.tsx',
      `import S from '@apex/core-users/screens/SecretScreen';
export default S;
`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 105. External code cannot reach Core Users internals.
testCase(
  'rejects external code importing Core Users internals',
  (root) => {
    write(root, 'platforms/core/users/administration/index.ts', `export const X = 1;
`);
    write(
      root,
      'platforms/workforce/leave/applications/frontend/screens/LeaveScreen.tsx',
      `import UsersScreen from '@apex/core-users/frontend/screens/UsersScreen';
export default UsersScreen;
`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 106. ...by dynamic import() too.
testCase(
  'detects dynamic import() of a Core Users internal path',
  (root) => {
    write(root, 'platforms/core/users/administration/index.ts', `export const X = 1;
`);
    write(
      root,
      'platforms/intelligence/dashboard/overview/frontend/screens/DashboardScreen.tsx',
      `export const load = () => import('@apex/core-users/frontend/index');
`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 107. ...and by require().
testCase(
  'detects require() of a Core Users internal path',
  (root) => {
    write(root, 'platforms/core/users/administration/index.ts', `export const X = 1;
`);
    write(
      root,
      'platforms/business/sales-crm/leads/frontend/components/LeadList.tsx',
      `const S = require('@apex/core-users/frontend/screens/UserDetailScreen');
export default S;
`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 108. Core Users frontend must not import backend code.
testCase(
  'rejects Core Users frontend importing backend code',
  (root) => {
    write(
      root,
      'platforms/core/users/administration/frontend/screens/UsersScreen.tsx',
      `import { UsersService } from '../../backend/services/users.service';
export default UsersService;
`,
    );
  },
  { expectExit: 1, expectRule: 'frontend-no-backend' },
);

// 109. Core Users must not reach into another platform's internals.
testCase(
  'rejects Core Users importing another platform internals',
  (root) => {
    write(root, 'platforms/workforce/leave/applications/index.ts', `export const X = 1;
`);
    write(
      root,
      'platforms/core/users/administration/frontend/screens/UserDetailScreen.tsx',
      `import { LeaveScreen } from '@apex/workforce-leave/frontend/screens/LeaveScreen';
export default LeaveScreen;
`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 110. shared/ must not import Core Users.
testCase(
  'rejects a shared module importing Core Users',
  (root) => {
    write(root, 'platforms/core/users/administration/index.ts', `export const X = 1;
`);
    write(
      root,
      'shared/utilities/user-helper.ts',
      `import { X } from '@apex/core-users';
export const h = X;
`,
    );
  },
  { expectExit: 1, expectRule: 'shared-no-platforms' },
);

// 111. Core Users may consume Shared UI and Shared Utilities publicly.
testCase(
  'accepts Core Users consuming shared-ui and shared-utilities publicly',
  (root) => {
    write(root, 'shared/utilities/index.ts', `export const cn = () => '';
`);
    write(root, 'shared/ui/frontend/components/skeleton.tsx', `export const Skeleton = () => null;
`);
    write(
      root,
      'platforms/core/users/administration/frontend/screens/UsersScreen.tsx',
      `import { cn } from '@apex/shared-utilities';
import { Skeleton } from '@apex/shared-ui/components/skeleton';
export default function S() { return [cn, Skeleton]; }
`,
    );
  },
  { expectExit: 0 },
);

// 112. The Core Users exemption covers its three allowlisted targets only.
testCase(
  'accepts a Core Users screen importing its allowlisted legacy dependencies',
  (root) => {
    write(
      root,
      'platforms/core/users/administration/frontend/screens/UsersScreen.tsx',
      `import { usersApi } from '@/lib/api';
import { STATUS_COLORS } from '@/lib/utils';
export default function S() { return null; }
`,
    );
  },
  { expectExit: 0 },
);

// 113. An unallowlisted legacy path is still rejected for Core Users.
testCase(
  'rejects a Core Users screen importing an unallowlisted legacy path',
  (root) => {
    write(
      root,
      'platforms/core/users/administration/frontend/screens/UsersScreen.tsx',
      `import { WorkdayBar } from '@/components/workday/WorkdayBar';
export default WorkdayBar;
`,
    );
  },
  { expectExit: 1, expectRule: 'platforms-no-legacy-frontend' },
);

// 114. The auth-store exemptions stay narrow: a Sales CRM sibling still cannot
//      reach the store just because Core Users may.
testCase(
  'rejects a non-exempt Sales CRM file importing the legacy auth store',
  (root) => {
    write(
      root,
      'platforms/business/sales-crm/shared/frontend/api/audit-log.ts',
      `import { useAuthStore } from '@/store/auth.store';
export const a = useAuthStore;
`,
    );
  },
  { expectExit: 1, expectRule: 'platforms-no-legacy-frontend' },
);

// ── Core Identity: authentication state boundary ────────────────────────────
// The adapter re-exports the legacy Zustand store. The store itself did NOT
// move: 29 legacy consumers still import it directly and there is no frontend
// test covering login, logout, hydration or the 401 path.

// 115. Platform code may consume the Core Identity public auth binding.
testCase(
  'accepts a platform importing the Core Identity auth binding',
  (root) => {
    write(root, 'platforms/core/identity/authentication/index.ts', `export const useAuthStore = () => null;
`);
    write(
      root,
      'platforms/workforce/leave/applications/frontend/screens/LeaveScreen.tsx',
      `import { useAuthStore } from '@apex/core-identity';
export default useAuthStore;
`,
    );
  },
  { expectExit: 0 },
);

// 116. External code cannot reach Core Identity state internals.
testCase(
  'rejects external code importing Core Identity state internals',
  (root) => {
    write(root, 'platforms/core/identity/authentication/index.ts', `export const X = 1;
`);
    write(
      root,
      'platforms/operations/projects/project-management/frontend/screens/ProjectsScreen.tsx',
      `import { useAuthStore } from '@apex/core-identity/frontend/state/auth-store.adapter';
export default useAuthStore;
`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 117. ...by dynamic import() too.
testCase(
  'detects dynamic import() of Core Identity state internals',
  (root) => {
    write(root, 'platforms/core/identity/authentication/index.ts', `export const X = 1;
`);
    write(
      root,
      'platforms/intelligence/dashboard/overview/frontend/screens/DashboardScreen.tsx',
      `export const load = () => import('@apex/core-identity/frontend/state/auth-store.adapter');
`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 118. ...and by require().
testCase(
  'detects require() of Core Identity state internals',
  (root) => {
    write(root, 'platforms/core/identity/authentication/index.ts', `export const X = 1;
`);
    write(
      root,
      'platforms/core/users/administration/frontend/screens/UsersScreen.tsx',
      `const s = require('@apex/core-identity/frontend/index');
export default s;
`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 119. shared/ must not import Core Identity.
testCase(
  'rejects a shared module importing Core Identity',
  (root) => {
    write(root, 'platforms/core/identity/authentication/index.ts', `export const X = 1;
`);
    write(
      root,
      'shared/utilities/identity-helper.ts',
      `import { X } from '@apex/core-identity';
export const h = X;
`,
    );
  },
  { expectExit: 1, expectRule: 'shared-no-platforms' },
);

// 120. Core Identity frontend must not import backend code.
testCase(
  'rejects Core Identity frontend importing backend code',
  (root) => {
    write(
      root,
      'platforms/core/identity/authentication/frontend/state/auth-store.adapter.ts',
      `import { AuthService } from '../../backend/services/auth.service';
export default AuthService;
`,
    );
  },
  { expectExit: 1, expectRule: 'frontend-no-backend' },
);

// 121. Core Identity must not reach into another platform's internals.
testCase(
  'rejects Core Identity importing another platform internals',
  (root) => {
    write(root, 'platforms/core/users/administration/index.ts', `export const X = 1;
`);
    write(
      root,
      'platforms/core/identity/authentication/frontend/state/auth-store.adapter.ts',
      `import UsersScreen from '@apex/core-users/frontend/screens/UsersScreen';
export default UsersScreen;
`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 122. The adapter may import exactly frontend/store/auth.store.ts.
testCase(
  'accepts the Core Identity adapter importing the legacy auth store',
  (root) => {
    write(
      root,
      'platforms/core/identity/authentication/frontend/state/auth-store.adapter.ts',
      `export { useAuthStore } from '@/store/auth.store';
`,
    );
  },
  { expectExit: 0 },
);

// 123. No sibling Core Identity file may reuse that exemption.
testCase(
  'rejects a sibling Core Identity file reusing the auth-store exemption',
  (root) => {
    write(
      root,
      'platforms/core/identity/authentication/frontend/state/other.ts',
      `import { useAuthStore } from '@/store/auth.store';
export const o = useAuthStore;
`,
    );
  },
  { expectExit: 1, expectRule: 'platforms-no-legacy-frontend' },
);

// 124. The adapter may not reach any OTHER legacy path.
testCase(
  'rejects the Core Identity adapter importing an unallowlisted legacy path',
  (root) => {
    write(
      root,
      'platforms/core/identity/authentication/frontend/state/auth-store.adapter.ts',
      `import { authApi } from '@/lib/api';
export const a = authApi;
`,
    );
  },
  { expectExit: 1, expectRule: 'platforms-no-legacy-frontend' },
);

// 125. Platform components may no longer reach the legacy store directly —
//      that is the whole point of the adapter.
testCase(
  'rejects a platform importing the legacy auth store directly',
  (root) => {
    write(
      root,
      'platforms/intelligence/dashboard/overview/frontend/screens/DashboardScreen.tsx',
      `import { useAuthStore } from '@/store/auth.store';
export default useAuthStore;
`,
    );
  },
  { expectExit: 1, expectRule: 'platforms-no-legacy-frontend' },
);

// ── Core Identity behaviour lock ────────────────────────────────────────────
// Authentication is the one area where a silent regression logs every user
// out. These assert the invariants the adapter phase promised NOT to touch.

assertContract('the legacy auth store is untouched by the adapter phase', () => {
  const raw = readRepo('frontend/store/auth.store.ts');
  if (raw === null) return ['frontend/store/auth.store.ts is missing'];
  const src = codeOf(raw);
  const problems = [];
  const required = [
    "name: 'apex-auth'",                      // persist key
    "localStorage.setItem('apex_token', token)",
    "localStorage.removeItem('apex_token')",
    "localStorage.removeItem('apexMode')",
    'partialize:',
    'onRehydrateStorage:',
    'setHasHydrated',
    'hasHydrated:',
    'isAuthenticated:',
    'setAuth:',
    'logout:',
    'updateUser:',
  ];
  for (const r of required) if (!src.includes(r)) problems.push(`missing from auth.store.ts: ${r}`);
  // the store must remain free of any adapter/platform coupling
  for (const f of ['@apex/', 'platforms/']) {
    if (src.includes(f)) problems.push(`auth.store.ts must not reference: ${f}`);
  }
  return problems;
});

assertContract('the Core Identity adapter re-exports without wrapping', () => {
  const rel = 'platforms/core/identity/authentication/frontend/state/auth-store.adapter.ts';
  const raw = readRepo(rel);
  if (raw === null) return [`${rel} is missing`];
  const src = codeOf(raw);
  const problems = [];
  if (!src.includes("export { useAuthStore } from '@/store/auth.store';")) {
    problems.push('the adapter must be a bare re-export of the legacy store');
  }
  // a second store, a wrapper or a selector would change behaviour
  for (const forbidden of ['create(', 'persist(', 'useState', 'useEffect', 'useMemo', 'zustand']) {
    if (src.includes(forbidden)) problems.push(`adapter must not contain: ${forbidden}`);
  }
  return problems;
});

assertContract('shared/auth still owns the token and 401 contract', () => {
  const raw = readRepo('shared/auth/frontend/authenticated-api-client.ts');
  if (raw === null) return ['shared/auth client is missing'];
  const src = codeOf(raw);
  const required = [
    "localStorage.getItem('apex_token')",
    "localStorage.removeItem('apex_token')",
    "localStorage.removeItem('apex-auth')",
    "localStorage.getItem('nexus_token')",
    "localStorage.removeItem('nexus_token')",
    "localStorage.removeItem('nexus_user')",
    "localStorage.removeItem('nexus-auth')",
    "'/login?expired=true'",
  ];
  return required.filter((r) => !src.includes(r)).map((r) => `missing from shared/auth: ${r}`);
});

assertContract('no platform component imports the legacy auth store directly', () => {
  const problems = [];
  for (const f of repoSources().filter((x) => x.startsWith('platforms/'))) {
    const src = codeOf(readRepo(f) ?? '');
    if (!/from\s*['"]@\/store\/auth\.store['"]/.test(src)) continue;
    if (f.endsWith('frontend/state/auth-store.adapter.ts')) continue; // the one exemption
    problems.push(`${f} still imports the legacy auth store directly`);
  }
  return problems;
});

assertContract('the legacy auth-store consumer set only shrinks by compartmentalisation', () => {
  // The adapter phase left all 29 legacy consumers alone. Core Users Profiles
  // then took 2 of them OUT of frontend/ entirely - the screens moved into
  // platforms/ and now read the store through @apex/core-identity, so they are
  // no longer legacy consumers at all. That is the only sanctioned way this
  // number moves: a screen leaves frontend/ with its import rewritten to the
  // public boundary. An in-place rewrite of a file that stays in frontend/
  // would still be an unvalidated auth migration, and the route-adapter check
  // below is what distinguishes the two.
  const problems = [];
  const legacy = repoSources()
    .filter((f) => f.startsWith('frontend/'))
    .filter((f) => /from\s*['"]@\/store\/auth\.store['"]/.test(codeOf(readRepo(f) ?? '')));
  if (legacy.length !== 26) {
    problems.push(`expected 26 legacy auth-store consumers, found ${legacy.length}`);
  }
  // Each one that left must be a thin adapter carrying no auth dependency at
  // all, and must reach its screen through that component's public entry.
  // 29 -> 27 was core/users/profiles; 27 -> 26 was intelligence/analytics.
  const DEPARTED = {
    'frontend/app/(dashboard)/profile/page.tsx': '@apex/core-users-profiles/screens/',
    'frontend/app/(dashboard)/(platform)/users/[id]/profile/page.tsx': '@apex/core-users-profiles/screens/',
    'frontend/app/(dashboard)/analytics/page.tsx': '@apex/intelligence-analytics',
  };
  for (const [route, entry] of Object.entries(DEPARTED)) {
    const src = codeOf(readRepo(route) ?? '');
    if (src === '') {
      problems.push(`${route} is missing - the route must survive as an adapter`);
      continue;
    }
    if (src.includes('auth.store')) problems.push(`${route} must not import the auth store`);
    if (src.includes('@apex/core-identity')) {
      problems.push(`${route} is an adapter; auth belongs in the screen, not the route`);
    }
    if (!src.includes(entry)) {
      problems.push(`${route} must reach its screen through ${entry}`);
    }
  }
  return problems;
});

// ── System Public Site: unauthenticated surface ─────────────────────────────
// D4: the marketing and legal screens. No backend, no legacy dependency, and
// no debt - the only component so far that carries none.

// 126. A thin route may import an exact declared screen subpath.
testCase(
  'accepts a thin public route importing an exact System screen subpath',
  (root) => {
    write(root, 'platforms/system/public-site/frontend/screens/ApexLandingPage.tsx', `export const ApexLandingPage = () => null;
`);
    write(
      root,
      'apps/web/app/page.tsx',
      `import { ApexLandingPage } from '@apex/system-public-site/screens/ApexLandingPage';
export default ApexLandingPage;
`,
    );
  },
  { expectExit: 0 },
);

// 127. An undeclared screen beside the declared ones stays private.
testCase(
  'rejects an undeclared System public-site screen subpath',
  (root) => {
    write(root, 'platforms/system/public-site/frontend/screens/SecretScreen.tsx', `export default function S() { return null; }
`);
    write(
      root,
      'apps/web/app/page.tsx',
      `import S from '@apex/system-public-site/screens/SecretScreen';
export default S;
`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 128. External code cannot reach System public-site internals.
testCase(
  'rejects external code importing System public-site internals',
  (root) => {
    write(root, 'platforms/system/public-site/index.ts', `export const X = 1;
`);
    write(
      root,
      'platforms/intelligence/dashboard/overview/frontend/screens/DashboardScreen.tsx',
      `import { ApexLandingPage } from '@apex/system-public-site/frontend/screens/ApexLandingPage';
export default ApexLandingPage;
`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 129. ...by dynamic import() too.
testCase(
  'detects dynamic import() of System public-site internals',
  (root) => {
    write(root, 'platforms/system/public-site/index.ts', `export const X = 1;
`);
    write(
      root,
      'platforms/core/users/administration/frontend/screens/UsersScreen.tsx',
      `export const load = () => import('@apex/system-public-site/frontend/index');
`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 130. ...and by require().
testCase(
  'detects require() of System public-site internals',
  (root) => {
    write(root, 'platforms/system/public-site/index.ts', `export const X = 1;
`);
    write(
      root,
      'platforms/workforce/leave/applications/frontend/screens/LeaveScreen.tsx',
      `const S = require('@apex/system-public-site/frontend/screens/TermsScreen');
export default S;
`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 131. System frontend must not import backend code.
testCase(
  'rejects System frontend importing backend code',
  (root) => {
    write(
      root,
      'platforms/system/public-site/frontend/screens/ApexLandingPage.tsx',
      `import { HealthService } from '../../backend/services/health.service';
export default HealthService;
`,
    );
  },
  { expectExit: 1, expectRule: 'frontend-no-backend' },
);

// 132. System must not reach into another platform's internals.
testCase(
  'rejects System importing another platform internals',
  (root) => {
    write(root, 'platforms/core/users/administration/index.ts', `export const X = 1;
`);
    write(
      root,
      'platforms/system/public-site/frontend/screens/ApexLandingPage.tsx',
      `import UsersScreen from '@apex/core-users/frontend/screens/UsersScreen';
export default UsersScreen;
`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 133. shared/ must not import System.
testCase(
  'rejects a shared module importing System public-site',
  (root) => {
    write(root, 'platforms/system/public-site/index.ts', `export const X = 1;
`);
    write(
      root,
      'shared/utilities/public-helper.ts',
      `import { X } from '@apex/system-public-site';
export const h = X;
`,
    );
  },
  { expectExit: 1, expectRule: 'shared-no-platforms' },
);

// 134. System may consume Shared UI, Shared Utilities and Core Identity
//      through their public entries - it just does not need to today.
testCase(
  'accepts System consuming shared-ui, shared-utilities and core-identity publicly',
  (root) => {
    write(root, 'shared/utilities/index.ts', `export const cn = () => '';
`);
    write(root, 'shared/ui/frontend/components/empty-state.tsx', `export const EmptyState = () => null;
`);
    write(root, 'platforms/core/identity/authentication/index.ts', `export const useAuthStore = () => null;
`);
    write(
      root,
      'platforms/system/public-site/frontend/screens/ApexLandingPage.tsx',
      `import { cn } from '@apex/shared-utilities';
import { EmptyState } from '@apex/shared-ui/components/empty-state';
import { useAuthStore } from '@apex/core-identity';
export default function S() { return [cn, EmptyState, useAuthStore]; }
`,
    );
  },
  { expectExit: 0 },
);

// 135. System carries NO legacy exemption - any legacy import is rejected.
testCase(
  'rejects System public-site importing any legacy frontend path',
  (root) => {
    write(
      root,
      'platforms/system/public-site/frontend/screens/ApexLandingPage.tsx',
      `import { cn } from '@/lib/utils';
export default cn;
`,
    );
  },
  { expectExit: 1, expectRule: 'platforms-no-legacy-frontend' },
);

// ── Core Users Profiles: the two profile surfaces ──────────────────────────
// The second component in the core/users module. Its defining property is that
// it is the FIRST component to consume authentication through @apex/core-identity
// instead of importing frontend/store/auth.store.ts directly — so the tests
// below lock that in rather than merely allowing it.

// 136. The /profile route may import its exact declared screen subpath.
testCase(
  'accepts the /profile route importing the exact ProfileScreen subpath',
  (root) => {
    write(root, 'platforms/core/users/profiles/frontend/screens/ProfileScreen.tsx', `export default function S() { return null; }
`);
    write(
      root,
      'apps/web/app/profile/page.tsx',
      `import ProfileScreen from '@apex/core-users-profiles/screens/ProfileScreen';
export default ProfileScreen;
`,
    );
  },
  { expectExit: 0 },
);

// 137. ...and /users/[id]/profile may import its own screen subpath.
testCase(
  'accepts the /users/[id]/profile route importing the exact UserProfileScreen subpath',
  (root) => {
    write(root, 'platforms/core/users/profiles/frontend/screens/UserProfileScreen.tsx', `export default function S() { return null; }
`);
    write(
      root,
      'apps/web/app/users/[id]/profile/page.tsx',
      `import UserProfileScreen from '@apex/core-users-profiles/screens/UserProfileScreen';
export default UserProfileScreen;
`,
    );
  },
  { expectExit: 0 },
);

// 138. An undeclared screen beside the two declared ones stays private.
testCase(
  'rejects an undeclared Core Users Profiles screen subpath',
  (root) => {
    write(root, 'platforms/core/users/profiles/frontend/screens/PayrollScreen.tsx', `export default function S() { return null; }
`);
    write(
      root,
      'apps/web/app/profile/page.tsx',
      `import S from '@apex/core-users-profiles/screens/PayrollScreen';
export default S;
`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 139. External code cannot reach Profiles internals.
testCase(
  'rejects external code importing Core Users Profiles internals',
  (root) => {
    write(root, 'platforms/core/users/profiles/index.ts', `export const X = 1;
`);
    write(
      root,
      'platforms/intelligence/dashboard/overview/frontend/screens/DashboardScreen.tsx',
      `import { ActivityItem } from '@apex/core-users-profiles/frontend/components/activity-item';
export default ActivityItem;
`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 140. ...by dynamic import() too.
testCase(
  'detects dynamic import() of Core Users Profiles internals',
  (root) => {
    write(root, 'platforms/core/users/profiles/index.ts', `export const X = 1;
`);
    write(
      root,
      'platforms/system/public-site/frontend/screens/ApexLandingPage.tsx',
      `export const load = () => import('@apex/core-users-profiles/frontend/index');
`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 141. ...and by require().
testCase(
  'detects require() of Core Users Profiles internals',
  (root) => {
    write(root, 'platforms/core/users/profiles/index.ts', `export const X = 1;
`);
    write(
      root,
      'platforms/workforce/leave/applications/frontend/screens/LeaveScreen.tsx',
      `const S = require('@apex/core-users-profiles/frontend/screens/ProfileScreen');
export default S;
`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 142. Profiles frontend must not import backend code.
testCase(
  'rejects Core Users Profiles frontend importing backend code',
  (root) => {
    write(
      root,
      'platforms/core/users/profiles/frontend/screens/UserProfileScreen.tsx',
      `import { UsersService } from '../../backend/services/users.service';
export default UsersService;
`,
    );
  },
  { expectExit: 1, expectRule: 'frontend-no-backend' },
);

// 143. Profiles must not reach into another platform's internals.
testCase(
  'rejects Core Users Profiles importing another platform internals',
  (root) => {
    write(root, 'platforms/operations/projects/project-management/index.ts', `export const X = 1;
`);
    write(
      root,
      'platforms/core/users/profiles/frontend/screens/ProfileScreen.tsx',
      `import ProjectsScreen from '@apex/operations-projects/frontend/screens/ProjectsScreen';
export default ProjectsScreen;
`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 144. Profiles reaches its SIBLING component only through its public entry —
//      administration and profiles are two components, not one folder.
testCase(
  'rejects Core Users Profiles importing Core Users Administration internals',
  (root) => {
    write(root, 'platforms/core/users/administration/index.ts', `export const X = 1;
`);
    write(
      root,
      'platforms/core/users/profiles/frontend/screens/UserProfileScreen.tsx',
      `import UsersScreen from '@apex/core-users/frontend/screens/UsersScreen';
export default UsersScreen;
`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 145. Profiles may consume Core Identity through its public entry.
testCase(
  'accepts Core Users Profiles consuming Core Identity publicly',
  (root) => {
    write(root, 'platforms/core/identity/authentication/index.ts', `export const useAuthStore = () => null;
`);
    write(
      root,
      'platforms/core/users/profiles/frontend/screens/ProfileScreen.tsx',
      `import { useAuthStore } from '@apex/core-identity';
export default function S() { return useAuthStore(); }
`,
    );
  },
  { expectExit: 0 },
);

// 146. ...but ONLY through it — the adapter file itself stays private.
testCase(
  'rejects Core Users Profiles reaching past the Core Identity public entry',
  (root) => {
    write(root, 'platforms/core/identity/authentication/index.ts', `export const useAuthStore = () => null;
`);
    write(
      root,
      'platforms/core/users/profiles/frontend/screens/ProfileScreen.tsx',
      `import { useAuthStore } from '@apex/core-identity/frontend/state/auth-store.adapter';
export default function S() { return useAuthStore(); }
`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 147. A direct legacy auth-store import from Profiles is rejected. The
//      DEBT-P8 allowlist deliberately omits frontend/store/auth.store.ts, so
//      the boundary cannot be re-crossed by a later edit to this component.
testCase(
  'rejects Core Users Profiles importing the legacy auth store directly',
  (root) => {
    write(
      root,
      'platforms/core/users/profiles/frontend/screens/ProfileScreen.tsx',
      `import { useAuthStore } from '@/store/auth.store';
export default function S() { return useAuthStore(); }
`,
    );
  },
  { expectExit: 1, expectRule: 'platforms-no-legacy-frontend' },
);

// 148. Profiles may consume Shared UI and Shared Utilities publicly.
testCase(
  'accepts Core Users Profiles consuming shared-ui and shared-utilities publicly',
  (root) => {
    write(root, 'shared/utilities/index.ts', `export const getInitials = () => '';
`);
    write(root, 'shared/ui/frontend/components/skeleton.tsx', `export const Skeleton = () => null;
`);
    write(
      root,
      'platforms/core/users/profiles/frontend/components/activity-item.tsx',
      `import { getInitials } from '@apex/shared-utilities';
import { Skeleton } from '@apex/shared-ui/components/skeleton';
export default function S() { return [getInitials, Skeleton]; }
`,
    );
  },
  { expectExit: 0 },
);

// 149. shared/ must not import Profiles.
testCase(
  'rejects a shared module importing Core Users Profiles',
  (root) => {
    write(root, 'platforms/core/users/profiles/index.ts', `export const X = 1;
`);
    write(
      root,
      'shared/ui/frontend/components/user-avatar.tsx',
      `import { X } from '@apex/core-users-profiles';
export const A = X;
`,
    );
  },
  { expectExit: 1, expectRule: 'shared-no-platforms' },
);

// 150. The DEBT-P8 allowlist covers exactly its three targets...
testCase(
  'accepts the three allowlisted Core Users Profiles legacy targets',
  (root) => {
    write(
      root,
      'platforms/core/users/profiles/frontend/screens/ProfileScreen.tsx',
      `import { usersApi } from '@/lib/api';
import { formatRelativeTime } from '@/lib/utils';
import { TicketRow } from '@/components/tickets/ticket-row';
export default function S() { return [usersApi, formatRelativeTime, TicketRow]; }
`,
    );
  },
  { expectExit: 0 },
);

// 151. ...and nothing else.
testCase(
  'rejects an unallowlisted legacy target from Core Users Profiles',
  (root) => {
    write(
      root,
      'platforms/core/users/profiles/frontend/screens/ProfileScreen.tsx',
      `import { Sidebar } from '@/components/layout/sidebar';
export default Sidebar;
`,
    );
  },
  { expectExit: 1, expectRule: 'platforms-no-legacy-frontend' },
);

// 152. The exemption is scoped to frontend/ — a sibling folder cannot reuse it.
testCase(
  'rejects a Core Users Profiles file outside frontend/ reusing the exemption',
  (root) => {
    write(
      root,
      'platforms/core/users/profiles/shared/contracts/profile.types.ts',
      `import { usersApi } from '@/lib/api';
export const t = usersApi;
`,
    );
  },
  { expectExit: 1, expectRule: 'platforms-no-legacy-frontend' },
);

// 153. Administration must not borrow the Profiles allowlist. Its own DEBT-P6
//      entry names only lib/api.ts and lib/utils.ts, so ticket-row is out.
testCase(
  'rejects Core Users Administration reusing the Profiles legacy allowlist',
  (root) => {
    write(
      root,
      'platforms/core/users/administration/frontend/screens/UsersScreen.tsx',
      `import { TicketRow } from '@/components/tickets/ticket-row';
export default TicketRow;
`,
    );
  },
  { expectExit: 1, expectRule: 'platforms-no-legacy-frontend' },
);

// ── Core Users Change Requests: the approvals queue ────────────────────────
// The third component in the core/users module. It performs approve and reject
// actions, so the tests below guard the boundary AND the authorization surface:
// the screen has no client-side role check at all, and that must stay true —
// queue scoping is backend-driven through listPendingApprovals.

// 154. The /admin/approvals route may consume the public entry.
testCase(
  'accepts the /admin/approvals route consuming the Change Requests public entry',
  (root) => {
    write(root, 'platforms/core/users/change-requests/index.ts', `export const ApprovalsScreen = () => null;
`);
    write(
      root,
      'apps/web/app/admin/approvals/page.tsx',
      `import { ApprovalsScreen } from '@apex/core-users-change-requests';
export default ApprovalsScreen;
`,
    );
  },
  { expectExit: 0 },
);

// 155. External code cannot reach Change Requests internals.
testCase(
  'rejects external code importing Core Users Change Requests internals',
  (root) => {
    write(root, 'platforms/core/users/change-requests/index.ts', `export const X = 1;
`);
    write(
      root,
      'platforms/intelligence/dashboard/overview/frontend/screens/DashboardScreen.tsx',
      `import { ApprovalsScreen } from '@apex/core-users-change-requests/frontend/screens/ApprovalsScreen';
export default ApprovalsScreen;
`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 156. ...by dynamic import() too.
testCase(
  'detects dynamic import() of Core Users Change Requests internals',
  (root) => {
    write(root, 'platforms/core/users/change-requests/index.ts', `export const X = 1;
`);
    write(
      root,
      'platforms/core/users/profiles/frontend/screens/ProfileScreen.tsx',
      `export const load = () => import('@apex/core-users-change-requests/frontend/index');
`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 157. ...and by require().
testCase(
  'detects require() of Core Users Change Requests internals',
  (root) => {
    write(root, 'platforms/core/users/change-requests/index.ts', `export const X = 1;
`);
    write(
      root,
      'platforms/system/public-site/frontend/screens/ApexLandingPage.tsx',
      `const S = require('@apex/core-users-change-requests/frontend/screens/ApprovalsScreen');
export default S;
`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 158. Change Requests frontend must not import backend code.
testCase(
  'rejects Core Users Change Requests frontend importing backend code',
  (root) => {
    write(
      root,
      'platforms/core/users/change-requests/frontend/screens/ApprovalsScreen.tsx',
      `import { ChangeRequestsService } from '../../backend/services/change-requests.service';
export default ChangeRequestsService;
`,
    );
  },
  { expectExit: 1, expectRule: 'frontend-no-backend' },
);

// 159. Change Requests must not reach into another platform's internals.
testCase(
  'rejects Core Users Change Requests importing another platform internals',
  (root) => {
    write(root, 'platforms/workforce/leave/applications/index.ts', `export const X = 1;
`);
    write(
      root,
      'platforms/core/users/change-requests/frontend/screens/ApprovalsScreen.tsx',
      `import { LeaveScreen } from '@apex/workforce-leave/frontend/screens/LeaveScreen';
export default LeaveScreen;
`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 160. ...including its two sibling components in the same module.
testCase(
  'rejects Core Users Change Requests importing its sibling components internals',
  (root) => {
    write(root, 'platforms/core/users/administration/index.ts', `export const X = 1;
`);
    write(root, 'platforms/core/users/profiles/index.ts', `export const Y = 1;
`);
    write(
      root,
      'platforms/core/users/change-requests/frontend/screens/ApprovalsScreen.tsx',
      `import UsersScreen from '@apex/core-users/frontend/screens/UsersScreen';
import ProfileScreen from '@apex/core-users-profiles/frontend/screens/ProfileScreen';
export default function S() { return [UsersScreen, ProfileScreen]; }
`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 161. Change Requests may consume Core Identity through its public entry.
testCase(
  'accepts Core Users Change Requests consuming Core Identity publicly',
  (root) => {
    write(root, 'platforms/core/identity/authentication/index.ts', `export const useAuthStore = () => null;
`);
    write(
      root,
      'platforms/core/users/change-requests/frontend/screens/ApprovalsScreen.tsx',
      `import { useAuthStore } from '@apex/core-identity';
export default function S() { return useAuthStore(); }
`,
    );
  },
  { expectExit: 0 },
);

// 162. A direct legacy auth-store import from Change Requests is rejected. The
//      screen carries no frontend auth dependency today, and the DEBT-P9
//      allowlist names only lib/api.ts, so it cannot acquire one silently.
testCase(
  'rejects Core Users Change Requests importing the legacy auth store directly',
  (root) => {
    write(
      root,
      'platforms/core/users/change-requests/frontend/screens/ApprovalsScreen.tsx',
      `import { useAuthStore } from '@/store/auth.store';
export default function S() { return useAuthStore(); }
`,
    );
  },
  { expectExit: 1, expectRule: 'platforms-no-legacy-frontend' },
);

// 163. Change Requests may consume Shared UI and Shared Utilities publicly.
testCase(
  'accepts Core Users Change Requests consuming shared-ui and shared-utilities publicly',
  (root) => {
    write(root, 'shared/utilities/index.ts', `export const formatDate = () => '';
`);
    write(root, 'shared/ui/frontend/components/skeleton.tsx', `export const Skeleton = () => null;
`);
    write(
      root,
      'platforms/core/users/change-requests/frontend/screens/ApprovalsScreen.tsx',
      `import { formatDate } from '@apex/shared-utilities';
import { Skeleton } from '@apex/shared-ui/components/skeleton';
export default function S() { return [formatDate, Skeleton]; }
`,
    );
  },
  { expectExit: 0 },
);

// 164. shared/ must not import Change Requests.
testCase(
  'rejects a shared module importing Core Users Change Requests',
  (root) => {
    write(root, 'platforms/core/users/change-requests/index.ts', `export const X = 1;
`);
    write(
      root,
      'shared/utilities/approval-helper.ts',
      `import { X } from '@apex/core-users-change-requests';
export const h = X;
`,
    );
  },
  { expectExit: 1, expectRule: 'shared-no-platforms' },
);

// 165. The DEBT-P9 allowlist covers lib/api.ts...
testCase(
  'accepts the single allowlisted Core Users Change Requests legacy target',
  (root) => {
    write(
      root,
      'platforms/core/users/change-requests/frontend/screens/ApprovalsScreen.tsx',
      `import { changeRequestsApi, departmentsApi, usersApi, rolesApi } from '@/lib/api';
export default function S() { return [changeRequestsApi, departmentsApi, usersApi, rolesApi]; }
`,
    );
  },
  { expectExit: 0 },
);

// 166. ...and nothing else - not even lib/utils, which siblings are allowed.
testCase(
  'rejects lib/utils from Core Users Change Requests despite siblings allowing it',
  (root) => {
    write(
      root,
      'platforms/core/users/change-requests/frontend/screens/ApprovalsScreen.tsx',
      `import { formatDate } from '@/lib/utils';
export default formatDate;
`,
    );
  },
  { expectExit: 1, expectRule: 'platforms-no-legacy-frontend' },
);

// 167. The exemption is scoped to frontend/ - a sibling folder cannot reuse it.
testCase(
  'rejects a Core Users Change Requests file outside frontend/ reusing the exemption',
  (root) => {
    write(
      root,
      'platforms/core/users/change-requests/shared/contracts/change-request.types.ts',
      `import { changeRequestsApi } from '@/lib/api';
export const t = changeRequestsApi;
`,
    );
  },
  { expectExit: 1, expectRule: 'platforms-no-legacy-frontend' },
);

// ── Intelligence Analytics: the /analytics workspace ───────────────────────
// The second component in the intelligence platform, and the first to take
// custody of the two charts the Dashboard phase declined. It is a read-only
// screen: it declares no mutation, so its role checks gate views only.

// 168. The /analytics route may consume the public entry.
testCase(
  'accepts the /analytics route consuming the Intelligence Analytics public entry',
  (root) => {
    write(root, 'platforms/intelligence/analytics/overview/index.ts', `export const AnalyticsScreen = () => null;
`);
    write(
      root,
      'apps/web/app/analytics/page.tsx',
      `import { AnalyticsScreen } from '@apex/intelligence-analytics';
export default AnalyticsScreen;
`,
    );
  },
  { expectExit: 0 },
);

// 169. External code cannot reach Analytics internals.
testCase(
  'rejects external code importing Intelligence Analytics internals',
  (root) => {
    write(root, 'platforms/intelligence/analytics/overview/index.ts', `export const X = 1;
`);
    write(
      root,
      'platforms/core/users/profiles/frontend/screens/UserProfileScreen.tsx',
      `import { CategoryChart } from '@apex/intelligence-analytics/frontend/components/category-chart';
export default CategoryChart;
`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 170. ...by dynamic import() too.
testCase(
  'detects dynamic import() of Intelligence Analytics internals',
  (root) => {
    write(root, 'platforms/intelligence/analytics/overview/index.ts', `export const X = 1;
`);
    write(
      root,
      'platforms/intelligence/dashboard/overview/frontend/screens/DashboardScreen.tsx',
      `export const load = () => import('@apex/intelligence-analytics/frontend/index');
`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 171. ...and by require().
testCase(
  'detects require() of Intelligence Analytics internals',
  (root) => {
    write(root, 'platforms/intelligence/analytics/overview/index.ts', `export const X = 1;
`);
    write(
      root,
      'platforms/core/users/change-requests/frontend/screens/ApprovalsScreen.tsx',
      `const S = require('@apex/intelligence-analytics/frontend/screens/AnalyticsScreen');
export default S;
`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 172. Analytics frontend must not import backend code.
testCase(
  'rejects Intelligence Analytics frontend importing backend code',
  (root) => {
    write(
      root,
      'platforms/intelligence/analytics/overview/frontend/screens/AnalyticsScreen.tsx',
      `import { AnalyticsService } from '../../backend/services/analytics.service';
export default AnalyticsService;
`,
    );
  },
  { expectExit: 1, expectRule: 'frontend-no-backend' },
);

// 173. Analytics must not reach into another platform's internals.
testCase(
  'rejects Intelligence Analytics importing another platform internals',
  (root) => {
    write(root, 'platforms/operations/projects/project-management/index.ts', `export const X = 1;
`);
    write(
      root,
      'platforms/intelligence/analytics/overview/frontend/screens/AnalyticsScreen.tsx',
      `import ProjectsScreen from '@apex/operations-projects/frontend/screens/ProjectsScreen';
export default ProjectsScreen;
`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 174. ...including its sibling Dashboard component in the same platform.
//      analytics and dashboard are two components, not one intelligence blob.
testCase(
  'rejects Intelligence Analytics importing Intelligence Dashboard internals',
  (root) => {
    write(root, 'platforms/intelligence/dashboard/overview/index.ts', `export const X = 1;
`);
    write(
      root,
      'platforms/intelligence/analytics/overview/frontend/screens/AnalyticsScreen.tsx',
      `import { StatCard } from '@apex/intelligence-dashboard/frontend/components/stat-card';
export default StatCard;
`,
    );
  },
  { expectExit: 1, expectRule: 'component-public-entry' },
);

// 175. Analytics may consume Core Identity through its public entry.
testCase(
  'accepts Intelligence Analytics consuming Core Identity publicly',
  (root) => {
    write(root, 'platforms/core/identity/authentication/index.ts', `export const useAuthStore = () => null;
`);
    write(
      root,
      'platforms/intelligence/analytics/overview/frontend/screens/AnalyticsScreen.tsx',
      `import { useAuthStore } from '@apex/core-identity';
export default function S() { return useAuthStore(); }
`,
    );
  },
  { expectExit: 0 },
);

// 176. ...but a direct legacy auth-store import is rejected. DEBT-P10 names
//      only lib/api.ts, so the screen cannot fall back to the legacy store.
testCase(
  'rejects Intelligence Analytics importing the legacy auth store directly',
  (root) => {
    write(
      root,
      'platforms/intelligence/analytics/overview/frontend/screens/AnalyticsScreen.tsx',
      `import { useAuthStore } from '@/store/auth.store';
export default function S() { return useAuthStore(); }
`,
    );
  },
  { expectExit: 1, expectRule: 'platforms-no-legacy-frontend' },
);

// 177. Analytics may consume Shared UI and Shared Utilities publicly.
testCase(
  'accepts Intelligence Analytics consuming shared-ui and shared-utilities publicly',
  (root) => {
    write(root, 'shared/utilities/index.ts', `export const cn = () => '';
`);
    write(root, 'shared/ui/frontend/components/skeleton.tsx', `export const Skeleton = () => null;
`);
    write(
      root,
      'platforms/intelligence/analytics/overview/frontend/screens/AnalyticsScreen.tsx',
      `import { cn } from '@apex/shared-utilities';
import { Skeleton } from '@apex/shared-ui/components/skeleton';
export default function S() { return [cn, Skeleton]; }
`,
    );
  },
  { expectExit: 0 },
);

// 178. shared/ must not import Analytics.
testCase(
  'rejects a shared module importing Intelligence Analytics',
  (root) => {
    write(root, 'platforms/intelligence/analytics/overview/index.ts', `export const X = 1;
`);
    write(
      root,
      'shared/ui/frontend/components/kpi-capsule.tsx',
      `import { X } from '@apex/intelligence-analytics';
export const A = X;
`,
    );
  },
  { expectExit: 1, expectRule: 'shared-no-platforms' },
);

// 179. The DEBT-P10 allowlist covers lib/api.ts...
testCase(
  'accepts the single allowlisted Intelligence Analytics legacy target',
  (root) => {
    write(
      root,
      'platforms/intelligence/analytics/overview/frontend/screens/AnalyticsScreen.tsx',
      `import { analyticsApi, dashboardApi, ticketsApi } from '@/lib/api';
export default function S() { return [analyticsApi, dashboardApi, ticketsApi]; }
`,
    );
  },
  { expectExit: 0 },
);

// 180. ...and nothing else - notably not the old chart location, which is the
//      import this component was created to retire.
testCase(
  'rejects Intelligence Analytics importing the legacy dashboard chart path',
  (root) => {
    write(
      root,
      'platforms/intelligence/analytics/overview/frontend/screens/AnalyticsScreen.tsx',
      `import { CategoryChart } from '@/components/dashboard/category-chart';
export default CategoryChart;
`,
    );
  },
  { expectExit: 1, expectRule: 'platforms-no-legacy-frontend' },
);

// 181. The exemption is scoped to frontend/ - a sibling folder cannot reuse it.
testCase(
  'rejects an Intelligence Analytics file outside frontend/ reusing the exemption',
  (root) => {
    write(
      root,
      'platforms/intelligence/analytics/overview/shared/contracts/analytics.types.ts',
      `import { analyticsApi } from '@/lib/api';
export const t = analyticsApi;
`,
    );
  },
  { expectExit: 1, expectRule: 'platforms-no-legacy-frontend' },
);

// 182. Dashboard must not borrow the Analytics allowlist, and vice versa -
//      each intelligence component answers for its own legacy imports.
testCase(
  'rejects Intelligence Dashboard reusing the Analytics exemption scope',
  (root) => {
    write(
      root,
      'platforms/intelligence/analytics/other-component/frontend/screen.tsx',
      `import { analyticsApi } from '@/lib/api';
export default analyticsApi;
`,
    );
  },
  { expectExit: 1, expectRule: 'platforms-no-legacy-frontend' },
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
  'DEBT-P2B-LEADS-COMPANY-REPOSITORY': 1,
  'DEBT-P2C-LEADS-GLOBAL-USERS-API': 1,
  'DEBT-P3-PROJECTS-LEGACY-FRONTEND': 5,
  'DEBT-P4-DASHBOARD-LEGACY-FRONTEND': 6,
  'DEBT-P5-LEAVE-LEGACY-FRONTEND': 2,
  'DEBT-P6-CORE-USERS-LEGACY-FRONTEND': 3,
  'DEBT-P7-CORE-IDENTITY-AUTH-STORE': 1,
  'DEBT-P8-CORE-USERS-PROFILES-LEGACY-FRONTEND': 4,
  'DEBT-P9-CORE-USERS-CHANGE-REQUESTS-LEGACY-FRONTEND': 1,
  'DEBT-P10-INTELLIGENCE-ANALYTICS-LEGACY-FRONTEND': 1,
});

// ── Phase 2C behaviour lock ─────────────────────────────────────────────────
// Source-contract assertions against THIS repository. The HTTP client carries
// authentication for every Apex OS request, so the properties below are the
// ones that would break login or silently duplicate the 401 redirect. They are
// deliberately targeted assertions, not whole-file snapshots.
const CLIENT = 'shared/auth/frontend/authenticated-api-client.ts';
const CRM_API = 'platforms/business/sales-crm/shared/frontend/api/sales-crm-leads-api.ts';
const LEGACY_API = 'frontend/lib/api.ts';

function readRepo(rel) {
  try {
    return readFileSync(join(REPO_ROOT, rel), 'utf8');
  } catch {
    return null;
  }
}

/**
 * Code with comments removed, so an assertion about what a file must NOT do
 * is not tripped by a doc comment saying it must not do that.
 *
 * Line comments are only stripped when the line STARTS with // or *, which
 * leaves URLs such as 'http://localhost:3001/api' intact.
 */
function codeOf(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*');
    })
    .join('\n');
}

/** Tracked AND untracked-but-not-ignored sources — new files count. */
function repoSources() {
  return execSync('git ls-files --cached --others --exclude-standard', { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter(Boolean)
    .filter((f) => /\.(ts|tsx)$/.test(f));
}

function assertContract(name, fn) {
  let problems;
  try {
    problems = fn() ?? [];
  } catch (err) {
    problems = [`threw: ${err.message}`];
  }
  if (problems.length === 0) {
    console.log(`  PASS  ${name}`);
    passed += 1;
  } else {
    console.error(`  FAIL  ${name}`);
    for (const p of problems) console.error(`          ${p}`);
    failed += 1;
  }
}

assertContract('exactly one production axios.create, and it is in shared/auth', () => {
  const problems = [];
  // e2e/ is a standalone script harness with its own throwaway clients
  const sources = repoSources().filter((f) => !f.startsWith('e2e/'));
  const creators = sources.filter((f) => codeOf(readRepo(f) ?? '').includes('axios.create'));
  if (creators.length !== 1) problems.push(`expected 1 axios.create, found ${creators.length}: ${creators.join(', ')}`);
  else if (creators[0] !== CLIENT) problems.push(`axios.create lives in ${creators[0]}, expected ${CLIENT}`);
  return problems;
});

assertContract('the client registers each interceptor exactly once', () => {
  const raw = readRepo(CLIENT);
  if (raw === null) return [`${CLIENT} is missing`];
  const src = codeOf(raw);
  const problems = [];
  const req = (src.match(/interceptors\.request\.use/g) ?? []).length;
  const res = (src.match(/interceptors\.response\.use/g) ?? []).length;
  if (req !== 1) problems.push(`request interceptor registered ${req} time(s), expected 1`);
  if (res !== 1) problems.push(`response interceptor registered ${res} time(s), expected 1`);
  return problems;
});

assertContract('the client preserves token keys, migration and the 401 redirect', () => {
  const raw = readRepo(CLIENT);
  if (raw === null) return [`${CLIENT} is missing`];
  const src = codeOf(raw);
  const required = [
    "localStorage.getItem('nexus_token')",   // legacy key read
    "localStorage.setItem('apex_token'",     // migration write
    "localStorage.removeItem('nexus_token')",
    "localStorage.removeItem('nexus_user')",
    "localStorage.removeItem('nexus-auth')",
    "localStorage.getItem('apex_token')",    // request interceptor
    "localStorage.removeItem('apex_token')", // 401 cleanup
    "localStorage.removeItem('apex-auth')",
    '`Bearer ${token}`',
    "'/login?expired=true'",
    "window.location.pathname.startsWith('/login')",
    "typeof window !== 'undefined'",
    'process.env.NEXT_PUBLIC_API_URL',
    "'http://localhost:3001/api'",
  ];
  return required.filter((s) => !src.includes(s)).map((s) => `missing from the client: ${s}`);
});

assertContract('the Sales CRM API rides the shared client and owns no transport', () => {
  const raw = readRepo(CRM_API);
  if (raw === null) return [`${CRM_API} is missing`];
  const src = codeOf(raw);
  const problems = [];
  if (!src.includes("from '@apex/shared-auth'")) problems.push('does not import the shared authenticated client');
  for (const forbidden of ['axios.create', 'interceptors.', 'localStorage', 'auth.store', "from 'axios'", '@/lib/api']) {
    if (src.includes(forbidden)) problems.push(`must not contain: ${forbidden}`);
  }
  return problems;
});

assertContract('the Sales CRM Leads API contract is unchanged', () => {
  const src = readRepo(CRM_API);
  if (src === null) return [`${CRM_API} is missing`];
  // method -> [http verb, endpoint fragment] exactly as it was in frontend/lib/api.ts
  const CONTRACT = {
    getAll: ['get', "'/sales-crm/leads', { params }"],
    getOne: ['get', '`/sales-crm/leads/${id}`'],
    create: ['post', "'/sales-crm/leads', data"],
    update: ['put', '`/sales-crm/leads/${id}`, data'],
    reassignOwner: ['patch', '`/sales-crm/leads/${id}/owner`, { ownerId }'],
    bulkUpdate: ['patch', "'/sales-crm/leads/bulk', data"],
    addActivity: ['post', '`/sales-crm/leads/${id}/activities`, data'],
    addFollowup: ['post', '`/sales-crm/leads/${id}/followups`, data'],
    addRequirement: ['post', '`/sales-crm/leads/${id}/requirements`, data'],
    addDeal: ['post', '`/sales-crm/leads/${id}/deals`, data'],
    remove: ['delete', '`/sales-crm/leads/${id}`'],
  };
  const problems = [];
  for (const [method, [verb, call]] of Object.entries(CONTRACT)) {
    if (!new RegExp(`\\b${method}\\s*:`).test(src)) {
      problems.push(`method missing: ${method}`);
      continue;
    }
    if (!src.includes(`api.${verb}(${call})`)) {
      problems.push(`${method}: expected api.${verb}(${call})`);
    }
  }
  const declared = (src.match(/^\s{2}(\w+)\s*:/gm) ?? []).length;
  if (declared !== Object.keys(CONTRACT).length) {
    problems.push(`expected ${Object.keys(CONTRACT).length} methods, found ${declared}`);
  }
  return problems;
});

assertContract('the Sales CRM root barrel stays free of the HTTP API', () => {
  // Re-exporting salesCrmLeadsApi from the root barrel pulls axios and the
  // authenticated-client module into every consumer of '@apex/sales-crm-shared'
  // — including screens that only want types, constants or styles. That cost
  // ~23 kB of First Load JS on five Sales CRM routes when it was measured.
  const problems = [];
  for (const barrel of [
    'platforms/business/sales-crm/shared/index.ts',
    'platforms/business/sales-crm/shared/frontend/index.ts',
  ]) {
    const raw = readRepo(barrel);
    if (raw === null) {
      problems.push(`${barrel} is missing`);
      continue;
    }
    const src = codeOf(raw);
    if (src.includes('salesCrmLeadsApi')) problems.push(`${barrel} must not export salesCrmLeadsApi`);
    if (src.includes('sales-crm-leads-api')) problems.push(`${barrel} must not reference the API module`);
  }
  // ...and the subpath barrel must actually publish it.
  const apiIndex = readRepo('platforms/business/sales-crm/shared/frontend/api/index.ts');
  if (apiIndex === null) problems.push('the /api subpath entry point is missing');
  else if (!codeOf(apiIndex).includes('salesCrmLeadsApi')) {
    problems.push('the /api subpath entry point does not export salesCrmLeadsApi');
  }
  return problems;
});

assertContract('no Leads consumer reaches the API through the root barrel', () => {
  const problems = [];
  const consumers = repoSources().filter((f) => f.startsWith('platforms/business/sales-crm/leads/'));
  for (const f of consumers) {
    const src = codeOf(readRepo(f) ?? '');
    if (!src.includes('salesCrmLeadsApi')) continue;
    if (!src.includes("from \"@apex/sales-crm-shared/api\"") && !src.includes("from '@apex/sales-crm-shared/api'")) {
      problems.push(`${f} uses salesCrmLeadsApi but not via @apex/sales-crm-shared/api`);
    }
  }
  return problems;
});

assertContract('frontend/lib/api.ts owns no client and no Sales CRM API', () => {
  const raw = readRepo(LEGACY_API);
  if (raw === null) return [`${LEGACY_API} is missing`];
  const src = codeOf(raw);
  const problems = [];
  for (const forbidden of ['axios.create', "from 'axios'", 'interceptors.', 'salesCrmLeadsApi']) {
    if (src.includes(forbidden)) problems.push(`must no longer contain: ${forbidden}`);
  }
  if (!src.includes("from '@apex/shared-auth'")) problems.push('does not import the shared authenticated client');
  return problems;
});

assertContract('both Profiles screens read auth through the Core Identity boundary', () => {
  const problems = [];
  for (const screen of [
    'platforms/core/users/profiles/frontend/screens/ProfileScreen.tsx',
    'platforms/core/users/profiles/frontend/screens/UserProfileScreen.tsx',
  ]) {
    const raw = readRepo(screen);
    if (raw === null) {
      problems.push(`${screen} is missing`);
      continue;
    }
    const src = codeOf(raw);
    if (!src.includes("from '@apex/core-identity'")) {
      problems.push(`${screen} does not consume @apex/core-identity`);
    }
    if (src.includes('@/store/auth.store')) {
      problems.push(`${screen} still imports the legacy auth store`);
    }
    // The migration is an import-path change only: the call shape is untouched.
    if (!src.includes('useAuthStore()')) {
      problems.push(`${screen} no longer calls useAuthStore() - the hook usage must be unchanged`);
    }
  }
  return problems;
});

assertContract('ActivityItem stays internal to Core Users Profiles', () => {
  // Its only consumer repo-wide is ProfileScreen. Publishing it through either
  // barrel would pull it into every consumer of '@apex/core-users-profiles',
  // and would also let another component depend on a Profiles-owned detail.
  const problems = [];
  const INTERNAL = 'platforms/core/users/profiles/frontend/components/activity-item.tsx';
  if (readRepo(INTERNAL) === null) problems.push(`${INTERNAL} is missing`);

  for (const barrel of [
    'platforms/core/users/profiles/index.ts',
    'platforms/core/users/profiles/frontend/index.ts',
  ]) {
    const raw = readRepo(barrel);
    if (raw === null) {
      problems.push(`${barrel} is missing`);
      continue;
    }
    const src = codeOf(raw);
    if (src.includes('ActivityItem') || src.includes('activity-item')) {
      problems.push(`${barrel} must not publish ActivityItem`);
    }
  }
  // No file outside this component may reference the old legacy path either.
  for (const f of repoSources()) {
    if (f.startsWith('platforms/core/users/profiles/')) continue;
    if (f === 'scripts/architecture/validate-boundaries.test.mjs') continue;
    const src = codeOf(readRepo(f) ?? '');
    if (src.includes('@/components/dashboard/activity-item')) {
      problems.push(`${f} imports activity-item from its old legacy path`);
    }
  }
  return problems;
});

assertContract('the Profiles barrel publishes exactly the two screens', () => {
  const raw = readRepo('platforms/core/users/profiles/frontend/index.ts');
  if (raw === null) return ['platforms/core/users/profiles/frontend/index.ts is missing'];
  const src = codeOf(raw);
  const problems = [];
  for (const screen of ['ProfileScreen', 'UserProfileScreen']) {
    if (!src.includes(screen)) problems.push(`the frontend barrel does not export ${screen}`);
  }
  const exportCount = (src.match(/^export /gm) ?? []).length;
  if (exportCount !== 2) problems.push(`expected 2 exports, found ${exportCount}`);
  return problems;
});

const APPROVALS = 'platforms/core/users/change-requests/frontend/screens/ApprovalsScreen.tsx';

assertContract('the approvals screen kept its exact original import list', () => {
  const raw = readRepo(APPROVALS);
  if (raw === null) return [`${APPROVALS} is missing`];
  const src = codeOf(raw);
  const problems = [];
  // Exactly the five the route file had, unchanged by the move.
  const EXPECTED = [
    "from '@tanstack/react-query'",
    "from '@/lib/api'",
    "from 'react'",
    "from 'lucide-react'",
    "from 'react-hot-toast'",
  ];
  for (const spec of EXPECTED) {
    if (!src.includes(spec)) problems.push(`missing original import: ${spec}`);
  }
  const count = (src.match(/^import\s/gm) ?? []).length;
  if (count !== EXPECTED.length) {
    problems.push(`expected ${EXPECTED.length} imports, found ${count}`);
  }
  // It had no auth, no shared-ui and no lib/utils coupling, and must not gain one.
  for (const forbidden of ['auth.store', '@apex/core-identity', '@apex/shared-ui', '@/lib/utils']) {
    if (src.includes(forbidden)) problems.push(`must not contain: ${forbidden}`);
  }
  return problems;
});

assertContract('the approval and rejection contract is unchanged', () => {
  // This screen approves and rejects user change requests. A relocation must
  // not alter who can act, what is sent, or what is invalidated afterwards.
  const raw = readRepo(APPROVALS);
  if (raw === null) return [`${APPROVALS} is missing`];
  const src = codeOf(raw);
  const problems = [];
  const REQUIRED = [
    // endpoints and payloads
    'changeRequestsApi.listPendingApprovals()',
    'changeRequestsApi.approve(id)',
    'changeRequestsApi.reject(data.id, data.reason)',
    // query keys
    "queryKey: ['pending-approvals']",
    "queryKey: ['departments']",
    "queryKey: ['users-list']",
    "queryKey: ['roles']",
    // cache invalidation after each action
    "invalidateQueries({ queryKey: ['pending-approvals'] })",
    // the ONLY client-side eligibility gate: a status guard, not a role check
    "!['APPROVED', 'REJECTED', 'CANCELLED'].includes(req.status)",
    // disabled states
    'disabled={approveMutation.isPending && approveMutation.variables === req.id}',
    'disabled={approveMutation.isPending}',
    'disabled={rejectMutation.isPending}',
    // toast copy
    "toast.success('Request approved')",
    "toast.success('Request rejected')",
    "toast.error('This request has already been processed.')",
    "toast.error(err.message || 'Failed to approve')",
    "toast.error(err.message || 'Failed to reject')",
  ];
  for (const r of REQUIRED) {
    if (!src.includes(r)) problems.push(`approval contract changed - missing: ${r}`);
  }
  return problems;
});

assertContract('the approvals screen introduces no client-side role check', () => {
  // Queue scoping is backend-driven: listPendingApprovals returns only what the
  // caller may act on. If a role check ever appears here it is either a real
  // authorization change or a duplicate of a backend rule - both need review,
  // not a silent commit.
  const raw = readRepo(APPROVALS);
  if (raw === null) return [`${APPROVALS} is missing`];
  const src = codeOf(raw);
  const problems = [];
  for (const marker of ['SUPER_ADMIN', "role?.name", 'isHR', 'canApprove', 'currentUser']) {
    if (src.includes(marker)) problems.push(`unexpected authorization expression: ${marker}`);
  }
  return problems;
});

assertContract('the /admin/approvals route is a thin adapter', () => {
  const ROUTE = 'frontend/app/(dashboard)/admin/approvals/page.tsx';
  const raw = readRepo(ROUTE);
  if (raw === null) return [`${ROUTE} is missing - the route must survive as an adapter`];
  const src = codeOf(raw);
  const problems = [];
  if (!src.includes("from '@apex/core-users-change-requests'")) {
    problems.push('the route does not consume the Change Requests public entry');
  }
  // It must not reach past the entry, and must not have kept any screen logic.
  if (src.includes('@apex/core-users-change-requests/frontend')) {
    problems.push('the route reaches into Change Requests internals');
  }
  for (const forbidden of ['@/lib/api', 'useQuery', 'useMutation', 'changeRequestsApi', 'useState']) {
    if (src.includes(forbidden)) problems.push(`the adapter must not contain: ${forbidden}`);
  }
  return problems;
});

assertContract('the Change Requests barrel publishes exactly one screen', () => {
  const raw = readRepo('platforms/core/users/change-requests/frontend/index.ts');
  if (raw === null) return ['platforms/core/users/change-requests/frontend/index.ts is missing'];
  const src = codeOf(raw);
  const problems = [];
  if (!src.includes('ApprovalsScreen')) problems.push('the frontend barrel does not export ApprovalsScreen');
  const exportCount = (src.match(/^export /gm) ?? []).length;
  if (exportCount !== 1) problems.push(`expected 1 export, found ${exportCount}`);
  return problems;
});

assertContract('all three core/users components stay separately bounded', () => {
  // administration, profiles and change-requests are three components in one
  // module. Each must publish its own entry and none may import another's
  // internals - the property that keeps the module from collapsing into one
  // folder as more of it migrates.
  const problems = [];
  const COMPONENTS = {
    administration: 'platforms/core/users/administration',
    profiles: 'platforms/core/users/profiles',
    'change-requests': 'platforms/core/users/change-requests',
  };
  for (const [name, root] of Object.entries(COMPONENTS)) {
    if (readRepo(`${root}/index.ts`) === null) {
      problems.push(`${name} has no public entry point`);
    }
  }
  const OTHERS = {
    'platforms/core/users/administration/': ['core-users-profiles', 'core-users-change-requests'],
    'platforms/core/users/profiles/': ['@apex/core-users/frontend', 'core-users-change-requests'],
    'platforms/core/users/change-requests/': ['@apex/core-users/frontend', 'core-users-profiles'],
  };
  for (const f of repoSources()) {
    for (const [prefix, forbidden] of Object.entries(OTHERS)) {
      if (!f.startsWith(prefix)) continue;
      const src = codeOf(readRepo(f) ?? '');
      for (const spec of forbidden) {
        if (src.includes(spec)) problems.push(`${f} reaches into a sibling component via ${spec}`);
      }
    }
  }
  return problems;
});

const ANALYTICS = 'platforms/intelligence/analytics/overview/frontend/screens/AnalyticsScreen.tsx';

assertContract('the analytics screen reads auth through the Core Identity boundary', () => {
  const raw = readRepo(ANALYTICS);
  if (raw === null) return [`${ANALYTICS} is missing`];
  const src = codeOf(raw);
  const problems = [];
  if (!src.includes("from '@apex/core-identity'")) {
    problems.push('does not consume @apex/core-identity');
  }
  if (src.includes('@/store/auth.store')) problems.push('still imports the legacy auth store');
  // Import-path change only: the destructure must be untouched, and hasHydrated
  // in particular - reading it before hydration is what logged users out once.
  if (!src.includes('const { user, hasHydrated } = useAuthStore();')) {
    problems.push('the useAuthStore destructure changed - it must remain { user, hasHydrated }');
  }
  return problems;
});

assertContract('the analytics charts moved with their only consumer', () => {
  const problems = [];
  const CHARTS = [
    'platforms/intelligence/analytics/overview/frontend/components/category-chart.tsx',
    'platforms/intelligence/analytics/overview/frontend/components/ticket-trend-chart.tsx',
  ];
  for (const chart of CHARTS) {
    const raw = readRepo(chart);
    if (raw === null) {
      problems.push(`${chart} is missing`);
      continue;
    }
    const src = codeOf(raw);
    // They were pure presentational charts and must stay that way: no API, no
    // store, no legacy path. That is why this component's debt is 1, not 3.
    for (const forbidden of ['@/lib/', '@/store/', '@/components/', '@apex/core-identity']) {
      if (src.includes(forbidden)) problems.push(`${chart} must not import ${forbidden}`);
    }
  }
  // Nothing outside this component may still reference the old chart location.
  for (const f of repoSources()) {
    if (f === 'scripts/architecture/validate-boundaries.test.mjs') continue;
    const src = codeOf(readRepo(f) ?? '');
    for (const stale of ['@/components/dashboard/category-chart', '@/components/dashboard/ticket-trend-chart']) {
      if (src.includes(stale)) problems.push(`${f} imports ${stale} from its old legacy path`);
    }
  }
  return problems;
});

assertContract('the analytics screen stays read-only', () => {
  // Its role checks gate which tabs and panels render. Because the screen
  // declares no mutation, none of them can authorize an action - a property
  // worth keeping true, since a future mutation here would need its own review.
  const raw = readRepo(ANALYTICS);
  if (raw === null) return [`${ANALYTICS} is missing`];
  const src = codeOf(raw);
  const problems = [];
  for (const forbidden of ['useMutation', 'mutationFn', 'invalidateQueries']) {
    if (src.includes(forbidden)) problems.push(`analytics is read-only; found ${forbidden}`);
  }
  // The three access expressions must survive the move verbatim.
  const GATES = [
    "const isManagerPlus = ['MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(roleName);",
    "const isAdminPlus   = ['ADMIN', 'SUPER_ADMIN'].includes(roleName);",
    "const canAccess     = ['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(roleName);",
  ];
  for (const g of GATES) {
    if (!src.includes(g)) problems.push(`view gate changed - missing: ${g}`);
  }
  return problems;
});

assertContract('the Analytics barrel publishes exactly one screen', () => {
  const raw = readRepo('platforms/intelligence/analytics/overview/frontend/index.ts');
  if (raw === null) return ['platforms/intelligence/analytics/overview/frontend/index.ts is missing'];
  const src = codeOf(raw);
  const problems = [];
  if (!src.includes('AnalyticsScreen')) problems.push('the frontend barrel does not export AnalyticsScreen');
  for (const internal of ['CategoryChart', 'TicketTrendChart', 'category-chart', 'ticket-trend-chart']) {
    if (src.includes(internal)) problems.push(`the barrel must not publish ${internal}`);
  }
  const exportCount = (src.match(/^export /gm) ?? []).length;
  if (exportCount !== 1) problems.push(`expected 1 export, found ${exportCount}`);
  return problems;
});

assertContract('the /analytics route is a thin adapter', () => {
  const ROUTE = 'frontend/app/(dashboard)/analytics/page.tsx';
  const raw = readRepo(ROUTE);
  if (raw === null) return [`${ROUTE} is missing - the route must survive as an adapter`];
  const src = codeOf(raw);
  const problems = [];
  if (!src.includes("from '@apex/intelligence-analytics'")) {
    problems.push('the route does not consume the Analytics public entry');
  }
  if (src.includes('@apex/intelligence-analytics/frontend')) {
    problems.push('the route reaches into Analytics internals');
  }
  for (const forbidden of ['@/lib/api', 'useQuery', 'useAuthStore', 'recharts', 'useState']) {
    if (src.includes(forbidden)) problems.push(`the adapter must not contain: ${forbidden}`);
  }
  return problems;
});

assertContract('stat-card was left where the evidence puts it', () => {
  // The Dashboard phase found stat-card has no consumer anywhere. It was NOT
  // absorbed into analytics just to empty frontend/components/dashboard/ -
  // ownership follows consumers, and an unconsumed file has none to follow.
  const problems = [];
  if (readRepo('frontend/components/dashboard/stat-card.tsx') === null) {
    problems.push('stat-card.tsx moved or was deleted; this phase must leave it in place');
  }
  const importers = repoSources().filter((f) => {
    if (f === 'scripts/architecture/validate-boundaries.test.mjs') return false;
    return codeOf(readRepo(f) ?? '').includes('components/dashboard/stat-card');
  });
  if (importers.length !== 0) {
    problems.push(`stat-card gained ${importers.length} importer(s): ${importers.join(', ')}`);
  }
  return problems;
});
