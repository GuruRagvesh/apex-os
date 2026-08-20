import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { TVAService } from '../../../../common/services/tva.service';
import { SettingsService } from '../../settings/settings.service';
import {
  EventLoggerService,
  OperationalAction,
} from '../../../../common/services/event-logger.service';
import { DailyContextService } from '../context/daily-context.service';
import {
  ATTENDANCE_V2_DEFAULTS,
  ATTENDANCE_V2_SETTING_KEY,
  PunchFeatureDisabledError,
  PunchIdempotencyConflictError,
  PunchNotApplicableError,
  PunchValidationError,
  SubmitPunchEvidenceInput,
} from './punch-evidence.types';

/**
 * Punch Evidence (PE-1).
 *
 * Append-only raw evidence for future Punch In / Punch Out. See
 * punch-evidence.types.ts for the contract.
 *
 * Three properties this service exists to guarantee:
 *
 *   SERVER AUTHORITY  the client never chooses its own identity, business
 *                     date, timestamps, policy provenance or verification
 *                     outcome
 *   CONTEXT GATE      no evidence is created under a configuration the BL-5
 *                     resolver could not explain
 *   APPEND-ONLY       create and read only; there is no update or delete path
 *                     here, and the database refuses both as well
 *
 * It performs no attendance classification of any kind.
 */
