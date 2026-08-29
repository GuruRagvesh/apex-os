import { createHash } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { TVAService } from '../../../../common/services/tva.service';
import { AccessPolicyService } from '../../../../common/services/access-policy.service';
import { EventLoggerService } from '../../../../common/services/event-logger.service';
import { SettingsService } from '../../settings/settings.service';
import { EmailService } from '../../email/email.service';
import {
  monthTotals,
  summarise,
  toRegisterRow,
  type DayFacts,
  type EmployeeMeta,
} from './payroll-aggregation';
import {
  buildPayrollWorkbook,
  reportFingerprint,
  workbookFilename,
  workbookToBuffer,
} from './payroll-workbook';

/**
 * Monthly attendance close and the payroll workbook Finance receives.
 *
 * The lifecycle is OPEN -> REVIEWING -> FINALIZED -> SENT, and nothing skips a
 * step. A preview may be generated at any time; only HR finalising turns it
 * into a payroll input, and only an explicit send delivers it.
 *
 * NOTHING IS SENT BECAUSE A MONTH ENDED. There is no scheduler here on purpose:
 * an automatic dispatch would email unreviewed attendance to Finance as though
 * it were settled, which is the failure this whole workflow exists to prevent.
 */

/** The AppSetting key holding the Finance recipients. Never a literal address. */
export const RECIPIENT_SETTING_KEY = 'attendance.payrollReportRecipient';

/**
 * Who the finalized report goes to.
 *
 * One TO and several CC, because the three parties have different jobs: the
 * accountant processes payroll from it, the head of finance reviews, and HR
 * owns the attendance being reported. Sending to all three as TO would blur
 * whose action is expected.
 *
 * Configured, never hardcoded — a leaver on this list must be changeable
 * without a deploy.
 */
export interface ReportRecipients {
  to: string;
  cc: string[];
}

/**
 * The close row as every caller outside this module sees it.
 *
 * The stored column is `reportSha256`, which is a V1 legacy name: the value is
 * the SHA-256 of the canonical report DATA, not of the .xlsx file. The name is
 * renamed here, once, at the boundary -- so a UI, a log line or somebody
 * reading an audit trail in six months cannot reasonably conclude it
 * identifies the exact attachment bytes, because it does not.
 */
