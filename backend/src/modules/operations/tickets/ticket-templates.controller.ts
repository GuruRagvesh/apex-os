import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { QuickTicketTemplateInput, TicketTemplatesService } from './ticket-templates.service';

@ApiTags('Ticket Templates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ticket-templates')
export class TicketTemplatesController {
  constructor(private readonly templates: TicketTemplatesService) {}

  @Get()
  list(@CurrentUser() user: any) { return this.templates.list(user); }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: any) { return this.templates.get(id, user); }

  @Post()
  create(@Body() body: QuickTicketTemplateInput, @CurrentUser() user: any) {
    return this.templates.create(body, user);
  }

  @Patch('preference')
  updatePreference(@Body('visibleCount') visibleCount: unknown, @CurrentUser() user: any) {
    return this.templates.updatePreference(visibleCount, user);
  }

  @Patch('reorder')
  reorder(@Body('ids') ids: unknown, @CurrentUser() user: any) {
    return this.templates.reorder(ids, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: QuickTicketTemplateInput, @CurrentUser() user: any) {
    return this.templates.update(id, body, user);
  }

  @Post(':id/duplicate')
  duplicate(@Param('id') id: string, @CurrentUser() user: any) {
    return this.templates.duplicate(id, user);
  }

  @Patch(':id/visibility')
  visibility(@Param('id') id: string, @Body('isVisible') isVisible: unknown, @CurrentUser() user: any) {
    return this.templates.setVisibility(id, isVisible, user);
  }

  @Patch(':id/pin')
  pin(@Param('id') id: string, @Body('isPinned') isPinned: unknown, @CurrentUser() user: any) {
    return this.templates.setPin(id, isPinned, user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.templates.remove(id, user);
  }
}
