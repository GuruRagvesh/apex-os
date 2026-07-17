import { formatInTimeZone } from 'date-fns-tz';

// How long a WORKING/ON_BREAK session gets to respond to the auto-close
// prompt before the backend treats it as abandoned and force-closes it.
// Keyed off User.lastActiveAt, which startWork/endBreak/resumeWork/
// continueWorking all refresh — so a user who is genuinely still present
// (or who taps "Continue Working") never gets silently cut off, while a
// closed laptop or dead tab still gets swept up safely once this window
// passes with no further activity.
export const AUTO_CLOSE_GRACE_MINUTES = 20;

export function resolvePolicyCutoffForUser(user: { role?: { name: string } } | any, policy: any): string | null {
  if (!policy || !user || !user.role) return null;

  const roleName = user.role.name;

  if (['EMPLOYEE', 'INTERN'].includes(roleName)) {
    if (policy.employeeTiming && policy.employeeTiming.end) {
      return policy.employeeTiming.end; // e.g. "18:30"
    }
  }

  if (roleName === 'TEAM_LEAD') {
    if (policy.tlTiming && policy.tlTiming.exitEnd) {
      return policy.tlTiming.exitEnd; // e.g. "19:30"
    }
  }

  if (['MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(roleName)) {
    if (policy.managerTiming && policy.managerTiming.flexible) {
      return null;
    }
  }

  return null;
}

export function buildCompanyDateTimeUtc(companyDateStr: string, hhmm: string, timezone: string): Date {
  const [hour, minute] = hhmm.split(':');
  const isoStr = `${companyDateStr}T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:00.000`;
  
  // Calculate timezone offset for the given date in the target timezone
  // We can just create a dummy date to extract the offset string like '+05:30'
  const offsetString = formatInTimeZone(new Date(), timezone, 'xxx');
  return new Date(`${isoStr}${offsetString}`);
}

export function shouldPolicyAutoStop(
  session: any,
  user: any,
  policy: any,
  now: Date,
  currentCompanyDateStr: string,
  sessionCompanyDateStr: string
): { shouldStop: boolean, cutoffUtc?: Date } {
  if (policy?.autoClose !== true) return { shouldStop: false };
  if (session.logoutAt !== null) return { shouldStop: false };
  if (sessionCompanyDateStr !== currentCompanyDateStr) return { shouldStop: false }; // midnight handles others

  // Global Auto Close Time is the final company cutoff for every role today.
  // Role timing windows (resolvePolicyCutoffForUser) remain available for other
  // policy validation, but must not exempt anyone from this cutoff.
  const hhmm = policy.autoCloseTime || '23:59';
  const timezone = policy.timezone || 'Asia/Kolkata';
  const cutoffUtc = buildCompanyDateTimeUtc(currentCompanyDateStr, hhmm, timezone);

  if (now.getTime() < cutoffUtc.getTime()) {
    return { shouldStop: false };
  }

  // Past cutoff. Do not silently kill a session the user is demonstrably still
  // in (WORKING/ON_BREAK with a recent activity signal) — give them the grace
  // window to see the frontend consent prompt and respond. A session with no
  // activity signal inside the window (or not WORKING/ON_BREAK at all, e.g.
  // already IDLE) is treated as abandoned and closes exactly as before.
  if (['WORKING', 'ON_BREAK'].includes(session.status)) {
    const lastActiveMs = user?.lastActiveAt ? new Date(user.lastActiveAt).getTime() : 0;
    const isRecentlyActive = now.getTime() - lastActiveMs < AUTO_CLOSE_GRACE_MINUTES * 60000;
    if (isRecentlyActive) {
      return { shouldStop: false };
    }
  }

  return { shouldStop: true, cutoffUtc };
}
