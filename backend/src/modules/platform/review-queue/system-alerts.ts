/**
 * System alerts in the unified review queue.
 *
 * A PunchEvidenceReview is written by the punch service, inside the punch
 * transaction, when evidence or attendance configuration is incomplete. Nobody
 * asked for it: the employee is the person the alert is ABOUT, never the person
 * who raised it. This module holds the pure parts of that contract -- the
 * HR-facing wording and the employee/date grouping -- so they stay testable
 * without a database.
 *
 * Origin is derived from the request type, which is fixed by the table the row
 * comes from. No stored flag and no UI guesswork: every historical review row
 * is a system alert simply because of where it lives.
 */

import { POLICY_BLOCKER_PREFIX } from '../attendance/punch/punch-evidence.types';
import type { ReviewQueueItem, ReviewRequestType } from './review-queue.types';

export { POLICY_BLOCKER_PREFIX };

export const SYSTEM_REQUEST_TYPES: readonly ReviewRequestType[] = ['PUNCH_EVIDENCE_REVIEW'];

export function isSystemRequestType(type: ReviewRequestType): boolean {
  return SYSTEM_REQUEST_TYPES.includes(type);
}

const POLICY_BLOCKER_LABEL: Record<string, string> = {
  NO_PROFILE_FOR_DATE: 'No attendance profile covers this date',
  MISSING_SHIFT_ASSIGNMENT: 'No shift is assigned',
  MISSING_SHIFT_POLICY: 'The assigned shift has no active shift policy for this date',
  MISSING_ATTENDANCE_POLICY: 'The shift has no active attendance policy for this date',
  MISSING_HOLIDAY_CALENDAR: 'No holiday calendar is assigned',
  AMBIGUOUS_HOLIDAY_CALENDAR: 'More than one holiday calendar could apply (ambiguous calendar assignment)',
  MISSING_WEEKLY_OFF_POLICY: 'No weekly-off policy is assigned',
  AMBIGUOUS_WEEKLY_OFF_POLICY: 'More than one weekly-off policy could apply (ambiguous calendar assignment)',
};

export interface AlertReason {
  code: string;
  title: string;
  explanation: string;
  /** POLICY_SETUP_PENDING only: the recorded blockers, or [] when none were recorded. */
  blockers?: string[];
}

export function policyBlockers(reasonCodes: string[]): string[] {
  return reasonCodes
    .filter((code) => code.startsWith(POLICY_BLOCKER_PREFIX))
    .map((code) => code.slice(POLICY_BLOCKER_PREFIX.length));
}

/** HR-facing wording for each evidence flag on a review row. */
export function alertReasons(reasonCodes: string[]): AlertReason[] {
  const blockers = policyBlockers(reasonCodes);
  const reasons: AlertReason[] = [];
  for (const code of reasonCodes) {
    if (code.startsWith(POLICY_BLOCKER_PREFIX)) continue;
    if (code === 'POLICY_SETUP_PENDING') {
      const labels = [...new Set(blockers)].map((b) => POLICY_BLOCKER_LABEL[b] ?? b.replaceAll('_', ' ').toLowerCase());
      reasons.push({
        code,
        title: 'Attendance policy setup pending',
        explanation: labels.length
          ? `Attendance configuration was incomplete when this punch was recorded: ${labels.join('; ')}.`
          : 'Attendance configuration was incomplete when this punch was recorded. The exact blocker was not recorded for this punch, so it is unavailable.',
        blockers: labels,
      });
    } else if (code === 'DEVICE_ID_UNAVAILABLE') {
      reasons.push({
        code,
        title: 'Device ID unavailable',
        explanation: 'The device installation ID was unavailable or invalid when this punch was recorded. The punch itself is still valid.',
      });
    } else if (code === 'ACCURACY_UNAVAILABLE') {
      reasons.push({
        code,
        title: 'GPS accuracy unavailable',
        explanation: 'The device did not report GPS accuracy for this punch, so the location precision is unknown.',
      });
    } else {
      reasons.push({ code, title: code.replaceAll('_', ' ').toLowerCase(), explanation: 'Punch evidence needs review.' });
    }
  }
  return reasons;
}

/** One line for the queue's Alert column. */
export function alertTitle(reasonCodes: string[]): string {
  const titles = [...new Set(alertReasons(reasonCodes).map((r) => r.title))];
  return titles.join(' · ') || 'Punch evidence needs review';
}

/**
 * Collapses repeated alerts for one affected employee, business date and
 * status into one queue row. Presentation only: every source row keeps its own
 * id, and an action on the group resolves each pending member individually.
 */
export function groupSystemAlerts(items: ReviewQueueItem[]): ReviewQueueItem[] {
  const groups = new Map<string, ReviewQueueItem[]>();
  const order: string[] = [];
  for (const item of items) {
    const key = `${item.affectedEmployee?.id ?? item.subjectUserId ?? item.id}:${String(item.details.businessDate ?? '')}:${item.sourceStatus}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(item);
  }
  return order.map((key) => {
    const members = [...groups.get(key)!].sort((a, b) =>
      String(a.details.occurredAt ?? a.requestDate).localeCompare(String(b.details.occurredAt ?? b.requestDate)));
    const lead = members[members.length - 1];
    const reasonCodes = [...new Set(members.flatMap((m) => (m.details.reasonCodes as string[] | undefined) ?? []))];
    const punchTypes = [...new Set(members.map((m) => m.details.punchType).filter(Boolean))] as string[];
    return {
      ...lead,
      reason: alertTitle(reasonCodes),
      requestDate: members.map((m) => m.requestDate).sort().reverse()[0],
      details: {
        ...lead.details,
        reasonCodes,
        alertReasons: alertReasons(reasonCodes),
        punchType: punchTypes.length === 1 ? punchTypes[0] : punchTypes,
        punchEvents: members.map((m) => ({
          reviewId: m.id,
          punchType: m.details.punchType,
          occurredAt: m.details.occurredAt,
          reasonCodes: m.details.reasonCodes,
        })),
        reviewIds: members.map((m) => m.id),
        evidenceCount: members.length,
      },
    };
  });
}
