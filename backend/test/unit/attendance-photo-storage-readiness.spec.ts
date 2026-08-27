import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { HealthController } from '../../src/modules/platform/health/health.controller';
import { PunchPhotoStorage } from '../../src/modules/platform/attendance/punch/punch-photo.storage';

// PunchPhotoStorage fails closed: with Cloudinary unconfigured every punch is
// refused with 503. The startup warning checked CLOUDINARY_CLOUD_NAME alone, so
// setting just that name silenced the log while punches kept failing. These
// tests pin the real rule — all three, or not configured — and pin it in the
// one place that decides it.

const CLOUD = 'staging-cloud-name';
const KEY = 'staging-api-key-value';
const SECRET = 'staging-api-secret-value';

/** A ConfigService that answers only from the given map. */
const config = (vars: Record<string, string>) =>
  ({ get: (k: string) => vars[k] }) as unknown as ConfigService;

const storageWith = (vars: Record<string, string>) => new PunchPhotoStorage(config(vars));

describe('PunchPhotoStorage configuration rule', () => {
  it('is configured only when all three variables are present', () => {
    expect(
      storageWith({
        CLOUDINARY_CLOUD_NAME: CLOUD,
        CLOUDINARY_API_KEY: KEY,
        CLOUDINARY_API_SECRET: SECRET,
      }).isConfigured(),
    ).toBe(true);
  });

  it('is NOT configured with the cloud name alone', () => {
    // Exactly the trap: this combination silenced the old startup warning.
    expect(storageWith({ CLOUDINARY_CLOUD_NAME: CLOUD }).isConfigured()).toBe(false);
  });

  it('is NOT configured with cloud name and API key but no secret', () => {
    expect(
      storageWith({
        CLOUDINARY_CLOUD_NAME: CLOUD,
        CLOUDINARY_API_KEY: KEY,
      }).isConfigured(),
    ).toBe(false);
  });

  it('is NOT configured with no variables at all', () => {
    expect(storageWith({}).isConfigured()).toBe(false);
  });

  it('refuses to upload rather than falling back to storing bytes elsewhere', async () => {
    const storage = storageWith({});
    await expect(storage.upload('user-1', Buffer.from('x'), 'image/jpeg')).rejects.toThrow(
      /not configured/i,
    );
  });
});

describe('health readiness reporting', () => {
  const prismaOk = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) } as any;

  const controllerWith = (vars: Record<string, string>, prisma = prismaOk) =>
    new HealthController(prisma, storageWith(vars));

  const configured = {
    CLOUDINARY_CLOUD_NAME: CLOUD,
    CLOUDINARY_API_KEY: KEY,
    CLOUDINARY_API_SECRET: SECRET,
  };

  it('reports configured storage without revealing anything about it', async () => {
    const body: any = await controllerWith(configured).check();

    expect(body.attendancePhotoStorage).toEqual({
      provider: 'cloudinary',
      configured: true,
    });

    // No credential may appear anywhere in the response, at any depth.
    const serialized = JSON.stringify(body);
    for (const secret of [CLOUD, KEY, SECRET]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).not.toMatch(/api[_-]?key/i);
    expect(serialized).not.toMatch(/secret/i);
    expect(serialized).not.toMatch(/cloudinary\.com|res\.cloudinary/i);
  });

  it('reports unconfigured storage', async () => {
    const body: any = await controllerWith({}).check();

    expect(body.attendancePhotoStorage).toEqual({
      provider: 'cloudinary',
      configured: false,
    });
  });

  it('stays healthy when photo storage is unconfigured', async () => {
    // Render may poll this route for liveness. An unconfigured optional
    // provider must never be able to take the service down.
    const body: any = await controllerWith({}).check();

    expect(body.status).toBe('ok');
    expect(body.database).toBe('connected');
  });

  it('makes no network call to Cloudinary', async () => {
    // isConfigured() reads a boolean computed at construction. If /health ever
    // reached out to the provider, a health check would start failing for
    // reasons that have nothing to do with this service being alive.
    const cloudinary = require('cloudinary').v2;
    const uploadSpy = jest.spyOn(cloudinary.uploader, 'upload_stream');
    const urlSpy = jest.spyOn(cloudinary, 'url');

    await controllerWith(configured).check();

    expect(uploadSpy).not.toHaveBeenCalled();
    expect(urlSpy).not.toHaveBeenCalled();

    uploadSpy.mockRestore();
    urlSpy.mockRestore();
  });

  it('leaves the existing database and environment checks alone', async () => {
    const body: any = await controllerWith(configured).check();

    expect(body.status).toBe('ok');
    expect(body.version).toBe('1.0.0');
    expect(body.database).toBe('connected');
    expect(typeof body.timestamp).toBe('string');
    expect(body.environment).toBeDefined();
    expect(prismaOk.$queryRaw).toHaveBeenCalled();
  });

  it('still reports a database error, and does so independently of storage', async () => {
    const failing = { $queryRaw: jest.fn().mockRejectedValue(new Error('down')) } as any;
    const body: any = await controllerWith(configured, failing).check();

    expect(body.database).toBe('error');
    // The two answers are separate facts.
    expect(body.attendancePhotoStorage.configured).toBe(true);
  });
});

