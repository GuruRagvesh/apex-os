import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';

@ApiTags('Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  @Get('overview')
  getOverview(@CurrentUser() user: any) {
    return this.dashboardService.getOverview(user);
  }

  @Get('tickets-by-category')
  getTicketsByCategory(@CurrentUser() user: any) { return this.dashboardService.getTicketsByCategory(user); }

  @Get('tickets-by-department')
  getTicketsByDepartment() { return this.dashboardService.getTicketsByDepartment(); }

  @Get('activity-feed')
  getActivityFeed(@Query('limit') limit?: string) {
    return this.dashboardService.getActivityFeed(limit ? parseInt(limit) : 20);
  }

  @Get('workload')
  getWorkload(@CurrentUser() user: any) { return this.dashboardService.getWorkloadByUser(user); }

  @Get('ticket-trend')
  getTicketTrend(@CurrentUser() user: any, @Query('days') days?: string) {
    return this.dashboardService.getTicketTrend(days ? parseInt(days) : 14, user);
  }
}
