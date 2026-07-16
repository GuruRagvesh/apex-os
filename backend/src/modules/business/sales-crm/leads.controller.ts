import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { LeadsService } from './leads.service';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { Roles } from '../../../shared/decorators/roles.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { ROLES } from '../../../shared/constants/roles';

@ApiTags('Sales CRM — Leads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('sales-crm/leads')
export class LeadsController {
  constructor(private leadsService: LeadsService) {}

  @Get()
  findAll(@Query() query: any, @CurrentUser() user: any) {
    return this.leadsService.findAll(query, user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.leadsService.findOne(id, user);
  }

  @Post()
  create(@Body() body: any, @CurrentUser() user: any) {
    return this.leadsService.create(body, user);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.leadsService.update(id, body, user);
  }

  @Patch('bulk')
  bulkUpdate(@Body() body: any, @CurrentUser() user: any) {
    return this.leadsService.bulkUpdate(body, user);
  }

  @Patch(':id/owner')
  reassignOwner(@Param('id') id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.leadsService.reassignOwner(id, body, user);
  }

  @Post(':id/activities')
  addActivity(@Param('id') id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.leadsService.addActivity(id, body, user);
  }

  @Post(':id/followups')
  addFollowup(@Param('id') id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.leadsService.addFollowup(id, body, user);
  }

  @Post(':id/requirements')
  addRequirement(@Param('id') id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.leadsService.addRequirement(id, body, user);
  }

  @Post(':id/deals')
  addDeal(@Param('id') id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.leadsService.addDeal(id, body, user);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.leadsService.remove(id, user);
  }
}
