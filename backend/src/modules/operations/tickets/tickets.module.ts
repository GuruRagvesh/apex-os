import { Module } from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { TicketsController } from './tickets.controller';
import { GatewayModule } from '../../platform/gateway/gateway.module';
import { EmailModule } from '../../platform/email/email.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UploadsModule } from '../../platform/uploads/uploads.module';
import { TicketLedgerService } from './ticket-ledger.service';
import { TicketImportService } from './ticket-import.service';
import { TicketTemplatesController } from './ticket-templates.controller';
import { TicketTemplatesService } from './ticket-templates.service';

@Module({
  imports: [GatewayModule, EmailModule, NotificationsModule, UploadsModule],
  providers: [TicketsService, TicketLedgerService, TicketImportService, TicketTemplatesService],
  controllers: [TicketsController, TicketTemplatesController],
  exports: [TicketsService, TicketLedgerService],
})
export class TicketsModule {}
