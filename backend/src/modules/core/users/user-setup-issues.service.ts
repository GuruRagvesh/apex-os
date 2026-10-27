import { Injectable, Inject, Logger, Optional, forwardRef } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { COMPANY_CRON_TIMEZONE } from '../../../common/constants/company-time.constants';
import { NotificationEventService } from '../../operations/notifications/notification-event.service';

/**
 * Setup issues (Phase 2, B9): things about a person's account that an
 * administrator should finish. They never take access away.
 *
 * One row per person and code (dedupeKey). Recording is cheap and may run
 * inside the transaction that found the issue; notification happens after
 * commit through NotificationEventService, so channel preferences apply and
 * the Notification Center keeps the row whatever the channels say. One
 * follow-up is sent 15 days after the first notice; there is no monthly email.
 * Issues whose cause can be re-checked resolve themselves once it is gone.
 */
export const SETUP_ISSUE_CODES = {
  DEPARTMENT_MISSING: 'DEPARTMENT_MISSING',
  HIERARCHY_MISSING: 'HIERARCHY_MISSING',
  ATTENDANCE_POLICY_SETUP_PENDING: 'ATTENDANCE_POLICY_SETUP_PENDING',
  SCHEDULED_ACTIVATION_FAILED: 'SCHEDULED_ACTIVATION_FAILED',
  EMPLOYEE_ID_BACKFILL_FAILED: 'EMPLOYEE_ID_BACKFILL_FAILED',
  LEAVE_SETUP_PENDING: 'LEAVE_SETUP_PENDING',
  // Phase 4: raised by the exit workflow; resolved by it, not by re-detection.
  CLEARANCE_OWNER_MISSING: 'CLEARANCE_OWNER_MISSING',
  WORKING_CALENDAR_FALLBACK: 'WORKING_CALENDAR_FALLBACK',
} as const;
export type SetupIssueCode = (typeof SETUP_ISSUE_CODES)[keyof typeof SETUP_ISSUE_CODES];

type Spec = {
  domain: string;
  severity: 'INFO' | 'WARNING' | 'BLOCKING';
  remediationClass: 'ADMIN_FIXABLE_FRONTEND' | 'SYSTEM_REPAIRABLE' | 'BACKEND_OPERATIONS';
  title: string;
  message: (name: string) => string;
};

export const SETUP_ISSUE_SPECS: Record<SetupIssueCode, Spec> = {
  DEPARTMENT_MISSING: {
    domain: 'ORGANIZATION', severity: 'WARNING', remediationClass: 'ADMIN_FIXABLE_FRONTEND',
    title: 'Department not assigned',
    message: (n) => `${n} has no department. Assign one from Users so department routing and reports include them.`,
  },
  HIERARCHY_MISSING: {
    domain: 'ORGANIZATION', severity: 'WARNING', remediationClass: 'ADMIN_FIXABLE_FRONTEND',
    title: 'No Team Lead or Manager',
    message: (n) => `${n} has no active Team Lead or Manager, so their approvals go to the fallback approvers.`,
  },
  ATTENDANCE_POLICY_SETUP_PENDING: {
    domain: 'ATTENDANCE', severity: 'WARNING', remediationClass: 'ADMIN_FIXABLE_FRONTEND',
    title: 'Attendance setup pending',
    message: (n) => `The account for ${n} is available, but no approved attendance policy covers their joining date yet.`,
  },
  SCHEDULED_ACTIVATION_FAILED: {
    domain: 'LIFECYCLE', severity: 'WARNING', remediationClass: 'SYSTEM_REPAIRABLE',
    title: 'Scheduled activation failed',
    message: (n) => `The joining date for ${n} has arrived but the account could not be activated. Activation is retried automatically.`,
  },
  EMPLOYEE_ID_BACKFILL_FAILED: {
    domain: 'ORGANIZATION', severity: 'WARNING', remediationClass: 'BACKEND_OPERATIONS',
    title: 'Employee ID could not be assigned',
    message: (n) => `${n} has no employee ID and one could not be assigned automatically.`,
  },
  LEAVE_SETUP_PENDING: {
    domain: 'LEAVE', severity: 'WARNING', remediationClass: 'ADMIN_FIXABLE_FRONTEND',
    title: 'Leave setup pending',
    message: (n) => `${n} has a leave request saved as pending because their leave calendar or leave policy could not be resolved. Complete the setup; the request is settled automatically afterwards.`,
  },
  CLEARANCE_OWNER_MISSING: {
    domain: 'EXIT', severity: 'WARNING', remediationClass: 'ADMIN_FIXABLE_FRONTEND',
    title: 'Clearance owner needed',
    message: (n) => `An exit clearance item for ${n} has no Team Lead or Manager to own it. Assign an owner in the Exit tab; the item is not treated as done.`,
  },
  WORKING_CALENDAR_FALLBACK: {
    domain: 'EXIT', severity: 'WARNING', remediationClass: 'ADMIN_FIXABLE_FRONTEND',
    title: 'Standard working calendar used',
    message: (n) => `No holiday calendar or weekly-off policy resolved for ${n}, so the standard weekday schedule was used for their F&F deadline and reminders.`,
  },
};

