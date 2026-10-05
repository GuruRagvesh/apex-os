/**
 * Phase 5B: integration runs never reach external services.
 *
 * test/jest.env.ts installs test/test-environment-guard.ts before this file
 * loads: provider settings are blanked (so the Prisma client cannot fill them
 * from backend/.env), DATABASE_URL is checked, and outbound network is blocked.
 * This suite proves the result with the REAL provider-facing services built
 * from a real ConfigService, plus a real attachment submission end to end:
 * no Cloudinary upload or delete, no email, no R2 / OneDrive call, no
 * non-loopback request.
 *
 * Refuses to run unless DATABASE_URL is the dedicated loopback integration
 * database (see db-guard.ts).
 */
import * as http from 'http';
import * as https from 'https';
import { ConfigService } from '@nestjs/config';
import { TicketStatus } from '@prisma/client';
import { v2 as cloudinary } from 'cloudinary';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TVAService } from '../../src/common/services/tva.service';
import { ActiveWorkdayPolicyService } from '../../src/common/services/active-workday-policy.service';
import { AttendanceAuthorityService } from '../../src/common/services/attendance-authority.service';
import { TicketLedgerService } from '../../src/modules/operations/tickets/ticket-ledger.service';
import { TicketsService, type AttachmentStorage } from '../../src/modules/operations/tickets/tickets.service';
import { WorkdayService } from '../../src/modules/platform/workday/workday.service';
import { UploadsService } from '../../src/modules/platform/uploads/uploads.service';
import { EmailService } from '../../src/modules/platform/email/email.service';
import { BackupVaultService } from '../../src/modules/platform/backup-vault/backup-vault.service';
import { enabledProviders, ExternalNetworkBlockedError } from '../test-environment-guard';
import { assertIsolatedDatabase, assertServerIdentity } from './db-guard';

const W = 'u-t15-worker';

