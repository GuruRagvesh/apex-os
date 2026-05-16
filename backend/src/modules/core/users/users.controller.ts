import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { Roles } from '../../../shared/decorators/roles.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('me')
  getMe(@CurrentUser() user: any) {
    return this.usersService.findOne(user.id);
  }

  @Get('my-team')
  async getMyTeam(@CurrentUser() user: any) {
    const full = await this.usersService.findOne(user.id);
    const deptId = (full as any)?.departmentId;
    if (!deptId) return [];
    const team = await this.usersService.findAll({ departmentId: deptId });
    return team.filter((u: any) => u.id !== user.id);
  }

  @Patch('me')
  updateMe(@CurrentUser() user: any, @Body() body: { name?: string; avatar?: string }) {
    return this.usersService.update(user.id, body);
  }

  @Patch('me/preferences')
  updatePreferences(@CurrentUser() user: any, @Body() body: any) {
    return { message: 'Preferences saved', preferences: body };
  }

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
  @UseGuards(RolesGuard) @Roles('ADMIN', 'SUPER_ADMIN')
  create(@Body() body: { name: string; email: string; password: string; roleId: string; departmentId?: string }) {
    return this.usersService.create(body);
  }

  @Put(':id')
  @UseGuards(RolesGuard) @Roles('ADMIN', 'SUPER_ADMIN')
  update(@Param('id') id: string, @Body() body: any) {
    return this.usersService.update(id, body);
  }

  @Put(':id/reset-password')
  @UseGuards(RolesGuard) @Roles('ADMIN', 'SUPER_ADMIN')
  resetPassword(@Param('id') id: string, @Body() body: { newPassword: string }) {
    return this.usersService.resetPassword(id, body.newPassword);
  }

  @Delete(':id')
  @UseGuards(RolesGuard) @Roles('ADMIN', 'SUPER_ADMIN')
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}