/** Every code can be re-checked from current records. */
const REDETECTABLE = new Set<string>(
  Object.values(SETUP_ISSUE_CODES).filter((c) => c !== 'CLEARANCE_OWNER_MISSING' && c !== 'WORKING_CALENDAR_FALLBACK'),
);

const FOLLOW_UP_DAYS = 15;
type Client = PrismaService | Prisma.TransactionClient;

/** Attendance keeps the key Phase 1 already wrote, so no duplicate is created. */
export function setupIssueDedupeKey(userId: string, code: string): string {
  return code === 'ATTENDANCE_POLICY_SETUP_PENDING' ? `user:${userId}:attendance-policy-setup` : `user:${userId}:${code}`;
}

/** Company-local today as a UTC-midnight date (the @db.Date encoding). */
export function companyToday(now = new Date()): Date {
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: COMPANY_CRON_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return new Date(`${d}T00:00:00.000Z`);
}

@Injectable()
export class UserSetupIssuesService {
  private readonly logger = new Logger(UserSetupIssuesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(forwardRef(() => NotificationEventService))
    private readonly notifications?: NotificationEventService,
  ) {}

  /** Opens (or re-opens) one issue. Safe inside a transaction; never notifies. */
  async record(client: Client, userId: string, code: SetupIssueCode, details: Record<string, unknown> = {}) {
    const spec = SETUP_ISSUE_SPECS[code];
    const dedupeKey = setupIssueDedupeKey(userId, code);
    const now = new Date();
    const existing = await (client as any).userSetupIssue.findUnique({ where: { dedupeKey }, select: { id: true, status: true } });
    if (!existing) {
      return (client as any).userSetupIssue.create({
        data: {
          id: randomUUID(), userId, code, domain: spec.domain, severity: spec.severity,
          remediationClass: spec.remediationClass, dedupeKey, details: details as any,
        },
        select: { id: true },
      });
    }
    const reopened = existing.status === 'RESOLVED';
    return (client as any).userSetupIssue.update({
      where: { dedupeKey },
      data: {
        lastDetectedAt: now,
        details: details as any,
        // A waived or acknowledged issue keeps its status. A resolved one that
        // comes back is a new occurrence and is announced again.
        ...(reopened ? { status: 'OPEN', resolvedAt: null, resolvedById: null, firstNotifiedAt: null, reminder15SentAt: null } : {}),
      },
      select: { id: true },
    });
  }

  async resolve(client: Client, userId: string, code: string, resolvedById: string | null = null) {
    return (client as any).userSetupIssue.updateMany({
      where: { dedupeKey: setupIssueDedupeKey(userId, code), status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
      data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedById },
    });
  }

