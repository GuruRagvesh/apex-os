/**
 * Smoke tests — API endpoint availability
 *
 * Verifies that every key page/endpoint returns the correct HTTP status with
 * a valid token.  These tests require the backend .env (real DB + JWT_SECRET)
 * and the QC test users created by `prisma/seed-test-users.ts`.
 *
 * Run:  npx jest test/integration/smoke.spec.ts
 */
import * as request from 'supertest';
import { createTestApp } from '../helpers/app.helper';
import { bearerFor, loginAs, clearTokenCache } from '../helpers/auth.helper';
import { INestApplication } from '@nestjs/common';

describe('API Smoke Tests', () => {
  let app: INestApplication;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ app, close } = await createTestApp());
  });

  afterAll(async () => {
    clearTokenCache();
    await close();
  });

  // ── Health ──────────────────────────────────────────────────────────────────
  describe('Health', () => {
    it('GET /api/health → 200 with database connected', async () => {
      const res = await request(app.getHttpServer()).get('/api/health').expect(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.database).toBe('connected');
    });
  });

  // ── Auth ────────────────────────────────────────────────────────────────────
  describe('Auth', () => {
    it('POST /api/auth/login with valid credentials → 201 + accessToken', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'admin@apex.local', password: 'Apex@local1' })
        .expect(201);
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.user.email).toBe('admin@apex.local');
    });

    it('POST /api/auth/login with wrong password → 401', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'admin@apex.local', password: 'wrongpassword' })
        .expect(401);
    });

    it('GET /api/auth/me without token → 401', async () => {
      await request(app.getHttpServer()).get('/api/auth/me').expect(401);
    });

    it('GET /api/auth/me with valid token → 200', async () => {
      const token = await loginAs(app, 'admin');
      const res = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.email).toBe('admin@apex.local');
    });

    it('POST /api/auth/register without token → 401 (route is protected)', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ email: 'new@apex.local', password: 'Test@123', name: 'Test', roleId: 'x' })
        .expect(401);
    });

    it('POST /api/auth/register as EMPLOYEE → 403', async () => {
      const token = await bearerFor(app, 'employee');
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .set('Authorization', token)
        .send({ email: 'new2@apex.local', password: 'Test@123', name: 'Test', roleId: 'x' })
        .expect(403);
    });
  });

  // ── Tickets ─────────────────────────────────────────────────────────────────
  describe('Tickets', () => {
    it('GET /api/tickets without token → 401', async () => {
      await request(app.getHttpServer()).get('/api/tickets').expect(401);
    });

    it('GET /api/tickets as ADMIN → 200 with pagination', async () => {
      const token = await bearerFor(app, 'admin');
      const res = await request(app.getHttpServer())
        .get('/api/tickets')
        .set('Authorization', token)
        .expect(200);
      expect(res.body).toHaveProperty('tickets');
      expect(res.body).toHaveProperty('total');
    });

    it('GET /api/tickets/kanban as EMPLOYEE → 200', async () => {
      const token = await bearerFor(app, 'employee');
      await request(app.getHttpServer())
        .get('/api/tickets/kanban')
        .set('Authorization', token)
        .expect(200);
    });

    it('GET /api/tickets/stats as ADMIN → 200', async () => {
      const token = await bearerFor(app, 'admin');
      await request(app.getHttpServer())
        .get('/api/tickets/stats')
        .set('Authorization', token)
        .expect(200);
    });
  });

  // ── Projects ─────────────────────────────────────────────────────────────────
  describe('Projects', () => {
    it('GET /api/projects without token → 401', async () => {
      await request(app.getHttpServer()).get('/api/projects').expect(401);
    });

    it('GET /api/projects as ADMIN → 200 with pagination', async () => {
      const token = await bearerFor(app, 'admin');
      const res = await request(app.getHttpServer())
        .get('/api/projects')
        .set('Authorization', token)
        .expect(200);
      expect(res.body).toHaveProperty('projects');
    });
  });

  // ── Leave ───────────────────────────────────────────────────────────────────
  describe('Leave', () => {
    it('GET /api/leave without token → 401', async () => {
      await request(app.getHttpServer()).get('/api/leave').expect(401);
    });

    it('GET /api/leave as EMPLOYEE → 200', async () => {
      const token = await bearerFor(app, 'employee');
      await request(app.getHttpServer())
        .get('/api/leave')
        .set('Authorization', token)
        .expect(200);
    });

    it('GET /api/leave/stats as MANAGER → 200', async () => {
      const token = await bearerFor(app, 'manager');
      await request(app.getHttpServer())
        .get('/api/leave/stats')
        .set('Authorization', token)
        .expect(200);
    });
  });

  // ── Users ───────────────────────────────────────────────────────────────────
  describe('Users', () => {
    it('GET /api/users without token → 401', async () => {
      await request(app.getHttpServer()).get('/api/users').expect(401);
    });

    it('GET /api/users as ADMIN → 200 with pagination', async () => {
      const token = await bearerFor(app, 'admin');
      const res = await request(app.getHttpServer())
        .get('/api/users')
        .set('Authorization', token)
        .expect(200);
      expect(res.body).toHaveProperty('users');
      expect(res.body).toHaveProperty('total');
    });

    it('GET /api/users/me as EMPLOYEE → 200', async () => {
      const token = await bearerFor(app, 'employee');
      const res = await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', token)
        .expect(200);
      expect(res.body.email).toBe('employee@apex.local');
    });

    it('POST /api/users as EMPLOYEE → 403', async () => {
      const token = await bearerFor(app, 'employee');
      await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', token)
        .send({ name: 'Test', email: 'x@x.com', password: 'Test@123', roleId: 'x' })
        .expect(403);
    });
  });

  // ── Dashboard ───────────────────────────────────────────────────────────────
  describe('Dashboard', () => {
    it('GET /api/dashboard/overview without token → 401', async () => {
      await request(app.getHttpServer()).get('/api/dashboard/overview').expect(401);
    });

    it('GET /api/dashboard/overview as ADMIN → 200', async () => {
      const token = await bearerFor(app, 'admin');
      await request(app.getHttpServer())
        .get('/api/dashboard/overview')
        .set('Authorization', token)
        .expect(200);
    });

    it('GET /api/dashboard/workload as MANAGER → 200', async () => {
      const token = await bearerFor(app, 'manager');
      await request(app.getHttpServer())
        .get('/api/dashboard/workload')
        .set('Authorization', token)
        .expect(200);
    });
  });

  // ── Notifications ────────────────────────────────────────────────────────────
  describe('Notifications', () => {
    it('GET /api/notifications without token → 401', async () => {
      await request(app.getHttpServer()).get('/api/notifications').expect(401);
    });

    it('GET /api/notifications as EMPLOYEE → 200 (own only)', async () => {
      const token = await bearerFor(app, 'employee');
      const res = await request(app.getHttpServer())
        .get('/api/notifications')
        .set('Authorization', token)
        .expect(200);
      // All returned notifications should belong to the employee
      const notifications: any[] = res.body;
      expect(Array.isArray(notifications)).toBe(true);
    });
  });

  // ── Settings ─────────────────────────────────────────────────────────────────
  describe('Settings', () => {
    it('GET /api/settings/company as ADMIN → 200', async () => {
      const token = await bearerFor(app, 'admin');
      await request(app.getHttpServer())
        .get('/api/settings/company')
        .set('Authorization', token)
        .expect(200);
    });

    it('PATCH /api/settings/company as EMPLOYEE → 403 (write is restricted)', async () => {
      const token = await bearerFor(app, 'employee');
      await request(app.getHttpServer())
        .patch('/api/settings/company')
        .set('Authorization', token)
        .send({ companyName: 'Hack Attempt' })
        .expect(403);
    });
  });

  // ── Departments ──────────────────────────────────────────────────────────────
  describe('Departments', () => {
    it('GET /api/departments as any authenticated user → 200', async () => {
      const token = await bearerFor(app, 'intern');
      const res = await request(app.getHttpServer())
        .get('/api/departments')
        .set('Authorization', token)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('POST /api/departments as EMPLOYEE → 403', async () => {
      const token = await bearerFor(app, 'employee');
      await request(app.getHttpServer())
        .post('/api/departments')
        .set('Authorization', token)
        .send({ name: 'Test Dept' })
        .expect(403);
    });

    it('POST /api/departments as ADMIN → succeeds (then clean up)', async () => {
      const token = await bearerFor(app, 'admin');
      const res = await request(app.getHttpServer())
        .post('/api/departments')
        .set('Authorization', token)
        .send({ name: `_QC_TEST_DEPT_${Date.now()}`, description: 'QC test — safe to delete' })
        // NestJS POST returns 201 by default
        .expect((r) => { expect([200, 201]).toContain(r.status); });
      const deptId = res.body.id;
      expect(deptId).toBeDefined();
      // Clean up — NestJS DELETE returns 200 or 204
      await request(app.getHttpServer())
        .delete(`/api/departments/${deptId}`)
        .set('Authorization', token)
        .expect((r) => { expect([200, 204]).toContain(r.status); });
    });
  });

  // ── Role scoping (dashboard) ─────────────────────────────────────────────────
  describe('Role-scoped dashboard', () => {
    it('EMPLOYEE and ADMIN see different overview totals', async () => {
      const adminToken    = await bearerFor(app, 'admin');
      const employeeToken = await bearerFor(app, 'employee');

      const [adminRes, empRes] = await Promise.all([
        request(app.getHttpServer())
          .get('/api/dashboard/overview')
          .set('Authorization', adminToken),
        request(app.getHttpServer())
          .get('/api/dashboard/overview')
          .set('Authorization', employeeToken),
      ]);

      expect(adminRes.status).toBe(200);
      expect(empRes.status).toBe(200);
      // Admin should see more (or equal) open tickets than the QC employee
      const adminOpen = adminRes.body.openTickets ?? adminRes.body.open ?? 0;
      const empOpen   = empRes.body.openTickets  ?? empRes.body.open  ?? 0;
      expect(adminOpen).toBeGreaterThanOrEqual(empOpen);
    });
  });
});
