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

let cachedApp: INestApplication | null = null;

export async function createTestApp(): Promise<{
  app: INestApplication;
  close: () => Promise<void>;
}> {
  if (cachedApp) {
    return { app: cachedApp, close: async () => {} };
  }

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
