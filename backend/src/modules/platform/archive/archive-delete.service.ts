import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccessPolicyService } from '../../../common/services/access-policy.service';
import { EmployeeArchiveCollectorService } from './employee-archive-collector.service';
import { archiveFileName, packEmployeeArchive } from './employee-archive-zip';
import {
  EMPLOYEE_ARCHIVE_STORAGE,
  type EmployeeArchiveStorage,
} from './storage/employee-archive-storage';
import { USER_RELATION_RULES } from './user-relation-classification';
import {
  EMPLOYEE_LIFECYCLE_SETTING_KEY,
  isArchiveDeleteEnabled,
} from './employee-lifecycle-settings';

/**
 * One irreversible action: archive an employee to Drive, prove it arrived,
 * then remove them while the company's history stays behind.
 *
 * THE INVARIANT THE WHOLE CLASS EXISTS FOR:
 *
 *     NO VERIFIED GOOGLE DRIVE ARCHIVE  =  NO USER DELETE
 *
 * Everything before verification is read-only. Collection, zipping, upload and
 * verification all happen while the employee is completely intact, so a
 * failure at any of them leaves nothing to undo and the correct outcome is
 * simply that nothing happened. The database transaction does not open until
 * Drive has confirmed, by a second read, that the archive is there and is the
 * file we built.
 *
 * ORDER IS THE SAFETY PROPERTY, not the error handling. There is no cleanup
 * path that half-removes somebody, because there is no window in which
 * somebody is half-removed.
 */
@Injectable()
export class ArchiveDeleteService {
  private readonly logger = new Logger(ArchiveDeleteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accessPolicy: AccessPolicyService,
    private readonly collector: EmployeeArchiveCollectorService,
    private readonly config: ConfigService,
    @Inject(EMPLOYEE_ARCHIVE_STORAGE)
    private readonly storage: EmployeeArchiveStorage,
  ) {}

  // ════════════════════════════════════════════════════════════════════════
  // Guards
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Is destructive deletion permitted on this deployment at all?
   *
   * READ FROM THE DATABASE, NOT FROM THE BUILD. A deployment is switched on
   * by a decision somebody records, not by shipping a different artifact, so
   * production and staging run identical code and differ by one row.
   *
   * CHECKED FIRST, BEFORE AUTHORIZATION. A Super Admin on a deployment where
   * the feature is off is refused for the same reason an employee is: it is
   * not available here. Reading it straight from the setting row rather than
   * through SettingsService keeps this module free of SettingsModule, which
   * pulls EmailModule with it.
   */
  async isEnabled(): Promise<boolean> {
    const row = await this.prisma.appSetting
      .findUnique({ where: { key: EMPLOYEE_LIFECYCLE_SETTING_KEY }, select: { value: true } })
      .catch(() => null);
    // An unreadable settings table means OFF. The failure direction is
    // chosen: unavailable costs a support request, available costs somebody
    // their account.
    return isArchiveDeleteEnabled(row ? (row as any).value : null);
  }

  private async assertEnabled(): Promise<void> {
    if (!(await this.isEnabled())) {
      throw new ForbiddenException(
        'Archive & Delete is not enabled on this environment.',
      );
    }
  }

