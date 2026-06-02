import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
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

  // ── Project list / stats / detail / CRUD ──────────────────────────────────

  @Get()
  findAll(@Query() query: any, @CurrentUser() user: any) { return this.projectsService.findAll(query, user); }

  @Get('stats')
  getStats(@CurrentUser() user: any) { return this.projectsService.getStats(undefined, user); }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) { return this.projectsService.findOne(id, user); }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(ROLES.MANAGER, ROLES.ADMIN, ROLES.SUPER_ADMIN)
  create(@Body() body: any, @CurrentUser() user: any) {
    return this.projectsService.create(body, user.id);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles(ROLES.TEAM_LEAD, ROLES.MANAGER, ROLES.ADMIN, ROLES.SUPER_ADMIN)
  update(@Param('id') id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.projectsService.update(id, body, user);
  }

  // ── Members ───────────────────────────────────────────────────────────────

  @Post(':id/members')
  @UseGuards(RolesGuard)
  @Roles(ROLES.TEAM_LEAD, ROLES.MANAGER, ROLES.ADMIN, ROLES.SUPER_ADMIN)
  addMember(@Param('id') id: string, @Body() body: { userId: string; role?: string }, @CurrentUser() user: any) {
    return this.projectsService.addMember(id, body.userId, body.role, user);
  }

  @Patch(':id/members/:userId')
  @UseGuards(RolesGuard)
  @Roles(ROLES.TEAM_LEAD, ROLES.MANAGER, ROLES.ADMIN, ROLES.SUPER_ADMIN)
  updateMemberRole(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() body: { role: string },
    @CurrentUser() user: any,
  ) {
    return this.projectsService.updateMemberRole(id, userId, body.role, user);
  }

  @Delete(':id/members/:userId')
  @UseGuards(RolesGuard)
  @Roles(ROLES.TEAM_LEAD, ROLES.MANAGER, ROLES.ADMIN, ROLES.SUPER_ADMIN)
  removeMember(@Param('id') id: string, @Param('userId') userId: string, @CurrentUser() user: any) {
    return this.projectsService.removeMember(id, userId, user);
  }

  // ── Stages (reorder MUST come before :stageId to avoid route collision) ───

  @Get(':id/stages')
  listStages(@Param('id') id: string, @CurrentUser() user: any) {
    return this.projectsService.listStages(id, user);
  }

  @Post(':id/stages')
  @UseGuards(RolesGuard)
  @Roles(ROLES.TEAM_LEAD, ROLES.MANAGER, ROLES.ADMIN, ROLES.SUPER_ADMIN)
  createStage(@Param('id') id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.projectsService.createStage(id, body, user);
  }

  @Patch(':id/stages/reorder')
  @UseGuards(RolesGuard)
  @Roles(ROLES.TEAM_LEAD, ROLES.MANAGER, ROLES.ADMIN, ROLES.SUPER_ADMIN)
  reorderStages(@Param('id') id: string, @Body() body: { orderedStageIds: string[] }, @CurrentUser() user: any) {
    return this.projectsService.reorderStages(id, body.orderedStageIds, user);
  }

  @Patch(':id/stages/:stageId')
  @UseGuards(RolesGuard)
  @Roles(ROLES.TEAM_LEAD, ROLES.MANAGER, ROLES.ADMIN, ROLES.SUPER_ADMIN)
  updateStage(
    @Param('id') id: string,
    @Param('stageId') stageId: string,
    @Body() body: any,
    @CurrentUser() user: any,
  ) {
    return this.projectsService.updateStage(id, stageId, body, user);
  }

  @Delete(':id/stages/:stageId')
  @UseGuards(RolesGuard)
  @Roles(ROLES.TEAM_LEAD, ROLES.MANAGER, ROLES.ADMIN, ROLES.SUPER_ADMIN)
  deleteStage(@Param('id') id: string, @Param('stageId') stageId: string, @CurrentUser() user: any) {
    return this.projectsService.deleteStage(id, stageId, user);
  }

  // ── Activity ──────────────────────────────────────────────────────────────

  @Get(':id/activity')
  getActivity(
    @Param('id') id: string,
    @Query('limit') limit: string,
    @CurrentUser() user: any,
  ) {
    return this.projectsService.getActivity(id, Number(limit) || 50, user);
  }

  // ── Archive / Restore ────────────────────────────────────────────────────

  @Patch(':id/archive')
  @UseGuards(RolesGuard)
  @Roles(ROLES.MANAGER, ROLES.ADMIN, ROLES.SUPER_ADMIN)
  archive(@Param('id') id: string, @CurrentUser() user: any) {
    return this.projectsService.archive(id, user);
  }

  @Patch(':id/restore')
  @UseGuards(RolesGuard)
  @Roles(ROLES.MANAGER, ROLES.ADMIN, ROLES.SUPER_ADMIN)
  restore(@Param('id') id: string, @CurrentUser() user: any) {
    return this.projectsService.restore(id, user);
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.projectsService.remove(id, user);
  }
}
