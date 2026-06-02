import { ThrottlerException, ThrottlerGuard, ThrottlerOptions } from '@nestjs/throttler';
import { ExecutionContext, Injectable } from '@nestjs/common';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  private blockedTrackers = new Map<string, number>();

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const path = req.path || req.url || '';
    if (path.endsWith('/auth/login')) {
      const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown-ip';
      const email = req.body?.email ? String(req.body.email).trim().toLowerCase() : '';
      return `login-${email}-${ip}`;
    }
    return req.ip;
  }

  async handleRequest(
    context: ExecutionContext,
    limit: number,
    ttl: number,
    throttler: ThrottlerOptions,
    getTracker: (req: Record<string, any>) => Promise<string>,
    generateKey: (context: ExecutionContext, tracker: string, throttlerName: string) => string,
  ): Promise<boolean> {
    const { req, res } = this.getRequestResponse(context);
    const tracker = await getTracker(req);
    const key = generateKey(context, tracker, throttler.name);

    const blockedUntil = this.blockedTrackers.get(key);
    if (blockedUntil && Date.now() < blockedUntil) {
      const timeToExpire = Math.ceil((blockedUntil - Date.now()) / 1000);
      res.header(`Retry-After${throttler.name === 'default' ? '' : `-${throttler.name}`}`, timeToExpire.toString());
      throw new ThrottlerException(await this.getErrorMessage(context, { limit, ttl, key, tracker, totalHits: limit + 1, timeToExpire }));
    } else if (blockedUntil && Date.now() >= blockedUntil) {
      this.blockedTrackers.delete(key);
    }

    try {
      return await super.handleRequest(context, limit, ttl, throttler, getTracker, generateKey);
    } catch (e) {
      if (e instanceof ThrottlerException) {
        // Record the block expiration so subsequent hits don't hit the storage and extend TTL
        const headerName = `Retry-After${throttler.name === 'default' ? '' : `-${throttler.name}`}`;
        const retryAfter = res.getHeader(headerName) || res.getHeader(headerName.toLowerCase());
        if (retryAfter) {
          this.blockedTrackers.set(key, Date.now() + Number(retryAfter) * 1000);
        } else {
          this.blockedTrackers.set(key, Date.now() + ttl);
        }
      }
      throw e;
    }
  }
}
