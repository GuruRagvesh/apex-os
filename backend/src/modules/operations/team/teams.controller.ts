import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { TeamsService } from './teams.service';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { Roles } from '../../../shared/decorators/roles.decorator';
import { ROLES } from '../../../shared/constants/roles';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { AddTeamMemberDto } from './dto/add-team-member.dto';
import { UpdateTeamMemberDto } from './dto/update-team-member.dto';

@ApiTags('Teams')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('teams')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Get()
  findAll(@CurrentUser() user: any, @Query('departmentId') departmentId?: string) {
    return this.teamsService.findAll(user, departmentId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.teamsService.findOne(id, user);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.MANAGER)
  create(@Body() dto: CreateTeamDto, @CurrentUser() user: any) {
    return this.teamsService.create(dto, user);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.MANAGER)
  update(@Param('id') id: string, @Body() dto: UpdateTeamDto, @CurrentUser() user: any) {
    return this.teamsService.update(id, dto, user);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.MANAGER)
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.teamsService.remove(id, user);
  }

  @Post(':id/members')
  @UseGuards(RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.MANAGER)
  addMember(@Param('id') id: string, @Body() dto: AddTeamMemberDto, @CurrentUser() user: any) {
    return this.teamsService.addMember(id, dto, user);
  }

  @Patch(':id/members/:userId')
  @UseGuards(RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.MANAGER)
  updateMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateTeamMemberDto,
    @CurrentUser() user: any,
  ) {
    return this.teamsService.updateMember(id, userId, dto, user);
  }

  @Delete(':id/members/:userId')
  @UseGuards(RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.MANAGER)
  removeMember(@Param('id') id: string, @Param('userId') userId: string, @CurrentUser() user: any) {
    return this.teamsService.removeMember(id, userId, user);
  }
}
