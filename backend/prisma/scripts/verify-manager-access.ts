import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient({ datasources: { db: { url: 'postgresql://apex_db_dugl_user:fuS4u9yKddhK1qo2yMESGvpLdUB4gERg@dpg-d8259omk1jcs73e37fbg-a.oregon-postgres.render.com/apex_db_dugl' } } })

async function main() {
  const managers = await prisma.user.findMany({
    where: { role: { name: 'MANAGER' } },
    include: {
      role: true,
      department: true,
      managedDepts: { include: { department: true } }
    }
  })
  console.log(`\nFound ${managers.length} MANAGER(s):\n`)
  for (const m of managers) {
    console.log(`${m.name} (${m.email})`)
    console.log(`  Primary dept: ${m.department?.name || 'NONE'} (id: ${m.departmentId || 'NONE'})`)
    console.log(`  Managed depts: ${m.managedDepts.map((d: any) => d.department.name).join(', ') || 'NONE'}`)
    // Fix: if no managed depts but has a primary dept, add it
    if (m.managedDepts.length === 0 && m.departmentId) {
      console.log(`  ⚠ Fixing: Adding primary department to ManagerDeptAccess...`)
      await (prisma as any).managerDeptAccess.upsert({
        where: { managerId_departmentId: { managerId: m.id, departmentId: m.departmentId } },
        create: { managerId: m.id, departmentId: m.departmentId, accessLevel: 'WRITE' },
        update: { accessLevel: 'WRITE' },
      })
      console.log(`  ✓ Fixed: Added dept ${m.department?.name} to ManagerDeptAccess for ${m.name}`)
    }
  }
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
