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
  UnauthorizedException,
  UnprocessableEntityException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../shared/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../../../shared/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../../../../shared/decorators/current-user.decorator';
import { PunchEvidenceService } from './punch-evidence.service';
import { PunchHandoffService } from './punch-handoff.service';
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
@ApiBearerAuth()
export class PunchEvidenceController {
  constructor(
    private readonly punchEvidence: PunchEvidenceService,
    private readonly punchPhoto: PunchPhotoService,
    private readonly handoff: PunchHandoffService,
  ) {}

  /**
   * Records a punch for the AUTHENTICATED employee.
   *
   * The subject is taken from the verified JWT. Any userId, businessDate,
   * timestamp, policy id or verification field present in the body is ignored
   * -- the body type carries only client-owned fields, and the service reads
   * nothing else from it.
   */
  /**
   * OptionalJwtAuthGuard, NOT a missing guard.
   *
   * This route serves two callers with two different credentials. The desktop
   * is authorised by its session. The phone is authorised by a one-time
   * handoff token in the QR fragment, and must not be sent through a login
   * screen to record a punch its own laptop already authorised.
   *
   * So the session is read when present and REQUIRED when there is no handoff
   * -- see the explicit refusal below, which is what keeps the session-only
   * path closed. It is covered by tests precisely because it is an assertion
   * in code rather than a framework guard.
   */
  @Post()
  @UseGuards(OptionalJwtAuthGuard)
  async submit(
    @CurrentUser() user: any,
    @Body() body: SubmitPunchEvidenceInput,
    @Req() req: any,
  ) {
    const sessionUserId = user?.id ?? user?.sub ?? null;
    const viaHandoff = !!(body?.handoffId && body?.handoffToken);

    // THE SESSION-ONLY PATH STAYS CLOSED. Without a handoff there is no other
    // credential, so a missing session is a refusal here exactly as the class
    // guard used to make it.
    if (!viaHandoff && !sessionUserId) {
      throw new UnauthorizedException('Not authenticated');
    }

    let userId: string = sessionUserId as string;
    try {
      // A phone finishing a handoff claims it FIRST. The claim is the
      // concurrency control: it verifies the session owns the handoff, that it
      // is still WAITING and unexpired, and returns the intent and idempotency
      // key from the row. Nothing about who is punching, or whether it is an in
      // or an out, is read from the request body on this path.
      let effective = body;
      let claimedHandoffId: string | null = null;

      if (viaHandoff) {
        const claim = await this.handoff.claim(
          body.handoffId!,
          body.handoffToken!,
          sessionUserId,
        );
        // WHO is punching comes from the handoff row, never from the request
        // and never from a session that may not exist.
        userId = claim.userId;
        claimedHandoffId = body.handoffId!;
        effective = {
          ...body,
          type: claim.intent,
          idempotencyKey: claim.idempotencyKey,
          source: 'MOBILE',
        };
      }

      const result = await this.punchEvidence.submit(userId, effective, {
        ipAddress: req?.ip ?? req?.headers?.['x-forwarded-for'] ?? null,
      });

      if (claimedHandoffId && (result as any)?.id) {
        await this.handoff.attachEvidence(claimedHandoffId, (result as any).id);
      }
      return result;
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

  /**
   * Whether Attendance V2 punching is enabled for this deployment.
   *
   * Read-only and cheap: the client calls it to decide whether to render the
   * punch flow or leave the legacy workday controls exactly as they are.
   */
  @UseGuards(JwtAuthGuard)
  @Get('status')
  async status() {
    return this.punchEvidence.featureStatus();
  }

  /** The authenticated employee's own evidence. Scoped by JWT, not by query. */
  @UseGuards(JwtAuthGuard)
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
  @UseGuards(JwtAuthGuard)
  @Get(':id/photo')
  async ownPhoto(@CurrentUser() user: any, @Param('id') id: string) {
    const userId = user?.id ?? user?.sub;
    const url = await this.punchPhoto.signedUrlForOwnEvidence(userId, id);
    if (!url) throw new NotFoundException('No photo is available for this punch');
    return { url };
  }
}
