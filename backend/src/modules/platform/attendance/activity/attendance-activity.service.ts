import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { TVAService } from '../../../../common/services/tva.service';

/**
 * The employee's own attendance provenance.
 *
 * A NARROW projection over the existing OperationalEvent audit trail, not a
 * second audit system: the source of truth stays where HR and leadership read
 * it, and nothing here writes.
 *
 * Why this exists rather than opening /events to employees: that stream carries
 * every operational event in the company — tickets, users, system actions — and
 * widening its authorization to give an employee their own attendance history
 * would weaken a system-wide boundary to solve a local problem.
 *
 * SCOPING. The employee is usually NOT the actor: HR corrects THEIR record, so
 * filtering by actorId would hide exactly the events that matter most. Instead
 * the entity ids are derived from rows the requester owns — their own
 * regularizations and their own DailyAttendance rows — and events are matched
 * against those ids. A caller therefore cannot reach another employee's events
 * even by guessing an id, because the id set is built from their own rows and
 * never from input.
 *
 * There is deliberately no userId parameter anywhere in this file.
 */

/** Actions an employee may see about their own attendance. */
const EMPLOYEE_VISIBLE_ACTIONS = new Set([
  'REGULARIZATION_REQUESTED',
  'REGULARIZATION_MANAGER_APPROVED',
  'REGULARIZATION_HR_APPROVED',
  'REGULARIZATION_REJECTED',
  'ATTENDANCE_OFFICIAL_REVISED',
  'COMP_OFF_GRANTED',
]);

/** Human sentences. An audit row is evidence; this is what it means. */
const ACTION_TEXT: Record<string, string> = {
  REGULARIZATION_REQUESTED: 'Correction requested',
  REGULARIZATION_MANAGER_APPROVED: 'Manager approved',
  REGULARIZATION_HR_APPROVED: 'HR approved',
  REGULARIZATION_REJECTED: 'Correction rejected',
  ATTENDANCE_OFFICIAL_REVISED: 'Attendance corrected',
  COMP_OFF_GRANTED: 'Comp Off granted',
};

/**
 * Fields of a before/after snapshot an employee may see.
 *
 * An allowlist, never a blocklist: a snapshot is a JSON blob written by another
 * part of the system, and a field added there later must not become visible
 * here by default.
 */
const VISIBLE_SNAPSHOT_FIELDS = ['status', 'punchInAt', 'punchOutAt', 'workedMinutes'] as const;

export interface AttendanceActivityEntry {
  id: string;
  action: string;
  /** Readable sentence for the employee. */
  label: string;
  businessDate: string | null;
  at: string;
  actorName: string | null;
  actorRole: string | null;
  reason: string | null;
  fromState: string | null;
  toState: string | null;
  /** Only for an authoritative correction, and only allowlisted fields. */
  changed: Array<{ field: string; from: string | null; to: string | null }> | null;
}

function pick(snapshot: any): Record<string, any> {
  if (!snapshot || typeof snapshot !== 'object') return {};
  const out: Record<string, any> = {};
  for (const f of VISIBLE_SNAPSHOT_FIELDS) {
    if (f in snapshot) out[f] = snapshot[f];
  }
  return out;
}

function present(value: any): string | null {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

@Injectable()
export class AttendanceActivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tva: TVAService,
  ) {}

  /**
   * Activity about the caller's own attendance.
   *
   * `businessDate` narrows to one day; omitting it returns the recent window.
   */
  async mine(userId: string, businessDate?: string): Promise<AttendanceActivityEntry[]> {
    const dateFilter = businessDate
      ? { date: new Date(`${businessDate}T00:00:00.000Z`) }
      : {};

    // Ids of rows this employee owns. Nothing here comes from the caller.
    const [regularizations, attendanceRows] = await Promise.all([
      this.prisma.attendanceRegularization.findMany({
        where: { userId, ...dateFilter },
        select: { id: true, date: true, reason: true },
      }),
      this.prisma.dailyAttendance.findMany({
        where: { userId, ...dateFilter },
        select: { id: true, date: true },
      }),
    ]);

    const regIds = regularizations.map((r) => r.id);
    const attIds = attendanceRows.map((a) => a.id);
    if (regIds.length === 0 && attIds.length === 0) return [];

    const dateByEntity = new Map<string, string>();
    for (const r of regularizations) {
      dateByEntity.set(r.id, r.date.toISOString().slice(0, 10));
    }
    for (const a of attendanceRows) {
      dateByEntity.set(a.id, a.date.toISOString().slice(0, 10));
    }

    // The employee's own words live on the regularization ROW, not in any
    // event metadata: only a rejection records its reason there. Without this
    // map "Reason: Forgot to punch out" -- the line that explains the whole
    // entry -- would render blank on every event except the rejection.
    const reasonByRegularization = new Map<string, string>();
    for (const r of regularizations) {
      if (r.reason) reasonByRegularization.set(r.id, r.reason);
    }

    const events = await (this.prisma as any).operationalEvent.findMany({
      where: {
        OR: [
          ...(regIds.length
            ? [{ entityType: 'AttendanceRegularization', entityId: { in: regIds } }]
            : []),
          ...(attIds.length ? [{ entityType: 'DailyAttendance', entityId: { in: attIds } }] : []),
        ],
      },
      orderBy: { timestamp: 'desc' },
      take: 200,
      select: {
        id: true,
        action: true,
        entityId: true,
        fromState: true,
        toState: true,
        metadata: true,
        beforeValue: true,
        afterValue: true,
        timestamp: true,
        // Name and role only. Never the actor's contact details.
        actor: { select: { name: true, role: { select: { name: true } } } },
      },
    });

    return events
      .filter((e: any) => EMPLOYEE_VISIBLE_ACTIONS.has(e.action))
      .map((e: any) => this.project(e, dateByEntity, reasonByRegularization));
  }

  private project(
    e: any,
    dateByEntity: Map<string, string>,
    reasonByRegularization: Map<string, string>,
  ): AttendanceActivityEntry {
    const before = pick(e.beforeValue);
    const after = pick(e.afterValue);

    const changed = Object.keys({ ...before, ...after })
      .filter((f) => present(before[f]) !== present(after[f]))
      .map((f) => ({ field: f, from: present(before[f]), to: present(after[f]) }));

    // metadata is a free-form blob written elsewhere; only the two fields an
    // employee needs are read out of it, never the whole object.
    const meta = (e.metadata ?? {}) as Record<string, any>;

    return {
      id: e.id,
      action: e.action,
      label: ACTION_TEXT[e.action] ?? e.action,
      businessDate:
        (typeof meta.businessDate === 'string' ? meta.businessDate : null) ??
        dateByEntity.get(e.entityId) ??
        null,
      at: e.timestamp.toISOString(),
      actorName: e.actor?.name ?? null,
      actorRole: e.actor?.role?.name ?? null,
      // A rejection's own reason wins: it explains the decision, which is more
      // use to the employee than restating what they originally asked for.
      // Otherwise fall back to the request this event belongs to.
      reason:
        (typeof meta.reason === 'string' ? meta.reason : null) ??
        reasonByRegularization.get(e.entityId) ??
        (typeof meta.regularizationId === 'string'
          ? (reasonByRegularization.get(meta.regularizationId) ?? null)
          : null),
      fromState: e.fromState ?? null,
      toState: e.toState ?? null,
      changed: changed.length > 0 ? changed : null,
    };
  }
}
