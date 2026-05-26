import { Controller, Get, Post, Put, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { DepartmentsService } from './departments.service';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { Roles } from '../../../shared/decorators/roles.decorator';
import { ROLES } from '../../../shared/constants/roles';

@ApiTags('Departments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('departments')
export class DepartmentsController {
  constructor(private departmentsService: DepartmentsService) {}

  @Get()
  findAll() {
    return this.departmentsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.departmentsService.findOne(id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  create(@Body() body: { name: string; description?: string; color?: string }) {
    return this.departmentsService.create(body);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  update(@Param('id') id: string, @Body() body: any) {
    return this.departmentsService.update(id, body);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  patch(@Param('id') id: string, @Body() body: any) {
    return this.departmentsService.update(id, body);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  remove(@Param('id') id: string) {
    return this.departmentsService.remove(id);
  }
}