@Injectable()
export class PunchEvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tva: TVAService,
    private readonly settings: SettingsService,
    private readonly eventLogger: EventLoggerService,
    private readonly dailyContext: DailyContextService,
  ) {}

  /** Feature flag, defaulting OFF. */
  private async isEnabled(): Promise<boolean> {
    const cfg = await this.settings.get(ATTENDANCE_V2_SETTING_KEY);
    return (cfg?.punchEvidenceEnabled ?? ATTENDANCE_V2_DEFAULTS.punchEvidenceEnabled) === true;
  }

  /**
   * Validates only what the client is allowed to send.
   *
   * GPS is stored, not judged: PE-1 records coordinates and marks them PENDING.
   * PE-2 adds the geofence calculation. What is rejected here is data that
   * could not be a real reading at all -- out of range, non-finite, or a
   * nonsensical accuracy.
   */
  private validate(input: SubmitPunchEvidenceInput) {
    if (input.type !== 'PUNCH_IN' && input.type !== 'PUNCH_OUT') {
      throw new PunchValidationError('type must be PUNCH_IN or PUNCH_OUT');
    }
    if (!input.idempotencyKey || typeof input.idempotencyKey !== 'string') {
      throw new PunchValidationError('idempotencyKey is required');
    }

    const num = (v: any) => v !== null && v !== undefined;

    if (num(input.latitude)) {
      const lat = Number(input.latitude);
      if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
        throw new PunchValidationError('latitude must be a finite number between -90 and 90');
      }
    }
    if (num(input.longitude)) {
      const lon = Number(input.longitude);
      if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
        throw new PunchValidationError('longitude must be a finite number between -180 and 180');
      }
    }
    if (num(input.accuracyMeters)) {
      const acc = Number(input.accuracyMeters);
      if (!Number.isFinite(acc) || acc <= 0) {
        throw new PunchValidationError('accuracyMeters must be a finite number greater than 0');
      }
    }
    if (num(input.clientCapturedAt)) {
      const t = new Date(input.clientCapturedAt as any);
      if (Number.isNaN(t.getTime())) {
        throw new PunchValidationError('clientCapturedAt must be a valid timestamp');
      }
    }
  }

  /**
   * Does this submission match an existing record closely enough to be the
   * same punch retried?
   *
   * Compared on what the client actually chose. Server-derived fields are
   * excluded on purpose: serverOccurredAt and receivedAt differ between a
   * request and its retry by definition, so including them would turn every
   * legitimate retry into a conflict.
   */
  private isSameSubmission(existing: any, input: SubmitPunchEvidenceInput): boolean {
    const sameNullable = (a: any, b: any) =>
      (a ?? null) === null && (b ?? null) === null
        ? true
        : Number(a ?? NaN) === Number(b ?? NaN);

    const existingClient = existing.clientCapturedAt
      ? new Date(existing.clientCapturedAt).getTime()
      : null;
    const inputClient = input.clientCapturedAt
      ? new Date(input.clientCapturedAt as any).getTime()
      : null;

    return (
      existing.type === input.type &&
      existingClient === inputClient &&
      sameNullable(existing.latitude, input.latitude) &&
      sameNullable(existing.longitude, input.longitude) &&
      sameNullable(existing.accuracyMeters, input.accuracyMeters)
    );
  }

  /**
   * Records one punch.
   *
   * @param userId taken from the verified JWT by the controller, never from
   *               the request body.
   */
  async submit(
    userId: string,
    input: SubmitPunchEvidenceInput,
    meta: { ipAddress?: string | null } = {},
  ) {
    if (!(await this.isEnabled())) {
      throw new PunchFeatureDisabledError();
    }

    this.validate(input);

    const receivedAt = this.tva.now();
    const serverOccurredAt = receivedAt;
    const businessDate = this.tva.companyDateOnly(serverOccurredAt);

    // Context gate. A punch is only accepted when the foundation can say
    // exactly which rules apply -- so a configuration gap surfaces as a clear
    // error instead of quietly producing evidence nobody can interpret.
    const context = await this.dailyContext.resolveDailyContext(userId, serverOccurredAt);
    if (context.attendanceApplicability !== 'REQUIRED') {
      throw new PunchNotApplicableError(
        context.attendanceApplicability,
        context.blockingReasons,
      );
    }

    // Retry safety, checked before the write so a repeat returns the original.
    const existing = await this.prisma.attendancePunchEvidence.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } },
    });
    if (existing) {
      if (!this.isSameSubmission(existing, input)) {
        throw new PunchIdempotencyConflictError(input.idempotencyKey);
      }
      return existing;
    }

    const evidence = await this.prisma.attendancePunchEvidence.create({
      data: {
        userId,
        type: input.type as any,
        businessDate,
        serverOccurredAt,
        receivedAt,
        clientCapturedAt: input.clientCapturedAt ? new Date(input.clientCapturedAt as any) : null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        accuracyMeters: input.accuracyMeters ?? null,
        // Both stay PENDING in PE-1. PE-2 resolves location, PE-3 resolves
        // photo. Neither is ever accepted from the client.
        locationVerification: 'PENDING' as any,
        photoVerification: 'PENDING' as any,
        source: (input.source ?? 'WEB') as any,
        deviceMetadata: (input.deviceMetadata ?? undefined) as any,
        ipAddress: meta.ipAddress ?? null,
        employeeProfileId: context.sources.employeeProfileId,
        shiftPolicyId: context.sources.shiftPolicyId,
        shiftPolicyVersion: context.sources.shiftPolicyVersion,
        attendancePolicyId: context.sources.attendancePolicyId,
        attendancePolicyVersion: context.sources.attendancePolicyVersion,
        contextResolverVersion: context.resolverVersion,
        idempotencyKey: input.idempotencyKey,
      },
    });

    // Audit deliberately carries no coordinates, no photo reference and no
    // device payload. The precise evidence lives in the evidence record; the
    // operational log records only that a punch was recorded, and under which
    // rules.
    this.eventLogger
      .log({
        actorId: userId,
        entityType: 'AttendancePunchEvidence',
        entityId: evidence.id,
        action: OperationalAction.ATTENDANCE_PUNCH_RECORDED,
        metadata: {
          type: evidence.type,
          businessDate: this.tva.companyBusinessDate(evidence.serverOccurredAt),
          locationVerification: evidence.locationVerification,
          photoVerification: evidence.photoVerification,
          source: evidence.source,
        },
      })
      .catch(() => {});

    return evidence;
  }

  /**
   * The authenticated employee's own evidence.
   *
   * Scoped to userId by construction. PE-1 exposes no company-wide or
   * other-employee read; that needs its own permission model.
   */
  async listMine(userId: string, limit = 90) {
    return this.prisma.attendancePunchEvidence.findMany({
      where: { userId },
      orderBy: [{ businessDate: 'desc' }, { serverOccurredAt: 'desc' }],
      take: Math.min(Math.max(limit, 1), 200),
    });
  }
}
