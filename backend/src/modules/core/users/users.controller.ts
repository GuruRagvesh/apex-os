import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, UseGuards, UseInterceptors, UploadedFile, Request } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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

  @Patch('me/preferences')
  updatePreferences(@CurrentUser() user: any, @Body() body: any) {
    return { message: 'Preferences saved', preferences: body };
  }

  @Get()
  findAll(@Query() query: { search?: string; departmentId?: string; roleId?: string }) {
    return this.usersService.findAll(query);
  }

  @Get('stats')
  @UseGuards(RolesGuard) @Roles('MANAGER', 'ADMIN', 'SUPER_ADMIN')
  getStats() {
    return this.usersService.getStats();
  }

  @Get('directory')
  @UseGuards(RolesGuard) @Roles('MANAGER', 'ADMIN', 'SUPER_ADMIN')
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

  @Get(':id/profile')
  getProfile(@Param('id') id: string, @Request() req: any) {
    return this.usersService.getProfile(req.user.id ?? req.user.sub, id);
  }

  @Patch(':id/profile')
  updateProfile(@Param('id') id: string, @Request() req: any, @Body() dto: any) {
    return this.usersService.updateProfile(req.user.id ?? req.user.sub, id, dto);
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
