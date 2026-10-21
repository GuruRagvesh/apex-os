/** Phase 3 database contracts against the guarded throwaway PostgreSQL DB. */
import { randomUUID } from 'crypto';
import { buildHarness, Harness, seedCompany } from './harness';

describe('Phase 3 attendance and leave database contracts (PostgreSQL)', () => {
  let h: Harness;
  let employeeId: string;
  let actorId: string;

  beforeAll(async () => {
    h = await buildHarness();
    const seed = await seedCompany(h.prisma);
    employeeId = seed.employees.A.id;
    actorId = seed.actors.admin.id;
  });
  afterAll(async () => { await h.close(); });

  const createPending = async (date: string) => h.prisma.attendanceRegularization.create({
    data: { id: randomUUID(), userId: employeeId, date: new Date(`${date}T00:00:00.000Z`), requestType: 'OTHER', reason: 'Phase 3 integration request' } as any,
  });

  it('refuses a new REJECTED row without protocol-v1 decision evidence', async () => {
    const id = randomUUID();
    await expect(h.prisma.$executeRawUnsafe(
      `INSERT INTO attendance_regularizations (id,"userId",date,"requestType",reason,status,"createdAt","updatedAt") VALUES ($1,$2,DATE '2026-09-01','OTHER','bad rejection','REJECTED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      id, employeeId,
    )).rejects.toThrow(/protocol-v1 decision evidence/i);
  });

  it('refuses a transition to REJECTED without protocol-v1 decision evidence', async () => {
    const row = await createPending('2026-09-02');
    await expect(h.prisma.$executeRaw`UPDATE attendance_regularizations SET status = 'REJECTED' WHERE id = ${row.id}`).rejects.toThrow(/protocol-v1 decision evidence/i);
  });

  it('accepts a complete v1 rejection and makes its evidence immutable', async () => {
    const row = await createPending('2026-09-03');
    await h.prisma.$executeRaw`
      UPDATE attendance_regularizations
         SET status = 'REJECTED', "decisionProtocolVersion" = 1,
             decision = 'REJECT', "decidedById" = ${actorId},
             "decidedByRole" = 'ADMIN', "decidedVia" = 'ADMIN',
             "decidedAt" = CURRENT_TIMESTAMP, "decisionReason" = 'Evidence reviewed',
             "applicationStatus" = 'NOT_REQUIRED'
       WHERE id = ${row.id}`;
    await expect(h.prisma.$executeRaw`UPDATE attendance_regularizations SET "decisionReason" = 'rewritten' WHERE id = ${row.id}`).rejects.toThrow(/cannot be changed/i);
  });

  it('allows only one unresolved request for an employee and date', async () => {
    await createPending('2026-09-04');
    await expect(createPending('2026-09-04')).rejects.toThrow();
  });

  it('requires opposite, complete application evidence on an approved request', async () => {
    const row = await createPending('2026-09-05');
    await expect(h.prisma.$executeRaw`
      UPDATE attendance_regularizations
         SET status = 'APPROVED', "decisionProtocolVersion" = 1,
             decision = 'APPROVE', "decidedById" = ${actorId},
             "decidedByRole" = 'ADMIN', "decidedVia" = 'ADMIN',
             "decidedAt" = CURRENT_TIMESTAMP, "decisionReason" = 'Approved',
             "applicationStatus" = NULL
       WHERE id = ${row.id}`).rejects.toThrow(/attendance_regularizations_decision_v1_chk/i);
  });

  it('keeps punch evidence and leave evidence append-only', async () => {
    const punch = await h.prisma.attendancePunchEvidence.create({ data: { userId: employeeId, type: 'PUNCH_IN', businessDate: new Date('2026-09-06T00:00:00.000Z'), serverOccurredAt: new Date('2026-09-06T04:00:00.000Z'), idempotencyKey: randomUUID(), deviceId: randomUUID(), deviceType: 'MOBILE', captureChannel: 'CURRENT_DEVICE' } as any });
    await expect(h.prisma.attendancePunchEvidence.update({ where: { id: punch.id }, data: { deviceType: 'TABLET' } as any })).rejects.toThrow(/append-only/i);

    const leave = await h.prisma.leaveRequest.create({ data: { userId: employeeId, type: 'CASUAL', status: 'PENDING', startDate: new Date('2026-09-07T00:00:00.000Z'), endDate: new Date('2026-09-07T23:59:59.000Z'), reason: 'Emergency evidence fixture' } as any });
    const evidenceId = randomUUID();
    await h.prisma.$executeRaw`INSERT INTO leave_evidence (id,"leaveRequestId","userId","uploadedById","fileName","mimeType","sizeBytes",sha256,"storageKey") VALUES (${evidenceId},${leave.id},${employeeId},${employeeId},'proof.pdf','application/pdf',10,${'a'.repeat(64)},'phase3/test-proof')`;
    await expect(h.prisma.$executeRaw`UPDATE leave_evidence SET "fileName" = 'changed.pdf' WHERE id = ${evidenceId}`).rejects.toThrow(/append-only/i);
  });
});

