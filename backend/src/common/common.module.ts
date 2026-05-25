import { Module, Global } from '@nestjs/common';
import { EventLoggerService } from './services/event-logger.service';
import { PrismaModule } from '../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [EventLoggerService],
  exports: [EventLoggerService],
})
export class CommonModule {}
