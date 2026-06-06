import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { TaskTypesService } from './task-types.service';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { Roles } from '../../../shared/decorators/roles.decorator';
import { ROLES } from '../../../shared/constants/roles';

@ApiTags('Task Types')
@Controller('task-types')
export class TaskTypesController {
  constructor(private readonly taskTypesService: TaskTypesService) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  getByDepartment(@Query('departmentId') departmentId?: string) {
    return this.taskTypesService.getByDepartment(departmentId);
  }

  @Get('all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  getAll() {
    return this.taskTypesService.getAll();
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  create(@Body() dto: { name: string; departmentId?: string; isGlobal?: boolean }) {
    return this.taskTypesService.create(dto);
  }

  @Post(':id/subtypes')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  createSubtype(@Param('id') id: string, @Body() dto: { name: string }) {
    return this.taskTypesService.createSubtype(id, dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  updateType(@Param('id') id: string, @Body() dto: { name?: string; order?: number }) {
    return this.taskTypesService.updateType(id, dto);
  }

  @Patch(':id/subtypes/:subtypeId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  updateSubtype(@Param('subtypeId') subtypeId: string, @Body() dto: { name?: string; order?: number }) {
    return this.taskTypesService.updateSubtype(subtypeId, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  deleteType(@Param('id') id: string) {
    return this.taskTypesService.deleteType(id);
  }

  @Delete(':id/subtypes/:subtypeId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  deleteSubtype(@Param('subtypeId') subtypeId: string) {
    return this.taskTypesService.deleteSubtype(subtypeId);
  }
}
