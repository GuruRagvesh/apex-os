import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { LeaveService } from './leave.service';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { Roles } from '../../../shared/decorators/roles.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';

@ApiTags('Leave')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('leave')
export class LeaveController {
  constructor(private leaveService: LeaveService) {}

  @Get()
  findAll(@Query() query: any) { return this.leaveService.findAll(query); }

  @Get('stats')
  getStats() { return this.leaveService.getStats(); }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.leaveService.findOne(id); }

  @Post()
  create(@Body() body: any, @CurrentUser() user: any) {
    return this.leaveService.create(body, user.id);
  }

  @Patch(':id/approve')
  @UseGuards(RolesGuard)
  @Roles('Admin', 'Manager')
  approve(@Param('id') id: string, @CurrentUser() user: any) {
    return this.leaveService.approve(id, user.id);
  }

  @Patch(':id/reject')
  @UseGuards(RolesGuard)
  @Roles('Admin', 'Manager')
  reject(@Param('id') id: string, @CurrentUser() user: any) {
    return this.leaveService.reject(id, user.id);
  }

  @Patch(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: any) {
    return this.leaveService.cancel(id, user.id);
  }
}
