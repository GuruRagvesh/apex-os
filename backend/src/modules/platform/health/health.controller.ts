import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../../../prisma/prisma.service';
import { PunchPhotoStorage } from '../attendance/punch/punch-photo.storage';

/** How long the health probe waits for the database before answering anyway. */
const DB_PROBE_TIMEOUT_MS = 3_000;

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

    // Bounded: when every pooled connection is busy, an unbounded SELECT 1
    // waits for the pool, Render's health probe times out, and Render
    // restarts a process that was alive -- dropping every request in flight.
    // The process answering at all is what proves it is live.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), DB_PROBE_TIMEOUT_MS); }),
      ]);
    } catch {
      database = 'error';
    } finally {
      if (timer) clearTimeout(timer);
    }

    // Readiness, NOT liveness. Attendance photo storage being unconfigured
    // makes punches fail, but the service itself is perfectly alive -- and
    // Render may be polling this route to decide whether to keep it running.
    // So `status` deliberately ignores it.
    //
    // Reports the provider decision PunchPhotoStorage computed at construction.
    // No network call is made here, and no credential, directory or URL is
    // returned.
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      database,
      environment: process.env.APP_ENV || process.env.NODE_ENV || 'development',
      attendancePhotoStorage: {
        provider: this.punchPhotoStorage.providerName(),
        configured: this.punchPhotoStorage.isConfigured(),
      },
    };
  }
}
