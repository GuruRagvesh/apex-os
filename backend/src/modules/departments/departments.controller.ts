import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { DepartmentsService } from './departments.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('Departments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('departments')
export class DepartmentsController {
  constructor(private departmentsService: DepartmentsService) {}

  @Get()
  findAll() { return this.departmentsService.findAll(); }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.departmentsService.findOne(id); }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Admin')
  create(@Body() body: { name: string; description?: string; color?: string }) {
    return this.departmentsService.create(body);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles('Admin')
  update(@Param('id') id: string, @Body() body: any) {
    return this.departmentsService.update(id, body);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('Admin')
  remove(@Param('id') id: string) { return this.departmentsService.remove(id); }
}
