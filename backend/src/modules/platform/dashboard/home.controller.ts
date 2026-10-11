import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { HomeInsightsService } from './home-insights.service';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';

@ApiTags('Home')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('home')
export class HomeController {
  constructor(
    private dashboardService: DashboardService,
    private homeInsights: HomeInsightsService,
  ) {}

  @Get('summary')
  getSummary(@CurrentUser() user: any) {
    return this.dashboardService.getSummary(user);
  }

  /** Hero KPIs for the signed-in user (read-only). */
  @Get('kpis')
  getKpis(@CurrentUser() user: any) {
    return this.homeInsights.getKpis(user);
  }

  /** The signed-in user's own per-day productivity, company-timezone days (read-only). */
  @Get('productivity')
  getProductivity(
    @CurrentUser() user: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.homeInsights.getDailyProductivity(user, from, to);
  }
}
