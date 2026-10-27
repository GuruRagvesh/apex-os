import { readFileSync } from 'fs';
import { resolve } from 'path';
import { resolveCorsOrigins } from '../../src/shared/config/cors-origins';

// The staging frontend at apex-os-frontend-staging.vercel.app was not in the
// allowlist, so every browser call from it — login and forgot-password
// included — failed as an opaque "Network Error". These tests pin the
// allowlist and, more importantly, pin the two things that must never be
// traded away to fix such a failure: no wildcard, and no pattern match over
// vercel.app.

const STAGING = 'https://apex-os-frontend-staging.vercel.app';
const PRODUCTION = 'https://apex-os-frontend.vercel.app';

describe('CORS allowlist', () => {
  it('allows the staging frontend', () => {
    expect(resolveCorsOrigins({})).toContain(STAGING);
  });

  it('still allows every previously allowed origin', () => {
    const origins = resolveCorsOrigins({});

    for (const previous of [
      'http://localhost:3000',
      'http://localhost:3001',
      'https://apex-os.vercel.app',
      PRODUCTION,
      'https://apex-os-frontend-git-main-guru-ragvesh-thanumoorthys-projects.vercel.app',
    ]) {
      expect(origins).toContain(previous);
    }
  });

  it('keeps working without any environment variable set', () => {
    // Staging must not depend on a var that could go missing on one service.
    expect(resolveCorsOrigins({})).toContain(STAGING);
  });

  it('still honours FRONTEND_URL, the pre-existing mechanism', () => {
    const origins = resolveCorsOrigins({ FRONTEND_URL: 'https://custom.example.com' });

    expect(origins).toContain('https://custom.example.com');
    expect(origins).toContain(PRODUCTION);
  });

  it('accepts several origins from either variable', () => {
    const origins = resolveCorsOrigins({
      FRONTEND_URL: 'https://a.example.com,https://b.example.com',
      CORS_ORIGINS: 'https://c.example.com',
    });

    expect(origins).toEqual(expect.arrayContaining([
      'https://a.example.com',
      'https://b.example.com',
      'https://c.example.com',
    ]));
  });

  it('tolerates a trailing slash, which would otherwise never match', () => {
    // A browser sends `https://host`, so `https://host/` would fail silently.
    const origins = resolveCorsOrigins({ FRONTEND_URL: 'https://custom.example.com/' });

    expect(origins).toContain('https://custom.example.com');
    expect(origins).not.toContain('https://custom.example.com/');
  });

  it('ignores blank and whitespace-only configuration', () => {
    const origins = resolveCorsOrigins({ FRONTEND_URL: '  ', CORS_ORIGINS: ',,' });

    expect(origins).not.toContain('');
    expect(origins).toEqual(resolveCorsOrigins({}));
  });

  it('never contains a wildcard', () => {
    // Every request carries credentials; a wildcard is both refused by the
    // browser and a removal of the check itself.
    expect(resolveCorsOrigins({ FRONTEND_URL: '*' })).toEqual(
      expect.not.arrayContaining(['*']),
    );
  });

  it('lists exact origins only, never a vercel.app pattern', () => {
    // Preview URLs on that domain are public: a pattern would open a
    // credentialed cross-origin channel to anyone's deployment.
    for (const origin of resolveCorsOrigins({})) {
      expect(origin).not.toContain('*');
      expect(origin).toMatch(/^https?:\/\/[^*]+$/);
    }
  });
});

describe('CORS behaviour through the real middleware', () => {
  // Asserting the array is not enough — what matters is the header a browser
  // actually receives, so this drives the same `cors` package Nest uses.
  const cors = require('cors');

  const request = (origin?: string, method = 'GET') =>
    new Promise<{ status: number; headers: Record<string, any>; nextCalled: boolean }>(
      (done) => {
        const middleware = cors({
          origin: resolveCorsOrigins({}),
          credentials: true,
          methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
          allowedHeaders: ['Content-Type', 'Authorization'],
        });

        const headers: Record<string, any> = {};
        const req: any = {
          method,
          headers: origin ? { origin } : {},
        };
        const res: any = {
          statusCode: 200,
          setHeader: (k: string, v: any) => {
            headers[k.toLowerCase()] = v;
          },
          getHeader: (k: string) => headers[k.toLowerCase()],
          end: () => done({ status: res.statusCode, headers, nextCalled: false }),
        };
        middleware(req, res, () => done({ status: res.statusCode, headers, nextCalled: true }));
      },
    );

  it('echoes the staging origin back, not a wildcard', async () => {
    const { headers } = await request(STAGING);

    expect(headers['access-control-allow-origin']).toBe(STAGING);
    expect(headers['access-control-allow-origin']).not.toBe('*');
    expect(headers['access-control-allow-credentials']).toBe('true');
  });

  it('answers the preflight for a login POST', async () => {
    const { headers, nextCalled } = await request(STAGING, 'OPTIONS');

    expect(headers['access-control-allow-origin']).toBe(STAGING);
    expect(String(headers['access-control-allow-methods'])).toContain('POST');
    expect(String(headers['access-control-allow-headers'])).toContain('Content-Type');
    // The preflight is answered here rather than falling through to the route.
    expect(nextCalled).toBe(false);
  });

  it('still echoes the production origin', async () => {
    const { headers } = await request(PRODUCTION);

    expect(headers['access-control-allow-origin']).toBe(PRODUCTION);
  });

  it('sends no allow-origin header to an untrusted origin', async () => {
    const { headers } = await request('https://attacker.example.com');

    // Without the header the browser blocks the response, which is the point.
    expect(headers['access-control-allow-origin']).toBeUndefined();
  });

  it('refuses a lookalike vercel.app origin', async () => {
    const { headers } = await request('https://apex-os-frontend-staging.attacker.vercel.app');

    expect(headers['access-control-allow-origin']).toBeUndefined();
  });

  it('leaves a request with no Origin header alone', async () => {
    // Render's health probe and any server-to-server call: not a browser, no
    // Origin sent, and it must not be blocked.
    const { headers, nextCalled } = await request(undefined);

    expect(headers['access-control-allow-origin']).toBeUndefined();
    expect(nextCalled).toBe(true);
  });
});

describe('bootstrap wiring', () => {
  const MAIN = readFileSync(resolve(__dirname, '../../src/main.ts'), 'utf8');

  it('builds the allowlist from the shared resolver, not a second inline list', () => {
    expect(MAIN).toMatch(/resolveCorsOrigins\(\)/);
    expect(MAIN).toMatch(/origin: corsOrigins/);
    // The old inline array is gone, so the two cannot drift apart.
    expect(MAIN).not.toMatch(/'https:\/\/apex-os\.vercel\.app'/);
  });

  it('keeps credentials on and never widens to a wildcard', () => {
    expect(MAIN).toMatch(/credentials: true/);
    expect(MAIN).not.toMatch(/origin: '\*'/);
  });
});
