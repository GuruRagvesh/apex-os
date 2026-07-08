import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../../../prisma/prisma.service';

@ApiTags('Health')
@SkipThrottle()   // Health checks are called by uptime monitors — exempt from rate limiting
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Health check â€” returns API status and DB connectivity' })
  async check() {
    let database: 'connected' | 'error' = 'connected';

    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'error';
    }

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      database,
      environment: process.env.APP_ENV || process.env.NODE_ENV || 'development',
    };
  }
}
