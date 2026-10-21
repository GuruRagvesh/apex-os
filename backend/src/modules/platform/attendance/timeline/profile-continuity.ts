import type { Prisma } from '@prisma/client';

/**
 * Attendance-profile continuity at employment boundaries (Phase 3).
 *
 * Deactivate and Archive close the profile in force on the last working day;
 * Reactivate and Rehire open a new one from the return date. Together they
 * guarantee that no profile covers an inactive employment gap, so no
 * attendance conclusion can ever be generated for days the person was not
 * employed. Profiles are never deleted or rewritten beyond their end date.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function dateOnly(businessDate: string): Date {
  if (!DAY.test(businessDate)) throw new Error(`Invalid business date: ${businessDate}`);
  return new Date(`${businessDate}T00:00:00.000Z`);
}

/**
 * Ends every profile still in force after `lastDay` on `lastDay`.
 *
 * Only profiles that STARTED on or before the last day are closed; a profile
 * dated to start later (a person deactivated before joining) is left for the
 * scheduled-join flow, since closing it would produce an inverted range.
 * Returns how many profiles were closed. Idempotent.
 */
export async function closeProfilesAt(
  tx: Prisma.TransactionClient,
  userId: string,
  lastDay: string,
  actorId?: string | null,
): Promise<number> {
  const end = dateOnly(lastDay);
  const out = await tx.employeeAttendanceProfile.updateMany({
    where: {
      userId,
      effectiveFrom: { lte: end },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: end } }],
    },
    data: { effectiveTo: end, updatedById: actorId ?? null },
  });
  return out.count;
}

/**
 * Opens a new profile on the return date by copying the most recent profile's
 * assignments (category, shift, leave policy, calendar, weekly off, location).
 *
 * The assigned versions name a policy SERIES; the continuity resolver applies
 * whichever version of that series governs each later date, so copying them
 * never pins the person to a stale version. Returns the new profile's id, or
 * null when there was no earlier profile to continue (the caller then records
 * attendance setup as pending) or a profile already covers the return date.
 */
export async function reopenProfileFrom(
  tx: Prisma.TransactionClient,
  userId: string,
  returnDay: string,
  actorId?: string | null,
): Promise<string | null> {
  const start = dateOnly(returnDay);
  const covering = await tx.employeeAttendanceProfile.findFirst({
    where: { userId, effectiveFrom: { lte: start }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: start } }] },
    select: { id: true },
  });
  if (covering) return null;

  const later = await tx.employeeAttendanceProfile.findFirst({
    where: { userId, effectiveFrom: { gt: start } },
    orderBy: { effectiveFrom: 'asc' },
    select: { effectiveFrom: true },
  });
  const previous = await tx.employeeAttendanceProfile.findFirst({
    where: { userId, effectiveFrom: { lt: start } },
    orderBy: { effectiveFrom: 'desc' },
  });
  if (!previous) return null;

  const created = await tx.employeeAttendanceProfile.create({
    data: {
      userId,
      category: previous.category,
      attendanceRequired: previous.attendanceRequired,
      assignedShiftId: previous.assignedShiftId,
      assignedLeavePolicyId: previous.assignedLeavePolicyId,
      assignedHolidayCalendarId: previous.assignedHolidayCalendarId,
      assignedWeeklyOffPolicyId: previous.assignedWeeklyOffPolicyId,
      assignedAttendanceLocationId: previous.assignedAttendanceLocationId,
      reportingManagerId: previous.reportingManagerId,
      hrReviewerId: previous.hrReviewerId,
      effectiveFrom: start,
      // Never overlap a profile already scheduled to begin later.
      effectiveTo: later ? new Date(later.effectiveFrom.getTime() - 24 * 60 * 60 * 1000) : null,
      updatedById: actorId ?? null,
    },
    select: { id: true },
  });
  return created.id;
}
