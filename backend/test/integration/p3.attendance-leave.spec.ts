/**
 * Phase 3 API contracts over HTTP (whole AppModule, isolated database).
 *
 *   - correction queues take a scope; company is HR/Admin/Super Admin only
 *   - the single decision route is off until enabled (expand-and-enable)
 *   - an employee cannot decide their own correction
 *   - leave: retired types refused for new requests; Emergency must name a
 *     Casual/Sick bucket; balances are Casual 10 / Sick 4 and never 18
 *   - HR punch-review queue and LWP decisions are HR/Admin only
 */
import * as request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp } from '../helpers/app.helper';
import { bearerFor, clearTokenCache } from '../helpers/auth.helper';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('Phase 3 attendance and leave API', () => {
  let app: INestApplication;
  let close: () => Promise<void>;
  let db: PrismaService;
  const http = () => request(app.getHttpServer());

  async function setting(value: Record<string, unknown>) {
    const existing = await db.appSetting.findUnique({ where: { key: 'attendance_v2' } }).catch(() => null);
    const merged = { ...((existing?.value as any) ?? {}), ...value };
    await db.appSetting.upsert({ where: { key: 'attendance_v2' }, create: { key: 'attendance_v2', value: merged } as any, update: { value: merged } as any });
  }

  beforeAll(async () => {
    ({ app, close } = await createTestApp());
    db = app.get(PrismaService);
    await setting({ regularizationEnabled: true, correctionDecisionEnabled: false });
    // A versioned leave policy so balances resolve (10 Casual + 4 Sick).
    await db.leavePolicy.upsert({
      where: { policyKey_version: { policyKey: 'P3-API-LEAVE', version: 1 } },
      create: { policyKey: 'P3-API-LEAVE', version: 1, status: 'ACTIVE', isActive: true, financialYear: '2026-2027', name: 'P3 API Leave', effectiveFrom: new Date('2020-12-01T00:00:00.000Z') } as any,
      update: {},
    });
  });

  afterAll(async () => {
    clearTokenCache();
    await close();
  });

  it('team scope works for anyone; company scope is HR/Admin/Super Admin only', async () => {
    const lead = await bearerFor(app, 'teamlead');
    const admin = await bearerFor(app, 'admin');
    const superAdmin = await bearerFor(app, 'superadmin');
    await http().get('/api/attendance/regularization/pending?scope=team').set('Authorization', lead).expect(200);
    await http().get('/api/attendance/regularization/pending?scope=company').set('Authorization', lead).expect(403);
    const company = await http().get('/api/attendance/regularization/pending?scope=company').set('Authorization', admin).expect(200);
    expect(company.body).toEqual(expect.objectContaining({ scope: 'company', items: expect.any(Array), counts: expect.objectContaining({ canViewCompany: true }) }));
    await http().get('/api/attendance/regularization/pending?scope=company').set('Authorization', superAdmin).expect(200);
    await http().get('/api/attendance/regularization/pending?scope=everyone').set('Authorization', admin).expect(400);
    const counts = await http().get('/api/attendance/regularization/pending/counts').set('Authorization', lead).expect(200);
    expect(counts.body.company).toBeNull();
  });

  it('the decision route stays off until the workflow is enabled, then refuses self-decision', async () => {
    const employee = await bearerFor(app, 'employee');
    const me = await http().get('/api/auth/me').set('Authorization', employee).expect(200);
    const userId = me.body.id ?? me.body.user?.id;
    const row = await db.attendanceRegularization.create({
      data: { userId, date: new Date('2026-08-03T00:00:00.000Z'), requestType: 'OTHER', reason: 'API contract request', status: 'PENDING' } as any,
    });
    const admin = await bearerFor(app, 'admin');
    const off = await http().patch(`/api/attendance/regularization/${row.id}/decision`).set('Authorization', admin).send({ decision: 'APPROVE', reason: 'ok' });
    expect(off.status).toBe(503);
    expect(off.body.code ?? off.body.message?.code).toBe('CORRECTION_WORKFLOW_DISABLED');

    await setting({ correctionDecisionEnabled: true });
    try {
      const self = await http().patch(`/api/attendance/regularization/${row.id}/decision`).set('Authorization', employee).send({ decision: 'APPROVE', reason: 'my own' });
      expect(self.status).toBe(403);
      const noReason = await http().patch(`/api/attendance/regularization/${row.id}/decision`).set('Authorization', admin).send({ decision: 'APPROVE', reason: '' });
      expect(noReason.status).toBe(400);
      const ok = await http().patch(`/api/attendance/regularization/${row.id}/decision`).set('Authorization', admin).send({ decision: 'APPROVE', reason: 'Reviewed the request' });
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual(expect.objectContaining({ status: 'APPROVED', decisionProtocolVersion: 1, decidedVia: 'ADMIN', applicationStatus: 'NOT_REQUIRED' }));
      const again = await http().patch(`/api/attendance/regularization/${row.id}/decision`).set('Authorization', admin).send({ decision: 'REJECT', reason: 'second' });
      expect(again.status).toBe(409);
      // Old stage routes refuse once the workflow is on.
      const legacy = await http().patch(`/api/attendance/regularization/${row.id}/manager-approve`).set('Authorization', admin);
      expect(legacy.status).toBe(409);
    } finally {
      await setting({ correctionDecisionEnabled: false });
    }
  });

  it('new leave uses Casual/Sick; Emergency must name its bucket; EMERGENCY/ANNUAL types are retired for new requests', async () => {
    const employee = await bearerFor(app, 'employee');
    const retired = await http().post('/api/leave').set('Authorization', employee).send({ type: 'EMERGENCY', startDate: '2027-01-11', endDate: '2027-01-11', reason: 'Retired type' });
    expect(retired.status).toBe(400);
    const missingBucket = await http().post('/api/leave').set('Authorization', employee).send({ type: 'UNPAID', submissionMode: 'EMERGENCY', startDate: '2027-01-12', endDate: '2027-01-12', reason: 'No bucket' });
    expect(missingBucket.status).toBe(400);
    // A Monday no earlier run used, so the overlap rule never interferes.
    const fresh = new Date(Date.UTC(2027, 1, 1));
    fresh.setUTCDate(fresh.getUTCDate() + 7 * (Math.floor(Date.now() / 60000) % 50));
    const freshDay = fresh.toISOString().slice(0, 10);
    const ok = await http().post('/api/leave').set('Authorization', employee).send({ type: 'CASUAL', startDate: freshDay, endDate: freshDay, reason: 'Ordinary request' });
    expect(ok.status).toBe(201);
    expect(ok.body).toEqual(expect.objectContaining({ status: 'PENDING', submissionMode: 'STANDARD', fundingBucket: 'CASUAL', isLateSubmission: false }));
    // Every new request is routed to exactly one approver with an immutable snapshot.
    expect(ok.body.routingSnapshotId).toEqual(expect.any(String));
  });

  it('balances are Casual 10 and Sick 4, and no total reaches 18', async () => {
    const employee = await bearerFor(app, 'employee');
    const casual = await http().get('/api/leave/balance?type=CASUAL').set('Authorization', employee).expect(200);
    const sick = await http().get('/api/leave/balance?type=SICK').set('Authorization', employee).expect(200);
    const total = await http().get('/api/leave/balance').set('Authorization', employee).expect(200);
    expect(casual.body.allocation).toBe(10);
    expect(sick.body.allocation).toBe(4);
    expect(total.body.allocation).toBe(14);
  });

  it('punch-review and unreported-absence routes are HR/Admin only', async () => {
    const employee = await bearerFor(app, 'employee');
    const lead = await bearerFor(app, 'teamlead');
    const admin = await bearerFor(app, 'admin');
    await http().get('/api/attendance/console/punch-reviews').set('Authorization', employee).expect(403);
    await http().get('/api/attendance/console/punch-reviews').set('Authorization', lead).expect(403);
    const reviews = await http().get('/api/attendance/console/punch-reviews?reason=DEVICE_ID_UNAVAILABLE').set('Authorization', admin).expect(200);
    expect(reviews.body).toEqual(expect.objectContaining({ status: 'PENDING', items: expect.any(Array) }));
    await http().get('/api/attendance/console/unreported-absence').set('Authorization', lead).expect(403);
    await http().get('/api/attendance/console/unreported-absence').set('Authorization', admin).expect(200);
  });
});
