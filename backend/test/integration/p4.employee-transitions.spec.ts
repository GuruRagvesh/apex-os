/**
 * Phase 4 HTTP contracts over the whole AppModule and the isolated database.
 * Service/SQL edge cases live in p4-employee-transitions.int-spec.ts; this
 * suite proves the route wiring, role boundaries, structured refusals and the
 * employee-safe legal-hold view.
 */
import * as request from 'supertest';
import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { createTestApp } from '../helpers/app.helper';
import { bearerFor, clearTokenCache } from '../helpers/auth.helper';
import { INTEGRATION_USERS } from '../helpers/integration-users';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('Phase 4 employee transitions API', () => {
  let app: INestApplication;
  let close: () => Promise<void>;
  let db: PrismaService;
  let targetId: string;
  let targetDepartmentId: string;
  let employeeId: string;
  let adminId: string;
  const http = () => request(app.getHttpServer());
  const key = () => randomUUID();

  const expectCode = (res: request.Response, status: number, code: string) => {
    expect(res.status).toBe(status);
    expect(res.body.code ?? res.body.message?.code).toBe(code);
  };

  beforeAll(async () => {
    ({ app, close } = await createTestApp());
    db = app.get(PrismaService);
    const [employee, admin, employeeRole, homeDepartment] = await Promise.all([
      db.user.findUniqueOrThrow({ where: { email: INTEGRATION_USERS.employee.email } }),
      db.user.findUniqueOrThrow({ where: { email: INTEGRATION_USERS.admin.email } }),
      db.role.findUniqueOrThrow({ where: { name: 'EMPLOYEE' } }),
      db.department.findUniqueOrThrow({ where: { name: 'Integration Operations' } }),
    ]);
    employeeId = employee.id;
    adminId = admin.id;
    const suffix = randomUUID().slice(0, 8);
    const targetDepartment = await db.department.create({ data: { name: `P4 Target ${suffix}`, description: 'Phase 4 API test only' } });
    targetDepartmentId = targetDepartment.id;
    const target = await db.user.create({
      data: {
        email: `p4-target-${suffix}@integration.invalid`, name: 'Phase 4 Transfer Target', password: employee.password,
        roleId: employeeRole.id, departmentId: homeDepartment.id, employeeId: `P4-${suffix}`, joiningDate: new Date('2026-01-01T00:00:00.000Z'),
        isActive: true, employmentState: 'ACTIVE', mustChangePassword: false,
      } as any,
    });
    targetId = target.id;

    // Keep the deterministic employee reusable when this suite is rerun.
    await db.exitCase.deleteMany({ where: { userId: employeeId } });
    await db.employmentPeriod.deleteMany({ where: { userId: employeeId } });
    await db.employmentPeriod.create({
      data: { id: randomUUID(), userId: employeeId, startDate: new Date('2026-01-01T00:00:00.000Z'), startReason: 'NEW_HIRE' },
    });

    const superadmin = await bearerFor(app, 'superadmin');
    for (const capability of ['transfer', 'exit', 'compliance']) {
      await http().put(`/api/transitions/capabilities/${capability}`).set('Authorization', superadmin).send({ enabled: true }).expect(200);
    }
  });

  afterAll(async () => {
    clearTokenCache();
    await close();
  });

  it('requires authentication and only Super Admin changes rollout switches', async () => {
    await http().get('/api/transitions/capabilities').expect(401);
    const employee = await bearerFor(app, 'employee');
    const caps = await http().get('/api/transitions/capabilities').set('Authorization', employee).expect(200);
    expect(caps.body.transfer).toEqual(expect.objectContaining({ enabled: true, switchOn: true, schemaReady: true }));
    const admin = await bearerFor(app, 'admin');
    const denied = await http().put('/api/transitions/capabilities/transfer').set('Authorization', admin).send({ enabled: false });
    expectCode(denied, 403, 'FORBIDDEN');
  });

  it('enforces transfer authority and returns a confirmable, paginated transfer', async () => {
    const employee = await bearerFor(app, 'employee');
    const admin = await bearerFor(app, 'admin');
    const employeeRole = await db.role.findUniqueOrThrow({ where: { name: 'EMPLOYEE' } });
    const plan = { toDepartmentId: targetDepartmentId, toRoleId: employeeRole.id };

    const denied = await http().post(`/api/transitions/transfers/preview/${targetId}`).set('Authorization', employee).send(plan);
    expectCode(denied, 403, 'FORBIDDEN');
    const self = await http().post(`/api/transitions/transfers/preview/${adminId}`).set('Authorization', admin).send({ ...plan, toRoleId: employeeRole.id });
    expectCode(self, 403, 'TRANSFER_SELF');

    const preview = await http().post(`/api/transitions/transfers/preview/${targetId}`).set('Authorization', admin).send(plan).expect(201);
    expect(preview.body).toEqual(expect.objectContaining({ fingerprint: expect.any(String), user: expect.objectContaining({ id: targetId }) }));
    const effectiveOn = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const confirmed = await http().post(`/api/transitions/transfers/confirm/${targetId}`).set('Authorization', admin).send({
      ...plan, fingerprint: preview.body.fingerprint, idempotencyKey: key(), effectiveOn, reason: 'Phase 4 HTTP contract',
    }).expect(201);
    expect(confirmed.body).toEqual(expect.objectContaining({ userId: targetId, status: 'SCHEDULED', effectiveOn }));

    const list = await http().get('/api/transitions/transfers?page=1&status=SCHEDULED').set('Authorization', admin).expect(200);
    expect(list.body).toEqual(expect.objectContaining({ total: expect.any(Number), items: expect.any(Array) }));
    expect(list.body.items.some((row: any) => row.id === confirmed.body.id)).toBe(true);
  });

  it('records probation, lets the employee resign, and lets the same employee withdraw before LWD', async () => {
    const admin = await bearerFor(app, 'admin');
    const employee = await bearerFor(app, 'employee');
    await http().post(`/api/transitions/users/${employeeId}/probation-verification`).set('Authorization', admin).send({
      probationStatus: 'CONFIRMED', idempotencyKey: key(),
    }).expect(201);

    const started = await http().post(`/api/transitions/users/${employeeId}/exit`).set('Authorization', employee).send({ idempotencyKey: key() }).expect(201);
    expect(started.body).toEqual(expect.objectContaining({ userId: employeeId, state: 'NOTICE_RUNNING', canWithdraw: true }));
    expect(started.body.clearance).toHaveLength(9);
    const withdrawn = await http().post(`/api/transitions/exits/${started.body.id}/withdraw`).set('Authorization', employee).send({
      idempotencyKey: key(), reason: 'Plans changed before the last working day',
    }).expect(201);
    expect(withdrawn.body.state).toBe('WITHDRAWN');
  });

  it('enforces four-eyes legal holds and exposes only a restriction boolean to the employee', async () => {
    const admin = await bearerFor(app, 'admin');
    const superadmin = await bearerFor(app, 'superadmin');
    const employee = await bearerFor(app, 'employee');
    const created = await http().post(`/api/compliance/users/${employeeId}/legal-holds`).set('Authorization', admin).send({
      reasonCode: 'AUDIT', notes: 'Privileged note must never reach the employee', reference: 'P4-API-REF', idempotencyKey: key(),
    }).expect(201);
    expect(created.body).toEqual(expect.objectContaining({ status: 'REQUESTED', notes: expect.any(String), reference: 'P4-API-REF' }));
    const samePerson = await http().post(`/api/compliance/legal-holds/${created.body.id}/confirm`).set('Authorization', admin).send({});
    expectCode(samePerson, 403, 'LEGAL_HOLD_SAME_PERSON');
    await http().post(`/api/compliance/legal-holds/${created.body.id}/confirm`).set('Authorization', superadmin).send({}).expect(201);

    const restriction = await http().get(`/api/compliance/users/${employeeId}/restriction`).set('Authorization', employee).expect(200);
    expect(restriction.body).toEqual({ deletionRestricted: true });
    expect(JSON.stringify(restriction.body)).not.toContain('P4-API-REF');
    expect(JSON.stringify(restriction.body)).not.toContain('Privileged note');
    await http().get('/api/compliance/legal-holds').set('Authorization', employee).expect(403);
  });

  it('enforces a different retention approver and stores an approved version', async () => {
    const admin = await bearerFor(app, 'admin');
    const superadmin = await bearerFor(app, 'superadmin');
    const before = await db.retentionRule.findUnique({ where: { category: 'PAYROLL' } });
    const nextMonths = (before?.retentionMonths ?? 83) + 1;

    const proposal = await http().post('/api/compliance/retention/proposals').set('Authorization', admin).send({
      category: 'PAYROLL', action: before ? 'UPDATE' : 'CREATE', retentionMonths: nextMonths, policyReference: `P4-API-POLICY-${key()}`, reason: 'API contract', idempotencyKey: key(),
    }).expect(201);
    const samePerson = await http().post(`/api/compliance/retention/proposals/${proposal.body.id}/decision`).set('Authorization', admin).send({ decision: 'APPROVE' });
    expectCode(samePerson, 403, 'RETENTION_PROPOSAL_SAME_PERSON');
    const approved = await http().post(`/api/compliance/retention/proposals/${proposal.body.id}/decision`).set('Authorization', superadmin).send({ decision: 'APPROVE' }).expect(201);
    expect(approved.body.status).toBe('APPROVED');
    const overview = await http().get('/api/compliance/retention').set('Authorization', admin).expect(200);
    expect(overview.body.rules).toEqual(expect.arrayContaining([expect.objectContaining({ category: 'PAYROLL', status: 'ACTIVE', retentionMonths: nextMonths })]));
    expect(overview.body.versions).toEqual(expect.arrayContaining([expect.objectContaining({ category: 'PAYROLL', version: (before?.version ?? 0) + 1 })]));
  });
});
