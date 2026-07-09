import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { formatInTimeZone } from 'date-fns-tz';
import { PrismaService } from '../../../prisma/prisma.service';
import { WorkdayService } from '../workday/workday.service';
import { TVAService } from '../../../common/services/tva.service';
import { PunchInDto, BreakStartDto, PunchOutDto } from './dto/hrms-attendance.dto';

const OPEN_WORK_STATUSES = ['WORKING', 'ON_BREAK', 'IDLE', 'LOGGED_IN'];
const POLICY_VERSION = 'hrms-attendance-phase1-v1';

@Injectable()
export class HrmsAttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workdayService: WorkdayService,
    private readonly tva: TVAService,
    private readonly config: ConfigService,
  ) {}

  // ── Feature flags — all default OFF/safe when unset ──────────────────────
  private flag(name: string): boolean {
    return this.config.get<string>(name)?.toLowerCase() === 'true';
  }

  private hrmsPolicyEnabled(): boolean {
    return this.flag('HRMS_POLICY_ENABLED');
  }

  private captureEnabled(): boolean {
    return this.hrmsPolicyEnabled() && this.flag('ATTENDANCE_CAPTURE_ENABLED');
  }

  private locationRequired(): boolean {
    return this.flag('ATTENDANCE_LOCATION_REQUIRED');
  }

  private faceRequired(): boolean {
    return this.flag('ATTENDANCE_FACE_REQUIRED');
  }

  // Shadow mode: capture requirements are recorded but never block a real
  // punch — used to observe what capture data WOULD look like before
  // actually enforcing it on live users.
  private shadowMode(): boolean {
    return this.flag('DAILY_ATTENDANCE_SHADOW_MODE');
  }

  private companyDate(): string {
    return formatInTimeZone(this.tva.now(), this.tva.companyTimezone(), 'yyyy-MM-dd');
  }

  private isOpenWorkStatus(status?: string | null): boolean {
    return !!status && OPEN_WORK_STATUSES.includes(status);
  }

  // ── GET /today ─────────────────────────────────────────────────────────
  async getToday(userId: string) {
    const workday = await this.workdayService.getToday(userId);
    const session = workday?.session ?? null;
    const status = session?.status ?? 'NOT_STARTED';

    return {
      companyDate: this.companyDate(),
      status,
      isPunchedIn: this.isOpenWorkStatus(status),
      isOnBreak: status === 'ON_BREAK',
      punchInTime: workday?.firstStartTime ?? session?.startWorkAt ?? null,
      punchOutTime: session?.logoutAt ?? null,
      totalWorkedMs:
        typeof workday?.elapsedWorkMinutes === 'number' ? workday.elapsedWorkMinutes * 60_000 : null,
      requiredCapture: {
        faceRequired: this.faceRequired(),
        locationRequired: this.locationRequired(),
      },
      captureEnabled: this.captureEnabled(),
    };
  }

  // ── POST /punch-in ────────────────────────────────────────────────────
  async punchIn(userId: string, dto: PunchInDto, ip?: string, userAgent?: string) {
    if (!this.captureEnabled()) {
      return {
        status: 'disabled',
        captureEnabled: false,
        message:
          'Attendance capture is not yet enabled for this workspace. Use the standard workday controls to start work.',
      };
    }

    // Idempotent: already punched in today — return current state, create nothing new.
    const existing = await this.getToday(userId);
    if (existing.isPunchedIn) {
      return { status: 'already_punched_in', ...existing };
    }

    const locationMissing = dto.latitude == null || dto.longitude == null;
    const faceMissing = !dto.faceImageUrl;

    if (this.locationRequired() && locationMissing && !this.shadowMode()) {
      throw new BadRequestException('Location is required to punch in.');
    }
    if (this.faceRequired() && faceMissing && !this.shadowMode()) {
      throw new BadRequestException('Face capture is required to punch in.');
    }

    let verificationStatus = 'NOT_REQUIRED';
    if (this.faceRequired() && faceMissing && this.shadowMode()) verificationStatus = 'MISSING_FACE_SHADOW';
    else if (this.locationRequired() && locationMissing && this.shadowMode()) verificationStatus = 'MISSING_LOCATION_SHADOW';
    else if (dto.faceImageUrl) verificationStatus = 'PENDING';

    // Reuse the existing, already-tested workday engine for the actual
    // WorkSession mutation — this endpoint never manages session state itself.
    // startWork() returns { session, message }, not a raw session.
    const startResult = await this.workdayService.startWork(userId);

    await this.prisma.attendanceEvent.create({
      data: {
        userId,
        workSessionId: (startResult as any)?.session?.id,
        eventType: 'START_WORK',
        source: 'hrms_capture',
        clientTimestamp: dto.clientTimestamp ? new Date(dto.clientTimestamp) : null,
        timezone: dto.timezone ?? null,
        latitude: dto.latitude ?? null,
        longitude: dto.longitude ?? null,
        accuracy: dto.accuracy ?? null,
        faceImageUrl: dto.faceImageUrl ?? null,
        deviceMetadata: (dto.deviceMetadata ?? (userAgent ? { userAgent } : undefined)) as any,
        ipAddress: ip ?? null,
        verificationStatus,
        policyVersion: POLICY_VERSION,
      },
    });

    return { status: 'punched_in', ...(await this.getToday(userId)) };
  }

  // ── POST /break-start ─────────────────────────────────────────────────
  async breakStart(userId: string, dto: BreakStartDto, userAgent?: string) {
    const current = await this.getToday(userId);

    if (!current.isPunchedIn) {
      throw new BadRequestException('You must punch in before starting a break.');
    }
    if (current.isOnBreak) {
      return { status: 'already_on_break', ...current };
    }

    // startBreak() returns { breakLog }, not a session — the session id
    // lives on the break log itself.
    const breakResult = await this.workdayService.startBreak(userId, {
      breakType: dto.breakType || 'GENERAL',
      estimatedMinutes: dto.estimatedMinutes,
    });

    await this.prisma.attendanceEvent.create({
      data: {
        userId,
        workSessionId: (breakResult as any)?.breakLog?.workSessionId,
        eventType: 'BREAK_START',
        source: 'hrms_capture',
        deviceMetadata: (dto.deviceMetadata ?? (userAgent ? { userAgent } : undefined)) as any,
        policyVersion: POLICY_VERSION,
      },
    });

    return { status: 'break_started', ...(await this.getToday(userId)) };
  }

  // ── POST /break-end ───────────────────────────────────────────────────
  async breakEnd(userId: string, userAgent?: string) {
    const current = await this.getToday(userId);

    if (!current.isOnBreak) {
      return { status: 'not_on_break', ...current };
    }

    // endBreak() returns { breakLog, durationMinutes } — same shape as
    // startBreak(), session id lives on the break log.
    const endBreakResult = await this.workdayService.endBreak(userId);

    await this.prisma.attendanceEvent.create({
      data: {
        userId,
        workSessionId: (endBreakResult as any)?.breakLog?.workSessionId,
        eventType: 'BREAK_END',
        source: 'hrms_capture',
        deviceMetadata: userAgent ? { userAgent } : undefined,
        policyVersion: POLICY_VERSION,
      },
    });

    return { status: 'break_ended', ...(await this.getToday(userId)) };
  }

  // ── POST /punch-out ────────────────────────────────────────────────────
  async punchOut(userId: string, dto: PunchOutDto, userAgent?: string) {
    const current = await this.getToday(userId);

    if (!current.isPunchedIn) {
      return { status: 'already_punched_out', ...current };
    }

    // endWork() returns { session, summary } (or { message } if no session
    // exists at all — handled above by the isPunchedIn guard).
    const endResult = await this.workdayService.endWork(userId);

    await this.prisma.attendanceEvent.create({
      data: {
        userId,
        workSessionId: (endResult as any)?.session?.id,
        eventType: 'LOGOUT',
        source: 'hrms_capture',
        clientTimestamp: dto.clientTimestamp ? new Date(dto.clientTimestamp) : null,
        deviceMetadata: (dto.deviceMetadata ?? (userAgent ? { userAgent } : undefined)) as any,
        policyVersion: POLICY_VERSION,
      },
    });

    return { status: 'punched_out', ...(await this.getToday(userId)) };
  }

  // ── GET /history ──────────────────────────────────────────────────────
  async getHistory(userId: string, requester: any) {
    return this.workdayService.getHistory(userId, requester);
  }
}
