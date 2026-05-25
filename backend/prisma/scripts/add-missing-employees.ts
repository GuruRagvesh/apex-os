const bcrypt = require('bcryptjs')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  // Find required references
  const employeeRole = await prisma.role.findFirst({
    where: { name: 'EMPLOYEE' }
  })
  if (!employeeRole) throw new Error('EMPLOYEE role not found')

  const editorsDept = await prisma.department.findFirst({
    where: { name: 'Editors' }
  })
  const idTeamDept = await prisma.department.findFirst({
    where: { name: 'ID Team' }
  })
  const shubendu = await prisma.user.findFirst({
    where: { email: { contains: 'shubhendu', mode: 'insensitive' } }
  })
  const vishal = await prisma.user.findFirst({
    where: { email: { contains: 'vishal', mode: 'insensitive' } }
  })

  console.log('References found:')
  console.log('  EMPLOYEE role:', employeeRole?.id)
  console.log('  Editors dept:', editorsDept?.id ?? 'NOT FOUND')
  console.log('  ID Team dept:', idTeamDept?.id ?? 'NOT FOUND')
  console.log('  Shubendu:', shubendu?.name ?? 'NOT FOUND')
  console.log('  Vishal:', vishal?.name ?? 'NOT FOUND')

  const password = await bcrypt.hash('TechnoEdge@2026', 12)

  const employees = [
    {
      name: 'Shruti Kulkarni',
      email: 'shruti.kulkarni@technoedgels.com',
      roleId: employeeRole.id,
      departmentId: editorsDept?.id,
      reportingManager: shubendu?.name || 'Shubendu Anand',
      designation: 'Content Executive',
      avatar: '#8b5cf6',
    },
    {
      name: 'Balendu Anand',
      email: 'balendu.anand@technoedgels.com',
      roleId: employeeRole.id,
      departmentId: idTeamDept?.id,
      reportingManager: vishal?.name || 'Vishal Bornare',
      designation: 'ID Executive',
      avatar: '#06b6d4',
    },
    {
      name: 'Mahendra Yais',
      email: 'mahendra.yais@technoedgels.com',
      roleId: employeeRole.id,
      departmentId: editorsDept?.id,
      reportingManager: shubendu?.name || 'Shubendu Anand',
      designation: 'Content Executive',
      avatar: '#f59e0b',
    },
  ]

  for (const emp of employees) {
    const existing = await prisma.user.findFirst({
      where: { email: { equals: emp.email, mode: 'insensitive' } }
    })
    if (existing) {
      console.log(`SKIP: ${emp.email} already exists`)
      continue
    }
    const created = await prisma.user.create({
      data: {
        ...emp,
        password,
        isActive: true,
        mustChangePassword: true,
        employmentType: 'Full-time',
        workMode: 'Office',
        shiftTiming: '9:30 AM - 6:30 PM',
      }
    })
    console.log(`CREATED: ${created.name} (${created.email}) id=${created.id}`)
  }

  console.log('\nDone.')
}

main().catch(console.error).finally(() => prisma.$disconnect())
