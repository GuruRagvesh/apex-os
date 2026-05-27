import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { CommentsService } from './comments.service';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';

@ApiTags('Comments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tickets/:ticketId/comments')
export class CommentsController {
  constructor(private commentsService: CommentsService) {}

  @Get()
  findAll(@Param('ticketId') ticketId: string, @CurrentUser() user: any) {
    return this.commentsService.findByTicket(ticketId, user);
  }

  @Post()
  create(@Param('ticketId') ticketId: string, @Body() body: { content: string }, @CurrentUser() user: any) {
    return this.commentsService.create(ticketId, body.content, user.id, user);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: { content: string }, @CurrentUser() user: any) {
    return this.commentsService.update(id, body.content, user.id, user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.commentsService.remove(id, user.id, user.role?.name, user);
  }
}
