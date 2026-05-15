import { Controller, Post, Body, Param, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AiService } from './ai.service';
import { AiCronService } from './ai.cron.service';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';

@ApiTags('AI Assistant')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Throttle({ default: { limit: 10, ttl: 60000 } })
@Controller('ai')
export class AiController {
  constructor(
    private aiService: AiService,
    private aiCronService: AiCronService,
  ) {}

  /** A) Suggest priority for a new ticket */
  @Post('suggest-priority')
  suggestPriority(@Body() body: { title: string; description?: string }) {
    return this.aiService.suggestPriority(body.title, body.description ?? '');
  }

  /** B) Summarise all open/in-progress tickets (Admin/Manager only) */
  @UseGuards(RolesGuard)
  @Roles('Admin', 'Manager')
  @Post('summarize-tickets')
  summarizeTickets() {
    return this.aiService.summarizeTickets();
  }

  /** C) AI suggestions for a specific ticket */
  @Post('ticket-suggestions/:id')
  ticketSuggestions(@Param('id') id: string) {
    return this.aiService.ticketSuggestions(id);
  }

  /** D) Manually trigger the daily digest (Admin only, for testing) */
  @UseGuards(RolesGuard)
  @Roles('Admin')
  @Post('trigger-digest')
  triggerDigest() {
    return this.aiCronService.triggerDigestNow();
  }
}
