import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { HomeInsightsService } from './home-insights.service';
import { DashboardController } from './dashboard.controller';
import { HomeController } from './home.controller';
import { LeaveModule } from '../../operations/leave/leave.module';

@Module({
  imports: [LeaveModule],
  providers: [DashboardService, HomeInsightsService],
  controllers: [DashboardController, HomeController],
})
export class DashboardModule {}
