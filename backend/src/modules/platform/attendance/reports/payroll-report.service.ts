import { type MonthlyAttendanceSummaryRow } from '../canonical/attendance-report';
import {
  attendanceWorkbookFilename,
  buildAttendanceWorkbook,
  workbookToBuffer,
} from '../canonical/attendance-workbook';
import { AttendanceReportService } from '../canonical/attendance-report.service';
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
import { lockAttendanceMonth } from '../evaluation/attendance-month-lock';

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
 * `reportSha256` is a legacy column that is no longer written or read, and it
 * is STRIPPED here rather than renamed and surfaced: nothing maintains it any
 * more, and exposing a stale digest would invite somebody to trust it.
 *
 * THE STRIP OUTLIVES THE COLUMN ON PURPOSE. The drop migration and this code
 * can deploy in either order, and between them the column still exists -- so
 * discarding it here is what makes that window safe rather than a window in
 * which a dead digest reappears in an API response.
 */
export function toCloseView(row: any) {
  if (!row) return null;
  const { reportSha256: _legacy, ...rest } = row;
  return rest;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface PreviewResult {
  month: string;
  status: string;
  totals: {
    employees: number;
    days: number;
    unresolvedDays: number;
    manualRecoveryDays: number;
    employeesWithUnresolved: number;
  };
  /** The canonical 19-column summary rows. */
  summaries: MonthlyAttendanceSummaryRow[];
  /** Size of the actual .xlsx that would be downloaded or sent. */
  reportByteSize: number;
}

import {
  DELIVERY_SENT,
  attachmentFileName,
  deliveryStatusFor,
  idempotencyKeyFor,
  firstAttemptStamp,
  mayContactProvider,
  type DeliveryResult,
} from './finance-handoff';

@Injectable()
export class PayrollReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tva: TVAService,
    private readonly accessPolicy: AccessPolicyService,
    private readonly eventLogger: EventLoggerService,
    private readonly settings: SettingsService,
    private readonly email: EmailService,
    private readonly attendanceReport: AttendanceReportService,
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
   * Builds the workbook and its hash.
   *
   * Regenerating deterministically is what makes the stored hash meaningful: at
   * send time the file is rebuilt and compared, so data that changed after
   * finalisation is caught rather than quietly delivered.
   */
  /**
   * The month, rendered for the Finance lifecycle.
   *
   * CONSUMES THE CANONICAL DATASET. It previously called its own gather() and
   * payroll-aggregation's summarise()/toRegisterRow() -- a second, independent
   * attendance interpretation -- so finalize and send were anchored to a
   * different engine from the one the console displayed. One dataset now feeds
   * the console, the user download and this.
   *
   * The Finance artifact IS the approved two-sheet workbook. There is no
   * separate Finance format, because a second builder would be a second place
   * attendance could be decided.
   */
  private async render(month: string, close: any, actorLabel: string) {
    const report = await this.attendanceReport.monthReport(
      // Finalization and delivery must describe the same data, so the instant
      // is pinned to the stored close row rather than the clock. A live clock
      // would print a different "generated at" on every download of an
      // already-closed month, and the bytes would differ each time.
      { role: { name: 'HR' }, id: actorLabel },
      month,
      close?.finalizedAt ?? new Date(0),
    );

    const buffer = await workbookToBuffer(buildAttendanceWorkbook(report));

    return {
      buffer,
      summaries: report.summaryRows,
      totals: {
        employees: report.metadata.employees,
        days: report.metadata.days,
        unresolvedDays: report.metadata.unresolvedDays,
        manualRecoveryDays: 0,
        employeesWithUnresolved: report.metadata.employeesWithUnresolved,
      },
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
      filename: attendanceWorkbookFilename(month),
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

    await this.prisma.$transaction(async (tx) => {
    // THE MONTH IS HELD FOR THE WHOLE CLOSE.
    //
    // Not a formality, and the reason has changed. It used to be that a
    // correction committing between the status write and the fingerprinting of
    // the render would be digested into a figure that then matched attendance
    // changed after the month was closed. There is no fingerprint now.
    //
    // What the lock does today is make the seal atomic. The instant this
    // transaction commits FINALIZED, every correction path is refused by it --
    // reviseForApprovedCorrection() reads the month under this same lock. A
    // correction already inside the lock queue when finalization starts either
    // lands before the seal or is refused by it, and nothing lands in the gap,
    // because there is no gap to land in.
    await lockAttendanceMonth(tx, month);

    const existing = await tx.attendanceMonthClose.findUnique({ where: { month } });
    if (existing?.status === 'FINALIZED' || existing?.status === 'SENT') {
      // STILL REFUSED HERE, BUT NO LONGER A DEAD END.
      //
      // Re-finalizing in place would change what Finance was told was approved
      // with no record that it happened, which is the thing being prevented.
      // The route through is reopen(): it records who unsealed the month and
      // why, moves it to REOPENED, and a REOPENED month reaches this line with
      // a status that is neither FINALIZED nor SENT -- so the second
      // finalization is permitted, and the reopen stays on the row.
      throw new ForbiddenException(
        `${month} is already ${existing.status.toLowerCase()}. Reopen it first, with a reason, ` +
          'if its attendance has to be corrected.',
      );
    }

    const finalizedAt = this.tva.now();
    const finalizedById = actor?.id ?? actor?.sub;

    // Persist the finalization FIRST, then fingerprint the canonical render of
    // what was persisted. Fingerprinting before the row exists digests a report
    // built from different metadata than the one send() will rebuild.
    const marked = { status: 'FINALIZED' as const, finalizedById, finalizedAt };
    await tx.attendanceMonthClose.upsert({
      where: { month },
      create: { month, ...marked },
      update: marked,
    });

    const rendered = await this.renderCanonical(month);

    const close = await tx.attendanceMonthClose.update({
      where: { month },
      data: {
        employeeCount: rendered.totals.employees,
        unresolvedDays: rendered.totals.unresolvedDays,
        employeesWithUnresolved: rendered.totals.employeesWithUnresolved,
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
            },
      })
      .catch(() => {});
    },
    // The render inside this transaction builds a workbook for the whole
    // company, which comfortably outlives Prisma's 5s default.
    { timeout: 120_000, maxWait: 15_000 });

    // DELIVERY RUNS OUTSIDE THE LOCK, AND MUST.
    //
    // send() takes the same month lock in its own transaction. Advisory locks
    // are held by a session, and Prisma gives a nested $transaction a different
    // pooled connection -- so calling send() from inside the block above would
    // have it wait on a lock its own caller is holding, until the statement
    // timeout. A deadlock built out of two correct-looking functions.
    //
    // Committing first is also the honest order: finalization is complete and
    // durable before anything is emailed.
    //
    // A correction can no longer slip in between the two. This used to be
    // covered by send() re-rendering and refusing a report that no longer
    // matched its fingerprint; the protection now sits earlier, because the
    // committed FINALIZED status itself refuses every correction path. The
    // window the fingerprint was watching is closed rather than monitored.
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
   * Unseals a finalized month so its attendance can be corrected.
   *
   * THE DELIBERATE STEP THAT REPLACED A HASH.
   *
   * Finalization is the seal: once a month is FINALIZED, every correction path
   * refuses it -- the evaluator, regularization approval, the importer. This is
   * the only way past that, and it is built to leave a mark. Who, when, why,
   * and how many times, all on the close row, none of it cleared by the
   * re-finalization that follows.
   *
   * WHY A REASON IS MANDATORY. A reopen with no reason is the one a payroll
   * dispute six months later cannot answer. It is enforced here rather than by
   * a NOT NULL column, because months reopened before this existed have no
   * reason and must not be invented one.
   *
   * THE LENGTH FLOOR PROVES A REASON WAS TYPED, NOT THAT IT IS A GOOD ONE. It
   * rejects a blank, whitespace and a one-word dismissal; it cannot tell a real
   * explanation from a plausible-length non-answer, and no length rule could.
   * The text is kept on the row and in the audit event so the quality of it is
   * reviewable by a person, which is the only thing that can judge it.
   *
   * SENT IS REOPENABLE, AND THAT IS NOT AN OVERSIGHT. Finance is already
   * holding that report, so the correction will make Apex OS disagree with a
   * document somebody is working from -- which is a real need (a genuine error
   * does not stop being an error once it has been emailed) that must be
   * deliberate and recorded. The reopen records the status it came from, so
   * "this month was already with Finance when it was reopened" stays answerable
   * afterwards. Telling Finance is a human step this cannot perform.
   *
   * DOES NOT TOUCH A SINGLE ATTENDANCE ROW. It changes only the month's state.
   * Corrections are then made through the ordinary reviewed paths, each with
   * its own audit trail, rather than by anything bulk hidden inside a reopen.
   */
  async reopen(actor: any, month: string, reason: string) {
    this.assertHr(actor);
    this.assertMonth(month);

    const stated = (reason ?? '').trim();
    if (stated.length < 10) {
      throw new BadRequestException(
        'Give a reason for reopening this month. It is recorded against the month close and is ' +
          'what a later payroll query will be answered from.',
      );
    }

    const reopened = await this.prisma.$transaction(async (tx) => {
      // The same lock finalize() and the correction path take. Without it, a
      // reopen could commit while a finalization is mid-flight and the month
      // would end up FINALIZED with a reopen recorded against it -- a row
      // saying it was unsealed, in a state saying it was not.
      await lockAttendanceMonth(tx, month);

      const existing = await tx.attendanceMonthClose.findUnique({ where: { month } });
      if (!existing) {
        throw new NotFoundException(`${month} has never been closed, so there is nothing to reopen`);
      }
      if (existing.status !== 'FINALIZED' && existing.status !== 'SENT') {
        // OPEN, REVIEWING and REOPENED are all already correctable. Reopening
        // them would be a no-op that nonetheless wrote a reopen record, which
        // would make the audit trail claim something happened that did not.
        throw new ForbiddenException(
          `${month} is ${existing.status.toLowerCase()} and already accepts corrections. ` +
            'Only a finalized or sent month needs reopening.',
        );
      }

      return tx.attendanceMonthClose.update({
        where: { month },
        data: {
          status: 'REOPENED',
          reopenedById: actor?.id ?? actor?.sub,
          reopenedAt: this.tva.now(),
          reopenReason: stated,
          // Incremented, never reset. A month reopened three times is a
          // different story from one reopened once, and payroll should be able
          // to see which it is looking at.
          reopenCount: { increment: 1 },
        },
      });
    });

    this.eventLogger
      .log({
        actorId: actor?.id ?? actor?.sub,
        entityType: 'AttendanceMonthClose',
        entityId: month,
        action: 'PAYROLL_MONTH_REOPENED',
        // The state it came FROM is the significant part: reopening a month
        // Finance already received is a materially different act from reopening
        // one that was merely finalized, and the audit row has to say which.
        fromState: 'FINALIZED_OR_SENT',
        toState: 'REOPENED',
        metadata: { month, reason: stated, reopenCount: reopened.reopenCount },
      })
      .catch(() => {});

    return toCloseView(reopened);
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
   * Explicit: nothing here runs on a schedule. The report is rebuilt from the
   * canonical month at send time.
   *
   * NO STALENESS CHECK HERE, AND NONE IS NEEDED NOW. This used to re-render and
   * compare a DATA fingerprint against the one captured at finalization, to
   * catch attendance corrected after approval. That comparison is gone, and so
   * is the thing it was catching: a FINALIZED month refuses corrections
   * outright, so a rebuild cannot differ from what was approved unless somebody
   * explicitly reopened the month -- and a reopened month is not FINALIZED, so
   * it cannot be sent at all until it is finalized again.
   *
   * The guarantee is the same. It is enforced by business state a person can
   * read off the row rather than by a digest nobody could interpret.
   *
   * A failed send leaves the month FINALIZED with deliveryStatus FAILED. It is
   * never recorded as SENT, so a retry is possible and the record never claims
   * a delivery that did not happen.
   */
  async send(actor: any, month: string) {
    this.assertHr(actor);
    this.assertMonth(month);

    return this.prisma.$transaction(async (tx) => {
    // THE MONTH IS HELD FROM THE STALENESS CHECK THROUGH TO SENT.
    //
    // The fingerprint comparison below is the last thing standing between a
    // changed month and Finance. Without the lock, a correction committing
    // between that check and the status write would be delivered inside the
    // report and then recorded as SENT -- with the check having already passed.
    // The guard would have run, correctly, one moment too early.
    await lockAttendanceMonth(tx, month);

    const close = await tx.attendanceMonthClose.findUnique({
      where: { month },
      include: { finalizedBy: { select: { name: true } } },
    });
    if (!close) throw new NotFoundException(`${month} has not been prepared yet`);
    // ALREADY DELIVERED IS REFUSED HERE, BEFORE THE PROVIDER IS REACHED.
    //
    // Resend's idempotency key collapses a retry of the same report inside a
    // 24-hour window, and that is worth having -- but it is a safety net for
    // retries, not a licence to call send() again next week and rely on the
    // provider to remember. A month that has been delivered is refused locally.
    //
    // FAILED and UNKNOWN both remain retryable, and both reuse the same key.
    // For UNKNOWN that is exactly what settles the ambiguity: if the first
    // attempt did reach Resend, the retry is collapsed rather than delivered.
    const gate = mayContactProvider(close, this.tva.now());
    if (!gate.allowed) {
      throw new ForbiddenException(gate.reason ?? `${month} cannot be sent`);
    }

    const people = await this.recipients();
    if (!people) {
      throw new BadRequestException(
        'No Finance recipient is configured. Set one before sending the payroll report.',
      );
    }

    const rendered = await this.renderCanonical(month);
    // NO CRYPTOGRAPHIC GUARD HERE ANY MORE.
    //
    // This compared a stored digest of the finalized attendance against a fresh
    // one and refused the send when they differed. Finalization is plain
    // business state now -- FINALIZED, with who and when -- so what remains is
    // the month lock taken above plus the status checks: an unfinalized month
    // cannot be sent, and an already-sent month is refused locally before the
    // provider is reached.
    //
    // WHAT THIS GIVES UP, STATED PLAINLY: a correction committed after
    // finalization and before sending is no longer detected, so Finance could
    // receive a register differing from the one HR approved. The month lock
    // narrows that window to the send itself rather than closing it. Removing
    // the digest was an explicit product decision; this note exists so the
    // trade is visible to whoever reads the path next.

    // THE ATTEMPT IS RECORDED BEFORE THE PROVIDER IS CONTACTED, NOT AFTER.
    //
    // What is being timed is when we first TRIED, which is the thing the
    // idempotency window is measured from. Stamping it after the outcome would
    // date the attempt by when it finished -- and for the case that matters, a
    // request that hung and eventually failed, that is the wrong end.
    //
    // firstAttemptStamp keeps any existing value. A retry must never move it:
    // sliding the window forward on every attempt would mean it never expires.
    const attemptAt = this.tva.now();
    const firstAttemptAt = firstAttemptStamp(close.deliveryFirstAttemptAt, attemptAt);
    if (!close.deliveryFirstAttemptAt) {
      await tx.attendanceMonthClose.update({
        where: { month },
        data: { deliveryFirstAttemptAt: firstAttemptAt },
      });
    }

    const filename = attachmentFileName(month);

    // Identifies the REPORT, not the attempt: the month close plus the
    // finalization timestamp. A retry of the same finalized month therefore
    // presents the same key. Generating a fresh id per attempt is the bug this
    // exists to prevent.
    const idempotencyKey = idempotencyKeyFor({
      monthCloseId: close.id,
      finalizedAt: close.finalizedAt,
    });

    // The transport is written to classify its own failures and never throw.
    // Wrapped anyway: if it ever did, an uncaught throw here would abandon the
    // transaction with NOTHING recorded about the attempt -- and "no record"
    // reads as "never tried", which is the one thing it is not.
    let delivery: DeliveryResult;
    try {
      delivery = await this.email.sendPayrollAttendanceReport(
        people.to,
        people.cc,
        month,
        filename,
        rendered.buffer,
        {
          month,
          finalizedAt: close.finalizedAt ?? null,
          finalizedByName: (close as any).finalizedBy?.name ?? null,
          reference: close.id,
          employees: close.employeeCount ?? 0,
          unresolvedDays: close.unresolvedDays ?? 0,
          employeesWithUnresolved: close.employeesWithUnresolved ?? 0,
        },
        idempotencyKey,
      );
    } catch (error: any) {
      // Unknown, not failed. The request may have reached the provider.
      delivery = { outcome: 'UNKNOWN', reason: error?.message ?? 'transport threw' };
    }
    const delivered = delivery.outcome === 'SENT';

    const updated = await tx.attendanceMonthClose.update({
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
            deliveryStatus: DELIVERY_SENT,
          }
        : // REJECTED means nothing was sent and a retry is safe. UNKNOWN means we
          // genuinely do not know -- the status stays FINALIZED either way, but
          // the two are recorded distinctly so nobody treats an ambiguous
          // delivery as a confirmed failure.
          { deliveryStatus: deliveryStatusFor(delivery.outcome) },
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
          // The outcome as the provider left it, and the key that identifies
          // this report -- so a duplicate investigation can be answered from
          // the event stream rather than from the mail provider's dashboard.
          deliveryOutcome: delivery.outcome,
          deliveryReason: delivery.reason ?? null,
          providerMessageId: delivery.providerId ?? null,
          idempotencyKey,
        },
      })
      .catch(() => {});

    if (!delivered) {
      throw new BadRequestException(
        'The report could not be delivered. The month remains finalized — you can retry.',
      );
    }
    return toCloseView({ ...updated, finalizedBy: close.finalizedBy });
    },
    // Wider than the finalize window: this one renders the workbook AND waits
    // on the mail provider. Delivery and the SENT write have to be inside the
    // same held month, or a correction lands between them.
    { timeout: 180_000, maxWait: 15_000 });
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
