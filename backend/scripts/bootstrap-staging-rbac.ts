/**
 * Staging RBAC foundation initializer.
 *
 *   npx ts-node scripts/bootstrap-staging-rbac.ts            # dry run
 *   npx ts-node scripts/bootstrap-staging-rbac.ts --apply    # writes
 *
 * The staging database has zero Role rows, and `User.roleId` is non-nullable —
 * so no user can be created at all until the ladder exists. This creates that
 * foundation and nothing else.
 *
 * Deliberately NOT prisma/seed.ts. That seed carries unconditional deleteMany
 * calls against users, projects and tickets; running it to obtain six rows
 * would be trading a missing foundation for destroyed data. This script only
 * ever INSERTS roles.
 *
 * Required environment (identical gate to staging-preflight and the holiday
 * importer, deliberately — a script that writes must not be easier to point at
 * a database than the read-only one that checks which database it is):
 *
 *   DATABASE_URL
 *   APP_ENV=staging
 *   EXPECTED_STAGING_DB_HOST
 *   EXPECTED_STAGING_DB_NAME
 */

import { PrismaClient } from '@prisma/client';
import {
  CANONICAL_ROLES,
  CANONICAL_ROLE_COUNT,
  type CanonicalRole,
} from '../src/shared/constants/roles';

const APPLY = process.argv.includes('--apply');

/** Production identifiers already recorded in this repository's seed guards. */
const KNOWN_PRODUCTION_MARKERS = [/dpg-d8259omk1jcs73e37fbg/i, /prod\.technoedge/i];

function fail(reason: string): never {
  console.error(`\nRBAC BOOTSTRAP ABORTED: ${reason}\n`);
  process.exit(1);
}

export interface ExistingRole {
  id: string;
  name: string;
  level: number;
}

export interface RbacPlan {
  toCreate: CanonicalRole[];
  alreadyCorrect: string[];
  conflicts: string[];
  /** Roles present that are not part of the canonical ladder. Never touched. */
  extra: ExistingRole[];
}

/**
 * Compares what exists against the canonical ladder.
 *
 * Three outcomes per canonical role: missing (plan a create), present with the
 * expected level (leave it alone), or present with a DIFFERENT level. The last
 * is a conflict, never a repair: `level` decides who may approve whose leave,
 * so silently rewriting it would change who has authority over whom without
 * anybody deciding that.
 *
 * Non-canonical roles are reported and otherwise ignored — this database may
 * legitimately have roles this ladder does not describe.
 */
export function planCanonicalRoles(existing: ExistingRole[]): RbacPlan {
  const byName = new Map(existing.map((r) => [r.name.toUpperCase(), r]));
  const plan: RbacPlan = { toCreate: [], alreadyCorrect: [], conflicts: [], extra: [] };

  for (const canonical of CANONICAL_ROLES) {
    const found = byName.get(canonical.name.toUpperCase());
    if (!found) {
      plan.toCreate.push(canonical);
    } else if (found.level === canonical.level) {
      plan.alreadyCorrect.push(canonical.name);
    } else {
      plan.conflicts.push(
        `Role ${canonical.name} exists with level ${found.level}, but the canonical ` +
          `ladder says ${canonical.level}. Level decides approval authority, so this ` +
          'is not repaired automatically.',
      );
    }
  }

  const canonicalNames = new Set(CANONICAL_ROLES.map((r) => r.name.toUpperCase()));
  plan.extra = existing.filter((r) => !canonicalNames.has(r.name.toUpperCase()));

  return plan;
}

