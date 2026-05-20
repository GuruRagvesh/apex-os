import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding manager dept access...\n');

  // Tejas — multi-dept manager
  const tejas = await prisma.user.findFirst({ where: { email: 'tejas.kadam@technoedgels.com' } });
  if (tejas) {
    const tejaDepts = ['Marketing', 'QC Team', 'AI and R&D', 'Content Sales'];
    for (const deptName of tejaDepts) {
      const dept = await prisma.department.findFirst({ where: { name: deptName } });
      if (dept) {
        await prisma.managerDeptAccess.upsert({
          where: { managerId_departmentId: { managerId: tejas.id, departmentId: dept.id } },
          update: { accessLevel: 'FULL' },
          create: { managerId: tejas.id, departmentId: dept.id, accessLevel: 'FULL' },
        });
        console.log(`  Tejas → ${deptName}: FULL access`);
      } else {
        console.log(`  WARNING: dept "${deptName}" not found`);
      }
    }
  } else {
    console.log('WARNING: Tejas not found');
  }

  // Akshada — set isHR
  const akshada = await prisma.user.findFirst({ where: { email: 'hr@technoedgels.com' } });
  if (akshada) {
    await prisma.user.update({ where: { id: akshada.id }, data: { isHR: true } });
    console.log('Akshada isHR = true');
  } else {
    console.log('WARNING: Akshada not found');
  }

  // Other managers → their primary dept
  const managers = await prisma.user.findMany({
    where: { role: { name: 'MANAGER' }, isActive: true },
    include: { role: true, department: true },
  });
  for (const mgr of managers) {
    if (mgr.departmentId) {
      await prisma.managerDeptAccess.upsert({
        where: { managerId_departmentId: { managerId: mgr.id, departmentId: mgr.departmentId } },
        update: { accessLevel: 'FULL' },
        create: { managerId: mgr.id, departmentId: mgr.departmentId, accessLevel: 'FULL' },
      });
      console.log(`  Manager ${mgr.name} → ${(mgr.department as any)?.name}: FULL access`);
    }
  }

  console.log('\nDone!');
}

main().catch(console.error).finally(() => prisma.$disconnect());
