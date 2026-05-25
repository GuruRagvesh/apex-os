/**
 * fix-hierarchy-v2.ts
 *
 * Production data fix — full org hierarchy correction.
 * Run with:
 *   DATABASE_URL="..." npx ts-node prisma/scripts/fix-hierarchy-v2.ts
 */

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// ── helpers ──────────────────────────────────────────────────────────────────

let usersUpdated = 0;
const newUsersCreated: string[] = [];
const deptRenames: string[] = [];
const managerAccessCreated: string[] = [];
const errors: string[] = [];

function log(msg: string) { console.log(msg); }
function err(msg: string) { console.error(`  ✗ ERROR: ${msg}`); errors.push(msg); }

async function getRoleId(name: string): Promise<string | null> {
  const role = await prisma.role.findFirst({ where: { name } });
  if (!role) { err(`Role not found: ${name}`); return null; }
  return role.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — FIX DEPARTMENT NAMES
// ─────────────────────────────────────────────────────────────────────────────
async function step1_fixDeptNames() {
  log('\n━━━ STEP 1: Fix Department Names ━━━');

  const contentSales = await prisma.department.findFirst({ where: { name: 'Content Sales' } });
  if (contentSales) {
    await prisma.department.update({ where: { id: contentSales.id }, data: { name: 'Sales' } });
    log('  ✓ Renamed "Content Sales" → "Sales"');
    deptRenames.push('"Content Sales" → "Sales"');
  } else {
    const sales = await prisma.department.findFirst({ where: { name: 'Sales' } });
    log(`  • "Content Sales" not found — ${sales ? '"Sales" already exists, no rename needed' : 'neither Sales nor Content Sales exists'}`);
  }

  const editorsTeam = await prisma.department.findFirst({ where: { name: 'Editors Team' } });
  if (editorsTeam) {
    await prisma.department.update({ where: { id: editorsTeam.id }, data: { name: 'Editors' } });
    log('  ✓ Renamed "Editors Team" → "Editors"');
    deptRenames.push('"Editors Team" → "Editors"');
  } else {
    const editors = await prisma.department.findFirst({ where: { name: 'Editors' } });
    log(`  • "Editors Team" not found — ${editors ? '"Editors" already exists, no rename needed' : 'neither found'}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — ADD SHUBHAM SURYAWANSHI
// ─────────────────────────────────────────────────────────────────────────────
async function step2_addShubham() {
  log('\n━━━ STEP 2: Add Shubham Suryawanshi (Head HR) ━━━');

  const hrDept = await prisma.department.findFirst({ where: { name: 'HR' } });
  if (!hrDept) { err('HR department not found — skipping Shubham creation'); return; }

  const managerRoleId = await getRoleId('MANAGER');
  if (!managerRoleId) return;

  const existing = await prisma.user.findFirst({ where: { email: 'shubham.suryawanshi@technoedgels.com' } });

  if (!existing) {
    const hashed = await bcrypt.hash('ShubhamHR@2026', 12);
    await prisma.user.create({
      data: {
        name: 'Shubham Suryawanshi',
        email: 'shubham.suryawanshi@technoedgels.com',
        password: hashed,
        roleId: managerRoleId,
        departmentId: hrDept.id,
        isActive: true,
        mustChangePassword: true,
        avatar: '#ec4899',
        designation: 'Head HR',
      },
    });
    log('  ✓ Created user: Shubham Suryawanshi (shubham.suryawanshi@technoedgels.com)');
    newUsersCreated.push('Shubham Suryawanshi <shubham.suryawanshi@technoedgels.com>');
    usersUpdated++;
  } else {
    await prisma.user.update({
      where: { id: existing.id },
      data: { roleId: managerRoleId, departmentId: hrDept.id },
    });
    log('  ✓ Updated existing Shubham: role=MANAGER, dept=HR');
    usersUpdated++;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — FIX DEPARTMENT ASSIGNMENTS
// ─────────────────────────────────────────────────────────────────────────────
async function step3_fixDeptAssignments() {
  log('\n━━━ STEP 3: Fix Department Assignments ━━━');

  const deptSales        = await prisma.department.findFirst({ where: { name: 'Sales' } });
  const deptRetail       = await prisma.department.findFirst({ where: { name: 'Retail Business' } });
  const deptEditors      = await prisma.department.findFirst({ where: { name: 'Editors' } });
  const deptID           = await prisma.department.findFirst({ where: { name: 'ID Team' } });
  const deptContent      = await prisma.department.findFirst({ where: { name: 'AI and R&D' } });
  const deptMarketing    = await prisma.department.findFirst({ where: { name: 'Marketing' } });
  const deptQC           = await prisma.department.findFirst({ where: { name: 'QC Team' } });
  const deptAIMedia      = await prisma.department.findFirst({ where: { name: 'AI & Media Production' } });
  const deptCorpTraining = await prisma.department.findFirst({ where: { name: 'Corporate Training' } });
  const deptHR           = await prisma.department.findFirst({ where: { name: 'HR' } });
  const deptAccounts     = await prisma.department.findFirst({ where: { name: 'Accounts' } });
  const deptOperations   = await prisma.department.findFirst({ where: { name: 'Operations' } })
    ?? await prisma.department.findFirst({ where: { name: 'Company' } })
    ?? await prisma.department.findFirst({ where: { name: 'Admin' } });

  log(`  Dept IDs resolved:
    Sales:               ${deptSales?.id ?? 'NOT FOUND'}
    Retail Business:     ${deptRetail?.id ?? 'NOT FOUND'}
    Editors:             ${deptEditors?.id ?? 'NOT FOUND'}
    ID Team:             ${deptID?.id ?? 'NOT FOUND'}
    AI and R&D:          ${deptContent?.id ?? 'NOT FOUND'}
    QC Team:             ${deptQC?.id ?? 'NOT FOUND'}
    AI & Media:          ${deptAIMedia?.id ?? 'NOT FOUND'}
    Corporate Training:  ${deptCorpTraining?.id ?? 'NOT FOUND'}
    HR:                  ${deptHR?.id ?? 'NOT FOUND'}
    Accounts:            ${deptAccounts?.id ?? 'NOT FOUND'}
    Operations/Company:  ${deptOperations?.id ?? 'NOT FOUND'}
  `);

  // email → department
  const assignments: Array<{ email: string; dept: typeof deptSales; deptName: string }> = [
    // RETAIL BUSINESS
    { email: 'narendra.suthar@technoedgels.com',   dept: deptRetail,       deptName: 'Retail Business' },
    { email: 'pawan.tiwari@technoedgels.com',       dept: deptRetail,       deptName: 'Retail Business' },
    // SALES
    { email: 'Sumedh.Sadaphal@technoedgels.com',    dept: deptSales,        deptName: 'Sales' },
    { email: 'harshal.tilekar@technoedgels.com',    dept: deptSales,        deptName: 'Sales' },
    { email: 'gunjan.ranglani@technoedgels.com',    dept: deptSales,        deptName: 'Sales' },
    // EDITORS
    { email: 'Shubhendu@technoedgels.com',          dept: deptEditors,      deptName: 'Editors' },
    { email: 'irfan@technoedgels.com',              dept: deptEditors,      deptName: 'Editors' },
    { email: 'gaurav@technoedgels.com',             dept: deptEditors,      deptName: 'Editors' },
    { email: 'revati.patil@technoedgels.com',       dept: deptEditors,      deptName: 'Editors' },
    { email: 'shruti.kulkarni@technoedgels.com',    dept: deptEditors,      deptName: 'Editors' },
    { email: 'mahendra.yais@technoedgels.com',      dept: deptEditors,      deptName: 'Editors' },
    // ID TEAM
    { email: 'anshika.patel@technoedgels.com',      dept: deptID,           deptName: 'ID Team' },
    { email: 'Honey.Dembani@technoedgels.com',      dept: deptID,           deptName: 'ID Team' },
    { email: 'Vishal@technoedgels.com',             dept: deptID,           deptName: 'ID Team' },
    { email: 'sahil.waykar@technoedgels.com',       dept: deptID,           deptName: 'ID Team' },
    { email: 'sanika.dongare@technoedgels.com',     dept: deptID,           deptName: 'ID Team' },
    { email: 'pooja.kamble@technoedgels.com',       dept: deptID,           deptName: 'ID Team' },
    { email: 'trishank.pal@technoedgels.com',       dept: deptID,           deptName: 'ID Team' },
    { email: 'balendu.anand@technoedgels.com',      dept: deptID,           deptName: 'ID Team' },
    // AI & MEDIA PRODUCTION
    { email: 'Arpit.Bharuka@technoedgels.com',      dept: deptAIMedia,      deptName: 'AI & Media Production' },
    { email: 'technointern602@outlook.com',         dept: deptAIMedia,      deptName: 'AI & Media Production' },
    { email: 'technointern608@outlook.com',         dept: deptAIMedia,      deptName: 'AI & Media Production' },
    // AI AND R&D
    { email: 'Guru.Thanumoorthy@technoedgels.com',  dept: deptContent,      deptName: 'AI and R&D' },
    { email: 'technointern606@outlook.com',         dept: deptContent,      deptName: 'AI and R&D' },
    { email: 'technointern607@outlook.com',         dept: deptContent,      deptName: 'AI and R&D' },
    { email: 'technointern604@outlook.com',         dept: deptContent,      deptName: 'AI and R&D' },
    { email: 'sonalikarveerkarveer@gmail.com',      dept: deptContent,      deptName: 'AI and R&D' },
    // QC TEAM
    { email: 'aniket.phapale@technoedgels.com',     dept: deptQC,           deptName: 'QC Team' },
    { email: 'salman.technoedgels@gmail.com',       dept: deptQC,           deptName: 'QC Team' },
    { email: 'sushant.gire@technoedgels.com',       dept: deptQC,           deptName: 'QC Team' },
    // CORPORATE TRAINING
    { email: 'Krunal.Mehta@technoedgels.com',       dept: deptCorpTraining, deptName: 'Corporate Training' },
    { email: 'Vaishnavi@technoedgels.com',          dept: deptCorpTraining, deptName: 'Corporate Training' },
    { email: 'Snehal.P@technoedgels.com',           dept: deptCorpTraining, deptName: 'Corporate Training' },
    { email: 'ajay.singh@technoedgels.com',         dept: deptCorpTraining, deptName: 'Corporate Training' },
    // ACCOUNTS
    { email: 'accounts@technoedgels.com',           dept: deptAccounts,     deptName: 'Accounts' },
    { email: 'finance@technoedgels.com',            dept: deptAccounts,     deptName: 'Accounts' },
    // HR
    { email: 'hr@technoedgels.com',                 dept: deptHR,           deptName: 'HR' },
    { email: 'shubham.suryawanshi@technoedgels.com',dept: deptHR,           deptName: 'HR' },
    // OPERATIONS / COMPANY
    { email: 'subrat@technoedgels.com',             dept: deptOperations,   deptName: 'Operations' },
    { email: 'pavan.lalwani@technoedgels.com',      dept: deptOperations,   deptName: 'Operations' },
    { email: 'tejas.kadam@technoedgels.com',        dept: deptOperations,   deptName: 'Operations' },
  ];

  for (const { email, dept, deptName } of assignments) {
    if (!dept) {
      err(`Dept "${deptName}" not found — skipping ${email}`);
      continue;
    }
    const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
    if (!user) {
      log(`  • SKIP ${email} — user not found in DB`);
      continue;
    }
    if (user.departmentId !== dept.id) {
      await prisma.user.update({ where: { id: user.id }, data: { departmentId: dept.id } });
      log(`  ✓ ${email} → dept: ${deptName}`);
      usersUpdated++;
    } else {
      log(`  • ${email} already in ${deptName}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4 — FIX ROLES
// ─────────────────────────────────────────────────────────────────────────────
async function step4_fixRoles() {
  log('\n━━━ STEP 4: Fix Roles ━━━');

  const managerRoleId   = await getRoleId('MANAGER');
  const adminRoleId     = await getRoleId('ADMIN');
  const teamLeadRoleId  = await getRoleId('TEAM_LEAD');
  const employeeRoleId  = await getRoleId('EMPLOYEE');
  const internRoleId    = await getRoleId('INTERN');
  const superAdminRoleId= await getRoleId('SUPER_ADMIN');

  const roleUpdates: Array<{ email: string; roleId: string | null; roleName: string }> = [
    // MANAGER
    { email: 'anshika.patel@technoedgels.com',       roleId: managerRoleId,   roleName: 'MANAGER' },
    { email: 'tejas.kadam@technoedgels.com',         roleId: managerRoleId,   roleName: 'MANAGER' },
    { email: 'Krunal.Mehta@technoedgels.com',        roleId: managerRoleId,   roleName: 'MANAGER' },
    { email: 'accounts@technoedgels.com',            roleId: managerRoleId,   roleName: 'MANAGER' },
    { email: 'shubham.suryawanshi@technoedgels.com', roleId: managerRoleId,   roleName: 'MANAGER' },
    // ADMIN
    { email: 'pavan.lalwani@technoedgels.com',       roleId: adminRoleId,     roleName: 'ADMIN' },
    // TEAM_LEAD
    { email: 'Shubhendu@technoedgels.com',           roleId: teamLeadRoleId,  roleName: 'TEAM_LEAD' },
    { email: 'Honey.Dembani@technoedgels.com',       roleId: teamLeadRoleId,  roleName: 'TEAM_LEAD' },
    { email: 'Vishal@technoedgels.com',              roleId: teamLeadRoleId,  roleName: 'TEAM_LEAD' },
    { email: 'Rajashree.Solanki@technoedgels.com',   roleId: teamLeadRoleId,  roleName: 'TEAM_LEAD' },
    { email: 'aniket.phapale@technoedgels.com',      roleId: teamLeadRoleId,  roleName: 'TEAM_LEAD' },
    { email: 'Sumedh.Sadaphal@technoedgels.com',     roleId: teamLeadRoleId,  roleName: 'TEAM_LEAD' },
    { email: 'Arpit.Bharuka@technoedgels.com',       roleId: teamLeadRoleId,  roleName: 'TEAM_LEAD' },
    { email: 'finance@technoedgels.com',             roleId: teamLeadRoleId,  roleName: 'TEAM_LEAD' },
    // SUPER_ADMIN (Guru — keep)
    { email: 'Guru.Thanumoorthy@technoedgels.com',   roleId: superAdminRoleId,roleName: 'SUPER_ADMIN' },
    // EMPLOYEE
    { email: 'narendra.suthar@technoedgels.com',     roleId: employeeRoleId,  roleName: 'EMPLOYEE' },
    { email: 'pawan.tiwari@technoedgels.com',        roleId: employeeRoleId,  roleName: 'EMPLOYEE' },
    { email: 'Charu.Kadam@technoedgels.com',         roleId: employeeRoleId,  roleName: 'EMPLOYEE' },
    { email: 'pankaj@technoedgels.com',              roleId: employeeRoleId,  roleName: 'EMPLOYEE' },
    { email: 'Harshada.Patil@technoedgels.com',      roleId: employeeRoleId,  roleName: 'EMPLOYEE' },
    { email: 'salman.technoedgels@gmail.com',        roleId: employeeRoleId,  roleName: 'EMPLOYEE' },
    { email: 'sushant.gire@technoedgels.com',        roleId: employeeRoleId,  roleName: 'EMPLOYEE' },
    { email: 'harshal.tilekar@technoedgels.com',     roleId: employeeRoleId,  roleName: 'EMPLOYEE' },
    { email: 'gunjan.ranglani@technoedgels.com',     roleId: employeeRoleId,  roleName: 'EMPLOYEE' },
    { email: 'irfan@technoedgels.com',               roleId: employeeRoleId,  roleName: 'EMPLOYEE' },
    { email: 'gaurav@technoedgels.com',              roleId: employeeRoleId,  roleName: 'EMPLOYEE' },
    { email: 'revati.patil@technoedgels.com',        roleId: employeeRoleId,  roleName: 'EMPLOYEE' },
    { email: 'sahil.waykar@technoedgels.com',        roleId: employeeRoleId,  roleName: 'EMPLOYEE' },
    { email: 'sanika.dongare@technoedgels.com',      roleId: employeeRoleId,  roleName: 'EMPLOYEE' },
    { email: 'pooja.kamble@technoedgels.com',        roleId: employeeRoleId,  roleName: 'EMPLOYEE' },
    { email: 'trishank.pal@technoedgels.com',        roleId: employeeRoleId,  roleName: 'EMPLOYEE' },
    { email: 'balendu.anand@technoedgels.com',       roleId: employeeRoleId,  roleName: 'EMPLOYEE' },
    { email: 'shruti.kulkarni@technoedgels.com',     roleId: employeeRoleId,  roleName: 'EMPLOYEE' },
    { email: 'mahendra.yais@technoedgels.com',       roleId: employeeRoleId,  roleName: 'EMPLOYEE' },
    { email: 'Vaishnavi@technoedgels.com',           roleId: employeeRoleId,  roleName: 'EMPLOYEE' },
    { email: 'Snehal.P@technoedgels.com',            roleId: employeeRoleId,  roleName: 'EMPLOYEE' },
    { email: 'ajay.singh@technoedgels.com',          roleId: employeeRoleId,  roleName: 'EMPLOYEE' },
    // INTERN
    { email: 'technointern602@outlook.com',          roleId: internRoleId,    roleName: 'INTERN' },
    { email: 'technointern608@outlook.com',          roleId: internRoleId,    roleName: 'INTERN' },
    { email: 'technointern606@outlook.com',          roleId: internRoleId,    roleName: 'INTERN' },
    { email: 'technointern607@outlook.com',          roleId: internRoleId,    roleName: 'INTERN' },
    { email: 'technointern604@outlook.com',          roleId: internRoleId,    roleName: 'INTERN' },
    { email: 'sonalikarveerkarveer@gmail.com',       roleId: internRoleId,    roleName: 'INTERN' },
    { email: 'hr@technoedgels.com',                  roleId: internRoleId,    roleName: 'INTERN' },
  ];

  for (const { email, roleId, roleName } of roleUpdates) {
    if (!roleId) { err(`Role ${roleName} not found — skipping ${email}`); continue; }
    const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
    if (!user) { log(`  • SKIP ${email} — user not found`); continue; }
    if (user.roleId !== roleId) {
      await prisma.user.update({ where: { id: user.id }, data: { roleId } });
      log(`  ✓ ${email} → role: ${roleName}`);
      usersUpdated++;
    } else {
      log(`  • ${email} already ${roleName}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 5 — FIX MANAGER DEPT ACCESS
// ─────────────────────────────────────────────────────────────────────────────
async function step5_fixManagerAccess() {
  log('\n━━━ STEP 5: Fix Manager Department Access ━━━');

  // ── Tejas ──────────────────────────────────────────────────────────────────
  const tejas = await prisma.user.findFirst({ where: { email: { equals: 'tejas.kadam@technoedgels.com', mode: 'insensitive' } } });
  if (tejas) {
    await prisma.managerDeptAccess.deleteMany({ where: { managerId: tejas.id } });
    log('  ✓ Cleared existing access for Tejas');
    const tejasDeptNames = ['Retail Business', 'QC Team', 'AI and R&D', 'Sales', 'AI & Media Production'];
    for (const name of tejasDeptNames) {
      const dept = await prisma.department.findFirst({ where: { name } });
      if (dept) {
        await prisma.managerDeptAccess.upsert({
          where: { managerId_departmentId: { managerId: tejas.id, departmentId: dept.id } },
          update: { accessLevel: 'FULL' },
          create: { managerId: tejas.id, departmentId: dept.id, accessLevel: 'FULL' },
        });
        log(`  ✓ Tejas → ${name} (FULL)`);
        managerAccessCreated.push(`Tejas → ${name}`);
      } else {
        err(`Dept "${name}" not found for Tejas access`);
      }
    }
  } else {
    err('tejas.kadam@technoedgels.com not found');
  }

  // ── Anshika ────────────────────────────────────────────────────────────────
  const anshika = await prisma.user.findFirst({ where: { email: { equals: 'anshika.patel@technoedgels.com', mode: 'insensitive' } } });
  if (anshika) {
    await prisma.managerDeptAccess.deleteMany({ where: { managerId: anshika.id } });
    log('  ✓ Cleared existing access for Anshika');
    for (const name of ['ID Team', 'Editors']) {
      const dept = await prisma.department.findFirst({ where: { name } });
      if (dept) {
        await prisma.managerDeptAccess.upsert({
          where: { managerId_departmentId: { managerId: anshika.id, departmentId: dept.id } },
          update: { accessLevel: 'FULL' },
          create: { managerId: anshika.id, departmentId: dept.id, accessLevel: 'FULL' },
        });
        log(`  ✓ Anshika → ${name} (FULL)`);
        managerAccessCreated.push(`Anshika → ${name}`);
      } else {
        err(`Dept "${name}" not found for Anshika access`);
      }
    }
  } else {
    err('anshika.patel@technoedgels.com not found');
  }

  // ── Krunal ─────────────────────────────────────────────────────────────────
  const krunal = await prisma.user.findFirst({ where: { email: { equals: 'Krunal.Mehta@technoedgels.com', mode: 'insensitive' } } });
  if (krunal) {
    const dept = await prisma.department.findFirst({ where: { name: 'Corporate Training' } });
    if (dept) {
      await prisma.managerDeptAccess.upsert({
        where: { managerId_departmentId: { managerId: krunal.id, departmentId: dept.id } },
        update: { accessLevel: 'FULL' },
        create: { managerId: krunal.id, departmentId: dept.id, accessLevel: 'FULL' },
      });
      log('  ✓ Krunal → Corporate Training (FULL)');
      managerAccessCreated.push('Krunal → Corporate Training');
    } else { err('Dept "Corporate Training" not found for Krunal'); }
  } else { err('Krunal.Mehta@technoedgels.com not found'); }

  // ── Payal ──────────────────────────────────────────────────────────────────
  const payal = await prisma.user.findFirst({ where: { email: { equals: 'accounts@technoedgels.com', mode: 'insensitive' } } });
  if (payal) {
    const dept = await prisma.department.findFirst({ where: { name: 'Accounts' } });
    if (dept) {
      await prisma.managerDeptAccess.upsert({
        where: { managerId_departmentId: { managerId: payal.id, departmentId: dept.id } },
        update: { accessLevel: 'FULL' },
        create: { managerId: payal.id, departmentId: dept.id, accessLevel: 'FULL' },
      });
      log('  ✓ Payal → Accounts (FULL)');
      managerAccessCreated.push('Payal → Accounts');
    } else { err('Dept "Accounts" not found for Payal'); }
  } else { err('accounts@technoedgels.com not found'); }

  // ── Shubham ────────────────────────────────────────────────────────────────
  const shubham = await prisma.user.findFirst({ where: { email: { equals: 'shubham.suryawanshi@technoedgels.com', mode: 'insensitive' } } });
  if (shubham) {
    const dept = await prisma.department.findFirst({ where: { name: 'HR' } });
    if (dept) {
      await prisma.managerDeptAccess.upsert({
        where: { managerId_departmentId: { managerId: shubham.id, departmentId: dept.id } },
        update: { accessLevel: 'FULL' },
        create: { managerId: shubham.id, departmentId: dept.id, accessLevel: 'FULL' },
      });
      log('  ✓ Shubham → HR (FULL)');
      managerAccessCreated.push('Shubham → HR');
    } else { err('Dept "HR" not found for Shubham'); }
  } else { err('shubham.suryawanshi@technoedgels.com not found (created in step 2)'); }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 6 — FIX AKSHADA HR ACCESS
// ─────────────────────────────────────────────────────────────────────────────
async function step6_fixAkshada() {
  log('\n━━━ STEP 6: Fix Akshada HR Access ━━━');
  const akshada = await prisma.user.findFirst({ where: { email: { equals: 'hr@technoedgels.com', mode: 'insensitive' } } });
  if (!akshada) { err('hr@technoedgels.com not found'); return; }
  await prisma.user.update({ where: { id: akshada.id }, data: { isHR: true } });
  log('  ✓ Akshada (hr@technoedgels.com) → isHR = true');
  usersUpdated++;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 7 — UPDATE REPORTING MANAGER
// ─────────────────────────────────────────────────────────────────────────────
async function step7_reportingManagers() {
  log('\n━━━ STEP 7: Update Reporting Manager Field ━━━');

  const updates: Array<{ email: string; reportingManager: string }> = [
    // Under Anshika
    { email: 'Shubhendu@technoedgels.com',           reportingManager: 'Anshika Patel' },
    // Under Shubendu
    { email: 'Honey.Dembani@technoedgels.com',       reportingManager: 'Shubendu Anand' },
    { email: 'Vishal@technoedgels.com',              reportingManager: 'Shubendu Anand' },
    { email: 'irfan@technoedgels.com',               reportingManager: 'Shubendu Anand' },
    { email: 'gaurav@technoedgels.com',              reportingManager: 'Shubendu Anand' },
    { email: 'revati.patil@technoedgels.com',        reportingManager: 'Shubendu Anand' },
    { email: 'shruti.kulkarni@technoedgels.com',     reportingManager: 'Shubendu Anand' },
    { email: 'mahendra.yais@technoedgels.com',       reportingManager: 'Shubendu Anand' },
    // Under Honey
    { email: 'sahil.waykar@technoedgels.com',        reportingManager: 'Honey Dembani' },
    { email: 'sanika.dongare@technoedgels.com',      reportingManager: 'Honey Dembani' },
    // Under Vishal
    { email: 'pooja.kamble@technoedgels.com',        reportingManager: 'Vishal Bornare' },
    { email: 'trishank.pal@technoedgels.com',        reportingManager: 'Vishal Bornare' },
    { email: 'balendu.anand@technoedgels.com',       reportingManager: 'Vishal Bornare' },
    // Under Rajashree
    { email: 'Charu.Kadam@technoedgels.com',         reportingManager: 'Rajashree Solanki' },
    { email: 'pankaj@technoedgels.com',              reportingManager: 'Rajashree Solanki' },
    { email: 'Harshada.Patil@technoedgels.com',      reportingManager: 'Rajashree Solanki' },
    { email: 'pawan.tiwari@technoedgels.com',        reportingManager: 'Rajashree Solanki' },
    { email: 'narendra.suthar@technoedgels.com',     reportingManager: 'Rajashree Solanki' },
    // Under Guru
    { email: 'technointern606@outlook.com',          reportingManager: 'Guru Thanumoorthy' },
    { email: 'technointern607@outlook.com',          reportingManager: 'Guru Thanumoorthy' },
    { email: 'technointern604@outlook.com',          reportingManager: 'Guru Thanumoorthy' },
    { email: 'sonalikarveerkarveer@gmail.com',       reportingManager: 'Guru Thanumoorthy' },
    // Under Aniket
    { email: 'salman.technoedgels@gmail.com',        reportingManager: 'Aniket Phapale' },
    { email: 'sushant.gire@technoedgels.com',        reportingManager: 'Aniket Phapale' },
    // Under Sumedh
    { email: 'harshal.tilekar@technoedgels.com',     reportingManager: 'Sumedh Sadaphal' },
    { email: 'gunjan.ranglani@technoedgels.com',     reportingManager: 'Sumedh Sadaphal' },
    // Under Arpit
    { email: 'technointern602@outlook.com',          reportingManager: 'Arpit Bharuka' },
    { email: 'technointern608@outlook.com',          reportingManager: 'Arpit Bharuka' },
    // Under Krunal
    { email: 'Vaishnavi@technoedgels.com',           reportingManager: 'Krunal Mehta' },
    { email: 'Snehal.P@technoedgels.com',            reportingManager: 'Krunal Mehta' },
    { email: 'ajay.singh@technoedgels.com',          reportingManager: 'Krunal Mehta' },
    // Akshada under Shubham
    { email: 'hr@technoedgels.com',                  reportingManager: 'Shubham Suryawanshi' },
    // Managers reporting to Pavan
    { email: 'anshika.patel@technoedgels.com',       reportingManager: 'Pavan Lalwani' },
    { email: 'tejas.kadam@technoedgels.com',         reportingManager: 'Pavan Lalwani' },
    { email: 'Krunal.Mehta@technoedgels.com',        reportingManager: 'Pavan Lalwani' },
    { email: 'accounts@technoedgels.com',            reportingManager: 'Pavan Lalwani' },
    { email: 'shubham.suryawanshi@technoedgels.com', reportingManager: 'Pavan Lalwani' },
  ];

  for (const { email, reportingManager } of updates) {
    const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
    if (!user) { log(`  • SKIP ${email} — not found`); continue; }
    if (user.reportingManager !== reportingManager) {
      await prisma.user.update({ where: { id: user.id }, data: { reportingManager } });
      log(`  ✓ ${email} → reportingManager: "${reportingManager}"`);
      usersUpdated++;
    } else {
      log(`  • ${email} already has reportingManager="${reportingManager}"`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 8 — VERIFY AND REPORT
// ─────────────────────────────────────────────────────────────────────────────
async function step8_verify() {
  log('\n━━━ STEP 8: Verify & Report ━━━');

  const totalUsers = await prisma.user.count({ where: { isActive: true } });
  const byDept = await prisma.user.groupBy({
    by: ['departmentId'],
    _count: { id: true },
    where: { isActive: true },
  });

  log(`\nDepartments with active users:`);
  for (const d of byDept) {
    if (d.departmentId) {
      const dept = await prisma.department.findUnique({ where: { id: d.departmentId } });
      log(`  ${(dept?.name ?? 'Unknown').padEnd(30)} ${d._count.id} users`);
    } else {
      log(`  (no dept assigned)${' '.repeat(12)} ${d._count.id} users`);
    }
  }

  // Role breakdown
  const byRole = await prisma.user.groupBy({
    by: ['roleId'],
    _count: { id: true },
    where: { isActive: true },
  });
  log(`\nActive users by role:`);
  for (const r of byRole) {
    if (r.roleId) {
      const role = await prisma.role.findUnique({ where: { id: r.roleId } });
      log(`  ${(role?.name ?? 'Unknown').padEnd(15)} ${r._count.id}`);
    }
  }

  log(`\n${'='.repeat(50)}`);
  log(`HIERARCHY FIX COMPLETE`);
  log(`${'='.repeat(50)}`);
  log(`Total active users:          ${totalUsers}`);
  log(`Users updated/created:       ${usersUpdated}`);
  log(`New users created:           ${newUsersCreated.length > 0 ? newUsersCreated.join(', ') : 'none'}`);
  log(`Dept renames:                ${deptRenames.length > 0 ? deptRenames.join(', ') : 'none (already renamed)'}`);
  log(`Manager access entries:      ${managerAccessCreated.length}`);
  if (managerAccessCreated.length) {
    managerAccessCreated.forEach((e) => log(`  • ${e}`));
  }
  log(`Errors encountered:          ${errors.length}`);
  if (errors.length) {
    errors.forEach((e) => log(`  ✗ ${e}`));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  log('╔══════════════════════════════════════════════════╗');
  log('║  nexus-app  •  fix-hierarchy-v2.ts               ║');
  log('║  Production hierarchy correction                  ║');
  log('╚══════════════════════════════════════════════════╝');
  log(`Started at: ${new Date().toISOString()}\n`);

  try {
    await step1_fixDeptNames();
    await step2_addShubham();
    await step3_fixDeptAssignments();
    await step4_fixRoles();
    await step5_fixManagerAccess();
    await step6_fixAkshada();
    await step7_reportingManagers();
    await step8_verify();
  } catch (e: any) {
    console.error('\nFATAL ERROR:', e);
    errors.push(`FATAL: ${e?.message ?? String(e)}`);
  } finally {
    await prisma.$disconnect();
    log(`\nFinished at: ${new Date().toISOString()}`);
    if (errors.length > 0) process.exit(1);
  }
}

main();
