/**
 * APEX OS — Local-Only QC Test Users
 * ─────────────────────────────────────────────────────────────────────────────
 * Creates six role-representative test accounts for local QC and automated
 * testing.  These accounts use @apex.local emails so the production seed can
 * safely skip them.
 *
 * ⚠️  DO NOT run against a production database.
 *
 * Run:
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed-test-users.ts
 *
 * Environment guards:
 *   • NODE_ENV=production → blocked entirely
 *   • Database URL points to known production host → blocked
 *   • Requires explicit ALLOW_TEST_USER_SEED=true to proceed
 *
 * Test credentials (all same password):
 *   superadmin@apex.local  / Apex@local1
 *   admin@apex.local       / Apex@local1
 *   manager@apex.local     / Apex@local1
 *   teamlead@apex.local    / Apex@local1
 *   employee@apex.local    / Apex@local1
 *   intern@apex.local      / Apex@local1
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

// ── Production Guard ──────────────────────────────────────────────────────────
function guardAgainstProduction() {
  const nodeEnv = process.env.NODE_ENV?.toLowerCase() || '';
  const databaseUrl = process.env.DATABASE_URL || '';
  const allowTestUsers = process.env.ALLOW_TEST_USER_SEED?.toLowerCase() === 'true';

  // Absolute blocker: NODE_ENV=production
  if (nodeEnv === 'production') {
    console.error('❌ TEST USER SEED BLOCKED: NODE_ENV is set to "production"');
    console.error('   Test user accounts cannot be created in production.');
    console.error('   Reason: NODE_ENV=production is a hard safety block.');
    process.exit(1);
  }

  // Production database detection — always block, no exceptions
  const productionPatterns = [
    /render\.com/i,           // Render.com any host
    /dpg-[\w]+\.[\w]+-[\w]+\.postgres\.render\.com/i,  // Render Postgres pattern
    /production/i,            // Generic "production" in hostname
    /prod\.technoedge/i,      // TechnoEdge production domain
    /dpg-d8259omk1jcs73e37fbg/i, // Known production Postgres ID (from audit)
  ];

  const looksLikeProduction = productionPatterns.some((pattern) =>
    pattern.test(databaseUrl),
  );

  if (looksLikeProduction) {
    console.error('❌ TEST USER SEED BLOCKED: Database URL appears to point to production');
    console.error(`   URL: ${databaseUrl.replace(/:[^:@]+@/, ':****@')}`);
    console.error('');
    console.error('   Production databases cannot be seeded. No exceptions.');
    process.exit(1);
  }

  // Require explicit allow flag even for non-production databases
  if (!allowTestUsers) {
    console.error('❌ TEST USER SEED BLOCKED: ALLOW_TEST_USER_SEED not set');
    console.error('');
    console.error('   To create test users on a non-production database:');
    console.error('   $ ALLOW_TEST_USER_SEED=true npx ts-node prisma/seed-test-users.ts');
    console.error('');
    process.exit(1);
  }

  // All checks passed — proceed
  console.log('✓ Environment checks passed. Creating test users...');
}

guardAgainstProduction();

const prisma = new PrismaClient();

const TEST_PASSWORD = 'Apex@local1';

const TEST_USERS = [
  { email: 'superadmin@apex.local', name: 'QC Super Admin',  role: 'SUPER_ADMIN' },
  { email: 'admin@apex.local',      name: 'QC Admin',        role: 'ADMIN'       },
  { email: 'manager@apex.local',    name: 'QC Manager',      role: 'MANAGER'     },
  { email: 'teamlead@apex.local',   name: 'QC Team Lead',    role: 'TEAM_LEAD'   },
  { email: 'employee@apex.local',   name: 'QC Employee',     role: 'EMPLOYEE'    },
  { email: 'intern@apex.local',     name: 'QC Intern',       role: 'INTERN'      },
];

async function main() {
  console.log('🧪 Seeding Apex OS QC test users...\n');

  const hashed = await bcrypt.hash(TEST_PASSWORD, 10);

  // Ensure roles exist (seed.ts may not have run yet in a fresh dev env)
  const roleData = [
    { name: 'SUPER_ADMIN', level: 0, description: 'Super administrator' },
    { name: 'ADMIN',       level: 1, description: 'Administrator'       },
    { name: 'MANAGER',     level: 2, description: 'Manager'             },
    { name: 'TEAM_LEAD',   level: 3, description: 'Team Lead'           },
    { name: 'EMPLOYEE',    level: 4, description: 'Employee'            },
    { name: 'INTERN',      level: 5, description: 'Intern'              },
  ];
  for (const r of roleData) {
    await prisma.role.upsert({
      where: { name: r.name },
      update: {},
      create: r,
    });
  }

  for (const u of TEST_USERS) {
    const role = await prisma.role.findUnique({ where: { name: u.role } });
    if (!role) {
      console.error(`  ✗ Role "${u.role}" not found — skipping ${u.email}`);
      continue;
    }

    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {
        name: u.name,
        roleId: role.id,
        isActive: true,
        mustChangePassword: false,
      },
      create: {
        email: u.email,
        name: u.name,
        password: hashed,
        roleId: role.id,
        isActive: true,
        mustChangePassword: false,
      },
    });

    console.log(`  ✓ ${u.email}  [${u.role}]  id=${user.id}`);
  }

  console.log('\n✅ QC test users ready.');
  console.log(`   Password for all: ${TEST_PASSWORD}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
