import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  findAll(@Query() query: { search?: string; departmentId?: string; roleId?: string }) {
    return this.usersService.findAll(query);
  }

  @Get('stats')
  @Roles('Admin', 'Manager', 'ADMIN', 'MANAGER', 'SUPER_ADMIN')
  getStats() {
    return this.usersService.getStats();
  }

  @Get('directory')
  @Roles('Admin', 'Manager', 'ADMIN', 'MANAGER', 'SUPER_ADMIN')
  getDirectory() {
    return this.usersService.getDirectory();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Post()
  @Roles('Admin')
  create(@Body() body: { name: string; email: string; password: string; roleId: string; departmentId?: string }) {
    return this.usersService.create(body);
  }

  @Put(':id')
  @Roles('Admin')
  update(@Param('id') id: string, @Body() body: any) {
    return this.usersService.update(id, body);
  }

  @Put(':id/reset-password')
  @Roles('Admin')
  resetPassword(@Param('id') id: string, @Body() body: { newPassword: string }) {
    return this.usersService.resetPassword(id, body.newPassword);
  }

  @Delete(':id')
  @Roles('Admin')
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}
