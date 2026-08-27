import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../../../prisma/prisma.service';
import { PunchPhotoStorage } from '../attendance/punch/punch-photo.storage';

@ApiTags('Health')
@SkipThrottle()   // Health checks are called by uptime monitors — exempt from rate limiting
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly punchPhotoStorage: PunchPhotoStorage,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Health check â€” returns API status and DB connectivity' })
  async check() {
    let database: 'connected' | 'error' = 'connected';

    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'error';
    }

    // Readiness, NOT liveness. Attendance photo storage being unconfigured
    // makes punches fail, but the service itself is perfectly alive -- and
    // Render may be polling this route to decide whether to keep it running.
    // So `status` deliberately ignores it.
    //
    // Reports the flag PunchPhotoStorage computed at construction. No network
    // call is made here, and no credential -- not the cloud name, key, secret,
    // or any URL -- is read or returned; only whether all three were present.
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      database,
      environment: process.env.APP_ENV || process.env.NODE_ENV || 'development',
      attendancePhotoStorage: {
        provider: 'cloudinary',
        configured: this.punchPhotoStorage.isConfigured(),
      },
    };
  }
}
