import { api, unwrap as r } from '@apex/shared-auth';

/**
 * Provenance for the employee's own attendance.
 *
 * Backed by GET /attendance/me/activity, a narrow projection over the audit
 * trail — NOT the generic /events stream, which carries every operational
 * event in the company and stays scoped to HR and leadership.
 *
 * The endpoint takes no user id: it answers only for the authenticated caller,
 * so there is nothing here to pass and nothing to get wrong.
 */

export interface ActivityChange {
  field: string;
  from: string | null;
  to: string | null;
}

export interface AttendanceActivityEntry {
  id: string;
  action: string;
  /** Readable sentence, e.g. "Attendance corrected". */
  label: string;
  businessDate: string | null;
  at: string;
  actorName: string | null;
  actorRole: string | null;
  reason: string | null;
  fromState: string | null;
  toState: string | null;
  changed: ActivityChange[] | null;
}

export async function getMyAttendanceActivity(
  businessDate?: string,
): Promise<AttendanceActivityEntry[]> {
  const rows = await r<AttendanceActivityEntry[]>(
    api.get('/attendance/me/activity', {
      params: businessDate ? { businessDate } : undefined,
    }),
  );
  return Array.isArray(rows) ? rows : [];
}

/** Field names an employee should recognise. */
const FIELD_LABEL: Record<string, string> = {
  status: 'Status',
  punchInAt: 'Punch in',
  punchOutAt: 'Punch out',
  workedMinutes: 'Worked minutes',
};

export function fieldLabel(field: string): string {
  return FIELD_LABEL[field] ?? field;
}

/**
 * "Priya Sharma (HR)", "HR", or "System".
 *
 * The role alone is a deliberate fallback rather than a blank: knowing HR made
 * a change is useful even when the name is unavailable.
 */
export function actorLabel(entry: AttendanceActivityEntry): string {
  if (entry.actorName && entry.actorRole) return `${entry.actorName} (${entry.actorRole})`;
  return entry.actorName ?? entry.actorRole ?? 'System';
}
