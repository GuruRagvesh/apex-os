import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting production data fixes...\n');

  // ─────────────────────────────────────────────────────────────────────────
  // FIX 1 — Role casing: update all role names to UPPERCASE
  // ─────────────────────────────────────────────────────────────────────────
  console.log('FIX 1: Updating role names to UPPERCASE...');
  const roles = await prisma.role.findMany();
  let rolesUpdated = 0;
  for (const role of roles) {
    const upperName = role.name.toUpperCase();
    if (role.name !== upperName) {
      // Check if an uppercase version already exists
      const existingUpper = await prisma.role.findFirst({ where: { name: upperName } });
      if (existingUpper) {
        // Merge: reassign all users from this role to the uppercase version, then delete
        await prisma.user.updateMany({ where: { roleId: role.id }, data: { roleId: existingUpper.id } });
        await prisma.role.delete({ where: { id: role.id } });
        console.log(`  Merged duplicate role "${role.name}" into "${upperName}" and deleted duplicate.`);
      } else {
        await prisma.role.update({ where: { id: role.id }, data: { name: upperName } });
        console.log(`  Updated role: "${role.name}" → "${upperName}"`);
      }
      rolesUpdated++;
    }
  }
  if (rolesUpdated === 0) console.log('  All roles already UPPERCASE.');
  console.log(`  Roles updated/merged: ${rolesUpdated}\n`);

  // ─────────────────────────────────────────────────────────────────────────
  // FIX 2 — Deactivate duplicate Salman (salman_technointern@outlook.com)
  //          and reassign his tickets/leave to salman.technoedgels@gmail.com
  // ─────────────────────────────────────────────────────────────────────────
  console.log('FIX 2: Handling duplicate Salman...');
  const duplicateSalman = await prisma.user.findUnique({
    where: { email: 'salman_technointern@outlook.com' },
  });
  const mainSalman = await prisma.user.findUnique({
    where: { email: 'salman.technoedgels@gmail.com' },
  });

  if (!duplicateSalman) {
    console.log('  salman_technointern@outlook.com not found — skipping.');
  } else if (!mainSalman) {
    console.log('  salman.technoedgels@gmail.com not found — cannot reassign. Skipping.');
  } else {
    // Reassign created tickets
    const createdTickets = await prisma.ticket.updateMany({
      where: { createdById: duplicateSalman.id },
      data: { createdById: mainSalman.id },
    });
    console.log(`  Reassigned ${createdTickets.count} created ticket(s) to main Salman.`);

    // Reassign assigned tickets
    const assignedTickets = await prisma.ticket.updateMany({
      where: { assignedToId: duplicateSalman.id },
      data: { assignedToId: mainSalman.id },
    });
    console.log(`  Reassigned ${assignedTickets.count} assigned ticket(s) to main Salman.`);

    // Reassign leave requests
    const leaveRequests = await prisma.leaveRequest.updateMany({
      where: { userId: duplicateSalman.id },
      data: { userId: mainSalman.id },
    });
    console.log(`  Reassigned ${leaveRequests.count} leave request(s) to main Salman.`);

    // Deactivate duplicate
    await prisma.user.update({
      where: { id: duplicateSalman.id },
      data: { isActive: false },
    });
    console.log('  Deactivated salman_technointern@outlook.com.\n');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FIX 3 — Create HR Department if not exists
  // ─────────────────────────────────────────────────────────────────────────
  console.log('FIX 3: Creating HR Department...');
  let hrDept = await prisma.department.findFirst({ where: { name: 'HR' } });
  if (hrDept) {
    console.log(`  HR department already exists (id: ${hrDept.id}). Skipping creation.\n`);
  } else {
    hrDept = await prisma.department.create({
      data: {
        name: 'HR',
        description: 'Human Resources — Employee wellbeing, recruitment, compliance',
        color: '#ec4899',
      },
    });
    console.log(`  Created HR department (id: ${hrDept.id}).\n`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FIX 4 — Create Akshada Kadam (hr@technoedgels.com) if not exists
  //          or update her departmentId if she already exists
  // ─────────────────────────────────────────────────────────────────────────
  console.log('FIX 4: Creating/updating Akshada Kadam...');
  const akshadaEmail = 'hr@technoedgels.com';

  // Get INTERN role
  const internRole = await prisma.role.findFirst({ where: { name: 'INTERN' } });
  if (!internRole) {
    console.log('  INTERN role not found — skipping Akshada creation.');
  } else {
    const existingAkshada = await prisma.user.findUnique({ where: { email: akshadaEmail } });
    if (existingAkshada) {
      // Update her departmentId
      await prisma.user.update({
        where: { id: existingAkshada.id },
        data: { departmentId: hrDept!.id, avatar: '#ec4899' },
      });
      console.log(`  Updated Akshada Kadam's department to HR.\n`);
    } else {
      const hashedPassword = await bcrypt.hash('TechnoEdge@2024', 10);
      await prisma.user.create({
        data: {
          email: akshadaEmail,
          name: 'Akshada Kadam',
          password: hashedPassword,
          roleId: internRole.id,
          departmentId: hrDept!.id,
          mustChangePassword: true,
          avatar: '#ec4899',
          isActive: true,
        },
      });
      console.log('  Created Akshada Kadam (hr@technoedgels.com) in HR department.\n');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FIX 5 — Fix Marketing dept color if not set
  // ─────────────────────────────────────────────────────────────────────────
  console.log('FIX 5: Checking Marketing department color...');
  const marketingDept = await prisma.department.findFirst({
    where: { name: { contains: 'Marketing', mode: 'insensitive' } },
  });
  if (!marketingDept) {
    console.log('  Marketing department not found — skipping.\n');
  } else if (!marketingDept.color || marketingDept.color === '#6366f1') {
    await prisma.department.update({
      where: { id: marketingDept.id },
      data: { color: '#f97316' },
    });
    console.log(`  Updated Marketing color to #f97316.\n`);
  } else {
    console.log(`  Marketing color already set to "${marketingDept.color}" — skipping.\n`);
  }

  console.log('Production data fixes complete!');
}

main().catch(console.error).finally(() => prisma.$disconnect());
