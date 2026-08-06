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
      `import { projectsApi } from '@/lib/api';\nimport { useAuthStore } from '@/store/auth.store';\nimport { cn } from '@/lib/utils';\nimport { TicketRow } from '@/components/tickets/ticket-row';\nexport default function S() { return null; }\n`,
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
  'DEBT-P2A-SALES-CRM-AUTH-STORE': 1,
  'DEBT-P3-PROJECTS-LEGACY-FRONTEND': 7,
  'DEBT-P4-DASHBOARD-LEGACY-FRONTEND': 10,
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
