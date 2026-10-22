import { BadRequestException, Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, UseGuards, UseInterceptors, UploadedFile, Request, Res } from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { Roles } from '../../../shared/decorators/roles.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { ROLES } from '../../../shared/constants/roles';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('me')
  getMe(@CurrentUser() user: any) {
    return this.usersService.findOne(user.id, user);
  }

  @Get('my-team')
  async getMyTeam(@CurrentUser() user: any) {
    return this.usersService.getMyTeam(user.id, user.role?.name ?? user.role ?? '');
  }

  @Patch('me')
  updateMe(@CurrentUser() user: any, @Body() body: any) {
    // Only allow safe fields to prevent unknown-field Prisma errors
    const data: any = {};
    if (body?.name !== undefined) {
      if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 100) {
        throw new BadRequestException('Display name must be 1 to 100 characters');
      }
      data.name = body.name.trim();
    }
    if (body?.avatar !== undefined) {
      if (typeof body.avatar !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(body.avatar)) {
        throw new BadRequestException('Invalid avatar colour');
      }
      data.avatar = body.avatar;
    }
    if (body?.bio !== undefined) {
      if (typeof body.bio !== 'string' || body.bio.length > 200) {
        throw new BadRequestException('Bio must be at most 200 characters');
      }
      data.bio = body.bio;
    }
    return this.usersService.update(user.id, data);
  }

  @Get('me/availability')
  getAvailability(@CurrentUser() user: any) {
    return this.usersService.getAvailability(user.id ?? user.sub);
  }

  @Patch('me/availability')
  setAvailability(
    @CurrentUser() user: any,
    @Body() body: { status?: string; durationMinutes?: number | null },
  ) {
    return this.usersService.setAvailability(user.id ?? user.sub, body?.status ?? '', body?.durationMinutes);
  }

  @Post('me/photo')
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: 2 * 1024 * 1024 } }))
  async uploadPhoto(
    @CurrentUser() user: any,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.usersService.uploadPhoto(user.id, file);
  }

  @Delete('me/photo')
  async removePhoto(@CurrentUser() user: any) {
    return this.usersService.removePhoto(user.id);
  }

  @Get('me/preferences')
  getPreferences(@CurrentUser() user: any) {
    return this.usersService.getPreferences(user.id ?? user.sub);
  }

  @Patch('me/preferences')
  async updatePreferences(@CurrentUser() user: any, @Body() body: any) {
    return this.usersService.savePreferences(user.id ?? user.sub, body);
  }

  /** Read-only setup health (Phase 1). Authority is checked in the service: Admin, Super Admin or isHR. */
  @Get(':userId/setup-issues')
  setupIssues(@Param('userId') userId: string, @CurrentUser() user: any) {
    return this.usersService.listSetupIssues(userId, user);
  }

  @Get()
  findAll(@Query() query: { search?: string; departmentId?: string; roleId?: string }, @CurrentUser() user: any) {
    return this.usersService.findAll(query, user);
  }

  @Get('stats')
  @UseGuards(RolesGuard) @Roles(ROLES.MANAGER, ROLES.ADMIN, ROLES.SUPER_ADMIN)
  getStats() {
    return this.usersService.getStats();
  }

  @Get('directory')
  @UseGuards(RolesGuard) @Roles(ROLES.MANAGER, ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.TEAM_LEAD, ROLES.EMPLOYEE, ROLES.INTERN)
  getDirectory(@CurrentUser() user: any) {
    return this.usersService.getDirectory(user);
  }

  @Get(':id/backup')
  @UseGuards(RolesGuard) @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  async downloadBackup(
    @Param('id') id: string,
    @CurrentUser() actor: any,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.usersService.generateBackup(id, actor?.id);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    });
    res.end(buffer);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.usersService.findOne(id, user);
  }

  @Post()
  @UseGuards(RolesGuard) @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  create(
    @Body()
    body: {
      name: string;
      email: string;
      password: string;
      roleId: string;
      departmentId?: string | null;
      joiningDate?: string;
    },
    @CurrentUser() actor: any,
  ) {
    return this.usersService.create(body, actor?.id);
  }

  @Put(':id')
  @UseGuards(RolesGuard) @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  update(@Param('id') id: string, @Body() body: any, @CurrentUser() actor: any) {
    return this.usersService.update(id, body, actor?.id);
  }

  @Post(':id/rehire')
  @UseGuards(RolesGuard) @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  rehire(
    @Param('id') id: string,
    @Body()
    body: {
      password: string;
      roleId: string;
      departmentId?: string | null;
      joiningDate?: string;
      name?: string;
      email?: string;
    },
    @CurrentUser() actor: any,
  ) {
    return this.usersService.rehire(id, body, actor?.id);
  }

  /** Deactivated users only; archived users use Rehire (Phase 2, B6). */
  @Post(':id/reactivate')
  @UseGuards(RolesGuard) @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  reactivate(
    @Param('id') id: string,
    @Body() body: { roleId?: string; departmentId?: string | null } | undefined,
    @CurrentUser() actor: any,
  ) {
    return this.usersService.reactivate(id, body ?? {}, actor?.id);
  }

  @Put(':id/reset-password')
  @UseGuards(RolesGuard) @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  resetPassword(@Param('id') id: string, @Body() body: { newPassword: string }) {
    return this.usersService.resetPassword(id, body.newPassword);
  }

  // Archive User and permanent deletion moved to UserLifecycleController
  // (/user-lifecycle/...). The old routes are gone: archiving now closes
  // active work and verifies a complete archive, and permanent deletion is
  // available only for archived users with a verified snapshot.

  @Delete(':id')
  @UseGuards(RolesGuard) @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  remove(@Param('id') id: string, @CurrentUser() actor: any) {
    return this.usersService.remove(id, actor?.id);
  }

  @Get(':id/profile')
  getProfile(@Param('id') id: string, @Request() req: any) {
    return this.usersService.getProfile(req.user.id ?? req.user.sub, id);
  }

  @Patch(':id/profile')
  updateProfile(@Param('id') id: string, @Request() req: any, @Body() dto: any) {
    return this.usersService.updateProfile(req.user.id ?? req.user.sub, id, dto);
  }

  @Patch(':id/admin-correction')
  @UseGuards(RolesGuard) @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  adminCorrection(
    @Param('id') id: string,
    @Body() body: { email: string; reason: string },
    @CurrentUser() actor: any,
  ) {
    return this.usersService.adminCorrectEmail(actor.id, id, body.email, body.reason);
  }

  @Post(':id/documents')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  uploadDocument(
    @Param('id') id: string,
    @Request() req: any,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('documentType') documentType: string,
  ) {
    return this.usersService.uploadDocument(req.user.id ?? req.user.sub, id, file, documentType);
  }

  @Get(':id/documents')
  getDocuments(@Param('id') id: string, @Request() req: any) {
    return this.usersService.getDocuments(req.user.id ?? req.user.sub, id);
  }

  @Delete(':id/documents/:docId')
  deleteDocument(
    @Param('id') id: string,
    @Param('docId') docId: string,
    @Request() req: any,
  ) {
    return this.usersService.deleteDocument(req.user.id ?? req.user.sub, id, docId);
  }

  @Patch(':id/documents/:docId/verify')
  verifyDocument(
    @Param('id') id: string,
    @Param('docId') docId: string,
    @Request() req: any,
    @Body() body: { status: string; rejectionReason?: string },
  ) {
    return this.usersService.verifyDocument(req.user.id ?? req.user.sub, id, docId, body.status, body.rejectionReason);
  }
}
