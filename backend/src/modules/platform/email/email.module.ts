import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../../prisma/prisma.module';
import { EmailService } from './email.service';

@Module({
  imports: [PrismaModule, ConfigModule],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
