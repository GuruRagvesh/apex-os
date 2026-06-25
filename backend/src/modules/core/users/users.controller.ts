import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, UseGuards, UseInterceptors, UploadedFile, Request, Res } from '@nestjs/common';
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
    if (body.name     !== undefined) data.name     = body.name;
    if (body.avatar   !== undefined) data.avatar   = body.avatar;
    if (body.photoUrl !== undefined) data.photoUrl = body.photoUrl;
    if (body.bio      !== undefined) data.bio      = body.bio;
    return this.usersService.update(user.id, data);
  }

  @Post('me/photo')
  @UseInterceptors(FileInterceptor('photo'))
  async uploadPhoto(
    @CurrentUser() user: any,
    @UploadedFile() file: Express.Multer.File,
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
  create(@Body() body: { name: string; email: string; password: string; roleId: string; departmentId?: string }, @CurrentUser() actor: any) {
    return this.usersService.create(body, actor?.id);
  }

  @Put(':id')
  @UseGuards(RolesGuard) @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  update(@Param('id') id: string, @Body() body: any, @CurrentUser() actor: any) {
    return this.usersService.update(id, body, actor?.id);
  }

  @Put(':id/reset-password')
  @UseGuards(RolesGuard) @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  resetPassword(@Param('id') id: string, @Body() body: { newPassword: string }) {
    return this.usersService.resetPassword(id, body.newPassword);
  }

  @Post(':id/archive-after-backup')
  @UseGuards(RolesGuard) @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  archiveAfterBackup(
    @Param('id') id: string,
    @Body() body: { confirmBackupDownloaded: boolean },
    @CurrentUser() actor: any,
  ) {
    return this.usersService.archiveAfterBackup(id, actor?.id, body.confirmBackupDownloaded);
  }

  @Delete(':id/permanent')
  @UseGuards(RolesGuard) @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  async permanentDelete(@Param('id') id: string, @CurrentUser() actor: any) {
    return this.usersService.permanentDelete(id, actor?.id);
  }

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
  @UseInterceptors(FileInterceptor('file'))
  uploadDocument(
    @Param('id') id: string,
    @Request() req: any,
    @UploadedFile() file: Express.Multer.File,
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
