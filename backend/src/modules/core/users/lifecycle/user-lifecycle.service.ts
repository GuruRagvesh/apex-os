/**
 * Archived-user lifecycle: Archive User, permanent deletion and their cleanup.
 *
 *   Active ── Archive ──▶ Archived ── Rehire (UsersService.rehire) ──▶ Active
 *                            └── Permanently delete ──▶ DB_DELETED ──▶ CLEANUP_PENDING ──▶ PERMANENTLY_DELETED
 *
 * Archive: one database transaction closes or re-homes the person's live work,
 * makes them inactive, takes the complete dependency inventory and -- when they
 * have history -- copies every row and every file into a new private Drive
 * folder and reads it all back before the snapshot can be VERIFIED. Any failure
 * rolls the database back and removes what was uploaded.
 *
 * Permanent delete: re-verifies the EXISTING archive (it never uploads), checks
 * the fingerprint, active work and the retention gate, then deletes inside one
 * transaction under the dependency matrix, and finally removes non-shared
 * original files. The person loses all access at DB_DELETED;
 * USER_PERMANENTLY_DELETED is written only once cleanup is complete.
 *
 * Nothing the client sends is trusted: the actor comes from authentication and
 * every state, count and verification is re-derived here.
 */

import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { TicketsService } from '../../../operations/tickets/tickets.service';
import { WorkdayService } from '../../../platform/workday/workday.service';
import { createDriveVault, DRIVE_ROOT_NAME, DriveRefused, isArchiveAccount, readDriveConfig, type ArchiveVault, type DriveConfig } from '../../../platform/backup-vault/drive-vault';
import { ensureVerifiedFolderChain, FolderNotPrivate, inspectArchiveStorage, MISSING_FOLDER_ISSUES, verifyArchiveRoot, verifyFolderChain } from '../../../platform/backup-vault/drive-folder-privacy';
import { DELETED_ACCOUNT, ensureDeletedAccount } from './system-account';
import { HANDLERS, JSON_SCRUB_COLUMNS, MatrixContext, NARRATIVE_TEXT_COLUMNS, SCRUBBED, DELETED_USER_NAME, delegateName, handlerWhere, scrubJson, Subject } from './dependency-matrix';
import { removeTemplateAssignee } from './template-assignees';
import { removeMeetingApprover } from './meeting-approvers';
import { canonical, classifyNoHistory, collectInventory, dataFingerprint, Inventory } from './dependency-inventory';
import { archiveFileName, collectFileObjects, FileObject, FileStore, markShared } from './archive-files';
import { ArchivedFileEntry, buildArchiveWorkbook, readFilesSheet } from './archive-workbook';
import { createProviderFileStore } from './provider-file-store';
import { decryptHandle, encryptHandle, handleHmac, handleKeyConfigurationIssues, readHandleKeys } from './handle-crypto';
import { countOpenExitCases, evaluateRetention, protectedRowDate, retentionDefaultDeny, retentionRefusal, RetentionEvaluation } from './retention';
import { activeHoldWhere, HoldStatusView, strongestHold } from '../../../../common/lifecycle-domain';
import { AllowedRetryEndpoint, RemediationException, RemediationResult, buildRemediation, pickByPrecedence } from '../../../../common/remediation';
import { listLifecycleAttempts, recordLifecycleAttempt } from './remediation-attempts';
import { closeProfilesAt } from '../../../platform/attendance/timeline/profile-continuity';
import { COMPANY_CRON_TIMEZONE } from '../../../../common/constants/company-time.constants';

/** Company calendar date of an instant (yyyy-MM-dd). */
function companyDateOf(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: COMPANY_CRON_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}
import {
  ARCHIVE_EVENT_NAMES,
  ARCHIVE_SCHEMA_VERSION,
  CLEANUP_ERROR,
  CLEANUP_ITEM_STATE,
  LIFECYCLE_EVENT,
  LIFECYCLE_EVENT_SCHEMA_VERSION,
  LifecycleRefusal,
  OPERATION_KIND,
  OPERATION_STATE,
  REASON,
  REMEDIATION_CODE_FOR_REASON,
  RETURN_EVENT_NAMES,
  ReasonCode,
  SNAPSHOT_STATUS,
  USABLE_SNAPSHOT_STATUSES,
  opaqueId,
} from './lifecycle-codes';

export const USER_LIFECYCLE_PORTS = 'USER_LIFECYCLE_PORTS';

/** Everything that leaves the process, injectable so tests use fakes. */
export interface LifecyclePorts {
  env: () => NodeJS.ProcessEnv;
  now: () => Date;
  makeArchiveVault: (config: DriveConfig) => ArchiveVault;
  makeFileStore: () => FileStore;
  /** Timeout for each short interactive transaction (archive phases 1 and 3, deletion). */
  transactionTimeoutMs: number;
}

