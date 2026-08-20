import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UnprocessableEntityException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../shared/guards/jwt-auth.guard';
import { CurrentUser } from '../../../../shared/decorators/current-user.decorator';
import { PunchEvidenceService } from './punch-evidence.service';
import { PunchPhotoService, MAX_PHOTO_BYTES } from './punch-photo.service';
import {
  PunchContextInvariantError,
  PunchFeatureDisabledError,
  PunchIdempotencyConflictError,
  PunchLocationConfigurationError,
  PunchLocationRequiredError,
  PunchNotApplicableError,
  PunchPhotoRequiredError,
  PunchPhotoValidationError,
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
  constructor(
    private readonly punchEvidence: PunchEvidenceService,
    private readonly punchPhoto: PunchPhotoService,
  ) {}

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
      if (err instanceof PunchValidationError || err instanceof PunchPhotoValidationError) {
        throw new BadRequestException(err.message);
      }
      if (err instanceof PunchLocationRequiredError || err instanceof PunchPhotoRequiredError) {
        throw new UnprocessableEntityException(err.message);
      }
      if (
        err instanceof PunchLocationConfigurationError ||
        err instanceof PunchContextInvariantError
      ) {
        throw new UnprocessableEntityException(err.message);
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

  /**
   * A short-lived signed URL for the employee's OWN punch photo.
   *
   * Scoped by the JWT subject inside the query, so another employee's evidence
   * simply does not match and returns 404. Manager and HR access arrives with
   * the HR authorization wave.
   */
  @Get(':id/photo')
  async ownPhoto(@CurrentUser() user: any, @Param('id') id: string) {
    const userId = user?.id ?? user?.sub;
    const url = await this.punchPhoto.signedUrlForOwnEvidence(userId, id);
    if (!url) throw new NotFoundException('No photo is available for this punch');
    return { url };
  }
}