describe('startup warning', () => {
  const MAIN = readFileSync(resolve(__dirname, '../../src/main.ts'), 'utf8');

  it('treats storage as configured only when all three variables are present', () => {
    expect(MAIN).toMatch(
      /const cloudinaryKeys = \[\s*'CLOUDINARY_CLOUD_NAME',\s*'CLOUDINARY_API_KEY',\s*'CLOUDINARY_API_SECRET',?\s*\]/,
    );
    expect(MAIN).toMatch(/Attendance photo storage is not fully configured/);
  });

  it('no longer warns on the cloud name alone', () => {
    // The old line paired OPENAI_API_KEY with CLOUDINARY_CLOUD_NAME.
    expect(MAIN).not.toMatch(/\['OPENAI_API_KEY', 'CLOUDINARY_CLOUD_NAME'\]/);
  });

  it('prints variable names, never their values', () => {
    const warnBlock = /missingCloudinary[\s\S]{0,600}?\n  \}/.exec(MAIN)?.[0] ?? '';
    expect(warnBlock).toMatch(/missingCloudinary\.join/);
    // Nothing reads a value to print it.
    expect(warnBlock).not.toMatch(/process\.env\[[^\]]+\]\s*\}/);
  });

  it('does not make the service exit when storage is unconfigured', () => {
    // Only DATABASE_URL and JWT_SECRET are fatal.
    expect(MAIN).toMatch(/const required = \['DATABASE_URL', 'JWT_SECRET'\]/);
    const fatalBlock = /const missing = required[\s\S]*?\n  \}/.exec(MAIN)?.[0] ?? '';
    expect(fatalBlock).not.toMatch(/CLOUDINARY/);
  });
});

describe('module wiring', () => {
  const read = (p: string) => readFileSync(resolve(__dirname, '../../src', p), 'utf8');

  it('gives health the storage without importing the attendance chain', () => {
    const healthModule = read('modules/platform/health/health.module.ts');

    expect(healthModule).toMatch(/PunchPhotoStorageModule/);
    // Importing PunchEvidenceModule would drag in context, settings and workday.
    expect(healthModule).not.toMatch(/PunchEvidenceModule/);
    expect(healthModule).not.toMatch(/WorkdayModule|SettingsModule|DailyContextModule/);
  });

  it('keeps the storage module a leaf, so it cannot form a cycle', () => {
    const storageModule = read('modules/platform/attendance/punch/punch-photo-storage.module.ts');

    expect(storageModule).toMatch(/exports: \[PunchPhotoStorage\]/);
    expect(storageModule).not.toMatch(/imports:/);
  });

  it('leaves PunchPhotoStorage the single authority, provided once', () => {
    const punchModule = read('modules/platform/attendance/punch/punch-evidence.module.ts');

    // It now consumes the shared module rather than providing its own copy.
    expect(punchModule).toMatch(/PunchPhotoStorageModule/);
    expect(punchModule).not.toMatch(/providers: \[[^\]]*PunchPhotoStorage[,\]]/);

    // And the configuration rule is not restated in the controller.
    const controller = read('modules/platform/health/health.controller.ts');
    expect(controller).not.toMatch(/CLOUDINARY/);
    expect(controller).toMatch(/punchPhotoStorage\.isConfigured\(\)/);
  });
});
