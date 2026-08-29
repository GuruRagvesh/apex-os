import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { TVAService } from '../../../../common/services/tva.service';
import { AttendanceConsoleService } from '../console/attendance-console.service';
import {
  deriveExceptions,
  filterExceptions,
  summariseExceptions,
  UNREPRESENTABLE,
  type EmployeeRef,
  type ExceptionItem,
} from './exception-derivation';

/**
 * Attendance Exception Queue (EQ-1).
 *
 * READ ONLY. Every method here is a SELECT. The queue resolves nothing itself —
 * it names the authorised action and the existing service that performs it, and
 * an item disappears when that service changes the record it was derived from.
 *
 * Three properties this file exists to hold:
 *
 *  1. NO SECOND TRUTH STORE. Nothing is written. There is no exception table,
 *     no acknowledgement, no snooze. Every item is recomputed from
 *     DailyAttendance, AttendanceRegularization and AttendancePunchHandoff on
 *     each request, so it cannot drift from the record it describes.
 *
 *  2. SCOPE IS SERVER-SIDE. The employee set is resolved from the actor's real
 *     reporting hierarchy before a single row is read, using the same
 *     resolveScope() the console already uses. No client filter can widen it —
 *     the filters below only ever narrow what scope already returned.
 *
 *  3. NO INVENTED HISTORY. A failure that never reached the server has no row,
 *     and none is fabricated for it. UNREPRESENTABLE is returned with every
 *     response so an empty queue is not mistaken for a quiet day.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Same ceiling the console uses. A queue is for acting on, not for archaeology. */
const MAX_RANGE_DAYS = 62;
const DEFAULT_LOOKBACK_DAYS = 14;
const MAX_ITEMS = 500;

export interface ExceptionFilters {
  from?: string;
  to?: string;
  category?: string;
  state?: string;
  userId?: string;
  department?: string;
}

