import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { LeadsService } from './leads.service';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';

@ApiTags('Sales CRM — Leads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('sales-crm/leads')
export class LeadsController {
  constructor(private leadsService: LeadsService) {}

  // Phase 2.1 skeleton only — confirms the module/controller/service/guard
  // chain resolves end-to-end. Real CRUD routes land in Phase 2.2.
  @Get('_status')
  getStatus() {
    return this.leadsService.getStatus();
  }
}
