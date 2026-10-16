import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { HomeInsightsService } from './home-insights.service';
import { HomeExperienceService } from './home-experience.service';
import { HomeCarouselService } from './home-carousel.service';
import { TeamInsightsService } from './team-insights.service';
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
    private homeExperience: HomeExperienceService,
    private homeCarousel: HomeCarouselService,
    private teamInsights: TeamInsightsService,
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

  @Get('experience')
  getExperience(@CurrentUser() user: any) {
    return this.homeExperience.getExperience(user);
  }

  @Get('carousel')
  getCarousel(@CurrentUser() user: any) {
    return this.homeCarousel.getCarousel(user);
  }

  @Get('team-insights')
  getTeamInsights(
    @CurrentUser() user: any,
    @Query('departmentId') departmentId?: string,
    @Query('personId') personId?: string,
    @Query('month') month?: string,
    @Query('week') week?: string,
  ) {
    return this.teamInsights.getInsights(user, { departmentId, personId, month, week });
  }

  @Get('personal-highlights')
  getPersonalHighlights(@CurrentUser() user: any, @Query('month') month?: string) {
    return this.teamInsights.getPersonalHighlights(user, month);
  }

  @Put('announcements')
  publishAnnouncements(@CurrentUser() user: any, @Body() body: unknown) {
    return this.homeCarousel.publishAnnouncements(user, body);
  }

  @Get('activity')
  getActivity(@CurrentUser() user: any, @Query('scope') scope?: string) {
    return this.homeExperience.getActivity(user, scope);
  }

  @Get('workspace')
  getWorkspace(@CurrentUser() user: any) {
    return this.homeExperience.getWorkspace(user.id);
  }

  @Put('workspace')
  updateWorkspace(@CurrentUser() user: any, @Body() body: unknown) {
    return this.homeExperience.updateWorkspace(user.id, body);
  }
}
