import { Controller, ForbiddenException, Get, Injectable, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../shared/guards/jwt-auth.guard';
import { CurrentUser } from '../../../../shared/decorators/current-user.decorator';
import { PrismaService } from '../../../../prisma/prisma.service';
import { AccessPolicyService } from '../../../../common/services/access-policy.service';
import { TVAService } from '../../../../common/services/tva.service';
import { RecoveryFlagsService } from './recovery-flags';
import { computeDataHealth, type DataHealth } from './data-health';
import { AttendanceRecoveryVault } from './recovery-vault.service';

/**
 * Attendance Data Manager — Phase 2A: READ-ONLY.
 *
 * One route, a GET. It reports what is provably true and writes nothing: no
 * attendance, no settings, and nothing to R2. It never contacts the existing
 * database-backup vault; the recovery vault is checked with one bounded,
 * non-mutating LIST, and only when its flag is on.
 *
 * Authority is company-wide attendance authority only — HR, ADMIN, SUPER_ADMIN
 * (AccessPolicyService.isHrOrAdmin). An attendance data operator, a manager, a
 * team lead, an employee or an intern is refused here, on the server, whatever
 * the browser shows.
 */

@Injectable()
export class DataHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessPolicy: AccessPolicyService,
    private readonly flags: RecoveryFlagsService,
    private readonly tva: TVAService,
    private readonly vault: AttendanceRecoveryVault,
  ) {}

  assertCompanyWideAuthority(actor: any) {
    if (!this.accessPolicy.isHrOrAdmin(actor)) {
      throw new ForbiddenException('Attendance Data Manager is available to HR and administrators only.');
    }
  }

  async health(actor: any): Promise<DataHealth> {
    this.assertCompanyWideAuthority(actor);
    const { flags } = await this.flags.config();

    // A cheap read proves the operational store answers; a failure is reported, not thrown.
    let operationalAvailable = true;
    try {
      await this.prisma.dailyAttendance.findFirst({ select: { id: true } });
    } catch {
      operationalAvailable = false;
    }

    let failedImports: number | null = null;
    try {
      failedImports = await this.prisma.attendanceImportBatch.count({ where: { status: 'FAILED' } });
    } catch {
      failedImports = null;
    }

    return computeDataHealth(
      {
        flags,
        operationalAvailable,
        // Never throws; one bounded, non-mutating LIST at most, and only when enabled.
        vault: await this.vault.health(),
        failedImports,
      },
      this.tva.now(),
    );
  }
}

@ApiTags('Attendance Data Manager')
@Controller('attendance/data-manager')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DataManagerController {
  constructor(private readonly health: DataHealthService) {}

  @Get('health')
  getHealth(@CurrentUser() user: any) {
    return this.health.health(user);
  }
}
