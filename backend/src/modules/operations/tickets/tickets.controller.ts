import {
  Controller, Get, Post, Put, Patch, Delete, Body, Param, Query,
  UseGuards, UseInterceptors, UploadedFile, Res,
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
import { ROLES } from '../../../shared/constants/roles';
import { EventLoggerService, OperationalAction } from '../../../common/services/event-logger.service';

@ApiTags('Tickets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tickets')
export class TicketsController {
  constructor(
    private ticketsService: TicketsService,
    private uploadsService: UploadsService,
    private eventLogger: EventLoggerService,
  ) {}

  @Get()
  findAll(@Query() query: any, @CurrentUser() user: any) { return this.ticketsService.findAll(query, user); }

  @Get('stats')
  getStats(@CurrentUser() user: any) { return this.ticketsService.getStats(user); }

  @Get('sla-risk')
  getSlaRisk(@CurrentUser() user: any) { return this.ticketsService.getSlaRiskCategories(user); }

  @Get('kanban')
  getKanban(@Query() query: any, @CurrentUser() user: any) { return this.ticketsService.getKanban(query, user); }

  @Get('export')
  async exportCsv(@Query() query: any, @CurrentUser() user: any, @Res({ passthrough: true }) res: Response) {
    const csv = await this.ticketsService.exportCsv(query, user);
    const filename = `tickets-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    this.eventLogger.log({
      actorId: user.id,
      entityType: 'Ticket',
      entityId: 'export',
      action: OperationalAction.EXPORT_PERFORMED,
      metadata: { format: 'csv', filters: query },
    }).catch(() => {});
    return csv;
  }

  @Get(':id/attachments/:attachmentId/download')
  async downloadAttachment(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Query('mode') mode: string,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const attachment = await this.ticketsService.getAttachmentForDownload(id, attachmentId, user);
    const file = await this.uploadsService.readAttachment(attachment);
    const filename = String(attachment.filename || 'attachment').replace(/[\r\n"]/g, '_');
    const disposition = mode === 'download' ? 'attachment' : 'inline';

    res.setHeader('Content-Type', file.contentType || attachment.mimeType || 'application/octet-stream');
    res.setHeader('Content-Length', file.buffer.length);
    res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.send(file.buffer);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) { return this.ticketsService.findOne(id, user); }

  @Get(':id/history')
  getHistory(@Param('id') id: string, @CurrentUser() user: any) { return this.ticketsService.getHistory(id, user); }

  @Post()
  create(@Body() body: any, @CurrentUser() user: any) {
    return this.ticketsService.create(body, user.id, user);
  }

  @Post(':id/attachments')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 5 * 1024 * 1024 },  // 5 MB max
    fileFilter: (_req, file, cb) => {
      // Allow images, PDFs, common office docs, and plain text
      const ALLOWED_MIME = [
        'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain', 'text/csv',
        'application/zip',
      ];
      if (ALLOWED_MIME.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error(`File type "${file.mimetype}" is not allowed`), false);
      }
    },
  }))
  async uploadAttachment(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: any,
    @CurrentUser() user: any,
  ) {
    const ticket = await this.ticketsService.findOne(id, user);
    await this.ticketsService.assertCanUploadAttachment(user, ticket);
    const isPoc = body?.isPoc === 'true' || body?.isPoc === true;
    const attachment = await this.uploadsService.uploadTicketAttachment(ticket.id, file, isPoc, ticket.id);
    this.eventLogger.log({
      actorId: user.id,
      entityType: 'Ticket',
      entityId: ticket.id,
      action: OperationalAction.ATTACHMENT_UPLOADED,
      metadata: { ticketId: ticket.ticketId, filename: file.originalname, mimeType: file.mimetype, size: file.size },
    }).catch(() => {});
    return this.ticketsService.sanitizeAttachmentForResponse(ticket.id, attachment);
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

  @Patch(':id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: any) {
    return this.ticketsService.approve(id, user.id, user);
  }

  @Patch(':id/reject')
  reject(
    @Param('id') id: string,
    @Body() body: { comment: string },
    @CurrentUser() user: any,
  ) {
    return this.ticketsService.reject(id, body.comment ?? 'No reason provided', user.id, user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.ticketsService.remove(id, user?.id, user);
  }
}
