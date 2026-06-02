import { ThrottlerGuard } from '@nestjs/throttler';
import { Injectable } from '@nestjs/common';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const path = req.path || req.url || '';
    if (path.endsWith('/auth/login')) {
      const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown-ip';
      const email = req.body?.email ? String(req.body.email).trim().toLowerCase() : '';
      return `login-${email}-${ip}`;
    }
    return req.ip;
  }
}
