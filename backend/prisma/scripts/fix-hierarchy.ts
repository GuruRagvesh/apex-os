/**
 * fix-hierarchy.ts
 * Part A — QC Sprint May 2026
 *
 * 1. Add 3 missing employees:
 *    - Shruti Kulkarni  (EMPLOYEE, Content dept, reports to Shubendu Anand)
 *    - Balendu Anand    (EMPLOYEE, ID Team dept, reports to Vishal)
 *    - Mahendra Yais    (EMPLOYEE, Content dept, reports to Shubendu Anand)
 * 2. Fix Sumedh Sadaphal → Content Sales department
 * 3. Ensure Shubendu Anand has TEAM_LEAD role
 *
 * Run: npx ts-node -P tsconfig.json --require tsconfig-paths/register prisma/scripts/fix-hierarchy.ts
 */

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('=== fix-hierarchy.ts starting ===\n');

  // ──────────────────────────────────────────────────────────────────────────
  // 0. Resolve roles
  // ──────────────────────────────────────────────────────────────────────────
  const employeeRole = await prisma.role.findFirst({ where: { name: 'EMPLOYEE' } });
  const tlRole       = await prisma.role.findFirst({ where: { name: 'TEAM_LEAD' } });

  if (!employeeRole) throw new Error('EMPLOYEE role not found — aborting.');
  if (!tlRole)       throw new Error('TEAM_LEAD role not found — aborting.');

  console.log(`Resolved EMPLOYEE role: ${employeeRole.id}`);
  console.log(`Resolved TEAM_LEAD  role: ${tlRole.id}\n`);

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Resolve / create departments
  // ──────────────────────────────────────────────────────────────────────────

  // Content department
  let contentDept = await prisma.department.findFirst({
    where: { name: { contains: 'Content', mode: 'insensitive' }, NOT: { name: { contains: 'Sales', mode: 'insensitive' } } },
  });
  if (!contentDept) {
    contentDept = await prisma.department.create({
      data: { name: 'Content', description: 'Content creation and strategy', color: '#8b5cf6' },
    });
    console.log(`Created Content department: ${contentDept.id}`);
  } else {
    console.log(`Found Content department: "${contentDept.name}" (${contentDept.id})`);
  }

  // Content Sales department
  let contentSalesDept = await prisma.department.findFirst({
    where: { name: { contains: 'Content Sales', mode: 'insensitive' } },
  });
  if (!contentSalesDept) {
    contentSalesDept = await prisma.department.findFirst({
      where: { name: { contains: 'Content', mode: 'insensitive' } },
    });
    if (!contentSalesDept) {
      contentSalesDept = await prisma.department.create({
        data: { name: 'Content Sales', description: 'Content sales and outreach', color: '#f59e0b' },
      });
      console.log(`Created Content Sales department: ${contentSalesDept.id}`);
    } else {
      console.log(`Using dept for Content Sales lookup: "${contentSalesDept.name}"`);
    }
  } else {
    console.log(`Found Content Sales department: "${contentSalesDept.name}" (${contentSalesDept.id})`);
  }

  // Re-query specifically for "Content Sales"
  const contentSalesDeptFinal = await prisma.department.findFirst({
    where: { name: { contains: 'Content Sales', mode: 'insensitive' } },
  }) || contentDept;

  // ID Team department
  let idTeamDept = await prisma.department.findFirst({
    where: { name: { contains: 'ID Team', mode: 'insensitive' } },
  });
  if (!idTeamDept) {
    idTeamDept = await prisma.department.findFirst({
      where: { name: { contains: 'ID', mode: 'insensitive' } },
    });
  }
  if (!idTeamDept) {
    idTeamDept = await prisma.department.create({
      data: { name: 'ID Team', description: 'Instructional Design Team', color: '#06b6d4' },
    });
    console.log(`Created ID Team department: ${idTeamDept.id}`);
  } else {
    console.log(`Found ID Team department: "${idTeamDept.name}" (${idTeamDept.id})`);
  }

  console.log();

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Ensure Shubendu Anand is TEAM_LEAD
  // ──────────────────────────────────────────────────────────────────────────
  const shubendu = await prisma.user.findFirst({
    where: { name: { contains: 'Shubendu', mode: 'insensitive' } },
    include: { role: true },
  });

  if (!shubendu) {
    console.log('WARNING: Shubendu Anand not found — cannot verify TEAM_LEAD role.\n');
  } else {
    if (shubendu.role.name !== 'TEAM_LEAD') {
      await prisma.user.update({
        where: { id: shubendu.id },
        data: { roleId: tlRole.id },
      });
      console.log(`Updated ${shubendu.name} (${shubendu.email}) → TEAM_LEAD\n`);
    } else {
      console.log(`${shubendu.name} is already TEAM_LEAD (${shubendu.email})\n`);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Fix Sumedh Sadaphal → Content Sales department
  // ──────────────────────────────────────────────────────────────────────────
  const sumedh = await prisma.user.findFirst({
    where: { name: { contains: 'Sumedh', mode: 'insensitive' } },
    include: { department: true },
  });

  if (!sumedh) {
    console.log('WARNING: Sumedh Sadaphal not found — skipping dept fix.\n');
  } else {
    const targetDept = contentSalesDeptFinal;
    if (sumedh.departmentId !== targetDept.id) {
      await prisma.user.update({
        where: { id: sumedh.id },
        data: {
          departmentId: targetDept.id,
          reportingManager: shubendu?.name ?? sumedh.reportingManager,
        },
      });
      console.log(`Updated ${sumedh.name}: dept → "${targetDept.name}"\n`);
    } else {
      console.log(`${sumedh.name} already in "${targetDept.name}" — skipping.\n`);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 4. Add missing employees
  // ──────────────────────────────────────────────────────────────────────────
  const defaultPassword = await bcrypt.hash('TechnoEdge@2026', 10);

  // Find Vishal for reportingManager of Balendu
  const vishal = await prisma.user.findFirst({
    where: { name: { contains: 'Vishal', mode: 'insensitive' } },
  });

  const newEmployees = [
    {
      email: 'shruti.kulkarni@technoedgels.com',
      name: 'Shruti Kulkarni',
      departmentId: contentDept.id,
      reportingManager: shubendu?.name ?? 'Shubendu Anand',
      teamLeadName: shubendu?.name ?? 'Shubendu Anand',
      avatar: '#8b5cf6',
    },
    {
      email: 'balendu.anand@technoedgels.com',
      name: 'Balendu Anand',
      departmentId: idTeamDept.id,
      reportingManager: vishal?.name ?? 'Vishal',
      teamLeadName: vishal?.name ?? 'Vishal',
      avatar: '#06b6d4',
    },
    {
      email: 'mahendra.yais@technoedgels.com',
      name: 'Mahendra Yais',
      departmentId: contentDept.id,
      reportingManager: shubendu?.name ?? 'Shubendu Anand',
      teamLeadName: shubendu?.name ?? 'Shubendu Anand',
      avatar: '#a78bfa',
    },
  ];

  for (const emp of newEmployees) {
    const existing = await prisma.user.findUnique({ where: { email: emp.email } });
    if (existing) {
      console.log(`SKIP: ${emp.name} (${emp.email}) already exists.`);
      // Still fix their dept/reporting if needed
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          departmentId: emp.departmentId,
          reportingManager: emp.reportingManager,
          teamLeadName: emp.teamLeadName,
          isActive: true,
        },
      });
      console.log(`  Updated dept/reporting for existing user.\n`);
      continue;
    }

    const created = await prisma.user.create({
      data: {
        email: emp.email,
        name: emp.name,
        password: defaultPassword,
        roleId: employeeRole.id,
        departmentId: emp.departmentId,
        reportingManager: emp.reportingManager,
        teamLeadName: emp.teamLeadName,
        mustChangePassword: true,
        isActive: true,
        avatar: emp.avatar,
      },
    });
    console.log(`Created: ${created.name} (${created.email}) — dept: ${emp.departmentId}\n`);
  }

  console.log('\n=== fix-hierarchy.ts complete ===');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
