import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiCronService } from './ai.cron.service';
import { AiController } from './ai.controller';
import { EmailModule } from '../platform/email/email.module';

@Module({
  imports: [EmailModule],
  providers: [AiService, AiCronService],
  controllers: [AiController],
})
export class AiModule {}
