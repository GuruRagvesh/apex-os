/**
 * Read-only census of attendance onboarding for existing production users.
 *
 * This script deliberately has no apply mode and contains no write operation.
 * A missing joining date or profile is reported only; it is never repaired.
 */

import { PrismaClient } from '@prisma/client';
import {
  assertProductionIdentity,
  maskEmail,
} from './repair-production-attendance-six';

export type ExistingUserAttendanceFacts = {
  joiningDate: Date | null;
  profiles: Array<{ effectiveFrom: Date; effectiveTo: Date | null }>;
};

export function classifyExistingUser(
  user: ExistingUserAttendanceFacts,
  businessDate: Date,
) {
  const currentProfiles = user.profiles.filter(
    (profile) =>
      profile.effectiveFrom.getTime() <= businessDate.getTime() &&
      (!profile.effectiveTo || profile.effectiveTo.getTime() >= businessDate.getTime()),
  );
  return {
    missingJoiningDate: !user.joiningDate,
    profileCount: user.profiles.length,
    currentProfileCount: currentProfiles.length,
    noProfile: user.profiles.length === 0,
    noCurrentProfile: currentProfiles.length === 0,
    overlappingCurrentProfiles: currentProfiles.length > 1,
  };
}

function indiaBusinessDate(now = new Date()) {
  const india = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return new Date(`${india.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

async function main() {
  assertProductionIdentity(process.env);
  const prisma = new PrismaClient();
  try {
    const businessDate = indiaBusinessDate();
    const users = await prisma.user.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        email: true,
        name: true,
        joiningDate: true,
        role: { select: { name: true } },
        attendanceProfiles: {
          orderBy: { effectiveFrom: 'asc' },
          select: { effectiveFrom: true, effectiveTo: true },
        },
      },
    });

    const rows = users.map((user) => ({
      user,
      assessment: classifyExistingUser(
        { joiningDate: user.joiningDate, profiles: user.attendanceProfiles },
        businessDate,
      ),
    }));
    const missingJoiningDate = rows.filter((row) => row.assessment.missingJoiningDate);
    const noProfile = rows.filter((row) => row.assessment.noProfile);
    const noCurrentProfile = rows.filter((row) => row.assessment.noCurrentProfile);
    const overlaps = rows.filter((row) => row.assessment.overlappingCurrentProfiles);

    console.log('PRODUCTION ATTENDANCE ONBOARDING AUDIT (READ-ONLY)');
    console.log(`business date              ${businessDate.toISOString().slice(0, 10)}`);
    console.log(`active users               ${rows.length}`);
    console.log(`missing joining date       ${missingJoiningDate.length}`);
    console.log(`no attendance profile      ${noProfile.length}`);
    console.log(`no profile in force today  ${noCurrentProfile.length}`);
    console.log(`overlapping current rows   ${overlaps.length}`);

    const observations = rows.filter(
      (row) =>
        row.assessment.missingJoiningDate ||
        row.assessment.noCurrentProfile ||
        row.assessment.overlappingCurrentProfiles,
    );
    if (observations.length) {
      console.log('\nObservations (no changes will be made):');
      for (const { user, assessment } of observations) {
        const flags = [
          assessment.missingJoiningDate ? 'MISSING_JOINING_DATE' : null,
          assessment.noProfile ? 'NO_PROFILE' : null,
          !assessment.noProfile && assessment.noCurrentProfile ? 'NO_CURRENT_PROFILE' : null,
          assessment.overlappingCurrentProfiles ? 'OVERLAPPING_CURRENT_PROFILES' : null,
        ].filter(Boolean);
        console.log(
          `${maskEmail(user.email).padEnd(34)} ${user.role.name.padEnd(12)} ${flags.join(',')}`,
        );
      }
    }
    console.log('\nAUDIT COMPLETE. No data was written.');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.message ?? error);
    process.exitCode = 1;
  });
}