  /**
   * Admin and Super Admin only.
   *
   * NOT isHrOrAdmin. HR can do a great deal to an employee record, and this
   * is the one thing they cannot: it destroys an account and it cannot be
   * undone. Manager, Team Lead, Employee and Intern are all refused for the
   * same reason, in the service, so no route or button is what stands between
   * them and it.
   */
  private assertAdmin(actor: any): void {
    const role = this.accessPolicy.roleName(actor);
    if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
      throw new ForbiddenException(
        'Only an administrator can archive and delete an employee.',
      );
    }
  }

  /**
   * Everything that must be true before a deletion may even be attempted.
   *
   * RUN TWICE: once before the archive, so an administrator is not made to
   * wait through an upload for a refusal, and again inside the transaction,
   * because the archive takes time and the world can change during it.
   */
  private async assertDeletable(
    actor: any,
    target: { id: string; name: string; roleName: string | null },
    db: any = this.prisma,
  ): Promise<void> {
    const actorId = actor?.id ?? actor?.sub;

    // SELF-DELETE. Blocked outright. An administrator deleting their own
    // account would, at best, log themselves out of a half-finished operation
    // they are the only one authorised to retry.
    if (actorId && actorId === target.id) {
      throw new BadRequestException(
        'You cannot archive and delete your own account.',
      );
    }

    // THE LAST PRIVILEGED ACCOUNT. Deleting the only Super Admin leaves the
    // system with nobody who can restore one. Counted rather than assumed,
    // and counted inside the transaction too, because two concurrent
    // deletions could each see a count of two.
    if (target.roleName === 'SUPER_ADMIN') {
      const remaining = await db.user.count({
        where: { role: { name: 'SUPER_ADMIN' }, id: { not: target.id }, isActive: true },
      });
      if (remaining === 0) {
        throw new BadRequestException(
          'This is the last active Super Admin. Appoint another before deleting this account.',
        );
      }
    }

    const blocked = await this.blockingRelations(target.id, db);
    if (blocked.length > 0) {
      throw new ConflictException({
        statusCode: 409,
        message:
          'This employee still holds work that must be reassigned before deletion.',
        blockers: blocked,
      });
    }
  }

  /**
   * The BLOCK_DELETE relations, as live counts.
   *
   * These are not records to tidy away -- they are operational gaps. A team
   * with no lead, a pending approval nobody owns, a lead with no owner: each
   * would quietly stall something, so a human reassigns them first. The rules
   * and their resolutions come from the classification, so this cannot drift
   * from it.
   */
  private async blockingRelations(
    userId: string,
    db: any = this.prisma,
  ): Promise<Array<{ what: string; count: number; resolution: string }>> {
    const checks: Array<{ key: string; count: () => Promise<number> }> = [
      {
        key: 'Team.teamLead',
        count: () => db.team.count({ where: { teamLeadId: userId } }),
      },
      {
        key: 'EmployeeProfileChangeRequest.currentApprover',
        count: () =>
          db.employeeProfileChangeRequest.count({
            where: { currentApproverId: userId, status: { in: ['PENDING', 'IN_REVIEW'] } },
          }),
      },
      {
        key: 'Lead.owner',
        count: () => db.lead.count({ where: { ownerId: userId } }),
      },
    ];

    const out: Array<{ what: string; count: number; resolution: string }> = [];
    for (const check of checks) {
      const rule = USER_RELATION_RULES.find(
        (r) => `${r.model}.${r.field}` === check.key,
      );
      // A BLOCK_DELETE rule with no check here would be silently unenforced,
      // so the test suite asserts the two lists match.
      const count = await check.count().catch(() => 0);
      if (count > 0) {
        out.push({
          what: check.key,
          count,
          resolution: rule?.resolution ?? 'Reassign this before deleting the employee.',
        });
      }
    }
    return out;
  }

  /** The BLOCK_DELETE keys this service actually checks. Read by its tests. */
  static readonly ENFORCED_BLOCKERS = [
    'Team.teamLead',
    'EmployeeProfileChangeRequest.currentApprover',
    'Lead.owner',
  ] as const;

  // ════════════════════════════════════════════════════════════════════════
  // The operation
  // ════════════════════════════════════════════════════════════════════════

  async archiveAndDelete(actor: any, targetUserId: string) {
    // The environment gate comes before everything, including the role check:
    // on a deployment where this is off, it is off for Super Admin too.
    await this.assertEnabled();
    this.assertAdmin(actor);

    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true, name: true, employeeId: true,
        role: { select: { name: true } },
        department: { select: { name: true } },
      },
    });
    if (!target) throw new NotFoundException('Employee not found');

    const summary = {
      id: target.id,
      name: target.name,
      roleName: target.role?.name ?? null,
    };

    await this.assertDeletable(actor, summary);

    // ── Claim the operation ────────────────────────────────────────────
    // The ledger's unique formerUserId is what makes a double-click one
    // operation rather than two destructive runs. Claiming BEFORE the archive
    // means a second request is refused while the first is still uploading.
    const operation = await this.claim(actor, target);

    const actorId = actor?.id ?? actor?.sub ?? null;

    try {
      // ── Everything here is read-only ───────────────────────────────────
      await this.prisma.employeeDeletionLedger.update({
        where: { formerUserId: target.id },
        data: { status: 'ARCHIVING', failureReason: null },
      });

      const archive = await this.collector.collect({
        userId: target.id,
        archivedBy: { id: actorId ?? '', name: actor?.name ?? null },
        now: new Date(),
        environment: this.config.get<string>('APP_ENV') ?? 'unknown',
        applicationVersion: this.config.get<string>('GIT_COMMIT') ?? null,
      });

      const packedArchive = await packEmployeeArchive(archive);
      const fileName = archiveFileName(archive);

      const uploaded = await this.storage.upload({
        fileName,
        buffer: packedArchive.buffer,
        checksum: packedArchive.checksum,
        md5: packedArchive.md5,
        description: `Apex OS employee archive for ${target.employeeId ?? target.id}`,
      });

      // ── The gate ───────────────────────────────────────────────────────
      const verification = await this.storage.verify({
        fileId: uploaded.fileId,
        expectedFileName: fileName,
        expectedBytes: packedArchive.bytes,
        expectedChecksum: packedArchive.checksum,
        expectedContentHash: packedArchive.md5,
      });

      if (!verification.verified) {
        // THE EMPLOYEE REMAINS. Nothing has been mutated, so there is nothing
        // to roll back -- the operation simply did not get past the gate.
        await this.fail(
          target.id,
          `Archive verification failed: ${verification.problems.join(' ')}`,
        );
        throw new ConflictException(
          'The archive could not be verified in Google Drive, so the employee was NOT deleted. ' +
            verification.problems.join(' '),
        );
      }

      await this.prisma.employeeDeletionLedger.update({
        where: { formerUserId: target.id },
        data: {
          status: 'ARCHIVED',
          driveFileId: uploaded.fileId,
          driveFileName: uploaded.fileName,
          archiveBytes: packedArchive.bytes,
          archiveChecksum: packedArchive.checksum,
          archivedAt: new Date(),
        },
      });

      // ── Only now does anything change ──────────────────────────────────
      const result = await this.performDelete(actor, summary, {
        driveFileId: uploaded.fileId,
        driveFileName: uploaded.fileName,
        employeeId: target.employeeId ?? null,
        departmentName: target.department?.name ?? null,
        roleName: target.role?.name ?? null,
      });

      this.logger.log(
        `Employee ${target.id} archived to Drive ${uploaded.fileId} and deleted by ${actorId}`,
      );

      return {
        deleted: true,
        formerUserId: target.id,
        displayName: target.name,
        employeeId: target.employeeId ?? null,
        driveFileId: uploaded.fileId,
        driveFileName: uploaded.fileName,
        archiveBytes: packedArchive.bytes,
        archiveChecksum: packedArchive.checksum,
        deletedAt: result.deletedAt,
      };
    } catch (err: any) {
      // Recorded, then rethrown unchanged. The ledger says what happened; the
      // caller still gets the real error rather than a generic one.
      await this.fail(target.id, err?.message ?? 'Unknown failure').catch(() => {});
      throw err;
    }
  }

  /**
   * Takes ownership of this deletion, or refuses.
   *
   * ONE ROW PER EMPLOYEE, enforced by a unique index rather than by reading
   * first and writing after -- two administrators clicking at the same moment
   * both pass a read check, and only one can win a unique constraint.
   */
  private async claim(actor: any, target: { id: string; name: string; employeeId: string | null }) {
    const existing = await this.prisma.employeeDeletionLedger.findUnique({
      where: { formerUserId: target.id },
    });

    if (existing) {
      if (existing.status === 'COMPLETED') {
        // Already done. The user row should not even exist, so this is a
        // replayed request rather than a new one.
        throw new ConflictException(
          'This employee has already been archived and deleted.',
        );
      }
      if (existing.status !== 'FAILED') {
        // In flight. A second administrator, or the same one clicking twice.
        throw new ConflictException(
          'An archive and delete is already running for this employee.',
        );
      }
      // A previous attempt failed: retry is allowed, and reuses the row.
      return this.prisma.employeeDeletionLedger.update({
        where: { formerUserId: target.id },
        data: {
          status: 'REQUESTED',
          failureReason: null,
          initiatedById: actor?.id ?? actor?.sub ?? null,
        },
      });
    }

    try {
      return await this.prisma.employeeDeletionLedger.create({
        data: {
          formerUserId: target.id,
          formerEmployeeId: target.employeeId,
          formerDisplayName: target.name,
          initiatedById: actor?.id ?? actor?.sub ?? null,
          status: 'REQUESTED',
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        // The other request won the race between our read and our write.
        throw new ConflictException(
          'An archive and delete is already running for this employee.',
        );
      }
      throw err;
    }
  }

  private async fail(formerUserId: string, reason: string) {
    return this.prisma.employeeDeletionLedger.update({
      where: { formerUserId },
      // Truncated: a stack trace in a ledger column helps nobody and can
      // carry internals into an admin's browser.
      data: { status: 'FAILED', failureReason: reason.slice(0, 500) },
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // The transaction
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Everything that changes, in one transaction.
   *
   * ALL OF IT OR NONE OF IT. A partial deletion is the worst outcome
   * available -- an employee whose tickets lost their creator but who still
   * exists, or a user row removed while its personal attendance remains. If
   * any step throws, the database is untouched; the Drive archive stays, the
   * employee stays, and the operation is retryable.
   */
  private async performDelete(
    actor: any,
    target: { id: string; name: string; roleName: string | null },
    details: {
      driveFileId: string;
      driveFileName: string;
      employeeId: string | null;
      departmentName: string | null;
      roleName: string | null;
    },
  ): Promise<{ deletedAt: Date }> {
    const actorId = actor?.id ?? actor?.sub ?? null;

    return this.prisma.$transaction(async (tx: any) => {
      // 1. The world may have changed during the upload.
      const still = await tx.user.findUnique({
        where: { id: target.id },
        select: { id: true },
      });
      if (!still) throw new NotFoundException('Employee no longer exists');

      // 2. Re-check the guards against the transaction's own view. A team
      //    lead assigned, or a Super Admin deactivated, while the archive was
      //    uploading must stop this.
      await this.assertDeletable(actor, target, tx);

      const deletedAt = new Date();

      // 3. The tombstone, FIRST, because everything below points at it.
      const former = await tx.formerEmployee.create({
        data: {
          formerUserId: target.id,
          employeeId: details.employeeId,
          displayName: target.name,
          roleName: details.roleName,
          departmentName: details.departmentName,
          deletedAt,
          deletedById: actorId,
          archiveDriveFileId: details.driveFileId,
        },
      });

      // 4. RETAIN_WITH_SNAPSHOT: point the record at the tombstone BEFORE the
      //    user reference goes, so attribution is never momentarily absent.
      for (const step of SNAPSHOT_STEPS) {
        await tx[step.delegate].updateMany({
          where: { [step.column]: target.id },
          data: { [step.snapshotColumn]: former.id, [step.column]: null },
        });
      }

      // 5. RETAIN_AND_NULL_ACTOR: the record survives, unattributed, because
      //    the identity adds nothing once they are gone.
      for (const step of NULL_STEPS) {
        await tx[step.delegate].updateMany({
          where: { [step.column]: target.id },
          data: { [step.column]: null },
        });
      }

      // 6. DELETE_WITH_USER: personal rows. Deleted explicitly rather than
      //    left to cascade, so the order is visible and a model whose cascade
      //    is later removed does not silently start blocking.
      for (const step of DELETE_STEPS) {
        await tx[step.delegate].deleteMany({ where: { [step.column]: target.id } });
      }

      // 7. The user.
      await tx.user.delete({ where: { id: target.id } });

      // 8. The receipt, in the same transaction as the deletion it records.
      await tx.employeeDeletionLedger.update({
        where: { formerUserId: target.id },
        data: {
          status: 'COMPLETED',
          deletedAt,
          driveFileId: details.driveFileId,
          driveFileName: details.driveFileName,
          failureReason: null,
        },
      });

      return { deletedAt };
    }, {
      // An archive-sized transaction touching twenty tables comfortably
      // outlives Prisma's 5s default.
      timeout: 120_000,
      maxWait: 15_000,
    });
  }
}

/**
 * The retained-with-attribution steps.
 *
 * Each points a surviving record at the tombstone and clears its user
 * reference, in that order, within one statement.
 */
export const SNAPSHOT_STEPS: ReadonlyArray<{
  model: string; field: string; delegate: string; column: string; snapshotColumn: string;
}> = [
  { model: 'Ticket', field: 'createdBy', delegate: 'ticket', column: 'createdById', snapshotColumn: 'formerCreatorId' },
  { model: 'TicketHistory', field: 'changedBy', delegate: 'ticketHistory', column: 'changedById', snapshotColumn: 'formerActorId' },
  { model: 'TicketTimeLog', field: 'user', delegate: 'ticketTimeLog', column: 'userId', snapshotColumn: 'formerActorId' },
  { model: 'ReviewCycleLog', field: 'reviewer', delegate: 'reviewCycleLog', column: 'reviewerId', snapshotColumn: 'formerReviewerId' },
  { model: 'Comment', field: 'author', delegate: 'comment', column: 'authorId', snapshotColumn: 'formerAuthorId' },
  { model: 'OperationalEvent', field: 'actor', delegate: 'operationalEvent', column: 'actorId', snapshotColumn: 'formerActorId' },
  { model: 'ActivityLog', field: 'user', delegate: 'activityLog', column: 'userId', snapshotColumn: 'formerActorId' },
  { model: 'AttendanceMonthClose', field: 'finalizedBy', delegate: 'attendanceMonthClose', column: 'finalizedById', snapshotColumn: 'formerFinalizerId' },
  { model: 'AttendanceMonthClose', field: 'reopenedBy', delegate: 'attendanceMonthClose', column: 'reopenedById', snapshotColumn: 'formerReopenerId' },
  { model: 'AttendanceImportBatch', field: 'uploadedBy', delegate: 'attendanceImportBatch', column: 'uploadedById', snapshotColumn: 'formerUploaderId' },
  { model: 'AttendanceImportBatch', field: 'approvedBy', delegate: 'attendanceImportBatch', column: 'approvedById', snapshotColumn: 'formerApproverId' },
  { model: 'AttendanceImportBatch', field: 'appliedBy', delegate: 'attendanceImportBatch', column: 'appliedById', snapshotColumn: 'formerApplierId' },
  { model: 'EmployeeProfileChangeRequest', field: 'requestedBy', delegate: 'employeeProfileChangeRequest', column: 'requestedById', snapshotColumn: 'formerRequesterId' },
  { model: 'LeadActivity', field: 'createdBy', delegate: 'leadActivity', column: 'createdById', snapshotColumn: 'formerActorId' },
  { model: 'FollowUp', field: 'createdBy', delegate: 'followUp', column: 'createdById', snapshotColumn: 'formerActorId' },
];

/** Retained, unattributed. The record survives with a null actor. */
export const NULL_STEPS: ReadonlyArray<{
  model: string; field: string; delegate: string; column: string;
}> = [
  { model: 'AttendanceRegularization', field: 'createdBy', delegate: 'attendanceRegularization', column: 'createdById' },
  { model: 'Ticket', field: 'assignedTo', delegate: 'ticket', column: 'assignedToId' },
  { model: 'Ticket', field: 'approver', delegate: 'ticket', column: 'approverId' },
  { model: 'ReviewCycleLog', field: 'assignee', delegate: 'reviewCycleLog', column: 'assigneeId' },
  { model: 'Requirement', field: 'owner', delegate: 'requirement', column: 'ownerId' },
];

/** Personal. Removed with the person; the archive is the record. */
export const DELETE_STEPS: ReadonlyArray<{
  model: string; field: string; delegate: string; column: string;
}> = [
  { model: 'DailyAttendance', field: 'user', delegate: 'dailyAttendance', column: 'userId' },
  { model: 'AttendancePunchEvidence', field: 'user', delegate: 'attendancePunchEvidence', column: 'userId' },
  { model: 'AttendancePunchPhoto', field: 'user', delegate: 'attendancePunchPhoto', column: 'userId' },
  { model: 'AttendancePunchHandoff', field: 'user', delegate: 'attendancePunchHandoff', column: 'userId' },
  { model: 'AttendanceEvent', field: 'user', delegate: 'attendanceEvent', column: 'userId' },
  { model: 'BreakLog', field: 'user', delegate: 'breakLog', column: 'userId' },
  { model: 'WorkSession', field: 'user', delegate: 'workSession', column: 'userId' },
  { model: 'AttendanceRegularization', field: 'user', delegate: 'attendanceRegularization', column: 'userId' },
  { model: 'EmployeeAttendanceProfile', field: 'user', delegate: 'employeeAttendanceProfile', column: 'userId' },
  { model: 'UserWorkdayPolicyOverride', field: 'user', delegate: 'userWorkdayPolicyOverride', column: 'userId' },
  { model: 'CompOffCredit', field: 'employee', delegate: 'compOffCredit', column: 'employeeId' },
  { model: 'LeaveRequest', field: 'user', delegate: 'leaveRequest', column: 'userId' },
  { model: 'TicketAssignee', field: 'user', delegate: 'ticketAssignee', column: 'userId' },
  { model: 'TicketWatcher', field: 'user', delegate: 'ticketWatcher', column: 'userId' },
  { model: 'ProjectMember', field: 'user', delegate: 'projectMember', column: 'userId' },
  { model: 'TeamMember', field: 'user', delegate: 'teamMember', column: 'userId' },
  { model: 'UserDepartmentMembership', field: 'user', delegate: 'userDepartmentMembership', column: 'userId' },
  { model: 'UserRoleAssignment', field: 'user', delegate: 'userRoleAssignment', column: 'userId' },
  { model: 'ManagerDeptAccess', field: 'manager', delegate: 'managerDeptAccess', column: 'managerId' },
  { model: 'Notification', field: 'user', delegate: 'notification', column: 'userId' },
  { model: 'EmployeeDocument', field: 'user', delegate: 'employeeDocument', column: 'userId' },
  { model: 'EmployeeProfileChangeRequest', field: 'targetUser', delegate: 'employeeProfileChangeRequest', column: 'targetUserId' },
];