export function defaultLifecyclePorts(): LifecyclePorts {
  return {
    env: () => process.env,
    now: () => new Date(),
    makeArchiveVault: (config) => createDriveVault(config),
    makeFileStore: () => createProviderFileStore(process.env),
    // Short: no transaction ever waits on Google Drive or a file provider.
    transactionTimeoutMs: 120_000,
  };
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPEN_TICKET = { status: { notIn: ['DONE', 'CLOSED'] as any } };
const OPEN_LEAD_EXCLUDED_STAGES = ['Closed', 'Invalid'];
const MAX_TX_WAIT_MS = 10_000;

interface Actor {
  id: string;
  role?: { name?: string } | null;
  [k: string]: unknown;
}

export interface ArchivePreflight {
  userId: string;
  canArchive: boolean;
  state: 'ACTIVE' | 'DEACTIVATED' | 'ARCHIVED';
  blockers: Record<string, number>;
  activeWork: {
    soleTickets: number;
    sharedTickets: number;
    coAssignments: number;
    watching: number;
    activeSessions: number;
    activeBreaks: number;
    pendingOwnLeave: number;
  };
  operationInProgress: boolean;
  archiveCleanupPending: boolean;
  backupRequired: boolean;
  /**
   * What Retry Verification shows for archive codes (Phase 1): a running
   * operation, or an archive vault that is not configured for this environment
   * when a backup is required. Null when neither applies. The archive POST
   * remains the emitter of ARCHIVE_VAULT_NOT_READY and ARCHIVE_PRIVACY_FAILED (E1).
   */
  remediation: RemediationResult | null;
}

export interface DeletePreflight {
  userId: string;
  allowed: boolean;
  reasons: { code: ReasonCode; message: string }[];
  snapshot: { status: string | null; version: number | null; verificationAvailable: boolean; backupRequired: boolean | null };
  retention: { result: string; categories: Record<string, { rows: number; reason: string; eligibleOn?: string }> } | null;
  /** Non-blocking conditions shown beside the blockers (Phase 2): e.g. no retention rule configured. */
  warnings: RemediationResult[];
  verifiedArchive: boolean;
  cleanupObjects: number;
  /** The strongest blocking legal hold, or null (Phase 1). */
  holdStatus: HoldStatusView | null;
  /** The highest-precedence blocker as a remediation, or null when none applies (Phase 1). */
  remediation: RemediationResult | null;
}

export interface VerifiedArchivePreflight {
  userId: string;
  canPrepare: boolean;
  action: 'REUSE' | 'PREPARE' | 'REBUILD';
  reason: 'CURRENT' | 'SNAPSHOT_MISSING' | 'SNAPSHOT_STALE' | 'NO_HISTORY_CHANGED';
  backupRequired: boolean;
  snapshot: { status: string | null; version: number | null; verificationAvailable: boolean };
  operationInProgress: boolean;
}

@Injectable()
export class UserLifecycleService {
  private readonly logger = new Logger(UserLifecycleService.name);
  private readonly ports: LifecyclePorts;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: TicketsService,
    private readonly workday: WorkdayService,
    @Optional() @Inject(USER_LIFECYCLE_PORTS) ports?: LifecyclePorts,
  ) {
    this.ports = ports ?? defaultLifecyclePorts();
  }

  // ════════════════════════════════════════════════════════════════════════
  // Shared reads
  // ════════════════════════════════════════════════════════════════════════

  private environment(): string {
    return (this.ports.env().APP_ENV ?? '').trim().toLowerCase() || 'development';
  }

  /** Latest-wins across legacy and canonical names. */
  private async archivedAt(db: any, userId: string): Promise<Date | null> {
    const latest = await db.operationalEvent.findFirst({
      where: { entityType: 'User', entityId: userId, action: { in: [...ARCHIVE_EVENT_NAMES, ...RETURN_EVENT_NAMES] } },
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true, action: true },
    });
    return latest && ARCHIVE_EVENT_NAMES.includes(latest.action) ? latest.timestamp : null;
  }

  private async inflight(db: any, userId: string) {
    return db.userLifecycleOperation.findFirst({
      where: { userId, state: { in: [OPERATION_STATE.PREFLIGHTED, OPERATION_STATE.RUNNING, OPERATION_STATE.VERIFIED_FOR_DELETE, OPERATION_STATE.ARCHIVE_CLEANUP_PENDING] } },
      select: { id: true, kind: true, state: true },
    });
  }

  private assertTarget(user: any, actor: Actor) {
    if (!user) throw new NotFoundException('User not found');
    if (user.isSystemAccount) throw new ForbiddenException({ code: REASON.SYSTEM_ACCOUNT, message: 'This is a system account and cannot be changed.' });
    if (user.id === actor.id) throw new ForbiddenException({ code: REASON.SELF_TARGET, message: 'You cannot archive or delete your own account.' });
  }

  /** Live responsibilities that block archival (never re-assigned automatically). */
  async responsibilityBlockers(db: any, userId: string, employeeId: string | null, now: Date): Promise<Record<string, number>> {
    const [
      reports, teamMembersLed, teamsLed, managedDepts,
      pendingLeaveMgr, pendingLeaveHr, pendingTicketApprovals,
      pendingProfileChanges, pendingCorrections, openLeads, colleagueProfiles, awaitingApproval, openReportingLines,
    ] = await Promise.all([
      employeeId ? db.user.count({ where: { id: { not: userId }, isActive: true, reportingManager: employeeId } }) : 0,
      employeeId ? db.user.count({ where: { id: { not: userId }, isActive: true, teamLeadName: employeeId } }) : 0,
      db.team.count({ where: { teamLeadId: userId, isActive: true, members: { some: { userId: { not: userId } } } } }),
      db.managerDeptAccess.count({ where: { managerId: userId } }),
      db.leaveRequest.count({ where: { managerApprovedById: userId, status: 'PENDING', userId: { not: userId } } }),
      db.leaveRequest.count({ where: { hrApprovedById: userId, status: 'PENDING', userId: { not: userId } } }),
      db.ticket.count({ where: { approverId: userId, approvalState: 'PENDING' } }),
      db.employeeProfileChangeRequest.count({
        where: {
          targetUserId: { not: userId },
          status: { startsWith: 'PENDING' },
          OR: [{ currentApproverId: userId }, { tlApproverId: userId }, { managerApproverId: userId }, { adminApproverId: userId }],
        },
      }),
      db.attendanceRegularization.count({
        where: { userId: { not: userId }, status: { in: ['PENDING', 'MANAGER_APPROVED'] }, OR: [{ managerApproverId: userId }, { hrApproverId: userId }] },
      }),
      db.lead.count({ where: { ownerId: userId, leadStage: { notIn: OPEN_LEAD_EXCLUDED_STAGES } } }),
      db.employeeAttendanceProfile.count({
        where: {
          userId: { not: userId },
          user: { isActive: true },
          OR: [{ reportingManagerId: userId }, { hrReviewerId: userId }],
          AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }],
        },
      }),
      db.ticket.count({ where: { status: 'PENDING_APPROVAL', OR: [{ assignedToId: userId }, { assignees: { some: { userId } } }] } }),
      // Phase 1: an open TL/Manager assignment held by this person (as the assignee) is never ended automatically.
      db.hierarchyAssignment.count({ where: { assigneeUserId: userId, effectiveTo: null } }),
    ]);
    // Phase 4 (D8): an exit still running, or cleared with F&F unreleased.
    const openExit = await countOpenExitCases(db, userId);
    const out: Record<string, number> = {};
    const add = (k: string, n: number) => { if (n > 0) out[k] = n; };
    add('DIRECT_REPORTS', reports);
    add('TEAM_MEMBERS_LED', teamMembersLed);
    add('ACTIVE_TEAM_LEAD', teamsLed);
    add('MANAGED_DEPARTMENTS', managedDepts);
    add('PENDING_LEAVE_APPROVALS', pendingLeaveMgr + pendingLeaveHr);
    add('PENDING_TICKET_APPROVALS', pendingTicketApprovals);
    add('PENDING_PROFILE_CHANGE_APPROVALS', pendingProfileChanges);
    add('PENDING_ATTENDANCE_CORRECTION_APPROVALS', pendingCorrections);
    add('OPEN_CRM_LEADS', openLeads);
    add('ACTIVE_COLLEAGUE_ATTENDANCE_PROFILES', colleagueProfiles);
    add('TICKETS_AWAITING_APPROVAL', awaitingApproval);
    add('OPEN_REPORTING_LINES', openReportingLines);
    add('OPEN_EXIT_CASE', openExit);
    return out;
  }

  private async activeWork(db: any, userId: string) {
    const plan = await this.tickets.planArchiveTicketChanges(userId);
    const [activeSessions, activeBreaks, pendingOwnLeave] = await Promise.all([
      db.workSession.count({ where: { userId, logoutAt: null, status: { notIn: ['LOGGED_OUT', 'AUTO_CLOSED'] } } }),
      db.breakLog.count({ where: { userId, endAt: null } }),
      db.leaveRequest.count({ where: { userId, status: 'PENDING' } }),
    ]);
    return {
      plan,
      summary: {
        soleTickets: plan.close.length,
        sharedTickets: plan.promote.length,
        coAssignments: plan.remove.length,
        watching: plan.unwatch.length,
        activeSessions,
        activeBreaks,
        pendingOwnLeave,
      },
    };
  }

  private async writeEvent(
    db: any,
    e: {
      actorId: string;
      entityType: string;
      entityId: string;
      action: string;
      fromState?: string | null;
      toState?: string | null;
      reasonCode: ReasonCode | string;
      operationId: string;
      snapshotVersion?: number | null;
      counts?: Record<string, number>;
    },
  ) {
    await db.operationalEvent.create({
      data: {
        actorId: e.actorId,
        entityType: e.entityType,
        entityId: e.entityId,
        action: e.action,
        fromState: e.fromState ?? null,
        toState: e.toState ?? null,
        metadata: {
          operationId: e.operationId,
          snapshotVersion: e.snapshotVersion ?? null,
          reasonCode: e.reasonCode,
          counts: e.counts ?? {},
          eventSchemaVersion: LIFECYCLE_EVENT_SCHEMA_VERSION,
        },
      },
    });
  }

  private validIdempotencyKey(key: unknown): string {
    if (typeof key !== 'string' || !UUID_V4.test(key)) {
      throw new BadRequestException('A random idempotency key (UUID v4) is required.');
    }
    return key.toLowerCase();
  }

  /** Starts an operation, or returns the one this key already started. */
  private async startOperation(kind: string, userId: string, actorId: string, idempotencyKey: string) {
    const existing = await this.prisma.userLifecycleOperation.findUnique({ where: { idempotencyKey } });
    if (existing) return { op: existing, replay: true };
    try {
      const op = await this.prisma.userLifecycleOperation.create({
        data: { id: opaqueId(), userId, kind, state: OPERATION_STATE.RUNNING, actorId, idempotencyKey },
      });
      return { op, replay: false };
    } catch (err: any) {
      if (err?.code === 'P2002') {
        const again = await this.prisma.userLifecycleOperation.findUnique({ where: { idempotencyKey } });
        if (again) return { op: again, replay: true };
        throw new ConflictException({ code: REASON.OPERATION_IN_PROGRESS, message: 'Another archive, rehire or deletion is already running for this user.' });
      }
      throw err;
    }
  }

  private async finishOperation(opId: string, state: string, result: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    await this.prisma.userLifecycleOperation.update({ where: { id: opId }, data: { state, result: result as any, ...extra } });
  }

  /** The client-safe view of an operation: codes and counts only. */
  operationView(op: any) {
    // pendingFolderId is a Drive id kept server-side for the cleanup retry; it never leaves the server.
    const { pendingFolderId: _driveId, ...result } = (op.result ?? {}) as Record<string, unknown>;
    return { operationId: op.id, kind: op.kind, state: op.state, result: op.result ? result : null, remediation: op.remediation ?? null };
  }

  /** The append-only remediation history of one operation (Admin / Super Admin). */
  async operationAttempts(operationId: string) {
    const op = await this.prisma.userLifecycleOperation.findUnique({ where: { id: operationId }, select: { id: true } });
    if (!op) throw new NotFoundException('Operation not found');
    return { operationId, attempts: await listLifecycleAttempts(this.prisma, operationId) };
  }

  /** The remediation for a lifecycle reason, or null when Phase 1 has none for it. */
  private remediationFor(
    reason: ReasonCode,
    opts: { userId?: string | null; operationId?: string; details?: Record<string, unknown>; retryEndpoint?: AllowedRetryEndpoint; previewCount?: number } = {},
  ): RemediationResult | null {
    const code = REMEDIATION_CODE_FOR_REASON[reason];
    if (!code) return null;
    const r = buildRemediation(code, {
      affectedUserId: opts.userId ?? undefined,
      operationId: opts.operationId,
      details: opts.details,
      now: this.ports.now(),
      previewCount: opts.previewCount,
    });
    if (opts.retryEndpoint) r.retryEndpoint = opts.retryEndpoint;
    return r;
  }

  /** Retention categories with the given reason, and the latest eligibility date among them. */
  private retentionDetails(retention: DeletePreflight['retention'], reason: string): { retentionCategories?: string[]; eligibleOn?: string } {
    const hits = Object.entries(retention?.categories ?? {}).filter(([, v]) => v.reason === reason);
    if (hits.length === 0) return {};
    const dates = hits.map(([, v]) => v.eligibleOn).filter((d): d is string => !!d).sort();
    return { retentionCategories: hits.map(([k]) => k), ...(dates.length ? { eligibleOn: dates[dates.length - 1] } : {}) };
  }

  /**
   * The archive folder for an authorized admin, resolved at click time: the
   * latest usable snapshot's folder, else the configured archive root. The URL
   * never travels in a remediation payload.
   */
  async archiveFolder(userId: string, actor: Actor): Promise<{ url: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    this.assertTarget(user, actor);
    const snapshot = await this.prisma.userArchiveSnapshot.findFirst({ where: { userId, folderId: { not: null } }, orderBy: { version: 'desc' }, select: { folderId: true } });
    let folderId = snapshot?.folderId ?? null;
    if (!folderId) {
      try {
        folderId = readDriveConfig(this.ports.env(), this.environment()).rootFolderId ?? null;
      } catch {
        folderId = null;
      }
    }
    if (!folderId) throw new NotFoundException({ code: REASON.ARCHIVE_VAULT_NOT_READY, message: 'No archive folder is configured for this environment.' });
    return { url: `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}` };
  }

  /** The strongest blocking legal hold for a person (ACTIVE / legacy-active beats REQUESTED). */
  private async holdStatusFor(db: any, userId: string): Promise<HoldStatusView | null> {
    const rows = await db.userLegalHold.findMany({ where: { userId, ...activeHoldWhere() }, select: { status: true, releasedAt: true } });
    return strongestHold(rows);
  }

  // ════════════════════════════════════════════════════════════════════════
  // Archive
  // ════════════════════════════════════════════════════════════════════════

  /** Read-only. Writes nothing, not even an event. */
  async archivePreflight(userId: string, actor: Actor): Promise<ArchivePreflight> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    this.assertTarget(user, actor);
    const archived = await this.archivedAt(this.prisma, userId);
    const op = await this.inflight(this.prisma, userId);
    const blockers = await this.responsibilityBlockers(this.prisma, userId, user!.employeeId ?? null, this.ports.now());
    const work = await this.activeWork(this.prisma, userId);
    const inv = await collectInventory(this.prisma, userId, { systemUserId: DELETED_ACCOUNT.id, operationId: null, now: this.ports.now() });
    const backupRequired = !classifyNoHistory(inv).noHistory;
    const state = archived ? 'ARCHIVED' : user!.isActive ? 'ACTIVE' : 'DEACTIVATED';
    const operationInProgress = !!op && op.state !== OPERATION_STATE.ARCHIVE_CLEANUP_PENDING;
    const remediation = operationInProgress
      ? this.remediationFor(REASON.OPERATION_IN_PROGRESS, { userId, operationId: op!.id, retryEndpoint: 'ARCHIVE_PREFLIGHT' })
      : backupRequired && state !== 'ARCHIVED' && !this.archiveVaultConfigured()
        ? this.remediationFor(REASON.ARCHIVE_VAULT_NOT_READY, { userId })
        : null;
    return {
      userId,
      state,
      canArchive: state !== 'ARCHIVED' && !op && Object.keys(blockers).length === 0,
      blockers,
      activeWork: work.summary,
      operationInProgress,
      archiveCleanupPending: op?.state === OPERATION_STATE.ARCHIVE_CLEANUP_PENDING,
      backupRequired,
      remediation,
    };
  }

  /**
   * Read-only status for preparing an immutable snapshot of an already archived
   * account. Provider read-back happens in the POST so this endpoint never
   * changes state and remains inexpensive enough for the archived-user card.
   */
  async verifiedArchivePreflight(userId: string, actor: Actor): Promise<VerifiedArchivePreflight> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    this.assertTarget(user, actor);
    const archived = await this.archivedAt(this.prisma, userId);
    if (!archived || user!.isActive) {
      throw new ConflictException({ code: REASON.NOT_ARCHIVED, message: 'Only an archived user can have a verified archive prepared.' });
    }
    const [snapshot, op] = await Promise.all([
      this.prisma.userArchiveSnapshot.findFirst({ where: { userId, status: { in: USABLE_SNAPSHOT_STATUSES } }, orderBy: { version: 'desc' } }),
      this.inflight(this.prisma, userId),
    ]);
    const inv = await collectInventory(this.prisma, userId, { systemUserId: DELETED_ACCOUNT.id, operationId: null, now: this.ports.now() });
    const history = classifyNoHistory(inv);
    const same = !!snapshot && snapshot.environment === this.environment() && snapshot.dataFingerprint === dataFingerprint(inv);
    const noHistoryChanged = snapshot?.status === SNAPSHOT_STATUS.NO_HISTORY_VERIFIED && !history.noHistory;
    const action = !snapshot ? 'PREPARE' : same && !noHistoryChanged ? 'REUSE' : 'REBUILD';
    const reason = !snapshot ? 'SNAPSHOT_MISSING' : noHistoryChanged ? 'NO_HISTORY_CHANGED' : same ? 'CURRENT' : 'SNAPSHOT_STALE';
    return {
      userId,
      canPrepare: !op,
      action,
      reason,
      backupRequired: !history.noHistory,
      snapshot: { status: snapshot?.status ?? null, version: snapshot?.version ?? null, verificationAvailable: !!snapshot },
      operationInProgress: !!op,
    };
  }

  /**
   * Creates snapshot N+1 for an already archived account without reactivating
   * it, closing work, changing sessions or writing another USER_ARCHIVED event.
   * A matching existing snapshot is read back and reused. Any replacement is
   * uploaded and verified before one short transaction atomically invalidates
   * the old snapshot and records the new one.
   */
  async prepareVerifiedArchive(userId: string, actor: Actor, input: { idempotencyKey?: string }) {
    const idempotencyKey = this.validIdempotencyKey(input?.idempotencyKey);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    this.assertTarget(user, actor);
    if (!(await this.archivedAt(this.prisma, userId)) || user!.isActive) {
      throw new ConflictException({ code: REASON.NOT_ARCHIVED, message: 'Only an archived user can have a verified archive prepared.' });
    }
    const existingByKey = await this.prisma.userLifecycleOperation.findUnique({ where: { idempotencyKey } });
    if (existingByKey) return this.operationView(existingByKey);
    const pending = await this.inflight(this.prisma, userId);
    if (pending) {
      throw new ConflictException({ code: REASON.OPERATION_IN_PROGRESS, message: 'Another archive, rehire or deletion is already running for this user.', operationId: pending.id });
    }
    const { op, replay } = await this.startOperation(OPERATION_KIND.ARCHIVE, userId, actor.id, idempotencyKey);
    if (replay) return this.operationView(op);

    const now = this.ports.now();
    const environment = this.environment();
    const ctx: MatrixContext = { systemUserId: DELETED_ACCOUNT.id, operationId: op.id, now };
    const drive: { vault?: ArchiveVault; folderId?: string } = {};
    try {
      const blockers = await this.responsibilityBlockers(this.prisma, userId, user!.employeeId ?? null, now);
      if (Object.keys(blockers).length > 0) {
        throw new LifecycleRefusal(REASON.ACTIVE_RESPONSIBILITIES, 'This archived user has responsibilities that must be handed over before rebuilding the archive.', blockers);
      }
      const active = await this.activeWork(this.prisma, userId);
      if (Object.values(active.summary).some((n) => n > 0)) {
        throw new LifecycleRefusal(REASON.NEW_ACTIVE_WORK, 'This archived user has active work. Resolve it before rebuilding the archive.');
      }

      const inv = await collectInventory(this.prisma, userId, ctx);
      const history = classifyNoHistory(inv);
      const fingerprint = dataFingerprint(inv);
      const current = await this.prisma.userArchiveSnapshot.findFirst({
        where: { userId, status: { in: USABLE_SNAPSHOT_STATUSES } },
        include: { files: true },
        orderBy: { version: 'desc' },
      });

      // Reuse means provider verification succeeded now, not merely that the
      // database fingerprint matched.
      if (current && current.environment === environment && current.dataFingerprint === fingerprint) {
        let reusable = current.status === SNAPSHOT_STATUS.NO_HISTORY_VERIFIED && history.noHistory;
        if (current.status === SNAPSHOT_STATUS.VERIFIED) {
          try {
            await this.verifyExistingArchive(current, current.files);
            reusable = true;
          } catch {
            reusable = false;
          }
        }
        if (reusable) {
          await this.finishOperation(op.id, OPERATION_STATE.COMPLETED, {
            reasonCode: REASON.ADMIN_REQUEST,
            snapshotVersion: current.version,
            backupRequired: current.backupRequired,
            reused: true,
          }, { snapshotId: current.id });
          return this.operationView(await this.prisma.userLifecycleOperation.findUniqueOrThrow({ where: { id: op.id } }));
        }
      }

      const previous = await this.prisma.userArchiveSnapshot.aggregate({ where: { userId }, _max: { version: true } });
      const version = (previous._max.version ?? 0) + 1;
      const archiveRef = opaqueId();
      const snapshotId = opaqueId();
      let backup: Awaited<ReturnType<UserLifecycleService['writeArchive']>> | null = null;
      if (!history.noHistory) {
        backup = await this.writeArchive(this.prisma, inv, {
          archiveRef,
          version,
          environment,
          operationId: op.id,
          classificationVersion: history.classificationVersion,
          fingerprint,
          now,
          closures: [],
        }, drive);
      }

      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "users" WHERE id = ${userId} FOR UPDATE`;
        const running = await tx.userLifecycleOperation.findUnique({ where: { id: op.id } });
        if (!running || running.state !== OPERATION_STATE.RUNNING) throw new LifecycleRefusal(REASON.OPERATION_IN_PROGRESS, 'The verified archive operation is no longer running.');
        const locked = await tx.user.findUnique({ where: { id: userId } });
        if (!locked || locked.isActive || !(await this.archivedAt(tx, userId))) throw new LifecycleRefusal(REASON.NOT_ARCHIVED, 'Only an archived user can have a verified archive prepared.');
        const blockersNow = await this.responsibilityBlockers(tx, userId, locked.employeeId ?? null, now);
        if (Object.keys(blockersNow).length > 0) throw new LifecycleRefusal(REASON.ACTIVE_RESPONSIBILITIES, 'Responsibilities changed while the archive was being prepared.', blockersNow);
        const workNow = await this.activeWork(tx, userId);
        if (Object.values(workNow.summary).some((n) => n > 0)) throw new LifecycleRefusal(REASON.NEW_ACTIVE_WORK, 'Active work appeared while the archive was being prepared.');
        if (dataFingerprint(await collectInventory(tx, userId, ctx)) !== fingerprint) {
          throw new LifecycleRefusal(REASON.ARCHIVE_DATA_CHANGED, 'This user\'s data changed while the archive was being written. The existing snapshot remains unchanged; try again.');
        }

        const old = await tx.userArchiveSnapshot.findMany({ where: { userId, status: { in: USABLE_SNAPSHOT_STATUSES } }, select: { id: true, version: true } });
        await tx.userArchiveSnapshot.updateMany({
          where: { userId, status: { in: USABLE_SNAPSHOT_STATUSES } },
          data: { status: SNAPSHOT_STATUS.INVALIDATED_DATA_CHANGED, invalidatedAt: now, invalidationReason: REASON.ADMIN_REQUEST },
        });
        await tx.userArchiveSnapshot.create({
          data: {
            id: snapshotId,
            userId,
            archiveRef,
            version,
            status: backup ? SNAPSHOT_STATUS.VERIFIED : SNAPSHOT_STATUS.NO_HISTORY_VERIFIED,
            backupRequired: !!backup,
            provider: backup ? 'google-drive' : null,
            environment,
            folderId: backup?.folderId ?? null,
            folderPath: backup?.folderPath ?? null,
            workbookFileId: backup?.workbookFileId ?? null,
            workbookSizeBytes: backup?.workbookSizeBytes ?? null,
            workbookSha256: backup?.workbookSha256 ?? null,
            fileCount: backup?.files.length ?? 0,
            schemaVersion: ARCHIVE_SCHEMA_VERSION,
            classificationVersion: history.classificationVersion,
            dataFingerprint: fingerprint,
            backupFingerprint: fingerprint,
            dependencyCounts: history.historyCounts,
            ignoredSetupCounts: history.ignoredSetupCounts,
            operationId: op.id,
            createdById: actor.id,
            verifiedAt: now,
          },
        });
        if (backup?.files.length) {
          await tx.userArchiveFile.createMany({
            data: backup.files.map((f) => ({
              snapshotId,
              seq: f.seq,
              provider: f.provider,
              shared: f.shared,
              archiveFileId: f.archiveFileId,
              archivePath: `files/${f.archiveFileName}`,
              sizeBytes: f.sizeBytes,
              sha256: f.sha256,
              sourceCount: f.sources.length,
            })),
          });
        }
        for (const prior of old) {
          await this.writeEvent(tx, {
            actorId: actor.id,
            entityType: 'User',
            entityId: userId,
            action: LIFECYCLE_EVENT.ARCHIVE_SNAPSHOT_INVALIDATED,
            fromState: 'ARCHIVED',
            toState: 'ARCHIVED',
            reasonCode: REASON.ADMIN_REQUEST,
            operationId: op.id,
            snapshotVersion: prior.version,
          });
        }
        await this.writeEvent(tx, {
          actorId: actor.id,
          entityType: 'User',
          entityId: userId,
          action: backup ? LIFECYCLE_EVENT.ARCHIVE_BACKUP_VERIFIED : LIFECYCLE_EVENT.ARCHIVE_NO_HISTORY_VERIFIED,
          fromState: 'ARCHIVED',
          toState: 'ARCHIVED',
          reasonCode: REASON.ADMIN_REQUEST,
          operationId: op.id,
          snapshotVersion: version,
          counts: { files: backup?.files.length ?? 0 },
        });
        await tx.userLifecycleOperation.update({
          where: { id: op.id },
          data: {
            state: OPERATION_STATE.COMPLETED,
            snapshotId,
            result: { reasonCode: REASON.ADMIN_REQUEST, snapshotVersion: version, backupRequired: !!backup, files: backup?.files.length ?? 0, reused: false },
          },
        });
      }, { timeout: this.ports.transactionTimeoutMs, maxWait: MAX_TX_WAIT_MS });

      return this.operationView(await this.prisma.userLifecycleOperation.findUniqueOrThrow({ where: { id: op.id } }));
    } catch (err: any) {
      const code: ReasonCode = err instanceof LifecycleRefusal ? err.code : err instanceof FolderNotPrivate ? REASON.ARCHIVE_PRIVACY_FAILED : REASON.ARCHIVE_DB_FAILED;
      const privacy = err instanceof FolderNotPrivate ? err.safeDetails() : undefined;
      const cleanupFailed = await this.discardPendingArchive(drive);
      await this.finishOperation(op.id, cleanupFailed ? OPERATION_STATE.ARCHIVE_CLEANUP_PENDING : OPERATION_STATE.FAILED, {
        reasonCode: code,
        ...(privacy ?? {}),
        ...(cleanupFailed ? { pendingFolderId: drive.folderId } : {}),
      });
      if (privacy) this.logger.warn(`Verified archive operation ${op.id} blocked: ${privacy.privacyIssue} at ${privacy.folderPath}`);
      else if (!(err instanceof LifecycleRefusal)) {
        this.logger.error(`Verified archive operation ${op.id} failed: ${String(err?.message ?? err).split('\n')[0].slice(0, 200)}`);
      }
      const remediation = this.remediationFor(code, { userId, operationId: op.id, details: privacy, retryEndpoint: cleanupFailed ? 'LIFECYCLE_ARCHIVE_CLEANUP_RETRY' : undefined });
      if (remediation) await recordLifecycleAttempt(this.prisma, { operationId: op.id, subjectUserId: userId, phase: 'FAILURE', outcome: 'BLOCKED', actorId: actor.id, remediation });
      throw this.toHttp(err, code, undefined, remediation);
    }
  }

  /** Whether the archive vault is configured here. Reads configuration only; never contacts the provider. */
  private archiveVaultConfigured(): boolean {
    const environment = this.environment();
    if (environment !== 'staging' && environment !== 'production') return false;
    try {
      readDriveConfig(this.ports.env(), environment);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Archive. Nothing about the user changes until the backup is verified, and
   * no database transaction is open while talking to Google Drive or a file
   * provider:
   *
   *   1. BACKUP (no transaction): blockers, inventory, no-history decision,
   *      fingerprint and the exact closure plan; with history, write the archive
   *      folder (workbook, including an "Archive Closures" sheet, and a copy of
   *      every file) and read every byte back. The in-flight operation row keeps
   *      rehire, deletion and a second archive out. A failure here changes
   *      nothing about the user.
   *   2. COMMIT (one short transaction): re-lock and re-check; the fingerprint
   *      and the closure plan must both equal what the archive was built from,
   *      else ARCHIVE_DATA_CHANGED. Then close or re-home live work as planned,
   *      make the user inactive, revoke sessions, and write the snapshot and
   *      USER_ARCHIVED. Any failure rolls all of it back.
   *
   * The snapshot keeps two fingerprints: the backup's (matches the workbook)
   * and the one after the closures (what permanent delete compares against).
   */
  async archive(userId: string, actor: Actor, input: { idempotencyKey?: string }) {
    const idempotencyKey = this.validIdempotencyKey(input?.idempotencyKey);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    this.assertTarget(user, actor);
    if (await this.archivedAt(this.prisma, userId)) {
      const replay = await this.prisma.userLifecycleOperation.findUnique({ where: { idempotencyKey } });
      if (replay) return this.operationView(replay);
      throw new ConflictException({ code: REASON.ALREADY_ARCHIVED, message: 'This user is already archived.' });
    }
    const pending = await this.inflight(this.prisma, userId);
    if (pending?.state === OPERATION_STATE.ARCHIVE_CLEANUP_PENDING) {
      throw new ConflictException({ code: REASON.ARCHIVE_CLEANUP_PENDING, message: 'A failed archive is still being cleaned up. Retry its cleanup first.', operationId: pending.id });
    }
    const { op, replay } = await this.startOperation(OPERATION_KIND.ARCHIVE, userId, actor.id, idempotencyKey);
    if (replay) return this.operationView(op);

    // One effective time for the whole operation: the closure plan in the
    // workbook and the closures applied later carry the same timestamp.
    const now = this.ports.now();
    const environment = this.environment();
    const drive: { vault?: ArchiveVault; folderId?: string } = {};
    const ctx: MatrixContext = { systemUserId: DELETED_ACCOUNT.id, operationId: op.id, now };

    try {
      // ── Phase 1: backup, nothing changed yet ─────────────────────────────
      const blockers = await this.responsibilityBlockers(this.prisma, userId, user!.employeeId ?? null, now);
      if (Object.keys(blockers).length > 0) {
        throw new LifecycleRefusal(REASON.ACTIVE_RESPONSIBILITIES, 'This user still has responsibilities that must be handed over before archiving.', blockers);
      }
      const inv = await collectInventory(this.prisma, userId, ctx);
      const history = classifyNoHistory(inv);
      const backupFingerprint = dataFingerprint(inv);
      const closures = await this.closurePlan(this.prisma, userId, now);
      const previous = await this.prisma.userArchiveSnapshot.aggregate({ where: { userId }, _max: { version: true } });
      const version = (previous._max.version ?? 0) + 1;
      const archiveRef = opaqueId();
      const snapshotId = opaqueId();
      let backup: Awaited<ReturnType<UserLifecycleService['writeArchive']>> | null = null;
      if (!history.noHistory) {
        backup = await this.writeArchive(this.prisma, inv, { archiveRef, version, environment, operationId: op.id, classificationVersion: history.classificationVersion, fingerprint: backupFingerprint, now, closures: closures.rows }, drive);
      }

      // ── Phase 2: one short transaction, all or nothing ───────────────────
      let afterCommit: Array<() => unknown> = [];
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "users" WHERE id = ${userId} FOR UPDATE`;
        const current = await tx.userLifecycleOperation.findUnique({ where: { id: op.id } });
        if (!current || current.state !== OPERATION_STATE.RUNNING) throw new LifecycleRefusal(REASON.OPERATION_IN_PROGRESS, 'The archive operation is no longer running.');
        const locked = await tx.user.findUnique({ where: { id: userId } });
        if (!locked) throw new LifecycleRefusal(REASON.NOT_FOUND, 'User not found.');
        if (await this.archivedAt(tx, userId)) throw new LifecycleRefusal(REASON.ALREADY_ARCHIVED, 'This user is already archived.');
        const blockersNow = await this.responsibilityBlockers(tx, userId, locked.employeeId ?? null, now);
        if (Object.keys(blockersNow).length > 0) {
          throw new LifecycleRefusal(REASON.ACTIVE_RESPONSIBILITIES, 'This user still has responsibilities that must be handed over before archiving.', blockersNow);
        }
        const changed = () => new LifecycleRefusal(REASON.ARCHIVE_DATA_CHANGED, 'This user\'s data changed while the archive was being written. Nothing was changed; try again.');
        if (dataFingerprint(await collectInventory(tx, userId, ctx)) !== backupFingerprint) throw changed();
        const plan = await this.closurePlan(tx, userId, now);
        if (plan.sha256 !== closures.sha256) throw changed();

        const fromState = locked.isActive ? 'ACTIVE' : 'DEACTIVATED';
        const work = await this.activeWork(tx, userId);
        await this.writeEvent(tx, { actorId: actor.id, entityType: 'User', entityId: userId, action: LIFECYCLE_EVENT.ARCHIVE_PREFLIGHT_COMPLETED, fromState, toState: fromState, reasonCode: REASON.ADMIN_REQUEST, operationId: op.id, counts: work.summary });
        if (backup) {
          await this.writeEvent(tx, { actorId: actor.id, entityType: 'User', entityId: userId, action: LIFECYCLE_EVENT.ARCHIVE_BACKUP_VERIFIED, fromState, toState: fromState, reasonCode: REASON.USER_ARCHIVED, operationId: op.id, snapshotVersion: version, counts: { files: backup.files.length } });
        } else {
          await this.writeEvent(tx, { actorId: actor.id, entityType: 'User', entityId: userId, action: LIFECYCLE_EVENT.ARCHIVE_NO_HISTORY_VERIFIED, fromState, toState: fromState, reasonCode: REASON.USER_ARCHIVED, operationId: op.id, snapshotVersion: version });
        }

        // Close or re-home live work, exactly as planned and recorded in the workbook.
        const ticketResult = await this.tickets.applyArchiveTicketChanges(tx, plan.tickets, userId, actor, op.id);
        afterCommit = ticketResult.afterCommit;
        for (const sessionId of plan.sessions) {
          const closed = await this.workday.finalizeWorkSessionInTransaction(tx, sessionId, {
            effectiveEndAt: now,
            terminalStatus: 'AUTO_CLOSED',
            closureReason: 'USER_ARCHIVED',
            autoClosedAt: now,
            eventSource: 'system',
            attendanceEventType: 'USER_ARCHIVED',
            ticketPauseReason: 'SYSTEM',
          });
          if (closed.didClose) {
            await tx.attendanceEvent.create({ data: { userId, workSessionId: sessionId, eventType: 'USER_ARCHIVED', source: 'system', metadata: { operationId: op.id } } });
          }
        }
        // Any break left open outside a session (defensive) ends at the same time.
        await tx.breakLog.updateMany({ where: { userId, endAt: null }, data: { endAt: now, reason: 'USER_ARCHIVED' } });
        for (const leaveId of plan.leave) {
          await tx.leaveRequest.update({ where: { id: leaveId }, data: { status: 'CANCELLED' } });
          await tx.operationalEvent.create({
            data: { actorId: actor.id, entityType: 'LeaveRequest', entityId: leaveId, action: 'LEAVE_CANCELLED', fromState: 'PENDING', toState: 'CANCELLED', metadata: { reasonCode: REASON.USER_ARCHIVED, operationId: op.id, eventSchemaVersion: LIFECYCLE_EVENT_SCHEMA_VERSION } },
          });
        }
        await tx.pushSubscription.deleteMany({ where: { userId } });
        const closureCounts = { ...ticketResult.counts, sessionsEnded: plan.sessions.length, leaveCancelled: plan.leave.length };
        await this.writeEvent(tx, { actorId: actor.id, entityType: 'User', entityId: userId, action: LIFECYCLE_EVENT.ACTIVE_WORK_CLOSED_FOR_ARCHIVE, fromState, toState: fromState, reasonCode: REASON.USER_ARCHIVED, operationId: op.id, counts: closureCounts });
        await tx.user.update({ where: { id: userId }, data: { isActive: false, currentStatus: 'LOGGED_OUT', sessionsRevokedAt: now } });
        // Phase 3: the attendance profile ends on the archive date, so no
        // profile covers the archived gap. A rehire opens a new one.
        await closeProfilesAt(tx, userId, companyDateOf(now), actor.id);

        // What permanent delete will compare against: the data after the closures.
        const settled = dataFingerprint(await collectInventory(tx, userId, ctx));
        await tx.userArchiveSnapshot.create({
          data: {
            id: snapshotId,
            userId,
            archiveRef,
            version,
            status: backup ? SNAPSHOT_STATUS.VERIFIED : SNAPSHOT_STATUS.NO_HISTORY_VERIFIED,
            backupRequired: !!backup,
            provider: backup ? 'google-drive' : null,
            environment,
            folderId: backup?.folderId ?? null,
            folderPath: backup?.folderPath ?? null,
            workbookFileId: backup?.workbookFileId ?? null,
            workbookSizeBytes: backup?.workbookSizeBytes ?? null,
            workbookSha256: backup?.workbookSha256 ?? null,
            fileCount: backup?.files.length ?? 0,
            schemaVersion: ARCHIVE_SCHEMA_VERSION,
            classificationVersion: history.classificationVersion,
            dataFingerprint: settled,
            backupFingerprint,
            dependencyCounts: history.historyCounts,
            ignoredSetupCounts: history.ignoredSetupCounts,
            operationId: op.id,
            createdById: actor.id,
            verifiedAt: now,
          },
        });
        if (backup && backup.files.length > 0) {
          await tx.userArchiveFile.createMany({
            data: backup.files.map((f) => ({
              snapshotId,
              seq: f.seq,
              provider: f.provider,
              shared: f.shared,
              archiveFileId: f.archiveFileId,
              archivePath: `files/${f.archiveFileName}`,
              sizeBytes: f.sizeBytes,
              sha256: f.sha256,
              sourceCount: f.sources.length,
            })),
          });
        }
        await this.writeEvent(tx, { actorId: actor.id, entityType: 'User', entityId: userId, action: LIFECYCLE_EVENT.USER_ARCHIVED, fromState, toState: 'ARCHIVED', reasonCode: REASON.USER_ARCHIVED, operationId: op.id, snapshotVersion: version, counts: closureCounts });
        await tx.userLifecycleOperation.update({
          where: { id: op.id },
          data: { state: OPERATION_STATE.COMPLETED, snapshotId, result: { reasonCode: REASON.USER_ARCHIVED, snapshotVersion: version, backupRequired: !!backup, files: backup?.files.length ?? 0, ...closureCounts } },
        });
      }, { timeout: this.ports.transactionTimeoutMs, maxWait: MAX_TX_WAIT_MS });
      try {
        await this.tickets.runArchiveAfterCommit(afterCommit);
      } catch {
        // Ticket notifications are side effects of the committed closures.
      }

      return this.operationView(await this.prisma.userLifecycleOperation.findUniqueOrThrow({ where: { id: op.id } }));
    } catch (err: any) {
      const code: ReasonCode = err instanceof LifecycleRefusal ? err.code : err instanceof FolderNotPrivate ? REASON.ARCHIVE_PRIVACY_FAILED : REASON.ARCHIVE_DB_FAILED;
      const privacy = err instanceof FolderNotPrivate ? err.safeDetails() : undefined;
      const cleanupFailed = await this.discardPendingArchive(drive);
      await this.finishOperation(
        op.id,
        cleanupFailed ? OPERATION_STATE.ARCHIVE_CLEANUP_PENDING : OPERATION_STATE.FAILED,
        { reasonCode: code, ...(privacy ?? {}), ...(cleanupFailed ? { pendingFolderId: drive.folderId } : {}) },
      );
      // Only the category and the path inside the archive tree are logged: never a Drive id or who it is shared with.
      if (privacy) this.logger.warn(`Archive operation ${op.id} blocked: ${privacy.privacyIssue} at ${privacy.folderPath}`);
      else if (!(err instanceof LifecycleRefusal)) {
        this.logger.error(`Archive operation ${op.id} failed: ${String(err?.message ?? err).split('\n')[0].slice(0, 200)}`);
      }
      const remediation = this.remediationFor(code, { userId, operationId: op.id, details: privacy, retryEndpoint: cleanupFailed ? 'LIFECYCLE_ARCHIVE_CLEANUP_RETRY' : undefined });
      if (remediation) await recordLifecycleAttempt(this.prisma, { operationId: op.id, subjectUserId: userId, phase: 'FAILURE', outcome: 'BLOCKED', actorId: actor.id, remediation });
      throw this.toHttp(err, code, undefined, remediation);
    }
  }

  /**
   * Exactly what archiving closes: tickets (close, re-home, unassign, unwatch),
   * open sessions, pending own leave, push subscriptions, all at `at`. Written
   * into the workbook before anything changes and re-derived under the row
   * lock; the two must hash the same or the archive is refused.
   */
  private async closurePlan(db: any, userId: string, at: Date) {
    const { plan: tickets } = await this.activeWork(db, userId);
    const sessions = (await db.workSession.findMany({ where: { userId, logoutAt: null, status: { notIn: ['LOGGED_OUT', 'AUTO_CLOSED'] } }, select: { id: true }, orderBy: { id: 'asc' } })).map((s: any) => s.id as string);
    const breaks = (await db.breakLog.findMany({ where: { userId, endAt: null }, select: { id: true }, orderBy: { id: 'asc' } })).map((b: any) => b.id as string);
    const leave = (await db.leaveRequest.findMany({ where: { userId, status: 'PENDING' }, select: { id: true }, orderBy: { id: 'asc' } })).map((l: any) => l.id as string);
    const pushSubscriptions = await db.pushSubscription.count({ where: { userId } });
    const effectiveAt = at.toISOString();
    const rows: Record<string, unknown>[] = [
      ...tickets.close.map((id) => ({ action: 'TICKET_CLOSED', entity: 'Ticket', id, detail: 'sole assignee', effectiveAt })),
      ...tickets.promote.map((p) => ({ action: 'TICKET_REASSIGNED', entity: 'Ticket', id: p.ticketId, detail: 'primary moved to the earliest active co-assignee', effectiveAt })),
      ...tickets.remove.map((r) => ({ action: r.closeAfter ? 'TICKET_UNASSIGNED_AND_CLOSED' : 'TICKET_UNASSIGNED', entity: 'Ticket', id: r.ticketId, detail: 'co-assignee removed', effectiveAt })),
      ...tickets.unwatch.map((id) => ({ action: 'TICKET_UNWATCHED', entity: 'Ticket', id, detail: 'watcher removed', effectiveAt })),
      ...sessions.map((id: string) => ({ action: 'SESSION_ENDED', entity: 'WorkSession', id, detail: 'AUTO_CLOSED, closureReason USER_ARCHIVED', effectiveAt })),
      ...breaks.map((id: string) => ({ action: 'BREAK_ENDED', entity: 'BreakLog', id, detail: 'reason USER_ARCHIVED', effectiveAt })),
      ...leave.map((id: string) => ({ action: 'LEAVE_CANCELLED', entity: 'LeaveRequest', id, detail: 'PENDING to CANCELLED', effectiveAt })),
      ...(pushSubscriptions > 0 ? [{ action: 'PUSH_SUBSCRIPTIONS_DELETED', entity: 'PushSubscription', id: '', detail: `${pushSubscriptions} removed`, effectiveAt }] : []),
      { action: 'USER_DEACTIVATED_AND_SIGNED_OUT', entity: 'User', id: '', detail: 'isActive false, sessions revoked', effectiveAt },
    ];
    const sha256 = createHash('sha256').update(canonical(rows)).digest('hex');
    return { tickets, sessions, leave, rows, sha256 };
  }

  /** Removes an unverified archive folder after a failure. Returns true when removal could not be confirmed. */
  private async discardPendingArchive(drive: { vault?: ArchiveVault; folderId?: string }): Promise<boolean> {
    if (!drive.vault || !drive.folderId) return false;
    try {
      await drive.vault.remove(drive.folderId);
      const left = await drive.vault.stat(drive.folderId);
      return !!left && !left.trashed;
    } catch {
      return true;
    }
  }

  async retryArchiveCleanup(operationId: string, actor: Actor) {
    const op = await this.prisma.userLifecycleOperation.findUnique({ where: { id: operationId } });
    if (!op || op.kind !== OPERATION_KIND.ARCHIVE) throw new NotFoundException('Operation not found');
    if (op.state !== OPERATION_STATE.ARCHIVE_CLEANUP_PENDING) return this.operationView(op);
    const folderId = (op.result as any)?.pendingFolderId as string | undefined;
    const vault = this.archiveVault(this.environment());
    let done = !folderId;
    if (folderId) {
      try {
        const existing = await vault.stat(folderId);
        if (existing && !existing.trashed) await vault.remove(folderId);
        const left = await vault.stat(folderId);
        done = !left || left.trashed;
      } catch {
        done = false;
      }
    }
    if (!done) throw new ServiceUnavailableException({ code: REASON.CLEANUP_FAILED, message: 'The unfinished archive could not be removed yet. Try again later.' });
    await this.finishOperation(op.id, OPERATION_STATE.FAILED, { reasonCode: (op.result as any)?.reasonCode ?? REASON.ARCHIVE_DB_FAILED, archiveCleanup: 'DONE' });
    void actor;
    return this.operationView(await this.prisma.userLifecycleOperation.findUniqueOrThrow({ where: { id: op.id } }));
  }

  /**
   * Retry Verification for ARCHIVE_PRIVACY_FAILED: a read-only check of the
   * archive account, the root and the existing part of
   * <environment>/archived-users/<year>. It never archives, deactivates or
   * otherwise changes the user, never creates a folder and never removes
   * sharing. Ready storage does not archive anything: the person confirms
   * Archive again, and Archive repeats every check itself.
   */
  async verifyArchiveStorage(userId: string, actor: Actor, input: { operationId?: string } = {}): Promise<{ ready: boolean; remediation: RemediationResult }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    this.assertTarget(user, actor);
    const op = typeof input?.operationId === 'string'
      ? await this.prisma.userLifecycleOperation.findUnique({ where: { id: input.operationId } })
      : null;
    const operationId = op && op.userId === userId && op.kind === OPERATION_KIND.ARCHIVE ? op.id : undefined;
    const environment = this.environment();
    const year = String(this.ports.now().getUTCFullYear());

    let remediation: RemediationResult;
    let ready = false;
    try {
      const vault = this.archiveVault(environment);
      const who = await vault.account();
      if (!isArchiveAccount(who.email, vault.identity().account)) {
        throw new LifecycleRefusal(REASON.ARCHIVE_VAULT_NOT_READY, 'Google Drive is signed in as a different account from the configured archive account.');
      }
      await inspectArchiveStorage(vault, environment, ['archived-users', year]);
      ready = true;
      remediation = buildRemediation('ARCHIVE_STORAGE_READY', { affectedUserId: userId, operationId, now: this.ports.now() });
    } catch (err: any) {
      if (err instanceof FolderNotPrivate) {
        remediation = this.remediationFor(REASON.ARCHIVE_PRIVACY_FAILED, { userId, operationId, details: err.safeDetails(), retryEndpoint: 'ARCHIVE_STORAGE_VERIFY' })!;
      } else if (err instanceof LifecycleRefusal || err instanceof DriveRefused) {
        remediation = this.remediationFor(REASON.ARCHIVE_VAULT_NOT_READY, { userId, operationId })!;
      } else {
        throw err;
      }
    }
    if (operationId) {
      await recordLifecycleAttempt(this.prisma, {
        operationId,
        subjectUserId: userId,
        phase: 'VERIFICATION',
        outcome: ready ? 'PASSED' : 'BLOCKED',
        actorId: actor.id,
        remediation,
      });
    }
    return { ready, remediation };
  }

  private archiveVault(environment: string): ArchiveVault {
    if (environment !== 'staging' && environment !== 'production') {
      throw new LifecycleRefusal(REASON.ARCHIVE_VAULT_NOT_READY, 'User archives are stored in Google Drive only from staging or production.');
    }
    let config: DriveConfig;
    try {
      config = readDriveConfig(this.ports.env(), environment);
    } catch (err) {
      if (err instanceof DriveRefused) {
        throw new LifecycleRefusal(REASON.ARCHIVE_VAULT_NOT_READY, `The Google Drive archive vault is not ready: ${err.message.replace(/^Google Drive archive vault refused: /, '')}`);
      }
      throw err;
    }
    return this.ports.makeArchiveVault(config);
  }

  /**
   * Writes and verifies a new archive folder:
   *   Apex OS Secure Archives/<env>/archived-users/<yyyy>/<archiveRef>/{records.xlsx, files/}
   * Every file is read back and compared before the workbook is written; the
   * workbook is read back too. Throws on any mismatch.
   */
  private async writeArchive(
    db: any,
    inv: Inventory,
    meta: { archiveRef: string; version: number; environment: string; operationId: string; classificationVersion: string; fingerprint: string; now: Date; closures?: Record<string, unknown>[] },
    drive: { vault?: ArchiveVault; folderId?: string },
  ) {
    const vault = this.archiveVault(meta.environment);
    drive.vault = vault;
    const identity = vault.identity();
    const who = await vault.account();
    if (!isArchiveAccount(who.email, identity.account)) {
      throw new LifecycleRefusal(REASON.ARCHIVE_VAULT_NOT_READY, 'Google Drive is signed in as a different account from the configured archive account.');
    }
    const year = String(meta.now.getUTCFullYear());
    // The root alone first: a new environment has no <environment> folder yet,
    // and that is not a privacy failure. Nothing is created under a root that
    // fails, and every folder is verified before anything is created inside it.
    await verifyArchiveRoot(vault, meta.environment);
    const yearId = await ensureVerifiedFolderChain(vault, meta.environment, ['archived-users', year]);
    await verifyFolderChain(vault, meta.environment, ['archived-users', year]);
    if ((await vault.findChildFolders(yearId, meta.archiveRef)).length > 0) {
      throw new LifecycleRefusal(REASON.ARCHIVE_VERIFY_FAILED, 'An archive folder with this reference already exists.');
    }
    const folderId = await vault.ensureFolder(meta.environment, ['archived-users', year, meta.archiveRef]);
    drive.folderId = folderId;
    await vault.setAppProperties(folderId, { apexArchiveKind: 'archived-user', apexArchiveRef: meta.archiveRef, apexArchiveState: 'pending' });
    const filesFolderId = await vault.ensureFolder(meta.environment, ['archived-users', year, meta.archiveRef, 'files']);
    await verifyFolderChain(vault, meta.environment, ['archived-users', year, meta.archiveRef, 'files']);
    const folderPath = `${DRIVE_ROOT_NAME}/${meta.environment}/archived-users/${year}/${meta.archiveRef}`;

    const store = this.ports.makeFileStore();
    const cloudName = this.ports.env().CLOUDINARY_CLOUD_NAME;
    const objects = collectFileObjects(inv, cloudName);
    await markShared(db, inv.subject.id, objects, cloudName);

    const dir = mkdtempSync(join(tmpdir(), 'apex-archive-'));
    try {
      const uploadVerified = async (folder: string, name: string, bytes: Buffer, labels: Record<string, string>) => {
        const local = join(dir, 'upload.bin');
        writeFileSync(local, bytes, { mode: 0o600 });
        const sha = createHash('sha256').update(bytes).digest('hex');
        const up = await vault.upload(folder, name, local, { ...labels, apexArchiveEnvironment: meta.environment, apexArchiveRef: meta.archiveRef, sha256: sha });
        const info = await vault.stat(up.fileId);
        if (!info || info.trashed || !info.parents.includes(folder) || info.driveId) throw new LifecycleRefusal(REASON.ARCHIVE_VERIFY_FAILED, 'An archived file is not where it was written.');
        if (info.size !== bytes.length) throw new LifecycleRefusal(REASON.ARCHIVE_VERIFY_FAILED, 'An archived file has the wrong size.');
        if (!(await vault.isPrivate(up.fileId))) {
          throw new FolderNotPrivate(folder === folderId ? folderPath : `${folderPath}/files`, 'a file uploaded to it is shared beyond the archive account', 'UPLOADED_FILE_NOT_PRIVATE');
        }
        const back = join(dir, 'readback.bin');
        await vault.download(up.fileId, back);
        if (createHash('sha256').update(readFileSync(back)).digest('hex') !== sha) throw new LifecycleRefusal(REASON.ARCHIVE_VERIFY_FAILED, 'An archived file did not read back identically.');
        return { fileId: up.fileId, sha, size: bytes.length };
      };

      const files: (ArchivedFileEntry & { archiveFileId: string })[] = [];
      let seq = 0;
      for (const obj of objects) {
        seq++;
        let got: { bytes: Buffer; mimeType: string | null };
        try {
          got = await store.read(obj);
        } catch {
          throw new LifecycleRefusal(REASON.ARCHIVE_FILE_UNREADABLE, 'A file belonging to this user could not be read, so it could not be archived.');
        }
        const sha = createHash('sha256').update(got.bytes).digest('hex');
        const name = archiveFileName(seq, sha, got.mimeType ?? obj.mimeType);
        const up = await uploadVerified(filesFolderId, name, got.bytes, { apexArchiveKind: 'archived-user-file' });
        files.push({
          seq,
          archiveFileName: name,
          archiveFileId: up.fileId,
          provider: obj.provider,
          shared: obj.shared,
          cleanupEligible: obj.cleanupEligible && !obj.shared,
          sizeBytes: up.size,
          sha256: sha,
          mimeType: got.mimeType ?? obj.mimeType,
          ref: obj.ref,
          sources: obj.sources,
        });
      }

      const built = await buildArchiveWorkbook(inv, files, {
        archiveRef: meta.archiveRef,
        version: meta.version,
        environment: meta.environment,
        operationId: meta.operationId,
        classificationVersion: meta.classificationVersion,
        noHistory: false,
        dataFingerprint: meta.fingerprint,
        generatedAt: meta.now,
        closures: meta.closures,
      });
      const wb = await uploadVerified(folderId, 'records.xlsx', built.buffer, { apexArchiveKind: 'archived-user-records' });

      await verifyFolderChain(vault, meta.environment, ['archived-users', year, meta.archiveRef, 'files']);
      await vault.setAppProperties(folderId, { apexArchiveState: 'verified' });
      return { folderId, folderPath, workbookFileId: wb.fileId, workbookSizeBytes: wb.size, workbookSha256: wb.sha, files, sheetRows: built.sheetRows };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // Archived-user status (cards)
  // ════════════════════════════════════════════════════════════════════════

  /** Cheap per-user status for archived cards. No Drive access. */
  async archivedStatus(userIds: string[]) {
    const ids = [...new Set(userIds)].slice(0, 500);
    const [snapshots, ops, holds] = await Promise.all([
      this.prisma.userArchiveSnapshot.findMany({ where: { userId: { in: ids }, status: { in: USABLE_SNAPSHOT_STATUSES } }, select: { userId: true, status: true, version: true, backupRequired: true } }),
      this.prisma.userLifecycleOperation.findMany({ where: { userId: { in: ids }, state: { in: [OPERATION_STATE.RUNNING, OPERATION_STATE.VERIFIED_FOR_DELETE, OPERATION_STATE.ARCHIVE_CLEANUP_PENDING] } }, select: { userId: true, kind: true, state: true } }),
      this.prisma.userLegalHold.findMany({ where: { userId: { in: ids }, ...activeHoldWhere() }, select: { userId: true, status: true, releasedAt: true } }),
    ]);
    const keysConfigured = !!readHandleKeys(this.ports.env());
    return ids.map((id) => {
      const s = snapshots.find((x) => x.userId === id);
      const o = ops.find((x) => x.userId === id);
      return {
        userId: id,
        snapshotStatus: s?.status ?? null,
        snapshotVersion: s?.version ?? null,
        backupRequired: s?.backupRequired ?? null,
        verificationAvailable: !!s,
        operationInProgress: o ? { kind: o.kind, state: o.state } : null,
        holdStatus: strongestHold(holds.filter((h: any) => h.userId === id)),
        // Global readiness, so each archived card can say why Delete is unavailable.
        deletionKeysConfigured: keysConfigured,
      };
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // Permanent delete
  // ════════════════════════════════════════════════════════════════════════

  /**
   * The retention gate. Legal holds are evaluated separately (erratum E2), so
   * a hold is reported as LEGAL_HOLD_* rather than as a retention block; pass
   * includeHolds to get the combined result shown on the preflight.
   */
  private async retentionFor(db: any, inv: Inventory, now: Date, includeHolds = true): Promise<RetentionEvaluation> {
    const dates: Record<string, Date[]> = { ATTENDANCE: [], LEAVE: [], PAYROLL: [] };
    for (const h of HANDLERS) {
      if (!h.retention) continue;
      for (const row of inv.rows[h.key] ?? []) dates[h.retention].push(protectedRowDate(row));
    }
    const attendanceDays = (inv.rows['DailyAttendance.userId'] ?? []).map((r: any) => protectedRowDate(r).toISOString().slice(0, 7));
    if (attendanceDays.length > 0) {
      const closed = await db.attendanceMonthClose.findMany({ where: { month: { in: [...new Set(attendanceDays)] }, status: 'FINALIZED' }, select: { month: true } });
      for (const c of closed) {
        const [y, m] = c.month.split('-').map(Number);
        dates.PAYROLL.push(new Date(Date.UTC(y, m, 0)));
      }
    }
    const [rules, holds, defaultDeny] = await Promise.all([
      db.retentionRule.findMany({ select: { category: true, retentionMonths: true, active: true, approvedAt: true, status: true, noExpiry: true, policyReference: true } }),
      includeHolds ? db.userLegalHold.count({ where: { userId: inv.subject.id, ...activeHoldWhere() } }) : Promise.resolve(0),
      retentionDefaultDeny(db),
    ]);
    return evaluateRetention({ protectedDates: dates as any, rules, activeLegalHolds: holds, now, defaultDeny });
  }

  /** Re-verifies the existing archive in Drive. Reads only; never uploads. Returns the cleanup plan. */
  private async verifyExistingArchive(snapshot: any, files: any[]) {
    const vault = this.archiveVault(snapshot.environment);
    const identity = vault.identity();
    const who = await vault.account();
    if (!isArchiveAccount(who.email, identity.account)) throw new LifecycleRefusal(REASON.ARCHIVE_MISSING_OR_CHANGED, 'Google Drive is signed in as a different account.');
    const year = String(snapshot.folderPath ?? '').split('/').slice(-2, -1)[0];
    await verifyFolderChain(vault, snapshot.environment, ['archived-users', year, snapshot.archiveRef, 'files']);
    const dir = mkdtempSync(join(tmpdir(), 'apex-archive-verify-'));
    try {
      const check = async (fileId: string, parent: string | null, size: number, sha: string) => {
        const info = await vault.stat(fileId);
        if (!info || info.trashed || info.driveId || (parent && !info.parents.includes(parent)) || info.size !== size) {
          throw new LifecycleRefusal(REASON.ARCHIVE_MISSING_OR_CHANGED, 'The existing archive is missing or has changed.');
        }
        if (!(await vault.isPrivate(fileId))) throw new LifecycleRefusal(REASON.ARCHIVE_MISSING_OR_CHANGED, 'The existing archive is shared beyond the archive account.');
        const local = join(dir, 'verify.bin');
        await vault.download(fileId, local);
        const bytes = readFileSync(local);
        if (createHash('sha256').update(bytes).digest('hex') !== sha) throw new LifecycleRefusal(REASON.ARCHIVE_MISSING_OR_CHANGED, 'The existing archive no longer matches its checksum.');
        return bytes;
      };
      const workbook = await check(snapshot.workbookFileId, snapshot.folderId, snapshot.workbookSizeBytes, snapshot.workbookSha256);
      for (const f of files) await check(f.archiveFileId, null, f.sizeBytes, f.sha256);
      const sheet = await readFilesSheet(workbook);
      if (String(sheet.manifest.archiveRef) !== snapshot.archiveRef || String(sheet.manifest.dataFingerprint) !== (snapshot.backupFingerprint ?? snapshot.dataFingerprint)) {
        throw new LifecycleRefusal(REASON.ARCHIVE_MISSING_OR_CHANGED, 'The existing archive does not belong to this snapshot.');
      }
      // Original references come from the private workbook, never from the database.
      const plan = new Map<string, { provider: string; ref: string }>();
      for (const row of sheet.files) {
        if (row.cleanupEligible === true && row.shared === false && typeof row.originalReference === 'string') {
          plan.set(String(row.originalReference), { provider: String(row.provider), ref: String(row.originalReference) });
        }
      }
      return [...plan.values()];
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  async deletePreflight(userId: string, actor: Actor): Promise<DeletePreflight> {
    const reasons: DeletePreflight['reasons'] = [];
    const refuse = (code: ReasonCode, message: string) => reasons.push({ code, message });
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    this.assertTarget(user, actor);
    const archived = await this.archivedAt(this.prisma, userId);
    const snapshot = await this.prisma.userArchiveSnapshot.findFirst({ where: { userId, status: { in: USABLE_SNAPSHOT_STATUSES } }, include: { files: true } });
    const out: DeletePreflight = {
      userId,
      allowed: false,
      reasons,
      snapshot: { status: snapshot?.status ?? null, version: snapshot?.version ?? null, verificationAvailable: !!snapshot, backupRequired: snapshot?.backupRequired ?? null },
      retention: null,
      verifiedArchive: false,
      cleanupObjects: 0,
      holdStatus: null,
      remediation: null,
      warnings: [],
    };
    const finish = () => {
      // Precedence (E2): legal hold, then missing keys, then ordinary retention, then the rest.
      const codes = reasons.map((r) => REMEDIATION_CODE_FOR_REASON[r.code] ?? r.code);
      const { primary, others } = pickByPrecedence(codes);
      const reason = reasons.find((r) => (REMEDIATION_CODE_FOR_REASON[r.code] ?? r.code) === primary);
      out.remediation = reason
        ? this.remediationFor(reason.code, {
            userId,
            details: {
              ...(out.holdStatus ? { holdStatus: out.holdStatus } : {}),
              ...(others.length ? { otherBlockers: others } : {}),
              ...(out.retention ? { retentionResult: out.retention.result } : {}),
              ...(reason.code === REASON.HANDLE_KEYS_MISSING ? { keyConfigurationIssues: handleKeyConfigurationIssues(this.ports.env()) } : {}),
              ...(reason.code === REASON.RETENTION_BLOCKED ? this.retentionDetails(out.retention, REASON.PERIOD_NOT_ELAPSED) : {}),
              ...(reason.code === REASON.RETENTION_POLICY_REQUIRED ? this.retentionDetails(out.retention, REASON.RETENTION_POLICY_REQUIRED) : {}),
            },
            // Archive repair runs the rebuild; everything else re-runs this preflight.
            retryEndpoint: REMEDIATION_CODE_FOR_REASON[reason.code]?.startsWith('ARCHIVE_SNAPSHOT_') ? 'VERIFIED_ARCHIVE_PREPARE' : 'PERMANENT_DELETE_PREFLIGHT',
          })
        : null;
      const unconfigured = this.retentionDetails(out.retention, REASON.POLICY_NOT_CONFIGURED);
      if (unconfigured.retentionCategories) {
        out.warnings = [buildRemediation('RETENTION_POLICY_NOT_CONFIGURED', { affectedUserId: userId, details: { retentionCategories: unconfigured.retentionCategories }, now: this.ports.now() })];
      }
      out.allowed = reasons.length === 0;
      return out;
    };
    out.holdStatus = await this.holdStatusFor(this.prisma, userId);
    if (user!.isActive || !archived) {
      refuse(REASON.NOT_ARCHIVED, 'Only archived users can be permanently deleted.');
      return finish();
    }
    if (!snapshot) {
      refuse(REASON.SNAPSHOT_MISSING, 'Backup verification unavailable: no verified archive exists yet. Prepare a verified archive before deleting.');
      return finish();
    }
    if (snapshot.environment !== this.environment()) refuse(REASON.SNAPSHOT_WRONG_ENVIRONMENT, 'The archive belongs to a different environment.');
    if (await this.inflight(this.prisma, userId)) refuse(REASON.OPERATION_IN_PROGRESS, 'Another archive, rehire or deletion is running for this user.');
    const now = this.ports.now();
    const inv = await collectInventory(this.prisma, userId, { systemUserId: DELETED_ACCOUNT.id, operationId: null, now });
    if (dataFingerprint(inv) !== snapshot.dataFingerprint) refuse(REASON.SNAPSHOT_STALE, 'This user\'s data changed after archiving. Rebuild the verified archive before deleting.');
    if (snapshot.status === SNAPSHOT_STATUS.NO_HISTORY_VERIFIED && !classifyNoHistory(inv).noHistory) {
      refuse(REASON.NO_HISTORY_NO_LONGER_EMPTY, 'This user now has history. Rebuild the verified archive before deleting.');
    }
    const work = await this.activeWork(this.prisma, userId);
    if (Object.values(work.summary).some((n) => n > 0)) refuse(REASON.NEW_ACTIVE_WORK, 'This user has active work again. Archive them again before deleting.');
    const retention = await this.retentionFor(this.prisma, inv, now);
    out.retention = { result: retention.result, categories: retention.categories };
    if (out.holdStatus === 'REQUESTED') refuse(REASON.LEGAL_HOLD_REQUESTED, 'A legal hold has been requested for this user and is awaiting review.');
    else if (out.holdStatus) refuse(REASON.LEGAL_HOLD_ACTIVE, 'This user has an active legal hold.');
    if (!readHandleKeys(this.ports.env())) refuse(REASON.HANDLE_KEYS_MISSING, 'Permanent deletion is not configured on this server.');
    const retentionWithoutHolds = out.holdStatus ? await this.retentionFor(this.prisma, inv, now, false) : retention;
    if (!retentionWithoutHolds.allowsDeletion) refuse(...retentionRefusal(retentionWithoutHolds));
    // Phase 4 (D8, correction 7): an open exit case blocks deletion too.
    if ((await countOpenExitCases(this.prisma, userId)) > 0) refuse(REASON.OPEN_EXIT_CASE, 'This user still has an open exit case (notice, clearance or unreleased F&F).');
    if (snapshot.status === SNAPSHOT_STATUS.VERIFIED && reasons.length === 0) {
      try {
        const plan = await this.verifyExistingArchive(snapshot, snapshot.files);
        out.verifiedArchive = true;
        out.cleanupObjects = plan.length;
      } catch (err: any) {
        // A sharing problem is fixed by the archive owner in Drive, not by a rebuild.
        // A folder that no longer exists is a missing archive (rebuild), not a sharing problem.
        if (err instanceof FolderNotPrivate && MISSING_FOLDER_ISSUES.includes(err.privacyIssue)) refuse(REASON.ARCHIVE_MISSING_OR_CHANGED, 'The existing archive is missing or has changed.');
        else if (err instanceof FolderNotPrivate || (err instanceof LifecycleRefusal && /shared beyond/i.test(err.message))) refuse(REASON.ARCHIVE_PRIVACY_FAILED, 'The archive is shared beyond the archive account.');
        else if (err instanceof LifecycleRefusal) refuse(REASON.ARCHIVE_MISSING_OR_CHANGED, err.message);
        else refuse(REASON.ARCHIVE_MISSING_OR_CHANGED, 'The existing archive could not be verified.');
      }
    } else if (snapshot.status === SNAPSHOT_STATUS.NO_HISTORY_VERIFIED) {
      out.verifiedArchive = true;
    }
    return finish();
  }

  async permanentDelete(userId: string, actor: Actor, input: { idempotencyKey?: string; confirmation?: string }) {
    const idempotencyKey = this.validIdempotencyKey(input?.idempotencyKey);
    const replay = await this.prisma.userLifecycleOperation.findUnique({ where: { idempotencyKey } });
    if (replay) return this.operationView(replay);

    const preflight = await this.deletePreflight(userId, actor);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (String(input?.confirmation ?? '').trim().toLowerCase() !== String(user?.email ?? '').trim().toLowerCase()) {
      throw new BadRequestException('Type the user\'s email address exactly to confirm permanent deletion.');
    }
    if (!preflight.allowed) {
      await this.writeEvent(this.prisma, { actorId: actor.id, entityType: 'User', entityId: userId, action: LIFECYCLE_EVENT.PERMANENT_DELETE_VERIFICATION_FAILED, reasonCode: preflight.reasons[0]?.code ?? REASON.SNAPSHOT_NOT_USABLE, operationId: 'preflight' });
      if (preflight.remediation) {
        const lead = preflight.reasons.find((r) => REMEDIATION_CODE_FOR_REASON[r.code] === preflight.remediation!.code) ?? preflight.reasons[0];
        throw new RemediationException(preflight.remediation, 409, lead?.message, { reasonCode: lead?.code, reasons: preflight.reasons, retention: preflight.retention });
      }
      throw new ConflictException({ code: preflight.reasons[0]?.code, message: preflight.reasons[0]?.message, reasons: preflight.reasons, retention: preflight.retention });
    }
    const keys = readHandleKeys(this.ports.env())!;
    const { op, replay: replayed } = await this.startOperation(OPERATION_KIND.PERMANENT_DELETE, userId, actor.id, idempotencyKey);
    if (replayed) return this.operationView(op);
    await this.writeEvent(this.prisma, { actorId: actor.id, entityType: 'UserLifecycleOperation', entityId: op.id, action: LIFECYCLE_EVENT.PERMANENT_DELETE_REQUESTED, reasonCode: REASON.ADMIN_REQUEST, operationId: op.id, snapshotVersion: preflight.snapshot.version });

    const snapshot = await this.prisma.userArchiveSnapshot.findFirstOrThrow({ where: { userId, status: { in: USABLE_SNAPSHOT_STATUSES } }, include: { files: true } });
    let cleanupPlan: { provider: string; ref: string }[] = [];
    try {
      if (snapshot.status === SNAPSHOT_STATUS.VERIFIED) cleanupPlan = await this.verifyExistingArchive(snapshot, snapshot.files);
    } catch (err: any) {
      await this.finishOperation(op.id, OPERATION_STATE.FAILED, { reasonCode: REASON.ARCHIVE_MISSING_OR_CHANGED });
      await this.writeEvent(this.prisma, { actorId: actor.id, entityType: 'User', entityId: userId, action: LIFECYCLE_EVENT.PERMANENT_DELETE_VERIFICATION_FAILED, reasonCode: REASON.ARCHIVE_MISSING_OR_CHANGED, operationId: op.id });
      throw this.toHttp(err, REASON.ARCHIVE_MISSING_OR_CHANGED);
    }

    const now = this.ports.now();
    const receiptId = opaqueId();
    let counts: Record<string, number> = {};
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "users" WHERE id = ${userId} FOR UPDATE`;
        const ctx: MatrixContext = { systemUserId: DELETED_ACCOUNT.id, operationId: op.id, now };
        // Re-read everything under the lock.
        const fresh = await tx.userArchiveSnapshot.findUnique({ where: { id: snapshot.id } });
        if (!fresh || !USABLE_SNAPSHOT_STATUSES.includes(fresh.status as any)) throw new LifecycleRefusal(REASON.SNAPSHOT_NOT_USABLE, 'The archive snapshot is no longer usable.');
        const locked = await tx.user.findUnique({ where: { id: userId } });
        if (!locked || locked.isActive) throw new LifecycleRefusal(REASON.NOT_ARCHIVED, 'Only archived users can be permanently deleted.');
        const inv = await collectInventory(tx, userId, { ...ctx, operationId: null });
        if (dataFingerprint(inv) !== fresh.dataFingerprint) throw new LifecycleRefusal(REASON.SNAPSHOT_STALE, 'This user\'s data changed after archiving.');
        // Same precedence as the preflight (E2): legal hold, missing keys, retention.
        const hold = await this.holdStatusFor(tx, userId);
        if (hold === 'REQUESTED') throw new LifecycleRefusal(REASON.LEGAL_HOLD_REQUESTED, 'A legal hold has been requested for this user and is awaiting review.');
        if (hold) throw new LifecycleRefusal(REASON.LEGAL_HOLD_ACTIVE, 'This user has an active legal hold.');
        if (!readHandleKeys(this.ports.env())) throw new LifecycleRefusal(REASON.HANDLE_KEYS_MISSING, 'Permanent deletion is not configured on this server.');
        const retention = await this.retentionFor(tx, inv, now, false);
        if (!retention.allowsDeletion) throw new LifecycleRefusal(...retentionRefusal(retention));
        if ((await countOpenExitCases(tx, userId)) > 0) throw new LifecycleRefusal(REASON.OPEN_EXIT_CASE, 'This user still has an open exit case (notice, clearance or unreleased F&F).');
        const work = await this.activeWork(tx, userId);
        if (Object.values(work.summary).some((n) => n > 0)) throw new LifecycleRefusal(REASON.NEW_ACTIVE_WORK, 'This user has active work again.');

        // Cleanup plan: re-check sharing now, against everything that survives.
        const planObjects: FileObject[] = cleanupPlan.map((p) => ({ ref: p.ref, provider: p.provider as any, shared: false, cleanupEligible: true, mimeType: null, sources: [] }));
        await markShared(tx, userId, planObjects);
        const toClean = planObjects.filter((o) => !o.shared);

        // Authorize the row-scoped append-only exception for THIS transaction.
        const authorized = await tx.$executeRaw`
          UPDATE "user_lifecycle_operations"
             SET "state" = 'VERIFIED_FOR_DELETE', "deleteTxid" = pg_current_xact_id()::text, "snapshotId" = ${snapshot.id}, "updatedAt" = now()
           WHERE "id" = ${op.id} AND "userId" = ${userId} AND "state" = 'RUNNING'`;
        if (authorized !== 1) throw new LifecycleRefusal(REASON.OPERATION_IN_PROGRESS, 'The deletion could not be authorized.');
        await tx.$queryRaw`SELECT set_config('apex.lifecycle_operation_id', ${op.id}, true)`;

        await ensureDeletedAccount(tx);
        const subject: Subject = inv.subject;
        counts = {};
        for (const h of HANDLERS) {
          const where = handlerWhere(h, subject, ctx);
          if (!where) continue;
          const delegate = (tx as any)[delegateName(h.model)];
          let n = 0;
          if (h.action === 'DEL') n = (await delegate.deleteMany({ where })).count;
          else if (h.action === 'REASSIGN') n = (await delegate.updateMany({ where, data: { [h.field]: DELETED_ACCOUNT.id } })).count;
          else if (h.action === 'NULL') n = (await delegate.updateMany({ where, data: { [h.field]: null } })).count;
          else if (h.action === 'SCRUB') n = (await delegate.updateMany({ where, data: { [h.field]: SCRUBBED } })).count;
          else if (h.action === 'NAME') n = (await delegate.updateMany({ where, data: { [h.field]: DELETED_USER_NAME } })).count;
          if (n > 0) counts[h.key] = n;
        }
        counts['TEMPLATE_ASSIGNEES_REMOVED'] = await removeTemplateAssignee(tx, subject.id);
        counts['MEETING_APPROVERS_REMOVED'] = await removeMeetingApprover(tx, subject.id);
        counts['JSON_SCRUBBED'] = await this.scrubJsonColumns(tx, subject);
        counts['NARRATIVE_MENTIONS_RETAINED'] = await this.countNarrativeMentions(tx, subject);
        counts['TICKET_HISTORY_SCRUBBED'] = (await tx.ticketHistory.updateMany({ where: { oldValue: subject.id }, data: { oldValue: SCRUBBED } })).count
          + (await tx.ticketHistory.updateMany({ where: { newValue: subject.id }, data: { newValue: SCRUBBED } })).count;
        counts['FILES_LEFT_SHARED'] = planObjects.length - toClean.length;

        await tx.userArchiveSnapshot.updateMany({ where: { userId, id: { not: snapshot.id } }, data: { userId: null } });
        await tx.userArchiveSnapshot.update({ where: { id: snapshot.id }, data: { userId: null, status: SNAPSHOT_STATUS.CONSUMED_BY_PERMANENT_DELETE } });
        await tx.user.delete({ where: { id: userId } });

        await tx.userDeletionReceipt.create({
          data: {
            receiptId,
            operationId: op.id,
            archiveRef: snapshot.archiveRef,
            snapshotVersion: snapshot.version,
            counts,
            retentionResult: retention.result,
            cleanupState: toClean.length > 0 ? OPERATION_STATE.CLEANUP_PENDING : 'DONE',
          },
        });
        if (toClean.length > 0) {
          await tx.userDeletionCleanupItem.createMany({
            data: toClean.map((o) => ({
              id: opaqueId(),
              receiptId,
              provider: o.provider,
              resourceHandleEncrypted: encryptHandle(keys, o.ref),
              resourceHandleHmac: handleHmac(keys, o.provider, o.ref),
              state: CLEANUP_ITEM_STATE.PENDING,
            })),
            skipDuplicates: true,
          });
        }
        // No identifier of the person survives on the operation row.
        await tx.userLifecycleOperation.update({
          where: { id: op.id },
          data: { state: OPERATION_STATE.DB_DELETED, userId: null, deleteTxid: null, result: { reasonCode: REASON.ADMIN_REQUEST, receiptId, cleanupItems: toClean.length } },
        });
      }, { timeout: this.ports.transactionTimeoutMs, maxWait: MAX_TX_WAIT_MS });
    } catch (err: any) {
      const code: ReasonCode = err instanceof LifecycleRefusal ? err.code : REASON.ARCHIVE_DB_FAILED;
      await this.finishOperation(op.id, OPERATION_STATE.FAILED, { reasonCode: code });
      await this.writeEvent(this.prisma, { actorId: actor.id, entityType: 'User', entityId: userId, action: LIFECYCLE_EVENT.PERMANENT_DELETE_VERIFICATION_FAILED, reasonCode: code, operationId: op.id }).catch(() => undefined);
      if (!(err instanceof LifecycleRefusal)) this.logger.error(`Permanent delete ${op.id} failed: ${String(err?.message ?? err).split('\n')[0].slice(0, 200)}`);
      const remediation = this.remediationFor(code, { userId, operationId: op.id, retryEndpoint: 'PERMANENT_DELETE_PREFLIGHT' });
      if (remediation) await recordLifecycleAttempt(this.prisma, { operationId: op.id, subjectUserId: userId, phase: 'FAILURE', outcome: 'BLOCKED', actorId: actor.id, remediation });
      throw this.toHttp(err, code, undefined, remediation);
    }

    await this.finishOperation(op.id, OPERATION_STATE.CLEANUP_PENDING, { reasonCode: REASON.ADMIN_REQUEST, receiptId });
    return this.runCleanup(op.id, actor);
  }

  /** Deletes non-shared originals, then completes. Idempotent; safe to retry. */
  async runCleanup(operationId: string, actor: Actor) {
    const op = await this.prisma.userLifecycleOperation.findUnique({ where: { id: operationId } });
    if (!op || op.kind !== OPERATION_KIND.PERMANENT_DELETE) throw new NotFoundException('Operation not found');
    if (op.state === OPERATION_STATE.PERMANENTLY_DELETED) return this.operationView(op);
    if (op.state !== OPERATION_STATE.CLEANUP_PENDING && op.state !== OPERATION_STATE.DB_DELETED) return this.operationView(op);
    const receiptId = (op.result as any)?.receiptId as string;
    const keys = readHandleKeys(this.ports.env());
    const store = this.ports.makeFileStore();
    const items = await this.prisma.userDeletionCleanupItem.findMany({ where: { receiptId, state: CLEANUP_ITEM_STATE.PENDING }, orderBy: { id: 'asc' } });
    for (const item of items) {
      let error: string | null = null;
      try {
        if (!keys || !item.resourceHandleEncrypted) throw Object.assign(new Error('keys'), { code: CLEANUP_ERROR.HANDLE_UNREADABLE });
        const ref = decryptHandle(keys, item.resourceHandleEncrypted);
        await store.remove(item.provider as any, ref);
      } catch (err: any) {
        error = err?.code === CLEANUP_ERROR.HANDLE_UNREADABLE ? CLEANUP_ERROR.HANDLE_UNREADABLE : err?.code === 'PROVIDER_REFUSED' ? CLEANUP_ERROR.PROVIDER_REFUSED : CLEANUP_ERROR.PROVIDER_UNAVAILABLE;
      }
      await this.prisma.userDeletionCleanupItem.update({
        where: { id: item.id },
        data: error
          ? { attempts: { increment: 1 }, lastErrorCode: error }
          : { attempts: { increment: 1 }, lastErrorCode: null, state: CLEANUP_ITEM_STATE.DONE, completedAt: this.ports.now(), resourceHandleEncrypted: null },
      });
    }
    const remaining = await this.prisma.userDeletionCleanupItem.count({ where: { receiptId, state: CLEANUP_ITEM_STATE.PENDING } });
    const earlierAttempts = await this.prisma.lifecycleRemediationAttempt.count({ where: { operationId: op.id } });
    if (remaining > 0) {
      await this.prisma.userDeletionReceipt.update({ where: { receiptId }, data: { cleanupState: OPERATION_STATE.CLEANUP_PENDING } });
      await this.finishOperation(op.id, OPERATION_STATE.CLEANUP_PENDING, { reasonCode: REASON.CLEANUP_FAILED, receiptId, pendingItems: remaining });
      const remediation = this.remediationFor(REASON.CLEANUP_FAILED, { operationId: op.id, details: { pendingItems: remaining }, previewCount: remaining })!;
      await recordLifecycleAttempt(this.prisma, { operationId: op.id, subjectUserId: null, phase: earlierAttempts > 0 ? 'RETRY' : 'FAILURE', outcome: 'PENDING', actorId: actor.id, remediation });
    } else {
      if (earlierAttempts > 0) {
        const resolved = { ...this.remediationFor(REASON.CLEANUP_FAILED, { operationId: op.id, details: { pendingItems: 0 } })!, status: 'RESOLVED' as const };
        await recordLifecycleAttempt(this.prisma, { operationId: op.id, subjectUserId: null, phase: 'RESOLUTION', outcome: 'RESOLVED', actorId: actor.id, remediation: resolved });
      }
      await this.prisma.userDeletionReceipt.update({ where: { receiptId }, data: { cleanupState: 'DONE', completedAt: this.ports.now() } });
      await this.finishOperation(op.id, OPERATION_STATE.PERMANENTLY_DELETED, { reasonCode: REASON.ADMIN_REQUEST, receiptId });
      await this.writeEvent(this.prisma, { actorId: actor.id, entityType: 'UserDeletionReceipt', entityId: receiptId, action: LIFECYCLE_EVENT.USER_PERMANENTLY_DELETED, fromState: OPERATION_STATE.DB_DELETED, toState: OPERATION_STATE.PERMANENTLY_DELETED, reasonCode: REASON.ADMIN_REQUEST, operationId: op.id });
    }
    return this.operationView(await this.prisma.userLifecycleOperation.findUniqueOrThrow({ where: { id: op.id } }));
  }

  async operationStatus(operationId: string) {
    const op = await this.prisma.userLifecycleOperation.findUnique({ where: { id: operationId } });
    if (!op) throw new NotFoundException('Operation not found');
    return this.operationView(op);
  }

  // ── Identity scrubbing ───────────────────────────────────────────────────

  private async scrubJsonColumns(tx: any, u: Subject): Promise<number> {
    let replaced = 0;
    const needles = [u.id, u.email.trim().toLowerCase(), ...(u.employeeId ? [u.employeeId.toLowerCase()] : [])];
    for (const c of JSON_SCRUB_COLUMNS) {
      const rows: { id: string; value: any }[] = await tx.$queryRawUnsafe(
        `SELECT "id", "${c.column}" AS value FROM "${c.table}" WHERE "${c.column}" IS NOT NULL AND (${needles.map((_, i) => `lower("${c.column}"::text) LIKE $${i + 1}`).join(' OR ')})`,
        ...needles.map((n) => `%${n.toLowerCase().replace(/[%_\\]/g, (m) => `\\${m}`)}%`),
      );
      for (const r of rows) {
        const out = scrubJson(r.value, u);
        if (out.replaced > 0) {
          await tx.$executeRawUnsafe(`UPDATE "${c.table}" SET "${c.column}" = $1::jsonb WHERE "id" = $2`, JSON.stringify(out.value), r.id);
          replaced += out.replaced;
        }
      }
    }
    return replaced;
  }

  private async countNarrativeMentions(tx: any, u: Subject): Promise<number> {
    let n = 0;
    for (const c of NARRATIVE_TEXT_COLUMNS) {
      const delegate = tx[delegateName(c.model)];
      const ors: any[] = [{ [c.field]: { contains: u.email, mode: 'insensitive' } }];
      if (u.employeeId && u.employeeId.length >= 4) ors.push({ [c.field]: { contains: u.employeeId, mode: 'insensitive' } });
      n += await delegate.count({ where: { OR: ors, ...(c.model === 'User' ? { id: { not: u.id } } : {}) } });
    }
    return n;
  }

  private toHttp(err: any, code: ReasonCode, message = 'The operation could not be completed. Nothing was changed.', remediation: RemediationResult | null = null) {
    if (remediation && (err instanceof LifecycleRefusal || err instanceof FolderNotPrivate)) {
      return new RemediationException(remediation, 409, err.message, { reasonCode: code, details: err instanceof LifecycleRefusal ? err.details : err.safeDetails() });
    }
    if (err instanceof LifecycleRefusal) return new ConflictException({ code: err.code, message: err.message, details: err.details });
    if (err instanceof FolderNotPrivate) return new ConflictException({ code: REASON.ARCHIVE_PRIVACY_FAILED, message: err.message, details: err.safeDetails() });
    if (err?.getStatus) return err;
    return new ServiceUnavailableException({ code, message });
  }
}
