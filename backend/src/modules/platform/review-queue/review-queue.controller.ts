import { BadRequestException, Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { ReviewQueueService } from './review-queue.service';
import { isReviewRequestType } from './review-queue.types';

@ApiTags('Unified Review Queue')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('review-queue')
export class ReviewQueueController {
  constructor(private readonly queue: ReviewQueueService) {}

  @Get()
  list(@CurrentUser() user: any, @Query('scope') scope?: string, @Query('origin') origin?: string) {
    // Anything but an explicit `system` is the default queue, which never
    // includes system alerts.
    return this.queue.list(user, scope === 'company' ? 'company' : 'team', origin === 'system' ? 'system' : 'default');
  }

  @Get('counts')
  counts(@CurrentUser() user: any) {
    return this.queue.counts(user);
  }

  @Get(':type/:id')
  detail(@CurrentUser() user: any, @Param('type') type: string, @Param('id') id: string) {
    if (!isReviewRequestType(type)) throw new BadRequestException('Unknown request type');
    return this.queue.detail(user, type, id);
  }

  @Get(':type/:id/forward-candidates')
  candidates(@CurrentUser() user: any, @Param('type') type: string, @Param('id') id: string) {
    if (!isReviewRequestType(type)) throw new BadRequestException('Unknown request type');
    return this.queue.forwardCandidates(user, type, id);
  }

  @Patch(':type/:id/decision')
  decide(@CurrentUser() user: any, @Param('type') type: string, @Param('id') id: string, @Body() body: any) {
    if (!isReviewRequestType(type)) throw new BadRequestException('Unknown request type');
    return this.queue.decide(user, type, id, body);
  }

  @Patch(':type/:id/forward')
  forward(@CurrentUser() user: any, @Param('type') type: string, @Param('id') id: string, @Body() body: any) {
    if (!isReviewRequestType(type)) throw new BadRequestException('Unknown request type');
    return this.queue.forward(user, type, id, body);
  }
}
