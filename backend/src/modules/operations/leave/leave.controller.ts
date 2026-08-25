import { BadRequestException, ConflictException, Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { LeaveService } from './leave.service';
import {
  CompOffAlreadyGrantedError,
  CompOffService,
  CompOffSourceNotQualifyingError,
} from './comp-off.service';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { Roles } from '../../../shared/decorators/roles.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { ROLES } from '../../../shared/constants/roles';
import { LeaveType } from '@prisma/client';

@ApiTags('Leave')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('leave')
export class LeaveController {
  constructor(
    private leaveService: LeaveService,
    private compOff: CompOffService,
  ) {}

  @Get()
  findAll(@Query() query: any, @CurrentUser() user: any) { return this.leaveService.findAll(query, user); }

  @Get('balance')
  getBalance(@CurrentUser() user: any, @Query('type') type?: LeaveType) {
    return this.leaveService.getUserBalance(user.id, user, type);
  }

  @Get('balance/:userId')
  getUserBalance(@Param('userId') userId: string, @CurrentUser() user: any, @Query('type') type?: LeaveType) {
    return this.leaveService.getUserBalance(userId, user, type);
  }

  @Get('stats')
  getStats(@CurrentUser() user: any) { return this.leaveService.getStats(user); }

  @Get('duration')
  getDuration(@Query('startDate') startDate: string, @Query('endDate') endDate: string, @Query('isHalfDay') isHalfDay: string) {
    return this.leaveService.getDurationForRequest(startDate, endDate, isHalfDay === 'true');
  }

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

  /** The authenticated employee's own unexpired comp off credits. */
  @Get('comp-off/me')
  myCompOff(@CurrentUser() user: any) {
    return this.compOff.listAvailable(user.id);
  }

  /**
   * Grants one comp off credit by hand. HR/Admin only.
   *
   * There is no automatic earning path anywhere in the system: management has
   * not defined how much work on a qualifying day earns a credit, so a human
   * decides and the decision is audited. The authority check lives in the
   * service, which uses the same isHR/Admin convention as the rest of the
   * attendance stack rather than a role list that would exclude isHR users.
   */
  @Post('comp-off/grant')
  async grantCompOff(
    @Body()
    body: {
      employeeId: string;
      earnedFromBusinessDate: string;
      reason: string;
      earnedFromWorkSessionId?: string | null;
    },
    @CurrentUser() user: any,
  ) {
    try {
      return await this.compOff.grantManual(user, body);
    } catch (err) {
      if (err instanceof CompOffSourceNotQualifyingError) {
        throw new BadRequestException(err.message);
      }
      if (err instanceof CompOffAlreadyGrantedError) {
        throw new ConflictException(err.message);
      }
      throw err;
    }
  }
}
