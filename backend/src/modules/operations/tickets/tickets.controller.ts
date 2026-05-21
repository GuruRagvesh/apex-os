import {
  Controller, Get, Post, Put, Patch, Delete, Body, Param, Query,
  UseGuards, UseInterceptors, UploadedFile, Res, ForbiddenException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { TicketsService } from './tickets.service';
import { UploadsService } from '../../platform/uploads/uploads.service';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { Roles } from '../../../shared/decorators/roles.decorator';

@ApiTags('Tickets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tickets')
export class TicketsController {
  constructor(
    private ticketsService: TicketsService,
    private uploadsService: UploadsService,
  ) {}

  @Get()
  findAll(@Query() query: any, @CurrentUser() user: any) { return this.ticketsService.findAll(query, user); }

  @Get('stats')
  getStats() { return this.ticketsService.getStats(); }

  @Get('kanban')
  getKanban(@Query() query: any, @CurrentUser() user: any) { return this.ticketsService.getKanban(query, user); }

  @Get('export')
  async exportCsv(@Query() query: any, @CurrentUser() user: any, @Res({ passthrough: true }) res: Response) {
    const csv = await this.ticketsService.exportCsv(query, user);
    const filename = `tickets-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return csv;
  }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.ticketsService.findOne(id); }

  @Get(':id/history')
  getHistory(@Param('id') id: string) { return this.ticketsService.getHistory(id); }

  @Post()
  create(@Body() body: any, @CurrentUser() user: any) {
    return this.ticketsService.create(body, user.id, user);
  }

  @Post(':id/attachments')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async uploadAttachment(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: any,
    @CurrentUser() user: any,
  ) {
    // Ownership: only assignee, reporter, or Manager+ may attach
    const ticket = await this.ticketsService.findOne(id);
    const roleName: string = user?.role?.name ?? user?.role ?? '';
    const isManagerPlus = ['MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(roleName);
    const isParticipant = ticket.assignedToId === user.id || ticket.createdById === user.id;
    if (!isManagerPlus && !isParticipant) {
      throw new ForbiddenException('Only the assignee, reporter or a manager can attach files');
    }
    const isPoc = body?.isPoc === 'true' || body?.isPoc === true;
    return this.uploadsService.uploadTicketAttachment(ticket.id, file, isPoc, ticket.id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.ticketsService.update(id, body, user.id, user);
  }

  @Patch(':id')
  patch(@Param('id') id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.ticketsService.update(id, body, user.id, user);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() body: { status: any }, @CurrentUser() user: any) {
    return this.ticketsService.updateStatus(id, body.status, user.id, user);
  }

  @Patch(':id/assign')
  assign(@Param('id') id: string, @Body() body: { assignedToId: string }, @CurrentUser() user: any) {
    return this.ticketsService.assign(id, body.assignedToId, user.id, user);
  }

  @UseGuards(RolesGuard)
  @Roles('MANAGER', 'ADMIN', 'SUPER_ADMIN')
  @Patch(':id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: any) {
    return this.ticketsService.approve(id, user.id);
  }

  @UseGuards(RolesGuard)
  @Roles('MANAGER', 'ADMIN', 'SUPER_ADMIN')
  @Patch(':id/reject')
  reject(
    @Param('id') id: string,
    @Body() body: { comment: string },
    @CurrentUser() user: any,
  ) {
    return this.ticketsService.reject(id, body.comment ?? 'No reason provided', user.id);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    const roleName: string = user?.role?.name || user?.role || '';
    if (!['MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(roleName)) {
      throw new ForbiddenException('Only managers and admins can delete tickets');
    }
    return this.ticketsService.remove(id);
  }
}