  /** What is wrong with this person right now, read from their current records. */
  async detect(userId: string): Promise<SetupIssueCode[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isSystemAccount: true, departmentId: true, employeeId: true, employmentState: true, scheduledActivationOn: true },
    });
    if (!user || user.isSystemAccount) return [];
    const found: SetupIssueCode[] = [];
    if (!user.departmentId) found.push('DEPARTMENT_MISSING');

    const now = new Date();
    const hierarchy = await (this.prisma as any).hierarchyAssignment.count({
      where: {
        effectiveFrom: { lte: now },
        assigneeUser: { isActive: true },
        AND: [
          { OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
          {
            OR: [
              { scope: 'EMPLOYEE', subjectUserId: userId },
              ...(user.departmentId ? [{ scope: 'DEPARTMENT', departmentId: user.departmentId }] : []),
              { scope: 'COMPANY', role: 'MANAGER' },
            ],
          },
        ],
      },
    });
    if (hierarchy === 0) found.push('HIERARCHY_MISSING');

    const profiles = await this.prisma.employeeAttendanceProfile.count({ where: { userId, effectiveTo: null } });
    if (profiles === 0) found.push('ATTENDANCE_POLICY_SETUP_PENDING');

    // Still waiting after the joining date has passed: the activation job failed.
    if (user.employmentState === 'SCHEDULED_TO_JOIN' && user.scheduledActivationOn && user.scheduledActivationOn < companyToday()) {
      found.push('SCHEDULED_ACTIVATION_FAILED');
    }
    if (!user.employeeId) found.push('EMPLOYEE_ID_BACKFILL_FAILED');
    // Phase 3: a leave request still waiting on leave setup (not yet settled).
    const unsettled = await this.prisma.leaveRequest.count({
      where: { userId, setupStatus: 'POLICY_SETUP_PENDING', status: { in: ['PENDING', 'APPROVED'] }, fundingOutcome: null },
    });
    if (unsettled > 0) found.push('LEAVE_SETUP_PENDING');
    return found;
  }

  /**
   * Re-checks one person: opens the requested codes that are present (so a
   * create never invents a backfill failure), resolves open issues whose cause
   * is gone, then announces anything not yet announced. Never throws.
   */
  async refreshForUser(userId: string, open: SetupIssueCode[] = ['DEPARTMENT_MISSING', 'HIERARCHY_MISSING']) {
    try {
      const present = new Set<string>(await this.detect(userId));
      for (const code of open) if (present.has(code)) await this.record(this.prisma, userId, code);
      const existing = await (this.prisma as any).userSetupIssue.findMany({
        where: { userId, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
        select: { code: true },
      });
      for (const row of existing) {
        if (REDETECTABLE.has(row.code) && !present.has(row.code)) await this.resolve(this.prisma, userId, row.code);
      }
      await this.notifyPending(userId);
    } catch (error) {
      this.logger.warn(`Setup issue refresh failed for user ${userId}: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  /** First notice for every open issue not yet announced. */
  async notifyPending(userId?: string) {
    const issues = await (this.prisma as any).userSetupIssue.findMany({
      where: { status: 'OPEN', firstNotifiedAt: null, ...(userId ? { userId } : {}) },
      select: { id: true, userId: true, code: true },
      orderBy: { firstDetectedAt: 'asc' },
      take: 500,
    });
    let sent = 0;
    for (const issue of issues) {
      if (!(await this.announce(issue, 'initial'))) continue;
      await (this.prisma as any).userSetupIssue.update({ where: { id: issue.id }, data: { firstNotifiedAt: new Date() } });
      sent += 1;
    }
    return sent;
  }

  /** One follow-up, 15 days after the first notice, while still open. */
  async sendFollowUps(now = new Date()) {
    const due = await (this.prisma as any).userSetupIssue.findMany({
      where: {
        status: 'OPEN',
        reminder15SentAt: null,
        firstNotifiedAt: { lte: new Date(now.getTime() - FOLLOW_UP_DAYS * 24 * 60 * 60 * 1000) },
      },
      select: { id: true, userId: true, code: true },
      orderBy: { firstNotifiedAt: 'asc' },
      take: 500,
    });
    let sent = 0;
    for (const issue of due) {
      if (!(await this.announce(issue, 'r15'))) continue;
      await (this.prisma as any).userSetupIssue.update({ where: { id: issue.id }, data: { reminder15SentAt: new Date() } });
      sent += 1;
    }
    return sent;
  }

  /** Daily: resolve what is fixed, announce what is new, follow up what is old. */
  @Cron('0 9 * * *', { name: 'user-setup-issues-daily', timeZone: COMPANY_CRON_TIMEZONE })
  async runDaily(now = new Date()) {
    const open = await (this.prisma as any).userSetupIssue.findMany({
      where: { status: { in: ['OPEN', 'ACKNOWLEDGED'] }, userId: { not: null } },
      select: { userId: true },
      distinct: ['userId'],
      take: 2000,
    });
    for (const row of open) await this.refreshForUser(row.userId, []);
    const announced = await this.notifyPending();
    const followUps = await this.sendFollowUps(now);
    return { checkedUsers: open.length, announced, followUps };
  }

  /** Admins, Super Admins and HR. Returns false when nobody could be told. */
  private async announce(issue: { id: string; userId: string | null; code: string }, kind: 'initial' | 'r15'): Promise<boolean> {
    const spec = SETUP_ISSUE_SPECS[issue.code as SetupIssueCode];
    if (!spec || !issue.userId) return false;
    const subject = await this.prisma.user.findUnique({ where: { id: issue.userId }, select: { name: true } });
    const recipients = await this.prisma.user.findMany({
      where: {
        isActive: true,
        isSystemAccount: false,
        OR: [{ role: { name: { in: ['ADMIN', 'SUPER_ADMIN'] } } }, { isHR: true }],
      },
      select: { id: true },
    });
    if (recipients.length === 0) return false;
    const data = {
      title: kind === 'r15' ? `Still pending: ${spec.title}` : spec.title,
      message: spec.message(subject?.name ?? 'An employee'),
      type: 'WARNING' as any,
      link: `/users/${issue.userId}`,
      entityType: 'UserSetupIssue',
      entityId: issue.id,
      dedupeKey: `setup:${issue.id}:${kind}`,
    };
    let delivered = 0;
    for (const r of recipients) {
      try {
        if (this.notifications) {
          await this.notifications.sendNotification(r.id, 'setupIssues', data);
        } else {
          await (this.prisma as any).notification.create({ data: { userId: r.id, ...data } }).catch((e: any) => {
            if (e?.code !== 'P2002') throw e;
          });
        }
        delivered += 1;
      } catch (error) {
        this.logger.warn(`Setup issue notification failed for ${issue.id}: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }
    return delivered > 0;
  }
}
