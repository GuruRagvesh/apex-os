import { Body, Controller, Get, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { CreateWorkdayNoteDto } from './dto/create-workday-note.dto';
import { WorkdayNotesService } from './workday-notes.service';

@ApiTags('Workday Notes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('workday-notes')
export class WorkdayNotesController {
  constructor(private readonly notes: WorkdayNotesService) {}

  @Get()
  list(@Request() req: any, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.notes.list(req.user.id ?? req.user.sub, Number(page), Number(limit));
  }

  @Post()
  create(@Request() req: any, @Body() dto: CreateWorkdayNoteDto) {
    return this.notes.create(req.user.id ?? req.user.sub, dto);
  }
}
