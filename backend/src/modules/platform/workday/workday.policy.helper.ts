import { formatInTimeZone } from 'date-fns-tz';

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

  const hhmm = resolvePolicyCutoffForUser(user, policy);
  if (!hhmm) return { shouldStop: false };

  const timezone = policy.timezone || 'Asia/Kolkata';
  const cutoffUtc = buildCompanyDateTimeUtc(currentCompanyDateStr, hhmm, timezone);

  if (now.getTime() >= cutoffUtc.getTime()) {
    return { shouldStop: true, cutoffUtc };
  }

  return { shouldStop: false };
}