@Injectable()
export class AttendanceExceptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tva: TVAService,
    private readonly console: AttendanceConsoleService,
  ) {}

  /**
   * Whether this actor may see a queue at all, and how wide.
   *
   * An employee with no reports gets a refusal rather than an empty list. The
   * two are indistinguishable to a caller, and "you have no authority here" is
   * a different fact from "there is nothing wrong today".
   */
  private async scopeFor(actor: any) {
    const scope = await this.console.resolveScope(actor);
    if (!scope.isHr && (scope.userIds?.length ?? 0) === 0) {
      throw new ForbiddenException(
        'Attendance exceptions are visible to HR and to managers with reporting employees.',
      );
    }
    return scope;
  }

  private assertDate(value: string, label: string) {
    if (!DATE_RE.test(value ?? '')) {
      throw new BadRequestException(`${label} must be a yyyy-MM-dd date`);
    }
  }

  /** Resolves the window without ever letting the caller choose an unbounded one. */
  private window(filters: ExceptionFilters) {
    const to = filters.to ?? this.tva.companyToday();
    this.assertDate(to, 'to');

    const defaultFrom = new Date(`${to}T12:00:00.000Z`);
    defaultFrom.setUTCDate(defaultFrom.getUTCDate() - (DEFAULT_LOOKBACK_DAYS - 1));
    const from = filters.from ?? defaultFrom.toISOString().slice(0, 10);
    this.assertDate(from, 'from');

    if (from > to) throw new BadRequestException('from must not be after to');

    const spanDays =
      Math.round(
        (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000,
      ) + 1;
    if (spanDays > MAX_RANGE_DAYS) {
      throw new BadRequestException(`The range may not exceed ${MAX_RANGE_DAYS} days`);
    }

    return {
      from,
      to,
      gte: this.tva.companyDateOnly(new Date(`${from}T00:00:00.000Z`)),
      lte: this.tva.companyDateOnly(new Date(`${to}T00:00:00.000Z`)),
    };
  }

  private scopeWhere(scope: { userIds: string[] | null }, extra: any = {}) {
    return scope.userIds === null ? extra : { ...extra, userId: { in: scope.userIds } };
  }

  /**
   * The queue.
   *
   * Everything is fetched inside the scope and the window, handed to the pure
   * derivation rules, and only then filtered. Filtering after derivation is
   * deliberate: it keeps the summary and the list computed from one set of
   * items, so a count can never disagree with the rows beneath it.
   */
  async list(actor: any, filters: ExceptionFilters = {}) {
    const scope = await this.scopeFor(actor);
    const { from, to, gte, lte } = this.window(filters);
    const now = this.tva.now();

    const [attendance, regularizations, handoffs] = await Promise.all([
      this.prisma.dailyAttendance.findMany({
        where: this.scopeWhere(scope, {
          date: { gte, lte },
          // Only days that are actually asking a question. A settled day must
          // never be read here, or the queue becomes a roster with extra steps.
          OR: [
            { evaluationState: 'NEEDS_REVIEW' },
            {
              status: {
                in: ['MISSING_PUNCH', 'PENDING_REGULARIZATION', 'GEO_MISMATCH', 'FACE_MISSING'],
              },
            },
            { exceptionFlags: { isEmpty: false } },
          ],
        }),
        orderBy: { date: 'desc' },
        take: MAX_ITEMS,
      }),
      this.prisma.attendanceRegularization.findMany({
        // Corrections are windowed by the DAY THEY CONCERN, not by when they
        // were raised: a request filed today about last month belongs with last
        // month, and a queue filtered to this week must not hide it there.
        where: this.scopeWhere(scope, {
          date: { gte, lte },
          status: { in: ['PENDING', 'MANAGER_APPROVED'] },
        }),
        orderBy: { createdAt: 'asc' },
        take: MAX_ITEMS,
      }),
      this.prisma.attendancePunchHandoff.findMany({
        where: this.scopeWhere(scope, {
          // A WAITING row is never swept to EXPIRED by anything, so expiry is
          // decided here from the clock rather than trusted from the column.
          status: { in: ['WAITING', 'EXPIRED'] },
          expiresAt: { lte: now },
          evidenceId: null,
          createdAt: {
            gte: this.tva.companyDayStart(new Date(`${from}T00:00:00.000Z`)),
            lte: this.tva.companyDayEnd(new Date(`${to}T00:00:00.000Z`)),
          },
        }),
        orderBy: { createdAt: 'desc' },
        take: MAX_ITEMS,
      }),
    ]);

    // Punches are read ONLY to answer "did the handoff's punch eventually
    // land". With no expired handoff there is no such question, and sweeping
    // every punch in the window would be a large read on a live database for
    // nothing. Still scoped, and narrowed further to the employees concerned.
    //
    // The intersection with scope is written out rather than left to
    // scopeWhere(), whose userId assignment would otherwise REPLACE this
    // narrowing instead of combining with it. The handoffs were already
    // scoped, so this changes nothing today — it just cannot go wrong later.
    const handoffUserIds = [...new Set(handoffs.map((h: any) => h.userId))];
    const scopedHandoffUserIds =
      scope.userIds === null
        ? handoffUserIds
        : handoffUserIds.filter((id) => scope.userIds!.includes(id));

    const punches =
      scopedHandoffUserIds.length === 0
        ? []
        : await this.prisma.attendancePunchEvidence.findMany({
            where: {
              businessDate: { gte, lte },
              userId: { in: scopedHandoffUserIds },
            },
            select: { userId: true, businessDate: true, type: true },
          });

    const employees = await this.employeeRefs([
      ...attendance.map((r: any) => r.userId),
      ...regularizations.map((r: any) => r.userId),
      ...handoffs.map((r: any) => r.userId),
    ]);

    const items = deriveExceptions({
      attendance: attendance.map((r: any) => ({
        id: r.id,
        userId: r.userId,
        businessDate: this.tva.companyBusinessDate(r.date),
        status: r.status,
        evaluationState: r.evaluationState,
        exceptionFlags: (r.exceptionFlags as string[]) ?? [],
        punchInAt: r.punchInAt ? r.punchInAt.toISOString() : null,
        punchOutAt: r.punchOutAt ? r.punchOutAt.toISOString() : null,
        calculationReason: r.calculationReason ?? null,
        updatedAt: r.updatedAt ? r.updatedAt.toISOString() : null,
      })),
      regularizations: regularizations.map((r: any) => ({
        id: r.id,
        userId: r.userId,
        businessDate: this.tva.companyBusinessDate(r.date),
        status: r.status,
        requestType: r.requestType,
        entrySource: r.entrySource,
        reason: r.reason,
        recoveryReason: r.recoveryReason ?? null,
        createdAt: r.createdAt ? r.createdAt.toISOString() : null,
      })),
      handoffs: handoffs.map((h: any) => ({
        id: h.id,
        userId: h.userId,
        businessDate: this.tva.companyBusinessDate(h.createdAt),
        intent: h.intent,
        status: h.status,
        expiredByClock: h.expiresAt.getTime() <= now.getTime(),
        hasEvidence: !!h.evidenceId,
        createdAt: h.createdAt ? h.createdAt.toISOString() : null,
      })),
      punches: punches.map((p: any) => ({
        userId: p.userId,
        businessDate: this.tva.companyBusinessDate(p.businessDate),
        type: p.type,
      })),
      employees,
    });

    const filtered = filterExceptions(items, filters);

    return {
      from,
      to,
      scope: scope.isHr ? ('COMPANY' as const) : ('TEAM' as const),
      summary: summariseExceptions(filtered),
      items: filtered,
      // Stated in the payload, not only in a comment: an empty queue does not
      // mean nothing went wrong, and the reader has to be able to see which
      // failures leave no record at all.
      notRepresented: UNREPRESENTABLE,
    };
  }

  /** The compact strip. Same derivation, counts only. */
  async summary(actor: any, filters: ExceptionFilters = {}) {
    const { summary, from, to, scope, notRepresented } = await this.list(actor, filters);
    return { from, to, scope, ...summary, notRepresented };
  }

  private async employeeRefs(userIds: string[]): Promise<Record<string, EmployeeRef>> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return {};

    const rows = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: {
        id: true,
        name: true,
        employeeId: true,
        department: { select: { name: true } },
      },
    });

    const out: Record<string, EmployeeRef> = {};
    for (const r of rows as any[]) {
      out[r.id] = {
        id: r.id,
        name: r.name,
        employeeId: r.employeeId ?? null,
        department: r.department?.name ?? null,
      };
    }
    return out;
  }
}

export type { ExceptionItem };
