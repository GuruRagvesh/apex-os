import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../shared/guards/jwt-auth.guard';
import { RolesGuard } from '../../../../shared/guards/roles.guard';
import { Roles } from '../../../../shared/decorators/roles.decorator';
import { CurrentUser } from '../../../../shared/decorators/current-user.decorator';
import { ROLES } from '../../../../shared/constants/roles';
import { UserLifecycleService } from './user-lifecycle.service';

/**
 * Archive User and permanent deletion. ADMIN and SUPER_ADMIN only.
 *
 * The actor always comes from the authenticated user. Bodies carry only an
 * idempotency key (and, for deletion, the typed confirmation): no actor id,
 * verification status, count or ownership claim is ever read from the client.
 */
@ApiTags('user-lifecycle')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
@Controller('user-lifecycle')
export class UserLifecycleController {
  constructor(private readonly lifecycle: UserLifecycleService) {}

  @Get('archived-status')
  archivedStatus(@Query('ids') ids: string) {
    const list = String(ids ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    return this.lifecycle.archivedStatus(list);
  }

  @Get('operations/:operationId')
  operation(@Param('operationId') operationId: string) {
    return this.lifecycle.operationStatus(operationId);
  }

  /** Read-only remediation history of one operation (Phase 1). */
  @Get('operations/:operationId/attempts')
  attempts(@Param('operationId') operationId: string) {
    return this.lifecycle.operationAttempts(operationId);
  }

  @Post('operations/:operationId/archive-cleanup-retry')
  retryArchiveCleanup(@Param('operationId') operationId: string, @CurrentUser() actor: any) {
    return this.lifecycle.retryArchiveCleanup(operationId, actor);
  }

  @Post('operations/:operationId/cleanup-retry')
  retryDeleteCleanup(@Param('operationId') operationId: string, @CurrentUser() actor: any) {
    return this.lifecycle.runCleanup(operationId, actor);
  }

  @Get(':userId/archive/preflight')
  archivePreflight(@Param('userId') userId: string, @CurrentUser() actor: any) {
    return this.lifecycle.archivePreflight(userId, actor);
  }

  @Post(':userId/archive')
  archive(@Param('userId') userId: string, @Body() body: { idempotencyKey?: string }, @CurrentUser() actor: any) {
    return this.lifecycle.archive(userId, actor, { idempotencyKey: body?.idempotencyKey });
  }

  @Get(':userId/permanent-delete/preflight')
  deletePreflight(@Param('userId') userId: string, @CurrentUser() actor: any) {
    return this.lifecycle.deletePreflight(userId, actor);
  }

  @Post(':userId/permanent-delete')
  permanentDelete(
    @Param('userId') userId: string,
    @Body() body: { idempotencyKey?: string; confirmation?: string },
    @CurrentUser() actor: any,
  ) {
    return this.lifecycle.permanentDelete(userId, actor, { idempotencyKey: body?.idempotencyKey, confirmation: body?.confirmation });
  }
}
