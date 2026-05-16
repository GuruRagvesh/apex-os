import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { Roles } from '../../../shared/decorators/roles.decorator';

@ApiTags('Settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('settings')
export class SettingsController {
  @Get('company')
  getCompany() {
    return {
      companyName: 'TechnoEdge Learning Services',
      leaveQuotas: { EMPLOYEE: 12, TEAM_LEAD: 12, MANAGER: 15, INTERN: 6 },
      slaHours: { URGENT: 4, HIGH: 8, MEDIUM: 24, LOW: 72 },
      workingDays: 'Mon-Sat',
    };
  }

  @Patch('company')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  updateCompany(@Body() body: any) {
    return { message: 'Settings saved', settings: body };
  }
}
