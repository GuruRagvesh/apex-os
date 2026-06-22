import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

async function bootstrap() {
  const args = process.argv.slice(2);
  const hasDryRunFlag = args.includes('--dry-run');
  const hasApplyFlag = args.includes('--apply');

  if (hasDryRunFlag && hasApplyFlag) {
    console.error('Error: Cannot pass both --dry-run and --apply.');
    process.exit(1);
  }

  const isApply = hasApplyFlag;

  console.log('Starting D2.2 Backfill Script (department memberships, role assignments, ticket routing fields)...');
  console.log(`Mode: ${isApply ? 'APPLY (Mutating)' : 'DRY-RUN (Read Only, default)'}`);

  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);

  try {
    const summary = {
      usersScanned: 0,
      userDeptMembershipsToCreate: 0,
      userDeptMembershipsExisting: 0,
      userRoleAssignmentsToCreate: 0,
      userRoleAssignmentsExisting: 0,
      ticketsScanned: 0,
      ticketsNeedingRequestingDept: 0,
      ticketsNeedingTargetDept: 0,
      ticketsNeedingCrossDeptNormalization: 0,
    };

    const users = await prisma.user.findMany({
      select: { id: true, departmentId: true, roleId: true },
    });
    summary.usersScanned = users.length;

    for (const user of users) {
      // 1. UserDepartmentMembership backfill
      if (user.departmentId) {
        const existingMembership = await prisma.userDepartmentMembership.findUnique({
          where: { userId_departmentId: { userId: user.id, departmentId: user.departmentId } },
        });

        if (existingMembership) {
          summary.userDeptMembershipsExisting++;
        } else {
          summary.userDeptMembershipsToCreate++;
          if (isApply) {
            await prisma.userDepartmentMembership.create({
              data: { userId: user.id, departmentId: user.departmentId, isPrimary: true },
            });
          }
        }
      }

      // 2. UserRoleAssignment backfill
      if (user.roleId) {
        const existingAssignment = await prisma.userRoleAssignment.findFirst({
          where: {
            userId: user.id,
            roleId: user.roleId,
            departmentId: user.departmentId ?? null,
            teamId: null,
          },
        });

        if (existingAssignment) {
          summary.userRoleAssignmentsExisting++;
        } else {
          summary.userRoleAssignmentsToCreate++;
          if (isApply) {
            await prisma.userRoleAssignment.create({
              data: {
                userId: user.id,
                roleId: user.roleId,
                departmentId: user.departmentId ?? null,
                teamId: null,
                isPrimary: true,
              },
            });
          }
        }
      }
    }

    // 3. Ticket routing field backfill
    const tickets = await prisma.ticket.findMany({
      select: {
        id: true,
        departmentId: true,
        requestingDepartmentId: true,
        targetDepartmentId: true,
        isCrossDepartment: true,
      },
    });
    summary.ticketsScanned = tickets.length;

    for (const ticket of tickets) {
      const data: { requestingDepartmentId?: string; targetDepartmentId?: string; isCrossDepartment?: boolean } = {};

      if (!ticket.requestingDepartmentId && ticket.departmentId) {
        data.requestingDepartmentId = ticket.departmentId;
        summary.ticketsNeedingRequestingDept++;
      }
      if (!ticket.targetDepartmentId && ticket.departmentId) {
        data.targetDepartmentId = ticket.departmentId;
        summary.ticketsNeedingTargetDept++;
      }
      if (ticket.isCrossDepartment === null || ticket.isCrossDepartment === undefined) {
        data.isCrossDepartment = false;
        summary.ticketsNeedingCrossDeptNormalization++;
      }

      if (Object.keys(data).length > 0 && isApply) {
        await prisma.ticket.update({ where: { id: ticket.id }, data });
      }
    }

    const finalDeptMembershipCount = await prisma.userDepartmentMembership.count();
    const finalRoleAssignmentCount = await prisma.userRoleAssignment.count();
    const finalTicketsWithRequesting = await prisma.ticket.count({
      where: { requestingDepartmentId: { not: null } },
    });
    const finalTicketsWithTarget = await prisma.ticket.count({
      where: { targetDepartmentId: { not: null } },
    });

    console.log('\n--- D2.2 Backfill Report ---');
    console.log(`Mode: ${isApply ? 'APPLY' : 'DRY-RUN'}`);
    console.log(`Users scanned: ${summary.usersScanned}`);
    console.log(`User department memberships to create: ${summary.userDeptMembershipsToCreate}`);
    console.log(`User department memberships already existing: ${summary.userDeptMembershipsExisting}`);
    console.log(`User role assignments to create: ${summary.userRoleAssignmentsToCreate}`);
    console.log(`User role assignments already existing: ${summary.userRoleAssignmentsExisting}`);
    console.log(`Tickets scanned: ${summary.ticketsScanned}`);
    console.log(`Tickets needing requestingDepartmentId: ${summary.ticketsNeedingRequestingDept}`);
    console.log(`Tickets needing targetDepartmentId: ${summary.ticketsNeedingTargetDept}`);
    console.log(`Tickets needing isCrossDepartment normalization: ${summary.ticketsNeedingCrossDeptNormalization}`);

    console.log('\n--- Final Verification Counts ---');
    console.log(`Total UserDepartmentMembership rows: ${finalDeptMembershipCount}`);
    console.log(`Total UserRoleAssignment rows: ${finalRoleAssignmentCount}`);
    console.log(`Tickets with requestingDepartmentId set: ${finalTicketsWithRequesting}`);
    console.log(`Tickets with targetDepartmentId set: ${finalTicketsWithTarget}`);

    if (isApply) {
      console.log('\nApply complete. Data was written.');
    } else {
      console.log('\nDry-run complete. No data was modified. Re-run with --apply to persist changes.');
    }

    await app.close();
  } catch (err) {
    console.error('Backfill script failed:', err);
    await app.close();
    process.exit(1);
  }
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
