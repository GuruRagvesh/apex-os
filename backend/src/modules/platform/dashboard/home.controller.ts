import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';

@ApiTags('Home')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('home')
export class HomeController {
  constructor(private dashboardService: DashboardService) {}

  @Get('summary')
  getSummary(@CurrentUser() user: any) {
    return this.dashboardService.getSummary(user);
  }
}
