import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { AnalyticsService } from './analytics.service';

@ApiTags('Analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('employee/:id?')
  async getEmployeeMetrics(@CurrentUser() user: any, @Param('id') id?: string) {
    const targetUserId = id ?? user.id;
    return this.analyticsService.getEmployeeMetrics(targetUserId, user);
  }

  @Get('reviewer/:id?')
  async getReviewerMetrics(@CurrentUser() user: any, @Param('id') id?: string) {
    const targetUserId = id ?? user.id;
    return this.analyticsService.getReviewerMetrics(targetUserId, user);
  }

  @Get('manager')
  async getManagerMetrics(@CurrentUser() user: any) {
    return this.analyticsService.getManagerMetrics(user);
  }

  @Get('sla')
  async getSlaAnalytics(@CurrentUser() user: any) {
    return this.analyticsService.getSlaAnalytics(user);
  }

  @Get('rework')
  async getReworkAnalytics(@CurrentUser() user: any) {
    return this.analyticsService.getReworkAnalytics(user);
  }

  @Get('command-center')
  async getCommandCenter(@CurrentUser() user: any, @Query('period') period?: 'today' | 'week' | 'month') {
    return this.analyticsService.getCommandCenter(user, period ?? 'today');
  }
}