export function toCloseView(row: any) {
  if (!row) return null;
  const { reportSha256, ...rest } = row;
  return { ...rest, reportDataFingerprint: reportSha256 ?? null };
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface PreviewResult {
  month: string;
  status: string;
  totals: ReturnType<typeof monthTotals>;
  summaries: ReturnType<typeof summarise>[];
  /**
   * SHA-256 of the canonical report DATA -- see reportFingerprint(). Named so
   * it cannot be mistaken for a digest of the workbook the caller downloads.
   */
  reportDataFingerprint: string;
  /** Size of the actual .xlsx that would be downloaded or sent. */
  reportByteSize: number;
}

@Injectable()
export class PayrollReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tva: TVAService,
    private readonly accessPolicy: AccessPolicyService,
    private readonly eventLogger: EventLoggerService,
    private readonly settings: SettingsService,
    private readonly email: EmailService,
  ) {}

  private assertHr(actor: any) {
    if (!this.accessPolicy.isHrOrAdmin(actor)) {
      throw new ForbiddenException('Only HR or an administrator can work with payroll attendance');
    }
  }

  private assertMonth(month: string) {
    if (!MONTH_RE.test(month ?? '')) {
      throw new BadRequestException('month must be formatted yyyy-MM');
    }
  }

  private bounds(month: string) {
    const from = `${month}-01`;
    const [y, m] = month.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { from, to: `${month}-${String(last).padStart(2, '0')}` };
  }

  /**
   * Gathers the month's facts.
   *
   * Punch sources come from the evidence rows rather than being inferred: a
   * manual recovery, a phone punch and a web punch are three different claims
   * about how attendance was established, and Finance is entitled to see which.
   */
  private async gather(month: string) {
    const { from, to } = this.bounds(month);
    const gte = this.tva.companyDateOnly(new Date(`${from}T00:00:00.000Z`));
    const lte = this.tva.companyDateOnly(new Date(`${to}T00:00:00.000Z`));

    const employees = await this.prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        employeeId: true,
        department: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
    });
    const ids = employees.map((e) => e.id);

    const [records, evidence, regularizations, leaves] = await Promise.all([
      this.prisma.dailyAttendance.findMany({
        where: { userId: { in: ids }, date: { gte, lte } },
        orderBy: [{ userId: 'asc' }, { date: 'asc' }],
      }),
      this.prisma.attendancePunchEvidence.findMany({
        where: { userId: { in: ids }, businessDate: { gte, lte } },
        select: { id: true, source: true },
      }),
      this.prisma.attendanceRegularization.findMany({
        where: { userId: { in: ids }, date: { gte, lte } },
        select: { id: true, entrySource: true },
      }),
      this.prisma.leaveRequest.findMany({
        where: { userId: { in: ids }, status: 'APPROVED' },
        select: { id: true, type: true },
      }),
    ]);

    const sourceById = new Map(evidence.map((e) => [e.id, e.source as string]));
    const recoveryIds = new Set(
      regularizations.filter((r) => r.entrySource === 'MANUAL_RECOVERY').map((r) => r.id),
    );
    const leaveTypeById = new Map(leaves.map((l) => [l.id, l.type as string]));

    const meta: EmployeeMeta[] = employees.map((e) => ({
      id: e.id,
      employeeId: e.employeeId,
      name: e.name,
      department: e.department?.name ?? null,
    }));

    const facts: DayFacts[] = records.map((r) => ({
      userId: r.userId,
      date: r.date.toISOString().slice(0, 10),
      status: r.status,
      evaluationState: r.evaluationState,
      punchInAt: r.punchInAt?.toISOString() ?? null,
      punchOutAt: r.punchOutAt?.toISOString() ?? null,
      punchInSource: r.punchInEvidenceId ? (sourceById.get(r.punchInEvidenceId) ?? null) : null,
      punchOutSource: r.punchOutEvidenceId ? (sourceById.get(r.punchOutEvidenceId) ?? null) : null,
      workedMinutes: r.workedMinutes,
      breakMinutes: r.breakMinutes,
      lateMinutes: r.lateMinutes,
      leaveDeducted: r.leaveDeducted,
      lwpDeducted: r.lwpDeducted,
      leaveType: r.leaveRequestId ? (leaveTypeById.get(r.leaveRequestId) ?? null) : null,
      exceptionFlags: r.exceptionFlags ?? [],
      regularizationId: r.lastRegularizationId ?? null,
      viaManualRecovery: r.lastRegularizationId
        ? recoveryIds.has(r.lastRegularizationId)
        : false,
      // Session span is not stored on the record; the register reports it as
      // unavailable rather than substituting worked minutes for it.
      sessionSpanMinutes: null,
    }));

    return { meta, facts };
  }

  /**
   * Builds the workbook and its hash.
   *
   * Regenerating deterministically is what makes the stored hash meaningful: at
   * send time the file is rebuilt and compared, so data that changed after
   * finalisation is caught rather than quietly delivered.
   */
  private async render(month: string, close: any, actorLabel: string) {
    const { meta, facts } = await this.gather(month);
    const byUser = new Map<string, DayFacts[]>();
    for (const f of facts) {
      const list = byUser.get(f.userId) ?? [];
      list.push(f);
      byUser.set(f.userId, list);
    }

    const summaries = meta.map((e) => summarise(e, byUser.get(e.id) ?? []));
    const register = meta.flatMap((e) =>
      (byUser.get(e.id) ?? []).map((d) => toRegisterRow(e, d, 540)),
    );

    const wb = buildPayrollWorkbook({
      month,
      companyLabel: 'TechnoEdge',
      summaries,
      register,
      // Fixed for a finalized month so the cover sheet reads the same however
      // often it is regenerated; a live clock would print a different
      // "generated at" on every download of an already-closed month.
      generatedAt: close?.finalizedAt ?? new Date(0),
      generatedBy: actorLabel,
      finalizedAt: close?.finalizedAt ?? null,
      finalizedBy: close?.finalizedBy?.name ?? null,
    });

    const buffer = await workbookToBuffer(wb);
    return {
      buffer,
      summaries,
      totals: monthTotals(summaries, facts),
      // Over the DATA, not the file bytes: an XLSX is a ZIP and its entry
      // headers carry clock timestamps, so file hashes are not reproducible.
      dataFingerprint: reportFingerprint({ month, summaries, register }),
    };
  }

  /**
   * The canonical render for a month, always built from the PERSISTED row.
   *
   * Finalization and delivery must describe the same DATA or the fingerprint
   * comparison compares nothing. Deriving the metadata from two different
   * places -- the actor at finalization, the row at send -- made the two renders
   * differ by a name and the guard fired on every send.
   *
   * Reading the row both times removes the possibility by construction.
   */
  private async renderCanonical(month: string) {
    const close = await this.prisma.attendanceMonthClose.findUnique({
      where: { month },
      include: { finalizedBy: { select: { name: true } } },
    });
    return this.render(month, close, (close as any)?.finalizedBy?.name ?? 'HR');
  }

  /** A preview. Generating one changes no official state beyond REVIEWING. */
  async preview(actor: any, month: string): Promise<PreviewResult> {
    this.assertHr(actor);
    this.assertMonth(month);

    const close = await this.prisma.attendanceMonthClose.findUnique({
      where: { month },
      include: { finalizedBy: { select: { name: true } } },
    });
    const rendered = await this.render(month, close, actor?.name ?? 'HR');

    // Looking at a month moves it out of OPEN, which is how the UI can show
    // that somebody has begun the close. It never moves it forward from
    // FINALIZED or SENT.
    if (!close || close.status === 'OPEN') {
      await this.prisma.attendanceMonthClose.upsert({
        where: { month },
        create: { month, status: 'REVIEWING' },
        update: { status: 'REVIEWING' },
      });
    }

    this.eventLogger
      .log({
        actorId: actor?.id ?? actor?.sub,
        entityType: 'AttendanceMonthClose',
        entityId: month,
        action: 'PAYROLL_REPORT_GENERATED',
        metadata: { month, employees: rendered.totals.employees },
      })
      .catch(() => {});

    return {
      month,
      status: close?.status ?? 'REVIEWING',
      totals: rendered.totals,
      summaries: rendered.summaries,
      reportDataFingerprint: rendered.dataFingerprint,
      reportByteSize: rendered.buffer.length,
    };
  }

  /** The workbook itself, for download. */
  async download(actor: any, month: string) {
    this.assertHr(actor);
    this.assertMonth(month);

    const close = await this.prisma.attendanceMonthClose.findUnique({
      where: { month },
      include: { finalizedBy: { select: { name: true } } },
    });
    const rendered = await this.render(month, close, actor?.name ?? 'HR');

    return {
      buffer: rendered.buffer,
      filename: workbookFilename(month, Boolean(close?.finalizedAt)),
    };
  }

  /**
   * HR accepts the month as the payroll input.
   *
   * The counts are derived here, from the data, and stored. A client-supplied
   * employee or unresolved count would let the number that justifies a payroll
   * run be supplied by the thing being justified.
   *
   * Unresolved days do NOT block finalisation: company policy may legitimately
   * accept them. They are counted, stored and shown, so accepting them is a
   * decision somebody made rather than something that happened quietly.
   */
  async finalize(actor: any, month: string) {
    this.assertHr(actor);
    this.assertMonth(month);

    const existing = await this.prisma.attendanceMonthClose.findUnique({ where: { month } });
    if (existing?.status === 'FINALIZED' || existing?.status === 'SENT') {
      // Reopening a finalized month is not designed for V1. Failing closed is
      // correct: silently re-finalising would change what Finance was told was
      // approved, with no record that it happened.
      throw new ForbiddenException(
        `${month} is already ${existing.status.toLowerCase()}. Reopening a finalized month is not supported.`,
      );
    }

    const finalizedAt = this.tva.now();
    const finalizedById = actor?.id ?? actor?.sub;

    // Persist the finalization FIRST, then fingerprint the canonical render of
    // what was persisted. Fingerprinting before the row exists digests a report
    // built from different metadata than the one send() will rebuild.
    const marked = { status: 'FINALIZED' as const, finalizedById, finalizedAt };
    await this.prisma.attendanceMonthClose.upsert({
      where: { month },
      create: { month, ...marked },
      update: marked,
    });

    const rendered = await this.renderCanonical(month);

    const close = await this.prisma.attendanceMonthClose.update({
      where: { month },
      data: {
        employeeCount: rendered.totals.employees,
        unresolvedDays: rendered.totals.unresolvedDays,
        employeesWithUnresolved: rendered.totals.employeesWithUnresolved,
        // Column name is V1 legacy; the value is the DATA fingerprint.
        reportSha256: rendered.dataFingerprint,
        // This one really is about the file: the size of the .xlsx built above.
        reportByteSize: rendered.buffer.length,
      },
    });

    this.eventLogger
      .log({
        actorId: actor?.id ?? actor?.sub,
        entityType: 'AttendanceMonthClose',
        entityId: month,
        action: 'PAYROLL_MONTH_FINALIZED',
        fromState: existing?.status ?? 'OPEN',
        toState: 'FINALIZED',
        metadata: {
          month,
          employees: rendered.totals.employees,
          unresolvedDays: rendered.totals.unresolvedDays,
          reportDataFingerprint: rendered.dataFingerprint,
        },
      })
      .catch(() => {});

    // Delivery follows finalization immediately: HR finalizing IS the decision
    // to send, and a report that sits finalized-but-unsent is the state where
    // Finance waits on an email nobody realises they still owe.
    //
    // Best-effort on purpose. A send failure must not undo a finalization that
    // is already correct, so it is recorded as FAILED and left retryable rather
    // than thrown from here.
    try {
      await this.send(actor, month);
    } catch {
      /* recorded on the row as FAILED; the caller reads it from status */
    }

    return this.status(actor, month);
  }

  /**
   * The configured recipients, or null when none is usable.
   *
   * Tolerates the older shape where the setting held a bare address string, so
   * a value saved before CC existed still works rather than silently blocking
   * a month close.
   */
  async recipients(): Promise<ReportRecipients | null> {
    const value = await this.settings.get(RECIPIENT_SETTING_KEY).catch(() => null);

    const to =
      typeof value === 'string' ? value : ((value as any)?.to ?? (value as any)?.email ?? null);
    if (typeof to !== 'string' || !EMAIL_RE.test(to)) return null;

    const rawCc = Array.isArray((value as any)?.cc) ? (value as any).cc : [];
    const cc = rawCc
      .filter((e: any) => typeof e === 'string' && EMAIL_RE.test(e))
      // Copying the TO address into CC would deliver twice to one inbox.
      .filter((e: string) => e.toLowerCase() !== to.toLowerCase());

    return { to, cc: Array.from(new Set(cc.map((e: string) => e.toLowerCase()))) };
  }

  async setRecipients(actor: any, input: { to: string; cc?: string[] }) {
    this.assertHr(actor);

    const to = (input?.to ?? '').trim();
    if (!EMAIL_RE.test(to)) {
      throw new BadRequestException('Enter a valid address for the accountant');
    }

    const cc = (input?.cc ?? []).map((e) => (e ?? '').trim()).filter(Boolean);
    const bad = cc.find((e) => !EMAIL_RE.test(e));
    if (bad) throw new BadRequestException(`"${bad}" is not a valid email address`);

    await this.settings.set(
      RECIPIENT_SETTING_KEY,
      { to, cc },
      actor?.id ?? actor?.sub,
    );
    return { to, cc };
  }

  /**
   * Delivers the finalized workbook to Finance.
   *
   * Explicit: nothing here runs on a schedule. The report is rebuilt and its
   * DATA fingerprint compared against what was finalized, so attendance
   * corrected after finalisation is caught rather than delivered under the old
   * approval. The question is whether the attendance changed, never whether
   * two ZIP writers happened to agree on a timestamp.
   *
   * A failed send leaves the month FINALIZED with deliveryStatus FAILED. It is
   * never recorded as SENT, so a retry is possible and the record never claims
   * a delivery that did not happen.
   */
  async send(actor: any, month: string) {
    this.assertHr(actor);
    this.assertMonth(month);

    const close = await this.prisma.attendanceMonthClose.findUnique({
      where: { month },
      include: { finalizedBy: { select: { name: true } } },
    });
    if (!close) throw new NotFoundException(`${month} has not been prepared yet`);
    if (close.status !== 'FINALIZED' && close.status !== 'SENT') {
      throw new ForbiddenException(`${month} must be finalized before it can be sent`);
    }

    const people = await this.recipients();
    if (!people) {
      throw new BadRequestException(
        'No Finance recipient is configured. Set one before sending the payroll report.',
      );
    }

    const rendered = await this.renderCanonical(month);
    // close.reportSha256 is the stored DATA fingerprint (V1 column name).
    if (close.reportSha256 && rendered.dataFingerprint !== close.reportSha256) {
      throw new ForbiddenException(
        'Attendance has changed since this month was finalized, so the report no longer matches ' +
          'what was approved. Re-finalizing a closed month is not supported in this version.',
      );
    }

    const filename = workbookFilename(month, true);
    let delivered = false;
    try {
      delivered = await this.email.sendPayrollAttendanceReport(
        people.to,
        people.cc,
        month,
        filename,
        rendered.buffer,
        {
          employees: close.employeeCount ?? 0,
          unresolvedDays: close.unresolvedDays ?? 0,
          employeesWithUnresolved: close.employeesWithUnresolved ?? 0,
        },
      );
    } catch {
      delivered = false;
    }

    const updated = await this.prisma.attendanceMonthClose.update({
      where: { month },
      data: delivered
        ? {
            status: 'SENT',
            // Copied at send time: changing the setting next month must not
            // rewrite who an already-sent report went to. The CC list is
            // recorded alongside it so "who received this" is answerable from
            // the row rather than from the mail provider.
            recipientEmail: [people.to, ...people.cc].join(', '),
            sentAt: this.tva.now(),
            deliveryStatus: 'SENT',
          }
        : { deliveryStatus: 'FAILED' },
    });

    this.eventLogger
      .log({
        actorId: actor?.id ?? actor?.sub,
        entityType: 'AttendanceMonthClose',
        entityId: month,
        action: delivered ? 'PAYROLL_REPORT_SENT' : 'PAYROLL_REPORT_SEND_FAILED',
        fromState: 'FINALIZED',
        toState: delivered ? 'SENT' : 'FINALIZED',
        metadata: {
          month,
          to: people.to,
          cc: people.cc,
          reportDataFingerprint: close.reportSha256,
        },
      })
      .catch(() => {});

    if (!delivered) {
      throw new BadRequestException(
        'The report could not be delivered. The month remains finalized — you can retry.',
      );
    }
    return toCloseView({ ...updated, finalizedBy: close.finalizedBy });
  }

  async status(actor: any, month: string) {
    this.assertHr(actor);
    this.assertMonth(month);
    const row = await this.prisma.attendanceMonthClose.findUnique({
      where: { month },
      include: { finalizedBy: { select: { name: true } } },
    });
    return toCloseView(row);
  }
}
