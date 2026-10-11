import type { AttendanceDayBundle, PolicyReference } from './recovery.types';
import { resolveEmployee, type EmployeeIndex } from './identity-map';
import { resolvePolicyReference, type PolicyVersionRow } from './policy-map';

/**
 * Does everything a recovery bundle points at already exist in the target?
 *
 * Recovery never creates the things attendance depends on: no User, no
 * LeaveRequest, no policy, no calendar, no location, no profile. So every
 * reference must resolve against what is already there.
 *
 *   missing  — the referenced thing does not exist          → MISSING_REFERENCE
 *   review   — it exists but disagrees with the history      → MANUAL_REVIEW
 *              (a draft policy version, or one not effective on that date)
 *
 * References INSIDE the bundle (a break's session, the day's sessions) are
 * structural and checked by the document validator. References that leave the
 * bundle (a session continued from another day, evidence attached to another
 * day's session) must already exist in the target.
 */

export interface ReferenceContext {
  employeeIndex: EmployeeIndex;
  attendancePolicies: Map<string, PolicyVersionRow>;
  shiftPolicies: Map<string, PolicyVersionRow>;
  holidayCalendars: Map<string, PolicyVersionRow>;
  existingLeaveIds: Set<string>;
  existingIds: {
    weeklyOffPolicy: Set<string>;
    holiday: Set<string>;
    businessDayOverride: Set<string>;
    employeeProfile: Set<string>;
    attendanceLocation: Set<string>;
    workSession: Set<string>;
    regularization: Set<string>;
  };
}

export interface ReferenceCheck {
  missing: string[];
  review: string[];
}

export function checkReferences(bundle: AttendanceDayBundle, ctx: ReferenceContext): ReferenceCheck {
  const missing = new Set<string>();
  const review = new Set<string>();
  const date = bundle.businessDate;

  const policy = (label: string, ref: PolicyReference | null, index: Map<string, PolicyVersionRow>) => {
    if (!ref) return;
    const r = resolvePolicyReference(ref, index, date);
    if (r.state === 'MISSING_REFERENCE') missing.add(`${label}_MISSING`);
    if (r.state === 'DRAFT_VERSION') review.add(`${label}_DRAFT_VERSION`);
    if (r.state === 'NOT_EFFECTIVE_ON_DATE') review.add(`${label}_NOT_EFFECTIVE_ON_DATE`);
  };
  const exists = (label: string, id: string | null, set: Set<string>) => {
    if (id && !set.has(id)) missing.add(`${label}_MISSING`);
  };
  const actor = (label: string, employeeId: string | null) => {
    if (!employeeId) return;
    const r = resolveEmployee(employeeId, ctx.employeeIndex);
    if (r.state === 'MISSING_REFERENCE') missing.add(`${label}_MISSING`);
    if (r.state === 'CONFLICT') review.add(`${label}_AMBIGUOUS`);
  };

  policy('ATTENDANCE_POLICY', bundle.attendancePolicyReference, ctx.attendancePolicies);
  policy('SHIFT_POLICY', bundle.shiftPolicyReference, ctx.shiftPolicies);

  // Leave is reference-only: recovery never creates a LeaveRequest or touches a balance.
  for (const id of bundle.leaveReferences) if (!ctx.existingLeaveIds.has(id)) missing.add('LEAVE_REQUEST_MISSING');

  const da = bundle.dailyAttendance;
  if (da) {
    policy('HOLIDAY_CALENDAR', da.holidayCalendarReference, ctx.holidayCalendars);
    exists('WEEKLY_OFF_POLICY', da.weeklyOffPolicyId, ctx.existingIds.weeklyOffPolicy);
    exists('HOLIDAY', da.holidayId, ctx.existingIds.holiday);
    exists('BUSINESS_DAY_OVERRIDE', da.businessDayOverrideId, ctx.existingIds.businessDayOverride);
    exists('EMPLOYEE_PROFILE', da.employeeProfileId, ctx.existingIds.employeeProfile);
    if (da.lastRegularizationId && !bundle.regularizations.some((g) => g.id === da.lastRegularizationId)) {
      exists('REGULARIZATION', da.lastRegularizationId, ctx.existingIds.regularization);
    }
  }
  const inBundle = new Set(bundle.workSessions.map((s) => s.id));
  for (const s of bundle.workSessions) {
    if (s.continuationOfSessionId && !inBundle.has(s.continuationOfSessionId)) {
      exists('CONTINUED_SESSION', s.continuationOfSessionId, ctx.existingIds.workSession);
    }
  }
  for (const e of bundle.punchEvidence) {
    policy('EVIDENCE_SHIFT_POLICY', e.shiftPolicyReference, ctx.shiftPolicies);
    policy('EVIDENCE_ATTENDANCE_POLICY', e.attendancePolicyReference, ctx.attendancePolicies);
    exists('ATTENDANCE_LOCATION', e.attendanceLocationId, ctx.existingIds.attendanceLocation);
    exists('EMPLOYEE_PROFILE', e.employeeProfileId, ctx.existingIds.employeeProfile);
    if (e.workSessionId && !inBundle.has(e.workSessionId)) exists('EVIDENCE_SESSION', e.workSessionId, ctx.existingIds.workSession);
  }
  for (const g of bundle.regularizations) {
    actor('REGULARIZATION_MANAGER_APPROVER', g.managerApproverEmployeeId);
    actor('REGULARIZATION_HR_APPROVER', g.hrApproverEmployeeId);
    actor('REGULARIZATION_CREATED_BY', g.createdByEmployeeId);
  }
  return { missing: [...missing].sort(), review: [...review].sort() };
}