describe('T15 external-service isolation (PostgreSQL)', () => {
  let prisma: PrismaService;
  let config: ConfigService;
  const calls = { fetch: 0, http: 0, https: 0 };

  beforeAll(async () => {
    assertIsolatedDatabase();
    prisma = new PrismaService();
    await prisma.$connect();
    await assertServerIdentity(prisma as any);
    config = new ConfigService();
  });

  beforeEach(() => {
    calls.fetch = calls.http = calls.https = 0;
    const realFetch = globalThis.fetch;
    jest.spyOn(globalThis, 'fetch').mockImplementation(((...a: any[]) => { calls.fetch += 1; return (realFetch as any)(...a); }) as any);
    const realHttp = http.request;
    jest.spyOn(http, 'request').mockImplementation(((...a: any[]) => { calls.http += 1; return (realHttp as any)(...a); }) as any);
    const realHttps = https.request;
    jest.spyOn(https, 'request').mockImplementation(((...a: any[]) => { calls.https += 1; return (realHttps as any)(...a); }) as any);
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await prisma?.$executeRawUnsafe(`TRUNCATE TABLE users, roles RESTART IDENTITY CASCADE`);
    await prisma?.$disconnect();
  });

  it('1. the test process has no provider configured, even though the Prisma client loaded backend/.env', () => {
    expect(enabledProviders(process.env)).toEqual([]);
    for (const k of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'RESEND_API_KEY', 'R2_ACCESS_KEY_ID', 'MICROSOFT_CLIENT_SECRET']) {
      expect(config.get(k) ?? '').toBe('');
    }
    expect(new URL(process.env.DATABASE_URL!).hostname).toBe('127.0.0.1');
  });

  it('2. uploads stay local: no Cloudinary upload or delete, no network', async () => {
    const upload = jest.spyOn(cloudinary.uploader, 'upload_stream');
    const destroy = jest.spyOn(cloudinary.uploader, 'destroy');
    const uploads = new UploadsService(prisma, config);
    const url = await uploads.storeTicketFile('t-x', { originalname: 'a.txt', mimetype: 'text/plain', size: 3, buffer: Buffer.from('abc') });
    expect(url).toBe(`data:text/plain;base64,${Buffer.from('abc').toString('base64')}`);
    await uploads.discardStoredFile(url);
    await uploads.discardStoredFile('cloudinary:authenticated:raw:some-id:pdf');
    expect(upload).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
    expect(calls).toEqual({ fetch: 0, http: 0, https: 0 });
  });

  it('3. email is skipped (no provider), never sent', async () => {
    const email = new EmailService(prisma, config);
    await expect(email.sendEmail('someone@integration.invalid', 'subject', '<p>x</p>')).resolves.toBe(false);
    expect(calls).toEqual({ fetch: 0, http: 0, https: 0 });
  });

  it('4. the backup vault refuses (R2 and OneDrive unconfigured) without any request', async () => {
    const vault = new BackupVaultService(config);
    await expect(vault.archiveToVault('k.xlsx', Buffer.from('x'))).rejects.toThrow(/Backup vault is not configured/);
    await expect(vault.save(Buffer.from('x'), 'f.xlsx')).rejects.toThrow(/Backup vault not configured/);
    expect(calls).toEqual({ fetch: 0, http: 0, https: 0 });
  });

  it('5. a real submission with proof stores it locally and calls nothing outside', async () => {
    await assertServerIdentity(prisma as any);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE users, roles RESTART IDENTITY CASCADE`);
    await prisma.role.create({ data: { id: 'r-t15', name: 'EMPLOYEE', level: 4 } as any });
    await prisma.user.create({
      data: { id: W, roleId: 'r-t15', name: W, email: `${W}@integration.invalid`, password: 'not-a-real-hash', currentStatus: 'OFFLINE' } as any,
    });
    const tva = new TVAService({ get: () => undefined } as any);
    const ledger = new TicketLedgerService(prisma, tva);
    const workday = new WorkdayService(prisma, {} as any, { log: async () => undefined } as any, ledger, { sendNotification: async () => null } as any, new AttendanceAuthorityService(prisma), tva);
    const access = {
      isSelfAssigned: () => false, viewerCanApprove: async () => false,
      findAccessibleTicket: async (id: string, _u: any, include?: any) => prisma.ticket.findFirst({ where: { OR: [{ id }, { ticketId: id }] }, include: include ?? { assignees: true } }),
      assertCanTransitionTicket: async () => undefined, assertCanAssignTicket: async () => undefined,
      assertCanUpdateTicket: async () => undefined, assertCanUploadAttachment: async () => undefined,
    };
    const tickets = new TicketsService(
      prisma, { emitTicketStatusChanged: () => undefined } as any, { sendNotification: async () => null } as any, config,
      { emit: () => true } as any, { log: async () => undefined } as any, access as any,
      { resolvePrimaryApproverFor: async () => null } as any,
      { getSlaConfig: async () => ({ review: { MEDIUM: 24 } }), decorateTicket: async (t: any) => t } as any,
      ledger, {} as any, new ActiveWorkdayPolicyService(tva), tva,
    );
    const uploads = new UploadsService(prisma, config);
    const storage: AttachmentStorage = {
      store: (ticketId, file) => uploads.storeTicketFile(ticketId, file),
      discard: (url) => uploads.discardStoredFile(url),
    };

    await workday.startWork(W);
    const t = await prisma.ticket.create({
      data: { ticketId: 'TKT-T15-1', title: 't', category: 'IT', type: 'TASK', createdById: W, assignedToId: W } as any,
    });
    await tickets.update(t.id, { status: TicketStatus.IN_PROGRESS }, W);
    calls.fetch = calls.http = calls.https = 0;
    await tickets.submitForReview(t.id, { id: W, role: { name: 'EMPLOYEE' } }, { originalname: 'proof.pdf', mimetype: 'application/pdf', size: 4, buffer: Buffer.from('%PDF') }, storage);

    const [att] = await prisma.attachment.findMany({ where: { ticketId: t.id } });
    expect(att.url.startsWith('data:application/pdf;base64,')).toBe(true);
    expect(calls).toEqual({ fetch: 0, http: 0, https: 0 });
  });

  it('6. an accidental external request fails closed, naming only the host', async () => {
    jest.restoreAllMocks();
    await expect(fetch('https://api.cloudinary.com/v1_1/demo/image/upload')).rejects.toBeInstanceOf(ExternalNetworkBlockedError);
    expect(() => https.request({ hostname: 'apex-os-backend.onrender.com', path: '/api/health' })).toThrow('host: apex-os-backend.onrender.com');
  });
});