/** Positive staging assertion. Identical to the other staging-writing scripts. */
function assertStaging() {
  const appEnv = (process.env.APP_ENV ?? '').toLowerCase();
  const url = process.env.DATABASE_URL ?? '';
  const expectedHost = (process.env.EXPECTED_STAGING_DB_HOST ?? '').trim();
  const expectedName = (process.env.EXPECTED_STAGING_DB_NAME ?? '').trim();

  if (!url) fail('DATABASE_URL is not set.');
  if (appEnv !== 'staging') {
    fail(`APP_ENV is "${appEnv || '(unset)'}", not "staging".`);
  }
  if (!expectedHost || !expectedName) {
    fail(
      'EXPECTED_STAGING_DB_HOST and EXPECTED_STAGING_DB_NAME must both be set, read ' +
        'from the Render dashboard by a human.',
    );
  }
  for (const marker of KNOWN_PRODUCTION_MARKERS) {
    if (marker.test(url) || marker.test(expectedHost) || marker.test(expectedName)) {
      fail(`Target matches a known production marker (${marker}).`);
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    fail('DATABASE_URL could not be parsed.');
  }
  const host = parsed!.hostname;
  const database = parsed!.pathname.replace(/^\//, '');
  if (host !== expectedHost) fail(`Host mismatch: "${host}" vs expected "${expectedHost}".`);
  if (database !== expectedName) {
    fail(`Database mismatch: "${database}" vs expected "${expectedName}".`);
  }

  console.log(`  target host     : ${host}`);
  console.log(`  target database : ${database}`);
}

async function main() {
  console.log('── Staging RBAC foundation ────────────────────────────────────');
  console.log(`  mode            : ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}`);
  assertStaging();

  if (CANONICAL_ROLES.length !== CANONICAL_ROLE_COUNT) {
    fail(
      `The canonical ladder has ${CANONICAL_ROLES.length} roles but should have ` +
        `${CANONICAL_ROLE_COUNT}. Somebody has edited it.`,
    );
  }

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.role.findMany({
      select: { id: true, name: true, level: true },
      orderBy: { level: 'asc' },
    });

    console.log(`\n  roles present   : ${existing.length}`);
    for (const r of existing) console.log(`    ${String(r.level).padStart(2)}  ${r.name}`);
    if (existing.length === 0) console.log('    (none)');

    const plan = planCanonicalRoles(existing);

    console.log(`\n  already correct : ${plan.alreadyCorrect.length}`);
    for (const name of plan.alreadyCorrect) console.log(`    = ${name}`);

    console.log(`  to create       : ${plan.toCreate.length}`);
    for (const r of plan.toCreate) {
      console.log(`    + ${String(r.level).padStart(2)}  ${r.name}  — ${r.description}`);
    }

    if (plan.extra.length > 0) {
      console.log(`  non-canonical   : ${plan.extra.length} (reported only, never modified)`);
      for (const r of plan.extra) console.log(`    ? ${String(r.level).padStart(2)}  ${r.name}`);
    }

    if (plan.conflicts.length > 0) {
      console.log('\n  CONFLICTS:');
      for (const c of plan.conflicts) console.log(`    ! ${c}`);
      fail('Refusing to change the authority level of an existing role.');
    }

    if (plan.toCreate.length === 0) {
      console.log('\nNothing to do — the canonical ladder is already complete.\n');
      return;
    }

    if (!APPLY) {
      console.log('\nDRY RUN COMPLETE. Nothing was written.');
      console.log('Re-run with --apply once the rows above are correct.\n');
      return;
    }

    // One transaction: either the whole ladder lands or none of it. A partial
    // ladder is worse than none, because authority comparisons between the
    // rungs that did land would be meaningless.
    const created = await prisma.$transaction(
      plan.toCreate.map((role) =>
        prisma.role.create({
          data: { name: role.name, level: role.level, description: role.description },
        }),
      ),
    );

    // Read back rather than trusting the write.
    const after = await prisma.role.findMany({
      select: { id: true, name: true, level: true },
      orderBy: { level: 'asc' },
    });
    const verify = planCanonicalRoles(after);
    if (verify.toCreate.length > 0 || verify.conflicts.length > 0) {
      fail('Verification failed: the canonical ladder is still incomplete after apply.');
    }

    console.log(`\n  created         : ${created.length}`);
    console.log('  ladder as stored:');
    for (const r of after) console.log(`    ${String(r.level).padStart(2)}  ${r.name}`);
    console.log('\nRBAC FOUNDATION COMPLETE.\n');
  } finally {
    await prisma.$disconnect();
  }
}

// Only run when invoked directly, so the planner can be unit tested.
if (require.main === module) {
  main().catch((err) => {
    console.error('\nRBAC bootstrap failed:', err?.message ?? err);
    process.exit(1);
  });
}
