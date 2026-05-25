import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { HomeController } from './home.controller';

@Module({
  providers: [DashboardService],
  controllers: [DashboardController, HomeController],
})
export class DashboardModule {}
