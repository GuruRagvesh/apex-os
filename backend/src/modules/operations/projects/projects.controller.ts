import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, ForbiddenException, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ProjectsService } from './projects.service';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { Roles } from '../../../shared/decorators/roles.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { ROLES } from '../../../shared/constants/roles';

@ApiTags('Projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('projects')
export class ProjectsController {
  constructor(private projectsService: ProjectsService) {}

  @Get()
  findAll(@Query() query: any, @CurrentUser() user: any) { return this.projectsService.findAll(query, user); }

  @Get('stats')
  getStats(@CurrentUser() user: any) { return this.projectsService.getStats(undefined, user); }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) { return this.projectsService.findOne(id, user); }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(ROLES.MANAGER, ROLES.ADMIN, ROLES.SUPER_ADMIN)
  create(@Body() body: any, @CurrentUser() user: any) {
    return this.projectsService.create(body, user.id);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles(ROLES.TEAM_LEAD, ROLES.MANAGER, ROLES.ADMIN, ROLES.SUPER_ADMIN)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.projectsService.update(id, body, user);
  }

  @Post(':id/members')
  @UseGuards(RolesGuard)
  @Roles(ROLES.TEAM_LEAD, ROLES.MANAGER, ROLES.ADMIN, ROLES.SUPER_ADMIN)
  addMember(@Param('id', ParseUUIDPipe) id: string, @Body() body: { userId: string; role?: string }, @CurrentUser() user: any) {
    return this.projectsService.addMember(id, body.userId, body.role, user);
  }

  @Delete(':id/members/:userId')
  @UseGuards(RolesGuard)
  @Roles(ROLES.TEAM_LEAD, ROLES.MANAGER, ROLES.ADMIN, ROLES.SUPER_ADMIN)
  removeMember(@Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string, @CurrentUser() user: any) {
    return this.projectsService.removeMember(id, userId, user);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.projectsService.remove(id, user);
  }
}
