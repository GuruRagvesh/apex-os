/**
 * Shared NestJS testing application factory.
 *
 * Creates a real NestJS TestingModule backed by the actual database.
 * Use this for integration/smoke tests.  Unit tests should mock dependencies
 * directly and not use this helper.
 *
 * Usage:
 *   const { app, close } = await createTestApp();
 *   const res = await request(app.getHttpServer()).get('/api/health');
 *   await close();
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { assertIsolatedDatabase } from '../integration-pg/db-guard';

let cachedApp: INestApplication | null = null;

export async function createTestApp(): Promise<{
  app: INestApplication;
  close: () => Promise<void>;
}> {
  if (cachedApp) {
    return { app: cachedApp, close: async () => {} };
  }

  // The app writes through the real API. Refuse anything but the dedicated
  // isolated database, however this suite was launched.
  assertIsolatedDatabase(process.env.DATABASE_URL);

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  cachedApp = app;

  return {
    app,
    close: async () => {
      await app.close();
      cachedApp = null;
    },
  };
}
