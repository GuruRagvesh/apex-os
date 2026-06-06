import * as request from 'supertest';
import { createTestApp } from '../helpers/app.helper';
import { bearerFor, clearTokenCache } from '../helpers/auth.helper';
import { INestApplication } from '@nestjs/common';

describe('Task Types API', () => {
  let app: INestApplication;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ app, close } = await createTestApp());
  });

  afterAll(async () => {
    clearTokenCache();
    await close();
  });

  describe('GET /task-types', () => {
    it('returns 401 when unauthenticated', async () => {
      await request(app.getHttpServer())
        .get('/api/task-types')
        .expect(401);
    });

    it('returns 200 when authenticated as employee', async () => {
      const token = await bearerFor(app, 'employee');
      const res = await request(app.getHttpServer())
        .get('/api/task-types')
        .set('Authorization', token)
        .expect(200);
      
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('returns 200 when authenticated as admin', async () => {
      const token = await bearerFor(app, 'admin');
      const res = await request(app.getHttpServer())
        .get('/api/task-types')
        .set('Authorization', token)
        .expect(200);
      
      expect(Array.isArray(res.body)).toBe(true);
    });
  });
});
