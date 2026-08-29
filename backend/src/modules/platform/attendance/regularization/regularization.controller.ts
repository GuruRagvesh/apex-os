import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../shared/guards/jwt-auth.guard';
import { CurrentUser } from '../../../../shared/decorators/current-user.decorator';
import {
  CreateRegularizationInput,
  RegularizationDisabledError,
  RegularizationService,
  StaleCorrectionError,
  type ManualRecoveryInput,
} from './regularization.service';

/**
 * Attendance correction API (AR-1).
 *
 * Employee routes are scoped to the JWT subject — there is no userId parameter
 * anywhere, so one employee cannot file or read another's correction. Review
 * routes are scoped by the existing hierarchy and HR conventions inside the
 * service; there is no unrestricted company-wide listing.
 */
@ApiTags('Attendance Regularization')
@Controller('attendance/regularization')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class RegularizationController {
  constructor(private readonly regularization: RegularizationService) {}

  private rethrow(err: unknown): never {
    if (err instanceof RegularizationDisabledError) {
      throw new ServiceUnavailableException(err.message);
    }
    if (err instanceof StaleCorrectionError) {
      throw new BadRequestException(err.message);
    }
    throw err;
  }

  /** Raise a correction for your own attendance on a date. */
  @Post()
  async create(@CurrentUser() user: any, @Body() body: CreateRegularizationInput) {
    try {
      return await this.regularization.create(user?.id ?? user?.sub, body);
    } catch (err) {
      this.rethrow(err);
    }
  }

  /** Your own correction requests. */
  @Get('me')
  async listMine(@CurrentUser() user: any, @Query('limit') limit?: string) {
    return this.regularization.listMine(
      user?.id ?? user?.sub,
      limit ? Number(limit) : undefined,
    );
  }

  /** Requests awaiting your decision: your reports', or HR's final queue. */
  @Get('pending')
  async pending(@CurrentUser() user: any, @Query('limit') limit?: string) {
    return this.regularization.pendingFor(user, limit ? Number(limit) : undefined);
  }

  @Get(':id')
  async findOne(@CurrentUser() user: any, @Param('id') id: string) {
    return this.regularization.findOne(user, id);
  }

  /** Stage one, by the employee's actual reporting authority. */
  @Patch(':id/manager-approve')
  async managerApprove(@CurrentUser() user: any, @Param('id') id: string) {
    try {
      return await this.regularization.approveAsManager(user, id);
    } catch (err) {
      this.rethrow(err);
    }
  }

  /** Stage two, by HR. This is what revises the official attendance record. */
  @Patch(':id/hr-approve')
  async hrApprove(@CurrentUser() user: any, @Param('id') id: string) {
    try {
      return await this.regularization.approveAsHr(user, id);
    } catch (err) {
      this.rethrow(err);
    }
  }

  /**
   * Manual Attendance Recovery.
   *
   * Deliberately NOT on the employee punch surface: this is an authorised
   * person recording a punch somebody else could not record, and an employee
   * must never reach it. Scope is enforced in the service, not here.
   */
  @Post('manual-recovery')
  async manualRecovery(@CurrentUser() user: any, @Body() body: ManualRecoveryInput) {
    try {
      return await this.regularization.createManualRecovery(user, body);
    } catch (err) {
      this.rethrow(err);
    }
  }

  @Patch(':id/reject')
  async reject(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    try {
      return await this.regularization.reject(user, id, body?.reason);
    } catch (err) {
      this.rethrow(err);
    }
  }
}
