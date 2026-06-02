import { AppThrottlerGuard } from '../../src/shared/guards/app-throttler.guard';

describe('AppThrottlerGuard — Rate Limiting Scoping', () => {
  it('generates a key based on normalized email and IP for the login route', async () => {
    const req = {
      path: '/auth/login',
      ip: '1.2.3.4',
      body: { email: '  UserA@Apex.Local  ' },
      headers: {},
    };
    const key = await (AppThrottlerGuard.prototype as any).getTracker(req);
    expect(key).toBe('login-usera@apex.local-1.2.3.4');
  });

  it('generates a distinct key for user B on the same IP', async () => {
    const reqA = {
      path: '/auth/login',
      ip: '1.2.3.4',
      body: { email: 'usera@apex.local' },
      headers: {},
    };
    const reqB = {
      path: '/auth/login',
      ip: '1.2.3.4',
      body: { email: 'userb@apex.local' },
      headers: {},
    };
    const keyA = await (AppThrottlerGuard.prototype as any).getTracker(reqA);
    const keyB = await (AppThrottlerGuard.prototype as any).getTracker(reqB);
    
    expect(keyA).toBe('login-usera@apex.local-1.2.3.4');
    expect(keyB).toBe('login-userb@apex.local-1.2.3.4');
    expect(keyA).not.toBe(keyB); // Different users on same IP do not share bucket
  });

  it('generates key based on IP only for other routes', async () => {
    const req = {
      path: '/auth/forgot-password',
      ip: '1.2.3.4',
      body: { email: 'usera@apex.local' },
      headers: {},
    };
    const key = await (AppThrottlerGuard.prototype as any).getTracker(req);
    expect(key).toBe('1.2.3.4');
  });
});
