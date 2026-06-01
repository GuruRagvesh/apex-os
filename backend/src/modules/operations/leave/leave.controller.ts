import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { LeaveService } from './leave.service';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { Roles } from '../../../shared/decorators/roles.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { ROLES } from '../../../shared/constants/roles';

@ApiTags('Leave')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('leave')
export class LeaveController {
  constructor(private leaveService: LeaveService) {}

  @Get()
  findAll(@Query() query: any, @CurrentUser() user: any) { return this.leaveService.findAll(query, user); }

  @Get('balance')
  getBalance(@CurrentUser() user: any) {
    return this.leaveService.getUserBalance(user.id, user);
  }

  @Get('balance/:userId')
  getUserBalance(@Param('userId') userId: string, @CurrentUser() user: any) {
    return this.leaveService.getUserBalance(userId, user);
  }

  @Get('stats')
  getStats(@CurrentUser() user: any) { return this.leaveService.getStats(user); }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) { return this.leaveService.findOne(id, user); }

  @Post()
  create(@Body() body: any, @CurrentUser() user: any) {
    return this.leaveService.create(body, user.id);
  }

  @Patch(':id/approve')
  @UseGuards(RolesGuard)
  @Roles(ROLES.TEAM_LEAD, ROLES.MANAGER, ROLES.ADMIN, ROLES.SUPER_ADMIN)
  approve(@Param('id') id: string, @CurrentUser() user: any) {
    return this.leaveService.approve(id, user.id, user);
  }

  @Patch(':id/reject')
  @UseGuards(RolesGuard)
  @Roles(ROLES.TEAM_LEAD, ROLES.MANAGER, ROLES.ADMIN, ROLES.SUPER_ADMIN)
  reject(@Param('id') id: string, @CurrentUser() user: any) {
    return this.leaveService.reject(id, user.id, user);
  }

  @Patch(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: any) {
    return this.leaveService.cancel(id, user.id);
  }
}
