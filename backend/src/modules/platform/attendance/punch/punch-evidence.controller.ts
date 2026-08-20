import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../shared/guards/jwt-auth.guard';
import { CurrentUser } from '../../../../shared/decorators/current-user.decorator';
import { PunchEvidenceService } from './punch-evidence.service';
import {
  PunchFeatureDisabledError,
  PunchIdempotencyConflictError,
  PunchNotApplicableError,
  PunchValidationError,
  SubmitPunchEvidenceInput,
} from './punch-evidence.types';

/**
 * Punch Evidence API (PE-1).
 *
 * Deliberately minimal: create your own evidence, read your own evidence.
 *
 * There is no PATCH, PUT or DELETE route, and no company-wide read. Evidence is
 * append-only, and a cross-employee view needs a permission model that PE-1
 * does not define.
 */
@ApiTags('Attendance Punch Evidence')
@Controller('attendance/punch-evidence')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PunchEvidenceController {
  constructor(private readonly punchEvidence: PunchEvidenceService) {}

  /**
   * Records a punch for the AUTHENTICATED employee.
   *
   * The subject is taken from the verified JWT. Any userId, businessDate,
   * timestamp, policy id or verification field present in the body is ignored
   * -- the body type carries only client-owned fields, and the service reads
   * nothing else from it.
   */
  @Post()
  async submit(
    @CurrentUser() user: any,
    @Body() body: SubmitPunchEvidenceInput,
    @Req() req: any,
  ) {
    const userId = user?.id ?? user?.sub;
    try {
      return await this.punchEvidence.submit(userId, body, {
        ipAddress: req?.ip ?? req?.headers?.['x-forwarded-for'] ?? null,
      });
    } catch (err) {
      // Mapped explicitly so each failure reaches the client as a meaningful
      // status rather than an opaque 500.
      if (err instanceof PunchFeatureDisabledError) {
        throw new ServiceUnavailableException(err.message);
      }
      if (err instanceof PunchValidationError) {
        throw new BadRequestException(err.message);
      }
      if (err instanceof PunchNotApplicableError) {
        throw new UnprocessableEntityException({
          message: err.message,
          applicability: err.applicability,
          blockingReasons: err.blockingReasons,
        });
      }
      if (err instanceof PunchIdempotencyConflictError) {
        throw new ForbiddenException(err.message);
      }
      throw err;
    }
  }

  /** The authenticated employee's own evidence. Scoped by JWT, not by query. */
  @Get('me')
  async listMine(@CurrentUser() user: any, @Query('limit') limit?: string) {
    const userId = user?.id ?? user?.sub;
    return this.punchEvidence.listMine(userId, limit ? Number(limit) : undefined);
  }
}
