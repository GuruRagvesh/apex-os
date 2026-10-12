import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { HomeInsightsService } from './home-insights.service';
import { HomeExperienceService } from './home-experience.service';
import { HomeCarouselService } from './home-carousel.service';
import { DashboardController } from './dashboard.controller';
import { HomeController } from './home.controller';
import { LeaveModule } from '../../operations/leave/leave.module';

@Module({
  imports: [LeaveModule],
  providers: [DashboardService, HomeInsightsService, HomeExperienceService, HomeCarouselService],
  controllers: [DashboardController, HomeController],
})
export class DashboardModule {}
