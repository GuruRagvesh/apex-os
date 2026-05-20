import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const tlSpace = await prisma.role.findFirst({ where: { name: 'TEAM LEAD' } });
  const tlUnderscore = await prisma.role.findFirst({ where: { name: 'TEAM_LEAD' } });
  if (tlSpace && tlUnderscore) {
    // Both exist: reassign users from TEAM LEAD to TEAM_LEAD and delete TEAM LEAD
    await prisma.user.updateMany({ where: { roleId: tlSpace.id }, data: { roleId: tlUnderscore.id } });
    await prisma.role.delete({ where: { id: tlSpace.id } });
    console.log('Merged TEAM LEAD into TEAM_LEAD and deleted TEAM LEAD duplicate.');
  } else if (tlSpace) {
    await prisma.role.update({ where: { id: tlSpace.id }, data: { name: 'TEAM_LEAD' } });
    console.log('Fixed TEAM LEAD -> TEAM_LEAD');
  } else {
    console.log('TEAM_LEAD status:', tlUnderscore ? 'exists correctly' : 'missing');
  }
  const roles = await prisma.role.findMany({ select: { name: true } });
  console.log('All roles:', roles.map((r: any) => r.name).join(', '));
}
main().catch(console.error).finally(() => prisma.$disconnect());
